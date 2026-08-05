/**
 * Turn a field of absolute luminances into a real HDR image the browser will
 * render above diffuse white.
 *
 * A "light field" is width x height x 3 floats of nits. Games paint into it in
 * photometric units, then hand it here to be PQ-encoded, written as a lossless
 * PNG, and tagged with the Rec.2100 PQ profile. The profile is what does the
 * work; the CSS on the page only declines to limit it.
 */

import { pqEncodeNits } from "../hdr-core.js";
import { injectPngIccProfile } from "./png-icc.js";
import { NEUTRAL_TINT } from "./photometry.js";

/** Allocate a light field, optionally filled with an ambient luminance. */
export function createLightField(width, height, ambientNits = 0) {
  const nits = new Float32Array(width * height * 3);
  if (ambientNits > 0) nits.fill(ambientNits);
  return { width, height, nits };
}

/**
 * Paint one glow into the field.
 *
 * `coreRadius` is the flat top; between there and `haloRadius` the luminance
 * falls off as a power curve. `coreWhitening` pulls the brightest part of a
 * tinted glow back toward neutral, which is how real emitters behave: a bright
 * enough source desaturates toward white at its centre. Counterfeits set it to
 * zero, which is exactly the tell.
 */
export function paintGlow(field, spec) {
  const {
    x,
    y,
    coreRadius,
    haloRadius,
    peakNits,
    floorNits = 0,
    tint = NEUTRAL_TINT,
    falloff = 2.4,
    coreWhitening = 0,
  } = spec;

  const { width, height, nits } = field;
  const left = Math.max(0, Math.floor(x - haloRadius));
  const right = Math.min(width - 1, Math.ceil(x + haloRadius));
  const top = Math.max(0, Math.floor(y - haloRadius));
  const bottom = Math.min(height - 1, Math.ceil(y + haloRadius));
  const span = Math.max(haloRadius - coreRadius, 0.0001);

  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      const distance = Math.hypot(column - x, row - y);
      if (distance > haloRadius) continue;

      const beyondCore = Math.max(0, distance - coreRadius) / span;
      const intensity = (1 - Math.min(1, beyondCore)) ** falloff;
      if (intensity <= 0) continue;

      const luminance = floorNits + (peakNits - floorNits) * intensity;
      // Whitening rises with intensity, so only the core neutralises.
      const whiten = coreWhitening * intensity;
      const offset = (row * width + column) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const weight = tint[channel] + (1 - tint[channel]) * whiten;
        const value = luminance * weight;
        if (value > nits[offset + channel]) nits[offset + channel] = value;
      }
    }
  }
  return field;
}

/** Paint an axis-aligned rectangle of flat luminance. */
export function paintRect(field, { x, y, width: boxWidth, height: boxHeight, nits: value, tint = NEUTRAL_TINT }) {
  const { width, height, nits } = field;
  const left = Math.max(0, Math.round(x));
  const top = Math.max(0, Math.round(y));
  const right = Math.min(width, Math.round(x + boxWidth));
  const bottom = Math.min(height, Math.round(y + boxHeight));

  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) {
      const offset = (row * width + column) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        nits[offset + channel] = value * tint[channel];
      }
    }
  }
  return field;
}

/**
 * Paint an 8-bit coverage mask at a given luminance. Used for glyphs, which are
 * rasterised by the platform text engine and then lit photometrically.
 */
export function paintMask(field, mask, { nits: peakNits, floorNits = 0, tint = NEUTRAL_TINT }) {
  const { width, height, nits } = field;
  if (mask.length < width * height) {
    throw new RangeError("mask is smaller than the light field");
  }

  for (let index = 0; index < width * height; index += 1) {
    const coverage = mask[index] / 255;
    if (coverage <= 0) continue;
    const luminance = floorNits + (peakNits - floorNits) * coverage;
    const offset = index * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = luminance * tint[channel];
      if (value > nits[offset + channel]) nits[offset + channel] = value;
    }
  }
  return field;
}

/** PQ-encode a light field into 8-bit RGBA pixels. */
export function fieldToImageData(field) {
  const { width, height, nits } = field;
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let index = 0; index < width * height; index += 1) {
    const source = index * 3;
    const target = index * 4;
    pixels[target] = Math.round(pqEncodeNits(nits[source]) * 255);
    pixels[target + 1] = Math.round(pqEncodeNits(nits[source + 1]) * 255);
    pixels[target + 2] = Math.round(pqEncodeNits(nits[source + 2]) * 255);
    pixels[target + 3] = 255;
  }
  return new ImageData(pixels, width, height);
}

/** Rasterise text to an 8-bit coverage mask the size of a light field. */
export function rasterizeText(width, height, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#fff";
  draw(context);

  const { data } = context.getImageData(0, 0, width, height);
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) {
    mask[index] = data[index * 4];
  }
  return mask;
}

/** Compress bytes into an RFC 1950 zlib datastream, as PNG iCCP requires. */
export async function deflateBytes(bytes) {
  if (typeof CompressionStream !== "function") {
    throw new Error("This browser cannot compress the ICC profile (no CompressionStream)");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function canvasToBlob(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the image"))),
      type,
    );
  });
}

/**
 * Encode a light field as a Rec.2100 PQ PNG.
 * `deflatedProfile` comes from deflateBytes() and is cached by the caller.
 */
export async function fieldToHdrPng(field, deflatedProfile) {
  const canvas = document.createElement("canvas");
  canvas.width = field.width;
  canvas.height = field.height;
  canvas.getContext("2d").putImageData(fieldToImageData(field), 0, 0);

  const blob = await canvasToBlob(canvas, "image/png");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const tagged = injectPngIccProfile(bytes, deflatedProfile);
  return new Blob([tagged], { type: "image/png" });
}

/** How long to wait for a load event before giving up and continuing anyway. */
const LOAD_TIMEOUT_MS = 2500;

/**
 * Swap an <img> to a new light field and resolve once it is actually on screen,
 * revoking the previous object URL.
 *
 * This deliberately does NOT use HTMLImageElement.decode(). Chrome never settles
 * that promise for these blob-URL PNGs. The image loads and displays perfectly
 * but the promise hangs forever, stranding every caller awaiting it and leaking
 * the previous object URL. The load event fires reliably, and a timeout covers
 * the case where it does not.
 */
export function showLightField(image, field, deflatedProfile) {
  return fieldToHdrPng(field, deflatedProfile).then((blob) => new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const previous = image.dataset.objectUrl;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.removeEventListener("load", finish);
      image.removeEventListener("error", finish);
      if (previous && previous !== url) URL.revokeObjectURL(previous);
      resolve(blob);
    };

    const timer = setTimeout(finish, LOAD_TIMEOUT_MS);
    image.addEventListener("load", finish);
    image.addEventListener("error", finish);
    image.dataset.objectUrl = url;
    image.src = url;
  }));
}

/** Release an <img>'s object URL. */
export function releaseLightField(image) {
  const url = image?.dataset?.objectUrl;
  if (url) {
    URL.revokeObjectURL(url);
    delete image.dataset.objectUrl;
  }
}
