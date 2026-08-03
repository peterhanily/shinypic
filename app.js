import {
  base64ToBytes,
  bytesToDataUrl,
  highlightMask,
  injectICCProfile,
  linearSrgbLuminance,
  linearSrgbToRec2020,
  pqEncodeNits,
  smoothstep,
  srgbToLinear,
} from "./hdr-core.js";
import { DEMOS, demoById, resolvedDemoUrl } from "./demo-catalog.js";
import {
  ImageGuardError,
  validateImageDimensions,
  validateRasterFile,
} from "./image-guard.js";

const EMBEDDED_ASSETS = globalThis.__SHINYPIC_ASSETS__ || {};
const DEFAULT_DEMO = DEMOS[0];
const PROFILE_URL = "./assets/rec2100-pq.icc";
const PREVIEW_MAX_EDGE = 920;
const DESKTOP_EXPORT_EDGE = 4096;
const MOBILE_EXPORT_EDGE = 2560;
const DESKTOP_PIXEL_LIMIT = 12_000_000;
const MOBILE_PIXEL_LIMIT = 6_500_000;

const DEFAULTS = Object.freeze({
  selection: "lights",
  shineAmount: 0.78,
  shineArea: 0.30,
  shineBloom: 0.42,
  shineColor: "#ffffff",
  shineColorName: "Pearl",
  brushMode: "add",
  brushSize: 64,
  spotX: 0.68,
  spotY: 0.54,
});

const RECIPES = Object.freeze({
  clean: { amount: 0.78, area: 0.30, bloom: 0.28, color: "#ffffff", colorName: "Pearl" },
  sparkle: { amount: 0.97, area: 0.08, bloom: 0.13, color: "#ffffff", colorName: "Pearl" },
  dream: { amount: 0.72, area: 0.52, bloom: 0.82, color: "#ffffff", colorName: "Pearl" },
  neon: { amount: 0.90, area: 0.24, bloom: 0.58, color: "#ff79d9", colorName: "Pink" },
});

const state = {
  ...DEFAULTS,
  profile: null,
  sourceName: DEFAULT_DEMO.fileName,
  sourceBytes: 0,
  isDemo: true,
  activeDemoId: DEFAULT_DEMO.id,
  activeRecipe: "clean",
};

let sourceImage = new Image();
sourceImage.decoding = "async";

let sourceObjectUrl = null;
let previewObjectUrl = null;
let exportHdrObjectUrl = null;
let exportSdrObjectUrl = null;
let renderTimer = null;
let renderSequence = 0;
let isRendering = false;
let canDisplayPhysicalHdr = false;
let editRevision = 0;
let exportPrepareTimer = null;
let exportPrepareSequence = 0;
let preparedExport = null;
let isPreparingExport = false;
let toastTimer = null;
let latestPreviewSdrBlob = null;
let currentExportBlob = null;
let paintHistory = [];
let sourceLoadSequence = 0;

const elements = {
  body: document.body,
  fileInput: document.querySelector("#photoInput"),
  cameraInput: document.querySelector("#cameraInput"),
  fileName: document.querySelector("#fileName"),
  fileDetails: document.querySelector("#fileDetails"),
  dropZone: document.querySelector("#dropZone"),
  dropOverlay: document.querySelector("#dropOverlay"),
  previewStage: document.querySelector("#previewStage"),
  originalImage: document.querySelector("#originalImage"),
  resultImage: document.querySelector("#resultImage"),
  resultLayer: document.querySelector("#resultLayer"),
  compareLine: document.querySelector("#compareLine"),
  compareRange: document.querySelector("#compareRange"),
  showBeforeButton: document.querySelector("#showBeforeButton"),
  showAfterButton: document.querySelector("#showAfterButton"),
  hdrStatusButton: document.querySelector("#hdrStatusButton"),
  hdrStatusLabel: document.querySelector("#hdrStatusLabel"),
  previewHint: document.querySelector("#previewHint"),
  selectionCoverage: document.querySelector("#selectionCoverage"),
  demoRail: document.querySelector("#demoRail"),
  demoButtons: [],
  maskToggle: document.querySelector("#maskToggle"),
  maskPreview: document.querySelector("#maskPreview"),
  paintCanvas: document.querySelector("#paintCanvas"),
  spotMarker: document.querySelector("#spotMarker"),
  selectionButtons: [...document.querySelectorAll("[data-selection]")],
  selectionHelp: document.querySelector("#selectionHelp"),
  brushTools: document.querySelector("#brushTools"),
  brushModeButtons: [...document.querySelectorAll("[data-brush-mode]")],
  brushSize: document.querySelector("#brushSize"),
  brushSizeValue: document.querySelector("#brushSizeValue"),
  undoPaint: document.querySelector("#undoPaint"),
  clearPaint: document.querySelector("#clearPaint"),
  recipeButtons: [...document.querySelectorAll("[data-recipe]")],
  colorSwatches: [...document.querySelectorAll(".color-swatch[data-color]")],
  customColor: document.querySelector("#customColor"),
  selectedColorName: document.querySelector("#selectedColorName"),
  shineAmount: document.querySelector("#shineAmount"),
  shineAmountValue: document.querySelector("#shineAmountValue"),
  shineArea: document.querySelector("#shineArea"),
  shineAreaValue: document.querySelector("#shineAreaValue"),
  areaRangeControl: document.querySelector("#areaRangeControl"),
  areaRangeHint: document.querySelector("#areaRangeHint"),
  shineBloom: document.querySelector("#shineBloom"),
  shineBloomValue: document.querySelector("#shineBloomValue"),
  truthCard: document.querySelector("#truthCard"),
  truthTitle: document.querySelector("#truthTitle"),
  truthMessage: document.querySelector("#truthMessage"),
  resetButton: document.querySelector("#resetButton"),
  readyDot: document.querySelector("#readyDot"),
  readyLabel: document.querySelector("#readyLabel"),
  exportMeta: document.querySelector("#exportMeta"),
  saveHdrButton: document.querySelector("#saveHdrButton"),
  saveSdrButton: document.querySelector("#saveSdrButton"),
  shareButton: document.querySelector("#shareButton"),
  aboutButton: document.querySelector("#aboutButton"),
  aboutDialog: document.querySelector("#aboutDialog"),
  aboutClose: document.querySelector("#aboutClose"),
  aboutDone: document.querySelector("#aboutDone"),
  storyButton: document.querySelector("#storyButton"),
  chainlinkStoryImage: document.querySelector("#chainlinkStoryImage"),
  toast: document.querySelector("#toast"),
  toastTitle: document.querySelector("#toastTitle"),
  toastMessage: document.querySelector("#toastMessage"),
  toastClose: document.querySelector("#toastClose"),
};

