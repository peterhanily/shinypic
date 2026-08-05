/**
 * ShinyPic Arcade: three games in which the display is the game piece.
 *
 * The shell owns everything the games share: the ICC profile, the capability
 * probe, the luminance governor, the safety gate, and hash routing. Games are
 * mounted into a host element and hand back a teardown function.
 */

import { base64ToBytes } from "./hdr-core.js";
import { deflateBytes, createLightField, paintGlow, showLightField } from "./arcade/hdr-image.js";
import { BASE_WHITE_NITS, EMITTER_RUNGS, tintWeights } from "./arcade/photometry.js";
import { createLuminanceGovernor } from "./arcade/limiter.js";
import { dayKey, dayNumber } from "./arcade/rng.js";
import { el } from "./arcade/ui.js";
import { foolsGoldMeta, mountFoolsGold } from "./arcade/foolsgold.js";
import { lamplighterMeta, mountLamplighter } from "./arcade/lamplighter.js";
import { ceilingMeta, mountCeiling } from "./arcade/ceiling.js";

const EMBEDDED_ASSETS = globalThis.__SHINYPIC_ASSETS__ || {};
const PROFILE_URL = "./assets/rec2100-pq.icc";
const STORAGE_KEY = "shinypic.arcade.v1";

const GAMES = [
  { meta: foolsGoldMeta, mount: mountFoolsGold, specimen: "emitters" },
  { meta: lamplighterMeta, mount: mountLamplighter, specimen: "ladder" },
  { meta: ceilingMeta, mount: mountCeiling, specimen: "pair" },
];

const elements = {
  hub: document.querySelector("#hubView"),
  hubGrid: document.querySelector("#hubGrid"),
  game: document.querySelector("#gameView"),
  gameHost: document.querySelector("#gameHost"),
  backLink: document.querySelector("#backToHub"),
  capability: document.querySelector("#capabilityPill"),
  capabilityLabel: document.querySelector("#capabilityLabel"),
  capabilityDetail: document.querySelector("#capabilityDetail"),
  flatten: document.querySelector("#flattenToggle"),
  intensity: document.querySelector("#intensityToggle"),
  safetyDialog: document.querySelector("#safetyDialog"),
  safetyAccept: document.querySelector("#safetyAccept"),
  toast: document.querySelector("#arcadeToast"),
  toastTitle: document.querySelector("#arcadeToastTitle"),
  toastMessage: document.querySelector("#arcadeToastMessage"),
  toastClose: document.querySelector("#arcadeToastClose"),
};

const state = {
  profile: null,
  canShowHdr: false,
  flattened: false,
  intensity: "full",
  acknowledged: false,
  streaks: {},
  teardown: null,
  pendingGameId: null,
  squintTimer: null,
  toastTimer: null,
};

const governor = createLuminanceGovernor({ now: performance.now() });

initialize();

async function initialize() {
  restore();
  probeCapability();
  bindChrome();
  renderHub();

  try {
    state.profile = await loadProfile();
  } catch (error) {
    console.error(error);
    showToast("The arcade could not start", "The Rec.2100 PQ profile failed to load, so no board can be built.");
    return;
  }

  renderSpecimens();
  window.addEventListener("hashchange", route);
  window.matchMedia("(dynamic-range: high)").addEventListener?.("change", () => {
    probeCapability();
    route();
  });
  route();
}

async function loadProfile() {
  const bytes = EMBEDDED_ASSETS.profileBase64
    ? base64ToBytes(EMBEDDED_ASSETS.profileBase64)
    : new Uint8Array(await (await fetch(PROFILE_URL, { cache: "force-cache" })).arrayBuffer());
  return deflateBytes(bytes);
}

/* ---------------------------------------------------------------- capability */

