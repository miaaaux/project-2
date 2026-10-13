// Basal temperature: reading classes, blocks and the temperature rise
// (sections 1, 5, 6 and amendments A5-A9).
//
// Every comparison is between integers in hundredths of the unit the reading
// was entered in. Nothing is converted between units, rounded or compared with
// a floating-point threshold (the LENIENT history grid is integer rounding).

import { addDays, compareDates, type ISODate } from '../date';
import type { DailyLog, Settings, TempRoute, TempUnit, TemperatureReading } from '../types';
import type { FertilityReason, ReadingKind, TemperatureRule } from './model';
import { clockMinutes, isRecalled, validOffset } from './time';

/** "Higher than the coverline": at least 0.05 °C / 0.09 °F above it (section 1). */
export const ABOVE: Record<TempUnit, number> = { C: 5, F: 9 };
/** The 0.2 rule: 0.20 °C / 0.36 °F (section 1, A8). */
export const RISE: Record<TempUnit, number> = { C: 20, F: 36 };
/** Plausible input range (section 1). Above the maximum counts as fever (A8). */
const PLAUSIBLE: Record<TempUnit, { min: number; max: number }> = {
  C: { min: 3500, max: 3850 },
  F: { min: 9500, max: 10130 },
};
/** LENIENT rounding grid (section 6, A8): 0.05 °C, or 3200 + 9k hundredths of °F. */
const LENIENT_GRID: Record<TempUnit, { base: number; step: number }> = {
  C: { base: 0, step: 5 },
  F: { base: 3200, step: 9 },
};
const ROUTES: Record<TempRoute, true> = { oral: true, vaginal: true, rectal: true };

function isRoute(r: unknown): r is TempRoute {
  return typeof r === 'string' && Object.prototype.hasOwnProperty.call(ROUTES, r);
}

export const LOWS_NEEDED = 6;
export const MAX_LOW_GAPS = 2;
export const FIRST_CANDIDATE_DAY = 7;
const OFF_TIME_MINUTES = 60;
const SHORT_SLEEP_HOURS = 3;
/** A6: readings on the day the UTC offset changed and the 2 days after it. */
const OFFSET_CHANGE_MINUTES = 60;
const OFFSET_CHANGE_SUSPECT_DAYS = 3;

export interface DayTemp {
  kind: ReadingKind;
  /** Coverline value: the maximum non-excluded reading (A7). For an EXCLUDED day, the reading for display. */
  value: number | null;
  /** Measurement time (minutes after midnight) of a single reading. */
  minutes: number | null;
  unit: TempUnit | null;
  route: TempRoute | null;
  thermometerId: string | null;
}

export const NO_READING: DayTemp = {
  kind: 'MISSING',
  value: null,
  minutes: null,
  unit: null,
  route: null,
  thermometerId: null,
};

export function readingsOf(log: DailyLog | undefined): TemperatureReading[] {
  return log && Array.isArray(log.temperatures) ? log.temperatures : [];
}

function isUnit(u: unknown): u is TempUnit {
  return u === 'C' || u === 'F';
}

function hasIntegerValue(r: TemperatureReading): boolean {
  return Number.isInteger(r.value);
}

/** A8: readings above the plausible maximum are treated as excluded (fever). */
function isFever(r: TemperatureReading): boolean {
  return isUnit(r.unit) && hasIntegerValue(r) && r.value > PLAUSIBLE[r.unit].max;
}

function isExcludedReading(r: TemperatureReading): boolean {
  return (r.excluded !== undefined && r.excluded !== null) || isFever(r);
}

// --------------------------------------------------------------- A5: usual time

/** A5: the usual measurement time in effect on `date` (effective-dated, never retroactive), or null. */
export function usualMinutesOn(settings: Settings, date: ISODate): number | null {
  const entries = Array.isArray(settings.usualMeasurementTimes) ? settings.usualMeasurementTimes : [];
  let best: { effectiveFrom: ISODate; minutes: number | null } | null = null;
  for (const e of entries) {
    if (!e || typeof e.effectiveFrom !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.effectiveFrom)) continue;
    let cmp: number;
    try {
      cmp = compareDates(e.effectiveFrom, date);
    } catch {
      continue;
    }
    if (cmp > 0) continue;
    if (best === null || compareDates(e.effectiveFrom, best.effectiveFrom) >= 0) {
      best = { effectiveFrom: e.effectiveFrom, minutes: clockMinutes(e.time) };
    }
  }
  return best ? best.minutes : null;
}

// ------------------------------------------------------------ A6: time zones

/**
 * A6: dates whose readings are SUSPECT because the device UTC offset changed by
 * at least 60 minutes since the previous reading (that date and the 2 after it).
 */
