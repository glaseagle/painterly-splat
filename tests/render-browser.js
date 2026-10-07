import * as THREE from 'three';
import { createLineArt } from '../painterly-lineart.js?v=lineart-1';
import { brushFamilies } from '../painterly-brush-matching.js?v=brushes-2';
import { checkBrushes } from './brush-browser.js?v=brushes-2';

const renderer=new THREE.WebGLRenderer();renderer.setSize(128,128);
let passed=0,failed=0;
function check(name,run){
  const item=document.createElement('li');
  try{run();item.textContent=`PASS: ${name}`;passed++;}
  catch(error){item.textContent=`FAIL: ${name}: ${error.message}`;item.className='fail';failed++;}
  document.querySelector('#results').append(item);
}
function assert(value,message){if(!value)throw new Error(message);}
checkBrushes(renderer,check);

// Two contrasting, adjoining surfaces use the same shader hook as the real
// splat renderer, with known depth and a sharp edge for visible-pixel checks.
const geometry=new THREE.BufferGeometry(),positions=[],colors=[];
for(const [left,right,tone]of[[-1,0,.05],[0,1,.85]]){
  positions.push(left,-1,0,right,-1,0,right,1,0,left,-1,0,right,1,0,left,1,0);
  for(let i=0;i<6;i++)colors.push(tone,tone,tone);
}
geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
const source=new THREE.ShaderMaterial({transparent:true,
  vertexShader:`attribute vec3 color;varying vec4 vColor;varying vec2 vPosition;
    void main(){vColor=vec4(color,1.0);vPosition=vec2(0.0);
      vec4 viewCenter=modelViewMatrix*vec4(position,1.0);
      vec2 ndcOffset = vec2(0.0);gl_Position=projectionMatrix*viewCenter;gl_Position.xy+=ndcOffset;}`,
  fragmentShader:'varying vec4 vColor;void main(){gl_FragColor=vColor;}',
});
const mesh=new THREE.Mesh(geometry,source),camera=new THREE.PerspectiveCamera(60,1,.01,100);
camera.position.z=3;camera.updateMatrixWorld(true);
const atlas=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);atlas.needsUpdate=true;
const lines=createLineArt(renderer,mesh,atlas),target=new THREE.WebGLRenderTarget(128,128);
const pixels=new Uint8Array(128*128*4);
function ink(amount=1){
  renderer.setRenderTarget(target);renderer.setClearColor(0xffffff,1);renderer.clear();
  lines.render(camera,amount,2);renderer.readRenderTargetPixels(target,0,0,128,128,pixels);
  renderer.setRenderTarget(null);let dark=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]<200)dark++;
  return dark;
}
check('lineart capture restores renderer state and source material',()=>{
  renderer.setRenderTarget(target);renderer.setClearColor(0x123456,.4);renderer.autoClear=false;
  lines.captureDepth(camera,128,128);
  assert(renderer.getRenderTarget()===target&&mesh.material===source&&!renderer.autoClear,'capture leaked state');
  assert(renderer.getClearColor(new THREE.Color()).getHex()===0x123456&&renderer.getClearAlpha()===.4,'clear color changed');
  renderer.autoClear=true;renderer.setRenderTarget(null);
});
check('cursor picks actual surface depth and rejects empty background',()=>{
  const p=lines.pick(.5,.5);assert(p&&Math.abs(p.z)<.0001,`wrong surface depth ${p?.z}`);
  assert(lines.pick(.01,.01)===null,'background became a surface');
});
check('Canny paths produce visible brush-textured 3D geometry',()=>{
  lines.rebuild(camera,128,128,.65,brushFamilies.map(()=>1));
  assert(lines.count>2,`only ${lines.count} paths`);assert(ink()>100,'paths produced no visible ink');
});
check('zero line amount leaves the base image untouched',()=>assert(ink(0)===0,'disabled lines are visible'));
check('new foreground surface occludes the previously projected strokes',()=>{
  mesh.position.z=1;mesh.updateMatrixWorld(true);lines.captureDepth(camera,128,128);
  assert(ink()===0,'strokes show through a nearer surface');
});
lines.dispose();geometry.dispose();source.dispose();atlas.dispose();target.dispose();renderer.dispose();
document.querySelector('#status').textContent=`${passed} passed · ${failed} failed`;
document.body.dataset.result=failed?'fail':'pass';
