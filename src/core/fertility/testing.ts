// Fertility-specific test builders on top of src/core/testing/fixtures.ts.
//
// Fixture cycles from docs/fertility-rules.md section 12: P (low temperatures),
// T1hi (the rise), Mbase (bleeding and mucus) and Hstd (a standard history).

import { addDays, diffDays, type ISODate } from '../date';
import type {
  AppData,
  ContextPeriod,
  CycleContextAnswer,
  DailyLog,
  Flow,
  MucusObservation,
  Settings,
  TemperatureReading,
} from '../types';
import { appData, log, mucus as mucusFixture, settings, temp } from '../testing/fixtures';
import { evaluateFertility } from './evaluate';
import type { DayFertility, FertilityResult } from './model';

/** Device UTC offset passed to the engine in tests (UTC+1). */
export const DEVICE_OFFSET = 60;

/** P: CD1-15 temperatures (°C). No day in CD7-15 is >= 0.05 above its 6 lows. */
export const P = [36.5, 36.4, 36.45, 36.4, 36.5, 36.45, 36.4, 36.45, 36.5, 36.4, 36.45, 36.4, 36.5, 36.45, 36.4];
/** T1hi from CD16: 36.60, 36.65, then 36.75. */
export const T1HI = [36.6, 36.65, 36.75];
export const HIGH = 36.75;

