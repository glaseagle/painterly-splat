import * as THREE from 'three';
import { brushFamilies, brushMatchGLSL, strokeSizingGLSL } from '../painterly-brush-matching.js?v=brushes-2';

export function checkBrushes(renderer, check) {
  const material = new THREE.ShaderMaterial({
    uniforms:{ footprint:{value:new THREE.Vector4(3,1,.7,.5)}, seed:{value:.5}, detail:{value:0}, variation:{value:1}, brushEnabled:{value:brushFamilies.map(()=>1)} },
    vertexShader:`${brushMatchGLSL()} ${strokeSizingGLSL}
      uniform vec4 footprint; uniform float seed; uniform float detail; uniform float variation;
      varying vec4 result;
      void main() {
        vec2 size=strokeSize(footprint.x,footprint.y,1.0,variation,seed,detail);
        float family=matchBrush(footprint.x/footprint.y,footprint.y,footprint.z,footprint.w,0.99);
        result=vec4(size/vec2(160.0,70.0),family/${(brushFamilies.length-1).toFixed(1)},1.0);
        gl_Position=vec4(position.xy,0.0,1.0);
      }`,
    fragmentShader:'varying vec4 result; void main(){gl_FragColor=result;}',depthTest:false,depthWrite:false,
  });
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material), camera=new THREE.Camera();
  mesh.frustumCulled=false;
  const target=new THREE.WebGLRenderTarget(1,1,{depthBuffer:false});
  function render({major=3,minor=1,seed=.5,detail=0,variation=1,opacity=.7,luma=.5}={}) {
    material.uniforms.footprint.value.set(major,minor,opacity,luma);
    material.uniforms.seed.value=seed; material.uniforms.detail.value=detail; material.uniforms.variation.value=variation;
    const previous=renderer.getRenderTarget(); renderer.setRenderTarget(target); renderer.render(mesh,camera);
    const bytes=new Uint8Array(4); renderer.readRenderTargetPixels(target,0,0,1,1,bytes); renderer.setRenderTarget(previous);
    return [bytes[0]/255*160,bytes[1]/255*70,Math.round(bytes[2]/255*(brushFamilies.length-1))];
  }
  const assert=(condition,message)=>{if(!condition) throw new Error(message);};
  check('brush scale: equal SHARP footprints produce both broad and fine marks',()=>{
    const small=render({seed:.05}),big=render({seed:.95});
    assert(big[0]/small[0]>6,`size spread ${small[0]} to ${big[0]}`);
  });
  check('brush scale: variation zero preserves equal-sized source footprints',()=>{
    assert(render({seed:.05,variation:0})[0]===render({seed:.95,variation:0})[0],'variation cannot be disabled');
  });
  check('brush scale: larger source Gaussians still produce larger marks',()=>{
    assert(render({major:15,minor:5})[0]>render({major:1.5,minor:.5})[0]*1.8,'lost native size hierarchy');
  });
  check('brush scale: detail produces finer strokes and preserves elongation',()=>{
    const smooth=render(),edge=render({detail:1});
    assert(edge[0]<smooth[0]*.5,'detail not protected');
    const thin=render({major:8,minor:.5}); assert(thin[0]/thin[1]>12,'thin Gaussian turned into a broad mark');
  });
  check('brush matching: GPU can select every family from its Gaussian descriptor',()=>{
    brushFamilies.forEach((b,i)=>assert(render({major:b.aspect*b.width,minor:b.width,opacity:b.opacity,luma:b.luma})[2]===i,b.name));
  });
  check('brush matching: disabled tools never render',()=>{
    material.uniforms.brushEnabled.value=brushFamilies.map((_,i)=>Number(i===10));
    brushFamilies.forEach(b=>assert(render({major:b.aspect*b.width,minor:b.width,opacity:b.opacity,luma:b.luma})[2]===10,b.name));
  });
  check('brush scale: unchanged views keep exactly the same marks',()=>{
    assert(JSON.stringify(render({seed:.37}))===JSON.stringify(render({seed:.37})),'unstable marks');
  });
  target.dispose();material.dispose();mesh.geometry.dispose();
}
