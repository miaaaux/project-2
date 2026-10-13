// The fertility engine: one pure evaluation of the whole history as of `today`
// (docs/fertility-rules.md sections 2-11 with the binding amendments A1-A19).
//
// Principle: every day is fertile unless a rule below proves otherwise from
// recorded data. Unknown, missing, inconsistent or non-finite data is fertile.

import { addDays, compareDates, dateRange, diffDays, isISODate, type ISODate } from '../date';
import { deriveCycles, isPeriodFlow, type Cycle } from '../cycles';
import type { AppData, DailyLog, Flow, TempRoute, TempUnit, TemperatureReading } from '../types';
import {
  checkInReportsPostpartum,
  cycleCheckIn,
  isInsideContext,
  isNotApplicableOn,
  isPostpartumOn,
  overlapsContext,
  type CheckIn,
} from './context';
import type {
  CycleFertilitySummary,
  DayFertility,
  DayReadingInfo,
  FertilityReason,
  FertilityResult,
  FertilityStatus,
} from './model';
import { FERTILITY_REASON_CODES } from './model';
import {
  assessMucus,
  evalMucus,
  hasFertileSign,
  isKnownLower,
  NOT_LOGGED,
  POST_PEAK_DAYS,
  type MucusAssessment,
  type MucusResult,
} from './mucus';
import {
  classifyTemperatureDay,
  evaluateStrictRise,
  isAboveRise,
  isUsableAsLow,
  isValidLow,
  lenientFhm,
  offsetChangeSuspectDates,
  readingsOf,
  temperatureBlockReason,
  usualMinutesOn,
  type ConfirmedRise,
  type DayTemp,
} from './temperature';
import { clockMinutes, isCompletedInEvening, isRecalled, validOffset } from './time';

// ------------------------------------------------------------------ constants

/** Section 9: the 5-day rule and the bleeding limit for compatible days. */
const DEFAULT_PRE_OVULATORY_DAYS = 5;
const LAST_BLEEDING_DAY_COMPATIBLE = 5;
/** Section 9: minus-8. */
const MINUS_RULE_DAYS = 8;
/** Section 9: lengthening needs 12 qualifying cycles. */
const CYCLES_TO_LENGTHEN = 12;
/** A16: pseudo-FHM = cycle length - 16 for a cycle without any FHM. */
const PSEUDO_FHM_OFFSET = 16;
/** A3.2: pairing window [FHM - 5, FHM + 3]. */
const PAIR_BEFORE_FHM = 5;
const PAIR_AFTER_FHM = 3;
/** A1(b), A1(c), A4: from FHM + 10 a drop or spotting ends the phase. */
const LATE_LUTEAL_FROM_FHM = 10;
/** A1(d): hard cap. */
const LUTEAL_CAP_FROM_FHM = 19;
/** A12: plausible previous cycle. */
const MIN_PLAUSIBLE_CYCLE = 21;
const MAX_PLAUSIBLE_CYCLE = 40;
/** A11, A12: longest run of days without a temperature or a complete mucus entry. */
const MAX_UNCHARTED_RUN = 3;

// --------------------------------------------------------------- data access

interface Inputs {
  data: AppData;
  today: ISODate;
  logs: Record<ISODate, DailyLog>;
  deviceOffset: number | null;
  eveningMinutes: number | null;
  offsetSuspect: Set<ISODate>;
}

/** A1: only today and the past are evaluated. Logs with an unreadable date key are ignored. */
function logsUpTo(data: AppData, today: ISODate): Record<ISODate, DailyLog> {
  const out: Record<ISODate, DailyLog> = {};
  for (const [key, entry] of Object.entries(data.logs ?? {})) {
    if (!isISODate(key) || !entry || typeof entry !== 'object' || compareDates(key, today) > 0) continue;
    out[key] = entry.date === key ? entry : { ...entry, date: key };
  }
  return out;
}

function isBleeding(flow: Flow | undefined): boolean {
  return flow === 'spotting' || isPeriodFlow(flow);
}

/**
 * Section 3 + A16: contiguous days with any bleeding just before the confirmed
 * CD1. Period flow there (a start confirmed a day late) is a possible earlier
 * CD1, so it shortens N at least as much as leading spotting does.
 */