initialize();

async function initialize() {
  restoreSettings();
  syncControlsFromState();
  setSelection(state.selection, false);
  renderDemoRail();
  bindUploads();
  bindComparison();
  bindSelection();
  bindPainting();
  bindLooks();
  bindExport();
  bindHelp();
  updateHdrCapability();

  const dynamicRangeQuery = window.matchMedia?.("(dynamic-range: high)");
  dynamicRangeQuery?.addEventListener?.("change", updateHdrCapability);

  try {
    state.profile = await loadProfile();
  } catch (error) {
    console.error("Could not load the Rec.2100 PQ profile", error);
    setReadyState("error", "HDR profile unavailable");
    showToast("HDR profile unavailable", "Use the hosted page or the standalone build to export HDR.");
  }

  await loadDemo(DEFAULT_DEMO.id, { applySettings: false, announce: false });

  registerOfflineWorker();
}

async function loadProfile() {
  if (typeof EMBEDDED_ASSETS.profileBase64 === "string") {
    return base64ToBytes(EMBEDDED_ASSETS.profileBase64);
  }
  const response = await fetch(PROFILE_URL);
  if (!response.ok) throw new Error(`Profile request failed with ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function renderDemoRail() {
  const fragment = document.createDocumentFragment();
  elements.demoButtons = DEMOS.map((demo) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "demo-card";
    button.dataset.demo = demo.id;
    button.setAttribute("aria-pressed", String(demo.id === state.activeDemoId));
    button.setAttribute("aria-label", `Try ${demo.title}: ${demo.short}`);

    const imageWrap = document.createElement("span");
    imageWrap.className = "demo-card-image";
    const image = document.createElement("img");
    image.src = resolvedDemoUrl(demo, EMBEDDED_ASSETS);
    image.alt = "";
    image.loading = demo.id === DEFAULT_DEMO.id ? "eager" : "lazy";
    image.decoding = "async";
    imageWrap.append(image);
    if (demo.caseStudy) {
      const badge = document.createElement("span");
      badge.className = "demo-card-badge";
      badge.textContent = "Origin";
      imageWrap.append(badge);
    }

    const copy = document.createElement("span");
    copy.className = "demo-card-copy";
    const title = document.createElement("strong");
    title.textContent = demo.title;
    const description = document.createElement("small");
    description.textContent = demo.short;
    copy.append(title, description);
    button.append(imageWrap, copy);
    button.addEventListener("click", () => loadDemo(demo.id));
    fragment.append(button);
    return button;
  });
  elements.demoRail.replaceChildren(fragment);

  const chainlinkDemo = demoById("chainlink");
  if (chainlinkDemo) elements.chainlinkStoryImage.src = resolvedDemoUrl(chainlinkDemo, EMBEDDED_ASSETS);
  updateDemoButtons();
}

async function loadDemo(id, { applySettings = true, announce = true } = {}) {
  const demo = demoById(id);
  if (!demo) return;
  if (applySettings) applyDemoSettings(demo);
  const loaded = await loadSource(resolvedDemoUrl(demo, EMBEDDED_ASSETS), {
    name: demo.fileName,
    bytes: 0,
    isDemo: true,
    demoId: demo.id,
  });
  if (!loaded) return;
  if (sourceObjectUrl) {
    URL.revokeObjectURL(sourceObjectUrl);
    sourceObjectUrl = null;
  }
  if (!announce) return;
  showToast(
    demo.caseStudy ? "The image that started it" : `${demo.title} is ready`,
    demo.caseStudy
      ? "Magic isolates the white mark; open “How it works” for the brighter-than-white story."
      : `${demo.short} · ${demo.recipe[0].toUpperCase()}${demo.recipe.slice(1)} is tuned and ready to adjust.`,
  );
}

function applyDemoSettings(demo) {
  state.shineAmount = demo.amount;
  state.shineArea = demo.area;
  state.shineBloom = demo.bloom;
  state.shineColor = demo.color;
  state.shineColorName = demo.colorName;
  state.activeRecipe = demo.recipe;
  clearPaintCanvas();
  syncControlsFromState();
  setSelection(demo.selection, false);
  saveSettings();
}

function updateDemoButtons() {
  for (const button of elements.demoButtons) {
    const active = button.dataset.demo === state.activeDemoId;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function bindUploads() {
  for (const input of [elements.fileInput, elements.cameraInput]) {
    input.addEventListener("change", () => {
      const [file] = input.files;
      if (file) handleFile(file);
      input.value = "";
    });
  }

  for (const eventName of ["dragenter", "dragover", "dragleave", "drop"]) {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  }

  let dragDepth = 0;
  elements.dropZone.addEventListener("dragenter", () => {
    dragDepth += 1;
    elements.dropOverlay.classList.add("is-visible");
  });
  elements.dropZone.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) elements.dropOverlay.classList.remove("is-visible");
  });
  elements.dropZone.addEventListener("drop", (event) => {
    dragDepth = 0;
    elements.dropOverlay.classList.remove("is-visible");
    const [file] = event.dataTransfer.files;
    if (file) handleFile(file);
  });
}

function bindComparison() {
  const updateComparison = () => {
    const value = Number(elements.compareRange.value);
    elements.previewStage.style.setProperty("--compare", `${value}%`);
    elements.previewStage.classList.toggle("is-comparing", value > 1 && value < 99);
    elements.showAfterButton.classList.toggle("is-active", value === 0);
    elements.showBeforeButton.classList.toggle("is-active", value === 100);
    updateRangeTrack(elements.compareRange);
  };

  elements.compareRange.addEventListener("input", updateComparison);
  elements.showBeforeButton.addEventListener("click", () => setPreviewSide("before"));
  elements.showAfterButton.addEventListener("click", () => setPreviewSide("after"));

  const revealOriginal = () => {
    if (state.selection === "paint") return;
    elements.previewStage.style.setProperty("--compare", "100%");
  };
  const restoreComparison = () => {
    elements.previewStage.style.setProperty("--compare", `${elements.compareRange.value}%`);
  };
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space" && !isFormField(event.target)) {
      event.preventDefault();
      revealOriginal();
    }
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") restoreComparison();
  });

  elements.maskToggle.addEventListener("click", () => {
    const show = elements.maskToggle.getAttribute("aria-pressed") !== "true";
    elements.maskToggle.setAttribute("aria-pressed", String(show));
    elements.maskPreview.hidden = !show || state.selection === "paint";
    elements.paintCanvas.classList.toggle("is-hidden-guide", state.selection === "paint" && !show);
  });

  updateComparison();
}

function bindSelection() {
  for (const button of elements.selectionButtons) {
    button.addEventListener("click", () => setSelection(button.dataset.selection));
  }

  elements.previewStage.addEventListener("pointerdown", (event) => {
    if (state.selection !== "spot" || event.target.closest("button, input, label")) return;
    const rect = elements.previewStage.getBoundingClientRect();
    state.spotX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    state.spotY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    updateSpotMarker();
    state.activeRecipe = null;
    updateRecipeButtons();
    saveSettings();
    scheduleRender(0);
  });

  elements.previewStage.addEventListener("keydown", (event) => {
    if (event.target !== elements.previewStage || state.selection !== "spot") return;
    const directions = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.08 : 0.02;
    state.spotX = clamp(state.spotX + direction[0] * step, 0, 1);
    state.spotY = clamp(state.spotY + direction[1] * step, 0, 1);
    updateSpotMarker();
    state.activeRecipe = null;
    updateRecipeButtons();
    saveSettings();
    scheduleRender(0);
  });
}

function bindPainting() {
  for (const button of elements.brushModeButtons) {
    button.addEventListener("click", () => {
      state.brushMode = button.dataset.brushMode;
      for (const peer of elements.brushModeButtons) {
        peer.classList.toggle("is-active", peer === button);
      }
      saveSettings();
    });
  }

  elements.brushSize.addEventListener("input", () => {
    state.brushSize = Number(elements.brushSize.value);
    elements.brushSizeValue.textContent = String(state.brushSize);
    updateRangeTrack(elements.brushSize);
    saveSettings();
  });

  elements.undoPaint.addEventListener("click", () => {
    const snapshot = paintHistory.pop();
    if (!snapshot) return;
    const context = elements.paintCanvas.getContext("2d");
    context.clearRect(0, 0, elements.paintCanvas.width, elements.paintCanvas.height);
    context.putImageData(snapshot, 0, 0);
    updatePaintHistoryUi();
    scheduleRender(0);
  });

  elements.clearPaint.addEventListener("click", () => {
    pushPaintHistory();
    elements.paintCanvas.getContext("2d").clearRect(
      0,
      0,
      elements.paintCanvas.width,
      elements.paintCanvas.height,
    );
    scheduleRender(0);
  });

  let painting = false;
  let lastPoint = null;

  const pointFromEvent = (event) => {
    const rect = elements.paintCanvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * elements.paintCanvas.width,
      y: ((event.clientY - rect.top) / rect.height) * elements.paintCanvas.height,
      scale: elements.paintCanvas.width / rect.width,
    };
  };

  const drawStroke = (from, to) => {
    const context = elements.paintCanvas.getContext("2d");
    context.save();
    context.globalCompositeOperation = state.brushMode === "erase" ? "destination-out" : "source-over";
    context.strokeStyle = "rgba(255, 72, 124, .72)";
    context.lineWidth = state.brushSize * to.scale;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    context.restore();
  };

  elements.paintCanvas.addEventListener("focus", updateSpotMarker);
  elements.paintCanvas.addEventListener("blur", updateSpotMarker);
  elements.paintCanvas.addEventListener("keydown", (event) => {
    if (state.selection !== "paint") return;
    const directions = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direction = directions[event.key];
    if (direction) {
      event.preventDefault();
      const step = event.shiftKey ? 0.08 : 0.02;
      state.spotX = clamp(state.spotX + direction[0] * step, 0, 1);
      state.spotY = clamp(state.spotY + direction[1] * step, 0, 1);
      updateSpotMarker();
      saveSettings();
      return;
    }

    if (![" ", "Enter"].includes(event.key)) return;
    event.preventDefault();
    pushPaintHistory();
    const rect = elements.paintCanvas.getBoundingClientRect();
    const point = {
      x: state.spotX * elements.paintCanvas.width,
      y: state.spotY * elements.paintCanvas.height,
      scale: rect.width ? elements.paintCanvas.width / rect.width : 1,
    };
    drawStroke(point, { ...point, x: point.x + 0.01 });
    updatePaintHistoryUi();
    scheduleRender(0);
  });

  elements.paintCanvas.addEventListener("pointerdown", (event) => {
    if (state.selection !== "paint") return;
    event.preventDefault();
    pushPaintHistory();
    painting = true;
    lastPoint = pointFromEvent(event);
    elements.paintCanvas.setPointerCapture(event.pointerId);
    drawStroke(lastPoint, { ...lastPoint, x: lastPoint.x + 0.01 });
  });

  elements.paintCanvas.addEventListener("pointermove", (event) => {
    if (!painting || !lastPoint) return;
    event.preventDefault();
    const point = pointFromEvent(event);
    drawStroke(lastPoint, point);
    lastPoint = point;
  });

  const finishPainting = () => {
    if (!painting) return;
    painting = false;
    lastPoint = null;
    updatePaintHistoryUi();
    scheduleRender(40);
  };
  elements.paintCanvas.addEventListener("pointerup", finishPainting);
  elements.paintCanvas.addEventListener("pointercancel", finishPainting);
}

function bindLooks() {
  for (const button of elements.recipeButtons) {
    button.addEventListener("click", () => applyRecipe(button.dataset.recipe));
  }

  for (const swatch of elements.colorSwatches) {
    swatch.addEventListener("click", () => {
      setShineColor(swatch.dataset.color, swatch.dataset.name, swatch);
      clearActiveRecipe();
    });
  }

  elements.customColor.addEventListener("input", () => {
    const container = elements.customColor.closest(".color-swatch");
    container.style.setProperty("--swatch", elements.customColor.value);
    setShineColor(elements.customColor.value, "Custom", container);
    clearActiveRecipe();
  });

  elements.shineAmount.addEventListener("input", () => {
    state.shineAmount = Number(elements.shineAmount.value) / 100;
    clearActiveRecipe();
    updateControlLabels();
    saveSettings();
    scheduleRender();
  });
  elements.shineArea.addEventListener("input", () => {
    state.shineArea = Number(elements.shineArea.value) / 100;
    clearActiveRecipe();
    updateControlLabels();
    saveSettings();
    scheduleRender();
  });
  elements.shineBloom.addEventListener("input", () => {
    state.shineBloom = Number(elements.shineBloom.value) / 100;
    clearActiveRecipe();
    updateControlLabels();
    saveSettings();
    scheduleRender();
  });

  elements.resetButton.addEventListener("click", () => {
    const activeDemo = demoById(state.activeDemoId);
    if (activeDemo) applyDemoSettings(activeDemo);
    else {
      Object.assign(state, DEFAULTS, { activeRecipe: "clean" });
      clearPaintCanvas();
      syncControlsFromState();
      setSelection("lights", false);
    }
    saveSettings();
    scheduleRender(0);
    showToast("Back to clean", "The original photo is untouched; only the shine settings were reset.");
  });
}

function bindExport() {
  elements.saveHdrButton.addEventListener("click", (event) => {
    if (!isCurrentExportReady()) {
      event.preventDefault();
      showToast("Still preparing", "The save button will light up when the HDR JPEG is ready.");
      scheduleExportPreparation(0);
      return;
    }
    currentExportBlob = preparedExport.hdrBlob;
    const mobileHint = /iPhone|iPad|iPod/i.test(navigator.userAgent)
      ? "If a preview opens, tap Share, then Save to Files or Save Image."
      : "Look in your browser’s Downloads list.";
    showToast("HDR save started", mobileHint);
  });

  elements.saveSdrButton.addEventListener("click", (event) => {
    if (!isCurrentExportReady()) {
      event.preventDefault();
      showToast("Still preparing", "Your universal glow copy is being made too.");
      return;
    }
    showToast("SDR glow save started", "This version looks similar on ordinary screens, but is not physically brighter than white.");
  });

  elements.shareButton.addEventListener("click", shareFinishedFile);
}

function bindHelp() {
  const openAbout = () => {
    if (!elements.aboutDialog.open) elements.aboutDialog.showModal();
  };
  elements.aboutButton.addEventListener("click", openAbout);
  elements.storyButton.addEventListener("click", openAbout);
  elements.hdrStatusButton.addEventListener("click", () => {
    elements.truthCard.open = true;
    if (window.matchMedia("(max-width: 980px)").matches) {
      elements.truthCard.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
  elements.aboutClose.addEventListener("click", () => elements.aboutDialog.close());
  elements.aboutDone.addEventListener("click", () => elements.aboutDialog.close());
  elements.aboutDialog.addEventListener("click", (event) => {
    if (event.target === elements.aboutDialog) elements.aboutDialog.close();
  });
  elements.toastClose.addEventListener("click", hideToast);
}

async function handleFile(file) {
  try {
    await validateRasterFile(file);
  } catch (error) {
    const message = error instanceof ImageGuardError
      ? error.message
      : "Choose a JPG, PNG, WebP, AVIF, HEIC or HEIF photo.";
    showToast("That photo can’t be opened safely", message);
    return;
  }

  const nextUrl = URL.createObjectURL(file);
  try {
    const loaded = await loadSource(nextUrl, { name: file.name || "camera-photo", bytes: file.size, isDemo: false });
    if (!loaded) {
      URL.revokeObjectURL(nextUrl);
      return;
    }
    if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl);
    sourceObjectUrl = nextUrl;
    showToast("Photo ready", "Magic found the brightest details. Try Tap if you want one specific spot.");
  } catch (error) {
    URL.revokeObjectURL(nextUrl);
    console.error(error);
    showToast(
      "This browser couldn’t read that photo",
      error instanceof ImageGuardError ? error.message : "HEIC support varies. Try sharing or exporting it as JPG first.",
    );
  }
}

async function loadSource(url, metadata) {
  const sequence = ++sourceLoadSequence;
  setReadyState("working", "Reading photo");
  invalidatePreparedExport();

  const candidateImage = new Image();
  candidateImage.decoding = "async";
  await new Promise((resolve, reject) => {
    candidateImage.onload = resolve;
    candidateImage.onerror = () => reject(new Error("Image decode failed"));
    candidateImage.src = url;
  });
  await candidateImage.decode?.().catch(() => {});
  validateImageDimensions(candidateImage.naturalWidth, candidateImage.naturalHeight);
  if (sequence !== sourceLoadSequence) return false;
  sourceImage = candidateImage;

  state.sourceName = metadata.name;
  state.sourceBytes = metadata.bytes;
  state.isDemo = metadata.isDemo;
  state.activeDemoId = metadata.demoId || null;
  updateDemoButtons();
  elements.body.classList.toggle("has-user-photo", !metadata.isDemo);
  elements.originalImage.src = url;
  elements.originalImage.alt = `Original ${metadata.name}`;
  elements.fileName.textContent = metadata.name;
  elements.fileDetails.textContent = [
    metadata.isDemo ? "Sample" : formatBytes(metadata.bytes),
    `${sourceImage.naturalWidth} × ${sourceImage.naturalHeight}`,
  ].join(" · ");

  const ratio = sourceImage.naturalWidth / sourceImage.naturalHeight;
  elements.previewStage.style.setProperty("--preview-ratio", String(ratio));
  const previewDimensions = fitDimensions(
    sourceImage.naturalWidth,
    sourceImage.naturalHeight,
    PREVIEW_MAX_EDGE,
  );
  elements.paintCanvas.width = previewDimensions.width;
  elements.paintCanvas.height = previewDimensions.height;
  clearPaintCanvas();
  updateSpotMarker();
  elements.maskToggle.setAttribute("aria-pressed", "false");
  elements.maskPreview.hidden = true;
  setPreviewSide("after");
  await renderPreview();
  return true;
}

function setSelection(selection, shouldRender = true) {
  if (!new Set(["lights", "spot", "paint"]).has(selection)) return;
  state.selection = selection;
  for (const button of elements.selectionButtons) {
    const active = button.dataset.selection === selection;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  const isPaint = selection === "paint";
  const isSpot = selection === "spot";
  elements.brushTools.hidden = !isPaint;
  elements.paintCanvas.hidden = !isPaint;
  elements.paintCanvas.tabIndex = isPaint ? 0 : -1;
  elements.paintCanvas.classList.remove("is-hidden-guide");
  elements.previewStage.tabIndex = isSpot ? 0 : -1;
  elements.previewStage.classList.toggle("is-spotting", isSpot);
  elements.previewStage.setAttribute(
    "aria-label",
    isSpot
      ? "Photo preview. Use the arrow keys to position the shine target; hold Shift for bigger steps."
      : "Photo preview",
  );
  elements.compareRange.disabled = isPaint;
  elements.compareLine.hidden = isPaint;
  elements.maskPreview.hidden = elements.maskToggle.getAttribute("aria-pressed") !== "true" || isPaint;
  elements.shineArea.disabled = isPaint;
  elements.areaRangeControl.classList.toggle("is-disabled", isPaint);
  elements.selectionHelp.textContent = isPaint
    ? "Draw with a finger, mouse or pen. Keyboard: arrows move the brush; Space paints."
    : isSpot
      ? "Tap the photo or use the arrow keys to place the target."
      : "Magic finds the brightest details for you.";
  updateControlLabels();
  updateSpotMarker();
  saveSettings();
  if (shouldRender) {
    if (isSpot) elements.previewStage.focus({ preventScroll: true });
    if (isPaint) elements.paintCanvas.focus({ preventScroll: true });
    scheduleRender(20);
  }
}

function updateSpotMarker() {
  elements.previewStage.style.setProperty("--spot-x", String(state.spotX));
  elements.previewStage.style.setProperty("--spot-y", String(state.spotY));
  const paintKeyboardCursor = state.selection === "paint"
    && document.activeElement === elements.paintCanvas;
  elements.spotMarker.hidden = state.selection !== "spot" && !paintKeyboardCursor;
}

function applyRecipe(name) {
  const recipe = RECIPES[name];
  if (!recipe) return;
  state.shineAmount = recipe.amount;
  state.shineArea = recipe.area;
  state.shineBloom = recipe.bloom;
  state.shineColor = recipe.color;
  state.shineColorName = recipe.colorName;
  state.activeRecipe = name;
  syncControlsFromState();
  saveSettings();
  scheduleRender(20);
}

function setShineColor(color, name, selectedElement) {
  state.shineColor = color;
  state.shineColorName = name;
  elements.selectedColorName.textContent = name;
  for (const swatch of document.querySelectorAll(".color-swatch")) {
    const active = swatch === selectedElement;
    swatch.classList.toggle("is-active", active);
    if (swatch.matches("button")) swatch.setAttribute("aria-pressed", String(active));
  }
  saveSettings();
  scheduleRender(20);
}

function clearActiveRecipe() {
  state.activeRecipe = null;
  updateRecipeButtons();
}

function updateRecipeButtons() {
  for (const button of elements.recipeButtons) {
    const active = button.dataset.recipe === state.activeRecipe;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function syncControlsFromState() {
  elements.shineAmount.value = String(Math.round(state.shineAmount * 100));
  elements.shineArea.value = String(Math.round(state.shineArea * 100));
  elements.shineBloom.value = String(Math.round(state.shineBloom * 100));
  elements.brushSize.value = String(state.brushSize);
  elements.brushSizeValue.textContent = String(state.brushSize);
  elements.selectedColorName.textContent = state.shineColorName;
  for (const swatch of document.querySelectorAll(".color-swatch")) {
    const color = swatch.dataset.color?.toLowerCase();
    const active = color === state.shineColor.toLowerCase();
    swatch.classList.toggle("is-active", active);
    if (swatch.matches("button")) swatch.setAttribute("aria-pressed", String(active));
  }
  for (const button of elements.brushModeButtons) {
    button.classList.toggle("is-active", button.dataset.brushMode === state.brushMode);
  }
  updateRecipeButtons();
  updateControlLabels();
  [elements.shineAmount, elements.shineArea, elements.shineBloom, elements.brushSize].forEach(updateRangeTrack);
}

function updateControlLabels() {
  const roundedNits = Math.round(currentTargetNits() / 100) * 100;
  elements.shineAmountValue.textContent = `${roundedNits.toLocaleString()} nits`;
  if (state.selection === "spot") {
    elements.areaRangeHint.textContent = "tap radius";
    elements.shineAreaValue.textContent = `${Math.round(spotRadius() * 200)}%`;
  } else if (state.selection === "paint") {
    elements.areaRangeHint.textContent = "your brush mask";
    elements.shineAreaValue.textContent = "Painted";
  } else {
    elements.areaRangeHint.textContent = "brightest pixels";
    elements.shineAreaValue.textContent = `${Math.round(targetHighlightFraction() * 100)}%`;
  }
  elements.shineBloomValue.textContent = bloomLabel(state.shineBloom);
  updateExportMetadata();
}

function scheduleRender(delay = 130) {
  invalidatePreparedExport();
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderPreview, delay);
}

async function renderPreview() {
  if (!sourceImage.complete || !sourceImage.naturalWidth) return;
  if (isRendering) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderPreview, 70);
    return;
  }

  const sequence = ++renderSequence;
  isRendering = true;
  setReadyState("working", "Making preview");
  try {
    const result = await createHdrResult(PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE * PREVIEW_MAX_EDGE, {
      includeMaskPreview: true,
      includeSdrPreview: true,
    });
    if (sequence !== renderSequence) return;

    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    latestPreviewSdrBlob = result.sdrBlob;
    previewObjectUrl = URL.createObjectURL(canDisplayPhysicalHdr ? result.hdrBlob : result.sdrBlob);
    elements.resultImage.src = previewObjectUrl;
    elements.resultImage.alt = canDisplayPhysicalHdr
      ? `${state.shineColorName} HDR version of ${state.sourceName}`
      : `Simulated ${state.shineColorName} glow preview of ${state.sourceName}`;
    elements.selectionCoverage.textContent = result.selectionLabel;
    setReadyState("working", "Preparing save");
  } catch (error) {
    console.error("Preview render failed", error);
    setReadyState("error", "Preview failed");
    showToast("The shine got stuck", "Try a smaller photo or reload the page.");
  } finally {
    isRendering = false;
    scheduleExportPreparation();
  }
}

async function createHdrResult(maxEdge, maxPixels, {
  includeMaskPreview = false,
  includeSdrPreview = false,
} = {}) {
  const { width, height } = fitDimensions(
    sourceImage.naturalWidth,
    sourceImage.naturalHeight,
    maxEdge,
    maxPixels,
  );
  const inputCanvas = document.createElement("canvas");
  inputCanvas.width = width;
  inputCanvas.height = height;
  const inputContext = inputCanvas.getContext("2d", { willReadFrequently: true });
  inputContext.drawImage(sourceImage, 0, 0, width, height);
  const sourcePixels = inputContext.getImageData(0, 0, width, height);

  let paintPixels = null;
  if (state.selection === "paint") {
    const scaledPaintCanvas = document.createElement("canvas");
    scaledPaintCanvas.width = width;
    scaledPaintCanvas.height = height;
    const paintContext = scaledPaintCanvas.getContext("2d", { willReadFrequently: true });
    paintContext.drawImage(elements.paintCanvas, 0, 0, width, height);
    paintPixels = paintContext.getImageData(0, 0, width, height).data;
  }

  const outputPixels = new Uint8ClampedArray(sourcePixels.data.length);
  const maskPixels = includeMaskPreview ? new Uint8ClampedArray(sourcePixels.data.length) : null;
  const sdrShinePixels = includeSdrPreview ? new Uint8ClampedArray(sourcePixels.data.length) : null;
  const colorBytes = hexToRgb(state.shineColor);
  const color = colorBytes.map((channel) => srgbToLinear(channel / 255));
  const tintRec2020 = linearSrgbToRec2020(color);
  const maxTint = Math.max(...tintRec2020, 0.0001);
  const normalizedTint = tintRec2020.map((channel) => Math.max(0, channel / maxTint));
  const targetNits = currentTargetNits();
  const baseWhiteNits = 180;
  const edgeSoftness = 0.018 + state.shineBloom * 0.19;
  const adaptiveThreshold = findAdaptiveHighlightThreshold(sourcePixels.data, targetHighlightFraction());
  const threshold = Math.max(0.012, adaptiveThreshold - edgeSoftness * 0.34);
  const blendStrength = 0.18 + state.shineAmount * 0.82;
  const input = sourcePixels.data;
  const radius = spotRadius() * Math.min(width, height);
  let selectedPixelCount = 0;

  for (let pixel = 0; pixel < input.length; pixel += 4) {
    const red = srgbToLinear(input[pixel] / 255);
    const green = srgbToLinear(input[pixel + 1] / 255);
    const blue = srgbToLinear(input[pixel + 2] / 255);
    const luminance = linearSrgbLuminance(red, green, blue);
    const pixelIndex = pixel / 4;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    let mask;

    if (state.selection === "spot") {
      const distance = Math.hypot(x - state.spotX * width, y - state.spotY * height);
      const radial = 1 - smoothstep(radius * 0.42, radius, distance);
      const localDetail = 0.42 + 0.58 * Math.sqrt(Math.max(0, luminance));
      mask = radial * localDetail;
    } else if (state.selection === "paint") {
      mask = paintPixels ? Math.min(1, paintPixels[pixel + 3] / 178) : 0;
    } else {
      mask = highlightMask(luminance, threshold, edgeSoftness);
    }

    mask *= 0.82 + 0.18 * luminance;
    if (mask > 0.08) selectedPixelCount += 1;
    const rec2020 = linearSrgbToRec2020(red, green, blue);
    const detailScale = 0.60 + 0.40 * Math.sqrt(Math.max(0, luminance));
    const blend = Math.min(1, mask * blendStrength);

    for (let channel = 0; channel < 3; channel += 1) {
      const baseNits = Math.max(0, rec2020[channel]) * baseWhiteNits;
      const desiredNits = normalizedTint[channel] * targetNits * detailScale;
      const outputNits = baseNits + blend * Math.max(0, desiredNits - baseNits);
      outputPixels[pixel + channel] = Math.round(pqEncodeNits(outputNits) * 255);
    }
    outputPixels[pixel + 3] = 255;

    if (maskPixels) {
      maskPixels[pixel] = 255;
      maskPixels[pixel + 1] = 62;
      maskPixels[pixel + 2] = 124;
      maskPixels[pixel + 3] = Math.round(Math.min(1, mask) * 210);
    }

    if (sdrShinePixels) {
      const whiteCore = state.shineColor === "#ffffff" ? 1 : 0.58;
      sdrShinePixels[pixel] = Math.round(255 * whiteCore + colorBytes[0] * (1 - whiteCore));
      sdrShinePixels[pixel + 1] = Math.round(255 * whiteCore + colorBytes[1] * (1 - whiteCore));
      sdrShinePixels[pixel + 2] = Math.round(255 * whiteCore + colorBytes[2] * (1 - whiteCore));
      sdrShinePixels[pixel + 3] = Math.round(Math.min(1, mask * blendStrength) * 242);
    }
  }

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = width;
  outputCanvas.height = height;
  outputCanvas.getContext("2d").putImageData(new ImageData(outputPixels, width, height), 0, 0);

  if (maskPixels) {
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = width;
    maskCanvas.height = height;
    maskCanvas.getContext("2d").putImageData(new ImageData(maskPixels, width, height), 0, 0);
    elements.maskPreview.src = maskCanvas.toDataURL("image/png");
    elements.maskPreview.hidden = elements.maskToggle.getAttribute("aria-pressed") !== "true" || state.selection === "paint";
  }

  let sdrBlob = null;
  if (sdrShinePixels) {
    const sdrCanvas = document.createElement("canvas");
    sdrCanvas.width = width;
    sdrCanvas.height = height;
    const sdrContext = sdrCanvas.getContext("2d");
    sdrContext.putImageData(sourcePixels, 0, 0);

    const shineCanvas = document.createElement("canvas");
    shineCanvas.width = width;
    shineCanvas.height = height;
    shineCanvas.getContext("2d").putImageData(new ImageData(sdrShinePixels, width, height), 0, 0);
    const glowRadius = Math.max(1, Math.round((3 + state.shineBloom * 24) * width / PREVIEW_MAX_EDGE));
    sdrContext.save();
    sdrContext.globalCompositeOperation = "screen";
    sdrContext.globalAlpha = 0.62 + state.shineAmount * 0.30;
    sdrContext.filter = `blur(${glowRadius}px)`;
    sdrContext.drawImage(shineCanvas, 0, 0);
    sdrContext.filter = "none";
    sdrContext.globalAlpha = 0.72 + state.shineAmount * 0.25;
    sdrContext.drawImage(shineCanvas, 0, 0);
    sdrContext.restore();
    sdrBlob = await canvasToBlob(sdrCanvas, "image/jpeg", 0.93);
  }

  const canvasBlob = await canvasToBlob(outputCanvas, "image/jpeg", 0.95);
  const jpegBytes = new Uint8Array(await canvasBlob.arrayBuffer());
  const finalBytes = state.profile ? injectICCProfile(jpegBytes, state.profile) : jpegBytes;
  const selectedPercent = (selectedPixelCount / (width * height)) * 100;
  const selectionName = state.selection === "lights"
    ? "bright area"
    : state.selection === "spot"
      ? "tapped area"
      : "painted area";

  return {
    hdrBlob: new Blob([finalBytes], { type: "image/jpeg" }),
    sdrBlob,
    width,
    height,
    targetNits,
    selectedPercent,
    selectionLabel: `${formatSelectionPercent(selectedPercent)} ${selectionName}`,
  };
}

function invalidatePreparedExport() {
  editRevision += 1;
  exportPrepareSequence += 1;
  clearTimeout(exportPrepareTimer);
  preparedExport = null;
  currentExportBlob = null;
  elements.saveHdrButton.removeAttribute("href");
  elements.saveHdrButton.removeAttribute("download");
  elements.saveSdrButton.removeAttribute("href");
  elements.saveSdrButton.removeAttribute("download");
  updateExportUi();
}

function scheduleExportPreparation(delay = isMobileLayout() ? 900 : 620) {
  clearTimeout(exportPrepareTimer);
  if (!state.profile || !sourceImage.naturalWidth) {
    updateExportUi();
    return;
  }
  const revision = editRevision;
  exportPrepareTimer = setTimeout(() => prepareExport(revision), delay);
}

async function prepareExport(revision) {
  if (isRendering) {
    scheduleExportPreparation(160);
    return;
  }
  const sequence = ++exportPrepareSequence;
  const sourceName = state.sourceName;
  isPreparingExport = true;
  setReadyState("working", "Preparing HDR + glow");
  updateExportUi();

  const mobile = isMobileLayout();
  let edge = mobile ? MOBILE_EXPORT_EDGE : DESKTOP_EXPORT_EDGE;
  let pixelLimit = mobile ? MOBILE_PIXEL_LIMIT : DESKTOP_PIXEL_LIMIT;

  try {
    let result;
    try {
      result = await createHdrResult(edge, pixelLimit, { includeSdrPreview: true });
    } catch (firstError) {
      if (edge <= 1920) throw firstError;
      console.warn("Full-size export failed; retrying at a mobile-safe size", firstError);
      edge = 1920;
      pixelLimit = 3_500_000;
      result = await createHdrResult(edge, pixelLimit, { includeSdrPreview: true });
    }
    if (revision !== editRevision || sequence !== exportPrepareSequence) return;

    const oldHdrUrl = exportHdrObjectUrl;
    const oldSdrUrl = exportSdrObjectUrl;
    exportHdrObjectUrl = URL.createObjectURL(result.hdrBlob);
    exportSdrObjectUrl = URL.createObjectURL(result.sdrBlob);
    if (oldHdrUrl) setTimeout(() => URL.revokeObjectURL(oldHdrUrl), 60_000);
    if (oldSdrUrl) setTimeout(() => URL.revokeObjectURL(oldSdrUrl), 60_000);
    preparedExport = {
      revision,
      hdrBlob: result.hdrBlob,
      sdrBlob: result.sdrBlob,
      hdrUrl: exportHdrObjectUrl,
      sdrUrl: exportSdrObjectUrl,
      hdrFilename: exportFileName("hdr"),
      sdrFilename: exportFileName("glow"),
      sourceName,
      width: result.width,
      height: result.height,
      targetNits: result.targetNits,
    };
    currentExportBlob = result.hdrBlob;
    setReadyState("ready", "HDR file ready");
  } catch (error) {
    if (sequence === exportPrepareSequence) {
      console.error("Export preparation failed", error);
      setReadyState("error", "Save unavailable");
      showToast("Couldn’t prepare the full photo", "Try a smaller image or reload the page.");
    }
  } finally {
    if (sequence === exportPrepareSequence) isPreparingExport = false;
    updateExportUi();
  }
}

function updateExportUi() {
  const ready = isCurrentExportReady();
  elements.saveHdrButton.setAttribute("aria-disabled", String(!ready));
  elements.saveSdrButton.setAttribute("aria-disabled", String(!ready));
  elements.shareButton.disabled = !ready;
  if (ready) {
    elements.saveHdrButton.href = preparedExport.hdrUrl;
    elements.saveHdrButton.download = preparedExport.hdrFilename;
    elements.saveSdrButton.href = preparedExport.sdrUrl;
    elements.saveSdrButton.download = preparedExport.sdrFilename;
    elements.exportMeta.textContent = `Rec.2100 PQ · ${preparedExport.width} × ${preparedExport.height} · stays local`;
  } else {
    elements.saveHdrButton.removeAttribute("href");
    elements.saveHdrButton.removeAttribute("download");
    elements.saveSdrButton.removeAttribute("href");
    elements.saveSdrButton.removeAttribute("download");
    updateExportMetadata();
  }
}

function updateExportMetadata() {
  if (isCurrentExportReady()) return;
  const edge = isMobileLayout() ? MOBILE_EXPORT_EDGE : DESKTOP_EXPORT_EDGE;
  elements.exportMeta.textContent = `Rec.2100 PQ · private · up to ${edge}px`;
}

function isCurrentExportReady() {
  return Boolean(preparedExport && preparedExport.revision === editRevision && state.profile);
}

async function shareFinishedFile() {
  if (!isCurrentExportReady()) return;
  const file = new File([preparedExport.hdrBlob], preparedExport.hdrFilename, { type: "image/jpeg" });
  const shareData = { files: [file], title: "My ShinyPic HDR photo" };

  if (navigator.share && navigator.canShare?.(shareData)) {
    try {
      await navigator.share(shareData);
      showToast("Shared from this device", "Some social apps may flatten HDR; your saved HDR file remains unchanged.");
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.warn("Native file share failed", error);
    }
  }

  elements.saveHdrButton.click();
  showToast("Sharing isn’t available here", "The HDR file was sent to your browser’s save flow instead.");
}

function updateHdrCapability() {
  const hdrScreen = window.matchMedia?.("(dynamic-range: high)")?.matches ?? false;
  const limitSupported = window.CSS?.supports?.("dynamic-range-limit", "no-limit") ?? false;
  const isSafari = /^((?!chrome|chromium|android).)*safari/i.test(navigator.userAgent);
  const previousCapability = canDisplayPhysicalHdr;
  canDisplayPhysicalHdr = hdrScreen && limitSupported;

  elements.hdrStatusButton.classList.toggle("is-sdr", !canDisplayPhysicalHdr);
  elements.truthCard.classList.toggle("is-hdr", canDisplayPhysicalHdr);
  elements.hdrStatusLabel.textContent = canDisplayPhysicalHdr ? "HDR-capable preview" : "SDR glow preview";
  elements.truthTitle.textContent = canDisplayPhysicalHdr ? "HDR-capable path detected" : "This is an honest simulation";
  elements.truthMessage.textContent = canDisplayPhysicalHdr
    ? "The shiny image is being shown without a dynamic-range limit. Selected pixels may rise above the normal-white square, although actual brightness still depends on this screen and its current headroom."
    : isSafari
      ? "This screen is not reporting HDR headroom, so the preview uses an obvious SDR glow. The saved HDR JPEG still contains Rec.2100 PQ data for a compatible display."
      : "This browser or screen is not exposing the full HDR path, so the preview uses an SDR glow. Open the saved HDR JPEG in Safari 26+ on an HDR-capable Apple display for the most reliable physical-brightness test.";
  elements.previewHint.textContent = canDisplayPhysicalHdr
    ? "Look for highlights brighter than the normal-white square. Press Space for the original."
    : "Clearly labelled SDR simulation · the pink Shine map shows exactly which pixels will receive HDR.";

  if (previousCapability !== canDisplayPhysicalHdr && sourceImage.naturalWidth) scheduleRender(0);
}

function setReadyState(status, label) {
  elements.readyDot.classList.toggle("is-ready", status === "ready");
  elements.readyDot.classList.toggle("is-error", status === "error");
  elements.readyLabel.textContent = label;
}

function setPreviewSide(side) {
  elements.compareRange.value = side === "before" ? "100" : "0";
  elements.previewStage.style.setProperty("--compare", `${elements.compareRange.value}%`);
  elements.previewStage.classList.remove("is-comparing");
  elements.showBeforeButton.classList.toggle("is-active", side === "before");
  elements.showAfterButton.classList.toggle("is-active", side === "after");
  updateRangeTrack(elements.compareRange);
}

function currentTargetNits() {
  const minimum = 700;
  const maximum = 6800;
  return minimum + (maximum - minimum) * state.shineAmount ** 1.35;
}

function targetHighlightFraction() {
  return 0.012 + 0.18 * state.shineArea ** 1.38;
}

function spotRadius() {
  return 0.07 + state.shineArea * 0.23;
}

function findAdaptiveHighlightThreshold(pixels, targetFraction) {
  const histogram = new Uint32Array(256);
  const pixelCount = pixels.length / 4;
  const stride = Math.max(1, Math.floor(pixelCount / 120_000));
  let samples = 0;
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += stride) {
    const offset = pixelIndex * 4;
    const red = srgbToLinear(pixels[offset] / 255);
    const green = srgbToLinear(pixels[offset + 1] / 255);
    const blue = srgbToLinear(pixels[offset + 2] / 255);
    const luminance = clamp(linearSrgbLuminance(red, green, blue), 0, 1);
    histogram[Math.round(luminance * 255)] += 1;
    samples += 1;
  }

  const targetBrightSamples = samples * targetFraction;
  let accumulated = 0;
  for (let bucket = 255; bucket >= 0; bucket -= 1) {
    accumulated += histogram[bucket];
    if (accumulated >= targetBrightSamples) {
      return clamp(bucket / 255, 0.012, 0.92);
    }
  }
  return 0.5;
}

function pushPaintHistory() {
  if (!elements.paintCanvas.width || !elements.paintCanvas.height) return;
  const context = elements.paintCanvas.getContext("2d");
  paintHistory.push(context.getImageData(0, 0, elements.paintCanvas.width, elements.paintCanvas.height));
  if (paintHistory.length > 8) paintHistory.shift();
  updatePaintHistoryUi();
}

function clearPaintCanvas() {
  const context = elements.paintCanvas.getContext("2d");
  context.clearRect(0, 0, elements.paintCanvas.width, elements.paintCanvas.height);
  paintHistory = [];
  updatePaintHistoryUi();
}

function updatePaintHistoryUi() {
  elements.undoPaint.disabled = paintHistory.length === 0;
}

function saveSettings() {
  try {
    localStorage.setItem("shinypic:settings", JSON.stringify({
      selection: state.selection,
      shineAmount: state.shineAmount,
      shineArea: state.shineArea,
      shineBloom: state.shineBloom,
      shineColor: state.shineColor,
      shineColorName: state.shineColorName,
      brushMode: state.brushMode,
      brushSize: state.brushSize,
      spotX: state.spotX,
      spotY: state.spotY,
      activeRecipe: state.activeRecipe,
    }));
  } catch {
    // Opaque file:// origins and privacy modes may not expose localStorage.
  }
}

function restoreSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("shinypic:settings") || "null");
    if (!saved || typeof saved !== "object") return;
    if (["lights", "spot"].includes(saved.selection)) state.selection = saved.selection;
    for (const key of ["shineAmount", "shineArea", "shineBloom", "spotX", "spotY"]) {
      if (Number.isFinite(saved[key])) state[key] = clamp(saved[key], 0, 1);
    }
    if (Number.isFinite(saved.brushSize)) state.brushSize = clamp(saved.brushSize, 24, 140);
    if (["add", "erase"].includes(saved.brushMode)) state.brushMode = saved.brushMode;
    if (/^#[0-9a-f]{6}$/i.test(saved.shineColor)) state.shineColor = saved.shineColor.toLowerCase();
    if (typeof saved.shineColorName === "string") state.shineColorName = saved.shineColorName.slice(0, 20);
    if (saved.activeRecipe in RECIPES) state.activeRecipe = saved.activeRecipe;
  } catch {
    // Keep friendly defaults when storage is unavailable or malformed.
  }
}

function showToast(title, message) {
  clearTimeout(toastTimer);
  elements.toastTitle.textContent = title;
  elements.toastMessage.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = setTimeout(hideToast, 4400);
}

function hideToast() {
  elements.toast.classList.remove("is-visible");
}

function updateRangeTrack(input) {
  const amount = ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
  input.style.setProperty("--fill", `${amount}%`);
}

function fitDimensions(width, height, maxEdge, maxPixels = Number.POSITIVE_INFINITY) {
  let scale = Math.min(1, maxEdge / Math.max(width, height));
  const scaledPixels = width * height * scale * scale;
  if (scaledPixels > maxPixels) scale *= Math.sqrt(maxPixels / scaledPixels);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return [255, 255, 255];
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The browser could not encode this image."));
    }, type, quality);
  });
}

function exportFileName(kind) {
  const base = state.sourceName.replace(/\.[^.]+$/, "");
  return `${slugify(base) || "shinypic"}-shiny-${kind}.jpg`;
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatSelectionPercent(percent) {
  if (percent < 0.1) return "<0.1%";
  if (percent < 10) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}

function bloomLabel(value) {
  if (value < 0.22) return "Crisp";
  if (value < 0.58) return "Soft";
  return "Dreamy";
}

function isFormField(target) {
  return target instanceof HTMLElement && Boolean(target.closest("input, button, textarea, select, [contenteditable]"));
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 980px)").matches
    || ((navigator.deviceMemory || 8) <= 4 && "ontouchstart" in window);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function registerOfflineWorker() {
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register("./sw.js").catch((error) => {
    console.warn("Offline setup was skipped", error);
  });
}

window.ShinyPic = Object.freeze({
  inspectHdrAsDataUrl: async () => currentExportBlob
    ? bytesToDataUrl(new Uint8Array(await currentExportBlob.arrayBuffer()), "image/jpeg")
    : null,
  getExportInfo: () => preparedExport ? {
    filename: preparedExport.hdrFilename,
    width: preparedExport.width,
    height: preparedExport.height,
    bytes: preparedExport.hdrBlob.size,
  } : null,
});
