// Red flags (SPEC §7; design notes 5.5). They override the pain guide: each one
// is shown as "worth talking to a doctor", never as "try harder".
//
// Thresholds are design choices that still need clinician review. An unlogged
// day is never evidence either way.

import type { Cycle } from './cycles';
import { addDays, compareDates, dateRange, diffDays, type ISODate } from './date';
import { periodPainOutcome, periodPainWindow } from './painGuide';
import type { Prediction } from './prediction';
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
  prediction: Pick<Prediction, 'eligibleLengths'>;
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

function completedCycles(input: RedFlagInput): (Cycle & { end: ISODate })[] {
  return startedCycles(input).filter((c): c is Cycle & { end: ISODate } => c.end !== null);
}

/** Days in a period's pain window (2 days before day 1 through day 3) that match. */
function painWindowDays(periodStart: ISODate, logs: Record<ISODate, DailyLog>, match: (l: DailyLog) => boolean) {
  const w = periodPainWindow(periodStart);
  return matchingDays(logs, w.start, w.end, match);
}

/**
 * Highest cramp score in a period's pain window from any logged day. Severity
 * flags use this rather than the pattern outcome: one day at 9/10 is severe
 * pain even if it is the only day logged.
 */
function anyDayPeak(periodStart: ISODate, logs: Record<ISODate, DailyLog>): number | null {
  const cramps = painWindowDays(periodStart, logs, (l) => l.cramps !== undefined).map((d) => logs[d].cramps as number);
  return cramps.length === 0 ? null : Math.max(...cramps);
}

/**
 * The cycles behind `eligibleLengths` (oldest first), matched newest first by
 * length among completed cycles. Only used to date the evidence.
 */
function cyclesWithLengths(completed: Cycle[], lengths: number[]): Cycle[] {
  const out: Cycle[] = [];
  let j = lengths.length - 1;
  for (let i = completed.length - 1; i >= 0 && j >= 0; i--) {
    if (completed[i].length === lengths[j]) {
      out.unshift(completed[i]);
      j--;
    }
  }
  return out;
}

// --------------------------------------------------------------- pain

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
function painOutsidePeriod(input: RedFlagInput): Finding | null {
  const cycles = startedCycles(input);
  const candidates = [
    ...cycles.filter((c) => c.end !== null).slice(-1),
    ...cycles.filter((c) => c.end === null).slice(-1),
  ];
  for (const c of candidates) {
    const last = c.end === null ? input.today : addDays(c.end, -DAYS_BEFORE_NEXT_PERIOD);
    const days = matchingDays(input.logs, addDays(c.periodEnd, 1), last, (l) =>
      atLeast(l.cramps, OUTSIDE_PERIOD_CRAMPS),
    );
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
 * before the next start, in at least 2 of the last 3 completed cycles.
 */
function intermenstrualBleeding(input: RedFlagInput): Finding | null {
  const recent = completedCycles(input).slice(-3);
  const hits = recent
    .map((c) =>
      matchingDays(input.logs, addDays(c.periodEnd, 1), addDays(c.end, -DAYS_BEFORE_NEXT_PERIOD), (l) =>
        isBleeding(l.flow),
      ),
    )
    .filter((days) => days.length > 0);
  if (hits.length < 2) return null;
  return {
    code: 'intermenstrual_bleeding',
    since: hits[0][0],
    detail: `Bleeding between periods in ${hits.length} of your last ${recent.length} cycles.`,
  };
}

// ------------------------------------------------------------- cycles

/**
 * Among the last 6 eligible cycle lengths (at least 3), half or more under 24
 * or over 38 days, or a spread of 10 days or more.
 */
function irregularCycles(input: RedFlagInput): Finding | null {
  const lengths = input.prediction.eligibleLengths.slice(-IRREGULAR_WINDOW);
  if (lengths.length < MIN_IRREGULAR_LENGTHS) return null;
  const outside = lengths.filter((l) => l < SHORT_CYCLE || l > LONG_CYCLE).length;
  const spread = Math.max(...lengths) - Math.min(...lengths);
  if (outside * 2 < lengths.length && spread < IRREGULAR_SPREAD) return null;

  const completed = completedCycles(input);
  return {
    code: 'irregular_cycles',
    since: cyclesWithLengths(completed, lengths)[0]?.start ?? completed[0]?.start ?? input.today,
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

function noPeriod90Days(input: RedFlagInput): Finding | null {
  const last = startedCycles(input).at(-1);
  if (!last) return null;
  const days = diffDays(input.today, last.start);
  if (days < NO_PERIOD_DAYS || noPeriodExpected(input.contexts, input.today)) return null;
  return {
    code: 'no_period_90_days',
    since: last.start,
    detail: `${days} days since your last period started.`,
  };
}

// ---------------------------------------------------------- evaluation

const CHECKS: ((input: RedFlagInput) => Finding | null)[] = [
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
  return CHECKS.flatMap((check) => {
    const finding = check(input);
    return finding ? [{ ...finding, level: 'see_doctor' as const }] : [];
  });
}
