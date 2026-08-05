/**
 * Lamplighter: descend a ladder of luminance until the message stops.
 *
 * One rung is lit at a time. That is a safety decision, since the whole ladder at
 * once would blow past the area budget, and a design one: the descent is the
 * experience, and the moment a word refuses to resolve is the point.
 *
 * Three Shades per descent drop the current rung back one step. That is the
 * software version of the move the physics rewards, which is dimming the room.
 * Spending one is recorded, because a rung you had to shade is not a rung your
 * display delivered.
 */

import {
  RUNG_COUNT,
  SHADE_ALLOWANCE,
  buildLadder,
  depthReport,
  lamplighterShareText,
  matchesWord,
  messageForSeed,
  rungRatio,
  splitIntoRungs,
} from "./lamplighter-code.js";
import {
  createLightField,
  paintMask,
  paintRect,
  rasterizeText,
  releaseLightField,
  showLightField,
} from "./hdr-image.js";
import { BASE_WHITE_NITS, formatNits, formatStops } from "./photometry.js";
import { brightAreaBudget } from "./limiter.js";
import { createKeyhole } from "./keyhole.js";
import { el, fitToAreaBudget, shareOrCopy, stepWedge, viewportPixels } from "./ui.js";

const PLATE_ASPECT = 6.4;

export const lamplighterMeta = {
  id: "lamplighter",
  title: "Lamplighter",
  tagline: "A message written at one contrast, on a pedestal that keeps rising. Your screen decides where it ends.",
  verb: "Descend",
};

