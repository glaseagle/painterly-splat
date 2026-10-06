"""One disposable inference process releases CPU/GPU memory after each job."""
import argparse
import io
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
import torch
device = 'cpu'
if torch.cuda.is_available() and torch.cuda.mem_get_info()[0] > 10*1024**3:
    device = 'cuda'
print('Running SHARP on '+device, flush=True)
server.checkpoint = args.checkpoint
server.predict(photo, args.output, device)
