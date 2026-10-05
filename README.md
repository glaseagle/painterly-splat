# Painterly Splat

Real Gaussian scans rendered as view-dependent p5.brush strokes.

**[Open the live demo](https://michael.software/painterly-splat?v=upload-1)**

The train opens in Brush mode. Switch between Train, Bike, and Table, compare
Splats / Hybrid / Brush, and adjust stroke size. The default size is the former
maximum, now at the middle of an expanded slider.

**Contour flow** steers pigment along image contours and places smaller, denser
marks around detail, with broader washes in quiet regions. It starts at 75%; set
it to 0 to compare the original brush rendering. Splats mode bypasses guidance.

**Curved strokes** grow the selected marks into longer textured ribbons that
follow the same contour field, stopping at detected depth and color boundaries to
reduce paint crossing object edges. It starts at 65% and requires Contour flow
above 0; set it to 0 to keep individual marks.

**Open splat file** loads your own `.ply`, `.splat`, or `.ksplat` (up to 256 MB).
Files stay in the browser and are never uploaded to a server. The bundled scenes
remain available. Standard binary little-endian Gaussian PLYs are supported;
ordinary mesh/point-cloud PLYs and compressed PlayCanvas PLYs are not. Files without
camera metadata are framed automatically, and movement scales with their size.

### Apple SHARP

[Apple SHARP](https://github.com/apple/ml-sharp) is an optional way to create an
input splat from one photograph. After installing it separately, run:

```sh
sharp predict -i /path/to/images -o /path/to/gaussians
```

Open the resulting `.ply` with **Open splat file**. The viewer reads SHARP's
image dimensions, focal lengths and camera extrinsics (including legacy metadata)
and uses its OpenCV orientation. Its additional PLY metadata is stripped from the
rendering copy while preserving every vertex byte. A generated scene is best
viewed near its original photo viewpoint; unseen surfaces are not a full scan.
The website does not run SHARP inference or download its model. Prediction runs
separately in Python on CPU, CUDA, or Apple MPS, as described in Apple's README.

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

A half-resolution reference pass captures luminance, approximate blended depth,
and coverage. Two small GPU passes derive a depth-aware structure tensor and a
contour direction/detail map. Selected marks follow confident contours; weak
directions retain the Gaussian orientation. Stable IDs and soft selection reduce
density popping. The guide is capped at 640 pixels on its longest side and only
runs when a painted frame is requested. It adds one scan draw and two fullscreen
passes; guidance at 0 and Splats mode skip all three. Selected marks can grow
into longer curved ribbons that trace the contour field in screen space, anchored
to stable Gaussian IDs and stopping at depth and color boundaries. Temporal
history is not yet reprojected, so view-dependent brush-family changes can still
occur in motion.

GaussianSplats3D handles projection, blending, visibility, and worker-based depth
sorting. The viewer retains the source capture orientation and full scan density.
Touch gestures use Three.js OrbitControls; desktop movement uses FlyControls.

| File | Purpose |
| --- | --- |
| `painterly-splat.html` | Page, responsive controls, and import map |
| `painterly-viewer.js` | Scene loading, camera, input, render loop |
| `painterly-brushes.js` | Procedural mark atlas and shader integration |
| `painterly-brush-matching.js` | Brush descriptors and GPU matching code |
| `painterly-guidance.js` | Luminance/depth reference, contour and detail analysis |
| `painterly-ribbons.js` | Curved-stroke ribbon tracing and textured fragment coordinates |
| `painterly-touch.js` | Touch-only OrbitControls integration |
| `painterly-upload.js` | Local file validation, SHARP camera metadata, automatic framing |
| `painterly-scans/` | Full scans, source attribution, camera metadata |

## Tests

With Node.js 24.0 or newer:

```sh
npm test
```

Tests cover brush selection, camera-angle changes, touch orbit/pan/zoom,
gesture transitions, independence from desktop input, local-file validation,
SHARP/legacy camera metadata, vertex preservation, and robust scene framing.

With the static server running, open `tests/guidance-browser.html` for GPU
regressions (both half-float targets and the byte fallback). These exercise actual
shaders on flat regions, vertical/horizontal/diagonal edges, depth boundaries,
empty coverage, deterministic redraws, and resizing. Ribbon fixtures exercise
curvature, depth/color/coverage stops, viewport clipping, and deterministic paths.

## Credits

- [p5.brush](https://github.com/acamposuribe/p5.brush) 2.2.3 by Alejandro Campos
- [GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D) 0.4.7
- [Three.js](https://github.com/mrdoob/three.js) r170
- Drawing reference: [Brush Arena](https://brusharena.art/gallery)
- Scans: Mip-NeRF 360 Bonsai/Table and Bicycle; Tanks & Temples Train.
  See [scan provenance and attribution](painterly-scans/README.md) for original sources.

Vendored libraries retain their upstream license files. Scan data remains subject
to its original source terms.