export function offsetChangeSuspectDates(logs: Record<ISODate, DailyLog>, dates: readonly ISODate[]): Set<ISODate> {
  const out = new Set<ISODate>();
  let previous: number | null = null;
  for (const date of dates) {
    const readings = [...readingsOf(logs[date])].sort((a, b) =>
      String(a.measuredAt).localeCompare(String(b.measuredAt)),
    );
    for (const r of readings) {
      const offset = validOffset(r.utcOffsetMinutes);
      if (offset === null) continue; // the reading itself is SUSPECT, see isReadingSuspect
      if (previous !== null && Math.abs(offset - previous) >= OFFSET_CHANGE_MINUTES) {
        for (let i = 0; i < OFFSET_CHANGE_SUSPECT_DAYS; i++) out.add(addDays(date, i));
      }
      previous = offset;
    }
  }
  return out;
}

// --------------------------------------------------------- section 5: classes

export interface ReadingDayContext {
  date: ISODate;
  log: DailyLog | undefined;
  usualMinutes: number | null;
  afterOffsetChange: boolean;
  /** A13: readings from days inside a context period are never used. */
  insideContext: boolean;
}

/** Section 5 + A5, A6, A10: an automatic SUSPECT flag for one reading. */
function isReadingSuspect(r: TemperatureReading, ctx: ReadingDayContext): boolean {
  const minutes = clockMinutes(r.measuredAt);
  if (minutes === null || ctx.usualMinutes === null) return true;
  if (Math.abs(minutes - ctx.usualMinutes) > OFF_TIME_MINUTES) return true;
  const offset = validOffset(r.utcOffsetMinutes);
  if (offset === null || ctx.afterOffsetChange) return true;
  return isRecalled(r.enteredAt, ctx.date, offset);
}

/** Section 5: illness, alcohol the evening before, or under 3 h of sleep make the day's readings SUSPECT. */
function isDayDisturbed(log: DailyLog | undefined): boolean {
  if (!log) return false;
  if (log.illness === true || log.alcoholPreviousEvening === true) return true;
  const sleep = log.sleepHours as unknown;
  if (sleep === undefined || sleep === null) return false;
  return typeof sleep !== 'number' || !Number.isFinite(sleep) || sleep < SHORT_SLEEP_HOURS;
}

/** Section 5 + A7 + A8 + A13: the class of a day's temperature. */
export function classifyTemperatureDay(ctx: ReadingDayContext): DayTemp {
  const readings = readingsOf(ctx.log);
  if (readings.length === 0) return NO_READING;
  const first = readings[0];
  const meta = {
    unit: isUnit(first.unit) ? first.unit : null,
    route: isRoute(first.route) ? first.route : null,
    thermometerId: typeof first.thermometerId === 'string' ? first.thermometerId : null,
  };
  const finite = readings.filter(hasIntegerValue);
  const usable = finite.filter((r) => !isExcludedReading(r));
  if (ctx.insideContext || usable.length === 0) {
    const shown = finite.length > 0 ? Math.max(...finite.map((r) => r.value)) : null;
    return { ...NO_READING, ...meta, kind: 'EXCLUDED', value: shown };
  }
  const value = Math.max(...usable.map((r) => r.value));
  const suspect =
    readings.length > 1 || // A7: several readings on one date never count as a higher reading
    usable.length !== readings.filter((r) => !isExcludedReading(r)).length ||
    isDayDisturbed(ctx.log) ||
    usable.some((r) => isReadingSuspect(r, ctx));
  return {
    ...meta,
    kind: suspect ? 'SUSPECT' : 'VALID',
    value,
    minutes: readings.length === 1 ? clockMinutes(first.measuredAt) : null,
  };
}

// ------------------------------------------------------------ A5/A8: blocking

/** Digits the user typed, e.g. '36,50' -> 3650, or null if `raw` is not a plain decimal. */
function rawHundredths(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const m = /^\s*(\d{2,3})(?:[.,](\d{1,2}))?\s*$/.exec(raw);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
}

/** Section 1 + A8: unknown device data, a value out of range or not matching what was typed. */
function isInconsistentReading(r: TemperatureReading): boolean {
  if (!isUnit(r.unit) || !hasIntegerValue(r)) return true;
  if (!isRoute(r.route)) return true;
  if (typeof r.thermometerId !== 'string' || r.thermometerId.length === 0) return true;
  if (r.value < PLAUSIBLE[r.unit].min) return true;
  const typed = rawHundredths(r.raw);
  return typed !== null && typed !== r.value;
}

