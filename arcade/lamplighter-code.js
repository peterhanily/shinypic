/**
 * Lamplighter: a message written down a ladder of luminance.
 *
 * Every rung carries its word at the same authored contrast, 18.9% above its
 * pedestal, while the pedestal climbs from base white to just under a thousand
 * nits. The file is uniform and the reading is not: as the pedestal passes what
 * your display can deliver, the tone curve compresses that fixed contrast toward
 * nothing and the word fades.
 *
 * How far you get is a physical fact about your screen, your brightness setting
 * and the light in your room. Nothing is encrypted and nothing is concealed.
 * Every rung is in the file in plain sight; the dark does all the work.
 */

import { stopsAboveBase } from "./photometry.js";
import { createRandom } from "./rng.js";

export const RUNG_COUNT = 10;

/**
 * The ladder starts well below diffuse white and ends just under a thousand
 * nits. Starting below white is deliberate: the first four rungs are readable on
 * any screen ever made, so everyone gets a foothold and the measurement is of
 * where you STOP rather than whether you could start. Rung five is the first
 * that asks for headroom.
 */
export const FIRST_PEDESTAL_NITS = 60;
export const LAST_PEDESTAL_NITS = 999;

/**
 * One authored contrast for the whole ladder. Roughly 19% is a comfortable,
 * unambiguous step for large type in isolation, well above threshold when the
 * display has room and the first thing to go when it does not.
 */
export const CONTRAST_RATIO = 1.189;

/** The multiplier between one rung and the next. One shade step undoes exactly this. */
export function rungRatio(count = RUNG_COUNT) {
  if (count < 2) throw new RangeError("a ladder needs at least two rungs");
  return (LAST_PEDESTAL_NITS / FIRST_PEDESTAL_NITS) ** (1 / (count - 1));
}

/** Pedestal luminances, geometrically spaced so each rung is an equal stop step. */
export function rungPedestals(count = RUNG_COUNT) {
  const ratio = rungRatio(count);
  return Array.from({ length: count }, (_, index) => FIRST_PEDESTAL_NITS * ratio ** index);
}

/** Shades allowed per descent. Few enough to hurt, enough to rescue one rung. */
export const SHADE_ALLOWANCE = 3;

/** The luminance a rung's glyph is actually drawn at. */
export function glyphNits(pedestalNits) {
  return pedestalNits * CONTRAST_RATIO;
}

/**
 * Word sets chosen so no rung can be guessed from the one before it. A message
 * whose next word is inferable would measure reading comprehension, not display
 * headroom.
 */
export const MESSAGE_SETS = Object.freeze([
  Object.freeze(["LANTERN", "HARBOUR", "SALT", "MIDNIGHT", "COMPASS", "EMBER", "QUARTZ", "TIDE", "BEACON", "ASH"]),
  Object.freeze(["THISTLE", "ANVIL", "PLUM", "GRANITE", "FERRY", "COBALT", "MOTH", "SPIRE", "HOLLOW", "FLINT"]),
  Object.freeze(["ORCHARD", "PEWTER", "WREN", "BASALT", "LEDGER", "SAFFRON", "KILN", "MARSH", "VELLUM", "DRIFT"]),
  Object.freeze(["CINDER", "MERIDIAN", "OAK", "SLATE", "LANTERN", "BRINE", "HALO", "TROUGH", "SABLE", "RUNG"]),
]);

/** Pick the day's ladder. */
export function messageForSeed(seed) {
  const random = createRandom(seed);
  return random.pick(MESSAGE_SETS);
}

/**
 * Split arbitrary text into exactly `count` rungs, distributing words as evenly
 * as possible so a long message still fits the ladder.
 */
export function splitIntoRungs(text, count = RUNG_COUNT) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) throw new RangeError("a message needs at least one word");

  const rungs = [];
  let taken = 0;
  for (let index = 0; index < count; index += 1) {
    const remainingRungs = count - index;
    const remainingWords = words.length - taken;
    const take = Math.max(1, Math.round(remainingWords / remainingRungs));
    const slice = words.slice(taken, taken + take);
    // Once the words run out the ladder keeps going, unlit. The pedestals still
    // rise, so a short message does not shorten the measurement.
    rungs.push(slice.join(" "));
    taken += slice.length;
    if (taken >= words.length && rungs.length < count) {
      while (rungs.length < count) rungs.push("");
      break;
    }
  }
  return rungs.slice(0, count);
}

/** Build the full ladder: word, pedestal and glyph luminance per rung. */
export function buildLadder(words, count = RUNG_COUNT) {
  const pedestals = rungPedestals(count);
  const rungWords = Array.isArray(words) ? words : splitIntoRungs(words, count);

  return pedestals.map((pedestalNits, index) => ({
    rung: index + 1,
    word: (rungWords[index] || "").toUpperCase(),
    pedestalNits,
    glyphNits: glyphNits(pedestalNits),
    stops: stopsAboveBase(pedestalNits),
  }));
}

/** Fold away case, punctuation and spacing before comparing a typed answer. */
export function normalizeAnswer(text) {
  return String(text)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

/** Forgiving: the game measures whether you saw it, not how you type. */
export function matchesWord(answer, word) {
  const normalized = normalizeAnswer(answer);
  return normalized.length > 0 && normalized === normalizeAnswer(word);
}

/** Summarise how deep a reader got. */
export function depthReport(ladder, rungsRead) {
  const clamped = Math.max(0, Math.min(rungsRead, ladder.length));
  if (clamped === 0) {
    return {
      rungsRead: 0,
      reachedNits: null,
      stops: null,
      summary: "No rung was readable. This display has no room above diffuse white.",
    };
  }

  const deepest = ladder[clamped - 1];
  return {
    rungsRead: clamped,
    reachedNits: deepest.pedestalNits,
    stops: deepest.stops,
    summary: clamped === ladder.length
      ? "You read the whole ladder. This display still had contrast left at the last rung."
      : `The message faded between rung ${clamped} and rung ${clamped + 1}.`,
  };
}

/** The share string. Plain text, built client-side. */
export function lamplighterShareText(dayNumber, report, { browserLabel, shadesUsed = 0, entry = "blind" }) {
  const filled = "▰".repeat(report.rungsRead);
  const empty = "▱".repeat(RUNG_COUNT - report.rungsRead);
  const depth = report.reachedNits
    ? `${Math.round(report.reachedNits)} nits · +${report.stops.toFixed(1)} stops`
    : "no headroom";
  const shade = shadesUsed === 0
    ? "unshaded"
    : `${shadesUsed} shade${shadesUsed === 1 ? "" : "s"}`;

  return [
    `LAMPLIGHTER #${dayNumber}`,
    `${filled}${empty}  ${report.rungsRead}/${RUNG_COUNT} · ${shade}`,
    depth,
    `entry: ${entry === "sighted" ? "read the plate" : "plate was blank"}`,
    browserLabel,
    "Your screen decided where this stopped.",
  ].join("\n");
}
