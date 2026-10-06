// Only rebuilt pixels may cross from the public upload endpoint to the host PC.
export const MAX_PHOTO = 2 * 1024 * 1024;
export const SCRUB_VERSION = 1;

export class PhotoError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export async function boundedBytes(stream, limit = MAX_PHOTO, timeout = 15000) {
  if (!stream) throw new PhotoError('Choose a JPEG photo.');
  const reader = stream.getReader(), chunks = [];
  let size = 0, timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { reject(new PhotoError('Photo upload timed out.', 408)); reader.cancel().catch(() => {}); }, timeout);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new PhotoError('Choose a photo under 2 MB.', 413); }
      chunks.push(value);
    }
  } finally { clearTimeout(timer); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

// Remove APP/COM segments and trailing data from Cloudflare's newly encoded JPEG.
// This is defense in depth, NOT a replacement for decoding/re-encoding upstream.
export function stripJpegMetadata(bytes) {
  if (bytes[0] !== 255 || bytes[1] !== 216) throw new PhotoError('Could not rebuild the photo.', 503);
  const parts = [bytes.subarray(0, 2)];
  let offset = 2, sawScan = false;
  while (offset < bytes.length) {
    const start = offset;
    if (bytes[offset++] !== 255) break;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217 && sawScan) {
      parts.push(new Uint8Array([255, 217]));
      const result = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
      let at = 0;
      for (const part of parts) { result.set(part, at); at += part.length; }
      return result;
    }
    if (marker === undefined || marker === 0 || marker === 216 || (marker >= 208 && marker <= 215)) break;
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (!Number.isFinite(length) || length < 2 || offset + length > bytes.length) break;
    offset += length;
    if (!((marker >= 224 && marker <= 239) || marker === 254)) parts.push(bytes.subarray(start, offset));
    if (marker === 218) {
      sawScan = true;
      const entropy = offset;
      while (offset < bytes.length) {
        if (bytes[offset] !== 255) { offset++; continue; }
        let next = offset + 1;
        while (bytes[next] === 255) next++;
        if (bytes[next] === 0 || (bytes[next] >= 208 && bytes[next] <= 215)) { offset = next + 1; continue; }
        break;
      }
      parts.push(bytes.subarray(entropy, offset));
    }
  }
  throw new PhotoError('Could not rebuild the photo.', 503);
}

export async function scrubPhoto(bytes, images) {
  if (!images) throw new PhotoError('Photo cleaning is temporarily unavailable.', 503);
  const stream = () => new Blob([bytes]).stream();
  let info;
  try { info = await images.info(stream()); }
  catch { throw new PhotoError('This photo could not be decoded. Choose another JPEG.'); }
  if (!['jpeg', 'jpg', 'image/jpeg'].includes(info.format) ||
      !Number.isInteger(info.width) || !Number.isInteger(info.height) ||
      info.width < 1 || info.height < 1 || info.width * info.height > 4_000_000) {
    throw new PhotoError('Choose a JPEG with no more than 4 million pixels.');
  }
  try {
    const rebuilt = await images.input(stream())
      .transform({ width: 1280, height: 1280, fit: 'scale-down', metadata: 'none' })
      .output({ format: 'image/jpeg', quality: 90, anim: false });
    const response = rebuilt.response();
    if (!response.ok) throw new Error('Image service rejected the transform');
    return stripJpegMetadata(await boundedBytes(response.body));
  } catch {
    // Never fall back to the original file, even if Images is unavailable or over quota.
    throw new PhotoError('Photo cleaning failed. Please try again later.', 503);
  }
}
