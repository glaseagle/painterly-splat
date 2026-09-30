# Painterly Splat

Real Gaussian scans rendered as view-dependent p5.brush strokes.

**[Open the live demo](https://michael.software/painterly-splat?v=mobile-1)**

The train opens in Brush mode. Switch between Train, Bike, and Table, compare
Splats / Hybrid / Brush, and adjust stroke size. The default size is the former
maximum, now at the middle of an expanded slider.

## Run locally

Clone this repository and serve it as a static website:

```sh
git clone https://github.com/glaseagle/painterly-splat.git
cd painterly-splat
python -m http.server 4173
```

Open **http://localhost:4173/**. No build step or API key is needed.
A WebGL2-capable browser is required. p5.brush and web fonts load from their CDNs;
the renderer and three full scan assets are included in the repo (about 42 MB of scans).

## Controls

- Desktop: drag to look, WASD to move, R/F to rise or descend, wheel to move.
- Touch: one finger to orbit, two fingers to pan, pinch to zoom.
- On mobile, open the hamburger menu for scans, render modes, stroke size, and Reset view.

## How it works

p5.brush creates 24 seeded marks across watercolor, charcoal, marker, dry brush,
pencil, and ink. A GPU matcher chooses a family from each Gaussian's projected
shape, width, opacity, and luminance. Camera movement changes the match; the
marks stay stable at rest. Larger marks sit over a translucent Gaussian ground.

GaussianSplats3D handles projection, blending, visibility, and worker-based depth
sorting. The viewer retains the source capture orientation and full scan density.
Touch gestures use Three.js OrbitControls; desktop movement uses FlyControls.

| File | Purpose |
| --- | --- |
| `painterly-splat.html` | Page, responsive controls, and import map |
| `painterly-viewer.js` | Scene loading, camera, input, render loop |
| `painterly-brushes.js` | Procedural mark atlas and shader integration |
| `painterly-brush-matching.js` | Brush descriptors and GPU matching code |
| `painterly-touch.js` | Touch-only OrbitControls integration |
| `painterly-scans/` | Full scans, source attribution, camera metadata |

## Tests

With Node.js 24.0 or newer:

```sh
npm test
```

Tests cover brush selection, camera-angle changes, touch orbit/pan/zoom,
gesture transitions, and independence from desktop input.

## Credits

- [p5.brush](https://github.com/acamposuribe/p5.brush) 2.2.3 by Alejandro Campos
- [GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D) 0.4.7
- [Three.js](https://github.com/mrdoob/three.js) r170
- Drawing reference: [Brush Arena](https://brusharena.art/gallery)
- Scans: Mip-NeRF 360 Bonsai/Table and Bicycle; Tanks & Temples Train.
  See [scan provenance and attribution](painterly-scans/README.md) for original sources.

Vendored libraries retain their upstream license files. Scan data remains subject
to its original source terms.