function offsetSuffix(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** An instant at local wall-clock `time` on `date` at the given UTC offset. */
export function localInstant(date: ISODate, time: string, offsetMinutes = DEVICE_OFFSET): string {
  return `${date}T${time}:00${offsetSuffix(offsetMinutes)}`;
}

/** A °C reading measured at 06:30 and saved right after, on `date`. */
export function reading(celsius: number, date: ISODate, opts: Partial<TemperatureReading> = {}): TemperatureReading {
  const offset = opts.utcOffsetMinutes ?? DEVICE_OFFSET;
  return temp(celsius, { utcOffsetMinutes: offset, enteredAt: localInstant(date, '06:35', offset), ...opts });
}

/** A °F reading; the value is stored in hundredths of °F and never converted. */
export function readingF(fahrenheit: number, date: ISODate, opts: Partial<TemperatureReading> = {}): TemperatureReading {
  return reading(0, date, { value: Math.round(fahrenheit * 100), unit: 'F', raw: fahrenheit.toFixed(2), ...opts });
}

export type MucusCode = 't' | 'Ø' | 'f' | 'S' | 'S+' | 'NA';

const MUCUS_CODES: Record<MucusCode, Partial<MucusObservation>> = {
  t: { sensation: 'dry', appearance: 'nothing' },
  'Ø': { sensation: 'nothing', appearance: 'nothing' },
  f: { sensation: 'moist', appearance: 'nothing' },
  S: { sensation: 'nothing', appearance: 'creamy' },
  'S+': { sensation: 'slippery', appearance: 'egg_white' },
  NA: { notAssessable: 'bleeding' },
};

/** A final evening observation (completed and saved at 20:00 local on `date`). */
export function obs(
  code: MucusCode,
  date: ISODate,
  opts: Partial<MucusObservation> = {},
  offsetMinutes = DEVICE_OFFSET,
): MucusObservation {
  const at = localInstant(date, '20:00', offsetMinutes);
  const base = MUCUS_CODES[code];
  return mucusFixture(base.sensation, base.appearance, {
    ...base,
    completedAt: at,
    enteredAt: at,
    updatedAt: at,
    ...opts,
  });
}

export interface DaySpec {
  /** Temperature in the cycle's unit (°C unless `unit: 'F'`); null or absent = no reading. */
  t?: number | null;
  /** Options for the reading built from `t`. */
  tOpts?: Partial<TemperatureReading>;
  /** Explicit readings (override `t`). */
  readings?: TemperatureReading[];
  m?: MucusCode | null;
  mOpts?: Partial<MucusObservation>;
  /** Explicit mucus observation (overrides `m`); null = no mucus entry. */
  mucus?: MucusObservation | null;
  flow?: Flow;
  extra?: Partial<DailyLog>;
  /** No log at all on this day. */
  skip?: true;
}

/** Specs indexed by cycle day (1-based) merged over a base list. */
export function withDays(base: DaySpec[], overrides: Record<number, DaySpec | null>): DaySpec[] {
  const out = [...base];
  for (const [cd, spec] of Object.entries(overrides)) {
    const i = Number(cd) - 1;
    while (out.length <= i) out.push({});
    out[i] = spec === null ? { skip: true } : { ...out[i], ...spec };
  }
  return out;
}

/** Mbase: CD1-4 H,H,M,L (not assessable), CD5 spotting t, CD6-8 t, CD9-10 Ø, CD11 f, CD12-13 S, CD14-15 S+, CD16 S, CD17 f, CD18 Ø, then t. */
export function mbase(length = 28): DaySpec[] {
  const bleeding: Flow[] = ['heavy', 'heavy', 'medium', 'light'];
  const pattern: MucusCode[] = ['t', 't', 't', 't', 'Ø', 'Ø', 'f', 'S', 'S', 'S+', 'S+', 'S', 'f', 'Ø'];
  return Array.from({ length }, (_, i): DaySpec => {
    if (i < 4) return { flow: bleeding[i], m: 'NA' };
    if (i === 4) return { flow: 'spotting', m: 't' };
    return { flow: 'none', m: pattern[i - 4] ?? 't' };
  });
}

/** P + T1hi, then 36.75 until `length`. */
export function standardTemps(length = 28): number[] {
  return Array.from({ length }, (_, i) => (i < 15 ? P[i] : (T1HI[i - 15] ?? HIGH)));
}

/** Test 01 data: P + T1hi and Mbase. */
export function standardCycle(length = 28): DaySpec[] {
  const temps = standardTemps(length);
  return mbase(length).map((spec, i) => ({ ...spec, t: temps[i] }));
}

/**
 * A charted, double-checked history cycle with its FHM on `fhm` (P-pattern
 * lows before it, 36.60/36.65/36.75 from it) and a mucus peak on fhm - 1.
 */
export function historyCycle(fhm = 15, length = 28): DaySpec[] {
  const peak = fhm - 1;
  return Array.from({ length }, (_, i): DaySpec => {
    const cd = i + 1;
    const t = cd < fhm ? P[(cd - 1) % P.length] : (T1HI[cd - fhm] ?? HIGH);
    if (cd <= 4) return { t, flow: (['heavy', 'heavy', 'medium', 'light'] as Flow[])[i], m: 'NA' };
    if (cd === 5) return { t, flow: 'spotting', m: 't' };
    const offset = cd - peak;
    const code: MucusCode =
      offset === -3 ? 'f' : offset === -2 ? 'S' : offset === -1 || offset === 0 ? 'S+' : offset === 1 ? 'S' : offset === 2 ? 'f' : offset === 3 ? 'Ø' : 't';
    return { t, flow: 'none', m: code };
  });
}

/** `count` standard history cycles (Hstd when count = 1). */
export function hstd(count = 1, fhm = 15): DaySpec[][] {
  return Array.from({ length: count }, () => historyCycle(fhm));
}

export function cycleLogs(
  start: ISODate,
  specs: DaySpec[],
  opts: { unit?: 'C' | 'F'; confirmStart?: boolean; mucusOffset?: number } = {},
): DailyLog[] {
  return specs.flatMap((spec, i) => {
    if (spec.skip) return [];
    const date = addDays(start, i);
    const readings =
      spec.readings ??
      (spec.t === undefined || spec.t === null
        ? []
        : [opts.unit === 'F' ? readingF(spec.t, date, spec.tOpts) : reading(spec.t, date, spec.tOpts)]);
    const mucusEntry = spec.mucus !== undefined ? spec.mucus ?? undefined : spec.m ? obs(spec.m, date, spec.mOpts, opts.mucusOffset) : undefined;
    const partial: Partial<DailyLog> = { temperatures: readings, ...spec.extra };
    if (mucusEntry) partial.mucus = mucusEntry;
    if (spec.flow !== undefined) partial.flow = spec.flow;
    if (i === 0 && opts.confirmStart !== false) partial.periodStartConfirmed = true;
    return [log(date, partial)];
  });
}

export function noAnswer(cycleStart: ISODate): CycleContextAnswer {
  return {
    cycleStart,
    answeredAt: localInstant(cycleStart, '09:00'),
    birthInLast12Months: false,
    breastfeeding: false,
    hormonalContraceptionSinceLastPeriod: false,
    emergencyContraceptionSinceLastPeriod: false,
  };
}

/** Settings with contraception mode on and the usual time 06:30 since 2000. */
export function fertilitySettings(partial: Partial<Settings> = {}): Settings {
  return settings({ contraceptionMode: { enabled: true, acknowledgedAt: '2025-01-01T10:00:00Z' }, ...partial });
}

export interface Scenario {
  /** History cycles, oldest first, placed back to back before the current start. */
  previous?: DaySpec[][];
  current: DaySpec[];
  /** Logs of the next cycle (its first day confirms the period start). */
  next?: DaySpec[];
  unit?: 'C' | 'F';
  previousUnit?: 'C' | 'F';
  contexts?: ContextPeriod[];
  settings?: Partial<Settings>;
  /** Answers for the cycle starts; default: "no" to everything for every confirmed start. */
  answers?: CycleContextAnswer[];
  extraLogs?: DailyLog[];
  /** UTC offset written into mucus timestamps (default DEVICE_OFFSET). */
  mucusOffset?: number;
}

export interface Built {
  data: AppData;
  /** Start dates of every cycle in the scenario, oldest first (current is starts[previous.length]). */
  starts: ISODate[];
  current: ISODate;
  /** Date of cycle day `cd` of the current cycle. */
  cd: (cd: number) => ISODate;
}

export function build(currentStart: ISODate, s: Scenario): Built {
  const previous = s.previous ?? [];
  const starts: ISODate[] = [];
  let cursor = currentStart;
  for (let i = previous.length - 1; i >= 0; i--) {
    cursor = addDays(cursor, -previous[i].length);
    starts.unshift(cursor);
  }
  starts.push(currentStart);
  const all: DailyLog[] = [];
  const mucusOffset = s.mucusOffset;
  previous.forEach((specs, i) => all.push(...cycleLogs(starts[i], specs, { unit: s.previousUnit, mucusOffset })));
  all.push(...cycleLogs(currentStart, s.current, { unit: s.unit, mucusOffset }));
  if (s.next) {
    const nextStart = addDays(currentStart, s.current.length);
    starts.push(nextStart);
    all.push(...cycleLogs(nextStart, s.next, { unit: s.unit, mucusOffset }));
  }
  if (s.extraLogs) all.push(...s.extraLogs);
  const byDate: Record<ISODate, DailyLog> = {};
  for (const l of all) byDate[l.date] = byDate[l.date] ? { ...byDate[l.date], ...l } : l;
  const answers = s.answers ?? Object.values(byDate).filter((l) => l.periodStartConfirmed).map((l) => noAnswer(l.date));
  return {
    data: appData({
      logs: byDate,
      contexts: s.contexts ?? [],
      cycleContextAnswers: answers,
      settings: fertilitySettings(s.settings),
    }),
    starts,
    current: currentStart,
    cd: (cd: number) => addDays(currentStart, cd - 1),
  };
}

export function run(data: AppData, today: ISODate, offset = DEVICE_OFFSET): FertilityResult {
  return evaluateFertility(data, today, offset);
}

export function dayOf(result: FertilityResult, date: ISODate): DayFertility {
  const day = result.days.find((d) => d.date === date);
  if (!day) throw new Error(`No result for ${date}`);
  return day;
}

/**
 * One letter per day from cycle day `from` to `to` of the cycle starting at
 * `start`: P pre-ovulatory infertile, I post-ovulatory infertile, F fertile,
 * E fertile with eveningTransition, N not applicable, - not evaluated.
 */
export function codes(result: FertilityResult, start: ISODate, from: number, to: number): string {
  const byDate = new Map(result.days.map((d) => [d.date, d]));
  let out = '';
  for (let cd = from; cd <= to; cd++) {
    const d = byDate.get(addDays(start, cd - 1));
    if (!d) out += '-';
    else if (d.status === 'infertile_pre_ovulatory') out += 'P';
    else if (d.status === 'infertile_post_ovulatory') out += 'I';
    else if (d.status === 'not_applicable') out += 'N';
    else out += d.eveningTransition ? 'E' : 'F';
  }
  return out;
}

/** Expands 'P5 F12 E1 I10' into 'PPPPPFFFFFFFFFFFFEIIIIIIIIII'. */
export function seq(pattern: string): string {
  return pattern
    .trim()
    .split(/\s+/)
    .map((part) => part[0].repeat(Number(part.slice(1))))
    .join('');
}

/** Cycle day of `date` in a cycle starting at `start`. */
export function cycleDayOf(start: ISODate, date: ISODate): number {
  return diffDays(date, start) + 1;
}
