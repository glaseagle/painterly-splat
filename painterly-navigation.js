import * as THREE from 'three';
import { OrbitControls } from './vendor/three/OrbitControls.js';

export function unprojectDepth(x,y,depth,width,height,camera,target=new THREE.Vector3()) {
  target.set((x+.5)/width*2-1,(y+.5)/height*2-1,.5).applyMatrix4(camera.projectionMatrixInverse);
  target.multiplyScalar(depth/-target.z).applyMatrix4(camera.matrixWorld);
  return target;
}

export function createOrbitCamera(camera, element, target, onChange) {
  const position=camera.position.clone(), rotation=camera.quaternion.clone();
  const controls=new OrbitControls(camera);
  camera.position.copy(position);camera.quaternion.copy(rotation);
  controls.target.copy(target);
  controls.enableDamping=false;controls.rotateSpeed=.65;controls.screenSpacePanning=true;
  controls.minDistance=.005;controls.maxDistance=1000;
  controls.minPolarAngle=.001;controls.maxPolarAngle=Math.PI-.001;
  controls.addEventListener('change',onChange);
  controls.domElement=element;controls.connect();
  return controls;
}

export function createCursor() {
  const root=new THREE.Group();
  const axes=new THREE.BufferGeometry();
  axes.setAttribute('position',new THREE.Float32BufferAttribute([-1,0,0,1,0,0,0,-1,0,0,1,0,0,0,-1,0,0,1],3));
  axes.setAttribute('color',new THREE.Float32BufferAttribute([1,.3,.15,1,.3,.15,.3,1,.5,.3,1,.5,.3,.65,1,.3,.65,1],3));
  root.add(new THREE.LineSegments(axes,new THREE.LineBasicMaterial({vertexColors:true,depthTest:false,toneMapped:false})));
  for(let axis=0;axis<3;axis++) {
    const points=Array.from({length:49},(_,i)=>new THREE.Vector3(Math.cos(i/48*Math.PI*2)*.65,Math.sin(i/48*Math.PI*2)*.65,0));
    const ring=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0xffde9b,transparent:true,opacity:.8,depthTest:false,toneMapped:false}));
    if(axis===1)ring.rotation.x=Math.PI/2;if(axis===2)ring.rotation.y=Math.PI/2;root.add(ring);
  }
  return {root,update(camera,height) {
    const distance=root.position.distanceTo(camera.position);
    root.scale.setScalar(Math.max(.00001,2*distance*Math.tan(camera.fov*Math.PI/360)*14/height));
  },dispose(){root.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}};
}
