FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 OMP_NUM_THREADS=4 MKL_NUM_THREADS=4
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch==2.10.0 torchvision==0.25.0 --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir timm==1.0.30 'git+https://github.com/apple/ml-sharp.git@aed6527499ef91cba3b54c18d49a870f25947190'
RUN mkdir /models && python -c "import urllib.request; urllib.request.urlretrieve('https://ml-site.cdn-apple.com/models/sharp/sharp_2572gikvuh.pt','/models/sharp.pt')"
WORKDIR /app
COPY server.py /app/server.py
RUN useradd -m sharp
USER sharp
EXPOSE 8080
CMD ["python", "server.py"]
