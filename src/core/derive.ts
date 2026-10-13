// One pure pass from everything the user logged to what the screens show.
//
// derive() wires the core modules together in a fixed order: cycles, the
// fertility engine, the prediction (fed by the confirmed temperature rises),
// then reminders, the prep card, patterns and red flags, which all read the
// prediction. It is deterministic and never mutates `data`.

import { deriveCycles, unconfirmedBleedingStarts, type Cycle } from './cycles';
import { compareDates, isISODate, type ISODate } from './date';
import { evaluateFertility, type DayFertility, type FertilityResult } from './fertility';
import { habitPatterns, prepCard, type HabitPattern, type PrepCard } from './painGuide';
import { calendarFertileWindow, predictNextPeriod, type Prediction, type RiseInfo } from './prediction';
import { evaluateRedFlags, type RedFlag } from './redFlags';
import { desiredReminders, type DesiredReminder } from './reminders';
import type { AppData, ClockTime, DailyLog, Settings } from './types';

export interface DeriveOptions {
  /** The device's local calendar date. */
  today: ISODate;
  /** The same clock reading as `today`, with the local time; the reminder sync takes it alongside the derived reminders. */
  now: { date: ISODate; time: ClockTime };
  /** Used by the fertility engine to read saved-at instants as local times. */
  deviceUtcOffsetMinutes: number;
}

export interface DerivedState {
  today: ISODate;
  /** Confirmed cycles, oldest first. Indices match `fertility.cycles[].cycleIndex`. */
  cycles: Cycle[];
  /** The open cycle that contains today, or null before the first confirmed period start. */
  currentCycle: Cycle | null;
  /** Always computed, so the chart can show the rise and the mucus peak in any mode. */
  fertility: FertilityResult;
  /** Contraception mode is on and its explainer was acknowledged. */
  fertilityVisible: boolean;
  /** Today's status, only while `fertilityVisible`; otherwise null so no screen can show it. */
  todayFertility: DayFertility | null;
  /** Confirmed temperature rises, one per cycle that has one; these feed the post-rise prediction. */
  rises: RiseInfo[];
  prediction: Prediction;
  /** Calendar-only estimate, wide on purpose. It never makes a day infertile. */
  fertileWindowEstimate: { start: ISODate; end: ISODate } | null;
  reminders: DesiredReminder[];
  prepCard: PrepCard | null;
  patterns: HabitPattern[];
  redFlags: RedFlag[];
  /** Period-like bleeding to ask "Did your period start?" about; days the user answered "no" are left out. */
  unconfirmedBleedingStarts: ISODate[];
}

/** SPEC §5: infertile statuses need contraception mode on and the explainer acknowledged. */
export function isFertilityVisible(settings: Settings): boolean {
  const mode = settings.contraceptionMode;
  return mode.enabled === true && typeof mode.acknowledgedAt === 'string' && mode.acknowledgedAt.length > 0;
}

/**
 * Logs dated today or earlier, keyed by valid dates. The fertility engine
 * applies the same filter, so both see the same cycles and their indices
 * match. A future-dated log only exists after the clock or time zone moved
 * back, and counts once its day arrives.
 */
export function logsThrough(logs: Record<ISODate, DailyLog>, today: ISODate): Record<ISODate, DailyLog> {
  const out: Record<ISODate, DailyLog> = {};
  for (const [key, entry] of Object.entries(logs)) {
    if (!isISODate(key) || !entry || compareDates(key, today) > 0) continue;
    out[key] = entry.date === key ? entry : { ...entry, date: key };
  }
  return out;
}

/** The rise of each cycle the fertility engine found one in, for the prediction. */
export function confirmedRises(fertility: FertilityResult): RiseInfo[] {
  return fertility.cycles.flatMap((c) => (c.rise ? [{ cycleIndex: c.cycleIndex, fhmDate: c.rise.fhmDate }] : []));
}

export function derive(data: AppData, options: DeriveOptions): DerivedState {
  const { today, deviceUtcOffsetMinutes } = options;
  if (!isISODate(today)) throw new Error(`Invalid ISO date: ${today}`);
  const { settings, contexts, exercise } = data;

  const logs = logsThrough(data.logs, today);
  const cycles = deriveCycles(logs);
  const currentCycle = cycles.find((c) => c.end === null) ?? null;

  const fertility = evaluateFertility(data, today, deviceUtcOffsetMinutes);
  const fertilityVisible = isFertilityVisible(settings);
  const todayFertility = fertilityVisible ? (fertility.days.find((d) => d.date === today) ?? null) : null;

  const rises = confirmedRises(fertility);
  const confirmedRealCycles = cycles.filter((c) => settings.confirmedRealCycleStarts?.includes(c.start)).map((c) => c.index);
  const prediction = predictNextPeriod({ cycles, contexts, settings, rises, confirmedRealCycles, today });

  return {
    today,
    cycles,
    currentCycle,
    fertility,
    fertilityVisible,
    todayFertility,
    rises,
    prediction,
    fertileWindowEstimate: calendarFertileWindow(prediction, currentCycle ?? undefined),
    reminders: desiredReminders({ currentCycle: currentCycle ?? undefined, prediction, settings, contexts, today }),
    prepCard: prepCard({ logs, exercise, settings, prediction, today }),
    patterns: habitPatterns({ logs, exercise, settings, cycles }),
    redFlags: evaluateRedFlags({ cycles, logs, contexts, prediction, today }),
    unconfirmedBleedingStarts: unconfirmedBleedingStarts(logs, cycles).filter((d) => logs[d]?.notPeriodStart !== true),
  };
}