function leadingBleedingDays(logs: Record<ISODate, DailyLog>, start: ISODate): number {
  let n = 0;
  for (let d = addDays(start, -1); isBleeding(logs[d]?.flow); d = addDays(d, -1)) n++;
  return n;
}

/** Section 3 period run: CD1 plus the following contiguous days with any bleeding (spotting counts). */
function periodRunLength(logs: Record<ISODate, DailyLog>, dates: readonly ISODate[]): number {
  let n = dates.length > 0 ? 1 : 0;
  while (n < dates.length && isBleeding(logs[dates[n]]?.flow)) n++;
  return n;
}

// ------------------------------------------------------- per-day assessment

function assessTemperatureDay(inputs: Inputs, date: ISODate): DayTemp {
  return classifyTemperatureDay({
    date,
    log: inputs.logs[date],
    usualMinutes: usualMinutesOn(inputs.data.settings, date),
    afterOffsetChange: inputs.offsetSuspect.has(date),
    insideContext: isInsideContext(inputs.data.contexts, date),
  });
}

/** A10: final only if confirmed from the evening observation time; recalled if saved after 12:00 the next day. */
function assessMucusDay(inputs: Inputs, date: ISODate): MucusAssessment {
  const obs = inputs.logs[date]?.mucus;
  if (!obs || isInsideContext(inputs.data.contexts, date)) return NOT_LOGGED; // A13
  return assessMucus(obs, {
    complete:
      obs.observationComplete === true &&
      isCompletedInEvening(obs.completedAt, date, inputs.eveningMinutes, inputs.deviceOffset),
    recalled: isRecalled(obs.updatedAt, date, inputs.deviceOffset),
  });
}

// --------------------------------------------------------- cycle evaluation

interface DoubleCheck {
  S: number;
  rise: ConfirmedRise;
  mucus: Exclude<MucusResult, { status: 'NONE' }>;
}

interface DayOutcome {
  status: FertilityStatus;
  reasons: FertilityReason[];
  eveningTransition?: true;
}

interface PostOvulatoryPhase {
  end: { day: number; reasons: FertilityReason[] } | null;
  days: Map<number, DayOutcome>;
  /** Ended reopened (or collapsed) without re-confirmation (section 8, A4). */
  reopenedUnresolved: boolean;
}

interface CycleEvaluation {
  cycle: Cycle;
  /** Evaluated days: cycle days 1..L (through the cycle end or today). */
  L: number;
  dates: ISODate[];
  temps: DayTemp[];
  mucus: MucusAssessment[];
  unit: TempUnit | null;
  route: TempRoute | null;
  thermometerId: string | null;
  checkIn: CheckIn;
  affected: boolean;
  /** Section 3: cycle days 1..periodRunDays are the period run (the inPeriod badge, A18). */
  periodRunDays: number;
  locked: boolean;
  temperatureBlocked: FertilityReason | null;
  firstCycle: boolean;
  charted: boolean;
  /** As known on each cycle day E before S: index E - 1. */
  signsByDay: { temperatureConfirmed: boolean; mucusComplete: boolean }[];
  doubleCheck: DoubleCheck | null;
  displayRise: ConfirmedRise | null;
  mucusAtEnd: MucusResult;
  post: PostOvulatoryPhase | null;
  preOvulatoryLength: number;
  preOvulatoryZeroReason: FertilityReason | null;
  preOvulatory: Map<number, DayOutcome>;
}

function cycleReadings(ev: Pick<CycleEvaluation, 'dates'>, inputs: Inputs): { date: ISODate; reading: TemperatureReading }[] {
  return ev.dates.flatMap((date) =>
    isInsideContext(inputs.data.contexts, date) ? [] : readingsOf(inputs.logs[date]).map((reading) => ({ date, reading })),
  );
}

function hasUsableTemperature(t: DayTemp): boolean {
  return t.kind === 'VALID' || t.kind === 'SUSPECT';
}

function longestUnchartedRun(ev: Pick<CycleEvaluation, 'temps' | 'mucus'>, from: number, to: number): number {
  let run = 0;
  let longest = 0;
  for (let d = from; d <= to; d++) {
    const charted = hasUsableTemperature(ev.temps[d - 1]) || ev.mucus[d - 1].complete;
    run = charted ? 0 : run + 1;
    longest = Math.max(longest, run);
  }
  return longest;
}

