const fields = ['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'];

export function sharpFixture({ crlf = false, metadata = true, side = 21 } = {}) {
  const count = side*side;
  const lines = ['ply','format binary_little_endian 1.0',`element vertex ${count}`, ...fields.map(n => `property float ${n}`)];
  if (metadata) lines.push('element extrinsic 16','property float extrinsic','element intrinsic 9','property float intrinsic','element image_size 2','property uint image_size');
  lines.push('end_header','');
  const header = new TextEncoder().encode(lines.join(crlf ? '\r\n' : '\n'));
  const buffer = new ArrayBuffer(header.length + count*56 + (metadata ? 108 : 0));
  new Uint8Array(buffer).set(header);
  const view = new DataView(buffer);
  for (let y=0; y<side; y++) for (let x=0; x<side; x++) {
    const px = (x/(side-1)-0.5)*2, py = (y/(side-1)-0.5)*1.5;
    const values = [px,py,3+0.25*Math.sin(px*3), (x/(side-1)-0.5)*2, (y/(side-1)-0.5)*2, 0.8, 5, -3, -3, -3, 1,0,0,0];
    values.forEach((v,i) => view.setFloat32(header.length+((y*side+x)*14+i)*4,v,true));
  }
  if (metadata) {
    let offset = header.length+count*56;
    for (const value of [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1, 512,0,320,0,512,240,0,0,1]) {
      view.setFloat32(offset,value,true); offset += 4;
    }
    view.setUint32(offset,640,true); view.setUint32(offset+4,480,true);
  }
  return buffer;
}
