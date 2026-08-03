/**
 * Small, dependency-free HDR helpers shared by the browser app and Node tests.
 *
 * Colour-channel arguments use normalized floating-point values. Luminance passed
 * to pqEncodeNits is absolute cd/m² (nits), as required by SMPTE ST 2084.
 */

export const PQ_MAX_NITS = 10_000;

export const SRGB_TO_REC2020_MATRIX = Object.freeze([
  Object.freeze([0.627403895934699, 0.3292830383778837, 0.0433130656874172]),
  Object.freeze([0.0690972893582324, 0.9195403950754588, 0.0113623155663092]),
  Object.freeze([0.0163914388751502, 0.0880133078772253, 0.8955952532476245]),
]);

export const ICC_PROFILE_SIGNATURE = Object.freeze([
  0x49, 0x43, 0x43, 0x5f, 0x50, 0x52,
  0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00,
]);

// APP2's two-byte length includes itself. ICC uses another 14 bytes for its
// signature and chunk numbering, leaving 65,519 bytes for profile data.
export const ICC_CHUNK_DATA_SIZE = 65_519;

const PQ_M1 = 2610 / 16_384;
const PQ_M2 = 2523 / 32;
const PQ_C1 = 3424 / 4096;
const PQ_C2 = 2413 / 128;
const PQ_C3 = 2392 / 128;

function assertFiniteNumber(value, name) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

function asBytes(value, name) {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  throw new TypeError(`${name} must be an ArrayBuffer or typed-array view`);
}

function unpackRgb(red, green, blue, functionName) {
  if ((Array.isArray(red) || ArrayBuffer.isView(red)) && green === undefined) {
    [red, green, blue] = red;
  }

  assertFiniteNumber(red, `${functionName} red`);
  assertFiniteNumber(green, `${functionName} green`);
  assertFiniteNumber(blue, `${functionName} blue`);
  return [red, green, blue];
}

/** Convert one normalized sRGB component to linear-light sRGB. */
export function srgbToLinear(value) {
  assertFiniteNumber(value, 'sRGB value');
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

/**
 * Convert a linear-light sRGB triplet to linear-light Rec.2020 (both D65).
 * Accepts either (red, green, blue) or one three-item array/typed array.
 */
export function linearSrgbToRec2020(red, green, blue) {
  [red, green, blue] = unpackRgb(red, green, blue, 'linearSrgbToRec2020');

  return SRGB_TO_REC2020_MATRIX.map(
    (row) => row[0] * red + row[1] * green + row[2] * blue,
  );
}

/** Relative luminance of a linear-light sRGB triplet. */
export function linearSrgbLuminance(red, green, blue) {
  [red, green, blue] = unpackRgb(red, green, blue, 'linearSrgbLuminance');
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Encode absolute luminance in nits using SMPTE ST 2084 (PQ). */
export function pqEncodeNits(nits) {
  assertFiniteNumber(nits, 'luminance');
  const normalizedLuminance = Math.min(Math.max(nits, 0), PQ_MAX_NITS) / PQ_MAX_NITS;
  const poweredLuminance = normalizedLuminance ** PQ_M1;
  return (
    (PQ_C1 + PQ_C2 * poweredLuminance)
    / (1 + PQ_C3 * poweredLuminance)
  ) ** PQ_M2;
}

/** Cubic Hermite interpolation from zero to one between the supplied edges. */
export function smoothstep(edge0, edge1, value) {
  assertFiniteNumber(edge0, 'edge0');
  assertFiniteNumber(edge1, 'edge1');
  assertFiniteNumber(value, 'value');

  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1;
  }

  const amount = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return amount * amount * (3 - 2 * amount);
}

/**
 * Build a soft highlight selection from relative luminance.
 * Values at threshold are unselected; values at threshold + softness are fully
 * selected. A zero softness produces a hard threshold.
 */
export function highlightMask(luminance, threshold = 0.65, softness = 0.1) {
  assertFiniteNumber(luminance, 'luminance');
  assertFiniteNumber(threshold, 'threshold');
  assertFiniteNumber(softness, 'softness');

  if (softness < 0) {
    throw new RangeError('softness must be zero or greater');
  }

  return softness === 0
    ? (luminance >= threshold ? 1 : 0)
    : smoothstep(threshold, threshold + softness, luminance);
}

function isIccApp2(bytes, markerCodeOffset, segmentEnd) {
  const payloadOffset = markerCodeOffset + 3;
  if (segmentEnd - payloadOffset < ICC_PROFILE_SIGNATURE.length + 2) {
    return false;
  }

  return ICC_PROFILE_SIGNATURE.every(
    (byte, index) => bytes[payloadOffset + index] === byte,
  );
}

function makeIccSegments(profile) {
  if (profile.byteLength === 0) {
    throw new RangeError('ICC profile cannot be empty');
  }

  const chunkCount = Math.ceil(profile.byteLength / ICC_CHUNK_DATA_SIZE);
  if (chunkCount > 255) {
    throw new RangeError('ICC profile is too large for JPEG APP2 chunk numbering');
  }

  const segments = [];
  for (let index = 0; index < chunkCount; index += 1) {
    const chunk = profile.subarray(
      index * ICC_CHUNK_DATA_SIZE,
      Math.min((index + 1) * ICC_CHUNK_DATA_SIZE, profile.byteLength),
    );
    const segmentLength = 2 + ICC_PROFILE_SIGNATURE.length + 2 + chunk.byteLength;
    const segment = new Uint8Array(segmentLength + 2);

    segment[0] = 0xff;
    segment[1] = 0xe2;
    segment[2] = segmentLength >>> 8;
    segment[3] = segmentLength & 0xff;
    segment.set(ICC_PROFILE_SIGNATURE, 4);
    segment[16] = index + 1;
    segment[17] = chunkCount;
    segment.set(chunk, 18);
    segments.push(segment);
  }

  return segments;
}

function joinByteParts(parts) {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }

  return result;
}

