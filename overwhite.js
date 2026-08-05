/**
 * Overwhite: write a message in light above ordinary white.
 *
 * A plate at 999 nits with the message on it at 1,189 nits. On a display with
 * headroom you read it; on one without, it is a blank white rectangle.
 * The exposure slider is a viewing aid for the second case. It dims the preview
 * until the message clears the clip point, and never touches the exported file.
 */

import { base64ToBytes } from "./hdr-core.js";
import {
  createLightField,
  deflateBytes,
  fieldToHdrPng,
  paintMask,
  paintRect,
  rasterizeText,
  showLightField,
} from "./arcade/hdr-image.js";
import { BASE_WHITE_NITS, formatNits } from "./arcade/photometry.js";
import {
  DISCLOSURE,
  INK_NITS,
  MAX_LINES,
  MAX_MESSAGE_CHARS,
  PLATE_NITS,
  chooseWrapWidth,
  exposedNits,
  normalizeMessage,
  plateAspect,
  plateFileName,
  wrapLines,
} from "./arcade/overwhite-code.js";
import { el, fitToAreaBudget, viewportPixels } from "./arcade/ui.js";

const EMBEDDED_ASSETS = globalThis.__SHINYPIC_ASSETS__ || {};
const PROFILE_URL = "./assets/rec2100-pq.icc";
const STORAGE_KEY = "shinypic.arcade.v1";

const elements = {
  message: document.querySelector("#messageInput"),
  counter: document.querySelector("#messageCounter"),
  plate: document.querySelector("#plateImage"),
  stage: document.querySelector("#plateStage"),
  exposure: document.querySelector("#exposureRange"),
  exposureValue: document.querySelector("#exposureValue"),
  readout: document.querySelector("#plateReadout"),
  download: document.querySelector("#downloadPlate"),
  downloadMeta: document.querySelector("#downloadMeta"),
  flatten: document.querySelector("#flattenToggle"),
  gate: document.querySelector("#consentGate"),
  gateAccept: document.querySelector("#consentAccept"),
  disclosure: document.querySelector("#disclosureBody"),
  status: document.querySelector("#plateStatus"),
};

const state = {
  profile: null,
  acknowledged: false,
  flattened: false,
  renderToken: 0,
  exporting: false,
};

initialize();

async function initialize() {
  restore();
  renderDisclosure();
  bindControls();
  applyRangeLimit();

  try {
    state.profile = await loadProfile();
  } catch (error) {
    console.error(error);
    elements.status.textContent = "The Rec.2100 PQ profile failed to load, so no plate can be built.";
    return;
  }
  scheduleRender();
}

async function loadProfile() {
  const bytes = EMBEDDED_ASSETS.profileBase64
    ? base64ToBytes(EMBEDDED_ASSETS.profileBase64)
    : new Uint8Array(await (await fetch(PROFILE_URL, { cache: "force-cache" })).arrayBuffer());
  return deflateBytes(bytes);
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    state.acknowledged = Boolean(saved.acknowledged);
    state.flattened = Boolean(saved.flattened);
  } catch {
    // Opaque origins (file:// among them) simply start unacknowledged.
  }
}

function save() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...saved,
      acknowledged: state.acknowledged,
      flattened: state.flattened,
    }));
  } catch {
    // Not worth breaking a session over.
  }
}

function renderDisclosure() {
  elements.disclosure.replaceChildren(
    ...DISCLOSURE.body.map((paragraph) => el("p", { text: paragraph })),
  );
  elements.gate.hidden = state.acknowledged;
}

/**
 * Nothing rises above diffuse white until the disclosure has been read. The
 * plate is the entire point of the page, so it is clamped rather than withheld:
 * you can compose, you just cannot make light yet.
 */
function applyRangeLimit() {
  const clamped = state.flattened || !state.acknowledged;
  document.documentElement.style.setProperty("--range-limit", clamped ? "standard" : "no-limit");
  elements.stage.classList.toggle("is-clamped", clamped);
}

function bindControls() {
  elements.message.maxLength = MAX_MESSAGE_CHARS;
  elements.message.addEventListener("input", () => {
    updateCounter();
    scheduleRender();
  });
  elements.exposure.addEventListener("input", () => {
    updateExposureLabel();
    scheduleRender();
  });

  elements.flatten.addEventListener("click", () => {
    state.flattened = !state.flattened;
    elements.flatten.setAttribute("aria-pressed", String(state.flattened));
    applyRangeLimit();
    save();
  });
  elements.flatten.setAttribute("aria-pressed", String(state.flattened));

  elements.download.addEventListener("click", downloadPlate);

  elements.gateAccept.addEventListener("click", () => {
    state.acknowledged = true;
    save();
    elements.gate.hidden = true;
    applyRangeLimit();
  });

  updateCounter();
  updateExposureLabel();
}

