import { boundedBytes, scrubPhoto, MAX_PHOTO, SCRUB_VERSION, PhotoError } from './scrub.js';
const PREFIX = '/api/painterly';
const TTL = 10*60*1000;
const reply = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const random = () => crypto.randomUUID().replaceAll('-','');

export class LocalQueue {
  constructor(ctx,env) { this.ctx=ctx; this.env=env; }

  async scheduleCleanup() {
    if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(Date.now()+60000);
  }

  async purge(id) {
    await this.ctx.storage.delete('job:'+id);
    await this.env.PAINTERLY_FILES.delete([id+'/photo',id+'/result']);
  }

  async alarm() {
    const jobs = await this.ctx.storage.list({prefix:'job:'});
    const offline = Date.now()-(await this.ctx.storage.get('heartbeat') || 0) > 120000;
    for (const [key,job] of jobs) {
      if (job.expires <= Date.now()) await this.purge(key.slice(4));
      else if (offline && ['processing','uploading'].includes(job.state)) {
        await this.ctx.storage.put(key,{...job,state:'failed'});
        await this.env.PAINTERLY_FILES.delete([key.slice(4)+'/photo',key.slice(4)+'/result']);
      }
    }
    if ((await this.ctx.storage.list({prefix:'job:'})).size) await this.ctx.storage.setAlarm(Date.now()+60000);
  }

