// Red flags (SPEC §7; design notes 5.5). They override the pain guide: each one
// is shown as "worth talking to a doctor", never as "try harder".
//
// Thresholds are design choices that still need clinician review. An unlogged
// day is never evidence either way, and neither is bleeding behind an
// unanswered "Did your period start?": until the user answers, it may be a
// period.

import { isPeriodFlow, unconfirmedBleedingStarts, type Cycle } from './cycles';
import { addDays, compareDates, dateRange, diffDays, maxDate, type ISODate } from './date';
import { periodPainOutcome, periodPainWindow } from './painGuide';
import { overlapsContext, type Prediction } from './prediction';
import type { ContextKind, ContextPeriod, DailyLog, Flow } from './types';

export type RedFlagCode =
  | 'severe_pain'
  | 'repeated_high_pain'
  | 'worsening_pain'
  | 'pain_outside_period'
  | 'severe_headache'
  | 'flooding'
  | 'long_bleeding'
  | 'intermenstrual_bleeding'
  | 'irregular_cycles'
  | 'no_period_90_days';

export interface RedFlag {
  code: RedFlagCode;
  level: 'see_doctor';
  /** First day of the evidence the flag rests on (a logged day, or the start of the earliest period or cycle involved). */
  since: ISODate;
  /** Neutral facts from the logs, for the flag's detail line. */
  detail: string;
}

export interface RedFlagInput {
  cycles: Cycle[];
  logs: Record<ISODate, DailyLog>;
  contexts: ContextPeriod[];
  prediction: Pick<Prediction, 'suspectedMissedLogCycles'>;
  today: ISODate;
}

const SEVERE_CRAMPS = 8;
const HIGH_CRAMPS = 7;
const WORSENING_POINTS = 2;
const MIN_WORSENING_BASELINE = 3;
const OUTSIDE_PERIOD_CRAMPS = 5;
const MIN_OUTSIDE_PERIOD_DAYS = 3;
/** Days before the next start that belong to that period's pain and bleeding, not to the cycle before it. */
const DAYS_BEFORE_NEXT_PERIOD = 2;
/** As in cycles.ts: spotting days that still extend a period run. */
const MAX_TRAILING_SPOTTING_DAYS = 2;
const SEVERE_HEADACHE = 8;
const HEADACHE_LOOKBACK_DAYS = 30;
const FLOODING_LOOKBACK_DAYS = 90;
const MAX_PERIOD_DAYS = 8;
const SHORT_CYCLE = 24;
const LONG_CYCLE = 38;
const IRREGULAR_SPREAD = 10;
const MIN_IRREGULAR_LENGTHS = 3;
const IRREGULAR_WINDOW = 6;
const NO_PERIOD_DAYS = 90;

/** A period is not expected in these contexts, so a long gap is not a flag. */
const NO_PERIOD_EXPECTED: ContextKind[] = ['pregnancy', 'breastfeeding', 'postpartum', 'hormonal_contraception'];

type Finding = Omit<RedFlag, 'level'>;

/** The input plus the unanswered "Did your period start?" bleeding, worked out once. */
interface Evaluation extends RedFlagInput {
  /** Starts of period-like bleeding, up to today, that the user has neither confirmed nor answered "no" to. */
  unansweredStarts: ISODate[];
  /** Days that would be period days, or the 2 days before a period, if those starts were confirmed. */
  possiblePeriodDays: Set<ISODate>;
}

// ------------------------------------------------------------- helpers

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function isBleeding(flow: Flow | undefined): boolean {
  return flow === 'spotting' || flow === 'light' || flow === 'medium' || flow === 'heavy';
}

function atLeast(value: number | undefined, threshold: number): boolean {
  return value !== undefined && value >= threshold;
}

/** Logged days from start to end inclusive, oldest first, that match. */
function matchingDays(
  logs: Record<ISODate, DailyLog>,
  start: ISODate,
  end: ISODate,
  match: (l: DailyLog) => boolean,
): ISODate[] {
  return dateRange(start, end).filter((d) => logs[d] !== undefined && match(logs[d]));
}

/** Confirmed cycles that have started by today, oldest first. */
function startedCycles(input: RedFlagInput): Cycle[] {
  return input.cycles
    .filter((c) => compareDates(c.start, input.today) <= 0)
    .sort((a, b) => compareDates(a.start, b.start));
}

