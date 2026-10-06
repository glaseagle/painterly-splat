# Photo → Apple SHARP → painterly splat

The browser captures a JPEG only after the user clicks Capture. Generate submits
that JPEG to `/api/painterly/jobs`. A CPU service runs official Apple SHARP,
returns a private job capability, and exposes progress and a PLY download. The
viewer reads SHARP's camera metadata, normalizes the scene, and enables Brush mode.

The default deployment uses **Cloudflare Containers**, not the 128 MB Worker runtime.
It needs Workers Paid. The existing live account was Free when this feature was
prepared, so production generation remains unavailable until activation. The
frontend detects that state and never submits a photo to an unavailable backend.

## Local end-to-end development

Install Apple SHARP in an isolated Python environment. Use current timm (tested
with 1.0.30) and PyTorch (tested with 2.10.0). Download the official checkpoint
from the URL in Apple's README, then run:

```
python sharp-backend/server.py --static . --port 4188 --checkpoint /path/to/sharp.pt
```

Open `http://localhost:4188/painterly-splat.html`. The local development server
binds only to loopback. There is no public PC service or startup task.

## Activate on Cloudflare

In the **hosting repository** (`Michaelport`), `worker.js` imports `painterlyAPI`
and exports `PainterlySharp`. The API returns an explicit unavailable status
until `PAINTERLY_SHARP` is bound.

After Workers Paid is enabled, run `node sharp-backend/enable-cloudflare.mjs`,
review the changes to `wrangler.jsonc`, commit, and push. The existing production
Workers Builds integration can build the Dockerfile and deploy the Container.
For local deployment with `npx wrangler deploy`, Docker must be installed/running.
Provisioning the first image can take several minutes. Verify a real photo job
in production before describing cloud generation as operational.

The Container uses 4 vCPUs / 12 GiB (`standard-4`), one named instance, one
inference at a time, no outbound Internet at runtime, a 2-minute inactivity
timeout and a 10-minute absolute lifetime alarm. The model is downloaded from
Apple during the private image build. Public jobs are limited to 3 attempts per
IP per UTC day and 20 total attempts per UTC day. Only a daily salted hash of
the IP is retained; counters are replaced the next day. Limits include failed
startup attempts. These caps and timeouts bound use but are not a billing cap.

Photos: JPEG only, 2 MB / 4 million pixels maximum. Results and job tokens live
only in the container and expire after 10 minutes or a container restart.
No image, filename or token logging. Cancelling immediately revokes access;
an already-running inference finishes, then its output is removed. Successful
browser downloads delete the server job. Browser object URLs retain only the
most recent generated result for the Download button until navigation.

## Validation

`python sharp-backend/test_server.py` checks malformed/oversized images,
one-at-a-time inference, private results, cancellation cleanup and expiration.
`npm test` covers imported scene normalization and camera preservation.

Local CPU benchmark on 2026-10-05: official checkpoint, four CPU threads,
one public site-logo photo, 70 seconds inference plus PLY serialization,
7.33 GiB peak RSS, 1,179,648 output Gaussians. This is not a Cloudflare benchmark.
Cloudflare Container deployment and timing remain unverified until the account
plan permits deployment.
The enabled Wrangler configuration validates; the Docker image has not been
built locally because Docker is not installed. Workers Builds performs that build.

Apple SHARP code and weights have their own [research license](https://github.com/apple/ml-sharp/blob/main/LICENSE_MODEL).
This is a noncommercial experiment; check the upstream terms before repurposing
the service commercially. Weights are not committed to either public repository.
