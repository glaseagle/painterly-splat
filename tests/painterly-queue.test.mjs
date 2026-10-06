import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalQueue } from '../sharp-backend/queue.js';

function setup() {
  const data = new Map(), files = new Map();
  const storage = {
    async get(k) { return structuredClone(data.get(k)); },
    async put(k,v) { data.set(k,structuredClone(v)); },
    async delete(k) { return data.delete(k); },
    async list({prefix}) { return new Map([...data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)])); },
    async getAlarm() { return null; }, async setAlarm() {},
    async transaction(fn) { return fn(storage); },
  };
  const bucket = {
    async put(k,v) { files.set(k,new Uint8Array(await new Response(v).arrayBuffer())); },
    async get(k) { const v=files.get(k); return v ? {body:v,size:v.length} : null; },
    async delete(keys) { for(const k of [keys].flat()) files.delete(k); },
  };
  const queue = new LocalQueue({storage},{PAINTERLY_FILES:bucket,PAINTERLY_WORKER_TOKEN:'worker-secret'});
  const send = (path,method='GET',body,token,lease) => queue.fetch(new Request('https://example.test/api/painterly'+path,{
    method,body,headers:{...(body?{'Content-Length':String(body.length),'Content-Type':'image/jpeg'}:{}),
      ...(token?{Authorization:'Bearer '+token}:{}),...(lease?{'X-Job-Lease':lease}:{}),'CF-Connecting-IP':'127.0.0.1'},
  }));
  return {send,data,files,queue};
}
const jpeg = new Uint8Array([255,216,255,217]);
test('local queue reports offline, authenticates the worker and protects private results',async()=>{
  const {send,files} = setup();
  assert.equal((await send('/status').then(r=>r.json())).available,false);
  assert.equal((await send('/jobs','POST',jpeg)).status,503);
  assert.equal((await send('/worker/claim','POST')).status,401);
  await send('/worker/claim','POST',undefined,'worker-secret');
  assert.equal((await send('/status').then(r=>r.json())).available,true);
  const created = await send('/jobs','POST',jpeg).then(r=>r.json());
  const {job} = await send('/worker/claim','POST',undefined,'worker-secret').then(r=>r.json());
  assert.equal(created.id,job.id);
  assert.equal((await send('/jobs/'+job.id)).status,404);
  assert.equal((await send('/worker/jobs/'+job.id+'/input','GET',undefined,'worker-secret','wrong')).status,410);
  assert.deepEqual(new Uint8Array(await (await send('/worker/jobs/'+job.id+'/input','GET',undefined,'worker-secret',job.lease)).arrayBuffer()),jpeg);
  assert.equal((await send('/worker/claim','POST',undefined,'worker-secret').then(r=>r.json())).job,null);
  const result = new Uint8Array(256).fill(42);
  assert.equal((await send('/worker/jobs/'+job.id+'/result','PUT',result,'worker-secret',job.lease)).status,200);
  assert.equal(files.has(job.id+'/photo'),false);
  assert.deepEqual(new Uint8Array(await (await send('/jobs/'+job.id+'/result','GET',undefined,created.token)).arrayBuffer()),result);
  await send('/jobs/'+job.id,'DELETE',undefined,created.token);
  assert.equal(files.size,0);
});
test('cancelled and expired jobs reject late worker uploads and remove stored files',async()=>{
  const {send,data,files,queue} = setup();
  await send('/worker/claim','POST',undefined,'worker-secret');
  const created = await send('/jobs','POST',jpeg).then(r=>r.json());
  const {job} = await send('/worker/claim','POST',undefined,'worker-secret').then(r=>r.json());
  await send('/jobs/'+job.id,'DELETE',undefined,created.token);
  assert.equal((await send('/worker/jobs/'+job.id+'/result','PUT',new Uint8Array(256),'worker-secret',job.lease)).status,410);
  const expired = await send('/jobs','POST',jpeg).then(r=>r.json());
  data.get('job:'+expired.id).expires = Date.now()-1;
  await queue.alarm();
  assert.equal(files.size,0);
  assert.equal((await send('/jobs/'+expired.id,'GET',undefined,expired.token)).status,404);
});
