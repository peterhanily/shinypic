/**
 * Small DOM helpers shared by the three games.
 *
 * One rule runs through all of this: nothing that renders HDR may sit inside a
 * transformed, filtered or opacity-altered element. Safari 26.0 to 26.2 fell
 * back to SDR for HDR images inside such containers, and the arcade dies quietly
 * if that happens. Boards therefore hard-cut into place and never animate.
 */

/** Create an element with attributes and children in one call. */
export function el(tag, properties = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(properties)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== null && value !== undefined && value !== false) {
      node.setAttribute(key, value === true ? "" : String(value));
    }
  }
  for (const child of [children].flat()) {
    if (child) node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

/** Numerals get their own class everywhere: this arcade is an instrument. */
export function figure(value) {
  return el("span", { class: "figure", text: value });
}

/** The step-wedge mark: the arcade's one motif, reused at three scales. */
export function stepWedge(steps = 7, className = "wedge") {
  return el(
    "span",
    { class: className, "aria-hidden": "true" },
    Array.from({ length: steps }, (_, index) =>
      el("i", { style: `--step:${(index + 1) / steps}` })),
  );
}

/** Wire a press-and-hold control that also works from the keyboard. */
export function bindHold(element, { onPress, onRelease, key }) {
  let held = false;

  const press = (event) => {
    if (held) return;
    held = true;
    if (event?.cancelable) event.preventDefault();
    onPress();
  };
  const release = () => {
    if (!held) return;
    held = false;
    onRelease();
  };

  element.addEventListener("pointerdown", press);
  element.addEventListener("pointerup", release);
  element.addEventListener("pointercancel", release);
  element.addEventListener("pointerleave", release);
  element.addEventListener("blur", release);
  element.addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter") press(event);
  });
  element.addEventListener("keyup", (event) => {
    if (event.key === " " || event.key === "Enter") release();
  });

  const onKeyDown = (event) => {
    if (event.key.toLowerCase() === key && !event.repeat && !isFormField(event.target)) press(event);
  };
  const onKeyUp = (event) => {
    if (event.key.toLowerCase() === key) release();
  };
  if (key) {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
  }

  return () => {
    release();
    if (key) {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    }
  };
}

export function isFormField(target) {
  return target instanceof HTMLElement
    && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);
}

/** Pixels available to the viewport, used to size every bright surface. */
export function viewportPixels() {
  return Math.max(1, window.innerWidth * window.innerHeight);
}

/**
 * Choose a rectangle of a given aspect ratio that fits an area budget, clamped
 * to sensible on-screen sizes. Every above-white surface in the arcade is sized
 * through here rather than by eye.
 */
export function fitToAreaBudget(areaBudget, aspect, { minWidth = 64, maxWidth = 1200 } = {}) {
  const width = Math.sqrt(Math.max(areaBudget, 1) * aspect);
  const clamped = Math.min(Math.max(width, minWidth), maxWidth);
  return { width: Math.round(clamped), height: Math.round(clamped / aspect) };
}

/** Copy text, preferring the share sheet where the platform offers one. */
export async function shareOrCopy(text) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
