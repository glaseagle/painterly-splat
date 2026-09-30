import * as THREE from 'three';
import { brushFamilies, brushMatchGLSL } from './painterly-brush-matching.js';

const VARIANTS = 4, TILE = 128;
let atlasPromise;

export function createBrushAtlas() {
  if (atlasPromise) return atlasPromise;
  atlasPromise = buildAtlas().catch(e => { atlasPromise = null; throw e; });
  return atlasPromise;
}

async function buildAtlas() {
  const b = window.brush;
  if (!b) throw new Error('p5.brush did not load. Reload to retry.');
  const host = document.createElement('div'); host.id = 'brush-work'; document.body.append(host);
  const canvas = b.createCanvas(256, 128, { parent: host, pixelDensity: 1 });
  b.angleMode(b.RADIANS);
  b.add('scan-dry', { type: 'default', weight: 3, scatter: 1.3, sharpness: .9,
    grain: .35, opacity: 140, spacing: .13, pressure: [1.1, .5] });
  const atlas = document.createElement('canvas'); atlas.width = TILE * VARIANTS; atlas.height = TILE * brushFamilies.length;
  const out = atlas.getContext('2d');
  const scratch = document.createElement('canvas'); scratch.width = 256; scratch.height = 128;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  const swatches = [];
  for (let family = 0; family < brushFamilies.length; family++) {
    for (let variant = 0; variant < VARIANTS; variant++) {
      b.seed(1837 + family * 117 + variant * 31); b.noiseSeed(147 + variant * 43);
      b.clear('#ffffff'); b.noFill(); b.noHatch(); b.noStroke(); b.noField();
      const bend = (variant - 1.5) * 2.7;
      if (family === 0) {
        b.fill('#000000', 150); b.fillBleed(.32, 'out'); b.fillTexture(.65, .6);
        b.polygon(Array.from({ length: 14 }, (_, i) => {
          const a = i * Math.PI / 7, r = 1 + .07 * Math.sin(i * 2.6 + variant);
          return [87 * Math.cos(a) * r, 37 * Math.sin(a) * r];
        }));
      } else if (family === 1) {
        b.set('charcoal', '#000000', 12);
        for (let j = -2; j <= 2; j++) b.spline([[-90, j * 6, .7], [-20, j * 6 + bend, 1.2], [45, j * 5 - bend, 1], [90, j * 4, .45]], .7);
      } else if (family === 2) {
        b.set('marker', '#000000', 14);
        b.spline([[-88, -4, .5], [-25, bend, 1.1], [40, -bend, .95], [87, 3, .6]], .7);
      } else if (family === 3) {
        b.set('scan-dry', '#000000', 1.3);
        for (let j = -3; j <= 3; j++) b.spline([[-94 + Math.abs(j) * 5, j * 3, .55], [-22, j * 3 + bend, 1], [48, j * 3 - bend, .7], [94 - Math.abs(j) * 3, j * 2, .2]], .7);
      } else if (family === 4) {
        b.set('2B', '#000000', 3);
        for (let j = -1; j <= 1; j++) b.spline([[-98, j * 2, .25], [-28, bend + j * 2, 1.1], [35, -bend + j, .8], [97, j, .3]], .65);
      } else {
        b.set('rotring', '#000000', 5);
        b.spline([[-99, 0, .45], [-35, bend * .7, .9], [37, -bend * .5, 1], [99, 0, .2]], .65);
      }
      b.render(); ctx.clearRect(0, 0, 256, 128); ctx.drawImage(canvas, 0, 0);
      const pixels = ctx.getImageData(0, 0, 256, 128);
      let left = 256, top = 128, right = 0, bottom = 0, maximum = 0;
      for (let i = 0; i < pixels.data.length; i += 4) {
        const alpha = 255 - pixels.data[i]; maximum = Math.max(maximum, alpha);
        if (alpha > 8) { const x = (i / 4) % 256, y = Math.floor(i / 1024); left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255; pixels.data[i + 3] = alpha;
      }
      if (right <= left || bottom <= top) throw new Error(`Empty ${brushFamilies[family].name} brush`);
      for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = Math.min(255, pixels.data[i] * 255 / maximum);
      ctx.putImageData(pixels, 0, 0);
      out.drawImage(scratch, left, top, right - left + 1, bottom - top + 1, variant * TILE + 5, family * TILE + 5, TILE - 10, TILE - 10);
      if (variant === 0) {
        const swatch = document.createElement('canvas'); swatch.width = 96; swatch.height = 32;
        const sw = swatch.getContext('2d'); sw.drawImage(scratch, left, top, right-left+1, bottom-top+1, 3, 3, 90, 26);
        sw.globalCompositeOperation = 'source-in'; sw.fillStyle = '#b3a38e'; sw.fillRect(0, 0, 96, 32);
        swatches.push(swatch);
      }
      // Yield between marks so loading doesn't block navigation or controls.
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }
  host.remove();
  const texture = new THREE.CanvasTexture(atlas);
  texture.flipY = false;
  texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
  const legend = document.querySelector('#brush-palette');
  legend.replaceChildren(...brushFamilies.map((family, i) => {
    const item = document.createElement('span'); item.append(swatches[i], document.createTextNode(family.name)); return item;
  }));
  legend.dataset.brushFamilies = String(brushFamilies.length);
  legend.dataset.variants = String(VARIANTS * brushFamilies.length);
  return texture;
}

export function installBrushMaterial(viewer, texture, mode, size) {
  const material = viewer.splatMesh.material;
  const alphaLine = 'float opacity = exp(-0.5 * A) * vColor.a;';
  const basisLine = 'vec2 ndcOffset = vec2(vPosition.x * basisVector1 + vPosition.y * basisVector2) *';
  if (!material.fragmentShader.includes(alphaLine) || !material.vertexShader.includes(basisLine)) throw new Error('Unsupported splat shader version');
  material.uniforms.pigmentMap = { value: texture || null };
  material.uniforms.brushMix = { value: mode === 'brush' ? 1 : mode === 'hybrid' ? .65 : 0 };
  material.uniforms.markSize = { value: size };
  const declarations = 'uniform float brushMix;\nuniform float markSize;\nvarying vec4 vBrush;\n';
  material.vertexShader = declarations + brushMatchGLSL() + '\n' + material.vertexShader.replace(basisLine, `
    float major = length(basisVector1);
    float minor = length(basisVector2);
    float luma = dot(vColor.rgb, vec3(0.299, 0.587, 0.114));
    float family = matchBrush(major / max(minor, 0.1), minor, vColor.a, luma);
    // Integer hash stays attached to the Gaussian even when the sort order changes.
    uint h = splatIndex * 1664525u + 1013904223u;
    h ^= h >> 16u; h *= 2246822519u; h ^= h >> 13u;
    float seed = float(h & 65535u) / 65535.0;
    float variant = float((h >> 16u) & 3u);
    float target = mix(5.0, 23.0, markSize) * mix(0.7, 1.3, seed);
    float strokeMajor = min(120.0, max(major, target));
    float strokeMinor = min(55.0, max(minor, strokeMajor / max(1.3, major / max(minor, 0.1))));
    float keep = clamp((major * minor) / max(1.0, strokeMajor * strokeMinor), 0.012, 1.0);
    // Enlarge a stable, area-weighted set of marks so individual strokes read at
    // screen scale. Other Gaussians remain as a translucent watercolor ground.
    float selected = step(seed, keep);
    float enlarge = brushMix * selected;
    basisVector1 *= mix(1.0, strokeMajor / max(major, 0.1), enlarge);
    basisVector2 *= mix(1.0, strokeMinor / max(minor, 0.1), enlarge);
    vBrush = vec4(family, variant, selected, seed);
    ${basisLine}`);
  material.fragmentShader = declarations + 'uniform sampler2D pigmentMap;\n' + material.fragmentShader
    .replace('if (A > 8.0) discard;', 'if (A > 8.0 && brushMix < 0.01) discard;')
    .replace(alphaLine, `
      float gaussian = exp(-0.5 * A);
      float opacity = gaussian * vColor.a;
      if (brushMix > 0.0) {
        vec2 uv = clamp(vPosition / 5.656854 + 0.5, 0.002, 0.998);
        vec2 atlasUV = (vec2(vBrush.y, vBrush.x) + uv) / vec2(4.0, 6.0);
        float pigment = texture2D(pigmentMap, atlasUV).a;
        float edge = smoothstep(0.0, 0.025, min(min(uv.x, uv.y), min(1.0-uv.x, 1.0-uv.y)));
        float stroke = pow(pigment, 0.65) * edge;
        // Fine lines are decisive; broad pigment stays translucent.
        float strength = vBrush.x < 0.5 ? 0.6 : (vBrush.x > 3.5 ? 1.0 : 0.84);
        float painted = mix(gaussian * 0.20, stroke * strength, vBrush.z) * vColor.a;
        opacity = mix(opacity, painted, brushMix);
        vec3 paper = vec3(0.95, 0.92, 0.85);
        vec3 paint = floor(color * 22.0 + 0.5) / 22.0;
        paint = mix(paint, paper, vBrush.z > 0.5 ? 0.06 : 0.22);
        color = mix(color, paint, brushMix);
      }
    `);
  material.needsUpdate = true;
}
