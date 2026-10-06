export function installCamera({ openSplat, setBrushMode }) {
  const dialog = document.querySelector('#camera-dialog');
  const video = dialog.querySelector('video');
  const preview = dialog.querySelector('img');
  const message = dialog.querySelector('[role="status"]');
  const start = document.querySelector('#start-camera');
  const capture = document.querySelector('#capture-photo');
  const generate = document.querySelector('#generate-splat');
  const choose = document.querySelector('#choose-photo');
  const input = document.querySelector('#photo-file');
  const download = document.querySelector('#download-splat');
  let stream, photo, photoURL, resultURL, job, controller, available = false, busy = false, epoch = 0;

  function stopCamera() {
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    video.srcObject = null; video.hidden = true; capture.disabled = true;
  }
  function showPhoto(blob) {
    stopCamera();
    if (photoURL) URL.revokeObjectURL(photoURL);
    photo = blob; photoURL = URL.createObjectURL(blob);
    preview.src = photoURL; preview.hidden = false;
    generate.disabled = !available;
    message.textContent = available ? 'Photo ready. Generate to send it for processing.' : 'Photo ready. Generation is awaiting Cloudflare compute setup.';
  }
  async function checkAvailability() {
    try {
      const response = await fetch('/api/painterly/status', { cache: 'no-store' });
      const info = await response.json();
      available = response.ok && info.available;
      message.textContent = info.message || (available ? 'The generator is ready.' : 'Photo generation is currently unavailable.');
    } catch { available = false; message.textContent = 'Photo generation is currently unavailable.'; }
    generate.disabled = !photo || !available || busy;
  }
  async function startCamera() {
    const current = ++epoch;
    stopCamera(); preview.hidden = true; photo = null; generate.disabled = true;
    try {
      const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode:'user', width:{ideal:1280},height:{ideal:960} } });
      if (current !== epoch || !dialog.open) { next.getTracks().forEach(t => t.stop()); return; }
      stream = next; video.srcObject = stream; video.hidden = false;
      await video.play(); capture.disabled = false;
      message.textContent = 'Frame your photo, then capture. Nothing is sent until you choose Generate.';
    } catch (error) {
      if (current !== epoch) return;
      message.textContent = error.name === 'NotAllowedError' ? 'Camera access was denied. Allow it in your browser or choose a photo.' : 'No camera is available. You can choose a photo instead.';
    }
  }
  function jpegFrom(source, width, height) {
    const scale = Math.min(1, 1280/Math.max(width,height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width*scale); canvas.height = Math.round(height*scale);
    canvas.getContext('2d').drawImage(source,0,0,canvas.width,canvas.height);
    return new Promise((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not capture the photo.')), 'image/jpeg', .9));
  }
  document.querySelector('#open-camera').addEventListener('click', async () => {
    dialog.showModal(); message.textContent = 'Use your webcam or choose a photo.';
    await checkAvailability();
  });
  start.addEventListener('click', startCamera);
  capture.addEventListener('click', async () => {
    if (!video.videoWidth) return;
    try { showPhoto(await jpegFrom(video,video.videoWidth,video.videoHeight)); }
    catch (error) { message.textContent = error.message; }
  });
  choose.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files[0]; input.value = '';
    if (!file) return;
    if (file.size > 20*1024*1024) { message.textContent = 'Choose a photo under 20 MB.'; return; }
    const current = ++epoch;
    try {
      const bitmap = await createImageBitmap(file);
      try {
        const blob = await jpegFrom(bitmap,bitmap.width,bitmap.height);
        if (current === epoch && dialog.open) showPhoto(blob);
      } finally { bitmap.close(); }
    } catch { message.textContent = 'Could not read that photo. Choose a JPEG, PNG or WebP image.'; }
  });

  async function api(path, options={}) {
    const response = await fetch('/api/painterly'+path, { ...options, signal:controller.signal, cache:'no-store' });
    if (!response.ok) {
      let text = 'Generation failed. Please try again.';
      try { text = (await response.json()).error || text; } catch {}
      throw new Error(text);
    }
    return response;
  }
  function deleteJob() {
    if (!job) return;
    const previous = job; job = null;
    fetch('/api/painterly/jobs/'+previous.id, { method:'DELETE', headers:{Authorization:'Bearer '+previous.token}, keepalive:true }).catch(() => {});
  }
  generate.addEventListener('click', async () => {
    if (!photo || busy || !available) return;
    busy = true; controller = new AbortController();
    generate.disabled = start.disabled = choose.disabled = true;
    message.textContent = 'Starting Apple SHARP… The first photo can take a few minutes.';
    try {
      job = await (await api('/jobs', { method:'POST', headers:{'Content-Type':'image/jpeg'}, body:photo })).json();
      const headers = { Authorization:'Bearer '+job.token };
      const deadline = Date.now()+8*60*1000;
      while (true) {
        if (Date.now() > deadline) throw new Error('Generation timed out. Please try another photo.');
        const state = await (await api('/jobs/'+job.id,{headers})).json();
        if (state.state === 'failed') throw new Error('SHARP could not generate this photo. Try another image.');
        if (state.state === 'ready') break;
        message.textContent = 'Building your 3D splat with Apple SHARP… You can cancel at any time.';
        await new Promise(resolve => setTimeout(resolve,2000));
        if (controller.signal.aborted) return;
      }
      message.textContent = 'Downloading your splat…';
      const blob = await (await api('/jobs/'+job.id+'/result',{headers})).blob();
      deleteJob();
      if (resultURL) URL.revokeObjectURL(resultURL);
      resultURL = URL.createObjectURL(blob); download.href = resultURL; download.hidden = false;
      message.textContent = 'Applying the painterly effect…';
      await setBrushMode();
      if (!await openSplat(new File([blob],'my-sharp-photo.ply'),true)) throw new Error('The splat was generated but could not open. Use Download splat to save it.');
      dialog.close();
    } catch (error) {
      if (error.name !== 'AbortError') message.textContent = error.message;
    } finally {
      deleteJob(); busy = false; start.disabled = choose.disabled = false;
      generate.disabled = !photo || !available;
    }
  });
  document.querySelector('#close-camera').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    epoch++; stopCamera(); controller?.abort(); deleteJob();
    photo = null; preview.hidden = true; generate.disabled = true;
    if (photoURL) URL.revokeObjectURL(photoURL); photoURL = null; preview.removeAttribute('src');
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { epoch++; stopCamera(); } });
  window.addEventListener('pagehide', () => { stopCamera(); deleteJob(); if(resultURL) URL.revokeObjectURL(resultURL); });
}