/**
 * Embed an ICC profile in a JPEG as one or more standards-compliant APP2
 * segments. Existing ICC_PROFILE APP2 segments are removed; unrelated APP2
 * metadata is retained. The source inputs are not modified.
 */
export function injectICCProfile(jpegInput, profileInput) {
  const jpeg = asBytes(jpegInput, 'JPEG');
  const profile = asBytes(profileInput, 'ICC profile');

  if (jpeg.byteLength < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new TypeError('JPEG must begin with an SOI marker');
  }

  const iccSegments = makeIccSegments(profile);
  const outputParts = [jpeg.subarray(0, 2)];
  let offset = 2;
  let inserted = false;
  let foundEndOfHeader = false;

  while (offset < jpeg.byteLength) {
    const markerStart = offset;
    if (jpeg[offset] !== 0xff) {
      throw new TypeError(`Malformed JPEG marker at byte ${offset}`);
    }

    while (offset < jpeg.byteLength && jpeg[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= jpeg.byteLength) {
      throw new TypeError('Truncated JPEG marker');
    }

    const marker = jpeg[offset];
    const markerCodeOffset = offset;
    if (marker === 0x00) {
      throw new TypeError('Unexpected stuffed byte before JPEG scan data');
    }

    // Start of scan: all remaining bytes are entropy-coded and must be copied
    // verbatim. EOI is handled similarly so trailing bytes stay intact.
    if (marker === 0xda || marker === 0xd9) {
      if (marker === 0xda) {
        if (markerCodeOffset + 2 >= jpeg.byteLength) {
          throw new TypeError('Truncated JPEG scan header length');
        }
        const scanHeaderLength = (jpeg[markerCodeOffset + 1] << 8)
          | jpeg[markerCodeOffset + 2];
        if (
          scanHeaderLength < 2
          || markerCodeOffset + 1 + scanHeaderLength > jpeg.byteLength
        ) {
          throw new TypeError('Invalid JPEG scan header length');
        }
      }
      if (!inserted) {
        outputParts.push(...iccSegments);
        inserted = true;
      }
      outputParts.push(jpeg.subarray(markerStart));
      foundEndOfHeader = true;
      break;
    }

    const isStandaloneMarker = marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8);
    let segmentEnd;
    if (isStandaloneMarker) {
      segmentEnd = markerCodeOffset + 1;
    } else {
      if (markerCodeOffset + 2 >= jpeg.byteLength) {
        throw new TypeError('Truncated JPEG segment length');
      }
      const segmentLength = (jpeg[markerCodeOffset + 1] << 8) | jpeg[markerCodeOffset + 2];
      if (segmentLength < 2) {
        throw new TypeError('Invalid JPEG segment length');
      }
      segmentEnd = markerCodeOffset + 1 + segmentLength;
      if (segmentEnd > jpeg.byteLength) {
        throw new TypeError('JPEG segment extends past end of file');
      }
    }

    const isExistingIcc = marker === 0xe2
      && isIccApp2(jpeg, markerCodeOffset, segmentEnd);
    const isLeadingApplicationMetadata = marker === 0xe0 || marker === 0xe1;

    if (!inserted && !isLeadingApplicationMetadata && !isExistingIcc) {
      outputParts.push(...iccSegments);
      inserted = true;
    }

    if (!isExistingIcc) {
      outputParts.push(jpeg.subarray(markerStart, segmentEnd));
    }
    offset = segmentEnd;
  }

  if (!foundEndOfHeader) {
    throw new TypeError('JPEG is missing an SOS or EOI marker');
  }

  return joinByteParts(outputParts);
}

