# Painterly Splat

Real Gaussian scans rendered as view-dependent p5.brush strokes.

**[Open the live demo](https://michael.software/painterly-splat?v=lineart-1)**

The train opens in Brush mode. Compare Splats / Hybrid / Brush / Lines, choose
from 18 brush families, and adjust stroke size, variation, density, and line art.

Drag to orbit the visible surface. Double-click a surface, or use **Place 3D cursor**
and click/tap, to set the orbit pivot. Right-drag pans; wheel/pinch zooms. The cursor
is a world-space marker with three axes and rings. Hide it with **Show cursor**.
**Auto orbit** turns continuously around the cursor and refreshes projected line
art while it moves. **Fly** retains the original free camera; **Reset view** restores the capture view.

**Line art** replaces the former Contour flow and Curved strokes controls. A Canny
pass detects edges in the unpainted splats, traces connected paths, samples scene
depth, and converts the paths into 3D brush-textured strokes. **Edge detail** adjusts
detection sensitivity; **Line width** adjusts ink width. **Lines** isolates the
linework on paper. Set Line art to 0 to see the brush rendering without outlines.

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
The browser renders the splat; photo generation uses an outbound-only worker on
the host PC, with a private Cloudflare queue. See [backend setup](sharp-backend/README.md)
for start/stop instructions and the optional Cloudflare CPU Container route.
Existing PLY files need no backend.

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

- Orbit (default): drag to orbit, right-drag to pan, wheel to zoom; double-click to set the pivot.
- Fly: drag to look, WASD to move, R/F to rise or descend, wheel to move.
- Touch: one finger to orbit, two fingers to pan, pinch to zoom.
- On mobile, open the hamburger menu for scans, render modes, stroke size, and Reset view.

## How it works

p5.brush creates 144 seeded marks across 18 families. A GPU matcher chooses a
family from each Gaussian's projected shape, width, opacity, and luminance.
Independent stable size variation gives uniform SHARP footprints broad and fine
marks while retaining native Gaussian elongation and size hierarchy.

The lineart pass captures the original splat color and the nearest covered
Gaussian-center depth, capped at 640 pixels on the longest side. Gaussian blur,
Sobel gradients, non-maximum suppression, and hysteresis produce thin Canny edges.
Connected paths stop at depth discontinuities; their vertices are unprojected into
world space and rendered as joined, tapered brush strips. A current-view depth
pass hides strokes behind nearer surfaces. Lines remain in 3D during motion and
are regenerated after the camera stops and splat sorting completes. This is
view-dependent linework using approximate splat-center depth, not a reconstructed
surface mesh or permanent all-view drawing.

GaussianSplats3D handles projection, blending, visibility, and worker-based depth
sorting. Three.js OrbitControls handles orbit/pan/zoom, while FlyControls supports
the optional free camera. Source capture orientation and full scan density remain.

| File | Purpose |
| --- | --- |
| `painterly-splat.html` | Page, responsive controls, and import map |
| `painterly-viewer.js` | Scene loading, camera, input, render loop |
| `painterly-brushes.js` | Procedural mark atlas and shader integration |
| `painterly-brush-matching.js` | Brush descriptors and GPU matching code |
| `painterly-edges.js` | Canny edge detection, depth decoding, connected paths |
| `painterly-lineart.js` | Base/depth capture, world-space brush strips, occlusion and picking |
| `painterly-navigation.js` | Orbit camera, 3D cursor, depth unprojection |
| `painterly-touch.js` | Touch-only OrbitControls integration |
| `painterly-upload.js` | Local file validation, SHARP camera metadata, automatic framing |
| `painterly-camera.js` | Webcam/photo preview, generation, progress, download |
| `sharp-backend/` | CPU inference service, Cloudflare Container, setup and tests |
| `painterly-scans/` | Full scans, source attribution, camera metadata |

## Tests

With Node.js 24.0 or newer:

```sh
npm test
```

Tests cover brush selection, camera-angle changes, touch orbit/pan/zoom,
gesture transitions, independence from desktop input, local-file validation,
SHARP/legacy camera metadata, vertex preservation, and robust scene framing.

Imports normalize geometry, including sampled Gaussian footprints, to a consistent
radius around the origin. Every import is reframed with padding, even when camera
metadata supplies a close-up position. Camera orientation is preserved. Generic imports
use the common COLMAP/OpenCV convention (Y down, Z forward). Because a PLY without
camera metadata cannot identify its up direction, **Flip upright** corrects
opposite conventions. **View size** pulls back or moves closer without modifying
the file. Both microscopic and oversized scans use the same normalized framing.

**Camera / photo → splat** captures or opens a photo, sends it only when Generate
is clicked, and opens the SHARP result in Brush mode. The host PC picks up photos
from the private queue and sends results back; no public PC port is open. The
optional all-cloud route needs a paid Container. Generation availability is
reported explicitly by the backend; local splat uploads always stay on device.

With the static server running, open `tests/render-browser.html` for actual GPU
matching, scale, renderer-state preservation, visible line geometry, cursor depth,
and foreground occlusion checks. Node tests also cover Canny edge thinning,
hysteresis, depth-separated tracing, world-space projection, and orbit/pan behavior.

## Credits

- [p5.brush](https://github.com/acamposuribe/p5.brush) 2.2.3 by Alejandro Campos
- [GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D) 0.4.7
- [Three.js](https://github.com/mrdoob/three.js) r170
- Drawing reference: [Brush Arena](https://brusharena.art/gallery)
- Scans: Mip-NeRF 360 Bonsai/Table and Bicycle; Tanks & Temples Train.
  See [scan provenance and attribution](painterly-scans/README.md) for original sources.

Vendored libraries retain their upstream license files. Scan data remains subject
to its original source terms.


### Expanded painterly tools

The viewer now offers 18 selectable brush families, with eight stable variations
per family (144 textures): all 11 tools in pinned p5.brush 2.2.3, plus watercolor,
wet wash, dry brush, flat marker, hatching, bristle, and scumble. All-tools, paint,
and drawing presets can be narrowed by toggling individual swatches.

Matching uses each Gaussian's projected aspect, width, opacity, and luminance.
Only similarly scoring tools can alternate; disabled tools are excluded. Size
variation uses an independent stable hash from mark selection, retains the
original size hierarchy and elongation.
Stroke size, size variation, and stroke density can be adjusted independently.

Validation: `node --test tests/*.test.mjs`; open `tests/render-browser.html`
for actual WebGL matching, scale, line visibility, depth picking, and occlusion checks.
