import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){return next(specifier==='three'?new URL('../vendor/three/three.module.js',import.meta.url).href:specifier,context);}});
const {PerspectiveCamera,Vector3}=await import('three');
const {createOrbitCamera,unprojectDepth}=await import('../painterly-navigation.js');
class Surface extends EventTarget{
 style={};clientWidth=800;clientHeight=600;root=new EventTarget();
 getRootNode(){return this.root;}setPointerCapture(){}releasePointerCapture(){}
 pointer(type,x,y,button=0){const event=new Event(type);Object.assign(event,{pointerId:1,pointerType:'mouse',pageX:x,pageY:y,clientX:x,clientY:y,button,ctrlKey:false,shiftKey:false,metaKey:false});this.dispatchEvent(event);}
}
function setup(){const camera=new PerspectiveCamera(50,4/3,.01,100);camera.position.set(0,0,4);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);const surface=new Surface();const controls=createOrbitCamera(camera,surface,new Vector3(),()=>camera.updateMatrixWorld(true));return {camera,surface,controls};}
test('mouse orbit preserves pivot and camera radius',()=>{
 const {camera,surface,controls}=setup();const start=camera.position.clone();
 surface.pointer('pointerdown',300,300);surface.pointer('pointermove',440,330);surface.pointer('pointerup',440,330);
 assert.ok(camera.position.distanceTo(start)>.1);assert.ok(Math.abs(camera.position.length()-4)<1e-6);assert.equal(controls.target.length(),0);controls.dispose();
});
test('right-drag pans camera and orbit pivot together',()=>{
 const {camera,surface,controls}=setup();const relative=camera.position.clone().sub(controls.target);
 surface.pointer('pointerdown',300,300,2);surface.pointer('pointermove',350,330,2);surface.pointer('pointerup',350,330,2);
 assert.ok(controls.target.length()>.01);assert.ok(camera.position.clone().sub(controls.target).distanceTo(relative)<1e-6);controls.dispose();
});
test('auto orbit advances by elapsed time while preserving its pivot and radius',()=>{
 const {camera,controls}=setup();const start=camera.position.clone();controls.autoRotate=true;controls.autoRotateSpeed=.55;
 controls.update(.14);camera.updateMatrixWorld(true);
 assert.ok(camera.position.distanceTo(start)>.001);assert.ok(Math.abs(camera.position.length()-4)<1e-6);assert.equal(controls.target.length(),0);controls.dispose();
});
test('unprojected line vertices return to their source image and stay fixed as camera moves',()=>{
 const {camera,controls}=setup();const point=unprojectDepth(240,200,3,800,600,camera),fixed=point.clone();
 const screen=point.clone().project(camera);assert.ok(Math.abs(screen.x-((240.5/800)*2-1))<1e-6);assert.ok(Math.abs(screen.y-((200.5/600)*2-1))<1e-6);
 camera.position.x+=1;camera.updateMatrixWorld(true);assert.ok(point.clone().project(camera).distanceTo(screen)>.1);assert.deepEqual(point.toArray(),fixed.toArray());controls.dispose();
});
