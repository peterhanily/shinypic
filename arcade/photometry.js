/**
 * The arcade's shared light vocabulary.
 *
 * Everything the three games draw is specified in absolute nits and converted
 * here, once. Keeping the numbers in one place is what lets the games claim a
 * score means something: a rung is a luminance, not a slider position.
 */

import {
  linearSrgbToRec2020,
  pqDecodeSignal,
  pqEncodeNits,
  srgbToLinear,
} from "../hdr-core.js";

/**
 * ITU-R BT.2408 puts nominal HDR Reference White at 203 cd/m². That is diffuse
 * white, graphics white, the brightness of ordinary paper in the scene. Chromium
 * and WebKit both anchor SDR content there, and every board here treats it as the
 * boundary between a lit surface and a light.
 */
export const BASE_WHITE_NITS = 203;

/**
 * Bonato & Gilchrist put the luminosity threshold at roughly 1.7x perceived
 * white. That is where a patch stops reading as an illuminated surface and starts
 * reading as a source, and it is the lowest rung worth showing: below it a bright
 * patch is just bright, not a light.
 */
export const LUMINOSITY_THRESHOLD_RATIO = 1.7;

/**
 * Four rungs from the luminosity threshold to 3.2x base white. The ceiling is
 * 650 nits rather than ShinyPic's 6,800 on purpose: browsers tone-map
 * un-annotated PQ against a ceiling near 1,000 nits, so the top of the editor's
 * range is compressed away before the panel is ever consulted. Staying low also
 * keeps every luminance transition small enough to sit inside published flash
 * thresholds.
 */
export const EMITTER_RUNGS = Object.freeze([
  Object.freeze({ rung: 1, ratio: 1.7, nits: 345 }),
  Object.freeze({ rung: 2, ratio: 2.1, nits: 426 }),
  Object.freeze({ rung: 3, ratio: 2.6, nits: 528 }),
  Object.freeze({ rung: 4, ratio: 3.2, nits: 650 }),
]);

/** The dimmest and brightest luminance any arcade surface is allowed to reach. */
export const ARCADE_CEILING_NITS = 1200;

/** Convert absolute nits to the 8-bit PQ code value actually written to a pixel. */
export function nitsToCode(nits) {
  return Math.round(pqEncodeNits(nits) * 255);
}

/** Convert an 8-bit PQ code value back to absolute nits. */
export function codeToNits(code) {
  return pqDecodeSignal(Math.min(Math.max(code, 0), 255) / 255);
}

/** Stops above base white, the unit the games report scores in. */
export function stopsAboveBase(nits) {
  return Math.log2(Math.max(nits, 1e-6) / BASE_WHITE_NITS);
}

/** Format a luminance for display: whole nits, thousands separated. */
export function formatNits(nits) {
  return `${Math.round(nits).toLocaleString("en-US")} nits`;
}

/** Format a signed stop count to one decimal place. */
export function formatStops(stops) {
  const rounded = Math.round(stops * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)} stops`;
}

/**
 * Convert an sRGB hex colour into per-channel weights normalised so the
 * brightest channel is 1. Multiplying a target luminance by these keeps the hue
 * while letting the caller specify "how bright" in nits.
 */
export function tintWeights(hex) {
  const parsed = /^#?([\da-f]{6})$/i.exec(String(hex));
  if (!parsed) throw new TypeError("tint must be a six-digit hex colour");
  const value = Number.parseInt(parsed[1], 16);
  const linear = [
    srgbToLinear(((value >> 16) & 0xff) / 255),
    srgbToLinear(((value >> 8) & 0xff) / 255),
    srgbToLinear((value & 0xff) / 255),
  ];
  const rec2020 = linearSrgbToRec2020(linear);
  const peak = Math.max(...rec2020, 1e-4);
  return rec2020.map((channel) => Math.max(0, channel / peak));
}

/** Neutral white needs no conversion: the Rec.2020 matrix rows sum to one. */
export const NEUTRAL_TINT = Object.freeze([1, 1, 1]);