/** A11: a complete, unaffected cycle with >= 80 % temperatures, >= 80 % complete mucus and no run > 3 without either. */
function isChartedCycle(ev: CycleEvaluation): boolean {
  if (ev.cycle.end === null || ev.locked) return false;
  const days = ev.L;
  const tempDays = ev.temps.filter(hasUsableTemperature).length;
  const mucusDays = ev.mucus.filter((m) => m.complete).length;
  return tempDays * 5 >= days * 4 && mucusDays * 5 >= days * 4 && longestUnchartedRun(ev, 1, days) <= MAX_UNCHARTED_RUN;
}

/** A11: first cycle unless the immediately previous cycle was charted. */
function isFirstCycle(cycle: Cycle, previous: CycleEvaluation | undefined): boolean {
  return !(previous && previous.cycle.index === cycle.index - 1 && previous.charted);
}

/** A3.2: the effective mucus peak must lie within [FHM - 5, FHM + 3]. */
function pairsWithMucusPeak(rise: ConfirmedRise, effectivePeakDay: number): boolean {
  return effectivePeakDay >= rise.fhm - PAIR_BEFORE_FHM && effectivePeakDay <= rise.fhm + PAIR_AFTER_FHM;
}

/**
 * A3.3: when mucus completes after the temperature, every reading FHM..S stays
 * VALID and above (one Exception 2 dip excused). A5 applies to each of them as
 * a higher reading: more than 60 min from the median time of the 6 lows is SUSPECT.
 */
function riseSustainedUntil(ev: CycleEvaluation, rise: ConfirmedRise, mucusCompleteDay: number, S: number): boolean {
  if (mucusCompleteDay <= rise.completeDay || ev.unit === null) return true;
  for (let d = rise.fhm; d <= S; d++) {
    if (d === rise.dipDay) continue;
    if (!isAboveRise(ev.temps[d - 1], rise, ev.unit)) return false;
  }
  return true;
}

/**
 * Section 8 start + A3: S is the first day E on which STRICT temperature is
 * confirmed by a candidate that pairs with the (patch-reset) mucus peak and,
 * if mucus completed later, stayed up until E.
 */
function findDoubleCheck(ev: CycleEvaluation): DoubleCheck | null {
  const unit = ev.unit;
  for (let E = 1; E <= ev.L; E++) {
    const mucus = evalMucus(ev.mucus, E);
    const temperature = unit === null ? null : evaluateStrictRise(ev.temps, E, ev.firstCycle, unit);
    ev.signsByDay.push({
      temperatureConfirmed: temperature?.status === 'CONFIRMED',
      mucusComplete: mucus.status === 'COMPLETE',
    });
    if (unit === null || mucus.status !== 'COMPLETE' || mucus.completeDay === null) continue;
    const completeMucus = mucus as DoubleCheck['mucus'];
    const accepted = evaluateStrictRise(
      ev.temps,
      E,
      ev.firstCycle,
      unit,
      (rise) => pairsWithMucusPeak(rise, completeMucus.effectivePeakDay) && riseSustainedUntil(ev, rise, completeMucus.completeDay as number, E),
    );
    if (accepted.status === 'CONFIRMED') return { S: E, rise: accepted.rise, mucus: completeMucus };
  }
  return null;
}

interface Ending {
  day: number;
  reason: FertilityReason;
}

type FlowOn = (d: number) => Flow | undefined;

/** A1(a): flow >= light on any day after S, confirmed as a period start or not. */
function periodLikeBleedingEnding(flowOn: FlowOn, S: number, L: number): Ending | null {
  for (let d = S; d <= L; d++) {
    if (isPeriodFlow(flowOn(d))) return { day: Math.max(d, S + 1), reason: 'possible_new_cycle' };
  }
  return null;
}

/** A1(b): 2 consecutive spotting days on or after FHM + 10 end the phase from the first of them. */
function lateSpottingEnding(flowOn: FlowOn, S: number, L: number, lateFrom: number): Ending | null {
  for (let d = Math.max(S, lateFrom) + 1; d <= L; d++) {
    if (flowOn(d - 1) === 'spotting' && flowOn(d) === 'spotting') return { day: Math.max(d - 1, S + 1), reason: 'possible_new_cycle' };
  }
  return null;
}

/**
 * A4 before FHM + 10, A1(c) from then on: 2 consecutive VALID readings on or
 * below the coverline after S. "Consecutive" is read over the VALID readings,
 * not calendar days (section 0: the reading with fewer infertile days wins), so
 * days without a VALID low reading in between (missing, bracketed, SUSPECT) do
 * not hide a drop. The phase ends from the first of the two.
 */
