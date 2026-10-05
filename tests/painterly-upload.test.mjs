import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareLocalSplat, parsePlyHeader, cameraFromPlyMetadata, fittedCamera, MAX_LOCAL_BYTES } from '../painterly-upload.js';
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
  assert.ok(fit.camera.position[2] > fit.radius);
  assert.throws(() => fittedCamera([[NaN,0,0]]), /finite/);
});
