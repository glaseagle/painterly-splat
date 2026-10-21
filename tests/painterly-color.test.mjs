import assert from 'node:assert/strict';
import test from 'node:test';
import { COLOR_PRESETS, colorStyle, gradeColor } from '../painterly-color.js';

test('neutral color correction leaves source color unchanged', () => {
  const source=[.18,.46,.82];
  assert.deepEqual(gradeColor(source),source);
});

test('color tools provide predictable exposure, saturation and warmth', () => {
  const source=[.2,.4,.8];
  const brighter=gradeColor(source,colorStyle({exposure:50,contrast:100,saturation:100,warmth:0}));
  assert.ok(brighter.every((value,index)=>value>source[index]));
  const gray=gradeColor(source,colorStyle({exposure:0,contrast:100,saturation:0,warmth:0}));
  assert.ok(gray.every(value=>Math.abs(value-gray[0])<1e-12));
  const warm=gradeColor(source,colorStyle(COLOR_PRESETS.warm));
  const warmControl=gradeColor(source,colorStyle({...COLOR_PRESETS.warm,warmth:0}));
  assert.ok(warm[0]-warm[2]>warmControl[0]-warmControl[2]);
});

test('every color preset stays in the slider ranges', () => {
  for(const preset of Object.values(COLOR_PRESETS)){
    assert.ok(preset.exposure>=-100&&preset.exposure<=100);
    assert.ok(preset.contrast>=0&&preset.contrast<=200);
    assert.ok(preset.saturation>=0&&preset.saturation<=200);
    assert.ok(preset.warmth>=-100&&preset.warmth<=100);
  }
});
