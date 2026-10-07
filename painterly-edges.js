// Canny: separable Gaussian blur, Sobel gradient, non-maximum suppression,
// and full connected hysteresis. Arrays use WebGL's bottom-left pixel origin.
export function cannyEdges(gray, width, height, {low=.035, high=.085}={}) {
  const size=width*height, temp=new Float32Array(size), blur=new Float32Array(size);
  const kernel=[1,4,6,4,1], sample=(x,y)=>Math.max(0,Math.min(height-1,y))*width+Math.max(0,Math.min(width-1,x));
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    let sum=0; for(let k=-2;k<=2;k++) sum+=gray[sample(x+k,y)]*kernel[k+2]; temp[y*width+x]=sum/16;
  }
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    let sum=0; for(let k=-2;k<=2;k++) sum+=temp[sample(x,y+k)]*kernel[k+2]; blur[y*width+x]=sum/16;
  }
  const magnitude=new Float32Array(size), direction=new Uint8Array(size);
  for(let y=1;y<height-1;y++) for(let x=1;x<width-1;x++) {
    const i=y*width+x;
    const gx=(blur[i-width+1]+2*blur[i+1]+blur[i+width+1]-blur[i-width-1]-2*blur[i-1]-blur[i+width-1])/8;
    const gy=(blur[i+width-1]+2*blur[i+width]+blur[i+width+1]-blur[i-width-1]-2*blur[i-width]-blur[i-width+1])/8;
    magnitude[i]=Math.hypot(gx,gy);
    direction[i]=((Math.round(Math.atan2(gy,gx)/(Math.PI/4))%4)+4)%4;
  }
  const edges=new Uint8Array(size), weak=new Uint8Array(size), queue=new Int32Array(size);
  const offsets=[1,width+1,width,width-1];let end=0;
  for(let y=2;y<height-2;y++) for(let x=2;x<width-2;x++) {
    const i=y*width+x, m=magnitude[i], d=offsets[direction[i]];
    if(m<low || m<magnitude[i-d] || m<=magnitude[i+d]) continue;
    weak[i]=1; if(m>=high) {edges[i]=1;queue[end++]=i;}
  }
  for(let head=0;head<end;head++) {
    const i=queue[head];
    for(let y=-1;y<=1;y++) for(let x=-1;x<=1;x++) {
      const n=i+y*width+x;
      if(weak[n] && !edges[n]) {edges[n]=1;queue[end++]=n;}
    }
  }
  return {edges,magnitude};
}

export function decodeDepth(bytes, index) {
  const at=index*4;
  if(!bytes[at+3]) return 0;
  return 2**(((bytes[at]*65536+bytes[at+1]*256+bytes[at+2])/16777215)*16)-1;
}

export function traceEdges(edges, depths, width, height, {maxPoints=28,maxPaths=3500,minPoints=5}={}) {
  const used=new Uint8Array(edges.length), paths=[];
  const neighbors=i=>{
    const result=[], x=i%width,y=Math.floor(i/width);
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
      if((!dx&&!dy)||x+dx<0||x+dx>=width||y+dy<0||y+dy>=height) continue;
      const j=i+dy*width+dx;
      if(edges[j]&&!used[j]&&depths[j]>0&&Math.abs(depths[i]-depths[j])<Math.max(.002,Math.min(depths[i],depths[j])*.06)) result.push(j);
    }
    return result;
  };
  // Grow both ways so raster ordering doesn't chop diagonal/curving contours.
  for(let start=0;start<edges.length&&paths.length<maxPaths;start++) {
    if(!edges[start]||used[start]||!depths[start]) continue;
    used[start]=1; const path=[start];
    for(let side=0;side<2;side++) {
      if(side) path.reverse();
      while(path.length<maxPoints) {
        const i=path[path.length-1], previous=path[path.length-2], choices=neighbors(i);
        if(!choices.length) break;
        if(previous!==undefined) {
          const dx=i%width-previous%width,dy=Math.floor(i/width)-Math.floor(previous/width);
          choices.sort((a,b)=>((b%width-i%width)*dx+(Math.floor(b/width)-Math.floor(i/width))*dy)-((a%width-i%width)*dx+(Math.floor(a/width)-Math.floor(i/width))*dy));
        }
        const next=choices[0];used[next]=1;path.push(next);
      }
    }
    if(path.length>=minPoints) paths.push(path);
  }
  return paths;
}
