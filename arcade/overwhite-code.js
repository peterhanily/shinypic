/**
 * Overwhite: message layout for a card written above diffuse white.
 *
 * The card sits at the lowest PQ code that saturates an ordinary screen and the
 * message sits well above it. Converting a full 256-code PQ ramp through
 * ColorSync shows exactly one usable collapse band: codes 192 to 255 all render
 * as sRGB 255, spanning 1,010 to 10,000 nits. Every other band that collapses
 * lives below 3 nits and spans less than 1.1x, so it cannot hold a message.
 * That band is the entire mechanism, and it fixes the card at code 192.
 *
 * The card does NOT fill the frame, and that is load-bearing rather than
 * decorative. A panel renders min(requested, peak). A full-frame 1,010-nit card
 * sits at a display's sustained full-field limit, so card and message clip to
 * the same delivered luminance and the message disappears at any ink value:
 *
 *   panel peak   ink 1,209   ink 1,930
 *      1,000       1.00x       1.00x     <- what shipped, on real hardware
 *      1,600       1.20x       1.58x
 *
 * Shrinking the lit area raises the peak the panel will grant, which is what
 * gives a brighter ink anywhere to go. Neither lever works alone.
 *
 * There is no bit-packing, no error correction and no machine decoder, because
 * the decoder is an eye. That removes the one thing that would make this a covert
 * channel rather than a toy: the reader needs no software, no key and no
 * instructions, only a screen with headroom. It also sidesteps the fact that
 * Safari, the platform most likely to have that headroom, cannot read raw HDR
 * pixels back out of a canvas at all.
 *
 * Nothing here is encryption, and nothing is hidden from anyone with the
 * hardware. See DISCLOSURE.
 */

import { codeToNits } from "./photometry.js";

/** Long enough for a note, short enough that this is obviously a toy. */
export const MAX_MESSAGE_CHARS = 90;
export const MAX_LINES = 4;

/**
 * The lowest PQ code that reaches sRGB 255. Below it the card stops being blank
 * on an ordinary screen and the message leaks out as grey on grey.
 */
export const CLIP_CODE = 192;

/** Measured to render identically on a screen without headroom. */
export const PLATE_NITS = codeToNits(CLIP_CODE);
export const INK_NITS = codeToNits(210);

/**
 * The field the card sits on. Well under the clip point, so it reads as a dark
 * border rather than part of the card, and identical for every message, so it
 * discloses nothing about what was written.
 */
export const SURROUND_NITS = 15;

/** Frame shape and how much of it is allowed to be lit. */
export const FRAME_ASPECT = 16 / 9;
export const CARD_AREA_FRACTION = 0.18;

/**
 * Where the card sits inside the frame, in whole pixels.
 *
 * Integer edges matter: the message is rasterised into the card and composited
 * at this offset, so a fractional origin would let an antialiased glyph edge
 * land on the dark surround, where anything at or above the clip point is
 * plainly visible to everyone.
 */
export function cardRect(frameWidth, frameHeight, cardAspect) {
  const area = frameWidth * frameHeight * CARD_AREA_FRACTION;
  const width = Math.min(Math.round(Math.sqrt(area * cardAspect)), frameWidth);
  const height = Math.min(Math.round(width / cardAspect), frameHeight);
  return {
    x: Math.round((frameWidth - width) / 2),
    y: Math.round((frameHeight - height) / 2),
    width,
    height,
  };
}

/**
 * How much brighter the message is than the card, as a display string.
 *
 * Derived rather than written down, because the page states this figure in four
 * places and a stale copy of it is worse than none: the whole point of the panel
 * is that the numbers are checkable.
 */
export function inkContrastLabel() {
  return `+${((INK_NITS / PLATE_NITS - 1) * 100).toFixed(1)}%`;
}

/** The plain-language statement shipped on the page, verbatim. */
export const DISCLOSURE = Object.freeze({
  headline: "This hides nothing from anyone who has the screen for it.",
  body: [
    "Overwhite writes your message in light above ordinary white. On a display with headroom it is simply readable: no key, no software, no trick. Without headroom the card renders blank, because that screen cannot show anything above white.",
    "That is the whole mechanism. It is not encryption, it is not authentication, and it protects the message from nobody. Anyone who opens the file on an HDR screen reads it, and anyone who knows the technique recovers it in seconds with ordinary image tools.",
    "Do not put anything in here that would hurt you if it were read aloud. If you need a message to be private, encrypt it with a real tool.",
  ],
});

/** Characters that survive a plate legibly: the message is set in monospace caps. */
const ALLOWED = /[^A-Z0-9 .,'!?;:()\-/&+]/g;

/**
 * Fold a message into what the plate can carry. Uppercasing is not decoration:
 * at threshold contrast, caps in a monospace face resolve markedly better than
 * mixed case.
 */
export function normalizeMessage(text) {
  return String(text)
    .toUpperCase()
    // Strip first, then collapse: removing a character between two spaces would
    // otherwise leave a double space behind.
    .replace(ALLOWED, " ")
    .replace(/\s+/g, " ")
    .trimStart()
    .slice(0, MAX_MESSAGE_CHARS);
}

/**
 * Greedy word wrap into at most `maxLines`. Words longer than a line are broken
 * rather than dropped, so no input can silently lose characters.
 */
export function wrapLines(text, charsPerLine, maxLines = MAX_LINES) {
  if (charsPerLine < 1) throw new RangeError("charsPerLine must be at least 1");
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  const push = () => {
    if (current) lines.push(current);
    current = "";
  };

  for (const word of words) {
    let remaining = word;
    while (remaining.length > charsPerLine) {
      push();
      lines.push(remaining.slice(0, charsPerLine));
      remaining = remaining.slice(charsPerLine);
      if (lines.length >= maxLines) return lines.slice(0, maxLines);
    }
    if (!current) current = remaining;
    else if (current.length + 1 + remaining.length <= charsPerLine) current += ` ${remaining}`;
    else {
      push();
      current = remaining;
    }
    if (lines.length >= maxLines) return lines.slice(0, maxLines);
  }
  push();
  return lines.slice(0, maxLines);
}

/** Monospace advance is about 0.66 em; the constant adds a little side margin. */
export function plateAspect(longestLine, lineCount) {
  return (Math.max(longestLine, 1) * 0.66 + 1.2) / (Math.max(lineCount, 1) + 0.9);
}

/**
 * A plate is sized by area, so the glyphs come out about the same height however
 * the message is split. What the split decides is the plate's shape, so this
 * picks the wrap closest to a comfortable landscape rectangle rather than the
 * narrowest one that fits, which would set a short message in four cramped
 * lines.
 */
export const TARGET_ASPECT = 3.2;

export function chooseWrapWidth(text, maxLines = MAX_LINES, targetAspect = TARGET_ASPECT) {
  const message = normalizeMessage(text).trim();
  if (message.length === 0) return 1;

  let best = null;
  for (let width = 6; width <= Math.max(6, message.length); width += 1) {
    const lines = wrapLines(message, width, maxLines + 2);
    if (lines.length > maxLines) continue;
    const longest = Math.max(...lines.map((line) => line.length));
    const cost = Math.abs(Math.log(plateAspect(longest, lines.length) / targetAspect));
    if (!best || cost < best.cost) best = { width, cost };
  }
  return best ? best.width : message.length;
}

/** Exposure is expressed in stops below the true plate, for the SDR viewing aid. */
export function exposedNits(nits, stopsDown) {
  return nits / 2 ** Math.max(0, stopsDown);
}

/** A filename that says what the file is without saying what is in it. */
export function plateFileName() {
  return "overwhite-plate.png";
}
