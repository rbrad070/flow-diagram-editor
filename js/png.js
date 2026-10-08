// PNG chunk helpers: store the diagram JSON in an iTXt chunk, and set
// the image resolution so it prints at the diagram's real size.

export const PNG_KEYWORD = 'cpsc100-flow-diagram';
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function isPNG(bytes) {
  return SIGNATURE.every((b, i) => bytes[i] === b);
}

// Splits a PNG into its chunks: [{ type, data, start, end }].
function chunks(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    out.push({ type, data: bytes.subarray(pos + 8, pos + 8 + len), start: pos, end: pos + 12 + len });
    pos += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

// Returns a copy of the PNG with the JSON and DPI chunks added after IHDR.
export function addPNGMetadata(bytes, json, dpi) {
  if (!isPNG(bytes)) throw new Error('Not a PNG image.');
  const ihdr = chunks(bytes)[0];
  const enc = new TextEncoder();

  // iTXt: keyword, 0, compression flag 0, method 0, language "", 0, translated "", 0, text.
  const key = enc.encode(PNG_KEYWORD);
  const text = enc.encode(json);
  const itxt = new Uint8Array(key.length + 5 + text.length);
  itxt.set(key, 0);
  itxt.set(text, key.length + 5);

  // pHYs: pixels per metre in x and y, unit = metre.
  const ppm = Math.round(dpi / 0.0254);
  const phys = new Uint8Array(9);
  const pv = new DataView(phys.buffer);
  pv.setUint32(0, ppm);
  pv.setUint32(4, ppm);
  phys[8] = 1;

  const rest = chunks(bytes).filter((c) => c.type !== 'pHYs' && c.type !== 'IHDR');
  const parts = [
    bytes.subarray(0, ihdr.end),
    chunk('pHYs', phys),
    chunk('iTXt', itxt),
    ...rest.map((c) => bytes.subarray(c.start, c.end)),
  ];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

// Returns the diagram JSON stored in a PNG, or null.
export function extractJSONFromPNG(bytes) {
  if (!isPNG(bytes)) return null;
  const dec = new TextDecoder();
  for (const c of chunks(bytes)) {
    if (c.type !== 'iTXt') continue;
    const zero = c.data.indexOf(0);
    if (dec.decode(c.data.subarray(0, zero)) !== PNG_KEYWORD) continue;
    if (c.data[zero + 1] !== 0) continue;           // compressed: not one of ours
    let pos = zero + 3;
    pos = c.data.indexOf(0, pos) + 1;               // skip language tag
    pos = c.data.indexOf(0, pos) + 1;               // skip translated keyword
    return dec.decode(c.data.subarray(pos));
  }
  return null;
}
