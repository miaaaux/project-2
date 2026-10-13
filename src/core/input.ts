// Strict parsing of user-typed values.
//
// parseFloat('36,55') is 36, which would silently create a false low reading,
// so temperatures are parsed from their digits, accept either decimal
// separator, and must show exactly the thermometer's two decimals.

import type { ClockTime, TempUnit } from './types';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const RANGE: Record<TempUnit, [number, number]> = {
  C: [3500, 4200],
  F: [9500, 10760],
};

/** Returns integer hundredths of the unit, e.g. '36,55' -> 3655. */
export function parseTemperature(raw: string, unit: TempUnit, resolution: 0.01 | 0.05): ParseResult<number> {
  const m = /^(\d{2,3})[.,](\d{2})$/.exec(raw.trim());
  if (!m) return { ok: false, error: 'Enter the temperature with two decimals, for example 36.55.' };
  const value = Number(m[1]) * 100 + Number(m[2]);
  const [min, max] = RANGE[unit];
  if (value < min || value > max) {
    return { ok: false, error: `That is outside the expected range (${format(min)}–${format(max)} °${unit}).` };
  }
  if (resolution === 0.05 && value % 5 !== 0) {
    return { ok: false, error: 'Your thermometer shows steps of 0.05; check the last digit.' };
  }
  return { ok: true, value };
}

/** Formats integer hundredths with a dot, e.g. 3655 -> '36.55'. */
export function format(hundredths: number): string {
  const whole = Math.trunc(hundredths / 100);
  const frac = Math.abs(hundredths % 100);
  return `${whole}.${String(frac).padStart(2, '0')}`;
}

export function parseClockTime(raw: string): ParseResult<ClockTime> {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(raw.trim());
  if (!m) return { ok: false, error: 'Use the format 06:30.' };
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return { ok: false, error: 'That is not a valid time.' };
  return { ok: true, value: `${String(h).padStart(2, '0')}:${m[2]}` };
}

/** Minutes since midnight for a valid 'HH:MM', or null. */
export function clockMinutes(time: ClockTime | undefined): number | null {
  if (!time) return null;
  const r = parseClockTime(time);
  if (!r.ok) return null;
  const [h, m] = r.value.split(':').map(Number);
  return h * 60 + m;
}