  async fetch(request) {
    const path = new URL(request.url).pathname.slice(PREFIX.length);
    if (path.startsWith('/worker/')) return this.worker(request,path.slice(8));
    if (path === '/status') {
      const seen = await this.ctx.storage.get('heartbeat') || 0;
      const available = Date.now()-seen < 90000;
      return reply({available,engine:'Apple SHARP',device:'local',message:available ? 'The local generator is connected. Photos are processed on the host PC.' : 'The local generator is offline. Start it on the host PC to generate a splat.'});
    }
    if (path === '/jobs' && request.method === 'POST') return this.create(request);
    const match = /^\/jobs\/([a-f0-9]{32})(\/result)?$/.exec(path);
    if (!match || !['GET','DELETE'].includes(request.method)) return reply({error:'Not found'},404);
    const id = match[1], job = await this.ctx.storage.get('job:'+id);
    if (!job || job.expires <= Date.now() || request.headers.get('Authorization') !== 'Bearer '+job.token) {
      return reply({error:'This generation has expired or is unavailable.'},404);
    }
    if (request.method === 'DELETE') { await this.purge(id); return reply({deleted:true}); }
    if (!match[2]) return reply({state:job.state});
    if (job.state !== 'ready') return reply({error:'The splat is not ready.'},409);
    const file = await this.env.PAINTERLY_FILES.get(id+'/result');
    if (!file) return reply({error:'The splat has expired.'},404);
    return new Response(file.body,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(file.size),'Cache-Control':'no-store'}});
  }

  async create(request) {
    if (Date.now()-(await this.ctx.storage.get('heartbeat') || 0) > 90000) return reply({error:'The host PC is offline. Start the local generator and try again.'},503);
    if (request.headers.get('Content-Type') !== 'image/jpeg') return reply({error:'Choose a JPEG photo.'},415);
    const length = Number(request.headers.get('Content-Length'));
    if (!Number.isInteger(length) || length < 3 || length > MAX_PHOTO) return reply({error:'Choose a photo under 2 MB.'},413);
    const day = new Date().toISOString().slice(0,10);
    const hash = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(day+request.headers.get('CF-Connecting-IP')));
    const client = [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
    const id = random(), token = random()+random();
    const outcome = await this.ctx.storage.transaction(async tx => {
      const jobs = await tx.list({prefix:'job:'});
      if ([...jobs.values()].filter(j=>j.expires>Date.now() && ['receiving','queued','processing','uploading'].includes(j.state)).length >= 2) return 'The generator is busy. Try again shortly.';
      let budget = await tx.get('budget');
      if (budget?.day !== day) budget = {day,total:0,clients:{}};
      if (budget.total >= 30 || (budget.clients[client] || 0) >= 10) return 'The daily generation limit has been reached.';
      budget.total++; budget.clients[client] = (budget.clients[client] || 0)+1;
      await tx.put('budget',budget);
      await tx.put('job:'+id,{token,state:'receiving',expires:Date.now()+TTL});
      return null;
    });
    if (outcome) return reply({error:outcome},429);
    await this.scheduleCleanup();
    try {
      // Reserve capacity/budget before reading bytes or spending a transformation.
      const original = await boundedBytes(request.body);
      if (original.length !== length || original[0] !== 255 || original[1] !== 216) throw new PhotoError('Choose a valid JPEG photo.');
      const photo = await scrubPhoto(original, this.env.IMAGES);
      await this.env.PAINTERLY_FILES.put(id+'/photo',photo);
      const job = await this.ctx.storage.get('job:'+id);
      if (!job) { await this.purge(id); return reply({error:'Generation expired.'},410); }
      await this.ctx.storage.put('job:'+id,{...job,state:'queued',scrubVersion:SCRUB_VERSION});
    } catch (error) { await this.purge(id); return reply({error:error instanceof PhotoError ? error.message : 'Could not queue the photo. Please try again.'},error instanceof PhotoError ? error.status : 503); }
    return reply({id,token,expiresIn:TTL/1000},202);
  }

  async worker(request,path) {
    if (!this.env.PAINTERLY_WORKER_TOKEN || request.headers.get('Authorization') !== 'Bearer '+this.env.PAINTERLY_WORKER_TOKEN) return reply({error:'Unauthorized'},401);
    if (['claim','heartbeat'].includes(path) && request.method === 'POST') {
      await this.ctx.storage.put('heartbeat',Date.now());
      if (path === 'heartbeat') return reply({ok:true});
      const claimed = await this.ctx.storage.transaction(async tx => {
        const jobs = await tx.list({prefix:'job:'});
        const valid = [...jobs].filter(([,j])=>j.expires>Date.now());
        if (valid.some(([,j])=>['processing','uploading'].includes(j.state))) return null;
        const next = valid.filter(([,j])=>j.state==='queued' && j.scrubVersion===SCRUB_VERSION).sort((a,b)=>a[1].expires-b[1].expires)[0];
        if (!next) return null;
        const lease = random();
        await tx.put(next[0],{...next[1],state:'processing',lease});
        return {id:next[0].slice(4),lease};
      });
      return reply({job:claimed});
    }
    const match = /^jobs\/([a-f0-9]{32})\/(input|result|fail|status)$/.exec(path);
    if (!match) return reply({error:'Not found'},404);
    const [,id,action] = match;
    const job = await this.ctx.storage.get('job:'+id);
    if (!job || job.expires <= Date.now() || request.headers.get('X-Job-Lease') !== job.lease || !['processing','uploading'].includes(job.state)) return reply({error:'Job expired or cancelled'},410);
    if (action === 'status' && request.method === 'GET') return reply({state:job.state});
    if (action === 'input' && request.method === 'GET') {
      if (job.scrubVersion !== SCRUB_VERSION) return reply({error:'Photo must be submitted again for cleaning.'},410);
      const file = await this.env.PAINTERLY_FILES.get(id+'/photo');
      return file ? new Response(file.body,{headers:{'Content-Length':String(file.size),'Content-Type':'image/jpeg'}}) : reply({error:'Photo expired'},404);
    }
    if (action === 'fail' && request.method === 'POST') {
      await this.ctx.storage.put('job:'+id,{...job,state:'failed'});
      await this.env.PAINTERLY_FILES.delete(id+'/photo');
      return reply({ok:true});
    }
    if (action === 'result' && request.method === 'PUT') {
      const size = Number(request.headers.get('Content-Length'));
      if (!Number.isInteger(size) || size < 100 || size > 90*1024*1024) return reply({error:'Invalid result size'},413);
      await this.ctx.storage.put('job:'+id,{...job,state:'uploading'});
      await this.env.PAINTERLY_FILES.put(id+'/result',request.body);
      const latest = await this.ctx.storage.get('job:'+id);
      if (!latest || latest.expires <= Date.now() || latest.state !== 'uploading') { await this.purge(id); return reply({error:'Job cancelled'},410); }
      await this.ctx.storage.put('job:'+id,{...latest,state:'ready'});
      await this.env.PAINTERLY_FILES.delete(id+'/photo');
      return reply({ok:true});
    }
    return reply({error:'Method not allowed'},405);
  }
}