function completedCycles(input: RedFlagInput): (Cycle & { end: ISODate; length: number })[] {
  return startedCycles(input).filter(
    (c): c is Cycle & { end: ISODate; length: number } => c.end !== null && c.length !== null,
  );
}

/** Last day of the bleeding run starting on `start`, with the same rule as a period run in cycles.ts. */
function bleedingRunEnd(logs: Record<ISODate, DailyLog>, start: ISODate): ISODate {
  let end = start;
  let d = addDays(start, 1);
  while (isPeriodFlow(logs[d]?.flow)) {
    end = d;
    d = addDays(d, 1);
  }
  for (let i = 0; i < MAX_TRAILING_SPOTTING_DAYS && logs[d]?.flow === 'spotting'; i++) {
    end = d;
    d = addDays(d, 1);
  }
  return end;
}

function withUnansweredBleeding(input: RedFlagInput): Evaluation {
  const unansweredStarts = unconfirmedBleedingStarts(input.logs, input.cycles).filter(
    (d) => !input.logs[d]?.notPeriodStart && compareDates(d, input.today) <= 0,
  );
  const possiblePeriodDays = new Set(
    unansweredStarts.flatMap((start) =>
      dateRange(addDays(start, -DAYS_BEFORE_NEXT_PERIOD), bleedingRunEnd(input.logs, start)),
    ),
  );
  return { ...input, unansweredStarts, possiblePeriodDays };
}

/**
 * Logged days of a cycle that match, outside its period and outside the 2 days
 * before the next period. In the open cycle the next period may start
 * tomorrow, so the last 2 days wait: a flag never appears and then vanishes
 * when the period is confirmed. Days that may belong to an unanswered period
 * start are left out until the user answers.
 */
function daysBetweenPeriods(input: Evaluation, c: Cycle, match: (l: DailyLog) => boolean): ISODate[] {
  const last = addDays(c.end ?? input.today, -DAYS_BEFORE_NEXT_PERIOD);
  return matchingDays(input.logs, addDays(c.periodEnd, 1), last, match).filter((d) => !input.possiblePeriodDays.has(d));
}

/** The last `completedCount` completed cycles, and the open one, which may hold evidence before its next period. */
function lastCompletedAndOpen(input: RedFlagInput, completedCount: number): { completed: Cycle[]; open?: Cycle } {
  const cycles = startedCycles(input);
  return {
    completed: cycles.filter((c) => c.end !== null).slice(-completedCount),
    open: cycles.find((c) => c.end === null),
  };
}

/** Days in a period's pain window (2 days before day 1 through day 3) that match. */
function painWindowDays(periodStart: ISODate, logs: Record<ISODate, DailyLog>, match: (l: DailyLog) => boolean) {
  const w = periodPainWindow(periodStart);
  return matchingDays(logs, w.start, w.end, match);
}

/** Highest cramp score logged on any day of a period's pain window. */
function anyDayPeak(periodStart: ISODate, logs: Record<ISODate, DailyLog>): number | null {
  const cramps = painWindowDays(periodStart, logs, (l) => l.cramps !== undefined).map((d) => logs[d].cramps as number);
  return cramps.length === 0 ? null : Math.max(...cramps);
}

// --------------------------------------------------------------- pain
//
// severe_pain and repeated_high_pain look at every logged day: one day at 9/10
// is severe pain even if it is the only day logged. worsening_pain compares
// periods, so it uses the pattern outcome, which needs 2 logged days.

/** Peak cramps >= 8, or "couldn't do usual things", around either of the last 2 periods. */
function severePain(input: RedFlagInput): Finding | null {
  const { logs } = input;
  const hits = startedCycles(input)
    .slice(-2)
    .map((c) => ({
      start: c.start,
      days: painWindowDays(
        c.start,
        logs,
        (l) => atLeast(l.cramps, SEVERE_CRAMPS) || l.painImpact === 'couldnt_do_usual',
      ),
    }))
    .filter((h) => h.days.length > 0);
  if (hits.length === 0) return null;

  const latest = hits[hits.length - 1];
  const peak = anyDayPeak(latest.start, logs);
  const detail =
    peak !== null && peak >= SEVERE_CRAMPS
      ? `Cramps of ${peak}/10 around the period that started ${latest.start}.`
      : `"Couldn't do usual things" logged around the period that started ${latest.start}.`;
  return { code: 'severe_pain', since: hits[0].days[0], detail };
}