function lowTemperatureEnding(ev: CycleEvaluation, rise: ConfirmedRise, S: number, lateFrom: number): Ending | null {
  let previous: number | null = null;
  for (let d = S + 1; d <= ev.L; d++) {
    const day = ev.temps[d - 1];
    if (!isUsableAsLow(day)) continue;
    if (!isValidLow(day, rise.coverline)) {
      previous = null;
      continue;
    }
    if (previous !== null) return { day: previous, reason: previous < lateFrom ? 'temperature_collapse' : 'temperature_drop' };
    previous = d;
  }
  return null;
}

/** A1(d): the hard cap on FHM + 19. */
function lutealCapEnding(rise: ConfirmedRise, S: number, L: number): Ending | null {
  const day = Math.max(rise.fhm + LUTEAL_CAP_FROM_FHM, S + 1);
  return day <= L ? { day, reason: 'luteal_phase_too_long' } : null;
}

/** A1 + A4: every way the post-ovulatory phase ends; the earliest one applies. */
function postOvulatoryEndings(ev: CycleEvaluation, check: DoubleCheck, inputs: Inputs): Ending[] {
  const { S, rise } = check;
  const flowOn: FlowOn = (d) => inputs.logs[ev.dates[d - 1]]?.flow;
  const lateFrom = rise.fhm + LATE_LUTEAL_FROM_FHM;
  return [
    periodLikeBleedingEnding(flowOn, S, ev.L),
    lateSpottingEnding(flowOn, S, ev.L, lateFrom),
    lowTemperatureEnding(ev, rise, S, lateFrom),
    lutealCapEnding(rise, S, ev.L),
  ].filter((e): e is Ending => e !== null && e.day <= ev.L);
}

function orderedReasons(reasons: Iterable<FertilityReason>): FertilityReason[] {
  const set = new Set(reasons);
  return FERTILITY_REASON_CODES.filter((r) => set.has(r));
}

/** Section 8.3 + A19: re-confirmation needs VALID readings above the coverline on rp..rp+3, same route and thermometer. */
function reconfirmsAfterReopen(ev: CycleEvaluation, check: DoubleCheck, rp: number, inputs: Inputs): boolean {
  if (ev.unit === null) return false;
  for (let d = rp; d <= rp + POST_PEAK_DAYS; d++) {
    const readings = readingsOf(inputs.logs[ev.dates[d - 1]]);
    const sameDevice = readings.every((r) => r.route === ev.route && r.thermometerId === ev.thermometerId);
    if (!sameDevice || !isAboveRise(ev.temps[d - 1], check.rise, ev.unit)) return false;
  }
  return true;
}

/**
 * Section 8 (days after S) with the safeguard: mucus of the confirmed quality
 * reopens the fertile phase until 3 known lower days and 4 high readings
 * re-confirm it. The A1/A4 endings take precedence.
 */
function postOvulatoryPhase(ev: CycleEvaluation, check: DoubleCheck, inputs: Inputs): PostOvulatoryPhase {
  const endings = postOvulatoryEndings(ev, check, inputs);
  const endDay = endings.length > 0 ? Math.min(...endings.map((e) => e.day)) : null;
  const days = new Map<number, DayOutcome>();
  const M = check.mucus.maxQuality;
  let reopened = false;
  let rp = 0;
  const lastOpenDay = endDay === null ? ev.L : endDay - 1;
  for (let d = check.S + 1; d <= lastOpenDay; d++) {
    const m = ev.mucus[d - 1];
    if (!reopened) {
      if (m.quality !== null && m.quality >= M) {
        reopened = true;
        rp = d;
        days.set(d, { status: 'fertile', reasons: ['fertile_mucus_after_confirmation'] });
      } else {
        days.set(d, { status: 'infertile_post_ovulatory', reasons: ['double_check_complete'] });
      }
      continue;
    }
    if (!isKnownLower(m, M)) rp = d;
    if (d === rp + POST_PEAK_DAYS && reconfirmsAfterReopen(ev, check, rp, inputs)) {
      reopened = false;
      days.set(d, { status: 'fertile', reasons: ['evening_transition'], eveningTransition: true });
    } else {
      days.set(d, { status: 'fertile', reasons: ['fertile_mucus_after_confirmation'] });
    }
  }
  if (endDay !== null) {
    for (let d = endDay; d <= ev.L; d++) {
      days.set(d, { status: 'fertile', reasons: orderedReasons(endings.filter((e) => e.day <= d).map((e) => e.reason)) });
    }
  }
  const endReasons = endDay === null ? [] : orderedReasons(endings.filter((e) => e.day === endDay).map((e) => e.reason));
  return {
    end: endDay === null ? null : { day: endDay, reasons: endReasons },
    days,
    reopenedUnresolved: reopened || endReasons.includes('temperature_collapse'),
  };
}

