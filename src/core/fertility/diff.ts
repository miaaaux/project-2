// A17: edit safety. The app stores every status it showed; after any edit it
// re-evaluates and must raise a blocking alert for each day that was shown as
// infertile and no longer is.

import type { ISODate } from '../date';
import type { DayFertility, FertilityStatus } from './model';

/** A status as the app showed it. `eveningTransition` must be stored too: it showed that evening as infertile. */
export interface ShownDayStatus {
  date: ISODate;
  status: FertilityStatus;
  eveningTransition?: boolean;
}

function isInfertile(status: FertilityStatus | undefined): boolean {
  return status === 'infertile_pre_ovulatory' || status === 'infertile_post_ovulatory';
}

/**
 * Dates previously shown as infertile that the current evaluation no longer
 * labels infertile (including dates it no longer covers), ascending. A day shown
 * as "infertile from this evening" counts too once its evening is no longer
 * infertile (neither an evening transition nor an infertile status).
 */
export function newlyFertileDays(
  previouslyShown: readonly ShownDayStatus[],
  current: readonly DayFertility[],
): ISODate[] {
  const now = new Map(current.map((d) => [d.date, d]));
  const out = new Set<ISODate>();
  for (const shown of previouslyShown) {
    const day = now.get(shown.date);
    const infertileNow = isInfertile(day?.status);
    const eveningInfertileNow = infertileNow || day?.eveningTransition === true;
    if (isInfertile(shown.status) && !infertileNow) out.add(shown.date);
    if (shown.eveningTransition === true && !eveningInfertileNow) out.add(shown.date);
  }
  return [...out].sort();
}
