import * as THREE from 'three';
import { cannyEdges, decodeDepth, traceEdges } from './painterly-edges.js?v=lineart-1';
import { unprojectDepth } from './painterly-navigation.js?v=lineart-1';
import { chooseBrush, brushFamilies, BRUSH_VARIANTS } from './painterly-brush-matching.js?v=brushes-2';

export const packDepthGLSL = `
vec3 packViewDepth(float depth) {
  float n=floor(clamp(log2(1.0+depth)/16.0,0.0,0.999999)*16777215.0);
  return vec3(floor(n/65536.0),mod(floor(n/256.0),256.0),mod(n,256.0))/255.0;
}
float unpackViewDepth(vec3 rgb) {
  return exp2(dot(floor(rgb*255.0+0.5),vec3(65536.0,256.0,1.0))/16777215.0*16.0)-1.0;
}`;

export function createLineArt(renderer, mesh, atlas) {
  // Clone BEFORE installing the painterly shader. Edge detection never sees the
  // brush output, cursor or its own lines. Depth uses nearest covered splat
  // centers, rather than averaging foreground and background depths.
  const base=mesh.material.clone(), depth=mesh.material.clone();
  base.uniforms=depth.uniforms=mesh.material.uniforms;
  base.fragmentShader=`varying vec4 vColor; varying vec2 vPosition;
    void main(){float a=dot(vPosition,vPosition);if(a>8.0)discard;
      gl_FragColor=vec4(vColor.rgb,exp(-0.5*a)*vColor.a);}`;
  depth.vertexShader='varying float sampleDepth;\n'+depth.vertexShader.replace('vec2 ndcOffset =','sampleDepth=max(0.0,-viewCenter.z);\nvec2 ndcOffset =');
  depth.fragmentShader=`varying vec4 vColor; varying vec2 vPosition; varying float sampleDepth;
    ${packDepthGLSL}
    void main(){if(exp(-0.5*dot(vPosition,vPosition))*vColor.a<0.22)discard;
      gl_FragColor=vec4(packViewDepth(sampleDepth),1.0);}`;
  depth.blending=THREE.NoBlending;depth.depthTest=true;depth.depthWrite=true;
  base.depthTest=false;base.depthWrite=false;
  const options={depthBuffer:true,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter};
  const colorTarget=new THREE.WebGLRenderTarget(1,1,options),depthTarget=new THREE.WebGLRenderTarget(1,1,options);
  let width=0,height=0,depthBytes,colorBytes,depths,snapshot;
  let points=[],pathData=[],lineCount=0;
  const clearColor=new THREE.Color();
  const layer=new THREE.Scene();
  const material=new THREE.ShaderMaterial({
    transparent:true,depthTest:false,depthWrite:false,toneMapped:false,side:THREE.DoubleSide,
    uniforms:{atlas:{value:atlas},surfaceDepth:{value:depthTarget.texture},viewport:{value:new THREE.Vector2(1,1)},lineWidth:{value:1.5},amount:{value:.75}},
    vertexShader:`attribute vec3 before;attribute vec3 after;attribute vec2 strokeUV;
      attribute vec2 brushTile;attribute vec3 pigment;attribute float pressure;
      uniform vec2 viewport;uniform float lineWidth;
      varying vec2 vUV;varying vec2 vTile;varying vec3 vPigment;varying float vDepth;
      void main(){vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.0);
        vec4 a=projectionMatrix*modelViewMatrix*vec4(before,1.0);
        vec4 b=projectionMatrix*modelViewMatrix*vec4(after,1.0);
        vec2 tangent=(b.xy/max(b.w,0.0001)-a.xy/max(a.w,0.0001))*viewport;
        tangent=normalize(tangent+vec2(0.00001));
        vec2 normal=vec2(-tangent.y,tangent.x);
        p.xy+=normal*(strokeUV.y*2.0-1.0)*lineWidth*pressure*2.0/viewport*p.w;
        gl_Position=p;vUV=strokeUV;vTile=brushTile;vPigment=pigment;
        vDepth=-(modelViewMatrix*vec4(position,1.0)).z;
      }`,
    fragmentShader:`${packDepthGLSL}
      uniform sampler2D atlas;uniform sampler2D surfaceDepth;uniform vec2 viewport;uniform float amount;
      varying vec2 vUV;varying vec2 vTile;varying vec3 vPigment;varying float vDepth;
      void main(){vec4 surface=texture2D(surfaceDepth,gl_FragCoord.xy/viewport);
        float depth=unpackViewDepth(surface.rgb);
        if(surface.a<0.5||vDepth>depth+max(0.003,depth*0.035)||vDepth<=0.0)discard;
        vec2 uv=(vTile+clamp(vUV,0.005,0.995))/vec2(${BRUSH_VARIANTS.toFixed(1)},${brushFamilies.length.toFixed(1)});
        float ink=pow(texture2D(atlas,uv).a,0.55);
        float ends=smoothstep(0.0,0.08,vUV.x)*smoothstep(0.0,0.08,1.0-vUV.x);
        gl_FragColor=vec4(vPigment,ink*ends*amount);
      }`,
  });
  const strokes=new THREE.Mesh(new THREE.BufferGeometry(),material);strokes.frustumCulled=false;layer.add(strokes);
  function size(viewWidth,viewHeight){
    const scale=Math.min(1,640/Math.max(viewWidth,viewHeight));
    const w=Math.max(2,Math.round(viewWidth*scale)),h=Math.max(2,Math.round(viewHeight*scale));
    if(w!==width||h!==height){width=w;height=h;colorTarget.setSize(w,h);depthTarget.setSize(w,h);depthBytes=new Uint8Array(w*h*4);colorBytes=new Uint8Array(w*h*4);depths=null;}
    material.uniforms.viewport.value.set(viewWidth,viewHeight);
  }
  function capture(camera,target,selected){
    const savedTarget=renderer.getRenderTarget(),savedMaterial=mesh.material,savedAuto=renderer.autoClear,alpha=renderer.getClearAlpha();
    renderer.getClearColor(clearColor);
    try {mesh.material=selected;renderer.autoClear=true;renderer.setClearColor(0,0);renderer.setRenderTarget(target);renderer.render(mesh,camera);}
    finally{mesh.material=savedMaterial;renderer.setRenderTarget(savedTarget);renderer.setClearColor(clearColor,alpha);renderer.autoClear=savedAuto;}
  }
  function readDepth(){
    renderer.readRenderTargetPixels(depthTarget,0,0,width,height,depthBytes);
    depths=Float32Array.from({length:width*height},(_,i)=>decodeDepth(depthBytes,i));
  }
  function rebuildGeometry(enabled){
    const position=[],before=[],after=[],strokeUV=[],brushTile=[],pigment=[],pressure=[],indices=[];
    for(const path of pathData){
      const count=path.length,first=path[0],last=path[count-1];
      const length=count,at=first*4,alpha=Math.max(1,colorBytes[at+3]);
      const rgb=[colorBytes[at]/alpha,colorBytes[at+1]/alpha,colorBytes[at+2]/alpha];
      const family=chooseBrush({aspect:Math.max(2,length/2),width:1,opacity:.85,luma:rgb[0]*.299+rgb[1]*.587+rgb[2]*.114},enabled);
      const variant=((first*1664525+last*1013904223)>>>0)%BRUSH_VARIANTS;
      const origin=position.length/3;
      for(let j=0;j<count;j++)for(let side=0;side<2;side++){
        const p=points[path[j]],a=points[path[Math.max(0,j-1)]],b=points[path[Math.min(count-1,j+1)]];
        position.push(...p);before.push(...a);after.push(...b);strokeUV.push(j/(count-1),side);brushTile.push(variant,family);
        pigment.push(...rgb.map((v,i)=>Math.min(.42,v*.26+[.055,.045,.035][i])));
        pressure.push(.55+.45*Math.sin(Math.PI*j/(count-1)));
      }
      for(let j=0;j<count-1;j++){const k=origin+j*2;indices.push(k,k+1,k+2,k+1,k+3,k+2);}
    }
    const geometry=new THREE.BufferGeometry();
    for(const [key,array,itemSize]of[['position',position,3],['before',before,3],['after',after,3],['strokeUV',strokeUV,2],['brushTile',brushTile,2],['pigment',pigment,3],['pressure',pressure,1]])geometry.setAttribute(key,new THREE.Float32BufferAttribute(array,itemSize));
    geometry.setIndex(indices);strokes.geometry.dispose();strokes.geometry=geometry;lineCount=pathData.length;
  }
  return {
    get count(){return lineCount;},
    get hasDepth(){return Boolean(snapshot);},
    captureDepth(camera,w,h){size(w,h);capture(camera,depthTarget,depth);snapshot=camera.clone();snapshot.matrixWorld.copy(camera.matrixWorld);depths=null;},
    rebuild(camera,w,h,detail,enabled){
      size(w,h);capture(camera,colorTarget,base);renderer.readRenderTargetPixels(colorTarget,0,0,width,height,colorBytes);
      if(!depths)readDepth();
      const gray=new Float32Array(width*height);
      for(let i=0;i<gray.length;i++){const at=i*4,a=colorBytes[at+3]/255;gray[i]=(.299*colorBytes[at]+.587*colorBytes[at+1]+.114*colorBytes[at+2])/255+(1-a);}
      const high=.19-detail*.165;
      const {edges}=cannyEdges(gray,width,height,{high,low:high*.4});
      // Attach boundary pixels to the nearest covered sample, never empty space.
      const attached=new Float32Array(depths), anchors=new Int32Array(depths.length);
      for(let i=0;i<anchors.length;i++)anchors[i]=i;
      for(let i=0;i<edges.length;i++)if(edges[i]&&!attached[i]){
        const x=i%width,y=Math.floor(i/width);let best=10;
        for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
          const xx=x+dx,yy=y+dy;if(xx<0||xx>=width||yy<0||yy>=height)continue;
          const n=yy*width+xx,d=dx*dx+dy*dy;
          if(depths[n]&&d<best){best=d;attached[i]=depths[n];anchors[i]=n;}
        }
      }
      pathData=traceEdges(edges,attached,width,height);
      points=[];
      for(const path of pathData)for(const i of path)if(!points[i]){
        const n=anchors[i];points[i]=unprojectDepth(n%width,Math.floor(n/width),attached[i],width,height,snapshot).toArray();
      }
      rebuildGeometry(enabled);
    },
    rematch(enabled){if(pathData.length)rebuildGeometry(enabled);},
    pick(u,v){
      if(!snapshot)return null;if(!depths)readDepth();
      const x=Math.floor(u*width),y=Math.floor(v*height);let best=Infinity,chosen=-1;
      for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
        const xx=x+dx,yy=y+dy;if(xx<0||xx>=width||yy<0||yy>=height)continue;
        const i=yy*width+xx,d=dx*dx+dy*dy;
        if(depths[i]>0&&d<best){best=d;chosen=i;}
      }
      return chosen<0?null:unprojectDepth(chosen%width,Math.floor(chosen/width),depths[chosen],width,height,snapshot);
    },
    render(camera,amount,width){
      if(!lineCount||!amount)return;
      material.uniforms.amount.value=amount;material.uniforms.lineWidth.value=width;
      const auto=renderer.autoClear;renderer.autoClear=false;renderer.render(layer,camera);renderer.autoClear=auto;
    },
    dispose(){strokes.geometry.dispose();material.dispose();base.dispose();depth.dispose();colorTarget.dispose();depthTarget.dispose();},
  };
}
