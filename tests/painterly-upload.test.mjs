import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareLocalSplat, parsePlyHeader, cameraFromPlyMetadata, fittedCamera, normalizeImport, MAX_LOCAL_BYTES } from '../painterly-upload.js';
import { sharpFixture } from './upload-fixtures.mjs';

test('SHARP metadata restores its camera and leaves every Gaussian byte intact', async () => {
  const original = sharpFixture();
  const prepared = await prepareLocalSplat(new File([original], 'photo.ply'));
  assert.deepEqual(prepared.camera.rotation, [[1,0,0],[0,1,0],[0,0,1]]);
  assert.equal(prepared.camera.fx,512);
  assert.equal(prepared.camera.width,640);
  assert.equal(prepared.camera.height,480);
  assert.ok(prepared.camera.position.every(n => n === 0));
  const before = parsePlyHeader(new Uint8Array(original));
  const bytes = new Uint8Array(await prepared.blob.arrayBuffer());
  const after = parsePlyHeader(bytes);
  assert.equal(after.elements.length,1);
  assert.deepEqual(bytes.subarray(after.headerBytes), new Uint8Array(original,before.headerBytes,before.vertex.count*before.vertex.rowBytes));
});

test('CRLF and uppercase extensions normalize correctly without metadata', async () => {
  const prepared = await prepareLocalSplat(new File([sharpFixture({crlf:true,metadata:false})], 'scan.PLY'));
  assert.equal(prepared.camera,null);
  assert.equal(parsePlyHeader(new Uint8Array(await prepared.blob.arrayBuffer())).vertex.count,441);
});

test('empty, oversized, unsupported and truncated files are rejected before loading', async () => {
  await assert.rejects(prepareLocalSplat(new File([], 'empty.ply')), /empty/);
  await assert.rejects(prepareLocalSplat({size:MAX_LOCAL_BYTES+1,name:'big.ply'}), /256 MB/);
  await assert.rejects(prepareLocalSplat(new File(['hello'], 'photo.jpg')), /Choose a/);
  await assert.rejects(prepareLocalSplat(new File([new Uint8Array(33)], 'bad.splat')), /incomplete/);
  await assert.rejects(prepareLocalSplat(new File([sharpFixture().slice(0,-4)], 'bad.ply')), /truncated/);
});

test('plain PLY meshes cannot masquerade as Gaussian splats', async () => {
  const header = 'ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n';
  await assert.rejects(prepareLocalSplat(new File([header,new Uint8Array(12)],'mesh.ply')), /point cloud or mesh/);
});

test('raw splat and ksplat preserve the original file Blob', async () => {
  for (const [name,size] of [['a.splat',64],['a.ksplat',8192]]) {
    const file = new File([new Uint8Array(size)],name);
    assert.equal((await prepareLocalSplat(file)).blob,file);
  }
});

test('legacy intrinsics and camera translation are interpreted in OpenCV coordinates', () => {
  const camera = cameraFromPlyMetadata({intrinsic:[512,512,640,480],extrinsic:[1,0,0,-2,0,1,0,-3,0,0,1,-4,0,0,0,1]});
  assert.deepEqual(camera.position,[2,3,4]);
  assert.equal(cameraFromPlyMetadata({intrinsic:[NaN,512,640,480]}),null);
});

test('automatic framing ignores invalid centers and sparse extreme outliers', () => {
  const points = Array.from({length:200},(_,i) => [i/100,0,0]);
  points.push([1e9,1e9,1e9],[NaN,0,0]);
  const fit = fittedCamera(points);
  assert.ok(fit.radius < 2);
  assert.ok(fit.camera.position[2] < -fit.radius);
  assert.throws(() => fittedCamera([[NaN,0,0]]), /finite/);
});

test('microscopic and enormous imports share the same normalized framing and OpenCV up', () => {
  const points = Array.from({length:200},(_,i) => [i/100, Math.sin(i), i/200]);
  const normal = normalizeImport(points);
  for (const scale of [1e-7, 1e7]) {
    const scaled = normalizeImport(points.map(p => p.map(v => (v+8)*scale)));
    assert.ok(Math.abs(scaled.distance-normal.distance) < 1e-8);
    assert.ok(scaled.camera.position.every((v,i) => Math.abs(v-normal.camera.position[i]) < 1e-8));
  }
  assert.deepEqual(normal.camera.rotation, [[1,0,0],[0,1,0],[0,0,1]]);
});

test('SHARP imports keep orientation but pull back from a close-up capture pose', () => {
  const points = [[1,2,8],[3,4,10],[2,3,9]];
  const camera = cameraFromPlyMetadata({intrinsic:[512,512,640,480]});
  const fit = normalizeImport(points, camera);
  const halfAngle = Math.atan(camera.height/(2*camera.fy));
  assert.ok(Math.asin(1/fit.distance) < halfAngle*.7);
  assert.deepEqual(fit.camera.rotation, camera.rotation);
});

test('wide Gaussian footprints are included even when all centers nearly coincide', () => {
  const points = [[0,0,0],[.001,0,0],[0,.001,0]];
  const compact = normalizeImport(points);
  const broad = normalizeImport(points,null,[3,3,3]);
  assert.ok(broad.scale[0] < compact.scale[0]/1000);
  const smaller = normalizeImport(points,null,[3,3,3],.35);
  assert.ok(smaller.distance > broad.distance*1.8);
});