// ------------------------------------------------------ pre-ovulatory phase

/** Section 6 + A16: the FHM a completed cycle contributes to the minus-8 rule. */
function historyFhm(ev: CycleEvaluation): number | null {
  const found: number[] = [];
  if (ev.unit !== null) {
    const strict = evaluateStrictRise(ev.temps, ev.L, false, ev.unit);
    if (strict.status === 'CONFIRMED') found.push(strict.rise.fhm);
    if (strict.status === 'PENDING') found.push(strict.fhm);
    const lenient = lenientFhm(ev.temps, ev.L, ev.unit);
    if (lenient !== null) found.push(lenient);
  }
  if (ev.doubleCheck) found.push(ev.doubleCheck.rise.fhm);
  const pseudo = ev.cycle.length === null ? null : ev.cycle.length - PSEUDO_FHM_OFFSET;
  // A blocked cycle's readings cannot be trusted to lengthen anything: also take the pseudo-FHM.
  if (pseudo !== null && (found.length === 0 || ev.temperatureBlocked !== null)) found.push(pseudo);
  const finite = found.filter(Number.isFinite);
  return finite.length > 0 ? Math.min(...finite) : null;
}

/** A16: cycles that count toward the 12 needed to lengthen the phase. */
function countsTowardLengthening(ev: CycleEvaluation): boolean {
  return ev.cycle.end !== null && !ev.locked && ev.doubleCheck !== null && !ev.post?.reopenedUnresolved;
}

/** Section 9 gate + A12: the immediately preceding cycle must be double-checked and plausible. */
function passesPreOvulatoryGate(ev: CycleEvaluation, previous: CycleEvaluation | undefined): boolean {
  if (!previous || previous.cycle.index !== ev.cycle.index - 1 || previous.cycle.end === null) return false;
  if (previous.locked || !previous.doubleCheck || !previous.post || previous.post.reopenedUnresolved) return false;
  const length = previous.cycle.length;
  if (length === null || length < MIN_PLAUSIBLE_CYCLE || length > MAX_PLAUSIBLE_CYCLE) return false;
  const fhmDate = previous.dates[previous.doubleCheck.rise.fhm - 1];
  if (diffDays(ev.cycle.start, fhmDate) < LATE_LUTEAL_FROM_FHM) return false;
  const S = previous.doubleCheck.S;
  const span = previous.L - S + 1;
  const withTemps = previous.temps.slice(S - 1).filter(hasUsableTemperature).length;
  if (withTemps * 10 < span * 7) return false;
  return longestUnchartedRun(previous, 1, previous.L) <= MAX_UNCHARTED_RUN;
}

/** Section 9 length N (minus-8, 5-day rule, lengthening) + A16 leading spotting (and any other leading bleeding). */
function preOvulatoryLength(
  ev: CycleEvaluation,
  history: CycleEvaluation[],
  inputs: Inputs,
): { n: number; zeroReason: FertilityReason | null } {
  if (ev.locked) return { n: 0, zeroReason: null };
  if (ev.firstCycle) return { n: 0, zeroReason: 'first_cycle' };
  if (!passesPreOvulatoryGate(ev, history[history.length - 1])) return { n: 0, zeroReason: 'previous_cycle_not_qualifying' };
  const fhms = history.map(historyFhm).filter((x): x is number => x !== null);
  if (fhms.length === 0) return { n: 0, zeroReason: 'pre_ovulatory_rule' };
  const candidate = Math.min(...fhms) - MINUS_RULE_DAYS;
  const qualifying = history.filter(countsTowardLengthening).length;
  let n: number;
  if (candidate < DEFAULT_PRE_OVULATORY_DAYS) n = Math.max(candidate, 0);
  else if (qualifying >= CYCLES_TO_LENGTHEN) n = candidate;
  else n = DEFAULT_PRE_OVULATORY_DAYS;
  n = Math.max(0, n - Math.max(ev.cycle.leadingSpottingDays, leadingBleedingDays(inputs.logs, ev.cycle.start)));
  if (!Number.isInteger(n)) n = 0;
  return { n, zeroReason: n === 0 ? 'pre_ovulatory_rule' : null };
}

