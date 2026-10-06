import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
import urllib.request
from urllib.error import HTTPError
from unittest.mock import patch
from PIL import Image

spec = importlib.util.spec_from_file_location('sharp_server', Path(__file__).with_name('server.py'))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

class JobsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = server.ThreadingHTTPServer(('127.0.0.1',0), server.Handler)
        threading.Thread(target=cls.http.serve_forever,daemon=True).start()
        cls.url = f'http://127.0.0.1:{cls.http.server_port}/api/painterly'
        data = io.BytesIO()
        Image.new('RGB',(32,32),'blue').save(data,format='JPEG')
        cls.photo = data.getvalue()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()

    def request(self,path,method='GET',body=None,token=None):
        headers = {'Content-Type':'image/jpeg'}
        if token: headers['Authorization'] = 'Bearer '+token
        req = urllib.request.Request(self.url+path,data=body,headers=headers,method=method)
        try: response = urllib.request.urlopen(req)
        except HTTPError as error: response = error
        return response.status, response.read()

    def test_unreadable_photo_rejected_before_inference(self):
        self.assertEqual(self.request('/jobs','POST',b'not-a-jpeg')[0],400)
        self.assertEqual(self.request('/jobs','POST',bytes(server.MAX_IMAGE+1))[0],413)

    def test_private_job_result_cancel_and_single_inference(self):
        started = threading.Event()
        finish = threading.Event()
        def fake_predict(photo,path):
            self.assertEqual(photo,self.photo)
            started.set(); finish.wait(5); path.write_bytes(b'ply-test-result')
        with patch.object(server,'predict',fake_predict):
            status,data = self.request('/jobs','POST',self.photo)
            self.assertEqual(status,202)
            job = json.loads(data); started.wait(5)
            path = '/jobs/'+job['id']; token = job['token']
            try:
                self.assertEqual(self.request(path)[0],404)
                self.assertEqual(self.request(path,token='wrong')[0],404)
                self.assertEqual(self.request(path+'/result',token=token)[0],409)
                self.assertEqual(self.request('/jobs','POST',self.photo)[0],429)
            finally: finish.set()
            for _ in range(100):
                if server.jobs[job['id']]['state'] == 'ready': break
                time.sleep(.01)
            self.assertEqual(self.request(path+'/result',token=token),(200,b'ply-test-result'))
            directory = server.jobs[job['id']]['directory']
            self.assertEqual(self.request(path,'DELETE',token=token)[0],200)
            self.assertFalse(Path(directory).exists())
            self.assertEqual(self.request(path+'/result',token=token)[0],404)

    def test_expired_job_cannot_be_downloaded(self):
        with tempfile.TemporaryDirectory() as directory:
            server.jobs['expired'] = {'token':'secret','expires':time.time()-1,'state':'ready','directory':directory}
            self.assertEqual(self.request('/jobs/expired/result',token='secret')[0],404)

if __name__ == '__main__': unittest.main()
