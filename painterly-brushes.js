import * as THREE from 'three';
import { brushFamilies, brushMatchGLSL, BRUSH_VARIANTS, strokeSizingGLSL } from './painterly-brush-matching.js?v=brushes-2';
import { ribbonVaryings, ribbonTraceGLSL, ribbonFragmentGLSL } from './painterly-ribbons.js?v=ribbons-1';

const VARIANTS = BRUSH_VARIANTS, TILE = 128;
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
  b.add('scan-bristle', { type: 'default', weight: 2, scatter: .35, sharpness: .95,
    grain: .18, opacity: 190, spacing: .18, pressure: [.25, 1.2, .4] });
  b.add('scan-scumble', { type: 'default', weight: 5, scatter: 2, sharpness: .4,
    grain: .22, opacity: 110, spacing: .3, pressure: [.4, 1, .35] });
  b.add('scan-flat', { type: 'marker', weight: 5, scatter: .1, opacity: 170, spacing: .08, pressure: [.6, 1.1, .6] });
  const atlas = document.createElement('canvas'); atlas.width = TILE * VARIANTS; atlas.height = TILE * brushFamilies.length;
  const out = atlas.getContext('2d');
  const scratch = document.createElement('canvas'); scratch.width = 256; scratch.height = 128;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  const swatches = [];
  for (let family = 0; family < brushFamilies.length; family++) {
    for (let variant = 0; variant < VARIANTS; variant++) {
      b.seed(1837 + family * 117 + variant * 31); b.noiseSeed(147 + variant * 43);
      b.clear('#ffffff'); b.noFill(); b.noHatch(); b.noStroke(); b.noField();
      const descriptor = brushFamilies[family], tool = descriptor.tool;
      const bend = (variant - 3.5) * 2.2;
      const pressure = .7 + (variant % 3) * .22;
      if (tool === 'wash' || tool === 'wet-wash') {
        b.fill('#000000', tool === 'wet-wash' ? 95 : 150);
        b.fillBleed(tool === 'wet-wash' ? .55 : .32, 'out'); b.fillTexture(.65, .6);
        b.polygon(Array.from({ length: 18 }, (_, i) => {
          const a = i * Math.PI / 9, r = 1 + .1 * Math.sin(i * 2.6 + variant);
          return [87 * Math.cos(a) * r, 37 * Math.sin(a) * r];
        }));
      } else {
        b.set(tool === 'hatching' ? 'pen' : tool, '#000000', descriptor.weight * (.85 + variant * .045));
        const strands = tool === 'charcoal' ? 5 : tool === 'scan-dry' ? 7 :
          tool === 'scan-bristle' ? 9 : tool === 'hatching' ? 7 : tool === 'scan-scumble' ? 7 : 1;
        for (let j = 0; j < strands; j++) {
          const y = (j-(strands-1)/2) * (tool === 'hatching' ? 8 : tool === 'charcoal' ? 6 : 3);
          if (tool === 'hatching') b.line(-85, y-10, 85, y+10);
          else b.spline([[-94+Math.abs(y)*.25, y, .25+variant*.025],
            [-28, y+bend, pressure], [40, y-bend*.7, .8], [94-Math.abs(y)*.3, y*.8, .2]], .7);
        }
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
    const item = document.createElement('button'); item.type = 'button';
    item.dataset.brush = String(i); item.setAttribute('aria-pressed', 'true');
    item.title = `Include ${family.name} when matching Gaussian shapes`;
    item.append(swatches[i], document.createTextNode(family.name)); return item;
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
  material.uniforms.sizeVariation = { value: .85 };
  material.uniforms.strokeDensity = { value: 1 };
  material.uniforms.brushEnabled = { value: brushFamilies.map(() => 1) };
  material.uniforms.guideMap = { value: null };
  material.uniforms.guideStrength = { value: 0 };
  material.uniforms.guideReference = { value: null };
  material.uniforms.guideColor = { value: null };
  material.uniforms.ribbonViewport = { value: new THREE.Vector2(1, 1) };
  material.uniforms.ribbonStrength = { value: 0.65 };
  const declarations = 'uniform float brushMix;\nuniform float markSize;\nuniform float sizeVariation;\nuniform float strokeDensity;\nvarying vec4 vBrush;\nvarying float vBrushStrength;\n';
  material.vertexShader = declarations + ribbonVaryings + ribbonTraceGLSL + 'uniform float guideStrength;\nuniform float ribbonStrength;\n' + brushMatchGLSL() + strokeSizingGLSL + '\n' + material.vertexShader.replace(basisLine, `
    float major = length(basisVector1);
    float minor = length(basisVector2);
    vec4 guide = vec4(0.5, 0.5, 0.0, 0.0);
    if (guideStrength > 0.0 && brushMix > 0.0) {
      guide = texture2D(guideMap, clamp(ndcCenter.xy * 0.5 + 0.5, 0.0, 1.0));
    }
    float luma = dot(vColor.rgb, vec3(0.299, 0.587, 0.114));
    // Independent integer hashes keep scale, sampling and tool choice uncorrelated.
    uint h = splatIndex * 1664525u + 1013904223u;
    h ^= h >> 16u; h *= 2246822519u; h ^= h >> 13u;
    float seed = float(h & 65535u) / 65535.0;
    uint sh = h * 3266489917u + 374761393u; sh ^= sh >> 15u;
    float sizeSeed = float(sh & 65535u) / 65535.0;
    float matchSeed = float((sh >> 16u) & 65535u) / 65535.0;
    float variant = float((h >> 16u) & 7u);
    float family = matchBrush(major / max(minor, 0.05), minor, vColor.a, luma, matchSeed);
    vBrushStrength = brushStrength(family);
    vec2 sized = strokeSize(major, minor, markSize, sizeVariation, sizeSeed, guide.a*guideStrength);
    float strokeMajor = sized.x, strokeMinor = sized.y;
    float steering = guide.b * guideStrength;
    strokeMinor = mix(strokeMinor, min(strokeMinor, strokeMajor / 3.4), steering);
    float keep = clamp(strokeDensity * (major * minor) / max(1.0, strokeMajor * strokeMinor), 0.001, 1.0);
    // Enlarge a stable, area-weighted set of marks so individual strokes read at
    // screen scale. Other Gaussians remain as a translucent watercolor ground.
    float fade = max(0.002, keep * 0.18);
    float selected = mix(step(seed, keep), smoothstep(seed-fade, seed+fade, keep), guideStrength);
    float enlarge = brushMix * selected;
    vec2 originalDirection = basisVector1 / max(major, 0.0001);
    vec2 doubled = guide.rg * 2.0 - 1.0;
    float angle = length(doubled) > 0.001 ? 0.5 * atan(doubled.y, doubled.x) : 0.0;
    vec2 direction = vec2(cos(angle), sin(angle));
    if (dot(direction, originalDirection) < 0.0) direction = -direction;
    direction = normalize(mix(originalDirection, direction, steering));
    // Only selected pigment marks turn; the other splats retain their original ground.
    basisVector1 = mix(basisVector1, direction * strokeMajor, enlarge);
    basisVector2 = mix(basisVector2, vec2(direction.y, -direction.x) * strokeMinor, enlarge);
    vBrush = vec4(family, variant, selected, seed);
    ribbonLeft = vec4(0.0); ribbonRight = vec4(0.0); ribbonEnds = vec4(0.0);
    ribbonAnchor = ndcCenter.xy * 0.5 + 0.5;
    ribbonInfo = vec4(0.0);
    ribbonPixel = vPosition.x * basisVector1 + vPosition.y * basisVector2;
    // A stable quarter of candidate marks can become ribbons. Never use sort order.
    float ribbonSeed = float((h >> 20u) & 1023u) / 1023.0;
    float ribbonAmount = selected * guideStrength * ribbonStrength * smoothstep(0.25, 0.75, guide.b);
    if (brushMix > 0.0 && ribbonAmount > 0.01 && ribbonSeed < 0.25) {
      vec4 source = ribbonReference(ribbonAnchor);
      vec3 sourceColor = ribbonColor(ribbonAnchor);
      float anchorDepth = log2(1.0 + max(0.0, -viewCenter.z)) / 16.0;
      // A hidden Gaussian cannot borrow a contour from the foreground.
      ribbonAmount *= (1.0-smoothstep(0.002, 0.006, abs(source.g-anchorDepth))) * smoothstep(0.25, 0.6, source.a);
      if (ribbonAmount > 0.01) {
        float stride = clamp(strokeMajor * 0.65, 4.0, 22.0);
        vec2 forward = direction, backward = -direction;
        bool frontAlive = true, backAlive = true;
        ribbonRight.xy = advanceRibbon(ribbonAnchor, vec2(0.0), forward, stride, source, sourceColor, frontAlive);
        ribbonRight.zw = advanceRibbon(ribbonAnchor, ribbonRight.xy, forward, stride, source, sourceColor, frontAlive);
        ribbonEnds.zw = advanceRibbon(ribbonAnchor, ribbonRight.zw, forward, stride, source, sourceColor, frontAlive);
        ribbonLeft.xy = advanceRibbon(ribbonAnchor, vec2(0.0), backward, stride, source, sourceColor, backAlive);
        ribbonLeft.zw = advanceRibbon(ribbonAnchor, ribbonLeft.xy, backward, stride, source, sourceColor, backAlive);
        ribbonEnds.xy = advanceRibbon(ribbonAnchor, ribbonLeft.zw, backward, stride, source, sourceColor, backAlive);
        float halfWidth = clamp(strokeMinor * 0.55, 1.25, 8.0);
        // Keep the original mark inside the quad while blending in the curved path.
        vec2 extent = abs(basisVector1) + abs(basisVector2);
        vec2 lo = -extent, hi = extent;
        lo = min(lo, min(min(ribbonLeft.xy, ribbonLeft.zw), ribbonEnds.xy)-halfWidth);
        lo = min(lo, min(min(ribbonRight.xy, ribbonRight.zw), ribbonEnds.zw)-halfWidth);
        hi = max(hi, max(max(ribbonLeft.xy, ribbonLeft.zw), ribbonEnds.xy)+halfWidth);
        hi = max(hi, max(max(ribbonRight.xy, ribbonRight.zw), ribbonEnds.zw)+halfWidth);
        ribbonPixel = mix(lo, hi, vPosition*0.5+0.5);
        float determinant = basisVector1.x*basisVector2.y-basisVector1.y*basisVector2.x;
        vPosition = vec2(ribbonPixel.x*basisVector2.y-ribbonPixel.y*basisVector2.x,
                         basisVector1.x*ribbonPixel.y-basisVector1.y*ribbonPixel.x) / determinant;
        ribbonInfo = vec4(ribbonAmount, halfWidth, source.g, 1.0);
      }
    }
    vec2 ndcOffset = ribbonPixel *`);
  material.fragmentShader = declarations + ribbonVaryings + ribbonFragmentGLSL + 'uniform sampler2D pigmentMap;\n' + material.fragmentShader
    .replace('if (A > 8.0) discard;', 'if (A > 8.0 && brushMix < 0.01) discard;')
    .replace(alphaLine, `
      float gaussian = exp(-0.5 * A);
      float opacity = gaussian * vColor.a;
      if (brushMix > 0.0) {
        vec2 uv = clamp(vPosition / 5.656854 + 0.5, 0.002, 0.998);
        vec2 atlasUV = (vec2(vBrush.y, vBrush.x) + uv) / vec2(${VARIANTS.toFixed(1)}, ${brushFamilies.length.toFixed(1)});
        float pigment = texture2D(pigmentMap, atlasUV).a;
        float edge = smoothstep(0.0, 0.025, min(min(uv.x, uv.y), min(1.0-uv.x, 1.0-uv.y)));
        float stroke = pow(pigment, 0.65) * edge;
        if (ribbonInfo.w > 0.5) {
          if (any(greaterThan(abs(vPosition), vec2(2.828427)))) stroke = 0.0;
          vec3 path = ribbonCoordinates(ribbonPixel);
          float taper = mix(0.25, 1.0, pow(max(0.0, sin(path.x*3.141593)), 0.45));
          float width = ribbonInfo.y * taper;
          float coverage = 1.0-smoothstep(max(0.0, width-0.8), width+0.5, path.y);
          vec2 ribbonUV = vec2(clamp(path.x, 0.002, 0.998), clamp(0.5+path.y/max(2.0*width, 0.001), 0.002, 0.998));
          float ribbonPigment = texture2D(pigmentMap, (vec2(vBrush.y,vBrush.x)+ribbonUV)/vec2(${VARIANTS.toFixed(1)},${brushFamilies.length.toFixed(1)})).a;
          vec4 surface = texture2D(guideReference, ribbonAnchor + ribbonPixel / ribbonViewport);
          float depth = surface.g/max(surface.a,0.001);
          float visibility = (1.0-smoothstep(0.002,0.006,ribbonInfo.z-depth))*smoothstep(0.1,0.4,surface.a);
          float curved = pow(ribbonPigment, 0.65)*coverage*visibility*step(2.0,path.z);
          stroke = mix(stroke, curved, ribbonInfo.x);
        }
        // Fine lines are decisive; broad pigment stays translucent.
        float strength = vBrushStrength;
        float painted = mix(gaussian * 0.20, stroke * strength, vBrush.z) * vColor.a;
        opacity = mix(opacity, painted, brushMix);
        vec3 paper = vec3(0.95, 0.92, 0.85);
        vec3 paint = floor(color * 22.0 + 0.5) / 22.0;
        paint = mix(paint, paper, mix(0.22, 0.06, vBrush.z));
        color = mix(color, paint, brushMix);
      }
    `);
  material.needsUpdate = true;
}