/**
 * Section 9 + A10, A14, A15: why a day is not compatible with the
 * pre-ovulatory phase, or null if it is (a final, explicit, on-time
 * observation of t or Ø, or bleeding up to CD5 with mucus not assessable).
 */
function preOvulatoryIncompatibility(
  log: DailyLog | undefined,
  mucus: MucusAssessment,
  cycleDay: number,
  isToday: boolean,
): FertilityReason | null {
  const notYet: FertilityReason = isToday ? 'awaiting_evening_observation' : 'missing_observation';
  if (!log || !mucus.logged) return notYet;
  if (hasFertileSign(mucus) || mucus.unsure) return 'fertile_sign_observed';
  if (!mucus.complete) return notYet;
  if (mucus.recalled) return 'missing_observation';
  const lowQuality = mucus.quality === 0 || mucus.quality === 1;
  if (log.flow === 'none') return lowQuality ? null : 'missing_observation';
  if (!isBleeding(log.flow)) return 'missing_observation'; // A15: flow not logged
  if (cycleDay > LAST_BLEEDING_DAY_COMPATIBLE) return 'bleeding_hides_mucus';
  return lowQuality || mucus.notAssessableBleeding ? null : 'bleeding_hides_mucus';
}

/** Section 9: days 1..N are infertile while every day so far is compatible; the first other day closes the phase. */
function preOvulatoryDays(ev: CycleEvaluation, inputs: Inputs): Map<number, DayOutcome> {
  const out = new Map<number, DayOutcome>();
  const last = Math.min(ev.preOvulatoryLength, ev.L, ev.doubleCheck ? ev.doubleCheck.S - 1 : ev.L);
  for (let d = 1; d <= last; d++) {
    const date = ev.dates[d - 1];
    const problem = preOvulatoryIncompatibility(inputs.logs[date], ev.mucus[d - 1], d, date === inputs.today);
    if (problem !== null) {
      out.set(d, { status: 'fertile', reasons: [problem] });
      break;
    }
    out.set(d, { status: 'infertile_pre_ovulatory', reasons: ['pre_ovulatory_rule'] });
  }
  return out;
}

// ------------------------------------------------------------- assembling

function evaluateCycle(cycle: Cycle, history: CycleEvaluation[], inputs: Inputs): CycleEvaluation {
  const lastDate = cycle.end !== null && compareDates(cycle.end, inputs.today) < 0 ? cycle.end : inputs.today;
  const dates = dateRange(cycle.start, lastDate);
  const checkIn = cycleCheckIn(inputs.data.cycleContextAnswers, cycle.start);
  const affected = checkIn === 'affected' || overlapsContext(inputs.data.contexts, cycle.start, lastDate);
  const ev: CycleEvaluation = {
    cycle,
    L: dates.length,
    dates,
    temps: dates.map((d) => assessTemperatureDay(inputs, d)),
    mucus: dates.map((d) => assessMucusDay(inputs, d)),
    unit: null,
    route: null,
    thermometerId: null,
    checkIn,
    affected,
    periodRunDays: periodRunLength(inputs.logs, dates),
    locked: affected || checkIn === 'unanswered',
    temperatureBlocked: null,
    firstCycle: isFirstCycle(cycle, history[history.length - 1]),
    charted: false,
    signsByDay: [],
    doubleCheck: null,
    displayRise: null,
    mucusAtEnd: { status: 'NONE', maxQuality: null },
    post: null,
    preOvulatoryLength: 0,
    preOvulatoryZeroReason: null,
    preOvulatory: new Map(),
  };
  const readings = cycleReadings(ev, inputs);
  const first = readings[0]?.reading;
  ev.unit = first && (first.unit === 'C' || first.unit === 'F') ? first.unit : null;
  ev.route = first ? first.route : null;
  ev.thermometerId = first ? first.thermometerId : null;
  ev.temperatureBlocked = temperatureBlockReason(readings, inputs.data.settings);
  ev.charted = isChartedCycle(ev);
  ev.mucusAtEnd = evalMucus(ev.mucus, ev.L);

  const canConfirm = !ev.locked && ev.temperatureBlocked === null;
  if (canConfirm) ev.doubleCheck = findDoubleCheck(ev);
  if (ev.temperatureBlocked === null && ev.unit !== null) {
    const shown = evaluateStrictRise(ev.temps, ev.L, ev.firstCycle, ev.unit);
    ev.displayRise = shown.status === 'CONFIRMED' ? shown.rise : null;
  }
  if (ev.doubleCheck) ev.post = postOvulatoryPhase(ev, ev.doubleCheck, inputs);

  const { n, zeroReason } = preOvulatoryLength(ev, history, inputs);
  ev.preOvulatoryLength = n;
  ev.preOvulatoryZeroReason = zeroReason;
  ev.preOvulatory = preOvulatoryDays(ev, inputs);
  return ev;
}

