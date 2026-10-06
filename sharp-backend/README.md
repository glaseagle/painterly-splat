# Photo → Apple SHARP → painterly splat

The browser captures a JPEG only after the user clicks Capture. Generate submits
that JPEG to `/api/painterly/jobs`. A CPU service runs official Apple SHARP,
returns a private job capability, and exposes progress and a PLY download. The
viewer reads SHARP's camera metadata, normalizes the scene, and enables Brush mode.

The live deployment uses an **outbound-only local worker**. The website queues a
JPEG in private R2 storage; the host PC polls an authenticated endpoint, runs
SHARP, uploads the PLY, and releases inference memory. The browser retrieves the
result using its private job token. No inbound port, router change or public PC
service is needed. SQLite Durable Objects coordinate the queue on Workers Free.

## Start or stop the host PC generator

From PowerShell in this repository:

```
.\sharp-backend\start-local.ps1
.\sharp-backend\stop-local.ps1
```

Configuration lives outside the repositories at
`$env:USERPROFILE\.cache\painterly-sharp\local-worker.json`: `url`, `token`,
`python` (the isolated SHARP interpreter) and `checkpoint`. The bearer secret
must match the Worker's `PAINTERLY_WORKER_TOKEN`. Never commit this file. The
live host configuration is installed with access restricted to its user and SYSTEM.
Logs and the process ID live beside it. There is no automatic login/startup task.
Keep the PC awake and connected; the site reports offline after 90 seconds
without a heartbeat. Running the launcher twice does not start two workers.

Each job uses a disposable inference process. CUDA is used when at least 10 GiB
of GPU memory is free; otherwise inference uses CPU. Jobs run one at a time and
are limited to seven minutes. Cancellation stops the owned inference process.
The queue accepts at most two active jobs, 3 attempts per IP per UTC day and
20 total per UTC day. Private photos and results expire after 10 minutes, with
an R2 one-day lifecycle backstop if scheduled cleanup fails. Public tokens stop
working at expiration regardless of storage cleanup. A stopped/disconnected
generator fails an active job after two minutes. All GPU memory is released
after each job; the idle polling process does not load the model.

Cloudflare Containers remain an optional all-cloud alternative; that route
requires Workers Paid. The local queue route does not require that upgrade.

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
and exports both backend classes. The activation script switches the binding from
`PAINTERLY_LOCAL` to `PAINTERLY_SHARP` and keeps the existing migration history.

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
