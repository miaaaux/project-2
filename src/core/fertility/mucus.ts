// Cervical mucus quality Q and the mucus peak (sections 4 and 7, amendments A2, A3.1, A10, A14).
//
// Q: 0 = t (dry), 1 = Ø (nothing), 2 = f (moist), 3 = S, 4 = S+, null = UNKNOWN.

import type {
  MucusAppearance,
  MucusColor,
  MucusObservation,
  MucusSensation,
  NotAssessableReason,
} from '../types';

/** "This input says nothing about quality" in the maps below (A2). */
export const NO_CONTRIBUTION = -1;
export const MIN_FERTILE_SIGN_Q = 2;
/** Section 7: a peak needs at least S. */
export const MIN_PEAK_Q = 3;
const MAX_Q = 4;
/** Section 7: the peak is followed by 3 complete days of lower quality. */
export const POST_PEAK_DAYS = 3;

/** Section 4: "wet" is rated upwards to S+ [App]. */
export const SENSATION_QUALITY: Record<MucusSensation, number> = {
  dry: 0,
  nothing: 1,
  moist: 2,
  wet: 4,
  slippery: 4,
};

export const APPEARANCE_QUALITY: Record<MucusAppearance, number> = {
  nothing: NO_CONTRIBUTION,
  sticky: 3,
  creamy: 3,
  watery: 4,
  egg_white: 4,
};

/** Seeing any coloured mucus means mucus was seen: at least S; clear counts as S+. */
export const COLOR_QUALITY: Record<MucusColor, number> = {
  none: NO_CONTRIBUTION,
  white: 3,
  cream: 3,
  yellowish: 3,
  cloudy: 3,
  clear: 4,
  blood_tinged: NO_CONTRIBUTION,
  green_grey: NO_CONTRIBUTION,
};

/** Colours that mean the mucus cannot be judged (blood, possible infection): a low Q becomes UNKNOWN. */
export const COLOR_HIDES_MUCUS: Record<MucusColor, boolean> = {
  none: false,
  white: false,
  cream: false,
  yellowish: false,
  cloudy: false,
  clear: false,
  blood_tinged: true,
  green_grey: true,
};

const NOT_ASSESSABLE: Record<NotAssessableReason, true> = {
  bleeding: true,
  possible_infection: true,
  vaginal_medication: true,
  semen: true,
  lubricant: true,
};

export interface MucusAssessment {
  logged: boolean;
  /** Q per section 4 with A2, A10 and A14; null is UNKNOWN (or not logged). */
  quality: number | null;
  /** observationComplete, completed in the evening (A10). */
  complete: boolean;
  /** Saved after 12:00 on the next day (A10). */
  recalled: boolean;
  unsure: boolean;
  /** The user marked it "not assessable (bleeding)" and nothing else was unreadable. */
  notAssessableBleeding: boolean;
  /** Usable as a known, lower day when placing the peak (A10, A14). */
  knownForPeak: boolean;
}

export const NOT_LOGGED: MucusAssessment = {
  logged: false,
  quality: null,
  complete: false,
  recalled: false,
  unsure: false,
  notAssessableBleeding: false,
  knownForPeak: false,
};

interface Contribution {
  q: number;
  missing: boolean;
  unmapped: boolean;
}

function contribution<K extends string>(map: Record<K, number>, value: unknown): Contribution {
  if (value === undefined || value === null) return { q: NO_CONTRIBUTION, missing: true, unmapped: false };
  if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(map, value)) {
    return { q: map[value as K], missing: false, unmapped: false };
  }
  return { q: NO_CONTRIBUTION, missing: false, unmapped: true };
}

function stretchyContribution(value: unknown): Contribution {
  if (value === undefined || value === null || value === false) return { q: NO_CONTRIBUTION, missing: false, unmapped: false };
  if (value === true) return { q: MAX_Q, missing: false, unmapped: false };
  return { q: NO_CONTRIBUTION, missing: false, unmapped: true };
}

function isQuality(q: number): boolean {
  return Number.isInteger(q) && q >= 0 && q <= MAX_Q;
}

/**
 * Section 4 + A2 + A10 + A14. `complete` and `recalled` come from the entry's
 * timestamps (see evaluate.ts). A fertile sign (Q >= 2) always counts; a low Q
 * counts only from a full, final, on-time, assessable entry.
 */
