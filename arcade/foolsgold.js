/**
 * Fool's Gold: find the real lights among the forgeries, three boards deep.
 *
 * A run is three boards whose emitters step down the rung ladder. Clear one and
 * you go dimmer. Miss one and the run ends. The only thing that escalates is how
 * little light you are asked to find.
 *
 * The board is one Rec.2100 PQ PNG. Markers and labels are DOM elements layered
 * over it, never painted into it, so the image stays a pure photometric artefact
 * and what you judge is light rather than interface.
 */

import {
  DIFFICULTY_TIERS,
  FIELD_NITS,
  FORGERIES,
  createBoard,
  foolsGoldShareText,
  scoreBoard,
} from "./foolsgold-board.js";
import { createLightField, paintGlow, releaseLightField, showLightField } from "./hdr-image.js";
import { BASE_WHITE_NITS, EMITTER_RUNGS, formatNits, tintWeights } from "./photometry.js";
import { bindHold, el, fitToAreaBudget, shareOrCopy, stepWedge, viewportPixels } from "./ui.js";
import { brightAreaBudget } from "./limiter.js";
import { createKeyhole } from "./keyhole.js";

const BOARD_ASPECT = 3 / 2;

export const foolsGoldMeta = {
  id: "foolsgold",
  title: "Fool's Gold",
  tagline: "Four of these twelve are really emitting light. Eight are very good liars, and each one lies in a different way.",
  verb: "Detect",
};

/** Render a board into a light field at a given pixel size. */
function paintBoard(board, width, height, intensityScale) {
  const field = createLightField(width, height, FIELD_NITS);
  const scale = Math.min(width, height) / 640;

  // Wells are dug before anything is lit, because paintGlow only ever brightens.
  for (const object of board.objects) {
    if (!object.voidRadius) continue;
    carveWell(field, object.x * width, object.y * height, object.voidRadius * scale);
  }

  for (const object of board.objects) {
    const peak = object.real
      ? BASE_WHITE_NITS + (object.peakNits - BASE_WHITE_NITS) * intensityScale
      : object.peakNits;
    paintGlow(field, {
      x: object.x * width,
      y: object.y * height,
      coreRadius: object.coreRadius * scale,
      haloRadius: object.haloRadius * scale,
      peakNits: peak,
      floorNits: FIELD_NITS,
      tint: tintWeights(object.tint),
      falloff: object.falloff,
      coreWhitening: object.coreWhitening,
    });
  }
  return field;
}

function carveWell(field, centerX, centerY, radius) {
  const { width, height, nits } = field;
  const left = Math.max(0, Math.floor(centerX - radius));
  const right = Math.min(width - 1, Math.ceil(centerX + radius));
  const top = Math.max(0, Math.floor(centerY - radius));
  const bottom = Math.min(height - 1, Math.ceil(centerY + radius));

  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      const distance = Math.hypot(column - centerX, row - centerY);
      if (distance > radius) continue;
      const depth = 1 - (distance / radius) ** 2;
      const offset = (row * width + column) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        nits[offset + channel] *= 1 - depth;
      }
    }
  }
}