function probeCapability() {
  const hdrScreen = window.matchMedia?.("(dynamic-range: high)")?.matches ?? false;
  const limitSupported = window.CSS?.supports?.("dynamic-range-limit", "no-limit") ?? false;
  state.canShowHdr = hdrScreen && limitSupported;

  elements.capability.classList.toggle("is-sdr", !state.canShowHdr);
  elements.capabilityLabel.textContent = state.canShowHdr ? "Headroom available" : "No headroom reported";
  elements.capabilityDetail.textContent = state.canShowHdr
    ? "This browser reports HDR headroom and supports dynamic-range-limit, so the boards below are real light rather than a picture of light."
    : limitSupported
      ? "This screen reports no headroom above diffuse white. The browser compresses the extra light into the top of the ordinary range rather than discarding it, so the games stay playable but get much subtler. You are judging a picture of light rather than light."
      : "This browser does not support dynamic-range-limit, so nothing here can rise above diffuse white. Differences may still survive as compressed greys. Safari 26+ or Chrome 136+ on an HDR display is the combination that shows the real thing.";
}

function browserLabel() {
  const agent = navigator.userAgent;
  const isSafari = /^((?!chrome|chromium|android).)*safari/i.test(agent);
  const chrome = /Chrome\/(\d+)/.exec(agent);
  const version = /Version\/(\d+)/.exec(agent);
  const name = isSafari ? `Safari ${version?.[1] ?? ""}`.trim() : chrome ? `Chrome ${chrome[1]}` : "Browser";
  return `${name} · ${state.canShowHdr ? "HDR" : "SDR"}`;
}

/* --------------------------------------------------------------- persistence */

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    state.acknowledged = Boolean(saved.acknowledged);
    state.intensity = saved.intensity === "dim" ? "dim" : "full";
    state.flattened = Boolean(saved.flattened);
    state.streaks = saved.streaks && typeof saved.streaks === "object" ? saved.streaks : {};
  } catch {
    // A blocked or opaque storage origin (file:// among them) is not an error.
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      acknowledged: state.acknowledged,
      intensity: state.intensity,
      flattened: state.flattened,
      streaks: state.streaks,
    }));
  } catch {
    // Nothing here is worth breaking a session over.
  }
}

function recordStreak(gameId, success) {
  const today = dayKey();
  const entry = state.streaks[gameId] || { streak: 0, best: 0, lastDay: null };
  if (entry.lastDay === today) return;

  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  entry.streak = success ? (entry.lastDay === yesterday ? entry.streak + 1 : 1) : 0;
  entry.best = Math.max(entry.best, entry.streak);
  entry.lastDay = today;
  state.streaks[gameId] = entry;
  save();
}

/* -------------------------------------------------------------- page chrome  */

function bindChrome() {
  applyRangeLimit();
  elements.flatten.setAttribute("aria-pressed", String(state.flattened));
  elements.intensity.setAttribute("aria-pressed", String(state.intensity === "dim"));

  elements.flatten.addEventListener("click", () => {
    state.flattened = !state.flattened;
    elements.flatten.setAttribute("aria-pressed", String(state.flattened));
    applyRangeLimit();
    save();
    showToast(
      state.flattened ? "HDR flattened" : "HDR restored",
      state.flattened
        ? "Every surface is now clamped to ordinary white. The games still run; nothing will rise above it."
        : "Boards may use this display's headroom again.",
    );
  });

  elements.intensity.addEventListener("click", () => {
    state.intensity = state.intensity === "dim" ? "full" : "dim";
    elements.intensity.setAttribute("aria-pressed", String(state.intensity === "dim"));
    save();
    showToast(
      state.intensity === "dim" ? "Reduced intensity" : "Full intensity",
      state.intensity === "dim"
        ? "Emitters now reach half as far above white. The games get harder, which is the honest trade."
        : "Emitters reach the full rung ladder, topping out at 650 nits.",
    );
    renderSpecimens();
    route();
  });

  elements.toastClose.addEventListener("click", hideToast);

  // The destination is held in `state.pendingGameId`, not in the URL. Dismissing
  // the gate navigates away, so reading the hash after the fact would lose it.
  elements.safetyAccept.addEventListener("click", () => {
    state.acknowledged = true;
    save();
    const destination = state.pendingGameId;
    state.pendingGameId = null;
    elements.safetyDialog.close();
    applyRangeLimit();
    if (destination && location.hash !== `#${destination}`) {
      location.hash = destination;
      return; // hashchange re-enters route()
    }
    route();
  });

  // Escape backs out to the hub rather than trapping anyone behind the gate.
  elements.safetyDialog.addEventListener("cancel", () => {
    state.pendingGameId = null;
    if (location.hash) location.hash = "";
    else route();
  });

  // prefers-reduced-motion is treated as "do not modulate luminance either",
  // because there is no prefers-reduced-hdr and this is the nearest honest signal.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches && state.intensity !== "dim") {
    state.intensity = "dim";
    elements.intensity.setAttribute("aria-pressed", "true");
  }
}

