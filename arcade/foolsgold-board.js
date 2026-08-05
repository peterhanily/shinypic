/**
 * Fool's Gold board generation.
 *
 * Twelve objects. Four are real emitters, encoded above diffuse white. Eight are
 * counterfeits whose peak luminance is exactly base white but which use the
 * perceptual vocabulary of fake glow to try to read as light anyway.
 *
 * Pure: coordinates are normalised, luminances are absolute nits, and nothing
 * here touches the DOM. The renderer turns a board into pixels; the scorer turns
 * a board plus a selection into a result.
 */

import { BASE_WHITE_NITS, EMITTER_RUNGS } from "./photometry.js";
import { createRandom, shuffle } from "./rng.js";

/**
 * The board's ambient field. Dark but not zero, because "The Well" needs
 * somewhere to dig. At 3 nits against 203-nit diffuse white it renders near 1.5%
 * relative luminance: a dark room rather than a grey rectangle.
 */
export const FIELD_NITS = 3;

export const OBJECT_COUNT = 12;
export const REAL_COUNT = 4;

/**
 * The five ways to fake a light. Each counterfeit uses exactly one and the
 * reveal names it, which is why losing a round still teaches you something.
 */
export const FORGERIES = Object.freeze({
  pinprick: Object.freeze({
    id: "pinprick",
    name: "Pinprick",
    basis: "Smaller targets cross the luminosity threshold at lower luminance, so a tiny core reads as a light while measuring no brighter than paper.",
    tell: "The halo geometry is too clean and too circular for something that small.",
  }),
  ember: Object.freeze({
    id: "ember",
    name: "Ember",
    basis: "Chromatic purity lowers the luminosity threshold. A saturated core looks luminous at a luminance a neutral one could not manage.",
    tell: "It saturates toward its hue at the centre. A real emitter desaturates toward white as it gets brighter.",
  }),
  well: Object.freeze({
    id: "well",
    name: "The Well",
    basis: "Simultaneous contrast. Surround anything with deeper black and it gains apparent brightness for free.",
    tell: "The effect is purely local. Nothing spills past the black ring, because there is nothing above white to spill.",
  }),
  bloom: Object.freeze({
    id: "bloom",
    name: "Bloom",
    basis: "The standard glow vocabulary: a wide, soft halo implying a source too bright to contain.",
    tell: "The core cannot exceed its own halo's ceiling. Both top out at exactly the same white.",
  }),
  mimic: Object.freeze({
    id: "mimic",
    name: "Mimic",
    basis: "A direct copy of a real emitter's falloff and core whitening, scaled to fit underneath base white.",
    tell: "Nothing visual separates it. Only the Squint does.",
  }),
});

/**
 * A run is three boards that get dimmer, not longer. The first is generous, the
 * last sits on the luminosity threshold, the lowest luminance that can read as a
 * light at all. Clear a board and you continue. Miss one and the run is over.
 *
 * Difficulty is expressed only in which rungs the emitters occupy, so the thing
 * that gets harder is the one thing the game is about.
 */
export const DIFFICULTY_TIERS = Object.freeze([
  Object.freeze({ tier: 1, name: "Open", rungs: Object.freeze([4, 4, 3, 3]), blurb: "Four lights, none of them shy." }),
  Object.freeze({ tier: 2, name: "Dim", rungs: Object.freeze([4, 3, 2, 2]), blurb: "Two of them have stepped back." }),
  Object.freeze({ tier: 3, name: "Threshold", rungs: Object.freeze([3, 2, 1, 1]), blurb: "Two are sitting exactly on the line where a bright patch becomes a light." }),
]);

const FORGERY_ORDER = Object.freeze(["mimic", "ember", "pinprick", "bloom", "well", "mimic", "ember", "bloom"]);

const EMBER_TINTS = Object.freeze(["#ff8a2b", "#31d2ff", "#ff4fc3", "#8dff45"]);

/** Mostly neutral, but not always: colour must not be a free tell. */
const EMITTER_TINTS = Object.freeze(["#ffffff", "#ffffff", "#ffffff", "#ffeacb"]);

