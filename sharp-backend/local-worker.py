"""Outbound-only bridge. Configuration and bearer secret stay outside the repository."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request
from urllib.error import HTTPError

parser = argparse.ArgumentParser()
parser.add_argument('--config', type=Path, required=True)
args = parser.parse_args()
config = json.loads(args.config.read_text())
base = config['url'].rstrip('/')+'/api/painterly/worker/'
if not base.startswith('https://'):
    raise ValueError('The bridge requires HTTPS')

def call(path, method='POST', body=None, lease=None, timeout=120):
    headers = {'Authorization':'Bearer '+config['token']}
    if lease: headers['X-Job-Lease'] = lease
    req = urllib.request.Request(base+path, data=body, headers=headers, method=method)
    return urllib.request.urlopen(req,timeout=timeout)

def stop_inference(process):
    if os.name == 'nt':
        subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
    else:
        process.kill()

print('Local SHARP generator started. Polling the site; no inbound port is open.',flush=True)
while True:
    job = None
    try:
        with call('claim') as response:
            job = json.load(response)['job']
        if job:
            route = 'jobs/'+job['id']+'/'
            lease = job['lease']
            with tempfile.TemporaryDirectory(prefix='painterly-local-') as folder:
                photo = Path(folder)/'photo.jpg'
                output = Path(folder)/'scene.ply'
                with call(route+'input','GET',lease=lease) as response:
                    data = response.read(2*1024*1024+1)
                if len(data) > 2*1024*1024: raise ValueError('Oversized photo')
                photo.write_bytes(data); del data
                command = [sys.executable,str(Path(__file__).with_name('infer.py')),
                           '--photo',str(photo),'--output',str(output),'--checkpoint',config['checkpoint']]
                started = time.monotonic()
                with subprocess.Popen(command, creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0)) as process:
                    while process.poll() is None:
                        if time.monotonic()-started > 420:
                            stop_inference(process); raise TimeoutError('Inference timed out')
                        try:
                            with call('heartbeat',timeout=20): pass
                            # Stop consuming compute promptly after cancellation.
                            with call(route+'status','GET',lease=lease,timeout=20) as check:
                                check.read()
                        except HTTPError as error:
                            if error.code in (404,410): stop_inference(process); break
                        except OSError: pass
                        time.sleep(10)
                    if process.wait() != 0: raise RuntimeError('Inference stopped or failed')
                with output.open('rb') as file:
                    # urllib uses Content-Length for bytes; Cloudflare streams the result straight to R2.
                    with call(route+'result','PUT',file.read(),lease,timeout=180) as response:
                        json.load(response)
                print('Generated and returned a splat in %.1f seconds.' % (time.monotonic()-started),flush=True)
    except KeyboardInterrupt:
        break
    except Exception as error:
        print('Generator request failed: '+type(error).__name__,flush=True)
        if job:
            try:
                with call('jobs/'+job['id']+'/fail',lease=job['lease']): pass
            except Exception: pass
    time.sleep(10)
