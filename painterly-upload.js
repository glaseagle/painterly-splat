const scalarTypes = {
  char: [1, 'getInt8'], uchar: [1, 'getUint8'], short: [2, 'getInt16'], ushort: [2, 'getUint16'],
  int: [4, 'getInt32'], uint: [4, 'getUint32'], float: [4, 'getFloat32'], double: [8, 'getFloat64'],
};
const required = ['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'];
export const MAX_LOCAL_BYTES = 256 * 1024 * 1024;

export function parsePlyHeader(bytes) {
  // One character per byte preserves offsets even for comments with non-ASCII bytes.
  const text = new TextDecoder('latin1').decode(bytes);
  const end = /(?:^|\n)end_header\r?\n/.exec(text);
  if (!text.startsWith('ply\n') && !text.startsWith('ply\r\n')) throw new Error('This file is not a PLY splat.');
  if (!end) throw new Error('PLY header is missing or too large.');
  const headerBytes = end.index + end[0].length;
  const lines = text.slice(0, headerBytes).trim().split(/\r?\n/).map(l => l.trim());
  if (!lines.includes('format binary_little_endian 1.0')) throw new Error('Use a binary little-endian Gaussian PLY export.');
  const elements = [];
  let current;
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts[0] === 'element') {
      const count = Number(parts[2]);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid PLY element count.');
      current = { name: parts[1], count, properties: [], rowBytes: 0 };
      elements.push(current);
    } else if (parts[0] === 'property') {
      if (!current || !scalarTypes[parts[1]]) throw new Error('Use a standard Gaussian PLY with scalar properties.');
      current.properties.push({ type: parts[1], name: parts[2], offset: current.rowBytes });
      current.rowBytes += scalarTypes[parts[1]][0];
    }
  }
  const vertex = elements[0];
  if (vertex?.name !== 'vertex' || vertex.count < 1) throw new Error('PLY must start with Gaussian vertices.');
  if (required.some(name => !vertex.properties.some(p => p.name === name))) {
    throw new Error('This PLY is a point cloud or mesh. Export Gaussian splats with opacity, scales, rotations and SH colors.');
  }
  let offset = headerBytes;
  for (const element of elements) {
    element.offset = offset;
    offset += element.count * element.rowBytes;
    if (!Number.isSafeInteger(offset)) throw new Error('Invalid PLY data size.');
  }
  return { headerBytes, elements, vertex, totalBytes: offset };
}

export function cameraFromPlyMetadata(metadata) {
  const intrinsic = metadata.intrinsic;
  if (!intrinsic || ![4,9].includes(intrinsic.length)) return null;
  const [width,height] = metadata.image_size || intrinsic.slice(2,4);
  const fx = intrinsic[0], fy = intrinsic.length === 9 ? intrinsic[4] : intrinsic[1];
  if (![width,height,fx,fy].every(n => Number.isFinite(n) && n > 0)) return null;
  const e = metadata.extrinsic || [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  if (![12,16].includes(e.length) || e.some(n => !Number.isFinite(n))) return null;
  let r = [[e[0],e[1],e[2]],[e[4],e[5],e[6]],[e[8],e[9],e[10]]];
  const transpose = m => m[0].map((_,i) => m.map(row => row[i]));
  if (e.length === 12) r = transpose(r); // SHARP's legacy serialization.
  const rotation = transpose(r), t = [e[3],e[7],e[11]];
  const position = rotation.map(row => -row.reduce((sum,v,i) => sum+v*t[i],0));
  return { width, height, fx, fy, rotation, position };
}

export async function prepareLocalSplat(file) {
  if (!file.size) throw new Error('This file is empty.');
  if (file.size > MAX_LOCAL_BYTES) throw new Error('Choose a splat under 256 MB for this browser viewer.');
  const extension = file.name.split('.').pop().toLowerCase();
  if (!['ply','splat','ksplat'].includes(extension)) throw new Error('Choose a .ply, .splat or .ksplat file.');
  if (extension === 'splat') {
    if (file.size % 32 !== 0) throw new Error('Invalid .splat file: incomplete Gaussian records.');
    return { blob: file, extension, camera: null };
  }
  if (extension === 'ksplat') {
    if (file.size < 4096) throw new Error('This .ksplat file is incomplete.');
    return { blob: file, extension, camera: null };
  }
  const header = parsePlyHeader(new Uint8Array(await file.slice(0,65536).arrayBuffer()));
  if (header.totalBytes > file.size) throw new Error('This PLY is truncated; export or download it again.');
  const metadata = {};
  for (const element of header.elements.slice(1)) {
    if (element.count > 16 || element.properties.length !== 1) continue;
    const property = element.properties[0];
    if (!['intrinsic','extrinsic','image_size'].includes(property.name)) continue;
    const data = new DataView(await file.slice(element.offset, element.offset+element.rowBytes*element.count).arrayBuffer());
    const [size,get] = scalarTypes[property.type];
    metadata[property.name] = Array.from({length:element.count}, (_,i) => data[get](i*size,true));
  }
  // Canonical LF header removes supplemental camera elements before the renderer.
  // Vertex data stays byte-for-byte unchanged and the Blob avoids a second full copy.
  const vertex = header.vertex;
  const cleanHeader = ['ply','format binary_little_endian 1.0',`element vertex ${vertex.count}`,
    ...vertex.properties.map(p => `property ${p.type} ${p.name}`),'end_header',''].join('\n');
  const blob = new Blob([cleanHeader, file.slice(vertex.offset, vertex.offset+vertex.rowBytes*vertex.count)]);
  return { blob, extension, camera: cameraFromPlyMetadata(metadata) };
}

export function sceneBounds(points) {
  const valid = points.filter(p => p.length === 3 && p.every(Number.isFinite));
  if (!valid.length) throw new Error('This splat contains no finite positions.');
  const axes = [0,1,2].map(axis => valid.map(p => p[axis]).sort((a,b) => a-b));
  const lows = axes.map(a => a[Math.floor((a.length-1)*0.02)]);
  const highs = axes.map(a => a[Math.ceil((a.length-1)*0.98)]);
  const center = lows.map((v,i) => (v+highs[i])*0.5);
  const radius = Math.hypot(...highs.map((v,i) => v-lows[i]))*0.5;
  return { center, radius: radius > 1e-12 ? radius : 1 };
}

// Normalize geometry and camera together: projection stays unchanged for SHARP.
// Relative extents, rather than a fixed radius floor, also handle microscopic scans.
export function normalizeImport(points, captureCamera = null) {
  const { center, radius } = sceneBounds(points);
  const scale = 1 / radius;
  const position = center.map(v => -v * scale);
  const fit = fittedCamera(points.map(p => p.map((v,i) => (v-center[i])*scale)));
  const camera = captureCamera ? { ...captureCamera,
    position: captureCamera.position.map((v,i) => (v-center[i])*scale),
    rotation: captureCamera.rotation.map(row => [...row]),
  } : fit.camera;
  return { scale: [scale,scale,scale], position, camera, radius: 1,
    distance: captureCamera ? Math.max(1, Math.hypot(...camera.position)) : fit.distance };
}

export function fittedCamera(points) {
  const { center, radius } = sceneBounds(points);
  const distance = radius / Math.sin(25*Math.PI/180) * 1.15;
  const focal = 480/(2*Math.tan(25*Math.PI/180));
  return {
    radius, distance,
    camera: { width:640, height:480, fx:focal, fy:focal,
      position:[center[0],center[1],center[2]-distance], rotation:[[1,0,0],[0,1,0],[0,0,1]] },
  };
}
