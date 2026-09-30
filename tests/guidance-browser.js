import * as THREE from 'three';
import { createGuideAnalysis } from '../painterly-guidance.js';

const renderer = new THREE.WebGLRenderer();
let passed = 0, failed = 0;
function check(name, run) {
  const item = document.createElement('li');
  try { run(); item.textContent = `PASS: ${name}`; passed++; }
  catch (error) { item.textContent = `FAIL: ${name}: ${error.message}`; item.className = 'fail'; failed++; }
  document.querySelector('#results').append(item);
}
function assert(value, message) { if (!value) throw new Error(message); }
const types = [THREE.UnsignedByteType];
if (renderer.extensions.has('EXT_color_buffer_float')) types.push(THREE.HalfFloatType);
for (const type of types) {
  const size = 64;
  const pixels = new Float32Array(size*size*4);
  const input = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat, THREE.FloatType);
  const analysis = createGuideAnalysis(renderer, input, type);
  analysis.resize(size, size);
  function render(makePixel) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const [luma, depth = 0.1, coverage = 1] = makePixel(x, y);
      pixels.set([luma*coverage, depth*coverage, 0, coverage], (y*size+x)*4);
    }
    input.needsUpdate = true;
    analysis.render();
    const result = type === THREE.HalfFloatType ? new Uint16Array(size*size*4) : new Uint8Array(size*size*4);
    renderer.readRenderTargetPixels(analysis.target, 0, 0, size, size, result);
    return Array.from(result, v => type === THREE.HalfFloatType ? THREE.DataUtils.fromHalfFloat(v) : v/255);
  }
  const pixel = (image, x, y) => image.slice((y*size+x)*4, (y*size+x)*4+4);
  const label = type === THREE.HalfFloatType ? 'half float' : 'byte fallback';
  check(`${label}: uniform regions keep the original orientation and have no detail`, () => {
    const p = pixel(render(() => [0.5]), 32, 32);
    assert(p[2] < 0.01 && p[3] < 0.01, `confidence/detail ${p.slice(2)}`);
  });
  check(`${label}: vertical edges yield vertical strokes and finer detail`, () => {
    const p = pixel(render(x => [x < 32 ? 0.2 : 0.8]), 31, 32);
    assert(p[0] < 0.05 && p[2] > 0.5 && p[3] > 0.3, `guide ${p}`);
  });
  check(`${label}: horizontal edges yield horizontal strokes`, () => {
    const p = pixel(render((x, y) => [y < 32 ? 0.2 : 0.8]), 32, 31);
    assert(p[0] > 0.95 && p[2] > 0.5, `guide ${p}`);
  });
  check(`${label}: diagonal contours keep their tangent`, () => {
    const p = pixel(render((x, y) => [x+y < 64 ? 0.2 : 0.8]), 32, 32);
    assert(Math.abs(p[0]-0.5) < 0.05 && p[1] < 0.05 && p[2] > 0.5, `guide ${p}`);
  });
  check(`${label}: a depth boundary prevents a neighboring surface steering the contour`, () => {
    const p = pixel(render((x,y) => x < 32 ? [Math.max(0, Math.min(1, 0.5+(x-32)*0.08)), 0.05]
      : [Math.max(0, Math.min(1, 0.5+(y-32)*0.08)), 0.2]), 31, 32);
    assert(p[0] < 0.08 && p[2] > 0.45, `guide ${p}`);
  });
  check(`${label}: uncovered pixels cannot create contours`, () => {
    const p = pixel(render(x => [x%2, 0.1, 0]), 32, 32);
    assert(p[2] < 0.01 && p[3] < 0.01, `guide ${p}`);
  });
  check(`${label}: stationary input is exactly deterministic`, () => {
    const fixture = (x,y) => [(Math.sin(x*0.4)+Math.cos(y*0.3)+2)*0.25];
    const a = render(fixture), b = render(fixture);
    assert(a.every((v,i) => v === b[i]), 'identical views changed');
  });
  check(`${label}: resizing keeps the guide usable`, () => {
    analysis.resize(32, 16);
    analysis.render();
    assert(analysis.target.width === 32 && analysis.target.height === 16, 'wrong size');
    const result = type === THREE.HalfFloatType ? new Uint16Array(32*16*4) : new Uint8Array(32*16*4);
    renderer.readRenderTargetPixels(analysis.target, 0, 0, 32, 16, result);
    assert(result.some(v => v > 0), 'empty resized guide');
  });
  analysis.dispose(); input.dispose();
}
renderer.dispose();
document.querySelector('#status').textContent = `${passed} passed, ${failed} failed`;
document.title = `${failed ? 'FAIL' : 'PASS'} — Painterly guidance GPU regressions`;
