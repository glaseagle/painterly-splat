# Painterly Splat scans

The live viewer loads `*-full.ksplat`: every Gaussian in the corresponding
[public msplat output](https://huggingface.co/datasets/alexmkwizu/gaussian_training_datasets/tree/main/tested_outputs),
without pruning, cropping, or subsampling.

| UI name | Benchmark scene | Gaussians | Download |
| --- | --- | ---: | ---: |
| Table | Mip-NeRF 360 / Bonsai | 403,020 | 9.7 MB |
| Bike | Mip-NeRF 360 / Bicycle | 1,003,690 | 24.1 MB |
| Train | Tanks & Temples / Train | 316,845 | 7.6 MB |

The manifest records original URLs, source and output SHA-256 checksums, counts,
camera intrinsics, and camera transforms. Legacy sample fields remain in the
manifest for provenance; this standalone repo includes only the full scan assets
used by the viewer.

## Conversion and camera coordinates

Converted with GaussianSplats3D 0.4.7's `PlyLoader.loadFromFileData` using
`(arrayBuffer, 0, 1, true, 0)`: minimum alpha 0, half-precision compression,
spatial optimization, and degree-zero color. The conversion retains all centers,
covariances and opacities, with quantization. Higher-order, view-dependent
spherical-harmonic color coefficients are omitted to keep each asset below the
hosting provider's 25 MiB limit.

Starting poses and intrinsics come from each scene's COLMAP `sparse/0/images.bin`
and `cameras.bin` in the same dataset. Table and Bike also have equivalent poses
in [dylanebert/3dgs](https://huggingface.co/datasets/dylanebert/3dgs).

These trained PLYs use msplat's normalized coordinates. Reproduce
[`autoScaleAndCenter`](https://github.com/rayanht/msplat/blob/main/core/src/input_data.cpp):
compute the mean of all camera centers, subtract it, and multiply by the inverse
maximum absolute component of all centered camera positions. Apply that transform
to the starting camera position. Do not normalize the PLY again. Rotations remain
unchanged. Convert camera-to-world columns from COLMAP `[right, down, forward]`
to Three.js `[right, -down, -forward]`.

The first capture frame is used in all three scenes. Reset restores this pose.
Field of view uses the capture intrinsics; narrow screens expand the vertical
field of view to preserve the capture's horizontal coverage.

## Renderer and brush

GaussianSplats3D handles covariance projection, visibility, depth sorting in a
worker, and WebGL alpha blending. CPU worker sorting avoids GPU readback stalls
observed in the embedded browser; all rasterization still runs on the GPU.

Three.js FlyControls supplies WASD/RF movement. Relative pointer deltas implement
drag-to-look without orbiting a bounding box. Keyboard input is scoped to the
focused viewer, and blur clears held movement. Touch uses the matching Three.js
r170 OrbitControls: one finger orbits a focus in front of the capture camera,
two fingers pan, and pinch zooms. Mouse and touch inputs stay separate.
Mobile controls start collapsed behind a hamburger button, with a scrollable
options panel and touch-sized controls.

p5.brush generates a 24-mark atlas once: watercolor, charcoal, marker, dry brush,
pencil, and ink, each with four seeded hand-drawn variants. Inspired by the varied
wash-and-line drawings in [Brush Arena's gallery](https://brusharena.art/gallery).

A vertex-shader matcher compares each Gaussian's current projected aspect ratio,
width, opacity, and luminance with six brush descriptors. The projected covariance
changes with camera angle and distance, so the same Gaussian can become a wash
face-on and a pencil or ink line at a grazing angle. The selected mark follows
the covariance's major axis. Variant selection uses a stable Gaussian ID, not
sort order or time.

An area-weighted selection makes readable, larger marks; remaining Gaussians form
a translucent ground so the scene stays filled in. The Stroke size slider controls
this drawing scale. Train opens in Brush mode at size 100 (the former maximum),
now the midpoint of the expanded 0–200 slider. The full scan remains intact in Splats mode. Hybrid blends the
original splats with the drawing. Brush mode uses the pigment alpha itself, with
varied silhouettes, pressure, grain, and a slightly simplified palette.

There is no per-frame p5 work or random animation. Matching runs on the GPU when
the view changes, and rendering pauses when the camera stops. Mark changes during
movement are intentional. Run matching regressions with:

```sh
node --test tests/painterly-brush-matching.test.mjs
node --test tests/painterly-touch.test.mjs
```

Dataset attribution and original licensing:
[Mip-NeRF 360](https://jonbarron.info/mipnerf360/),
[Tanks & Temples](https://www.tanksandtemples.org/), and the
[dataset publisher's source and license notes](https://huggingface.co/datasets/alexmkwizu/gaussian_training_datasets).
