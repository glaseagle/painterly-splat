import * as THREE from 'three';
import { brushFamilies } from './painterly-brush-matching.js?v=brushes-2';
import { createBrushAtlas, installBrushMaterial } from './painterly-brushes.js?v=brushes-2';
import { createPainterlyGuidance } from './painterly-guidance.js?v=ribbons-1';
import { prepareLocalSplat, normalizeImport, framedImportCamera } from './painterly-upload.js?v=fit-3';
import { installCamera } from './painterly-camera.js?v=local-3';
import { FlyControls } from './vendor/three/FlyControls.js';
import { createTouchControls } from './painterly-touch.js?v=upload-1';
import { Viewer, RenderMode, SceneRevealMode, PlyLoader, SplatLoader, KSplatLoader } from './vendor/gaussian-splats-3d/gaussian-splats-3d.module.js';

const wrap = document.querySelector('#canvas-wrap');
const status = document.querySelector('#render-status');
const loading = document.querySelector('#loading-message');
const error = document.querySelector('#error');
const count = document.querySelector('#scene-count');
const source = document.querySelector('#scene-source');
const note = document.querySelector('#view-note');
const density = document.querySelector('#density');
const guidance = document.querySelector('#guidance');
const variation = document.querySelector('#variation');
const strokeDensity = document.querySelector('#stroke-density');
const brushSet = document.querySelector('#brush-set');
const enabledBrushes = brushFamilies.map(() => 1);
function updateBrushSelection() {
  document.querySelectorAll('[data-brush]').forEach(button => button.setAttribute('aria-pressed',String(Boolean(enabledBrushes[Number(button.dataset.brush)]))));
  document.querySelector('#brush-count').textContent = `${enabledBrushes.filter(Boolean).length} selected`;
  if (ready) viewer.splatMesh.material.uniforms.brushEnabled.value = [...enabledBrushes];
  viewer?.forceRenderNextFrame();
}
brushSet.addEventListener('change', () => {
  brushFamilies.forEach((b,i) => { enabledBrushes[i] = Number(brushSet.value === 'all' || b.group === brushSet.value); });
  updateBrushSelection();
});
document.querySelector('#brush-palette').addEventListener('click', event => {
  const button = event.target.closest('[data-brush]');
  if (!button) return;
  const index = Number(button.dataset.brush);
  if (enabledBrushes[index] && enabledBrushes.filter(Boolean).length === 1) return;
  enabledBrushes[index] = 1-enabledBrushes[index]; brushSet.value = 'custom';
  updateBrushSelection();
});
const ribbons = document.querySelector('#ribbons');
const openSplat = document.querySelector('#open-splat');
const splatFile = document.querySelector('#splat-file');
const uploadStatus = document.querySelector('#upload-status');
const sceneButtons = [...document.querySelectorAll('[data-scene]')];
let manifest, viewer, camera, renderer, controls, touchControls, scene, mode = 'brush';
let ready = false, lastTick = performance.now();
let drag = null, loadingScene = false;
let sortPending = false, lastSort = 0;
let painterlyGuidance;
const basis = new THREE.Matrix4();
const yawRotation = new THREE.Quaternion();
const pitchRotation = new THREE.Quaternion();
const worldUp = new THREE.Vector3();
const localRight = new THREE.Vector3(1, 0, 0);

function makeTouchControls() {
  return createTouchControls(camera, wrap, changed, scene.local ? {
    distance: scene.viewDistance, minDistance: Math.max(0.005, scene.viewDistance*0.01),
    maxDistance: Math.max(8, scene.viewDistance*8),
  } : {});
}

// The renderer owns covariance projection, blending, visibility, and worker sorting.
// Capture cameras are transformed into the trained model's coordinate system offline.
function resetCamera() {
  const c = scene.captureCamera;
  const R = c.rotation;
  camera.position.fromArray(c.position);
  // COLMAP camera coordinates: right, down, forward. Three.js: right, up, backward.
  basis.set(R[0][0], -R[0][1], -R[0][2], 0,
            R[1][0], -R[1][1], -R[1][2], 0,
            R[2][0], -R[2][1], -R[2][2], 0, 0, 0, 0, 1);
  camera.quaternion.setFromRotationMatrix(basis);
  worldUp.set(-R[0][1], -R[1][1], -R[2][1]).normalize();
  camera.up.copy(worldUp);
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(c.height / (2 * c.fy)));
  resize();
  if (touchControls) { touchControls.dispose(); touchControls = makeTouchControls(); }
  changed();
}

