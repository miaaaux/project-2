// Local calendar dates as 'YYYY-MM-DD' strings.
//
// Every log in the app belongs to the user's local calendar day, not to a UTC
// instant: a flight or a daylight-saving change must never move a log to the
// neighbouring day. All arithmetic goes through a day number (days since
// 1970-01-01) computed with Date.UTC, which has no DST.

export type ISODate = string;

const MS_PER_DAY = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(value: string): value is ISODate {
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function assertISODate(value: string): void {
  if (!isISODate(value)) throw new Error(`Invalid ISO date: ${value}`);
}

/** Days since 1970-01-01 for a local calendar date. */
export function toDayNumber(date: ISODate): number {
  assertISODate(date);
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

export function fromDayNumber(n: number): ISODate {
  if (!Number.isInteger(n)) throw new Error(`Day number must be an integer: ${n}`);
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromDayNumber(toDayNumber(date) + days);
}

/** a - b in whole days. */
export function diffDays(a: ISODate, b: ISODate): number {
  return toDayNumber(a) - toDayNumber(b);
}

export function compareDates(a: ISODate, b: ISODate): number {
  return diffDays(a, b);
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return diffDays(a, b) <= 0 ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return diffDays(a, b) >= 0 ? a : b;
}

/** Inclusive list of dates from start to end; empty if end < start. */
export function dateRange(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let n = toDayNumber(start), last = toDayNumber(end); n <= last; n++) out.push(fromDayNumber(n));
  return out;
}

/** The device's local calendar date for an instant. */
export function localDateOf(instant: Date): ISODate {
  const y = instant.getFullYear();
  const m = String(instant.getMonth() + 1).padStart(2, '0');
  const d = String(instant.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