/** A8: mixed unit, route or thermometer within one cycle, or a reading the app cannot vouch for. */
export function isMixedOrUnknownMeasurement(readings: readonly TemperatureReading[], settings: Settings): boolean {
  if (readings.some(isInconsistentReading)) return true;
  const distinct = (key: 'unit' | 'route' | 'thermometerId') => new Set(readings.map((r) => r[key])).size;
  if (distinct('unit') > 1 || distinct('route') > 1 || distinct('thermometerId') > 1) return true;
  // The resolution is only known for the configured thermometer.
  return readings.some((r) => r.thermometerId !== settings.thermometer?.id);
}

/** A8: a 0.01 profile with >= 80 % whole tenths, or a 0.05 profile with other digits than 0 or 5. */
export function isLowResolution(readings: readonly TemperatureReading[], settings: Settings): boolean {
  const resolution = settings.thermometer?.resolution;
  const values = readings.map((r) => r.value);
  if (resolution === 0.05) return values.some((v) => v % 5 !== 0);
  if (resolution !== 0.01) return true;
  const wholeTenths = values.filter((v) => v % 10 === 0).length;
  return values.length > 0 && wholeTenths * 5 >= values.length * 4;
}

/** A5 + A8: why temperature evaluation is blocked for the whole cycle, or null. */
export function temperatureBlockReason(
  dated: readonly { date: ISODate; reading: TemperatureReading }[],
  settings: Settings,
): FertilityReason | null {
  if (dated.length === 0) return null;
  const readings = dated.map((x) => x.reading);
  if (isMixedOrUnknownMeasurement(readings, settings)) return 'temperature_blocked_mixed_measurements';
  if (isLowResolution(readings, settings)) return 'temperature_blocked_low_resolution';
  if (dated.some((x) => usualMinutesOn(settings, x.date) === null)) return 'set_usual_measurement_time';
  return null;
}

// --------------------------------------------------- section 6: STRICT rise

/** `days[d - 1]` is cycle day d. */
export type TempDays = readonly DayTemp[];

export interface ConfirmedRise {
  fhm: number;
  coverline: number;
  rule: TemperatureRule;
  completeDay: number;
  /** The single dip excused by Exception 2. */
  dipDay: number | null;
}

export type StrictResult =
  | { status: 'CONFIRMED'; rise: ConfirmedRise }
  | { status: 'PENDING'; fhm: number; coverline: number }
  | { status: 'NONE' };

type CandidateOutcome =
  | { type: 'not_candidate' }
  | { type: 'failed'; fhm: number }
  | { type: 'pending'; fhm: number; coverline: number }
  | { type: 'confirmed'; rise: ConfirmedRise };

function dayAt(days: TempDays, d: number): DayTemp {
  return (d >= 1 ? days[d - 1] : undefined) ?? NO_READING;
}

interface Lows {
  coverline: number;
  /** Twice the median measurement time of the 6 lows (kept integer). */
  medianMinutesTimes2: number;
}

/**
 * Section 6.3 + A9: walk back from f-1 collecting 6 VALID lows, passing over at
 * most 2 MISSING/EXCLUDED days. SUSPECT readings in the walked span raise the
 * coverline but do not count toward the 6.
 */
export function collectLows(days: TempDays, f: number): Lows | null {
  const lows: DayTemp[] = [];
  let suspectMax: number | null = null;
  let gaps = 0;
  for (let d = f - 1; d >= 1 && lows.length < LOWS_NEEDED; d--) {
    const day = dayAt(days, d);
    if (day.kind === 'VALID' && day.value !== null) lows.push(day);
    else if (day.kind === 'SUSPECT' && day.value !== null) suspectMax = Math.max(suspectMax ?? day.value, day.value);
    else if (++gaps > MAX_LOW_GAPS) return null;
  }
  if (lows.length < LOWS_NEEDED) return null;
  const values = lows.map((l) => l.value as number);
  if (suspectMax !== null) values.push(suspectMax);
  const coverline = Math.max(...values);
  const minutes = lows.map((l) => l.minutes);
  if (!Number.isFinite(coverline) || minutes.some((m) => m === null)) return null;
  const sorted = (minutes as number[]).sort((a, b) => a - b);
  return { coverline, medianMinutesTimes2: sorted[2] + sorted[3] };
}

/** A5: a candidate or higher reading more than 60 min from the median time of its 6 lows is SUSPECT. */
function matchesLowsTime(day: DayTemp, lows: Lows): boolean {
  return day.minutes !== null && Math.abs(2 * day.minutes - lows.medianMinutesTimes2) <= 2 * OFF_TIME_MINUTES;
}

