import * as THREE from 'three';
import { ribbonTraceGLSL } from '../painterly-ribbons.js';

export function checkRibbons(renderer, check) {
  const size = 64;
  const makeTexture = () => {
    const texture = new THREE.DataTexture(new Float32Array(size*size*4),size,size,THREE.RGBAFormat,THREE.FloatType);
    texture.needsUpdate = true;
    return texture;
  };
  const flow = makeTexture(), reference = makeTexture(), color = makeTexture();
  const material = new THREE.ShaderMaterial({
    uniforms: { guideMap:{value:flow}, guideReference:{value:reference}, guideColor:{value:color},
      ribbonViewport:{value:new THREE.Vector2(size,size)}, anchor:{value:new THREE.Vector2(.3,.5)} },
    vertexShader: `${ribbonTraceGLSL}
      uniform vec2 anchor; varying vec4 result;
      void main() {
        vec2 offset = vec2(0.0), direction = vec2(1.0,0.0);
        bool alive = true;
        vec4 source = ribbonReference(anchor); vec3 sourceColor = ribbonColor(anchor);
        for (int i=0;i<3;i++) offset = advanceRibbon(anchor,offset,direction,8.0,source,sourceColor,alive);
        result = vec4(offset / ribbonViewport, alive ? 1.0 : 0.0, 1.0);
        gl_Position = vec4(position.xy,0.0,1.0);
      }`,
    fragmentShader: 'varying vec4 result; void main() { gl_FragColor = result; }',
    depthTest:false, depthWrite:false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);
  quad.frustumCulled = false;
  const target = new THREE.WebGLRenderTarget(1,1,{depthBuffer:false});
  const camera = new THREE.Camera();
  function trace(options={}) {
    for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
      const index=(y*size+x)*4, angle=options.angle?.(x,y) || 0;
      flow.image.data.set([Math.cos(2*angle)*.5+.5,Math.sin(2*angle)*.5+.5,options.confidence ?? 1,1],index);
      const coverage=options.gap && x>=30 && x<=33 ? 0 : 1;
      reference.image.data.set([.5*coverage,(options.depth && x>=32 ? .2 : .1)*coverage,0,coverage],index);
      color.image.data.set(options.color && x>=32 ? [.9,.1,.1,1] : [.4,.4,.4,1],index);
    }
    flow.needsUpdate=reference.needsUpdate=color.needsUpdate=true;
    material.uniforms.anchor.value.set(options.anchor ?? .3,.5);
    const saved = renderer.getRenderTarget();
    renderer.setRenderTarget(target); renderer.render(quad,camera);
    const result = new Uint8Array(4);
    renderer.readRenderTargetPixels(target,0,0,1,1,result);
    renderer.setRenderTarget(saved);
    return [...result].map(v=>v/255);
  }
  const assert = (condition,result) => { if(!condition) throw new Error(`traced offset/state ${result}`); };
  check('ribbons: a straight contour grows three bounded segments',()=>{
    const p=trace(); assert(Math.abs(p[0]-.375)<.01 && p[1]<.01 && p[2]>.99,p);
  });
  check('ribbons: a curved contour bends the path',()=>{
    const p=trace({angle:x=>(x/64-.3)*2}); assert(p[0]>.3 && p[1]>.04,p);
  });
  for(const boundary of ['depth','color','gap']) check(`ribbons: ${boundary} breaks stop growth`,()=>{
    const p=trace({[boundary]:true}); assert(Math.abs(p[0]-.125)<.01 && p[2]<.01,p);
  });
  check('ribbons: viewport edges stop growth',()=>{
    const p=trace({anchor:.9}); assert(p[0]<.01 && p[2]<.01,p);
  });
  check('ribbons: uncertain flow does not grow strokes',()=>{
    const p=trace({confidence:0}); assert(p[0]<.01 && p[2]<.01,p);
  });
  check('ribbons: identical views produce identical paths',()=>{
    const a=trace({angle:x=>(x/64-.3)*2}), b=trace({angle:x=>(x/64-.3)*2});
    assert(a.every((v,i)=>v===b[i]),b);
  });
  target.dispose(); material.dispose(); quad.geometry.dispose();
  flow.dispose(); reference.dispose(); color.dispose();
}