function paintRung(rung, width, height, intensityScale, shadeSteps) {
  const shaded = rung.pedestalNits / rungRatio() ** shadeSteps;
  // Reduced intensity only pulls back the part of the pedestal that is ABOVE
  // diffuse white; rungs below white are unaffected, because they were never
  // the thing anyone needed protecting from.
  const pedestal = shaded > BASE_WHITE_NITS
    ? BASE_WHITE_NITS + (shaded - BASE_WHITE_NITS) * intensityScale
    : shaded;
  const glyph = pedestal * (rung.glyphNits / rung.pedestalNits);

  const field = createLightField(width, height, 4);
  paintRect(field, { x: 0, y: 0, width, height, nits: pedestal });

  if (rung.word) {
    const mask = rasterizeText(width, height, (context) => {
      const size = Math.round(height * 0.52);
      context.font = `700 ${size}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.letterSpacing = `${Math.round(size * 0.12)}px`;
      context.fillText(rung.word, width / 2, height / 2 + size * 0.04);
    });
    paintMask(field, mask, { nits: glyph, floorNits: pedestal });
  }
  return field;
}

export function mountLamplighter(host, api) {
  const state = {
    ladder: [],
    index: 0,
    read: 0,
    finished: false,
    custom: null,
    busy: false,
    entry: "blind",
    shadesUsed: 0,
    shadeOnRung: 0,
  };

  const plate = el("img", {
    class: "plate-image",
    alt: "One rung of the ladder: a word at fixed contrast on a rising pedestal.",
    draggable: "false",
  });
  const plateStage = el("div", { class: "plate-stage" }, [plate]);

  const rungReadout = el("div", { class: "rung-readout" });
  const answer = el("input", {
    class: "rung-input",
    type: "text",
    autocomplete: "off",
    autocapitalize: "characters",
    spellcheck: "false",
    "aria-label": "Type the word you can read",
    placeholder: "type what you see",
  });
  const feedback = el("p", { class: "rung-feedback", "aria-live": "polite" });
  const resultPanel = el("div", { class: "result-panel", hidden: true });

  const shadeButton = el("button", {
    class: "arcade-button arcade-button--ghost shade-button",
    type: "button",
    onclick: shade,
  }, [el("span", { class: "shade-pips", "aria-hidden": "true" }), "Shade"]);

  const form = el("form", {
    class: "rung-form",
    onsubmit: (event) => {
      event.preventDefault();
      submit();
    },
  }, [
    answer,
    el("button", { class: "arcade-button arcade-button--primary", type: "submit" }, "Read it"),
    shadeButton,
    el("button", {
      class: "arcade-button arcade-button--ghost",
      type: "button",
      onclick: () => finish("You stopped here."),
    }, "I can't read this"),
  ]);

  const play = el("div", { class: "game-play", hidden: true }, [
    rungReadout,
    plateStage,
    form,
    feedback,
    resultPanel,
  ]);

  const keyhole = createKeyhole({
    seed: `keyhole:lamplighter:${api.dayKey}`,
    profile: api.profile,
    intensityScale: api.intensityScale,
    onOpen: (mode) => {
      keyhole.element.hidden = true;
      play.hidden = false;
      state.entry = mode;
      start();
    },
  });

  host.append(
    el("div", { class: "game-head" }, [
      el("div", {}, [
        el("p", { class: "game-eyebrow" }, [stepWedge(4), lamplighterMeta.verb]),
        el("h1", { class: "game-title", text: lamplighterMeta.title }),
        el("p", { class: "game-blurb", text: lamplighterMeta.tagline }),
      ]),
    ]),
    keyhole.element,
    play,
    el("details", { class: "method-note" }, [
      el("summary", { text: "Why the words stop" }),
      el("div", { class: "method-body" }, [
        el("p", { text: `Every rung carries its word at the same authored contrast, 18.9% above its own pedestal. Only the pedestal changes, climbing from 60 nits to 999 in ten equal stop steps. The first four rungs sit at or below ${BASE_WHITE_NITS}-nit diffuse white, so they read on any screen. Rung five is the first that asks for headroom.` }),
        el("p", { text: "As the pedestal passes what your display can deliver, the tone curve compresses that fixed contrast toward nothing and the word fades. The file is uniform. The reading is not. Turn the room lights or your screen brightness down and you will get further. A Shade does the same in software, one rung at a time." }),
        el("p", { class: "method-warning", text: "This is not concealment. Every rung is in the image in plain sight, and anyone with more headroom reads the whole thing." }),
      ]),
    ]),
  );

  keyhole.render();

  function updateShadeButton() {
    const left = SHADE_ALLOWANCE - state.shadesUsed;
    shadeButton.disabled = left <= 0 || state.busy || state.shadeOnRung > 0;
    shadeButton.querySelector(".shade-pips").replaceChildren(
      ...Array.from({ length: SHADE_ALLOWANCE }, (_, index) =>
        el("i", { class: index < left ? "is-left" : "" })),
    );
  }

  async function showRung() {
    const rung = state.ladder[state.index];
    const budget = brightAreaBudget(viewportPixels());
    const { width, height } = fitToAreaBudget(budget, PLATE_ASPECT, { minWidth: 240, maxWidth: 720 });
    plateStage.style.setProperty("--plate-width", `${width}px`);
    plateStage.style.setProperty("--plate-aspect", String(PLATE_ASPECT));

    const shownPedestal = rung.pedestalNits / rungRatio() ** state.shadeOnRung;

    rungReadout.replaceChildren(
      el("div", { class: "rung-position" }, [
        el("span", { class: "rung-label", text: "Rung" }),
        el("strong", { class: "figure", text: `${rung.rung}` }),
        el("span", { class: "rung-of", text: `of ${RUNG_COUNT}` }),
      ]),
      el("div", { class: "rung-meters" }, [
        el("div", {}, [
          el("span", { text: state.shadeOnRung ? "Pedestal · shaded" : "Pedestal" }),
          el("strong", { class: state.shadeOnRung ? "figure is-shaded" : "figure", text: formatNits(shownPedestal) }),
        ]),
        el("div", {}, [el("span", { text: "vs. white" }), el("strong", { class: "figure", text: formatStops(rung.stops) })]),
        el("div", {}, [el("span", { text: "Contrast" }), el("strong", { class: "figure", text: "+18.9%" })]),
      ]),
      el("div", { class: "rung-track", "aria-hidden": "true" },
        state.ladder.map((step, index) => el("i", {
          class: index < state.read ? "is-read" : index === state.index ? "is-current" : "",
        }))),
    );

    answer.value = "";
    setBusy(true);
    await showLightField(
      plate,
      paintRung(rung, width, height, api.intensityScale, state.shadeOnRung),
      api.profile,
    );
    setBusy(false);
    answer.focus();
  }

  function setBusy(busy) {
    state.busy = busy;
    answer.disabled = busy;
    for (const button of form.querySelectorAll("button")) button.disabled = busy;
    updateShadeButton();
  }

  function shade() {
    if (state.busy || state.shadesUsed >= SHADE_ALLOWANCE || state.shadeOnRung > 0) return;
    state.shadesUsed += 1;
    state.shadeOnRung = 1;
    feedback.textContent = "Shaded one step. This rung now sits where the one below it does.";
    feedback.classList.remove("is-wrong");
    showRung();
  }

  function submit() {
    if (state.busy) return;
    const rung = state.ladder[state.index];
    if (!rung.word) {
      finish("The ladder ran out of message before it ran out of rungs.");
      return;
    }
    if (!matchesWord(answer.value, rung.word)) {
      feedback.textContent = "That is not what is written there.";
      feedback.classList.add("is-wrong");
      finish("You misread this rung, so this is where the message stopped being legible.");
      return;
    }

    state.read = state.index + 1;
    feedback.textContent = "";
    feedback.classList.remove("is-wrong");

    if (state.read >= state.ladder.length) {
      finish("You read every rung.");
      return;
    }
    state.index += 1;
    state.shadeOnRung = 0;
    showRung();
  }

  function finish(note) {
    if (state.finished) return;
    state.finished = true;
    form.hidden = true;
    plateStage.hidden = true;

    const report = depthReport(state.ladder, state.read);
    const revealed = state.ladder
      .map((rung) => (rung.word ? rung.word : "·"))
      .map((word, index) => el("span", {
        class: index < state.read ? "revealed-word is-read" : "revealed-word",
        text: word,
      }));

    resultPanel.replaceChildren(
      el("div", { class: "result-head" }, [
        el("p", { class: "result-score" }, [
          el("strong", { class: "figure", text: `${report.rungsRead}/${RUNG_COUNT}` }),
          el("span", { text: "rungs read" }),
        ]),
        el("dl", { class: "result-stats" }, [
          el("div", {}, [
            el("dt", { text: "Reached" }),
            el("dd", { class: "figure", text: report.reachedNits ? formatNits(report.reachedNits) : "n/a" }),
          ]),
          el("div", {}, [
            el("dt", { text: "Above white" }),
            el("dd", { class: "figure", text: report.stops === null ? "n/a" : formatStops(report.stops) }),
          ]),
          el("div", {}, [
            el("dt", { text: "Shades" }),
            el("dd", { class: "figure", text: `${state.shadesUsed}/${SHADE_ALLOWANCE}` }),
          ]),
        ]),
      ]),
      el("p", { class: "result-note", text: `${note} ${report.summary}` }),
      state.shadesUsed
        ? el("p", {
          class: "result-fineprint",
          text: `You used ${state.shadesUsed} of ${SHADE_ALLOWANCE} shades. A shaded rung is one your display did not deliver on its own, and the depth above still counts it, so this is not a clean reading of your headroom.`,
        })
        : null,
      el("div", { class: "revealed-message" }, [
        el("h2", { class: "result-subhead", text: "The whole message" }),
        el("div", { class: "revealed-words" }, revealed),
        el("p", { class: "result-fineprint", text: "The dimmed words were on your screen the whole time. Your display could not deliver enough contrast at that pedestal to show them." }),
      ]),
      el("div", { class: "result-actions" }, [
        el("button", {
          class: "arcade-button arcade-button--primary",
          type: "button",
          onclick: async () => {
            const outcome = await shareOrCopy(lamplighterShareText(api.dayNumber, report, {
              browserLabel: api.browserLabel,
              shadesUsed: state.shadesUsed,
              entry: state.entry,
            }));
            if (outcome === "copied") api.toast("Copied", "Your reading depth is on the clipboard.");
            if (outcome === "failed") api.toast("Could not copy", "Your browser refused clipboard access.");
          },
        }, "Share depth"),
        el("button", { class: "arcade-button", type: "button", onclick: () => openComposer() }, "Write your own"),
      ]),
    );
    resultPanel.hidden = false;
    if (state.custom === null) api.recordStreak(lamplighterMeta.id, report.rungsRead >= RUNG_COUNT);
  }

  function openComposer() {
    const input = el("input", {
      class: "rung-input rung-input--wide",
      type: "text",
      maxlength: "120",
      value: "",
      placeholder: "ten words, one per rung",
      "aria-label": "Your message",
    });

    resultPanel.replaceChildren(
      el("h2", { class: "result-subhead", text: "Write your own ladder" }),
      el("p", { class: "result-note", text: "Your words split across the same ten pedestals. Whoever reads it gets as far as their screen allows, and no further." }),
      el("form", {
        class: "rung-form",
        onsubmit: (event) => {
          event.preventDefault();
          const words = input.value.trim();
          if (!words) return;
          start({ custom: words });
        },
      }, [input, el("button", { class: "arcade-button arcade-button--primary", type: "submit" }, "Light it")]),
      el("p", { class: "result-fineprint" }, [
        "Composed on this device only, and not a private channel: anyone with a brighter screen reads more of it than you do. To export one as an image, use ",
        el("a", { href: "./overwhite.html", class: "inline-link" }, "Overwhite"),
        ".",
      ]),
    );
    input.focus();
  }

  function start({ custom = null } = {}) {
    state.custom = custom;
    state.index = 0;
    state.read = 0;
    state.finished = false;
    state.shadesUsed = 0;
    state.shadeOnRung = 0;
    form.hidden = false;
    plateStage.hidden = false;
    resultPanel.hidden = true;
    feedback.textContent = "";

    const words = custom
      ? splitIntoRungs(custom, RUNG_COUNT)
      : messageForSeed(`lamplighter:${api.dayKey}`);
    state.ladder = buildLadder(words, RUNG_COUNT);
    updateShadeButton();
    showRung();
  }

  return () => {
    keyhole.destroy();
    releaseLightField(plate);
  };
}
