// Amendment A17: a day the user saw as "not fertile" must never silently become
// fertile after an edit. Pure, so the decision can be tested without a device.

import type { ISODate } from '../core/date';
import { newlyFertileDays, type DayFertility, type FertilityStatus, type ShownDayStatus } from '../core/fertility';
import type { AlertAck, ShownStatus } from '../data/repository';

/** Only not-fertile labels need to be remembered: a day shown as fertile can never cause a false sense of safety. */
export function shouldRecordShown(day: Pick<DayFertility, 'status' | 'eveningTransition'>): boolean {
  return day.status === 'infertile_pre_ovulatory' || day.status === 'infertile_post_ovulatory' || day.eveningTransition === true;
}

/** Shown not-fertile statuses the user has not acknowledged since they were last shown. ISO instants compare as strings. */
export function unacknowledgedShown(shown: readonly ShownStatus[], acks: readonly AlertAck[]): ShownDayStatus[] {
  const lastAck = new Map<ISODate, string>();
  for (const a of acks) if (!lastAck.has(a.date) || a.ackAt > lastAck.get(a.date)!) lastAck.set(a.date, a.ackAt);
  return shown
    .filter((s) => {
      const ack = lastAck.get(s.date);
      return ack === undefined || s.shownAt > ack;
    })
    .map((s) => ({ date: s.date, status: s.status as FertilityStatus, eveningTransition: s.eveningTransition }));
}

/** Dates that need the blocking alert now. */
export function datesNeedingAlert(shown: readonly ShownStatus[], acks: readonly AlertAck[], current: readonly DayFertility[]): ISODate[] {
  return newlyFertileDays(unacknowledgedShown(shown, acks), current);
}
