// Descriptors describe projected Gaussian footprints, before artistic enlargement.
export const BRUSH_VARIANTS = 8;
export const brushFamilies = [
  { name: 'Watercolor', aspect: 1.25, width: 7, opacity: .4, luma: .7, strength: .60, group: 'paint', tool: 'wash' },
  { name: 'Charcoal', aspect: 2.1, width: 3.5, opacity: .8, luma: .25, strength: .88, group: 'draw', tool: 'charcoal', weight: 12 },
  { name: 'Marker', aspect: 3.4, width: 4, opacity: .95, luma: .65, strength: .90, group: 'paint', tool: 'marker', weight: 14 },
  { name: 'Dry brush', aspect: 5.3, width: 2.3, opacity: .65, luma: .5, strength: .84, group: 'paint', tool: 'scan-dry', weight: 1.3 },
  { name: 'Pencil 2B', aspect: 8, width: 1.1, opacity: .65, luma: .45, strength: .94, group: 'draw', tool: '2B', weight: 3 },
  { name: 'Ink', aspect: 15, width: .65, opacity: .95, luma: .15, strength: 1, group: 'draw', tool: 'rotring', weight: 5 },
  { name: 'Pencil HB', aspect: 6.5, width: .85, opacity: .52, luma: .62, strength: .87, group: 'draw', tool: 'HB', weight: 3.5 },
  { name: 'Pencil 2H', aspect: 11, width: .45, opacity: .35, luma: .8, strength: .76, group: 'draw', tool: '2H', weight: 4 },
  { name: 'Color pencil', aspect: 4.4, width: 1.7, opacity: .62, luma: .72, strength: .85, group: 'draw', tool: 'cpencil', weight: 4 },
  { name: 'Pen', aspect: 10, width: .85, opacity: .9, luma: .35, strength: 1, group: 'draw', tool: 'pen', weight: 4 },
  { name: 'Spray', aspect: 1.05, width: 3.5, opacity: .25, luma: .5, strength: .66, group: 'paint', tool: 'spray', weight: 4 },
  { name: 'Flat marker', aspect: 2.3, width: 6, opacity: 1, luma: .5, strength: .92, group: 'paint', tool: 'scan-flat', weight: 10 },
  { name: 'Hatching', aspect: 4, width: 2, opacity: .8, luma: .2, strength: .94, group: 'draw', tool: 'hatching', weight: 2 },
  { name: 'Wet wash', aspect: 1.1, width: 13, opacity: .2, luma: .85, strength: .48, group: 'paint', tool: 'wet-wash' },
  { name: 'Bristle', aspect: 6, width: 4, opacity: .85, luma: .55, strength: .88, group: 'paint', tool: 'scan-bristle', weight: 2 },
  { name: 'Pastel', aspect: 1.8, width: 4.5, opacity: .75, luma: .68, strength: .83, group: 'paint', tool: 'pastel', weight: 5 },
  { name: 'Crayon', aspect: 2.8, width: 2.7, opacity: .9, luma: .4, strength: .92, group: 'draw', tool: 'crayon', weight: 5 },
  { name: 'Scumble', aspect: 1.55, width: 5, opacity: .55, luma: .42, strength: .76, group: 'paint', tool: 'scan-scumble', weight: 2.3 },
];

export function chooseBrush({ aspect, width, opacity, luma }, enabled = brushFamilies.map(() => 1)) {
  let best = Infinity, chosen = 0;
  brushFamilies.forEach((brush, index) => {
    if (!enabled[index]) return;
    const score = 2 * Math.log(Math.max(1, aspect) / brush.aspect) ** 2 +
      .32 * Math.log(Math.max(.3, width) / brush.width) ** 2 +
      .7 * (opacity - brush.opacity) ** 2 + .35 * (luma - brush.luma) ** 2;
    if (score < best) { best = score; chosen = index; }
  });
  return chosen;
}

export function brushMatchGLSL() {
  return `uniform float brushEnabled[${brushFamilies.length}];
  float matchBrush(float aspect, float width, float opacity, float luma, float seed) {
    float best = 1e10, second = 1e10;
    float chosen = 0.0, alternate = 0.0;
    ${brushFamilies.map((b, i) => `if (brushEnabled[${i}] > 0.5) {
      float a = log(max(1.0, aspect) / ${b.aspect.toFixed(3)});
      float w = log(max(0.3, width) / ${b.width.toFixed(3)});
      float o = opacity - ${b.opacity.toFixed(3)};
      float l = luma - ${b.luma.toFixed(3)};
      float score = 2.0*a*a + 0.32*w*w + 0.7*o*o + 0.35*l*l;
      if (score < best) { second = best; alternate = chosen; best = score; chosen = ${i.toFixed(1)}; }
      else if (score < second) { second = score; alternate = ${i.toFixed(1)}; }
    }`).join('\n')}
    // Only close matches may alternate. The seed is attached to the Gaussian.
    return seed < 0.35 * exp(-4.0*(second-best)) ? alternate : chosen;
  }
  float brushStrength(float family) {
    ${brushFamilies.map((b,i)=>`if (family < ${(i+.5).toFixed(1)}) return ${b.strength.toFixed(3)};`).join('\n')}
    return 0.8;
  }`;
}

// Size and selection use independent hashes; selecting sparse marks must not
// accidentally select only the smallest marks in the size distribution.
export const strokeSizingGLSL = `
vec2 strokeSize(float major, float minor, float size, float variation, float seed, float detail) {
  float spread = exp2((seed-0.5) * 3.6 * variation);
  float inherited = clamp(pow(max(major,0.15)/3.0,0.38),0.45,2.2);
  float target = mix(3.5,20.0,size) * spread * inherited * mix(1.35,0.48,detail);
  float wide = min(160.0,max(major,target));
  float aspect = max(1.05,major/max(minor,0.05));
  return vec2(wide,min(70.0,max(minor,wide/aspect)));
}`;
