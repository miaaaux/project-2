// Context periods and the cycle check-in (section 10, amendment A13).

import { compareDates, isISODate, type ISODate } from '../date';
import type { ContextKind, ContextPeriod, CycleContextAnswer } from '../types';

/** A13: hormonal contraception and pregnancy make the method not applicable; everything else locks the cycle. */
const CONTEXT_EFFECT: Record<ContextKind, 'not_applicable' | 'lock'> = {
  hormonal_contraception: 'not_applicable',
  pregnancy: 'not_applicable',
  postpartum: 'lock',
  breastfeeding: 'lock',
  perimenopause: 'lock',
  emergency_contraception: 'lock',
};

function validContexts(contexts: readonly ContextPeriod[] | undefined): ContextPeriod[] {
  return Array.isArray(contexts) ? contexts.filter((c) => c && typeof c === 'object') : [];
}

/** A context with an unreadable start covers every day; an unreadable end leaves it open (fail closed). */
function covers(c: ContextPeriod, from: ISODate, to: ISODate): boolean {
  const startsBy = typeof c.start !== 'string' || !isISODate(c.start) || compareDates(c.start, to) <= 0;
  const endsAfter = typeof c.end !== 'string' || !isISODate(c.end) || compareDates(c.end, from) >= 0;
  return startsBy && endsAfter;
}

function effectOf(c: ContextPeriod): 'not_applicable' | 'lock' {
  return Object.prototype.hasOwnProperty.call(CONTEXT_EFFECT, c.kind) ? CONTEXT_EFFECT[c.kind] : 'lock';
}

/** A13: hormonal contraception or pregnancy on this day. */
export function isNotApplicableOn(contexts: readonly ContextPeriod[] | undefined, date: ISODate): boolean {
  return validContexts(contexts).some((c) => effectOf(c) === 'not_applicable' && covers(c, date, date));
}

/** A13: readings and mucus from days inside any context period are never used. */
export function isInsideContext(contexts: readonly ContextPeriod[] | undefined, date: ISODate): boolean {
  return validContexts(contexts).some((c) => covers(c, date, date));
}

/** Section 3 + A13: any context period overlapping the cycle makes it affected. */
export function overlapsContext(contexts: readonly ContextPeriod[] | undefined, from: ISODate, to: ISODate): boolean {
  return validContexts(contexts).some((c) => covers(c, from, to));
}

export type CheckIn = 'clear' | 'affected' | 'unanswered';

/**
 * A13: the check-in for a cycle start. Any "yes" (or a non-boolean answer)
 * makes the cycle affected; no answer at all leaves it locked as unanswered.
 */
export function cycleCheckIn(answers: readonly CycleContextAnswer[] | undefined, cycleStart: ISODate): CheckIn {
  const forStart = (Array.isArray(answers) ? answers : []).filter((a) => a && a.cycleStart === cycleStart);
  if (forStart.length === 0) return 'unanswered';
  const allNo = forStart.every(
    (a) =>
      a.birthInLast12Months === false &&
      a.breastfeeding === false &&
      a.hormonalContraceptionSinceLastPeriod === false &&
      a.emergencyContraceptionSinceLastPeriod === false,
  );
  return allNo ? 'clear' : 'affected';
}
