/**
 * Deterministic seeded randomness for daily boards.
 *
 * The arcade has no backend, so "today's board" has to be reproducible from the
 * date alone. FNV-1a hashes a seed string into 32 bits, xorshift32 expands it.
 */

/** 32-bit FNV-1a hash of a string. Always returns a non-zero unsigned integer. */
export function hashSeed(text) {
  if (typeof text !== "string") {
    throw new TypeError("seed must be a string");
  }

  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // xorshift32 stalls permanently on zero.
  return hash === 0 ? 0x9e3779b9 : hash;
}

/** Create a xorshift32 generator returning floats in [0, 1). */
export function createRandom(seed) {
  let state = typeof seed === "string" ? hashSeed(seed) : (seed >>> 0) || 0x9e3779b9;

  const next = () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };

  next.int = (maxExclusive) => Math.floor(next() * maxExclusive);
  next.pick = (items) => items[Math.floor(next() * items.length)];
  next.range = (minimum, maximum) => minimum + next() * (maximum - minimum);
  return next;
}

/** Fisher-Yates shuffle using a seeded generator. Returns a new array. */
export function shuffle(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

/** The UTC calendar day, as the stable seed component for a daily puzzle. */
export function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/** Whole days since the arcade epoch, used as the human-facing puzzle number. */
export function dayNumber(date = new Date(), epoch = "2026-08-01") {
  const start = Date.parse(`${epoch}T00:00:00Z`);
  const today = Date.parse(`${dayKey(date)}T00:00:00Z`);
  return Math.max(1, Math.round((today - start) / 86_400_000) + 1);
}