/**
 * Nothing on this page rises above diffuse white until the visitor has been
 * told it will. Before the notice is acknowledged the whole document is clamped,
 * including the hub's specimen strips. A page that greets you with unexpected
 * light has already made the choice for you.
 */
function applyRangeLimit(limit) {
  const value = state.flattened || !state.acknowledged
    ? "standard"
    : limit || governor.state;
  document.documentElement.style.setProperty("--range-limit", value);
  elements.hubGrid.classList.toggle("is-clamped", !state.acknowledged && !state.flattened);
}

/** Ask for the Squint. Returns true only when a transition actually happened. */
function setSquint(on) {
  if (state.flattened) return false;
  const outcome = governor.request(on ? "standard" : "no-limit", performance.now());
  applyRangeLimit(outcome.applied);

  clearTimeout(state.squintTimer);
  if (!outcome.changed && outcome.retryInMs > 0) {
    state.squintTimer = setTimeout(() => {
      applyRangeLimit(governor.settle(performance.now()).applied);
    }, outcome.retryInMs + 16);
  }
  return outcome.changed && outcome.applied === "standard";
}

function showToast(title, message) {
  clearTimeout(state.toastTimer);
  elements.toastTitle.textContent = title;
  elements.toastMessage.textContent = message;
  elements.toast.classList.add("is-visible");
  state.toastTimer = setTimeout(hideToast, 6000);
}

function hideToast() {
  clearTimeout(state.toastTimer);
  elements.toast.classList.remove("is-visible");
}

/* ------------------------------------------------------------------- routing */

