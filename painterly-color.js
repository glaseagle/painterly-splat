export const COLOR_PRESETS = Object.freeze({
  original: { exposure: 0, contrast: 100, saturation: 100, warmth: 0 },
  warm: { exposure: 8, contrast: 108, saturation: 112, warmth: 34 },
  cool: { exposure: 2, contrast: 104, saturation: 104, warmth: -30 },
  wash: { exposure: 12, contrast: 84, saturation: 62, warmth: 14 },
  vivid: { exposure: 4, contrast: 116, saturation: 138, warmth: 8 },
});

export function colorStyle(values = COLOR_PRESETS.original) {
  return {
    exposure: Number(values.exposure || 0) * .015,
    contrast: Number(values.contrast ?? 100) / 100,
    saturation: Number(values.saturation ?? 100) / 100,
    warmth: Number(values.warmth || 0) / 100,
  };
}

export function gradeColor(rgb, style = colorStyle()) {
  const gain = 2 ** style.exposure;
  let color = [rgb[0] * gain, rgb[1] * gain, rgb[2] * gain];
  color = [color[0] + style.warmth * .12, color[1] + style.warmth * .02, color[2] - style.warmth * .12];
  color = color.map(value => (value - .5) * style.contrast + .5);
  const luma = color[0] * .299 + color[1] * .587 + color[2] * .114;
  return color.map(value => Math.min(1, Math.max(0, luma + (value - luma) * style.saturation)));
}

export const colorGradeGLSL = `
uniform float colorExposure;
uniform float colorContrast;
uniform float colorSaturation;
uniform float colorWarmth;
vec3 gradeColor(vec3 sourceColor) {
  vec3 graded = sourceColor * exp2(colorExposure);
  graded += colorWarmth * vec3(0.12, 0.02, -0.12);
  graded = (graded - 0.5) * colorContrast + 0.5;
  float luma = dot(graded, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(luma), graded, colorSaturation), 0.0, 1.0);
}`;