export function assessMucus(
  obs: MucusObservation | undefined,
  timing: { complete: boolean; recalled: boolean },
): MucusAssessment {
  if (obs === undefined || obs === null || typeof obs !== 'object') return NOT_LOGGED;

  const sensation = contribution(SENSATION_QUALITY, obs.sensation);
  const appearance = contribution(APPEARANCE_QUALITY, obs.appearance);
  const color = contribution(COLOR_QUALITY, obs.color);
  const stretchy = stretchyContribution(obs.stretchy);
  // A non-boolean "unsure" is treated as unsure: it can only rate the day upwards.
  const unsure = obs.unsure !== undefined && obs.unsure !== false;
  const notAssessable = obs.notAssessable === undefined || obs.notAssessable === null ? null : obs.notAssessable;
  const notAssessableKnown =
    notAssessable !== null && typeof notAssessable === 'string' && Object.prototype.hasOwnProperty.call(NOT_ASSESSABLE, notAssessable);
  const colorHides =
    typeof obs.color === 'string' && Object.prototype.hasOwnProperty.call(COLOR_HIDES_MUCUS, obs.color)
      ? COLOR_HIDES_MUCUS[obs.color as MucusColor]
      : false;
  const unmapped = sensation.unmapped || appearance.unmapped || color.unmapped || stretchy.unmapped;

  let q = Math.max(sensation.q, appearance.q, color.q, stretchy.q);
  if (unsure) q = Math.min(MAX_Q, Math.max(q + 1, MIN_FERTILE_SIGN_Q)); // A14: rate upwards, at least f

  let quality: number | null;
  if (!Number.isFinite(q)) quality = null;
  else if (q >= MIN_FERTILE_SIGN_Q) quality = q;
  else if (
    sensation.missing ||
    appearance.missing ||
    unmapped ||
    notAssessable !== null ||
    colorHides ||
    !timing.complete ||
    timing.recalled
  ) {
    quality = null;
  } else quality = q;
  if (quality !== null && !isQuality(quality)) quality = null; // A2: anything else is UNKNOWN

  return {
    logged: true,
    quality,
    complete: timing.complete,
    recalled: timing.recalled,
    unsure,
    notAssessableBleeding: notAssessableKnown && notAssessable === 'bleeding' && !unmapped && q < MIN_FERTILE_SIGN_Q,
    knownForPeak: quality !== null && timing.complete && !timing.recalled && !unsure,
  };
}

export function hasFertileSign(a: MucusAssessment): boolean {
  return a.quality !== null && a.quality >= MIN_FERTILE_SIGN_Q;
}

function isKnownDry(a: MucusAssessment): boolean {
  return a.knownForPeak && a.quality !== null && a.quality <= 1;
}

/** A10: a complete, known observation of lower quality than `max`. Anything else may have been peak quality. */
export function isKnownLower(a: MucusAssessment, max: number): boolean {
  return a.knownForPeak && a.quality !== null && a.quality < max;
}

export type MucusResult =
  | { status: 'NONE'; maxQuality: number | null }
  | {
      status: 'PENDING' | 'COMPLETE';
      maxQuality: number;
      patchStart: number;
      /** Last day with Q == M (display). */
      peakDay: number;
      /** p: last day that is UNKNOWN or >= M. */
      effectivePeakDay: number;
      /** p + 3 when COMPLETE. */
      completeDay: number | null;
    };

/** `days[d - 1]` is cycle day d. */
type MucusDays = readonly MucusAssessment[];

function maxKnownQuality(days: MucusDays, from: number, to: number): number | null {
  let max: number | null = null;
  for (let d = from; d <= to; d++) {
    const q = days[d - 1]?.quality ?? null;
    if (q !== null && (max === null || q > max)) max = q;
  }
  return max;
}

/**
 * A3.1 patch reset: once a fertile patch is followed by a known, complete dry
 * day, a later fertile sign starts a new patch and the old peak is discarded.
 */
export function latestPatchStart(days: MucusDays, E: number): number | null {
  let start: number | null = null;
  let dryAfterPatch = false;
  for (let d = 1; d <= E; d++) {
    const a = days[d - 1] ?? NOT_LOGGED;
    if (hasFertileSign(a)) {
      if (start === null || dryAfterPatch) {
        start = d;
        dryAfterPatch = false;
      }
    } else if (start !== null && isKnownDry(a)) {
      dryAfterPatch = true;
    }
  }
  return start;
}

/** Section 7 (with A2, A3.1, A10): the mucus peak and P+3 as known on cycle day E. */
export function evalMucus(days: MucusDays, E: number): MucusResult {
  const patchStart = latestPatchStart(days, E);
  if (patchStart === null) return { status: 'NONE', maxQuality: maxKnownQuality(days, 1, E) };

  const M = maxKnownQuality(days, patchStart, E);
  if (M === null || !Number.isFinite(M) || M < MIN_PEAK_Q) return { status: 'NONE', maxQuality: M };

  let effectivePeakDay = patchStart;
  let peakDay = patchStart;
  for (let d = patchStart; d <= E; d++) {
    const a = days[d - 1] ?? NOT_LOGGED;
    if (!isKnownLower(a, M)) effectivePeakDay = d;
    if (a.quality === M) peakDay = d;
  }
  const completeDay = effectivePeakDay + POST_PEAK_DAYS;
  return completeDay <= E
    ? { status: 'COMPLETE', maxQuality: M, patchStart, peakDay, effectivePeakDay, completeDay }
    : { status: 'PENDING', maxQuality: M, patchStart, peakDay, effectivePeakDay, completeDay: null };
}