function route() {
  const id = location.hash.replace(/^#\/?/, "");
  const game = GAMES.find((entry) => entry.meta.id === id);

  if (state.teardown) {
    state.teardown();
    state.teardown = null;
  }
  elements.gameHost.replaceChildren();

  if (!game) {
    elements.hub.hidden = false;
    elements.game.hidden = true;
    renderStreaks();
    document.title = "ShinyPic Arcade";
    return;
  }

  if (!state.acknowledged) {
    state.pendingGameId = game.meta.id;
    elements.hub.hidden = false;
    elements.game.hidden = true;
    if (!elements.safetyDialog.open) elements.safetyDialog.showModal();
    return;
  }

  elements.hub.hidden = true;
  elements.game.hidden = false;
  document.title = `${game.meta.title} · ShinyPic Arcade`;
  elements.backLink.focus({ preventScroll: true });
  window.scrollTo(0, 0);

  state.teardown = game.mount(elements.gameHost, {
    profile: state.profile,
    canShowHdr: state.canShowHdr,
    intensityScale: state.intensity === "dim" ? 0.5 : 1,
    browserLabel: browserLabel(),
    dayKey: dayKey(),
    dayNumber: dayNumber(),
    setSquint,
    recordStreak,
    toast: showToast,
  });
}

/* ----------------------------------------------------------------------- hub */

function renderHub() {
  elements.hubGrid.replaceChildren(...GAMES.map((game, index) => el("a", {
    class: "bench",
    href: `#${game.meta.id}`,
    dataset: { specimen: game.specimen },
  }, [
    el("div", { class: "bench-specimen" }, [
      el("img", { class: "specimen-image", alt: "", "aria-hidden": "true", draggable: "false" }),
    ]),
    el("div", { class: "bench-copy" }, [
      el("p", { class: "bench-index figure", text: `0${index + 1}` }),
      el("h2", { class: "bench-title", text: game.meta.title }),
      el("p", { class: "bench-blurb", text: game.meta.tagline }),
      el("p", { class: "bench-streak", dataset: { game: game.meta.id } }),
    ]),
    el("span", { class: "bench-go", "aria-hidden": "true" }, game.meta.verb),
  ])));
}

function renderStreaks() {
  for (const game of GAMES) {
    const node = elements.hubGrid.querySelector(`[data-game="${game.meta.id}"]`);
    if (!node) continue;
    const entry = state.streaks[game.meta.id];
    node.textContent = entry?.streak
      ? `${entry.streak} day streak · best ${entry.best}`
      : "";
  }
}

/**
 * Each bench carries a live specimen: a real HDR strip built with that game's
 * own numbers. The hub demonstrates the phenomenon before you click anything,
 * and on a display without headroom it demonstrates the absence just as plainly.
 */
async function renderSpecimens() {
  const scale = state.intensity === "dim" ? 0.5 : 1;
  const width = 320;
  const height = 96;

  for (const game of GAMES) {
    const image = elements.hubGrid.querySelector(`[data-specimen="${game.specimen}"] .specimen-image`);
    if (!image) continue;
    const field = createLightField(width, height, 3);

    if (game.specimen === "emitters") {
      // Two counterfeits and two emitters, in the game's own vocabulary.
      const objects = [
        { x: 0.18, nits: BASE_WHITE_NITS, tint: "#ff8a2b", whiten: 0 },
        { x: 0.39, nits: BASE_WHITE_NITS + (EMITTER_RUNGS[3].nits - BASE_WHITE_NITS) * scale, tint: "#ffffff", whiten: 0.85 },
        { x: 0.61, nits: BASE_WHITE_NITS, tint: "#ffffff", whiten: 0 },
        { x: 0.82, nits: BASE_WHITE_NITS + (EMITTER_RUNGS[1].nits - BASE_WHITE_NITS) * scale, tint: "#ffffff", whiten: 0.85 },
      ];
      for (const object of objects) {
        paintGlow(field, {
          x: object.x * width,
          y: height / 2,
          coreRadius: 7,
          haloRadius: 26,
          peakNits: object.nits,
          floorNits: 3,
          tint: tintWeights(object.tint),
          falloff: 2.4,
          coreWhitening: object.whiten,
        });
      }
    } else if (game.specimen === "ladder") {
      // The step wedge itself, as light: ten rising pedestals.
      const cells = 10;
      const cellWidth = width / cells;
      for (let index = 0; index < cells; index += 1) {
        const raw = 60 * (999 / 60) ** (index / (cells - 1));
        const nits = raw > BASE_WHITE_NITS
          ? BASE_WHITE_NITS + (raw - BASE_WHITE_NITS) * scale
          : raw;
        paintGlow(field, {
          x: (index + 0.5) * cellWidth,
          y: height / 2,
          coreRadius: cellWidth * 0.32,
          haloRadius: cellWidth * 0.46,
          peakNits: nits,
          floorNits: 3,
          falloff: 6,
        });
      }
    } else {
      const pairNits = BASE_WHITE_NITS + (520 - BASE_WHITE_NITS) * scale;
      paintGlow(field, { x: width * 0.34, y: height / 2, coreRadius: 34, haloRadius: 44, peakNits: pairNits * 0.72, floorNits: 3, falloff: 8 });
      paintGlow(field, { x: width * 0.66, y: height / 2, coreRadius: 34, haloRadius: 44, peakNits: pairNits, floorNits: 3, falloff: 8 });
    }

    await showLightField(image, field, state.profile);
  }
}
