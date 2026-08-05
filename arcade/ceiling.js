/**
 * Service Ceiling: measure where this display stops delivering.
 *
 * A 2-down-1-up staircase over PQ code values. Two patches differ by six codes.
 * While the display can deliver that difference you get it right; once it cannot
 * you are guessing. The reversal average brackets the boundary.
 *
 * The output is not a score, it is a number about your hardware, and the game
 * says so, including when it measured nothing.
 */

import {
  DEFAULT_DELTA_CODES,
  createStaircase,
  sliderAdvice,
} from "./ceiling-staircase.js";
import { createLightField, paintRect, releaseLightField, showLightField } from "./hdr-image.js";
import { codeToNits, formatNits, formatStops, stopsAboveBase } from "./photometry.js";
import { brightAreaBudget } from "./limiter.js";
import { createRandom } from "./rng.js";
import { createKeyhole } from "./keyhole.js";
import { el, fitToAreaBudget, shareOrCopy, stepWedge, viewportPixels } from "./ui.js";

const PAIR_ASPECT = 2.6;

/** Logarithmic, because luminance is perceived that way. */
const ALTIMETER_FLOOR_NITS = 30;
const ALTIMETER_CEILING_NITS = 8000;
const ALTIMETER_MARKS = Object.freeze([203, 500, 1000, 2000, 4000]);

function altitudeFraction(nits) {
  const span = Math.log(ALTIMETER_CEILING_NITS / ALTIMETER_FLOOR_NITS);
  return Math.min(1, Math.max(0, Math.log(nits / ALTIMETER_FLOOR_NITS) / span));
}

export const ceilingMeta = {
  id: "ceiling",
  title: "Service Ceiling",
  tagline: "Two patches, six code values apart. Climb until you cannot tell them apart. That is your ceiling.",
  verb: "Measure",
};

function paintPair(dimNits, brightNits, brightOnRight, width, height) {
  const field = createLightField(width, height, 3);
  const gap = Math.round(width * 0.06);
  const patch = Math.round((width - gap) / 2);

  paintRect(field, {
    x: 0,
    y: 0,
    width: patch,
    height,
    nits: brightOnRight ? dimNits : brightNits,
  });
  paintRect(field, {
    x: patch + gap,
    y: 0,
    width: patch,
    height,
    nits: brightOnRight ? brightNits : dimNits,
  });
  return field;
}

