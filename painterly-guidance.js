import * as THREE from 'three';

const vertexShader = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const sampling = `
uniform sampler2D referenceMap;
uniform vec2 texel;
varying vec2 vUv;
// Normal alpha blending onto transparent black stores premultiplied moments.
vec3 reference(vec2 uv) {
  vec4 p = texture2D(referenceMap, uv);
  return vec3(p.rg / max(p.a, 0.001), p.a);
}
float compatible(vec3 a, vec3 b) {
  return smoothstep(0.05, 0.4, b.z) * exp(-abs(a.y - b.y) * 240.0);
}`;

export const tensorShader = `${sampling}
void main() {
  vec3 c = reference(vUv);
  vec3 l = reference(vUv - vec2(texel.x, 0.0));
  vec3 r = reference(vUv + vec2(texel.x, 0.0));
  vec3 d = reference(vUv - vec2(0.0, texel.y));
  vec3 u = reference(vUv + vec2(0.0, texel.y));
  // Coverage edges use the center luminance instead of the empty background.
  float left = mix(c.x, l.x, smoothstep(0.05, 0.4, l.z));
  float right = mix(c.x, r.x, smoothstep(0.05, 0.4, r.z));
  float down = mix(c.x, d.x, smoothstep(0.05, 0.4, d.z));
  float up = mix(c.x, u.x, smoothstep(0.05, 0.4, u.z));
  vec2 g = clamp(vec2(right-left, up-down) * 2.0, -1.0, 1.0);
  float boundary = max(max(abs(c.y-l.y), abs(c.y-r.y)), max(abs(c.y-d.y), abs(c.y-u.y)));
  float detail = max(smoothstep(0.025, 0.45, length(g)), smoothstep(0.003, 0.02, boundary));
  float coverage = smoothstep(0.05, 0.4, c.z);
  gl_FragColor = vec4(g.x*g.x*coverage, g.y*g.y*coverage,
                      0.5 + 0.5*g.x*g.y*coverage, detail*coverage);
}`;

export const flowShader = `${sampling}
uniform sampler2D tensorMap;
void main() {
  vec3 c = reference(vUv);
  vec3 tensor = vec3(0.0);
  float total = 0.0, detail = 0.0;
  // Smooth tensors, not angles: opposite directions describe the same contour.
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 uv = vUv + offset * texel;
      vec3 sampleRef = reference(uv);
      float weight = exp(-dot(offset, offset) / 5.0) * compatible(c, sampleRef);
      weight *= exp(-abs(c.x - sampleRef.x) * 5.0);
      vec4 t = texture2D(tensorMap, uv);
      tensor += vec3(t.rg, t.b*2.0-1.0) * weight;
      detail += t.a * weight;
      total += weight;
    }
  }
  tensor /= max(total, 0.001);
  detail /= max(total, 0.001);
  float energy = tensor.x + tensor.y;
  vec2 axis = vec2(tensor.x-tensor.y, 2.0*tensor.z);
  float coherence = clamp(length(axis) / max(energy, 0.001), 0.0, 1.0);
  float confidence = coherence * smoothstep(0.008, 0.08, energy) * smoothstep(0.05, 0.4, c.z);
  // Store the contour as a double angle, so texture interpolation cannot flip it.
  vec2 tangent = energy > 0.001 ? -axis / max(length(axis), 0.0001) : vec2(1.0, 0.0);
  gl_FragColor = vec4(tangent*0.5+0.5, confidence, detail);
}`;

// Standalone analysis also supports the synthetic GPU regression fixtures.
export function createGuideAnalysis(renderer, referenceTexture, type = THREE.UnsignedByteType) {
  const options = { type, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  const tensor = new THREE.WebGLRenderTarget(1, 1, options);
  const flow = new THREE.WebGLRenderTarget(1, 1, options);
  const texel = new THREE.Vector2(1, 1);
  const uniforms = { referenceMap: { value: referenceTexture }, texel: { value: texel }, tensorMap: { value: tensor.texture } };
  const materials = [tensorShader, flowShader].map(fragmentShader => new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader, depthTest: false, depthWrite: false,
  }));
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), materials[0]);
  quad.frustumCulled = false;
  const camera = new THREE.Camera();
  return {
    texture: flow.texture,
    target: flow,
    resize(width, height) { tensor.setSize(width, height); flow.setSize(width, height); texel.set(1/width, 1/height); },
    render() {
      const previous = renderer.getRenderTarget();
      try {
        quad.material = materials[0]; renderer.setRenderTarget(tensor); renderer.render(quad, camera);
        quad.material = materials[1]; renderer.setRenderTarget(flow); renderer.render(quad, camera);
      } finally { renderer.setRenderTarget(previous); }
    },
    dispose() { tensor.dispose(); flow.dispose(); quad.geometry.dispose(); materials.forEach(m => m.dispose()); },
  };
}

export function createPainterlyGuidance(renderer, mesh) {
  // A single extra splat pass captures luminance, approximate log depth, coverage.
  // Blended depth is only a boundary hint, never treated as an opaque surface.
  const type = renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const reference = new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: false, count: 2 });
  const analysis = createGuideAnalysis(renderer, reference.texture, type);
  const guideMaterial = mesh.material.clone();
  guideMaterial.uniforms = mesh.material.uniforms;
  guideMaterial.vertexShader = 'varying float guideDepth;\n' + guideMaterial.vertexShader.replace(
    'vec2 ndcOffset =', 'guideDepth = log2(1.0 + max(0.0, -viewCenter.z)) / 16.0;\nvec2 ndcOffset =');
  guideMaterial.fragmentShader = `varying vec4 vColor; varying vec2 vPosition; varying float guideDepth;
    layout(location = 1) out highp vec4 referenceColor;
    void main() {
      float a = dot(vPosition, vPosition);
      if (a > 8.0) discard;
      gl_FragColor = vec4(dot(vColor.rgb, vec3(0.299, 0.587, 0.114)), guideDepth, 0.0, exp(-0.5*a)*vColor.a);
      referenceColor = vec4(vColor.rgb, exp(-0.5*a)*vColor.a);
    }`;
  const savedClear = new THREE.Color();
  let width = 0, height = 0;
  return {
    texture: analysis.texture,
    reference: reference.textures[0],
    color: reference.textures[1],
    render(camera, viewWidth, viewHeight) {
      // Half resolution, capped for large desktop displays.
      const scale = Math.min(0.5, 640 / Math.max(viewWidth, viewHeight));
      const w = Math.max(1, Math.round(viewWidth*scale)), h = Math.max(1, Math.round(viewHeight*scale));
      if (w !== width || h !== height) { reference.setSize(w, h); analysis.resize(w, h); width = w; height = h; }
      const previousTarget = renderer.getRenderTarget(), previousMaterial = mesh.material;
      const previousAutoClear = renderer.autoClear, previousAlpha = renderer.getClearAlpha();
      renderer.getClearColor(savedClear);
      try {
        mesh.material = guideMaterial;
        renderer.autoClear = true;
        renderer.setClearColor(0x000000, 0);
        renderer.setRenderTarget(reference);
        renderer.render(mesh, camera);
        analysis.render();
      } finally {
        mesh.material = previousMaterial;
        renderer.setRenderTarget(previousTarget);
        renderer.setClearColor(savedClear, previousAlpha);
        renderer.autoClear = previousAutoClear;
      }
    },
    dispose() { reference.dispose(); analysis.dispose(); guideMaterial.dispose(); },
  };
}