function resize() {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (!camera) return;
  renderer?.setSize(w, h);
  camera.aspect = w / h;
  const c = scene.captureCamera;
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.max(c.height / (2 * c.fy), c.width / (2 * c.fx * camera.aspect))));
  camera.updateProjectionMatrix();
  viewer?.forceRenderNextFrame();
}

function changed() {
  if (!camera) return;
  camera.updateMatrixWorld(true);
  sortPending = true;
  wrap.dataset.cameraPosition = camera.position.toArray().map(v => v.toFixed(5)).join(',');
  wrap.dataset.cameraRotation = camera.quaternion.toArray().map(v => v.toFixed(5)).join(',');
  viewer?.forceRenderNextFrame();
}

function clearMovement() {
  drag = null;
  if (!controls || !ready) return;
  // FlyControls has no public reset method. Reconnecting releases all held input state.
  controls.dispose();
  controls = makeControls();
  controls.enabled = ready;
  touchControls?.dispose();
  touchControls = makeTouchControls();
  touchControls.enabled = ready;
  drag = null;
}

function makeControls() {
  const fly = new FlyControls(camera, wrap);
  fly.dragToLook = true;
  fly.movementSpeed = scene.moveSpeed ?? (scene.id === 'train' ? .35 : .25);
  fly.rollSpeed = .65;
  // Keep upstream WASD / RF / arrow keyboard handling. Use relative mouse deltas
  // instead of FlyControls' cursor-offset joystick for predictable drag-to-look.
  wrap.removeEventListener('pointermove', fly._onPointerMove);
  wrap.removeEventListener('pointerdown', fly._onPointerDown);
  wrap.removeEventListener('pointerup', fly._onPointerUp);
  wrap.removeEventListener('pointercancel', fly._onPointerCancel);
  window.removeEventListener('keydown', fly._onKeyDown);
  const keyDown = e => {
    if (document.activeElement !== wrap || !ready || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) return;
    e.preventDefault();
    fly._onKeyDown(e);
    // Respond to a short tap as well as held keys; subsequent motion uses frame time.
    if (!e.repeat) fly.update(1 / 60);
  };
  window.addEventListener('keydown', keyDown);
  const dispose = fly.dispose.bind(fly);
  fly.dispose = () => { window.removeEventListener('keydown', keyDown); dispose(); };
  fly.addEventListener('change', changed);
  return fly;
}

