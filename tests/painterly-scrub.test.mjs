import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { boundedBytes, stripJpegMetadata, scrubPhoto } from '../sharp-backend/scrub.js';

const photo = new Uint8Array(readFileSync(new URL('../logo.jpg',import.meta.url)));
const clean = stripJpegMetadata(photo);
const payload = new TextEncoder().encode('Exif\0\0PRIVATE-GPS-TEST');
const tagged = new Uint8Array([255,216,255,225,0,payload.length+2,...payload,...photo.subarray(2),...payload]);

test('rebuilt JPEG loses EXIF and trailing payloads while keeping image data',()=>{
  assert.deepEqual(stripJpegMetadata(tagged),clean);
  assert.throws(()=>stripJpegMetadata(photo.subarray(0,photo.length-20)));
});

test('progressive scans, stuffed bytes and restart markers survive metadata removal',()=>{
  const scans = new Uint8Array([255,216,255,218,0,2,1,255,0,2,255,208,3,255,218,0,2,4,255,217]);
  assert.deepEqual(stripJpegMetadata(scans),scans);
});

test('cloud decoder rejects oversized dimensions before transforming',async()=>{
  await assert.rejects(scrubPhoto(photo,{info:async()=>({format:'image/jpeg',width:10000,height:10000}),input:()=>{throw new Error('must not transform');}}),/4 million/);
  await assert.rejects(scrubPhoto(photo),/unavailable/);
});

test('cloud pipeline queues freshly encoded bytes and strips residual metadata',async()=>{
  let consumed=false;
  const images = {
    info:async()=>({format:'image/jpeg',width:1600,height:1200}),
    input(stream) { return {transform(options) {
      assert.equal(options.fit,'scale-down'); assert.equal(options.width,1280);
      return {async output(options) {
        assert.equal(options.format,'image/jpeg');
        assert.deepEqual(new Uint8Array(await new Response(stream).arrayBuffer()),photo);
        consumed=true; return {response:()=>new Response(tagged)};
      }};
    }};},
  };
  assert.deepEqual(await scrubPhoto(photo,images),clean); assert.ok(consumed);
});

test('stream limits reject a lying length and stop a stalled upload',async()=>{
  await assert.rejects(boundedBytes(new Blob([new Uint8Array(30)]).stream(),20),/under 2 MB/);
  await assert.rejects(boundedBytes(new ReadableStream({}),20,10),/timed out/);
});
