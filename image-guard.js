export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 64_000_000;
export const MAX_IMAGE_EDGE = 16_384;

const KNOWN_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
]);

const ISO_BASE_MEDIA_BRANDS = new Set([
  "avif", "avis", "heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1",
]);

export class ImageGuardError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ImageGuardError";
    this.code = code;
  }
}

export function detectRasterFormat(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    .every((value, index) => bytes[index] === value)) return "png";
  if (bytes.length >= 12
    && ascii(bytes, 0, 4) === "RIFF"
    && ascii(bytes, 8, 12) === "WEBP") return "webp";
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    for (let offset = 8; offset + 4 <= Math.min(bytes.length, 64); offset += 4) {
      const brand = ascii(bytes, offset, offset + 4);
      if (ISO_BASE_MEDIA_BRANDS.has(brand)) return brand.startsWith("avi") ? "avif" : "heif";
    }
  }
  return null;
}

export async function validateRasterFile(file) {
  if (!file || typeof file.slice !== "function") {
    throw new ImageGuardError("missing", "Choose a photo file first.");
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new ImageGuardError("bytes", `Choose a photo smaller than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
  }
  const declaredType = String(file.type || "").toLowerCase();
  if (declaredType && !KNOWN_MIME_TYPES.has(declaredType)) {
    throw new ImageGuardError("type", "Use a JPEG, PNG, WebP, AVIF, HEIC or HEIF photo.");
  }
  const format = detectRasterFormat(await file.slice(0, 64).arrayBuffer());
  if (!format) {
    throw new ImageGuardError("signature", "That file is not a supported raster photo.");
  }
  return format;
}

export function validateImageDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new ImageGuardError("dimensions", "The image dimensions could not be read safely.");
  }
  if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS) {
    throw new ImageGuardError("dimensions", "Choose a photo under 64 megapixels and 16,384 pixels on either edge.");
  }
  return { width, height };
}

function ascii(bytes, start, end) {
  return String.fromCharCode(...bytes.subarray(start, end));
}
