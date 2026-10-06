"""Ephemeral SHARP jobs. One CPU inference at a time; no photos or results logged."""
import argparse
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image, ImageOps

PREFIX = '/api/painterly'
MAX_IMAGE = 2 * 1024 * 1024
TTL = 10 * 60
jobs = {}
lock = threading.Lock()
busy = threading.Lock()
model = None
checkpoint = os.environ.get('SHARP_CHECKPOINT', '/models/sharp.pt')
Image.MAX_IMAGE_PIXELS = 4_000_000


def predict(photo, output, device='cpu'):
    global model
    import numpy as np
    import torch
    from sharp.models import create_predictor, PredictorParams
    from sharp.cli.predict import predict_image
    from sharp.utils.gaussians import save_ply
    torch.set_num_threads(4)
    if model is None:
        state = torch.load(checkpoint, map_location='cpu', weights_only=True, mmap=True)
        model = create_predictor(PredictorParams())
        model.load_state_dict(state, assign=True)
        del state
        model.eval()
    model.to(device)
    with Image.open(io.BytesIO(photo)) as source:
        image = np.asarray(ImageOps.exif_transpose(source).convert('RGB'))
    height, width = image.shape[:2]
    # Webcams rarely provide EXIF focal length. Same 30 mm equivalent fallback as SHARP.
    focal = 30 * (width * width + height * height) ** .5 / (36 * 36 + 24 * 24) ** .5
    gaussians = predict_image(model, image, focal, torch.device(device))
    save_ply(gaussians, focal, (height, width), output)


def run_job(job, photo):
    try:
        job['state'] = 'processing'
        predict(photo, Path(job['directory'])/'scene.ply')
        job['state'] = 'ready'
    except Exception as error:
        # No image content, filenames, or credentials in logs.
        print('SHARP inference failed:', type(error).__name__, flush=True)
        job['state'] = 'failed'
    finally:
        photo = None
        if job.get('cancelled'):
            shutil.rmtree(job['directory'], ignore_errors=True)
        busy.release()


def reap():
    while True:
        time.sleep(10)
        with lock:
            for key, job in list(jobs.items()):
                if time.time() > job['expires']:
                    job['cancelled'] = True
                    if job['state'] not in ('queued', 'processing'):
                        shutil.rmtree(job['directory'], ignore_errors=True)
                    del jobs[key]


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, payload, status=200):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def find_job(self):
        parts = self.path.split('?')[0].split('/')
        if len(parts) not in (5, 6) or parts[3] != 'jobs':
            return None
        job = jobs.get(parts[4])
        token = self.headers.get('Authorization', '').removeprefix('Bearer ')
        if not job or job.get('cancelled') or time.time() > job['expires']:
            return None
        return job if secrets.compare_digest(token, job['token']) else None

    def do_GET(self):
        if self.path == PREFIX+'/status':
            return self.reply({'available': True, 'engine': 'Apple SHARP', 'device': 'cpu'})
        if self.path.startswith(PREFIX+'/jobs/'):
            job = self.find_job()
            if not job:
                return self.reply({'error': 'This generation has expired. Take another photo.'}, 404)
            if self.path.endswith('/result'):
                if job['state'] != 'ready':
                    return self.reply({'error': 'The splat is not ready.'}, 409)
                path = Path(job['directory'])/'scene.ply'
                try:
                    with path.open('rb') as data:
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/octet-stream')
                        self.send_header('Content-Length', str(path.stat().st_size))
                        self.send_header('Cache-Control', 'no-store')
                        self.end_headers()
                        shutil.copyfileobj(data, self.wfile)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return
            return self.reply({'state': job['state']})
        if self.path.startswith(PREFIX):
            return self.reply({'error': 'Not found'}, 404)
        if getattr(self.server, 'serve_static', False):
            return super().do_GET()
        self.reply({'error': 'Not found'}, 404)

    def do_POST(self):
        if self.path != PREFIX+'/jobs':
            return self.reply({'error': 'Not found'}, 404)
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            length = 0
        if not 0 < length <= MAX_IMAGE:
            return self.reply({'error': 'Choose a photo under 2 MB.'}, 413)
        if self.headers.get('Content-Type') != 'image/jpeg':
            return self.reply({'error': 'Send a JPEG photo.'}, 415)
        photo = self.rfile.read(length)
        try:
            with Image.open(io.BytesIO(photo)) as image:
                if image.format != 'JPEG' or image.width*image.height > 4_000_000:
                    raise ValueError()
                image.verify()
        except Exception:
            return self.reply({'error': 'This photo could not be read.'}, 400)
        if not busy.acquire(blocking=False):
            return self.reply({'error': 'Another photo is being generated. Try again in a minute.'}, 429)
        identifier = secrets.token_hex(16)
        job = {'token': secrets.token_urlsafe(32), 'state': 'queued',
               'expires': time.time()+TTL, 'directory': tempfile.mkdtemp(prefix='sharp-')}
        with lock:
            jobs[identifier] = job
        threading.Thread(target=run_job, args=(job, photo), daemon=True).start()
        self.reply({'id': identifier, 'token': job['token'], 'expiresIn': TTL}, 202)

    def do_DELETE(self):
        job = self.find_job()
        if not job:
            return self.reply({'error': 'Not found'}, 404)
        with lock:
            job['cancelled'] = True
            if job['state'] not in ('queued', 'processing'):
                shutil.rmtree(job['directory'], ignore_errors=True)
        self.reply({'deleted': True})


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--static', type=Path)
    parser.add_argument('--checkpoint', default=checkpoint)
    args = parser.parse_args()
    checkpoint = args.checkpoint
    if args.static:
        os.chdir(args.static)
    threading.Thread(target=reap, daemon=True).start()
    server = ThreadingHTTPServer(('127.0.0.1' if args.static else '0.0.0.0', args.port), Handler)
    server.serve_static = bool(args.static)
    server.serve_forever()
