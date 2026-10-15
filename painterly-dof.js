import * as THREE from 'three';
import { packDepthGLSL } from './painterly-lineart.js?v=lineart-1';

export function depthOfFieldRadius(depth, focusDepth, aperture, blurPixels) {
  if (!(depth > 0) || !(focusDepth > 0) || !(aperture > 0) || !(blurPixels > 0)) return 0;
  const relative=Math.abs(depth-focusDepth)/Math.max(focusDepth,.0001);
  const coc=Math.min(1,Math.max(0,relative*12*aperture));
  return coc*coc*(3-2*coc)*blurPixels;
}

export function createDepthOfField(renderer, surfaceDepth) {
  const colorTarget=new THREE.WebGLRenderTarget(1,1,{
    depthBuffer:true,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,
  });
  const material=new THREE.ShaderMaterial({
    depthTest:false,depthWrite:false,toneMapped:false,
    uniforms:{
      colorMap:{value:colorTarget.texture},surfaceDepth:{value:surfaceDepth},
      viewport:{value:new THREE.Vector2(1,1)},focusDepth:{value:1},
      aperture:{value:.55},blurPixels:{value:12},
    },
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader:`${packDepthGLSL}
      uniform sampler2D colorMap;uniform sampler2D surfaceDepth;
      uniform vec2 viewport;uniform float focusDepth;uniform float aperture;uniform float blurPixels;
      varying vec2 vUv;
      float cocAt(float depth){
        float relative=abs(depth-focusDepth)/max(focusDepth,0.0001);
        float coc=clamp(relative*12.0*aperture,0.0,1.0);
        return coc*coc*(3.0-2.0*coc);
      }
      void main(){
        vec4 packed=texture2D(surfaceDepth,vUv);
        vec4 original=texture2D(colorMap,vUv);
        if(packed.a<0.5){gl_FragColor=original;return;}
        float centerDepth=unpackViewDepth(packed.rgb);
        float centerCoc=cocAt(centerDepth);
        float radius=centerCoc*blurPixels;
        if(radius<0.25){gl_FragColor=original;return;}
        vec3 sum=original.rgb;float total=1.0;
        for(int i=0;i<12;i++){
          float fi=float(i)+0.5;
          float ring=sqrt(fi/12.0);
          float angle=fi*2.39996323;
          vec2 offset=vec2(cos(angle),sin(angle))*ring*radius/viewport;
          vec2 sampleUv=clamp(vUv+offset,vec2(0.001),vec2(0.999));
          vec4 sampleDepthPacked=texture2D(surfaceDepth,sampleUv);
          float sampleDepth=sampleDepthPacked.a<0.5?centerDepth:unpackViewDepth(sampleDepthPacked.rgb);
          float sampleCoc=cocAt(sampleDepth);
          float weight=.2+.8*smoothstep(ring-.22,ring+.08,sampleCoc);
          // Defocused foreground may spread over the background, while sharp
          // background color is kept from leaking through a nearer silhouette.
          float foreground=step(sampleDepth,centerDepth-max(.003,centerDepth*.018));
          weight=max(weight,foreground*sampleCoc);
          vec3 sampleColor=texture2D(colorMap,sampleUv).rgb;
          float highlight=max(0.0,dot(sampleColor,vec3(.2126,.7152,.0722))-.68);
          sampleColor*=1.0+highlight*.32*centerCoc;
          sum+=sampleColor*weight;total+=weight;
        }
        gl_FragColor=vec4(sum/total,original.a);
      }`,
  });
  const scene=new THREE.Scene(),camera=new THREE.Camera();
  const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);quad.frustumCulled=false;scene.add(quad);
  let width=0,height=0,outputTarget=null,savedAuto=true;
  function size(w,h){
    if(w===width&&h===height)return;width=Math.max(1,w);height=Math.max(1,h);
    colorTarget.setSize(width,height);material.uniforms.viewport.value.set(width,height);
  }
  return {
    begin(w,h){
      size(w,h);outputTarget=renderer.getRenderTarget();savedAuto=renderer.autoClear;
      renderer.setRenderTarget(colorTarget);
    },
    render({focusDepth,aperture,blur}){
      material.uniforms.focusDepth.value=Math.max(.0001,focusDepth);
      material.uniforms.aperture.value=THREE.MathUtils.clamp(aperture,0,1);
      material.uniforms.blurPixels.value=THREE.MathUtils.clamp(blur,0,24);
      renderer.setRenderTarget(outputTarget);renderer.autoClear=true;renderer.render(scene,camera);renderer.autoClear=savedAuto;
    },
    dispose(){quad.geometry.dispose();material.dispose();colorTarget.dispose();},
  };
}