function counterfeitSpec(technique, random) {
  switch (technique) {
    case "pinprick":
      return {
        coreRadius: 2.2,
        haloRadius: 15,
        falloff: 3.4,
        tint: "#ffffff",
        coreWhitening: 0,
        voidRadius: 0,
      };
    case "ember":
      return {
        coreRadius: 6,
        haloRadius: 27,
        falloff: 2.1,
        tint: random.pick(EMBER_TINTS),
        coreWhitening: 0,
        voidRadius: 0,
      };
    case "well":
      return {
        coreRadius: 7,
        haloRadius: 19,
        falloff: 3.5,
        tint: "#ffffff",
        coreWhitening: 0.2,
        voidRadius: 44,
      };
    case "bloom":
      return {
        coreRadius: 5,
        haloRadius: 42,
        falloff: 1.5,
        tint: "#ffffff",
        coreWhitening: 0,
        voidRadius: 0,
      };
    case "mimic":
    default:
      return {
        coreRadius: 8,
        haloRadius: 24,
        falloff: 2.4,
        tint: "#ffffff",
        coreWhitening: 0.85,
        voidRadius: 0,
      };
  }
}

/**
 * Build a board. Objects sit on a 4x3 grid with jitter, so nothing collides and
 * nothing lines up too neatly. Positions are normalised to 0..1.
 */
export function createBoard(seed, { columns = 4, rows = 3, tier = 3 } = {}) {
  const random = createRandom(seed);
  if (columns * rows !== OBJECT_COUNT) {
    throw new RangeError(`grid must hold exactly ${OBJECT_COUNT} objects`);
  }
  const tierSpec = DIFFICULTY_TIERS.find((entry) => entry.tier === tier);
  if (!tierSpec) throw new RangeError(`unknown difficulty tier ${tier}`);

  // Identity comes from the grid cell, in reading order. Which cells are real is
  // drawn separately, so neither the id nor the tab order carries the answer.
  const realCells = new Set(
    shuffle(Array.from({ length: OBJECT_COUNT }, (_, index) => index), random).slice(0, REAL_COUNT),
  );

  const rungs = shuffle(
    tierSpec.rungs.map((rung) => EMITTER_RUNGS.find((entry) => entry.rung === rung)),
    random,
  );
  const forgeries = shuffle(FORGERY_ORDER, random);
  const tints = shuffle(EMITTER_TINTS, random);
  let realSeen = 0;
  let fakeSeen = 0;

  const objects = Array.from({ length: OBJECT_COUNT }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = (column + 0.5) / columns + random.range(-0.055, 0.055);
    const y = (row + 0.5) / rows + random.range(-0.06, 0.06);
    const base = { id: `o${index}`, x, y };

    if (realCells.has(index)) {
      const { rung, nits } = rungs[realSeen];
      const tint = tints[realSeen];
      realSeen += 1;
      return {
        ...base,
        real: true,
        rung,
        technique: null,
        peakNits: nits,
        coreRadius: 8,
        haloRadius: 24,
        falloff: 2.4,
        tint,
        coreWhitening: 0.85,
        voidRadius: 0,
      };
    }

    const technique = forgeries[fakeSeen];
    fakeSeen += 1;
    return {
      ...base,
      real: false,
      rung: null,
      technique,
      peakNits: BASE_WHITE_NITS,
      ...counterfeitSpec(technique, random),
    };
  });

  return { seed, objects, realCount: REAL_COUNT, tier: tierSpec };
}

/** Score a selection against a board. */
export function scoreBoard(board, selectedIds) {
  const selected = new Set(selectedIds);
  const real = board.objects.filter((object) => object.real);
  const hits = real.filter((object) => selected.has(object.id));
  const misses = real.filter((object) => !selected.has(object.id));
  const falsePositives = board.objects.filter((object) => !object.real && selected.has(object.id));

  return {
    hits: hits.length,
    total: real.length,
    misses,
    falsePositives,
    perfect: hits.length === real.length && falsePositives.length === 0,
    // The dimmest emitter correctly identified. A headroom proxy, deliberately
    // reported separately from the score so it cannot be mistaken for skill.
    lowestRungCleared: hits.length ? Math.min(...hits.map((object) => object.rung)) : null,
  };
}

/** The share string. Plain text, built client-side, no tracking parameters. */
export function foolsGoldShareText(dayNumber, run, { browserLabel }) {
  const board = (index) => {
    const result = run.results[index];
    if (!result) return "▫";
    return result.perfect ? "◆" : "◇";
  };
  const pips = DIFFICULTY_TIERS.map((_, index) => board(index)).join("");
  const squintNote = run.squints === 0
    ? "unsquinted"
    : `squinted ${run.squints === 1 ? "once" : `${run.squints} times`}`;
  const entry = run.entry === "sighted" ? "read the plate" : "plate was blank";

  return [
    `FOOL'S GOLD #${dayNumber}`,
    `${pips}  ${run.cleared}/${DIFFICULTY_TIERS.length} boards · ${squintNote}`,
    `entry: ${entry}`,
    browserLabel,
    "Screenshot this run and nobody can solve it.",
  ].join("\n");
}
