/**
 * Overwhite: message layout for a plate written above diffuse white.
 *
 * The message is drawn as ordinary text at 1,189 nits on a 999-nit plate, the
 * same 18.9% contrast used everywhere else here. Measured through the browser's
 * own colour conversion, both land on sRGB 255 without headroom, so the plate is
 * verifiably blank on a screen that has none and readable on one that does.
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

/** Long enough for a note, short enough that this is obviously a toy. */
export const MAX_MESSAGE_CHARS = 90;
export const MAX_LINES = 4;

/** Measured to render identically on a screen without headroom. */
export const PLATE_NITS = 999;
export const INK_NITS = 1189;

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
    "Overwhite writes your message in light above ordinary white. On a display with headroom it is simply readable: no key, no software, no trick. Without headroom it renders as a blank white rectangle, because that screen cannot show anything above white.",
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
