// Cycles are delimited by the days the user confirmed "my period started".
//
// Spotting never starts a cycle. Bleeding that is not confirmed as a period
// start is surfaced as a prompt (unconfirmedBleedingStarts), and the fertility
// rules treat it as a possible new cycle, but it does not move cycle
// boundaries until the user confirms it.

import { addDays, compareDates, diffDays, type ISODate } from './date';
import type { DailyLog, Flow } from './types';

export interface Cycle {
  /** 0-based position among confirmed cycles, oldest first. */
  index: number;
  /** Cycle day 1. */
  start: ISODate;
  /** Last day of the cycle (the day before the next start), or null for the current, open cycle. */
  end: ISODate | null;
  /** Days from this start to the next start, or null for the open cycle. */
  length: number | null;
  /** Last day of the period run. */
  periodEnd: ISODate;
  periodLength: number;
  /** Spotting days immediately before cycle day 1. They belong to the previous cycle. */
  leadingSpottingDays: number;
}

/** Flow that counts as a period day (not spotting). */
export function isPeriodFlow(flow: Flow | undefined): boolean {
  return flow === 'light' || flow === 'medium' || flow === 'heavy';
}

/** Trailing spotting days that may still extend a period run. */
const MAX_TRAILING_SPOTTING_DAYS = 2;

function periodRunEnd(logs: Record<ISODate, DailyLog>, start: ISODate): ISODate {
  let end = start;
  let d = addDays(start, 1);
  while (isPeriodFlow(logs[d]?.flow)) {
    end = d;
    d = addDays(d, 1);
  }
  for (let i = 0; i < MAX_TRAILING_SPOTTING_DAYS && logs[d]?.flow === 'spotting'; i++) {
    end = d;
    d = addDays(d, 1);
  }
  return end;
}

function countLeadingSpotting(logs: Record<ISODate, DailyLog>, start: ISODate): number {
  let n = 0;
  for (let d = addDays(start, -1); logs[d]?.flow === 'spotting'; d = addDays(d, -1)) n++;
  return n;
}

export function deriveCycles(logs: Record<ISODate, DailyLog>): Cycle[] {
  const confirmed = Object.values(logs)
    .filter((l) => l.periodStartConfirmed)
    .map((l) => l.date)
    .sort(compareDates);

  // A confirmation inside the previous period run is a duplicate tap, not a new
  // cycle, so every kept start lies after the previous period run.
  const starts: { start: ISODate; periodEnd: ISODate }[] = [];
  for (const start of confirmed) {
    const prev = starts[starts.length - 1];
    if (prev && compareDates(start, prev.periodEnd) <= 0) continue;
    starts.push({ start, periodEnd: periodRunEnd(logs, start) });
  }

  return starts.map(({ start, periodEnd }, index) => {
    const next = starts[index + 1];
    return {
      index,
      start,
      end: next ? addDays(next.start, -1) : null,
      length: next ? diffDays(next.start, start) : null,
      periodEnd,
      periodLength: diffDays(periodEnd, start) + 1,
      leadingSpottingDays: countLeadingSpotting(logs, start),
    };
  });
}

/** 1-based cycle day of `date` in `cycle`. */
export function cycleDay(cycle: Cycle, date: ISODate): number {
  return diffDays(date, cycle.start) + 1;
}

/** The cycle containing `date`, or undefined before the first confirmed start. */
export function findCycle(cycles: Cycle[], date: ISODate): Cycle | undefined {
  for (let i = cycles.length - 1; i >= 0; i--) {
    const c = cycles[i];
    if (compareDates(date, c.start) >= 0) {
      return c.end === null || compareDates(date, c.end) <= 0 ? c : undefined;
    }
  }
  return undefined;
}

export function isInPeriod(cycle: Cycle, date: ISODate): boolean {
  return compareDates(date, cycle.start) >= 0 && compareDates(date, cycle.periodEnd) <= 0;
}

/**
 * Days where period-like bleeding began but no period start was confirmed.
 * The app asks "Did your period start?" for each of these.
 */
export function unconfirmedBleedingStarts(logs: Record<ISODate, DailyLog>, cycles: Cycle[]): ISODate[] {
  return Object.values(logs)
    .filter((l) => isPeriodFlow(l.flow) && !isPeriodFlow(logs[addDays(l.date, -1)]?.flow))
    .map((l) => l.date)
    .filter((date) => !cycles.some((c) => isInPeriod(c, date)))
    .sort(compareDates);
}
