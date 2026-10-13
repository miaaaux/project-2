// Next-period prediction (SPEC §3; design notes 1.2-1.5).
//
// The prediction depends only on the current open cycle's start, the cycle
// history and any confirmed temperature rise, never on `today`: a late period
// must not slide the prediction forward day by day. `today` only decides the
// status ("in range", "N days late") and the user's age band.

import { addDays, compareDates, diffDays, type ISODate } from './date';
import type { Cycle } from './cycles';
import type { ContextPeriod, Settings } from './types';

/** A confirmed temperature rise in a cycle, found by the fertility rules and supplied by the caller. */
export interface RiseInfo {
  cycleIndex: number;
  /** First higher measurement of the rise. */
  fhmDate: ISODate;
}

export type PredictionBasis = 'none' | 'prior' | 'early' | 'calendar' | 'post_rise';
export type PredictionConfidence = 'none' | 'estimate' | 'early' | 'building' | 'established';
export type PredictionStatus = 'upcoming' | 'in_range' | 'late' | 'none';
export type CycleExclusionReason = 'implausible_length' | 'suspected_missed_log' | 'context' | 'open';

export interface ExcludedCycle {
  index: number;
  reason: CycleExclusionReason;
}

export interface Prediction {
  basis: PredictionBasis;
  /** Start of the cycle this prediction is for (the current open cycle), or null without one. */
  cycleStart: ISODate | null;
  center: ISODate | null;
  /** Earliest likely start. Reminders anchor here. */
  lo: ISODate | null;
  /** Latest likely start. */
  hi: ISODate | null;
  /** How much cycle history backs the calendar prediction; a temperature rise does not change it. */
  confidence: PredictionConfidence;
  /** null until 3 eligible cycles exist. */
  regular: boolean | null;
  /** The cycle lengths the calendar prediction used, oldest first (at most 6). */
  eligibleLengths: number[];
  excludedCycles: ExcludedCycle[];
  /** Cycles of at least 1.5x the usual length that the user has not confirmed: "Did you miss logging a period?" */
  askAboutCycles: number[];
  /**
   * Unconfirmed cycles of about 2x or 3x the usual length, whatever their length: a cycle over 90 days is
   * listed here too, although `excludedCycles` gives it as 'implausible_length'.
   */
  suspectedMissedLogCycles: number[];
  /** The onboarding answer, or 28 when the user gave none (or an unusable one). */
  priorLength: number;
  priorFromUser: boolean;
  status: PredictionStatus;
  /** Days after `hi` when status is 'late', otherwise 0. */
  lateByDays: number;
}

export interface PredictionInput {
  cycles: Cycle[];
  contexts: ContextPeriod[];
  settings: Settings;
  rises: RiseInfo[];
  /** Cycles the user said were real despite looking like a missed log. */
  confirmedRealCycles?: number[];
  today: ISODate;
}

const WINDOW = 6;
const DEFAULT_CYCLE_LENGTH = 28;
export const MIN_PLAUSIBLE_LENGTH = 15;
export const MAX_PLAUSIBLE_LENGTH = 90;
/** A cycle at least this many times the usual length prompts "Did you miss logging a period?". */
const ASK_FACTOR = 1.5;
const MIN_SPREAD = 2;
const EARLY_MIN_SPREAD = 4;
const PRIOR_RANGE = { before: 4, after: 7 };
const POST_RISE_DEFAULT = { center: 12, lo: 10, hi: 16 };
const MIN_PERSONAL_RISES = 3;