async function loadScene(id, local = null) {
  if (loadingScene) return;
  loadingScene = true; ready = false;
  sceneButtons.forEach(b => { b.disabled = true; });
  openSplat.disabled = true;
  loading.hidden = false;
  loading.textContent = 'Loading full scan…';
  status.textContent = 'Loading'; error.style.display = 'none';
  try {
    controls?.dispose(); controls = null;
    touchControls?.dispose(); touchControls = null;
    painterlyGuidance?.dispose(); painterlyGuidance = null;
    if (viewer) await viewer.dispose();
    scene = local || manifest.scenes.find(s => s.id === id);
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
      renderer.setPixelRatio(1);
      wrap.append(renderer.domElement);
    }
    renderer.setClearColor(mode === 'brush' ? 0xf3eddd : 0x0b0b0a, 1);
    camera = new THREE.PerspectiveCamera(50, wrap.clientWidth / wrap.clientHeight, .01, 2000);
    viewer = new Viewer({
      rootElement: wrap, camera, renderer, useBuiltInControls: false,
      selfDrivenMode: false, sharedMemoryForWorkers: false,
      gpuAcceleratedSort: false, integerBasedSort: true,
      renderMode: RenderMode.OnChange, sceneRevealMode: SceneRevealMode.Instant,
      ignoreDevicePixelRatio: true, sphericalHarmonicsDegree: 0,
      freeIntermediateSplatData: true
    });
    resetCamera();
    controls = makeControls();
    controls.enabled = false;
    if (scene.local) {
      await viewer.addSplatBuffers([scene.buffer], [{ ...scene.transform, splatAlphaRemovalThreshold: 1 }], true, false, false);
      scene.buffer = null;
      controls.movementSpeed = scene.moveSpeed;
      camera.near = .001;
      camera.far = Math.max(100, scene.viewDistance*20);
      resetCamera();
    } else await viewer.addSplatScene(scene.fullAsset, {
      showLoadingUI: false, splatAlphaRemovalThreshold: 0,
      onProgress: (percent) => {
        loading.textContent = Number.isFinite(percent) ? `Loading full scan · ${Math.round(percent)}%` : 'Preparing full scan…';
      }
    });
    painterlyGuidance = createPainterlyGuidance(renderer, viewer.splatMesh);
    installBrushMaterial(viewer, brushTexture, mode, Number(density.value) / 100);
    viewer.splatMesh.material.uniforms.guideMap.value = painterlyGuidance.texture;
    viewer.splatMesh.material.uniforms.guideReference.value = painterlyGuidance.reference;
    viewer.splatMesh.material.uniforms.guideColor.value = painterlyGuidance.color;
    viewer.splatMesh.material.uniforms.ribbonStrength.value = Number(ribbons.value) / 100;
    viewer.splatMesh.material.uniforms.guideStrength.value = Number(guidance.value) / 100;
    viewer.splatMesh.material.uniforms.sizeVariation.value = Number(variation.value)/100;
    viewer.splatMesh.material.uniforms.strokeDensity.value = Number(strokeDensity.value)/100;
    ready = true; controls.enabled = true;
    updateBrushSelection();
    touchControls = makeTouchControls();
    sceneButtons.forEach(b => {
      const active = b.dataset.scene === id;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    source.textContent = scene.detail;
    source.title = scene.detail;
    if (scene.sourceUrl) source.href = scene.sourceUrl;
    else source.removeAttribute('href');
    document.querySelector('#source-type').textContent = scene.local ? 'Your local splat' : 'Public scan study';
    const total = viewer.splatMesh.getSplatCount();
    count.textContent = total >= 1000 ? `${(total / 1000).toFixed(0)}K GS` : `${total} GS`;
    wrap.dataset.splatCount = String(viewer.splatMesh.getSplatCount());
    wrap.dataset.scene = id;
    status.textContent = 'Ready'; loading.hidden = true;
    document.querySelector('#flip-upright').hidden = !scene.local;
    document.querySelector('#import-frame-control').hidden = !scene.local;
    uploadStatus.textContent = scene.local ? (scene.generated ? 'SHARP splat · centered and scaled' : 'Centered and scaled · file stays on this device') : '.ply · .splat · .ksplat — stays on your device';
    changed();
    return true;
  } catch (e) {
    console.error(e);
    status.textContent = 'Error'; loading.hidden = true;
    error.textContent = `Could not load this scan: ${e.message}. Choose another file or a bundled scene.`;
    error.style.display = 'block';
    return false;
  } finally {
    loadingScene = false;
    sceneButtons.forEach(b => { b.disabled = false; });
    openSplat.disabled = false;
  }
}

let brushTexture, modeRequest = 0;

function updateViewNote() {
  note.textContent = mode === 'splat' ? 'Full scan · fly camera'
    : Number(guidance.value) > 0 ? 'Contour-guided marks · still when you stop'
    : 'Original brush marks · still when you stop';
}

async function setMode(next) {
  const request = ++modeRequest;
  if (next !== 'splat') {
    note.textContent = `Mixing ${brushFamilies.length} brush families…`;
    try { brushTexture = await createBrushAtlas(); }
    catch (e) { error.textContent = e.message; error.style.display = 'block'; return; }
  }
  if (request !== modeRequest) return;
  mode = next;
  document.querySelector('#brush-palette').hidden = mode === 'splat';
  document.querySelector('#brush-options').hidden = mode === 'splat';
  updateBrushSelection();
  renderer?.setClearColor(mode === 'brush' ? 0xf3eddd : 0x0b0b0a, 1);
  document.querySelectorAll('[data-mode]').forEach(b => {
    const active = b.dataset.mode === mode;
    b.classList.toggle('is-active', active); b.setAttribute('aria-pressed', String(active));
  });
  density.disabled = variation.disabled = strokeDensity.disabled = mode === 'splat';
  guidance.disabled = mode === 'splat';
  ribbons.disabled = mode === 'splat' || Number(guidance.value) === 0;
  if (viewer?.splatMesh?.material?.uniforms.brushMix) {
    viewer.splatMesh.material.uniforms.brushMix.value = mode === 'brush' ? 1 : mode === 'hybrid' ? .65 : 0;
    viewer.splatMesh.material.uniforms.pigmentMap.value = brushTexture;
  }
  updateViewNote();
  changed();
}

wrap.addEventListener('pointerdown', e => {
  if (!ready) return;
  wrap.focus({ preventScroll: true });
  if (e.pointerType === 'touch') return;
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  wrap.setPointerCapture(e.pointerId);
});
wrap.addEventListener('pointermove', e => {
  if (!drag || drag.id !== e.pointerId) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  yawRotation.setFromAxisAngle(worldUp, -dx * .0025);
  pitchRotation.setFromAxisAngle(localRight, -dy * .0025);
  camera.quaternion.premultiply(yawRotation).multiply(pitchRotation).normalize();
  changed();
});
function endDrag(e) {
  if (e.pointerType === 'touch') return;
  if (wrap.hasPointerCapture(e.pointerId)) wrap.releasePointerCapture(e.pointerId);
  drag = null;
}
wrap.addEventListener('pointerup', endDrag);
wrap.addEventListener('pointercancel', endDrag);
wrap.addEventListener('wheel', e => {
  if (!ready) return;
  e.preventDefault(); camera.translateZ(e.deltaY * controls.movementSpeed * .0015); changed();
}, { passive: false });
window.addEventListener('blur', clearMovement);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearMovement(); });
window.addEventListener('resize', resize);
document.querySelector('#reset-view').addEventListener('click', () => { if (ready) { clearMovement(); resetCamera(); } });
density.addEventListener('input', () => {
  document.querySelector('output[for="density"]').value = density.value;
  if (ready) viewer.splatMesh.material.uniforms.markSize.value = Number(density.value) / 100;
  viewer?.forceRenderNextFrame();
});
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
sceneButtons.forEach(b => b.addEventListener('click', () => loadScene(b.dataset.scene)));
openSplat.addEventListener('click', () => splatFile.click());
splatFile.addEventListener('change', async () => {
  const file = splatFile.files[0];
  splatFile.value = '';
  if (file) await openLocalFile(file);
});
async function openLocalFile(file, generated = false) {
  if (!file || loadingScene) return;
  openSplat.disabled = true;
  sceneButtons.forEach(b => { b.disabled = true; });
  uploadStatus.textContent = `Checking ${file.name}…`;
  try {
    const prepared = await prepareLocalSplat(file);
    const data = await prepared.blob.arrayBuffer();
    const loader = { ply: PlyLoader, splat: SplatLoader, ksplat: KSplatLoader }[prepared.extension];
    const buffer = await loader.loadFromFileData(data, 1, 0, false, 0);
    const points = [], radii = [], point = new THREE.Vector3(), color = new THREE.Vector4();
    const gaussianScale = new THREE.Vector3(), gaussianRotation = new THREE.Quaternion();
    const total = buffer.getSplatCount(), stride = Math.max(1, Math.floor(total/8192));
    for (let i = 0; i < total; i += stride) {
      buffer.getSplatColor(i, color);
      if (color.w < 8) continue;
      buffer.getSplatCenter(i, point);
      points.push(point.toArray());
      buffer.getSplatScaleAndRotation(i, gaussianScale, gaussianRotation);
      radii.push(3*Math.max(gaussianScale.x,gaussianScale.y,gaussianScale.z));
    }
    const fit = normalizeImport(points, prepared.camera, radii, Number(document.querySelector('#import-frame').value)/100);
    return await loadScene('local', {
      id: 'local', local: true, generated, buffer,
      transform: { position: fit.position, scale: fit.scale },
      fileCamera: prepared.camera, captureCamera: fit.camera,
      viewDistance: fit.distance, moveSpeed: .3, detail: file.name,
    });
  } catch (e) {
    uploadStatus.textContent = e.message;
    return false;
  } finally {
    openSplat.disabled = false;
    sceneButtons.forEach(b => { b.disabled = false; });
  }
}
document.querySelector('#flip-upright').addEventListener('click', () => {
  if (!ready || !scene.local) return;
  // A file without camera metadata cannot declare its up axis. Keep a manual roll correction.
  scene.captureCamera.rotation = scene.captureCamera.rotation.map(([x,y,z]) => [-x,-y,z]);
  resetCamera();
});
document.querySelector('#import-frame').addEventListener('input', e => {
  document.querySelector('output[for="import-frame"]').value = e.target.value;
  if (!ready || !scene.local) return;
  scene.captureCamera = framedImportCamera(scene.captureCamera, Number(e.target.value)/100);
  scene.viewDistance = Math.hypot(...scene.captureCamera.position);
  resetCamera();
});

