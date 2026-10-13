// Clock times and instants compared with local calendar dates (A5, A10).
//
// An instant is converted to the wall clock of a given UTC offset by integer
// arithmetic on its own fields, so the result never depends on the device's
// time zone. Anything that does not parse returns null and callers fail closed.

import { toDayNumber, type ISODate } from '../date';

const MINUTES_PER_DAY = 1440;
const MS_PER_MINUTE = 60_000;
const MAX_OFFSET_MINUTES = 18 * 60;

const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const INSTANT_RE =
  /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,9}))?)?(Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/;

/** Minutes since midnight for a strict 'HH:MM', or null. */
export function clockMinutes(time: unknown): number | null {
  if (typeof time !== 'string') return null;
  const m = CLOCK_RE.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** A UTC offset in minutes if it is a plausible integer, else null. */
export function validOffset(offset: unknown): number | null {
  return typeof offset === 'number' && Number.isInteger(offset) && Math.abs(offset) <= MAX_OFFSET_MINUTES
    ? offset
    : null;
}

function offsetFromSuffix(suffix: string): number {
  if (suffix === 'Z') return 0;
  const sign = suffix[0] === '-' ? -1 : 1;
  const digits = suffix.slice(1).replace(':', '');
  return sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
}

/**
 * Milliseconds on a "local epoch" (wall clock of `offsetMinutes` counted from
 * 1970-01-01 00:00 local), or null if the instant does not parse.
 */
export function localEpochMs(instant: unknown, offsetMinutes: number | null): number | null {
  if (typeof instant !== 'string' || offsetMinutes === null) return null;
  const m = INSTANT_RE.exec(instant);
  if (!m) return null;
  let day: number;
  try {
    day = toDayNumber(m[1]);
  } catch {
    return null;
  }
  const ms = m[5] ? Number(m[5].padEnd(3, '0').slice(0, 3)) : 0;
  const utcMinutes = day * MINUTES_PER_DAY + Number(m[2]) * 60 + Number(m[3]) - offsetFromSuffix(m[6]);
  const local = (utcMinutes + offsetMinutes) * MS_PER_MINUTE + Number(m[4] ?? 0) * 1000 + ms;
  return Number.isFinite(local) ? local : null;
}

/** The local-epoch millisecond at `minutes` past midnight on `date` (+ `dayOffset` days). */
export function localWallClockMs(date: ISODate, dayOffset: number, minutes: number): number {
  return ((toDayNumber(date) + dayOffset) * MINUTES_PER_DAY + minutes) * MS_PER_MINUTE;
}

const RECALL_CUTOFF_MINUTES = 12 * 60;

/** A10: saved later than 12:00 local on the day after `date`. Unparseable counts as recalled. */
export function isRecalled(savedAt: unknown, date: ISODate, offsetMinutes: number | null): boolean {
  const local = localEpochMs(savedAt, offsetMinutes);
  return local === null || local > localWallClockMs(date, 1, RECALL_CUTOFF_MINUTES);
}

/** A10: a completion counts only from the evening observation time on its own date (or any later day). */
export function isCompletedInEvening(
  completedAt: unknown,
  date: ISODate,
  eveningMinutes: number | null,
  offsetMinutes: number | null,
): boolean {
  if (eveningMinutes === null) return false;
  const local = localEpochMs(completedAt, offsetMinutes);
  return local !== null && local >= localWallClockMs(date, 0, eveningMinutes);
}
