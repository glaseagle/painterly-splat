import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){return next(specifier==='three'?new URL('../vendor/three/three.module.js',import.meta.url).href:specifier,context);}});
const {focusFalloff,focusStrokeStyle}=await import('../painterly-dof.js');

test('focus plane keeps the exact requested stroke size and opacity',()=>{
  assert.deepEqual(focusStrokeStyle(3,3,.7,.8),{falloff:0,size:1,opacity:1});
});
test('front and back distances have symmetric falloff',()=>{
  assert.equal(focusFalloff(2,3,.7),focusFalloff(4,3,.7));
});
test('aperture narrows the true-size region and bloom raises size and opacity',()=>{
  const broad=focusStrokeStyle(3.3,3,.2,.7),narrow=focusStrokeStyle(3.3,3,.9,.7),strong=focusStrokeStyle(3.3,3,.9,1);
  assert.ok(broad.falloff<narrow.falloff);assert.ok(strong.size>narrow.size);assert.ok(strong.opacity>narrow.opacity);
});
test('focus falloff rejects missing depth and clamps distant marks',()=>{
  assert.equal(focusFalloff(0,3,1),0);
  assert.deepEqual(focusStrokeStyle(30,3,1,1),{falloff:1,size:2.4,opacity:1.75});
});
