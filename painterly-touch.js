import { Vector3 } from 'three';
import { OrbitControls } from './vendor/three/OrbitControls.js';

// Upstream touch gestures, with mouse/keyboard navigation left to FlyControls.
export function createTouchControls(camera, element, onChange, options = {}) {
  const position = camera.position.clone(), rotation = camera.quaternion.clone();
  const orbit = new OrbitControls(camera);
  camera.position.copy(position); camera.quaternion.copy(rotation);
  let distance = options.distance ?? Math.max(.25, position.length());
  const direction = new Vector3();
  const syncTarget = () => {
    camera.getWorldDirection(direction);
    orbit.target.copy(camera.position).addScaledVector(direction, distance);
    camera.updateMatrixWorld(true);
  };
  syncTarget();
  orbit.rotateSpeed = .65;
  orbit.minDistance = options.minDistance ?? .05; orbit.maxDistance = options.maxDistance ?? 8;
  orbit.enableDamping = false;
  const down = orbit._onPointerDown, move = orbit._onPointerMove, up = orbit._onPointerUp;
  orbit._onPointerDown = event => {
    if (event.pointerType !== 'touch' || !orbit.enabled) return;
    if (!orbit._pointers.length) syncTarget();
    down(event);
  };
  orbit._onPointerMove = event => { if (event.pointerType === 'touch') move(event); };
  orbit._onPointerUp = event => { if (event.pointerType === 'touch') up(event); };
  orbit.domElement = element;
  orbit.connect();
  element.removeEventListener('wheel', orbit._onMouseWheel);
  orbit.addEventListener('change', () => { distance = orbit.getDistance(); onChange(); });
  return orbit;
}