// ------------------------------------------------------------- helpers

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function spreadOf(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

function isPlausibleLength(length: number): boolean {
  return length >= MIN_PLAUSIBLE_LENGTH && length <= MAX_PLAUSIBLE_LENGTH;
}

function isCompleted(c: Cycle): c is Cycle & { end: ISODate; length: number } {
  return c.end !== null && c.length !== null;
}

/** Context periods are inclusive and open-ended without an `end`. */
export function overlapsContext(cycle: Cycle, contexts: ContextPeriod[]): boolean {
  return contexts.some(
    (ctx) =>
      (cycle.end === null || compareDates(ctx.start, cycle.end) <= 0) &&
      (ctx.end === undefined || compareDates(ctx.end, cycle.start) >= 0),
  );
}

/** The onboarding answer ("usually about X days") if it is a usable cycle length, else 28. */
export function priorCycleLength(settings: Settings): { length: number; fromUser: boolean } {
  const given = settings.typicalCycleLength;
  if (given !== undefined && Number.isFinite(given) && isPlausibleLength(Math.round(given))) {
    return { length: Math.round(given), fromUser: true };
  }
  return { length: DEFAULT_CYCLE_LENGTH, fromUser: false };
}

/**
 * Largest shortest-to-longest spread that still counts as regular (FIGO 2018):
 * 7 days for ages 26-41, otherwise 9. The age is the calendar-year difference,
 * since only the birth year is known; an unknown birth year gets the wider limit.
 */
export function regularityLimit(birthYear: number | undefined, today: ISODate): number {
  if (birthYear === undefined) return 9;
  const age = Number(today.slice(0, 4)) - birthYear;
  return age >= 26 && age <= 41 ? 7 : 9;
}

export function isSuspectedMissedLog(length: number, usualLength: number): boolean {
  return [2, 3].some((k) => Math.abs(length - k * usualLength) <= Math.max(5, 0.15 * k * usualLength));
}

/** Median of the (up to 6) nearest usable cycles other than `cycle`, or the prior with fewer than 2. */
function referenceLength(cycle: Cycle, usable: (Cycle & { length: number })[], prior: number): number {
  const ref = usable
    .filter((c) => c.index !== cycle.index)
    .sort((a, b) => Math.abs(a.index - cycle.index) - Math.abs(b.index - cycle.index) || b.index - a.index)
    .slice(0, WINDOW)
    .map((c) => c.length);
  return ref.length >= 2 ? median(ref) : prior;
}

// ------------------------------------------------------- eligibility

export interface CycleClassification {
  excluded: ExcludedCycle[];
  askAbout: number[];
  suspectedMissedLogs: number[];
}

/**
 * Which cycles are left out of the statistics and why (design notes 1.2).
 * Real long or short cycles are kept: they show how variable this user is.
 */
export function classifyCycles(
  cycles: Cycle[],
  contexts: ContextPeriod[],
  priorLength: number,
  confirmedRealCycles: number[] = [],
): CycleClassification {
  const confirmed = new Set(confirmedRealCycles);
  const sorted = [...cycles].sort((a, b) => a.index - b.index);
  const usable = sorted.filter(isCompleted).filter((c) => isPlausibleLength(c.length) && !overlapsContext(c, contexts));
  const excluded: ExcludedCycle[] = [];
  const askAbout: number[] = [];
  const suspectedMissedLogs: number[] = [];

  for (const c of sorted) {
    if (!isCompleted(c)) {
      excluded.push({ index: c.index, reason: 'open' });
      continue;
    }
    // Never ask "did you miss a period?" about a cycle the user marked as pill, pregnancy, etc.
    if (overlapsContext(c, contexts)) {
      excluded.push({ index: c.index, reason: 'context' });
      continue;
    }
    const usual = referenceLength(c, usable, priorLength);
    const unconfirmedLong = c.length >= ASK_FACTOR * usual && !confirmed.has(c.index);
    const suspected = unconfirmedLong && isSuspectedMissedLog(c.length, usual);
    if (unconfirmedLong) askAbout.push(c.index);
    if (suspected) suspectedMissedLogs.push(c.index);
    if (!isPlausibleLength(c.length)) {
      excluded.push({ index: c.index, reason: 'implausible_length' });
    } else if (suspected) {
      excluded.push({ index: c.index, reason: 'suspected_missed_log' });
    }
  }
  return { excluded, askAbout, suspectedMissedLogs };
}

/** Completed cycles that are not excluded, oldest first. */
function eligibleCycles(cycles: Cycle[], excluded: ExcludedCycle[]): (Cycle & { end: ISODate; length: number })[] {
  const out = new Set(excluded.map((e) => e.index));
  return cycles
    .filter(isCompleted)
    .filter((c) => !out.has(c.index))
    .sort((a, b) => a.index - b.index);
}

// ------------------------------------------------------------ ranges

/** Day offsets from a reference date. */
interface Offsets {
  center: number;
  lo: number;
  hi: number;
}

/** Offsets from the cycle start, from eligible cycle lengths and the prior (design notes 1.3). */
export function calendarOffsets(lengths: number[], prior: number): Offsets & { confidence: PredictionConfidence } {
  const n = lengths.length;
  let result: Offsets & { confidence: PredictionConfidence };
  if (n === 0) {
    result = { center: prior, lo: prior - PRIOR_RANGE.before, hi: prior + PRIOR_RANGE.after, confidence: 'estimate' };
  } else if (n <= 2) {
    // Shrink the centre toward the prior: one or two cycles say little on their own. The range
    // still covers the user's own cycles, or a period exactly as long as last time would be "late".
    const center = Math.round(mean([...lengths, prior]));
    const spread = Math.max(EARLY_MIN_SPREAD, spreadOf(lengths));
    result = {
      center,
      lo: Math.min(Math.min(...lengths), center - spread),
      hi: Math.max(Math.max(...lengths), center + spread),
      confidence: 'early',
    };
  } else {
    const center = Math.round(median(lengths));
    result = {
      center,
      lo: Math.min(Math.min(...lengths), center - MIN_SPREAD),
      hi: Math.max(Math.max(...lengths), center + MIN_SPREAD),
      confidence: n < WINDOW ? 'building' : 'established',
    };
  }
  // A wide early range could otherwise reach back into the current period.
  return { ...result, lo: Math.max(result.lo, MIN_PLAUSIBLE_LENGTH) };
}

/** Earliest first higher measurement of a rise inside `cycle`; rises dated outside it are ignored. */
function riseIn(cycle: Cycle, rises: RiseInfo[]): ISODate | undefined {
  return rises
    .filter((r) => r.cycleIndex === cycle.index)
    .map((r) => r.fhmDate)
    .filter((d) => compareDates(d, cycle.start) >= 0 && (cycle.end === null || compareDates(d, cycle.end) <= 0))
    .sort(compareDates)[0];
}

/** Days from the first higher measurement to the next period, for each given completed cycle that had a rise. */
export function postRiseIntervals(cycles: (Cycle & { length: number })[], rises: RiseInfo[]): number[] {
  return cycles.flatMap((c) => {
    const fhm = riseIn(c, rises);
    return fhm === undefined ? [] : [c.length - diffDays(fhm, c.start)];
  });
}

/** Offsets from the first higher measurement (SPEC §3: personal median, else 12 with 10-16). */
export function postRiseOffsets(intervals: number[]): Offsets {
  if (intervals.length < MIN_PERSONAL_RISES) return { ...POST_RISE_DEFAULT };
  return {
    center: Math.round(median(intervals)),
    lo: Math.min(...intervals) - 1,
    hi: Math.max(...intervals) + 1,
  };
}

function statusOn(today: ISODate, lo: ISODate, hi: ISODate): { status: PredictionStatus; lateByDays: number } {
  const late = diffDays(today, hi);
  if (late > 0) return { status: 'late', lateByDays: late };
  return { status: compareDates(today, lo) >= 0 ? 'in_range' : 'upcoming', lateByDays: 0 };
}

// --------------------------------------------------------- prediction

export function predictNextPeriod(input: PredictionInput): Prediction {
  const { cycles, contexts, settings, rises, confirmedRealCycles = [], today } = input;
  const prior = priorCycleLength(settings);
  const { excluded, askAbout, suspectedMissedLogs } = classifyCycles(cycles, contexts, prior.length, confirmedRealCycles);
  const eligible = eligibleCycles(cycles, excluded);
  const lengths = eligible.slice(-WINDOW).map((c) => c.length);
  const current = cycles.find((c) => c.end === null);

  const common = {
    eligibleLengths: lengths,
    excludedCycles: excluded,
    askAboutCycles: askAbout,
    suspectedMissedLogCycles: suspectedMissedLogs,
    priorLength: prior.length,
    priorFromUser: prior.fromUser,
  };
  if (!current) {
    return {
      ...common,
      basis: 'none',
      cycleStart: null,
      center: null,
      lo: null,
      hi: null,
      confidence: 'none',
      regular: null,
      status: 'none',
      lateByDays: 0,
    };
  }

  const calendar = calendarOffsets(lengths, prior.length);
  const regular = lengths.length >= 3 ? spreadOf(lengths) <= regularityLimit(settings.birthYear, today) : null;
  const fhm = riseIn(current, rises);

  let basis: PredictionBasis;
  let anchor: ISODate;
  let offsets: Offsets;
  if (fhm !== undefined) {
    // The phase after ovulation varies less than the cycle as a whole.
    basis = 'post_rise';
    anchor = fhm;
    offsets = postRiseOffsets(postRiseIntervals(eligible, rises).slice(-WINDOW));
  } else {
    basis = lengths.length === 0 ? 'prior' : lengths.length <= 2 ? 'early' : 'calendar';
    anchor = current.start;
    offsets = calendar;
  }

  const lo = addDays(anchor, offsets.lo);
  const hi = addDays(anchor, offsets.hi);
  return {
    ...common,
    basis,
    cycleStart: current.start,
    center: addDays(anchor, offsets.center),
    lo,
    hi,
    confidence: calendar.confidence,
    regular,
    ...statusOn(today, lo, hi),
  };
}

// ------------------------------------------------------------ accuracy
//
// SPEC §3: store a snapshot of each prediction and compare it with the actual
// start. The snapshots themselves are stored by the data layer; these helpers
// say what to store and how to score it once the next period is confirmed.

/** What a prediction said about the next period start. */
export interface PredictionSnapshot {
  cycleStart: ISODate;
  basis: PredictionBasis;
  center: ISODate;
  lo: ISODate;
  hi: ISODate;
}

export interface PredictionScore {
  cycleStart: ISODate;
  basis: PredictionBasis;
  /** The confirmed start of the next period. */
  actualStart: ISODate;
  /** actualStart - center in days: positive when the period came later than predicted. */
  errorDays: number;
  inRange: boolean;
}

/** The snapshot to store for a prediction, or null when there is nothing to predict. */
export function predictionSnapshot(p: Prediction): PredictionSnapshot | null {
  if (p.cycleStart === null || p.center === null || p.lo === null || p.hi === null) return null;
  return { cycleStart: p.cycleStart, basis: p.basis, center: p.center, lo: p.lo, hi: p.hi };
}

/**
 * Scores each snapshot whose cycle has closed. Snapshots for the open cycle, or
 * for a start the user has since removed, are skipped.
 */
export function scorePredictions(snapshots: PredictionSnapshot[], cycles: Cycle[]): PredictionScore[] {
  return snapshots.flatMap((s) => {
    const cycle = cycles.find((c) => c.start === s.cycleStart);
    if (!cycle || cycle.end === null) return [];
    const actualStart = addDays(cycle.end, 1);
    return [
      {
        cycleStart: s.cycleStart,
        basis: s.basis,
        actualStart,
        errorDays: diffDays(actualStart, s.center),
        inRange: compareDates(actualStart, s.lo) >= 0 && compareDates(actualStart, s.hi) <= 0,
      },
    ];
  });
}

// ------------------------------------------------------ fertile window

export const DEFAULT_LUTEAL_RANGE: [number, number] = [11, 15];
const FERTILE_DAYS_BEFORE_OVULATION = 5;
const FERTILE_DAYS_AFTER_OVULATION = 1;

/**
 * Calendar-only fertile window for the predicted cycle (design notes 4.2). It is
 * informational and wide on purpose; body signs override it, and it never
 * makes a day infertile.
 *
 * In cycle days, ovulation falls on L - luteal, where L is the cycle length:
 * earliest = lo - lutealMax, latest = hi - lutealMin, window = [earliest - 5, latest + 1].
 * Example: lo 26, hi 30 with luteal 11-15 gives cycle days 6-20.
 */
export function calendarFertileWindow(
  prediction: Prediction,
  currentCycle: Cycle | undefined,
  lutealRange: [number, number] = DEFAULT_LUTEAL_RANGE,
): { start: ISODate; end: ISODate } | null {
  if (!currentCycle || prediction.lo === null || prediction.hi === null) return null;
  if (prediction.cycleStart !== currentCycle.start) return null;
  const lutealMin = Math.min(...lutealRange);
  const lutealMax = Math.max(...lutealRange);
  const shortest = diffDays(prediction.lo, currentCycle.start);
  const longest = diffDays(prediction.hi, currentCycle.start);
  const firstDay = Math.max(1, shortest - lutealMax - FERTILE_DAYS_BEFORE_OVULATION);
  const lastDay = longest - lutealMin + FERTILE_DAYS_AFTER_OVULATION;
  if (lastDay < firstDay) return null;
  return { start: addDays(currentCycle.start, firstDay - 1), end: addDays(currentCycle.start, lastDay - 1) };
}