/** Peak cramps >= 7 around at least 2 of the last 3 periods. */
function repeatedHighPain(input: RedFlagInput): Finding | null {
  const recent = startedCycles(input).slice(-3);
  const hits = recent
    .map((c) => painWindowDays(c.start, input.logs, (l) => atLeast(l.cramps, HIGH_CRAMPS)))
    .filter((days) => days.length > 0);
  if (hits.length < 2) return null;
  return {
    code: 'repeated_high_pain',
    since: hits[0][0],
    detail: `Cramps of ${HIGH_CRAMPS}/10 or more around ${hits.length} of your last ${recent.length} periods.`,
  };
}

/**
 * Median peak of the last 3 periods at least 2 points above the median of the
 * up to 6 periods before them. Only periods with a pain outcome (at least 2
 * logged cramp days) count, as in the pattern comparison.
 */
function worseningPain(input: RedFlagInput): Finding | null {
  const outcomes = startedCycles(input).flatMap((c) => {
    const peak = periodPainOutcome(c.start, input.logs).peakCramps;
    return peak === null ? [] : [{ start: c.start, peak }];
  });
  const recent = outcomes.slice(-3);
  const baseline = outcomes.slice(-9, -3);
  if (recent.length < 3 || baseline.length < MIN_WORSENING_BASELINE) return null;

  const recentMedian = median(recent.map((o) => o.peak));
  const baselineMedian = median(baseline.map((o) => o.peak));
  if (recentMedian < baselineMedian + WORSENING_POINTS) return null;
  return {
    code: 'worsening_pain',
    since: recent[0].start,
    detail: `Peak cramps had a median of ${recentMedian}/10 in your last 3 periods, up from ${baselineMedian}/10 in the ${baseline.length} before.`,
  };
}

/**
 * Cramps >= 5 on at least 3 days of the current or the last completed cycle,
 * outside its period and outside the 2 days before the next period.
 */
function painOutsidePeriod(input: Evaluation): Finding | null {
  const { completed, open } = lastCompletedAndOpen(input, 1);
  for (const c of open ? [...completed, open] : completed) {
    const days = daysBetweenPeriods(input, c, (l) => atLeast(l.cramps, OUTSIDE_PERIOD_CRAMPS));
    if (days.length >= MIN_OUTSIDE_PERIOD_DAYS) {
      return {
        code: 'pain_outside_period',
        since: days[0],
        detail: `Cramps of ${OUTSIDE_PERIOD_CRAMPS}/10 or more on ${days.length} days outside your period in the cycle that started ${c.start}.`,
      };
    }
  }
  return null;
}

function severeHeadache(input: RedFlagInput): Finding | null {
  const { logs, today } = input;
  const days = matchingDays(logs, addDays(today, -(HEADACHE_LOOKBACK_DAYS - 1)), today, (l) =>
    atLeast(l.headache, SEVERE_HEADACHE),
  );
  if (days.length === 0) return null;
  const worst = Math.max(...days.map((d) => logs[d].headache as number));
  return {
    code: 'severe_headache',
    since: days[0],
    detail: `Headache up to ${worst}/10 on ${days.length} ${days.length === 1 ? 'day' : 'days'} in the last ${HEADACHE_LOOKBACK_DAYS} days.`,
  };
}

// ----------------------------------------------------------- bleeding

function flooding(input: RedFlagInput): Finding | null {
  const { logs, today } = input;
  const days = matchingDays(logs, addDays(today, -(FLOODING_LOOKBACK_DAYS - 1)), today, (l) => l.flooding === true);
  if (days.length === 0) return null;
  return {
    code: 'flooding',
    since: days[0],
    detail: `Flooding logged on ${days.length} ${days.length === 1 ? 'day' : 'days'} in the last ${FLOODING_LOOKBACK_DAYS} days.`,
  };
}

/** A period run longer than 8 days in any of the last 3 cycles. */
function longBleeding(input: RedFlagInput): Finding | null {
  const long = startedCycles(input)
    .slice(-3)
    .filter((c) => c.periodLength > MAX_PERIOD_DAYS);
  if (long.length === 0) return null;
  const latest = long[long.length - 1];
  return {
    code: 'long_bleeding',
    since: long[0].start,
    detail: `The period that started ${latest.start} lasted ${latest.periodLength} days.`,
  };
}

/**
 * Bleeding (spotting or more) outside the period run and outside the 2 days
 * before the next start, in at least 2 cycles: the last 3 completed ones and
 * the open one so far.
 */
