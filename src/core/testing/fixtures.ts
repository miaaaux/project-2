// Builders for test data. Shared by every core test so fixtures read the same way.

import { addDays, type ISODate } from '../date';
import type {
  AppData,
  DailyLog,
  MucusAppearance,
  MucusObservation,
  MucusSensation,
  Settings,
  TemperatureReading,
} from '../types';
import { DEFAULT_SETTINGS } from '../types';

/** A fixed "saved at" instant, far enough after any fixture date that nothing counts as recalled late by default. */
export const SAVED_AT = '2026-01-01T20:00:00.000Z';

export function log(date: ISODate, partial: Partial<DailyLog> = {}): DailyLog {
  return { date, temperatures: [], updatedAt: SAVED_AT, ...partial };
}

/** Build a log map from entries; later entries for the same date are merged over earlier ones. */
export function logs(...entries: DailyLog[]): Record<ISODate, DailyLog> {
  const out: Record<ISODate, DailyLog> = {};
  for (const e of entries) out[e.date] = out[e.date] ? { ...out[e.date], ...e } : e;
  return out;
}

/** One log per day starting at `start`; `null` leaves a day unlogged. */
export function series(start: ISODate, days: (Partial<DailyLog> | null)[]): DailyLog[] {
  return days.flatMap((partial, i) => (partial === null ? [] : [log(addDays(start, i), partial)]));
}

let readingSeq = 0;

/** A °C reading from a decimal value, e.g. temp(36.55). */
export function temp(celsius: number, opts: Partial<TemperatureReading> = {}): TemperatureReading {
  readingSeq += 1;
  return {
    id: `t${readingSeq}`,
    value: Math.round(celsius * 100),
    unit: 'C',
    raw: celsius.toFixed(2),
    measuredAt: '06:30',
    utcOffsetMinutes: 60,
    route: 'oral',
    thermometerId: 'default',
    enteredAt: SAVED_AT,
    ...opts,
  };
}

export function mucus(
  sensation: MucusSensation | undefined,
  appearance: MucusAppearance | undefined,
  opts: Partial<MucusObservation> = {},
): MucusObservation {
  return {
    sensation,
    appearance,
    observationComplete: true,
    completedAt: SAVED_AT,
    enteredAt: SAVED_AT,
    updatedAt: SAVED_AT,
    ...opts,
  };
}

export function settings(partial: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    usualMeasurementTimes: [{ effectiveFrom: '2000-01-01', time: '06:30' }],
    ...partial,
  };
}

export function appData(partial: Partial<AppData> = {}): AppData {
  return { logs: {}, exercise: [], contexts: [], cycleContextAnswers: [], settings: settings(), ...partial };
}
