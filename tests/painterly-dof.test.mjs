import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){return next(specifier==='three'?new URL('../vendor/three/three.module.js',import.meta.url).href:specifier,context);}});
const {circleOfConfusion,focusFalloff,focusStrokeStyle,lensPresets}=await import('../painterly-dof.js');

test('focus plane keeps the exact requested stroke size and opacity',()=>{
  assert.deepEqual(focusStrokeStyle(3,3,.7,.8),{falloff:0,size:1,opacity:1});
});
test('thin-lens response has a finite background limit and stronger near-camera blur',()=>{
  assert.ok(circleOfConfusion(300,3)<1);
  assert.ok(circleOfConfusion(300,3)>circleOfConfusion(30,3));
  assert.ok(circleOfConfusion(.3,3)>circleOfConfusion(300,3));
});
test('aperture narrows the true-size region and bloom raises size and opacity',()=>{
  const broad=focusStrokeStyle(3.3,3,.2,.7),narrow=focusStrokeStyle(3.3,3,.9,.7),strong=focusStrokeStyle(3.3,3,.9,1);
  assert.ok(broad.falloff<narrow.falloff);assert.ok(strong.size>narrow.size);assert.ok(strong.opacity>narrow.opacity);
});
test('focus falloff rejects missing depth and approaches its background limit gradually',()=>{
  assert.equal(focusFalloff(0,3,1),0);
  assert.ok(focusFalloff(3.3,3,.76)<focusFalloff(6,3,.76));
  assert.ok(focusFalloff(6,3,.76)<focusFalloff(300,3,.76));
  assert.ok(focusStrokeStyle(300,3,1,1).size<2.4);
});
test('lens presets progress from restrained environmental depth to bright dream bokeh',()=>{
  assert.ok(lensPresets.environmental.aperture<lensPresets.portrait.aperture);
  assert.ok(lensPresets.portrait.farBias>lensPresets.classic.farBias);
  assert.ok(lensPresets.dream.bokeh>lensPresets.telephoto.bokeh);
});
