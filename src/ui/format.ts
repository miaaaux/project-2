import type { ISODate } from '../core/date';

function asLocalNoon(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

/** 'Tue 13 Oct' in the device locale. */
export function shortDate(iso: ISODate): string {
  return asLocalNoon(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** '13 Oct' in the device locale. */
export function dayMonth(iso: ISODate): string {
  return asLocalNoon(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function monthTitle(year: number, month0: number): string {
  return new Date(year, month0, 1, 12).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function range(lo: ISODate, hi: ISODate): string {
  return lo === hi ? dayMonth(lo) : `${dayMonth(lo)} – ${dayMonth(hi)}`;
}