function intermenstrualBleeding(input: Evaluation): Finding | null {
  const { completed, open } = lastCompletedAndOpen(input, 3);
  const bleeding = (c: Cycle) => daysBetweenPeriods(input, c, (l) => isBleeding(l.flow));
  const openDays = open ? bleeding(open) : [];
  const hits = [...completed.map(bleeding), openDays].filter((days) => days.length > 0);
  if (hits.length < 2) return null;
  const openHit = openDays.length > 0;
  const counted = completed.length + (openHit ? 1 : 0);
  return {
    code: 'intermenstrual_bleeding',
    since: hits[0][0],
    detail: `Bleeding between periods in ${hits.length} of your last ${counted} cycles${openHit ? ', including the current one' : ''}.`,
  };
}

// ------------------------------------------------------------- cycles

/**
 * Among the last 6 completed cycles that count (at least 3), half or more under
 * 24 or over 38 days, or a spread of 10 days or more. Unlike the prediction,
 * cycles under 15 or over 90 days count: they are the most irregular of all.
 * Cycles that overlap a context, unconfirmed suspected missed logs, and cycles
 * holding an unanswered "Did your period start?" do not count.
 */
function irregularCycles(input: Evaluation): Finding | null {
  const missedLogs = new Set(input.prediction.suspectedMissedLogCycles);
  const counted = completedCycles(input)
    .filter((c) => !overlapsContext(c, input.contexts) && !missedLogs.has(c.index))
    .filter((c) => !input.unansweredStarts.some((d) => compareDates(d, c.start) >= 0 && compareDates(d, c.end) <= 0))
    .slice(-IRREGULAR_WINDOW);
  if (counted.length < MIN_IRREGULAR_LENGTHS) return null;
  const lengths = counted.map((c) => c.length);
  const outside = lengths.filter((l) => l < SHORT_CYCLE || l > LONG_CYCLE).length;
  const spread = Math.max(...lengths) - Math.min(...lengths);
  if (outside * 2 < lengths.length && spread < IRREGULAR_SPREAD) return null;
  return {
    code: 'irregular_cycles',
    since: counted[0].start,
    detail: `Your last ${lengths.length} cycles were ${lengths.join(', ')} days long.`,
  };
}

function noPeriodExpected(contexts: ContextPeriod[], today: ISODate): boolean {
  return contexts.some(
    (ctx) =>
      NO_PERIOD_EXPECTED.includes(ctx.kind) &&
      compareDates(ctx.start, today) <= 0 &&
      (ctx.end === undefined || compareDates(ctx.end, today) >= 0),
  );
}

/**
 * 90 days without a period, counted only outside the contexts where none is
 * expected: from the latest of the last confirmed start, the day after such a
 * context ended, and unanswered period-like bleeding (which may be a period).
 */
function noPeriod90Days(input: Evaluation): Finding | null {
  const cycles = startedCycles(input);
  const last = cycles[cycles.length - 1];
  if (!last || noPeriodExpected(input.contexts, input.today)) return null;
  const contextEnds = input.contexts.flatMap((ctx) =>
    NO_PERIOD_EXPECTED.includes(ctx.kind) && ctx.end !== undefined && compareDates(ctx.end, input.today) < 0
      ? [addDays(ctx.end, 1)]
      : [],
  );
  const from = [last.start, ...contextEnds, ...input.unansweredStarts].reduce(maxDate);
  const days = diffDays(input.today, from);
  if (days < NO_PERIOD_DAYS) return null;
  return {
    code: 'no_period_90_days',
    since: from,
    detail:
      from === last.start
        ? `${days} days since your last period started.`
        : `No period confirmed in the ${days} days since ${from}.`,
  };
}

// ---------------------------------------------------------- evaluation

const CHECKS: ((input: Evaluation) => Finding | null)[] = [
  severePain,
  repeatedHighPain,
  worseningPain,
  painOutsidePeriod,
  severeHeadache,
  flooding,
  longBleeding,
  intermenstrualBleeding,
  irregularCycles,
  noPeriod90Days,
];

/** Every red flag the logs show today, in a fixed order. */
export function evaluateRedFlags(input: RedFlagInput): RedFlag[] {
  const evaluation = withUnansweredBleeding(input);
  return CHECKS.flatMap((check) => {
    const finding = check(evaluation);
    return finding ? [{ ...finding, level: 'see_doctor' as const }] : [];
  });
}
