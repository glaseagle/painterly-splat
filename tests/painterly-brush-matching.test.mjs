import assert from 'node:assert/strict';
import test from 'node:test';
import { brushFamilies, chooseBrush } from '../painterly-brush-matching.js';

test('the matcher can select every distinct drawing tool', () => {
  brushFamilies.forEach((descriptor, i) => assert.equal(chooseBrush(descriptor), i, descriptor.name));
});

test('a flat Gaussian changes from a wash to a line as it turns edge-on', () => {
  // Orthographic projection of one oblate 3D Gaussian: sigma=(7, 7, .25).
  // Camera yaw changes apparent horizontal variance while vertical stays fixed.
  const projected = angle => {
    const theta = angle * Math.PI / 180;
    const horizontal = Math.hypot(7 * Math.cos(theta), .25 * Math.sin(theta));
    return { aspect: 7 / horizontal, width: horizontal, opacity: .7, luma: .6 };
  };
  assert.equal(chooseBrush(projected(0)), 0, 'front-facing surface is a watercolor wash');
  assert.match(brushFamilies[chooseBrush(projected(82))].name, /Pencil/, 'grazing surface becomes a pencil mark');
  assert.ok(brushFamilies[chooseBrush(projected(88))].aspect >= 10, 'thin silhouette becomes a fine line');
});

test('matching is stable for a stationary view and reversible after moving', () => {
  const start = { aspect: 3.1, width: 4.4, opacity: .96, luma: .62 };
  const first = chooseBrush(start);
  for (let i = 0; i < 100; i++) {
    chooseBrush({ ...start, aspect: 1 + i / 4 });
    assert.equal(chooseBrush(start), first);
  }
});


test('disabled tools never win matching, including when only one remains', () => {
  const enabled = brushFamilies.map((_,i)=>Number(i===10));
  for (const descriptor of brushFamilies) assert.equal(chooseBrush(descriptor,enabled),10);
});

test('every built-in p5.brush tool is represented alongside custom paint', () => {
  const tools = new Set(brushFamilies.map(b=>b.tool));
  for (const tool of ['2B','HB','2H','cpencil','pen','rotring','spray','marker','pastel','charcoal','crayon']) assert.ok(tools.has(tool),tool);
});
