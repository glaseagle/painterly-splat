export const lensPresets = Object.freeze({
  environmental: Object.freeze({ label: '35mm · f/4', aperture: .28, strength: .32, bokeh: .08, nearBias: .8, farBias: 1 }),
  classic: Object.freeze({ label: '50mm · f/2', aperture: .52, strength: .46, bokeh: .24, nearBias: .65, farBias: 1.15 }),
  portrait: Object.freeze({ label: '85mm · f/1.4', aperture: .76, strength: .62, bokeh: .58, nearBias: .45, farBias: 1.55 }),
  telephoto: Object.freeze({ label: '135mm · f/2', aperture: .68, strength: .72, bokeh: .42, nearBias: .4, farBias: 1.85 }),
  dream: Object.freeze({ label: '58mm · f/1.2', aperture: .9, strength: .82, bokeh: .92, nearBias: .55, farBias: 1.75 }),
});

// Thin-lens circle of confusion with the constant optical factors removed.
// Background blur approaches a finite limit at infinity; foreground blur grows
// more quickly as an object approaches the camera.
export function circleOfConfusion(depth, focusDepth) {
  if (!(depth > 0) || !(focusDepth > 0)) return 0;
  return Math.abs(depth - focusDepth) / depth;
}

export function focusFalloff(depth, focusDepth, aperture) {
  const coc = circleOfConfusion(depth, focusDepth);
  if (!coc) return 0;
  const open = Math.min(1, Math.max(0, aperture));
  const quietZone = .2 + (.018 - .2) * open;
  const gain = .85 + (3.4 - .85) * open;
  const opticalDistance = Math.max(0, coc - quietZone) / Math.max(1e-6, 1 - quietZone);
  return Math.min(1, 1 - Math.exp(-opticalDistance * gain));
}

export function focusStrokeStyle(depth, focusDepth, aperture, strength, farBias = 1, nearBias = 1) {
  const falloff = focusFalloff(depth, focusDepth, aperture);
  const amount = Math.min(1, Math.max(0, strength));
  const sideGain = depth > focusDepth ? Math.max(1, farBias) : Math.min(1, Math.max(0, nearBias));
  const response = falloff * sideGain;
  return {
    falloff,
    size: 1 + response * amount * 1.4,
    opacity: 1 + response * amount * .75,
  };
}

export const focusFalloffGLSL = `
float painterlyCircleOfConfusion(float depth, float focusDepth) {
  if (depth <= 0.0 || focusDepth <= 0.0) return 0.0;
  return abs(depth - focusDepth) / max(depth, 0.000001);
}
float painterlyFocusFalloff(float depth, float focusDepth, float aperture) {
  float coc = painterlyCircleOfConfusion(depth, focusDepth);
  float open = clamp(aperture, 0.0, 1.0);
  float quietZone = mix(0.2, 0.018, open);
  float gain = mix(0.85, 3.4, open);
  float opticalDistance = max(0.0, coc - quietZone) / max(0.000001, 1.0 - quietZone);
  return clamp(1.0 - exp(-opticalDistance * gain), 0.0, 1.0);
}`;
