"""One disposable inference process releases CPU/GPU memory after each job."""
import argparse
import io
import os
import sys
from pathlib import Path
from PIL import Image
import server

parser = argparse.ArgumentParser()
parser.add_argument('--photo', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--checkpoint', required=True)
args = parser.parse_args()
photo = args.photo.read_bytes()
if len(photo) > server.MAX_IMAGE:
    raise ValueError('Photo exceeds size limit')
with Image.open(io.BytesIO(photo)) as image:
    if image.format != 'JPEG' or image.width*image.height > 4_000_000:
        raise ValueError('Invalid photo')
    image.verify()
# Conda's CUDA DLLs are outside site-packages. Configure this child process only;
# do not require an activated terminal or change the machine's PATH.
_dll_handles = []
if os.name == 'nt':
    for directory in [Path(sys.base_prefix)/'Library'/'bin',Path(sys.prefix)/'Library'/'bin']:
        if directory.is_dir():
            os.environ['PATH'] = str(directory)+os.pathsep+os.environ.get('PATH','')
            _dll_handles.append(os.add_dll_directory(str(directory)))
import torch
device = 'cpu'
if torch.cuda.is_available() and torch.cuda.mem_get_info()[0] > 10*1024**3:
    device = 'cuda'
print('Running SHARP on '+device, flush=True)
server.checkpoint = args.checkpoint
server.predict(photo, args.output, device)