const menuButton = document.querySelector('#menu-toggle');
const panel = document.querySelector('#render-controls');
const scrim = document.querySelector('#menu-scrim');
const mobile = matchMedia('(max-width: 700px), (pointer: coarse) and (max-height: 600px)');
function setMenu(open) {
  panel.classList.toggle('is-open', open);
  panel.inert = mobile.matches && !open;
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Close options' : 'Open options');
  scrim.hidden = !open || !mobile.matches;
  if (open) clearMovement();
}
menuButton.addEventListener('click', () => setMenu(menuButton.getAttribute('aria-expanded') !== 'true'));
scrim.addEventListener('click', () => setMenu(false));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && mobile.matches && menuButton.getAttribute('aria-expanded') === 'true') {
    setMenu(false); menuButton.focus();
  }
});
for (const [control, uniform] of [[variation, 'sizeVariation'], [strokeDensity, 'strokeDensity']]) {
  control.addEventListener('input', () => {
    document.querySelector(`output[for="${control.id}"]`).value = control.value;
    if (ready) viewer.splatMesh.material.uniforms[uniform].value = Number(control.value)/100;
    viewer?.forceRenderNextFrame();
  });
}
guidance.addEventListener('input', () => {
  document.querySelector('output[for="guidance"]').value = guidance.value;
  if (ready) viewer.splatMesh.material.uniforms.guideStrength.value = Number(guidance.value) / 100;
  updateViewNote();
  ribbons.disabled = mode === 'splat' || Number(guidance.value) === 0;
  viewer?.forceRenderNextFrame();
});
ribbons.addEventListener('input', () => {
  document.querySelector('output[for="ribbons"]').value = ribbons.value;
  if (ready) viewer.splatMesh.material.uniforms.ribbonStrength.value = Number(ribbons.value) / 100;
  viewer?.forceRenderNextFrame();
});
mobile.addEventListener('change', () => setMenu(false));
setMenu(false);
installCamera({ openSplat: openLocalFile, setBrushMode: () => setMode('brush') });

