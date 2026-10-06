import { DurableObject } from 'cloudflare:workers';
import { LocalQueue } from './queue.js';

const PREFIX = '/api/painterly';
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function painterlyAPI(request, env) {
  const url = new URL(request.url);
  if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return json({error:'Use this website to generate a splat.'},403);
  if (env.PAINTERLY_LOCAL) {
    try { return await env.PAINTERLY_LOCAL.getByName('local-generator').fetch(request); }
    catch { return json({error:'The photo queue is temporarily unavailable.'},503); }
  }
  if (url.pathname === PREFIX+'/status') {
    return json({ available: Boolean(env.PAINTERLY_SHARP), engine: 'Apple SHARP',
      message: env.PAINTERLY_SHARP ? 'CPU generation usually takes a few minutes.' : 'Photo generation is awaiting Cloudflare compute setup. You can still open a splat file.' });
  }
  if (!env.PAINTERLY_SHARP) return json({ error: 'Photo generation is not available yet.' }, 503);
  if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) {
    return json({ error: 'Use the camera on this website.' }, 403);
  }
  const valid = (url.pathname === PREFIX+'/jobs' && request.method === 'POST') ||
    (new RegExp(`^${PREFIX}/jobs/[a-f0-9]{32}(/result)?$`).test(url.pathname) && ['GET','DELETE'].includes(request.method));
  if (!valid) return json({ error: 'Not found' }, 404);
  try {
    return await env.PAINTERLY_SHARP.getByName('single-cpu-generator').fetch(request);
  } catch {
    return json({ error: 'The generator is restarting. Please try again shortly.' }, 503);
  }
}

export class PainterlyLocal extends DurableObject {
  constructor(ctx,env) { super(ctx,env); this.queue = new LocalQueue(ctx,env); }
  fetch(request) { return this.queue.fetch(request); }
  alarm() { return this.queue.alarm(); }
}

export class PainterlySharp extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    if (ctx.container?.running) ctx.blockConcurrencyWhile(() => ctx.container.setInactivityTimeout(120000));
  }

  async fetch(request) {
    const container = this.ctx.container;
    const url = new URL(request.url);
    let body;
    if (request.method === 'POST') {
      if (request.headers.get('Content-Type') !== 'image/jpeg') return json({ error: 'Send a JPEG photo.' }, 415);
      const reader = request.body?.getReader();
      if (!reader) return json({ error: 'Choose a photo.' }, 400);
      const chunks = []; let size = 0;
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2*1024*1024) { await reader.cancel(); return json({ error: 'Choose a photo under 2 MB.' }, 413); }
        chunks.push(value);
      }
      body = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
      if (body[0] !== 255 || body[1] !== 216) return json({ error: 'Choose a JPEG photo.' }, 400);
      const day = new Date().toISOString().slice(0,10);
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(day+request.headers.get('CF-Connecting-IP'))));
      const key = [...hash].map(b => b.toString(16).padStart(2,'0')).join('');
      const allowed = await this.ctx.storage.transaction(async tx => {
        let budget = await tx.get('budget');
        if (budget?.day !== day) budget = { day, total: 0, users: {} };
        if (budget.total >= 20 || (budget.users[key] || 0) >= 3) return false;
        budget.total++; budget.users[key] = (budget.users[key] || 0)+1;
        await tx.put('budget', budget); return true;
      });
      if (!allowed) return json({ error: 'The daily photo generation limit has been reached. Try again tomorrow.' }, 429);
      if (!container.running) container.start({ image: container.images.base, instance: 'standard-4', enableInternet: false });
      await container.setInactivityTimeout(120000);
      // Absolute lifetime prevents polling or abandoned requests from keeping compute on indefinitely.
      await this.ctx.storage.setAlarm(Date.now()+10*60*1000);
      const port = container.getTcpPort(8080);
      let started = false;
      for (let i = 0; i < 30; i++) {
        try { if ((await port.fetch('http://container'+PREFIX+'/status')).ok) { started = true; break; } } catch {}
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (!started) return json({ error: 'The generator is warming up. Please try again in a minute.' }, 503);
    } else if (!container.running) {
      return json({ error: 'This generation has expired. Take another photo.' }, 404);
    }
    const headers = new Headers({ 'Authorization': request.headers.get('Authorization') || '' });
    if (body) { headers.set('Content-Type', 'image/jpeg'); headers.set('Content-Length', String(body.length)); }
    return container.getTcpPort(8080).fetch('http://container'+url.pathname, { method: request.method, headers, body });
  }

  async alarm() {
    if (this.ctx.container?.running) await this.ctx.container.destroy();
  }
}
