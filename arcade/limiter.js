/**
 * Rate-limits every luminance transition the arcade is capable of making.
 *
 * This is safety code, so it is pure and clock-injected: the tests drive it with
 * a fake timeline rather than hoping about real ones.
 *
 * Why it has to exist. WCAG 2.3.1 and ITU-R BT.1702 cap flashing at three per
 * second, but their luminance model normalises 1.0 to CSS white on an implicit
 * ~200-nit screen, so brighter-than-white has no representation in it at all and
 * every automated checker passes content that swings a thousand nits. PEAT is
 * licence-prohibited for gaming content and does not model HDR either. No tool
 * can check this page, so the limits are enforced in code and stated in the
 * interface.
 *
 * The Squint is the only luminance transition in the arcade. At one transition
 * per 1.6 s it runs at ~0.6 Hz against a 3 Hz limit, over an area budget well
 * inside WCAG's small-safe-area exemption.
 */

export const MIN_TRANSITION_INTERVAL_MS = 1600;

/**
 * Above-white content is capped at 1% of the viewport. Liu & Wei (JOSA A 43(8),
 * 2026) measure ~1% as the coverage at which 1,000 cd/m² highlights start
 * raising the observer's adapted luminance and stop reading as highlights, so
 * the perceptual budget and the safety budget happen to agree.
 */
export const MAX_BRIGHT_AREA_FRACTION = 0.01;

/**
 * Create a governor for a two-state luminance control.
 * `request` never applies a transition early; it reports how long to wait and
 * remembers the target so the caller can settle it later.
 */
export function createLuminanceGovernor({
  initialState = "no-limit",
  minIntervalMs = MIN_TRANSITION_INTERVAL_MS,
  now = 0,
} = {}) {
  let applied = initialState;
  let pending = initialState;
  let lastTransitionAt = now - minIntervalMs;
  let transitions = 0;

  function settle(currentTime) {
    if (pending === applied) {
      return { applied, changed: false, retryInMs: 0 };
    }

    const elapsed = currentTime - lastTransitionAt;
    if (elapsed < minIntervalMs) {
      return { applied, changed: false, retryInMs: minIntervalMs - elapsed };
    }

    applied = pending;
    lastTransitionAt = currentTime;
    transitions += 1;
    return { applied, changed: true, retryInMs: 0 };
  }

  return {
    /** Ask for a state. Returns what is actually applied right now. */
    request(state, currentTime) {
      if (state !== "no-limit" && state !== "standard") {
        throw new RangeError('state must be "no-limit" or "standard"');
      }
      pending = state;
      return settle(currentTime);
    },
    /** Re-check a deferred request once its wait has elapsed. */
    settle,
    get state() {
      return applied;
    },
    get target() {
      return pending;
    },
    get transitionCount() {
      return transitions;
    },
    /** Transitions per second across the run, for the honesty panel. */
    rateHz(currentTime, startedAt) {
      const seconds = Math.max((currentTime - startedAt) / 1000, 1e-6);
      return transitions / seconds;
    },
  };
}

/** Is the above-white area inside the arcade's coverage budget? */
export function isAreaWithinBudget(brightPixels, viewportPixels, maxFraction = MAX_BRIGHT_AREA_FRACTION) {
  if (!(viewportPixels > 0)) return false;
  return brightPixels / viewportPixels <= maxFraction;
}

/**
 * Largest total above-white area a board may use, in pixels, for a viewport.
 * Games size their objects against this rather than guessing.
 */
export function brightAreaBudget(viewportPixels, maxFraction = MAX_BRIGHT_AREA_FRACTION) {
  return Math.floor(Math.max(0, viewportPixels) * maxFraction);
}