/** Reasons for a fertile day before S (or in a cycle without S). */
function fertileDayReasons(ev: CycleEvaluation, d: number): FertilityReason[] {
  const reasons: FertilityReason[] = [];
  if (ev.temperatureBlocked) reasons.push(ev.temperatureBlocked);
  if (d <= DEFAULT_PRE_OVULATORY_DAYS && d > ev.preOvulatoryLength && ev.preOvulatoryZeroReason) {
    reasons.push(ev.preOvulatoryZeroReason);
  } else if (d <= DEFAULT_PRE_OVULATORY_DAYS && d > ev.preOvulatoryLength) {
    reasons.push('pre_ovulatory_rule');
  }
  const signs = ev.signsByDay[d - 1];
  if (!ev.temperatureBlocked && signs) {
    if (!signs.temperatureConfirmed) reasons.push('waiting_for_temperature_rise');
    if (!signs.mucusComplete) reasons.push('waiting_for_mucus_peak');
  }
  return reasons.length > 0 ? reasons : ['default_fertile'];
}

/** Section 2 precedence: not applicable, lock, post-ovulatory, pre-ovulatory, fertile. */
function cycleDayOutcome(ev: CycleEvaluation, d: number, inputs: Inputs): DayOutcome {
  if (isNotApplicableOn(inputs.data.contexts, ev.dates[d - 1])) {
    return { status: 'not_applicable', reasons: ['context_not_applicable'] };
  }
  if (ev.locked) {
    const reasons: FertilityReason[] = [];
    // Section 10: postpartum and breastfeeding locks have their own reason code.
    const postpartum =
      isPostpartumOn(inputs.data.contexts, ev.dates[d - 1]) ||
      checkInReportsPostpartum(inputs.data.cycleContextAnswers, ev.cycle.start);
    if (postpartum) reasons.push('method_not_supported_postpartum');
    else if (ev.affected) reasons.push('cycle_locked_context');
    if (ev.checkIn === 'unanswered') reasons.push('cycle_checkin_unanswered');
    return { status: 'fertile', reasons };
  }
  const check = ev.doubleCheck;
  if (check && d === check.S) return { status: 'fertile', reasons: ['evening_transition'], eveningTransition: true };
  if (check && d > check.S) return ev.post?.days.get(d) ?? { status: 'fertile', reasons: ['default_fertile'] };
  const pre = ev.preOvulatory.get(d);
  if (pre && pre.status === 'infertile_pre_ovulatory') return pre;
  const reasons = fertileDayReasons(ev, d);
  return { status: 'fertile', reasons: pre ? orderedReasons([...pre.reasons, ...reasons]) : reasons };
}

