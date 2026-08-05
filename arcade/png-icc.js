/**
 * Embed an ICC profile in a PNG as an iCCP chunk.
 *
 * The editor writes JPEGs, because photographs are what it exports. The arcade
 * writes PNGs, because its boards are synthesised graphics whose exact 8-bit PQ
 * code values ARE the game: a 3-pixel emitter core inside an 8x8 DCT block does
 * not survive JPEG, and 4:2:0 chroma subsampling flattens the saturated
 * counterfeits that the whole puzzle turns on. PNG is lossless, so a pixel
 * written at code 162 is read at code 162.
 *
 * Compression is the caller's job so this module stays synchronous and pure:
 * browsers pass CompressionStream("deflate") output, Node tests pass
 * zlib.deflateSync output. Both are RFC 1950 zlib datastreams, which is what
 * the PNG specification requires for iCCP compression method 0.
 */

export const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// iCCP carries its own colour information, so the chunks that would compete with
// it are dropped rather than left to fight. PNG requires all three to be absent
// or consistent; removing them is the only unambiguous option.
const CONFLICTING_CHUNKS = Object.freeze(["sRGB", "gAMA", "cHRM", "iCCP"]);

let crcTable = null;

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

/** CRC-32 as specified for PNG chunks (reflected, polynomial 0xEDB88320). */
export function crc32(bytes) {
  if (!crcTable) crcTable = buildCrcTable();
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readUint32(bytes, offset) {
  return (
    ((bytes[offset] << 24)
      | (bytes[offset + 1] << 16)
      | (bytes[offset + 2] << 8)
      | bytes[offset + 3]) >>> 0
  );
}

function chunkType(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/** Build one complete PNG chunk: length, type, data, CRC. */
export function buildPngChunk(type, data) {
  if (typeof type !== "string" || type.length !== 4) {
    throw new TypeError("chunk type must be four characters");
  }

  const chunk = new Uint8Array(12 + data.length);
  const length = data.length;
  chunk[0] = (length >>> 24) & 0xff;
  chunk[1] = (length >>> 16) & 0xff;
  chunk[2] = (length >>> 8) & 0xff;
  chunk[3] = length & 0xff;
  for (let index = 0; index < 4; index += 1) {
    chunk[4 + index] = type.charCodeAt(index);
  }
  chunk.set(data, 8);

  const crc = crc32(chunk.subarray(4, 8 + length));
  chunk[8 + length] = (crc >>> 24) & 0xff;
  chunk[9 + length] = (crc >>> 16) & 0xff;
  chunk[10 + length] = (crc >>> 8) & 0xff;
  chunk[11 + length] = crc & 0xff;
  return chunk;
}

/** Assemble the iCCP chunk payload from a profile name and a zlib datastream. */
export function buildIccpChunkData(profileName, deflatedProfile) {
  if (typeof profileName !== "string" || profileName.length === 0 || profileName.length > 79) {
    throw new RangeError("ICC profile name must be 1 to 79 characters");
  }
  if (!/^[\x20-\x7e]+$/.test(profileName)) {
    throw new TypeError("ICC profile name must be printable Latin-1");
  }
  if (deflatedProfile.length === 0) {
    throw new RangeError("compressed ICC profile cannot be empty");
  }

  const data = new Uint8Array(profileName.length + 2 + deflatedProfile.length);
  for (let index = 0; index < profileName.length; index += 1) {
    data[index] = profileName.charCodeAt(index);
  }
  data[profileName.length] = 0x00; // null separator
  data[profileName.length + 1] = 0x00; // compression method 0 (zlib)
  data.set(deflatedProfile, profileName.length + 2);
  return data;
}

/**
 * Insert an iCCP chunk directly after IHDR, dropping any colour chunks that
 * would conflict with it. The input is not modified.
 */
export function injectPngIccProfile(pngInput, deflatedProfile, profileName = "Rec2100PQ") {
  const png = pngInput instanceof Uint8Array ? pngInput : new Uint8Array(pngInput);
  const profile = deflatedProfile instanceof Uint8Array
    ? deflatedProfile
    : new Uint8Array(deflatedProfile);

  if (png.length < 8 || !PNG_SIGNATURE.every((byte, index) => png[index] === byte)) {
    throw new TypeError("input is not a PNG");
  }

  const iccpChunk = buildPngChunk("iCCP", buildIccpChunkData(profileName, profile));
  const parts = [png.subarray(0, 8)];
  let offset = 8;
  let inserted = false;
  let sawEnd = false;

  while (offset + 8 <= png.length) {
    const dataLength = readUint32(png, offset);
    const type = chunkType(png, offset + 4);
    const chunkEnd = offset + 12 + dataLength;
    if (chunkEnd > png.length) {
      throw new TypeError(`PNG chunk ${type} extends past end of file`);
    }

    if (!CONFLICTING_CHUNKS.includes(type)) {
      parts.push(png.subarray(offset, chunkEnd));
    }

    // iCCP is only legal before PLTE and IDAT, so IHDR is the one safe anchor.
    if (type === "IHDR" && !inserted) {
      parts.push(iccpChunk);
      inserted = true;
    }
    if (type === "IEND") {
      sawEnd = true;
      offset = chunkEnd;
      break;
    }
    offset = chunkEnd;
  }

  if (!inserted) throw new TypeError("PNG is missing an IHDR chunk");
  if (!sawEnd) throw new TypeError("PNG is missing an IEND chunk");

  let total = 0;
  for (const part of parts) total += part.length;
  const result = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    result.set(part, cursor);
    cursor += part.length;
  }
  return result;
}