/** Section 6.4-6.8: one FHM candidate f, judged with the data of cycle days 1..E. */
function evaluateCandidate(days: TempDays, f: number, E: number, firstCycle: boolean, unit: TempUnit): CandidateOutcome {
  const candidate = dayAt(days, f);
  if (candidate.kind !== 'VALID' || candidate.value === null) return { type: 'not_candidate' };
  const lows = collectLows(days, f);
  if (lows === null || !matchesLowsTime(candidate, lows)) return { type: 'not_candidate' };
  const cl = lows.coverline;
  if (candidate.value - cl < ABOVE[unit]) return { type: 'not_candidate' };

  const isHigher = (x: number, threshold: number) => {
    const day = dayAt(days, x);
    return day.kind === 'VALID' && day.value !== null && matchesLowsTime(day, lows) && day.value - cl >= threshold;
  };
  const A = (x: number) => isHigher(x, ABOVE[unit]);
  const R = (x: number) => isHigher(x, RISE[unit]);
  const pending: CandidateOutcome = { type: 'pending', fhm: f, coverline: cl };

  if (f + 2 > E) return pending;
  const b = A(f + 1);
  const c = A(f + 2);
  let rise: ConfirmedRise | null = null;
  if (b && c && R(f + 2)) {
    rise = { fhm: f, coverline: cl, rule: 'regular', completeDay: f + 2, dipDay: null };
  } else if (b || c) {
    if (f + 3 > E) return pending;
    if (b && c) {
      if (A(f + 3)) rise = { fhm: f, coverline: cl, rule: 'exception1', completeDay: f + 3, dipDay: null };
    } else if (R(f + 3)) {
      rise = { fhm: f, coverline: cl, rule: 'exception2', completeDay: f + 3, dipDay: b ? f + 2 : f + 1 };
    }
  }
  if (rise === null) return { type: 'failed', fhm: f };
  // Section 6.7 [App]: the first cycle needs one more reading above the coverline.
  if (firstCycle) {
    const extra = rise.completeDay + 1;
    if (extra > E) return pending;
    if (!A(extra)) return { type: 'failed', fhm: f };
    rise = { ...rise, completeDay: extra };
  }
  return { type: 'confirmed', rise };
}

/**
 * Section 6 STRICT: scan candidates in order. An undecided (pending) candidate
 * stops the scan. `accept` lets the double check void a confirmed candidate
 * (A3.2, A3.3) so that scanning continues with later candidates.
 */
export function evaluateStrictRise(
  days: TempDays,
  E: number,
  firstCycle: boolean,
  unit: TempUnit,
  accept: (rise: ConfirmedRise) => boolean = () => true,
): StrictResult {
  for (let f = FIRST_CANDIDATE_DAY; f <= E; f++) {
    const outcome = evaluateCandidate(days, f, E, firstCycle, unit);
    if (outcome.type === 'pending') return { status: 'PENDING', fhm: outcome.fhm, coverline: outcome.coverline };
    if (outcome.type === 'confirmed' && accept(outcome.rise)) return { status: 'CONFIRMED', rise: outcome.rise };
  }
  return { status: 'NONE' };
}

/** A(d) without the lows-time check: VALID and at least ABOVE over the coverline (sections 8, A1, A4). */
export function isValidAbove(day: DayTemp, coverline: number, unit: TempUnit): boolean {
  return day.kind === 'VALID' && day.value !== null && day.value - coverline >= ABOVE[unit];
}

/** A1(c), A4: a VALID reading on or below the coverline. */
export function isValidLow(day: DayTemp, coverline: number): boolean {
  return day.kind === 'VALID' && day.value !== null && day.value <= coverline;
}

// ------------------------------------------------ section 6: LENIENT history

function roundToGrid(value: number, unit: TempUnit): number {
  const { base, step } = LENIENT_GRID[unit];
  const offset = value - base;
  const whole = Math.floor(offset / step);
  const rest = offset - whole * step;
  return base + (rest * 2 >= step ? whole + 1 : whole) * step;
}

/** Section 6 LENIENT (history only, minus-8): sympto-like, gaps ignored, 0.05 grid. Returns the FHM day. */
export function lenientFhm(days: TempDays, L: number, unit: TempUnit): number | null {
  const s: { d: number; v: number }[] = [];
  for (let d = 1; d <= L; d++) {
    const day = dayAt(days, d);
    if ((day.kind === 'VALID' || day.kind === 'SUSPECT') && day.value !== null && Number.isInteger(day.value)) {
      s.push({ d, v: roundToGrid(day.value, unit) });
    }
  }
  const rise = RISE[unit];
  for (let i = LOWS_NEEDED; i + 2 < s.length; i++) {
    const cl = Math.max(...s.slice(i - LOWS_NEEDED, i).map((x) => x.v));
    if (s[i].v <= cl) continue;
    const b = s[i + 1].v > cl;
    const c = s[i + 2].v > cl;
    if (b && c && s[i + 2].v - cl >= rise) return s[i].d;
    if (i + 3 < s.length) {
      if (b && c && s[i + 3].v > cl) return s[i].d;
      if (b !== c && s[i + 3].v - cl >= rise) return s[i].d;
    }
  }
  return null;
}