function summarize(ev: CycleEvaluation): CycleFertilitySummary {
  const at = (d: number | null) => (d === null ? null : ev.dates[d - 1] ?? null);
  const rise = ev.doubleCheck?.rise ?? ev.displayRise;
  const mucus: MucusResult = ev.doubleCheck?.mucus ?? ev.mucusAtEnd;
  const end = ev.post?.end ?? null;
  return {
    cycleIndex: ev.cycle.index,
    firstCycle: ev.firstCycle,
    locked: ev.locked,
    temperatureBlocked: ev.temperatureBlocked,
    rise:
      rise && ev.unit
        ? {
            fhmDate: ev.dates[rise.fhm - 1],
            coverline: rise.coverline,
            unit: ev.unit,
            rule: rise.rule,
            completeDate: ev.dates[rise.completeDay - 1],
          }
        : null,
    mucus:
      mucus.status === 'NONE'
        ? { peakDate: null, effectivePeakDate: null, completeDate: null, maxQuality: mucus.maxQuality }
        : {
            peakDate: at(mucus.peakDay),
            effectivePeakDate: at(mucus.effectivePeakDay),
            completeDate: at(mucus.completeDay),
            maxQuality: mucus.maxQuality,
          },
    doubleCheckDate: at(ev.doubleCheck?.S ?? null),
    postOvulatoryEnd: end ? { date: ev.dates[end.day - 1], reason: end.reasons[0] } : null,
    preOvulatoryDays: ev.preOvulatoryLength,
  };
}

function readingInfo(date: ISODate, temp: DayTemp, mucus: MucusAssessment): DayReadingInfo {
  return { date, value: temp.value, unit: temp.unit, kind: temp.kind, mucusQuality: mucus.quality };
}

/** Section 5: contraception mode must be on and acknowledged before any day is labelled infertile. */
function isContraceptionModeOn(data: AppData): boolean {
  const mode = data.settings?.contraceptionMode;
  return mode?.enabled === true && typeof mode.acknowledgedAt === 'string' && mode.acknowledgedAt.length > 0;
}

function withoutInfertileLabels(day: DayFertility): DayFertility {
  if (day.status !== 'infertile_pre_ovulatory' && day.status !== 'infertile_post_ovulatory' && !day.eveningTransition) {
    return day;
  }
  return { date: day.date, cycleDay: day.cycleDay, status: 'fertile', inPeriod: day.inPeriod, reasons: ['default_fertile'] };
}

/**
 * Evaluates every day from the first log through `today`. Pure: `today` and
 * the device UTC offset (used to read saved-at instants as local times) are
 * parameters; the clock is never read.
 */
export function evaluateFertility(data: AppData, today: ISODate, deviceUtcOffsetMinutes: number): FertilityResult {
  if (!isISODate(today)) throw new Error(`Invalid ISO date: ${today}`);
  const logs = logsUpTo(data, today);
  const logDates = Object.keys(logs).sort(compareDates);
  const inputs: Inputs = {
    data,
    today,
    logs,
    deviceOffset: validOffset(deviceUtcOffsetMinutes),
    eveningMinutes: clockMinutes(data.settings?.eveningObservationTime),
    offsetSuspect: offsetChangeSuspectDates(logs, logDates),
  };
  if (logDates.length === 0) return { days: [], cycles: [], readings: [] };

  const evaluations: CycleEvaluation[] = [];
  for (const cycle of deriveCycles(logs)) evaluations.push(evaluateCycle(cycle, evaluations, inputs));

  const days: DayFertility[] = [];
  const readings: DayReadingInfo[] = [];
  const firstStart = evaluations[0]?.cycle.start ?? addDays(today, 1);
  for (const date of dateRange(logDates[0], addDays(firstStart, -1))) {
    if (compareDates(date, today) > 0) break;
    const notApplicable = isNotApplicableOn(data.contexts, date);
    days.push({
      date,
      cycleDay: null,
      status: notApplicable ? 'not_applicable' : 'fertile',
      inPeriod: false,
      reasons: notApplicable ? ['context_not_applicable', 'cycle_start_unknown'] : ['cycle_start_unknown'],
    });
    readings.push(readingInfo(date, assessTemperatureDay(inputs, date), assessMucusDay(inputs, date)));
  }
  for (const ev of evaluations) {
    for (let d = 1; d <= ev.L; d++) {
      const outcome = cycleDayOutcome(ev, d, inputs);
      const day: DayFertility = {
        date: ev.dates[d - 1],
        cycleDay: d,
        status: outcome.status,
        inPeriod: d <= ev.periodRunDays,
        reasons: outcome.reasons.length > 0 ? outcome.reasons : ['default_fertile'],
      };
      if (outcome.eveningTransition) day.eveningTransition = true;
      days.push(day);
      readings.push(readingInfo(day.date, ev.temps[d - 1], ev.mucus[d - 1]));
    }
  }
  return {
    days: isContraceptionModeOn(data) ? days : days.map(withoutInfertileLabels),
    cycles: evaluations.map(summarize),
    readings,
  };
}