function updateCounter() {
  const used = normalizeMessage(elements.message.value).length;
  elements.counter.textContent = `${used}/${MAX_MESSAGE_CHARS}`;
  elements.counter.classList.toggle("is-full", used >= MAX_MESSAGE_CHARS);
}

function exposureStops() {
  return Number(elements.exposure.value) / 10;
}

function updateExposureLabel() {
  const stops = exposureStops();
  elements.exposureValue.textContent = stops === 0
    ? "true plate"
    : `−${stops.toFixed(1)} stops`;
}

let renderTimer = null;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 120);
}

/** Draw the message onto a light field at a given plate luminance. */
function paintPlate(lines, plateNits, inkNits, width, height) {
  const field = createLightField(width, height, 3);
  paintRect(field, { x: 0, y: 0, width, height, nits: plateNits });
  if (!lines.length) return field;

  const mask = rasterizeText(width, height, (context) => {
    const lineHeight = height / (lines.length + 0.9);
    const size = Math.round(lineHeight * 0.74);
    context.font = `700 ${size}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.letterSpacing = `${Math.max(1, Math.round(size * 0.08))}px`;
    const top = (height - lineHeight * (lines.length - 1)) / 2;
    lines.forEach((line, index) => {
      context.fillText(line, width / 2, top + lineHeight * index);
    });
  });
  paintMask(field, mask, { nits: inkNits, floorNits: plateNits });
  return field;
}

function layout(message) {
  const lines = message ? wrapLines(message, chooseWrapWidth(message), MAX_LINES) : [];
  // Shape follows the longest line that actually got set, not the wrap budget,
  // so a message that wraps short does not get a plate full of empty space.
  const longest = lines.length ? Math.max(...lines.map((line) => line.length)) : 12;
  return { lines, aspect: plateAspect(longest, lines.length || 1) };
}

async function render() {
  const token = ++state.renderToken;
  const message = normalizeMessage(elements.message.value);
  const { lines, aspect } = layout(message);
  const stops = exposureStops();
  const plateNits = exposedNits(PLATE_NITS, stops);
  const inkNits = exposedNits(INK_NITS, stops);

  // The plate never flashes and never animates, so the flash-area rule does not
  // bind it. Held to a twentieth of the viewport regardless, well inside
  // BT.1702-2's quarter-of-frame area clause.
  const { width, height } = fitToAreaBudget(viewportPixels() * 0.05, aspect, {
    minWidth: 260,
    maxWidth: 760,
  });
  elements.stage.style.setProperty("--plate-width", `${width}px`);
  elements.stage.style.setProperty("--plate-aspect", String(aspect));

  if (!state.profile) return;
  await showLightField(elements.plate, paintPlate(lines, plateNits, inkNits, width, height), state.profile);
  if (token !== state.renderToken) return;

  elements.readout.replaceChildren(
    meter("Plate", formatNits(plateNits)),
    meter("Message", formatNits(inkNits)),
    meter("Contrast", "+18.9%"),
    meter("Lines", `${lines.length}/${MAX_LINES}`),
  );
  elements.status.textContent = stops > 0
    ? `Preview underexposed by ${stops.toFixed(1)} stops so it can be read without headroom. The exported file is always the true plate.`
    : plateNits > BASE_WHITE_NITS
      ? "True plate. On a screen without headroom this is a blank white rectangle."
      : "";
}

function meter(label, value) {
  return el("div", {}, [el("span", { text: label }), el("strong", { class: "figure", text: value })]);
}

const EXPORT_WIDTH = 1280;

/**
 * Built on click rather than on every keystroke. The export is four times the
 * preview's linear size, so preparing it eagerly meant encoding a megapixel PNG
 * for every character typed.
 *
 * It is always the true plate. The exposure slider is a viewing aid and must not
 * leak into the file, or the artefact would be a different thing on every
 * machine that made it.
 */
async function downloadPlate() {
  if (!state.profile || state.exporting) return;
  state.exporting = true;
  const previous = elements.downloadMeta.textContent;
  elements.downloadMeta.textContent = "building";

  try {
    const { lines, aspect } = layout(normalizeMessage(elements.message.value));
    const height = Math.max(160, Math.round(EXPORT_WIDTH / aspect));
    const blob = await fieldToHdrPng(
      paintPlate(lines, PLATE_NITS, INK_NITS, EXPORT_WIDTH, height),
      state.profile,
    );

    const url = URL.createObjectURL(blob);
    const link = el("a", { href: url, download: plateFileName() });
    link.click();
    // Revoking straight away can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);

    elements.downloadMeta.textContent =
      `${(blob.size / 1024).toFixed(0)} KB · ${EXPORT_WIDTH}×${height} · Rec.2100 PQ`;
  } catch (error) {
    console.error(error);
    elements.downloadMeta.textContent = previous;
    elements.status.textContent = "The plate could not be encoded.";
  } finally {
    state.exporting = false;
  }
}
