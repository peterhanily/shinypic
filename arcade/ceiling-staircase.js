/**
 * Service Ceiling: an adaptive staircase that finds where your display stops.
 *
 * Two patches, one a fixed number of PQ code values brighter than the other.
 * While the display can still deliver the difference you get it right; once it
 * has run out of headroom both patches render at the same output and you are
 * guessing. A 2-down-1-up staircase walks the pair upward until you start
 * guessing, then brackets the boundary.
 *
 * Two correct answers step up, one wrong answer steps down. That rule converges
 * on the level where a listener is right about 70.7% of the time (Levitt 1971),
 * the standard transformed up-down procedure, not an invention of this project.
 */

export const DEFAULT_DELTA_CODES = 6;

/**
 * The staircase starts at code 130, about 100 nits, comfortably below diffuse
 * white, so the first trials are answerable on any display. Starting above white
 * would put an SDR visitor at chance from trial one, and a coin-flipping
 * staircase still converges on a number. That would be a fabricated measurement
 * rather than a missing one.
 */
export const DEFAULT_START_CODE = 130;

/** Code 100 is about 30 nits; 249 leaves room for the brighter patch at 255. */
export const MIN_CODE = 100;
export const MAX_CODE = 249;

/**
 * Trials whose brighter patch still sits below diffuse white (code 148) need no
 * headroom from any display. They are the arcade's built-in catch trials.
 */
export const EASY_CEILING_CODE = 145;

/** Step size shrinks as the staircase brackets the boundary. */
export const STEP_SCHEDULE = Object.freeze([10, 10, 4, 4, 2]);

export const MAX_TRIALS = 45;
export const TARGET_REVERSALS = 8;

/** Reversals to average for the final estimate. Always an even number. */
export const SCORING_REVERSALS = 6;

/**
 * Create a staircase. Nothing here is random except which side is brighter,
 * which the caller supplies so boards stay reproducible.
 */
export function createStaircase({
  startCode = DEFAULT_START_CODE,
  deltaCodes = DEFAULT_DELTA_CODES,
  minCode = MIN_CODE,
  maxCode = MAX_CODE,
  maxTrials = MAX_TRIALS,
  targetReversals = TARGET_REVERSALS,
} = {}) {
  let level = Math.min(Math.max(startCode, minCode), maxCode);
  let consecutiveCorrect = 0;
  let direction = 0; // +1 climbing, -1 descending
  let trials = 0;
  const reversalLevels = [];
  const history = [];

  const stepSize = () => STEP_SCHEDULE[Math.min(reversalLevels.length, STEP_SCHEDULE.length - 1)];
  const finished = () => trials >= maxTrials || reversalLevels.length >= targetReversals;

  function move(nextDirection) {
    if (direction !== 0 && nextDirection !== direction) {
      reversalLevels.push(level);
    }
    direction = nextDirection;
    level = Math.min(Math.max(level + nextDirection * stepSize(), minCode), maxCode);
  }

  return {
    /** The pair to show next: a dim patch and a bright one, in code values. */
    get trial() {
      return { dimCode: level, brightCode: Math.min(level + deltaCodes, 255), index: trials + 1 };
    },
    get trialsTaken() {
      return trials;
    },
    get reversals() {
      return reversalLevels.length;
    },
    get done() {
      return finished();
    },
    /** Progress toward the stopping rule, for a progress bar. */
    get progress() {
      return Math.max(reversalLevels.length / targetReversals, trials / maxTrials);
    },

    /** Record one answer and advance. */
    respond(correct) {
      if (finished()) return { done: true };
      trials += 1;
      history.push({ level, correct });

      if (correct) {
        consecutiveCorrect += 1;
        if (consecutiveCorrect >= 2) {
          consecutiveCorrect = 0;
          move(+1);
        }
      } else {
        consecutiveCorrect = 0;
        move(-1);
      }
      return { done: finished(), level, reversals: reversalLevels.length };
    },

    /**
     * The estimate. Averaging the last even number of reversals is the standard
     * way to read a transformed-up-down staircase; fewer than two reversals is
     * reported as unconverged rather than dressed up as a measurement.
     */
    result() {
      const usable = reversalLevels.slice(-SCORING_REVERSALS);
      const even = usable.length - (usable.length % 2);
      const scored = usable.slice(usable.length - even);
      const thresholdCode = scored.length >= 2
        ? scored.reduce((total, value) => total + value, 0) / scored.length
        : level;

      // A coin-flipper produces reversals and an average like anyone else, and
      // over ~30 trials their observed accuracy is too noisy to separate from a
      // real observer's. What does separate them is the EASY trials: while both
      // patches sit below diffuse white no headroom is needed, so anyone
      // attending gets those nearly all right. Chance performance down there
      // means the answers carry no information, and no threshold is reported.
      const correct = history.filter((trial) => trial.correct).length;
      const proportionCorrect = trials > 0 ? correct / trials : 0;
      const easy = history.filter((trial) => trial.level + deltaCodes <= EASY_CEILING_CODE);
      const easyCorrect = easy.filter((trial) => trial.correct).length;
      const easyAccuracy = easy.length > 0 ? easyCorrect / easy.length : null;
      const looksLikeGuessing = easy.length >= 4 && easyAccuracy < 0.75;

      return {
        thresholdCode,
        converged: scored.length >= 2 && !looksLikeGuessing,
        looksLikeGuessing,
        proportionCorrect,
        easyAccuracy,
        easyTrials: easy.length,
        reversals: reversalLevels.length,
        trials,
        history,
        // A staircase pinned at the top never found a boundary: this display had
        // more headroom than the test could ask for.
        railedHigh: scored.length >= 2 && thresholdCode >= maxCode - 1,
      };
    },
  };
}

/**
 * Turn a threshold into advice for the editor.
 *
 * ShinyPic's Brightness slider spans 700-6,800 nits. Anything the display cannot
 * deliver is slider travel that does nothing, so the honest thing is to say
 * where the useful part ends.
 */
export function sliderAdvice(ceilingNits) {
  const sliderFloor = 700;
  const sliderCeiling = 6800;
  if (!Number.isFinite(ceilingNits) || ceilingNits <= sliderFloor) {
    return {
      usableFraction: 0,
      message: "Your measured ceiling sits at or below the bottom of the editor's Brightness slider. On this display the slider's position barely matters. What changes the look is the size of the selection, not the nit target.",
    };
  }

  const usable = Math.min(1, (ceilingNits - sliderFloor) / (sliderCeiling - sliderFloor));
  // The slider is not linear in nits: it maps amount^1.35 across the range.
  const sliderPosition = usable ** (1 / 1.35);
  return {
    usableFraction: usable,
    sliderPosition,
    message: `Above roughly ${Math.round(ceilingNits).toLocaleString("en-US")} nits this display stopped resolving a difference, so the top ${Math.round((1 - sliderPosition) * 100)}% of the editor's Brightness slider is asking for light it cannot show.`,
  };
}
