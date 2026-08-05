/**
 * The Keyhole: an entry plate only a display with headroom can read.
 *
 * The plate sits at 999 nits with a digit on it at 1,189, the same 18.9%
 * contrast used everywhere else here. Measured through the browser's own colour
 * conversion, both land on sRGB 255 when there is no headroom, so the rendered
 * contrast is exactly zero and the plate is verifiably blank.
 *
 * That makes the gate the hardware answering for itself, rather than a media
 * query that lies in both directions.
 *
 * Nobody is locked out. Say the plate is blank and the bench opens anyway, with
 * the run marked as having started blind.
 */

import { createLightField, paintMask, paintRect, rasterizeText, releaseLightField, showLightField } from "./hdr-image.js";
import { createRandom } from "./rng.js";
import { el, fitToAreaBudget, viewportPixels } from "./ui.js";

/** Measured: both land on sRGB 255 when there is no headroom. */
export const KEYHOLE_PEDESTAL_NITS = 999;
export const KEYHOLE_GLYPH_NITS = 1189;

/** How long before the way out appears on its own. */
const FALLBACK_DELAY_MS = 4500;

const KEYHOLE_ASPECT = 2.6;

/** Never 0, so a blank plate can never be mistaken for an answer. */
export function keyholeDigit(seed) {
  return 1 + createRandom(seed).int(9);
}

function paintPlate(digit, width, height) {
  const field = createLightField(width, height, 2);
  paintRect(field, { x: 0, y: 0, width, height, nits: KEYHOLE_PEDESTAL_NITS });
  if (digit === null) return field;

  const mask = rasterizeText(width, height, (context) => {
    const size = Math.round(height * 0.62);
    context.font = `800 ${size}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(digit), width / 2, height / 2 + size * 0.04);
  });
  paintMask(field, mask, { nits: KEYHOLE_GLYPH_NITS, floorNits: KEYHOLE_PEDESTAL_NITS });
  return field;
}

/**
 * Build a keyhole. `onOpen(mode)` is called with "sighted" or "blind".
 * Returns { element, destroy }.
 */
export function createKeyhole({ seed, profile, intensityScale, onOpen }) {
  const digit = keyholeDigit(seed);
  // Reduced intensity pulls the plate under the clip point, which would show
  // the digit on any screen. A gate that silently stops gating is worse than
  // one that admits it is off.
  const gateWorks = intensityScale >= 1;

  const plate = el("img", {
    class: "keyhole-plate",
    alt: gateWorks
      ? "An entry plate carrying a single digit, visible only with display headroom."
      : "An entry plate, disabled at reduced intensity.",
    draggable: "false",
  });
  const stage = el("div", { class: "keyhole-stage" }, [plate]);
  const feedback = el("p", { class: "keyhole-feedback", "aria-live": "polite" });

  const keypad = el("div", { class: "keypad", role: "group", "aria-label": "Type the digit on the plate" },
    Array.from({ length: 9 }, (_, index) => el("button", {
      class: "keypad-key",
      type: "button",
      onclick: () => guess(index + 1),
    }, String(index + 1))));

  const fallback = el("button", {
    class: "arcade-button arcade-button--ghost keyhole-out",
    type: "button",
    hidden: gateWorks,
    onclick: () => open("blind"),
  }, gateWorks ? "The plate is blank for me" : "Open the bench");

  const element = el("section", { class: "keyhole", "aria-labelledby": "keyholeTitle" }, [
    el("p", { class: "keyhole-eyebrow", text: "Entry" }),
    el("h2", {
      class: "keyhole-title",
      id: "keyholeTitle",
      text: gateWorks ? "There is a number on this plate." : "The plate is switched off.",
    }),
    el("p", {
      class: "keyhole-blurb",
      text: gateWorks
        ? "Read it and your display has room above ordinary white. See nothing and it does not. Either way the bench opens."
        : "Reduced intensity drops the plate below the point where a screen without headroom flattens it, so the digit would show to everyone and the gate would measure nothing.",
    }),
    stage,
    gateWorks ? keypad : null,
    feedback,
    fallback,
  ]);

  let fallbackTimer = null;
  let opened = false;
  let wrongGuesses = 0;

  function guess(value) {
    if (opened) return;
    if (value === digit) {
      open("sighted");
      return;
    }
    wrongGuesses += 1;
    // A wrong digit is not the same as no digit: the plate resolved, the glyph
    // did not. Worth saying.
    feedback.textContent = wrongGuesses === 1
      ? "Not that one. Seeing something you cannot quite resolve means your display is near its limit."
      : "Still not it. Lean in, or say the plate is blank and open the bench anyway.";
    feedback.classList.add("is-wrong");
    if (wrongGuesses >= 2) fallback.hidden = false;
  }

  function open(mode) {
    if (opened) return;
    opened = true;
    clearTimeout(fallbackTimer);
    onOpen(mode);
  }

  if (gateWorks) {
    fallbackTimer = setTimeout(() => {
      if (!opened) fallback.hidden = false;
    }, FALLBACK_DELAY_MS);
  }

  // Called after mounting, so the plate is sized against a laid-out page.
  const render = async () => {
    // Static and non-flashing, so the flash-area rule does not bind it. Held
    // well inside BT.1702-2's quarter-of-frame area clause anyway.
    const { width, height } = fitToAreaBudget(viewportPixels() * 0.035, KEYHOLE_ASPECT, {
      minWidth: 200,
      maxWidth: 420,
    });
    stage.style.setProperty("--keyhole-width", `${width}px`);
    stage.style.setProperty("--keyhole-aspect", String(KEYHOLE_ASPECT));
    await showLightField(plate, paintPlate(gateWorks ? digit : null, width, height), profile);
  };

  return {
    element,
    digit,
    gateWorks,
    render,
    destroy() {
      clearTimeout(fallbackTimer);
      releaseLightField(plate);
    },
  };
}
