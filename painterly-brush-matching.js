// Brush descriptors are measured in projected pixels, so a changing camera
// changes the match. A stable splat ID chooses the hand-drawn variant afterward.
export const brushFamilies = [
  { name: 'Watercolor', aspect: 1.25, width: 7, opacity: .4, luma: .7 },
  { name: 'Charcoal', aspect: 2.1, width: 3.5, opacity: .8, luma: .25 },
  { name: 'Marker', aspect: 3.4, width: 4, opacity: .95, luma: .65 },
  { name: 'Dry brush', aspect: 5.3, width: 2.3, opacity: .65, luma: .5 },
  { name: 'Pencil', aspect: 8, width: 1.1, opacity: .65, luma: .45 },
  { name: 'Ink', aspect: 15, width: .65, opacity: .95, luma: .15 },
];

export function chooseBrush({ aspect, width, opacity, luma }) {
  let best = Infinity, chosen = 0;
  brushFamilies.forEach((brush, index) => {
    const score = 2 * Math.log(Math.max(1, aspect) / brush.aspect) ** 2 +
      .16 * Math.log(Math.max(.3, width) / brush.width) ** 2 +
      .7 * (opacity - brush.opacity) ** 2 + .35 * (luma - brush.luma) ** 2;
    if (score < best) { best = score; chosen = index; }
  });
  return chosen;
}

export function brushMatchGLSL() {
  return `float matchBrush(float aspect, float width, float opacity, float luma) {
    float best = 1e10;
    float chosen = 0.0;
    ${brushFamilies.map((b, i) => `{
      float a = log(max(1.0, aspect) / ${b.aspect.toFixed(3)});
      float w = log(max(0.3, width) / ${b.width.toFixed(3)});
      float o = opacity - ${b.opacity.toFixed(3)};
      float l = luma - ${b.luma.toFixed(3)};
      float score = 2.0*a*a + 0.16*w*w + 0.7*o*o + 0.35*l*l;
      if (score < best) { best = score; chosen = ${i.toFixed(1)}; }
    }`).join('\n')}
    return chosen;
  }`;
}