/** Encode bytes as a base64 string in browsers or Node. */
export function bytesToBase64(input) {
  const bytes = asBytes(input, 'input');

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }

  if (typeof btoa !== 'function') {
    throw new Error('No base64 encoder is available in this environment');
  }

  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/** Decode a standard (optionally unpadded) base64 string into bytes. */
export function base64ToBytes(input) {
  if (typeof input !== 'string') {
    throw new TypeError('base64 input must be a string');
  }

  const unpadded = input.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(unpadded)) {
    throw new TypeError('Invalid base64 input');
  }
  const firstPadding = unpadded.indexOf('=');
  if (firstPadding === -1) {
    if (unpadded.length % 4 === 1) {
      throw new TypeError('Invalid base64 input');
    }
  } else {
    const paddingLength = unpadded.length - firstPadding;
    const expectedRemainder = paddingLength === 1 ? 3 : 2;
    if (unpadded.length % 4 !== 0 || firstPadding % 4 !== expectedRemainder) {
      throw new TypeError('Invalid base64 padding');
    }
  }

  const base64 = unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, '=');
  if (typeof Buffer !== 'undefined') {
    const decoded = Buffer.from(base64, 'base64');
    return new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength).slice();
  }

  if (typeof atob !== 'function') {
    throw new Error('No base64 decoder is available in this environment');
  }

  let binary;
  try {
    binary = atob(base64);
  } catch (error) {
    throw new TypeError('Invalid base64 input', { cause: error });
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Convert a base64 or percent-encoded data URL to its payload bytes. */
export function dataUrlToBytes(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new TypeError('Expected a data URL');
  }

  const comma = dataUrl.indexOf(',');
  if (comma === -1) {
    throw new TypeError('Malformed data URL');
  }

  const metadata = dataUrl.slice(5, comma);
  const payload = dataUrl.slice(comma + 1);
  if (/(?:^|;)base64(?:;|$)/i.test(metadata)) {
    return base64ToBytes(payload);
  }

  const parts = [];
  let literalStart = 0;
  for (let index = 0; index < payload.length; index += 1) {
    if (payload[index] !== '%') continue;

    if (literalStart < index) {
      parts.push(new TextEncoder().encode(payload.slice(literalStart, index)));
    }
    const hex = payload.slice(index + 1, index + 3);
    if (!/^[\da-f]{2}$/i.test(hex)) {
      throw new TypeError('Malformed percent-encoding in data URL');
    }
    parts.push(Uint8Array.of(Number.parseInt(hex, 16)));
    index += 2;
    literalStart = index + 1;
  }
  if (literalStart < payload.length) {
    parts.push(new TextEncoder().encode(payload.slice(literalStart)));
  }
  return joinByteParts(parts);
}

/** Convert bytes to a base64 data URL. */
export function bytesToDataUrl(input, mimeType = 'application/octet-stream') {
  if (typeof mimeType !== 'string' || mimeType.length === 0 || /[,\r\n]/.test(mimeType)) {
    throw new TypeError('mimeType must be a non-empty data URL media type');
  }
  return `data:${mimeType};base64,${bytesToBase64(input)}`;
}