function tick(now) {
  const dt = Math.min(.05, (now - lastTick) / 1000); lastTick = now;
  if (ready && !document.hidden) {
    controls.update(dt);
    camera.updateMatrixWorld(true);
    // These trained scenes use normalized units; refresh ordering for small moves
    // as well as the viewer's default one-unit translation threshold.
    if (sortPending && !viewer.sortRunning && now - lastSort > 80) {
      viewer.runSplatSort(true);
      sortPending = false;
      lastSort = now;
    }
    viewer.update();
    // Instant reveal has no animation; don't keep rendering an invisible fade.
    viewer.splatMesh.visibleRegionChanging = false;
    if (viewer.shouldRender()) {
      if (mode !== 'splat' && Number(guidance.value) > 0) {
        painterlyGuidance.render(camera, wrap.clientWidth, wrap.clientHeight);
      }
      viewer.splatMesh.material.uniforms.ribbonViewport.value.set(wrap.clientWidth, wrap.clientHeight);
      viewer.render();
      wrap.dataset.frames = String(renderer.info.render.frame);
      wrap.dataset.renderedSplats = String(viewer.splatMesh.geometry.instanceCount);
    }
    viewer.renderNextFrame = false;
  }
  requestAnimationFrame(tick);
}

try {
  const response = await fetch('painterly-scans/manifest.json?v=full-2');
  if (!response.ok) throw new Error('Scan index unavailable');
  manifest = await response.json();
  await setMode('brush');
  if (!brushTexture) throw new Error(error.textContent || 'Could not prepare brushes.');
  requestAnimationFrame(tick);
  await loadScene('train');
} catch (e) {
  loading.hidden = true; error.style.display = 'block'; error.textContent = e.message;
}
