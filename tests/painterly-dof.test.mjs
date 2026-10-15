import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){return next(specifier==='three'?new URL('../vendor/three/three.module.js',import.meta.url).href:specifier,context);}});
const {depthOfFieldRadius}=await import('../painterly-dof.js');

test('depth of field keeps the focus plane sharp',()=>{
  assert.equal(depthOfFieldRadius(3,3,.7,18),0);
});
test('aperture and blur independently increase defocus',()=>{
  const low=depthOfFieldRadius(3.1,3,.2,18),wide=depthOfFieldRadius(3.1,3,.8,18),strong=depthOfFieldRadius(3.1,3,.8,24);
  assert.ok(low<wide);assert.ok(strong>wide);
});
test('depth of field rejects missing depth and clamps to the requested blur radius',()=>{
  assert.equal(depthOfFieldRadius(0,3,1,18),0);
  assert.equal(depthOfFieldRadius(30,3,1,18),18);
});
