import test from 'node:test';
import assert from 'node:assert/strict';
import {cannyEdges,traceEdges,decodeDepth} from '../painterly-edges.js';
const w=64,h=64;
function field(fn){return Float32Array.from({length:w*h},(_,i)=>fn(i%w,Math.floor(i/w)));}
test('Canny rejects flat regions and thins vertical and diagonal boundaries',()=>{
 assert.equal(cannyEdges(field(()=>.5),w,h).edges.reduce((a,b)=>a+b,0),0);
 for(const diagonal of [false,true]){
  const {edges}=cannyEdges(field((x,y)=>x>(diagonal?y:32)?1:0),w,h);
  for(let y=10;y<54;y++){
   const xs=[];for(let x=0;x<w;x++)if(edges[y*w+x])xs.push(x);
   assert.ok(xs.length>=1&&xs.length<=2,`thin edge at row ${y}: ${xs}`);
   assert.ok(xs.every(x=>Math.abs(x-(diagonal?y:32))<=2));
  }
 }
});
test('hysteresis preserves weak connected edges but rejects isolated weak edges',()=>{
 const {edges}=cannyEdges(field((x,y)=>x>32?(y<8?1:y>36?.22:1-.78*(y-8)/28):(x>5&&x<16&&y>40&&y<55?.15:0)),w,h,{high:.12,low:.025});
 let connected=0,isolated=0;
 for(let y=40;y<53;y++)for(let x=0;x<w;x++)if(edges[y*w+x]){if(x>29&&x<36)connected++;if(x<20)isolated++;}
 assert.ok(connected>8);assert.equal(isolated,0);
});
test('traced strokes stop at depth discontinuities and never attach to missing depth',()=>{
 const edges=new Uint8Array(w*h),depths=new Float32Array(w*h);
 for(let x=5;x<55;x++){edges[32*w+x]=1;depths[32*w+x]=x<30?1:3;}
 const paths=traceEdges(edges,depths,w,h,{maxPoints:60});assert.equal(paths.length,2);
 assert.ok(paths.every(p=>p.every(i=>depths[i]===depths[p[0]])));
 depths.fill(0);assert.equal(traceEdges(edges,depths,w,h).length,0);
});
test('edge extraction and tracing are deterministic for stationary cameras',()=>{
 const gray=field((x,y)=>x*x+y*y>1300?1:0),depths=field(()=>2);
 const run=()=>traceEdges(cannyEdges(gray,w,h).edges,depths,w,h);
 assert.deepEqual(run(),run());assert.ok(run().length>0);
});
test('depth decoding preserves metric distance and rejects uncovered pixels',()=>{
 const distance=3.4,n=Math.floor(Math.log2(1+distance)/16*16777215);
 const bytes=Uint8Array.from([Math.floor(n/65536),Math.floor(n/256)%256,n%256,255]);
 assert.ok(Math.abs(decodeDepth(bytes,0)-distance)<.00001);bytes[3]=0;assert.equal(decodeDepth(bytes,0),0);
});