export function mountFoolsGold(host, api) {
  const state = {
    board: null,
    boardIndex: 0,
    busy: false,
    selected: new Set(),
    revealed: false,
    practice: false,
    run: { entry: "blind", results: [], cleared: 0, squints: 0 },
  };
  const cleanups = [];

  const boardImage = el("img", {
    class: "board-image",
    alt: "Twelve small bright objects on a dark field. Four are encoded above diffuse white.",
    draggable: "false",
  });
  const markerLayer = el("div", { class: "marker-layer" });
  const stage = el("div", { class: "board-stage" }, [boardImage, markerLayer]);

  const tierBadge = el("div", { class: "tier-badge" });
  const counter = el("p", { class: "board-counter", "aria-live": "polite" });
  const commitButton = el("button", {
    class: "arcade-button arcade-button--primary",
    type: "button",
    disabled: true,
    onclick: reveal,
  }, "Commit");

  const squintButton = el("button", {
    class: "arcade-button arcade-button--ghost squint-button",
    type: "button",
  }, [el("span", { class: "squint-dot", "aria-hidden": "true" }), "Squint"]);

  const resultPanel = el("div", { class: "result-panel", hidden: true });
  const rungLegend = el("div", { class: "rung-legend" }, EMITTER_RUNGS.map(({ rung, nits }) =>
    el("div", { class: "rung-legend-item" }, [
      el("span", { class: "figure rung-number", text: `R${rung}` }),
      el("span", { class: "figure", text: formatNits(nits) }),
    ])));

  const play = el("div", { class: "game-play", hidden: true }, [
    tierBadge,
    stage,
    el("div", { class: "board-bar" }, [counter, el("div", { class: "board-bar-actions" }, [squintButton, commitButton])]),
    resultPanel,
  ]);

  const keyhole = createKeyhole({
    seed: `keyhole:foolsgold:${api.dayKey}`,
    profile: api.profile,
    intensityScale: api.intensityScale,
    onOpen: (mode) => {
      keyhole.element.hidden = true;
      play.hidden = false;
      startRun(mode);
    },
  });

  host.append(
    el("div", { class: "game-head" }, [
      el("div", {}, [
        el("p", { class: "game-eyebrow" }, [stepWedge(4), foolsGoldMeta.verb]),
        el("h1", { class: "game-title", text: foolsGoldMeta.title }),
        el("p", { class: "game-blurb", text: foolsGoldMeta.tagline }),
      ]),
      el("div", { class: "game-head-side" }, [rungLegend]),
    ]),
    keyhole.element,
    play,
    el("details", { class: "method-note" }, [
      el("summary", { text: "What exactly is on screen" }),
      el("div", { class: "method-body" }, [
        el("p", { text: `One lossless PNG carrying a Rec.2100 PQ profile. The field sits at ${FIELD_NITS} nits. Every counterfeit peaks at exactly ${BASE_WHITE_NITS} nits, which is BT.2408 diffuse white. The real emitters run 345 to 650 nits, 0.8 to 1.7 stops above it.` }),
        el("p", { text: "Nothing is hidden. With headroom the emitters sit above the page. Without it the browser compresses them into the top of the ordinary range, so they stay findable as a narrow band of near-whites. That is a harder and different game, and the hub says which one you are playing." }),
      ]),
    ]),
  );

  keyhole.render();

  function markerFor(object) {
    const marker = el("button", {
      class: "marker",
      type: "button",
      role: "checkbox",
      "aria-checked": "false",
      "aria-label": `Object ${object.id.slice(1)} of 12`,
      style: `--x:${(object.x * 100).toFixed(3)}%; --y:${(object.y * 100).toFixed(3)}%`,
      dataset: { id: object.id },
      onclick: () => toggle(object.id, marker),
    });
    return marker;
  }

  /**
   * Closes the window between a board being generated and its image reaching the
   * screen. Without it you can mark and commit against the previous board.
   */
  function setBusy(busy) {
    state.busy = busy;
    for (const marker of markerLayer.querySelectorAll(".marker")) marker.disabled = busy;
    commitButton.disabled = busy || state.selected.size !== (state.board?.realCount ?? 4);
    squintButton.disabled = busy;
  }

  function toggle(id, marker) {
    if (state.revealed || state.busy) return;
    if (state.selected.has(id)) state.selected.delete(id);
    else if (state.selected.size >= state.board.realCount) {
      api.toast("Four marks only", `Unmark one first. Exactly ${state.board.realCount} of the twelve are real.`);
      return;
    } else state.selected.add(id);

    marker.classList.toggle("is-marked", state.selected.has(id));
    marker.setAttribute("aria-checked", String(state.selected.has(id)));
    updateCounter();
  }

  function updateCounter() {
    const marked = state.selected.size;
    counter.textContent = `${marked} of ${state.board.realCount} marked`;
    commitButton.disabled = state.busy || marked !== state.board.realCount;
  }

  function reveal() {
    if (state.revealed || state.busy) return;
    state.revealed = true;
    const result = scoreBoard(state.board, state.selected);
    state.run.results.push(result);
    if (result.perfect) state.run.cleared += 1;

    for (const object of state.board.objects) {
      const marker = markerLayer.querySelector(`[data-id="${object.id}"]`);
      const chosen = state.selected.has(object.id);
      marker.classList.add("is-revealed");
      marker.classList.toggle("is-real", object.real);
      marker.classList.toggle("is-hit", object.real && chosen);
      marker.classList.toggle("is-wrong", !object.real && chosen);
      marker.disabled = true;
      marker.setAttribute(
        "aria-label",
        object.real
          ? `Real emitter, rung ${object.rung}, ${formatNits(object.peakNits)}`
          : `Counterfeit: ${FORGERIES[object.technique].name}`,
      );
    }

    commitButton.hidden = true;
    const survives = result.perfect && state.boardIndex + 1 < DIFFICULTY_TIERS.length;
    renderBoardResult(result, survives);

    if (!survives && !state.practice) {
      api.recordStreak(foolsGoldMeta.id, state.run.cleared === DIFFICULTY_TIERS.length);
    }
  }

  function forgeryCards(result) {
    const fooledBy = result.falsePositives.map((object) => FORGERIES[object.technique]);
    const unique = [...new Map(fooledBy.map((forgery) => [forgery.id, forgery])).values()];
    if (!unique.length) {
      return el("p", { class: "result-clean", text: "No counterfeit fooled you. Every mark you made was on light that was really there." });
    }
    return el("div", { class: "forgery-list" }, [
      el("h2", { class: "result-subhead", text: "You were fooled by" }),
      ...unique.map((forgery) => el("div", { class: "forgery-card" }, [
        el("strong", { text: forgery.name }),
        el("p", { text: forgery.basis }),
        el("p", { class: "forgery-tell", text: forgery.tell }),
      ])),
    ]);
  }

  function renderBoardResult(result, survives) {
    resultPanel.replaceChildren(
      el("div", { class: "result-head" }, [
        el("p", { class: "result-score" }, [
          el("strong", { class: "figure", text: `${result.hits}/${result.total}` }),
          el("span", {
            text: result.perfect
              ? survives ? "Board clear. It gets dimmer." : "Board clear, and that was the last one."
              : "Real emitters identified. The run ends here.",
          }),
        ]),
        el("dl", { class: "result-stats" }, [
          el("div", {}, [el("dt", { text: "Board" }), el("dd", { class: "figure", text: `${state.boardIndex + 1}/${DIFFICULTY_TIERS.length}` })]),
          el("div", {}, [
            el("dt", { text: "Dimmest found" }),
            el("dd", { class: "figure", text: result.lowestRungCleared ? `R${result.lowestRungCleared}` : "n/a" }),
          ]),
        ]),
      ]),
      forgeryCards(result),
      survives
        ? el("div", { class: "result-actions" }, [
          el("button", {
            class: "arcade-button arcade-button--primary",
            type: "button",
            onclick: () => startBoard(state.boardIndex + 1),
          }, `Go dimmer: ${DIFFICULTY_TIERS[state.boardIndex + 1].name}`),
        ])
        : runSummary(),
    );
    resultPanel.hidden = false;
    resultPanel.scrollIntoView({ block: "nearest" });
  }

  function runSummary() {
    const total = DIFFICULTY_TIERS.length;
    const cleared = state.run.cleared;
    const verdict = cleared === total
      ? "You cleared the whole ladder, down to the luminosity threshold."
      : cleared === 0
        ? "The first board was the last board."
        : `You went ${cleared} deep before the light got too small.`;

    return el("div", { class: "run-summary" }, [
      el("h2", { class: "result-subhead", text: "Run over" }),
      el("div", { class: "run-pips", "aria-hidden": "true" },
        DIFFICULTY_TIERS.map((tier, index) => el("i", {
          class: state.run.results[index]?.perfect ? "is-clear" : state.run.results[index] ? "is-failed" : "",
        }))),
      el("p", { class: "result-note", text: `${verdict} ${state.run.entry === "sighted" ? "You read the entry plate, so your display has real headroom." : "The plate was blank for you, so this run was played on compressed greys."}` }),
      el("div", { class: "result-actions" }, [
        el("button", {
          class: "arcade-button arcade-button--primary",
          type: "button",
          onclick: async () => {
            const outcome = await shareOrCopy(foolsGoldShareText(api.dayNumber, state.run, { browserLabel: api.browserLabel }));
            if (outcome === "copied") api.toast("Copied", "Your run is on the clipboard.");
            if (outcome === "failed") api.toast("Could not copy", "Your browser refused clipboard access.");
          },
        }, "Share run"),
        el("button", { class: "arcade-button", type: "button", onclick: () => startRun(state.run.entry, { practice: true }) }, "Run it again"),
      ]),
    ]);
  }

  function startRun(entry, { practice = false } = {}) {
    state.practice = practice;
    state.run = { entry, results: [], cleared: 0, squints: 0 };
    startBoard(0);
  }

  async function startBoard(index) {
    state.boardIndex = index;
    state.revealed = false;
    state.selected.clear();
    resultPanel.hidden = true;
    commitButton.hidden = false;

    const tier = DIFFICULTY_TIERS[index];
    const seed = state.practice
      ? `foolsgold:practice:${api.dayKey}:${index}:${Math.floor(performance.now())}`
      : `foolsgold:${api.dayKey}:${index}`;
    state.board = createBoard(seed, { tier: tier.tier });

    tierBadge.replaceChildren(
      el("span", { class: "tier-step", text: `Board ${index + 1} of ${DIFFICULTY_TIERS.length}` }),
      el("strong", { class: "tier-name", text: tier.name }),
      el("span", { class: "tier-blurb", text: tier.blurb }),
    );

    const budget = brightAreaBudget(viewportPixels());
    // The whole board plus its commit bar has to be readable at once, so the
    // board is capped by available height before anything else.
    const heightCap = Math.round((window.innerHeight - 420) * BOARD_ASPECT);
    const maxWidth = Math.max(320, Math.min(960, heightCap));
    // Only the emitters exceed diffuse white, so the board may be far larger
    // than the area budget while the lit area stays well inside it.
    const { width, height } = fitToAreaBudget(budget * 26, BOARD_ASPECT, { minWidth: 320, maxWidth });
    stage.style.setProperty("--board-width", `${width}px`);
    stage.style.setProperty("--board-aspect", String(BOARD_ASPECT));

    markerLayer.replaceChildren(...state.board.objects.map(markerFor));
    updateCounter();
    setBusy(true);

    await showLightField(boardImage, paintBoard(state.board, width, height, api.intensityScale), api.profile);
    setBusy(false);
  }

  cleanups.push(bindHold(squintButton, {
    key: "s",
    onPress: () => {
      if (api.setSquint(true)) {
        state.run.squints += 1;
        squintButton.classList.add("is-active");
      }
    },
    onRelease: () => {
      api.setSquint(false);
      squintButton.classList.remove("is-active");
    },
  }));

  return () => {
    cleanups.forEach((cleanup) => cleanup());
    keyhole.destroy();
    releaseLightField(boardImage);
  };
}
