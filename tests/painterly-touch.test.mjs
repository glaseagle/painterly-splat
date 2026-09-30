import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

// Apply the page's import map to the same vendored controls under Node.
registerHooks({ resolve(specifier, context, next) {
  return next(specifier === 'three' ? new URL('../vendor/three/three.module.js', import.meta.url).href : specifier, context);
} });
const { PerspectiveCamera, Vector3 } = await import('three');
const { createTouchControls } = await import('../painterly-touch.js');

class Surface extends EventTarget {
  style = {}; clientWidth = 390; clientHeight = 844;
  root = new EventTarget();
  getRootNode() { return this.root; }
  setPointerCapture() {}
  releasePointerCapture() {}
  pointer(type, id, x, y, pointerType = 'touch') {
    const event = new Event(type);
    Object.assign(event, { pointerId: id, pointerType, pageX: x, pageY: y, clientX: x, clientY: y, button: 0 });
    this.dispatchEvent(event);
  }
}
function setup() {
  const camera = new PerspectiveCamera(60, 390 / 844, .01, 2000);
  camera.position.set(.4, .3, .8); camera.lookAt(0, .1, 0); camera.updateMatrixWorld(true);
  const surface = new Surface();
  const initialPosition = camera.position.clone(), initialRotation = camera.quaternion.clone();
  const controls = createTouchControls(camera, surface, () => camera.updateMatrixWorld(true));
  return { camera, surface, controls, initialPosition, initialRotation };
}
test('initial capture pose is preserved; one finger orbits a fixed target', () => {
  const { camera, surface, controls, initialPosition, initialRotation } = setup();
  assert.ok(camera.position.distanceTo(initialPosition) < 1e-10);
  assert.ok(camera.quaternion.angleTo(initialRotation) < 1e-7);
  const radius = controls.getDistance(), target = controls.target.clone();
  surface.pointer('pointerdown', 1, 120, 300);
  surface.pointer('pointermove', 1, 190, 320);
  assert.ok(camera.position.distanceTo(initialPosition) > .01);
  assert.ok(camera.quaternion.angleTo(initialRotation) > .01);
  assert.ok(Math.abs(controls.getDistance() - radius) < 1e-8);
  assert.ok(controls.target.distanceTo(target) < 1e-8);
  surface.pointer('pointerup', 1, 190, 320); controls.dispose();
});
test('two fingers pan without rotating, pinch zooms, releasing one finger does not jump', () => {
  const { camera, surface, controls } = setup();
  const rotation = camera.quaternion.clone(), target = controls.target.clone();
  surface.pointer('pointerdown', 1, 100, 300); surface.pointer('pointerdown', 2, 200, 300);
  surface.pointer('pointermove', 1, 120, 330); surface.pointer('pointermove', 2, 220, 330);
  assert.ok(controls.target.distanceTo(target) > .01);
  assert.ok(camera.quaternion.angleTo(rotation) < 1e-7);
  const radius = controls.getDistance();
  surface.pointer('pointermove', 1, 90, 330); surface.pointer('pointermove', 2, 250, 330);
  assert.ok(controls.getDistance() < radius);
  surface.pointer('pointerup', 2, 250, 330);
  const position = camera.position.clone();
  surface.pointer('pointermove', 1, 90, 330);
  assert.ok(camera.position.distanceTo(position) < 1e-8);
  surface.pointer('pointercancel', 1, 90, 330); controls.dispose();
});
test('mouse navigation remains independent and touch syncs after fly movement', () => {
  const { camera, surface, controls, initialPosition } = setup();
  surface.pointer('pointerdown', 1, 100, 300, 'mouse');
  surface.pointer('pointermove', 1, 250, 400, 'mouse');
  surface.pointer('pointerup', 1, 250, 400, 'mouse');
  assert.ok(camera.position.distanceTo(initialPosition) < 1e-10);
  camera.translateX(.2); camera.rotateY(.15); camera.updateMatrixWorld(true);
  const position = camera.position.clone(), direction = camera.getWorldDirection(new Vector3());
  surface.pointer('pointerdown', 2, 120, 300);
  assert.ok(controls.target.clone().sub(camera.position).normalize().distanceTo(direction) < 1e-8);
  surface.pointer('pointermove', 2, 120, 300);
  assert.ok(camera.position.distanceTo(position) < 1e-8);
  surface.pointer('pointercancel', 2, 120, 300); controls.dispose();
  surface.pointer('pointerdown', 3, 120, 300); surface.pointer('pointermove', 3, 200, 400);
  assert.ok(camera.position.distanceTo(position) < 1e-8);
});