export function mountCeiling(host, api) {
  // `busy` closes the window between a trial being decided and its image being
  // on screen. Without it a fast clicker answers the previous trial's picture
  // against the current trial's answer key, which is silently unfair.
  const state = { staircase: null, brightOnRight: false, random: null, finished: false, busy: false, entry: "blind", highest: 0 };

  const pair = el("img", {
    class: "pair-image",
    alt: "Two grey patches side by side. One is slightly brighter than the other.",
    draggable: "false",
  });
  const pairStage = el("div", { class: "pair-stage" }, [pair]);
  const progress = el("div", { class: "staircase-progress" }, [el("i", { class: "staircase-fill" })]);
  const readout = el("div", { class: "rung-readout" });
  const resultPanel = el("div", { class: "result-panel", hidden: true });

  const choices = el("div", { class: "choice-row" }, [
    el("button", { class: "arcade-button choice-button", type: "button", onclick: () => answer(false) }, "◀ Left"),
    el("button", { class: "arcade-button choice-button", type: "button", onclick: () => answer(true) }, "Right ▶"),
  ]);
  const prompt = el("p", {
    class: "choice-prompt",
    text: "Which patch is brighter? Guess if you cannot tell. The procedure needs your guesses to find the boundary.",
  });

  const altitudeNeedle = el("i", { class: "altimeter-needle" });
  const altitudeCeiling = el("i", { class: "altimeter-ceiling", hidden: true });
  const altitudeValue = el("strong", { class: "figure altimeter-value" });
  const altimeter = el("div", { class: "altimeter" }, [
    el("div", { class: "altimeter-scale" }, [
      ...ALTIMETER_MARKS.map((nits) => el("i", {
        class: "altimeter-mark",
        style: `--at:${(altitudeFraction(nits) * 100).toFixed(2)}%`,
        dataset: { label: nits >= 1000 ? `${nits / 1000}k` : String(nits) },
      })),
      altitudeCeiling,
      altitudeNeedle,
    ]),
    el("div", { class: "altimeter-readout" }, [
      el("span", { text: "Altitude" }),
      altitudeValue,
    ]),
  ]);

  const play = el("div", { class: "game-play", hidden: true }, [
    readout,
    el("div", { class: "pair-row" }, [altimeter, pairStage]),
    prompt,
    choices,
    progress,
    resultPanel,
  ]);

  const keyhole = createKeyhole({
    seed: `keyhole:ceiling:${api.dayKey}`,
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
        el("p", { class: "game-eyebrow" }, [stepWedge(4), ceilingMeta.verb]),
        el("h1", { class: "game-title", text: ceilingMeta.title }),
        el("p", { class: "game-blurb", text: ceilingMeta.tagline }),
      ]),
    ]),
    keyhole.element,
    play,
    el("details", { class: "method-note" }, [
      el("summary", { text: "How this is measured" }),
      el("div", { class: "method-body" }, [
        el("p", { text: "Two correct answers step the pair up, one wrong answer steps it down. That is Levitt's transformed up-down procedure, which settles where a viewer is right about 70.7% of the time. The estimate averages the last six reversals, a standard reading rather than one invented here." }),
        el("p", { text: `The patches always differ by ${DEFAULT_DELTA_CODES} of the 256 PQ code values, a step of roughly 25% near diffuse white. The encoding stays constant while the display's ability to render it does not.` }),
        el("p", { text: "This measures your display, your brightness setting, your room and your eyes together, right now. Change any of them and the number changes. It is not a rating of the panel." }),
      ]),
    ]),
  );

  keyhole.render();

  function setBusy(busy) {
    state.busy = busy;
    for (const button of choices.querySelectorAll("button")) button.disabled = busy;
  }

  async function showTrial() {
    setBusy(true);
    const { dimCode, brightCode, index } = state.staircase.trial;
    state.brightOnRight = state.random() < 0.5;

    const budget = brightAreaBudget(viewportPixels());
    const { width, height } = fitToAreaBudget(budget, PAIR_ASPECT, { minWidth: 200, maxWidth: 560 });
    pairStage.style.setProperty("--pair-width", `${width}px`);
    pairStage.style.setProperty("--pair-aspect", String(PAIR_ASPECT));

    const dimNits = codeToNits(dimCode);
    const brightNits = codeToNits(brightCode);

    readout.replaceChildren(
      el("div", { class: "rung-position" }, [
        el("span", { class: "rung-label", text: "Trial" }),
        el("strong", { class: "figure", text: String(index) }),
        el("span", { class: "rung-of", text: `of up to 45` }),
      ]),
      el("div", { class: "rung-meters" }, [
        el("div", {}, [el("span", { text: "Dim patch" }), el("strong", { class: "figure", text: formatNits(dimNits) })]),
        el("div", {}, [el("span", { text: "Bright patch" }), el("strong", { class: "figure", text: formatNits(brightNits) })]),
        el("div", {}, [el("span", { text: "Reversals" }), el("strong", { class: "figure", text: `${state.staircase.reversals}/8` })]),
      ]),
    );

    progress.querySelector(".staircase-fill").style.setProperty(
      "--progress",
      `${Math.round(Math.min(1, state.staircase.progress) * 100)}%`,
    );

    altitudeNeedle.style.setProperty("--at", `${(altitudeFraction(brightNits) * 100).toFixed(2)}%`);
    altitudeValue.textContent = formatNits(brightNits);
    state.highest = Math.max(state.highest, brightNits);

    await showLightField(pair, paintPair(dimNits, brightNits, state.brightOnRight, width, height), api.profile);
    setBusy(false);
  }

  function answer(choseRight) {
    if (state.finished || state.busy) return;
    const correct = choseRight === state.brightOnRight;
    const { done } = state.staircase.respond(correct);
    if (done) finish();
    else showTrial();
  }

  function finish() {
    state.finished = true;
    choices.hidden = true;
    prompt.hidden = true;
    pairStage.hidden = true;
    progress.hidden = true;

    const result = state.staircase.result();
    const ceilingNits = codeToNits(result.thresholdCode);
    const advice = sliderAdvice(ceilingNits);

    if (result.converged) {
      altitudeCeiling.hidden = false;
      altitudeCeiling.style.setProperty("--at", `${(altitudeFraction(ceilingNits) * 100).toFixed(2)}%`);
      altitudeValue.textContent = formatNits(ceilingNits);
    }

    const headline = !result.converged
      ? result.looksLikeGuessing
        ? "That run is indistinguishable from guessing."
        : result.railedHigh
          ? "This test ran out of ladder before your display ran out of headroom."
          : "Not enough reversals to call this a measurement."
      : formatNits(ceilingNits);

    resultPanel.replaceChildren(
      el("div", { class: "result-head" }, [
        el("p", { class: "result-score" }, [
          el("strong", { class: result.converged ? "figure" : "figure figure--soft", text: headline }),
          el("span", { text: result.converged ? "service ceiling" : "no ceiling found" }),
        ]),
        el("dl", { class: "result-stats" }, [
          el("div", {}, [
            el("dt", { text: "Above white" }),
            el("dd", { class: "figure", text: result.converged ? formatStops(stopsAboveBase(ceilingNits)) : "n/a" }),
          ]),
          el("div", {}, [el("dt", { text: "Trials" }), el("dd", { class: "figure", text: String(result.trials) })]),
          el("div", {}, [el("dt", { text: "Reversals" }), el("dd", { class: "figure", text: String(result.reversals) })]),
        ]),
      ]),
      result.converged
        ? el("div", { class: "advice-card" }, [
          el("h2", { class: "result-subhead", text: "What this means in the editor" }),
          el("p", { text: advice.message }),
          el("a", { class: "arcade-button", href: "./" }, "Open the studio"),
        ])
        : el("p", {
          class: "result-note",
          text: result.looksLikeGuessing
            ? `On the easy trials, where both patches sit below diffuse white and no display needs headroom, you were right ${Math.round(result.easyAccuracy * 100)}% of the time across ${result.easyTrials} of them. That is close enough to chance that nothing can be read out of the run. Either the answers were not tracking the patches, or something in this chain is flattening them long before the interesting part.`
            : result.railedHigh
              ? "You answered correctly to the top of the test range. Either this display has more headroom than the arcade asks for, or something in the chain is exaggerating the difference. There is no honest number to report."
              : "The staircase needs at least two direction changes before an average means anything. Run it again and answer as consistently as you can, guessing when you are unsure.",
        }),
      el("div", { class: "result-actions" }, [
        result.converged
          ? el("button", {
            class: "arcade-button arcade-button--primary",
            type: "button",
            onclick: async () => {
              const outcome = await shareOrCopy([
                `SERVICE CEILING #${api.dayNumber}`,
                `${formatNits(ceilingNits)} · ${formatStops(stopsAboveBase(ceilingNits))} above diffuse white`,
                `${result.trials} trials · ${result.reversals} reversals`,
                `entry: ${state.entry === "sighted" ? "read the plate" : "plate was blank"}`,
                api.browserLabel,
              ].join("\n"));
              if (outcome === "copied") api.toast("Copied", "Your ceiling is on the clipboard.");
              if (outcome === "failed") api.toast("Could not copy", "Your browser refused clipboard access.");
            },
          }, "Share ceiling")
          : null,
        el("button", { class: "arcade-button", type: "button", onclick: () => start() }, "Run it again"),
      ]),
    );
    resultPanel.hidden = false;
  }

  function start() {
    state.finished = false;
    state.highest = 0;
    altitudeCeiling.hidden = true;
    state.random = createRandom(`ceiling:${api.dayKey}:${Math.floor(performance.now())}`);
    state.staircase = createStaircase();
    choices.hidden = false;
    prompt.hidden = false;
    pairStage.hidden = false;
    progress.hidden = false;
    resultPanel.hidden = true;
    showTrial();
  }

  start();

  return () => {
    keyhole.destroy();
    releaseLightField(pair);
  };
}
