export function focusFalloff(depth, focusDepth, aperture) {
  if (!(depth > 0) || !(focusDepth > 0)) return 0;
  const open = Math.min(1, Math.max(0, aperture));
  const distance = Math.abs(depth - focusDepth) / Math.max(focusDepth, 1e-6);
  const sharpBand = 0.34 + (0.025 - 0.34) * open;
  const feather = 0.72 + (0.14 - 0.72) * open;
  const t = Math.min(1, Math.max(0, (distance - sharpBand) / Math.max(feather, 1e-6)));
  return t * t * (3 - 2 * t);
}

export function focusStrokeStyle(depth, focusDepth, aperture, strength) {
  const falloff = focusFalloff(depth, focusDepth, aperture);
  const amount = Math.min(1, Math.max(0, strength));
  return {
    falloff,
    size: 1 + falloff * amount * 1.4,
    opacity: 1 + falloff * amount * .75,
  };
}

export const focusFalloffGLSL = `
float painterlyFocusFalloff(float depth, float focusDepth, float aperture) {
  if (depth <= 0.0 || focusDepth <= 0.0) return 0.0;
  float open = clamp(aperture, 0.0, 1.0);
  float distanceFromPlane = abs(depth - focusDepth) / max(focusDepth, 0.000001);
  float sharpBand = mix(0.34, 0.025, open);
  float feather = mix(0.72, 0.14, open);
  return smoothstep(sharpBand, sharpBand + feather, distanceFromPlane);
}`;
