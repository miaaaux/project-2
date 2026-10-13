import { deriveCycles, type Cycle } from './cycles';
import { addDays, diffDays, type ISODate } from './date';
import {
  calendarFertileWindow,
  classifyCycles,
  isSuspectedMissedLog,
  predictionSnapshot,
  predictNextPeriod,
  regularityLimit,
  scorePredictions,
  type Prediction,
  type PredictionInput,
  type RiseInfo,
} from './prediction';
import { log, logs, settings } from './testing/fixtures';
import type { ContextPeriod } from './types';

const TODAY = '2026-10-13';

/** Confirmed period starts from `first`, `lengths` days apart; the last start opens the current cycle. */
function history(first: ISODate, lengths: number[]): Cycle[] {
  const starts = [first];
  for (const length of lengths) starts.push(addDays(starts[starts.length - 1], length));
  return deriveCycles(logs(...starts.map((d) => log(d, { flow: 'heavy', periodStartConfirmed: true }))));
}

function current(cycles: Cycle[]): Cycle {
  return cycles[cycles.length - 1];
}

function predict(cycles: Cycle[], partial: Partial<PredictionInput> = {}): Prediction {
  return predictNextPeriod({ cycles, contexts: [], settings: settings(), rises: [], today: TODAY, ...partial });
}

/** center/lo/hi as day offsets from `from` (the current cycle start by default). */
function offsets(p: Prediction, from: ISODate | null = p.cycleStart) {
  if (!from || !p.center || !p.lo || !p.hi) throw new Error('no prediction');
  return { center: diffDays(p.center, from), lo: diffDays(p.lo, from), hi: diffDays(p.hi, from) };
}

function rise(cycle: Cycle, cycleDay: number): RiseInfo {
  return { cycleIndex: cycle.index, fhmDate: addDays(cycle.start, cycleDay - 1) };
}

function context(start: ISODate, end?: ISODate, kind: ContextPeriod['kind'] = 'hormonal_contraception'): ContextPeriod {
  return { id: `${kind}-${start}`, kind, start, end };
}

describe('predictNextPeriod: no history', () => {
  test('without any period start there is no prediction', () => {
    const p = predict([]);
    expect(p).toMatchObject({
      basis: 'none',
      cycleStart: null,
      center: null,
      lo: null,
      hi: null,
      confidence: 'none',
      regular: null,
      status: 'none',
      lateByDays: 0,
      eligibleLengths: [],
      excludedCycles: [],
      askAboutCycles: [],
      suspectedMissedLogCycles: [],
    });
  });

  test('one period start and no onboarding answer: 28 days, -4/+7', () => {
    const cycles = history('2026-09-20', []);
    const p = predict(cycles);
    expect(p.basis).toBe('prior');
    expect(p.confidence).toBe('estimate');
    expect(p.cycleStart).toBe('2026-09-20');
    expect(offsets(p)).toEqual({ center: 28, lo: 24, hi: 35 });
    expect(p).toMatchObject({ priorLength: 28, priorFromUser: false, regular: null });
    expect(p.excludedCycles).toEqual([{ index: 0, reason: 'open' }]);
  });

  test('the onboarding answer replaces 28', () => {
    const p = predict(history('2026-09-20', []), { settings: settings({ typicalCycleLength: 32 }) });
    expect(offsets(p)).toEqual({ center: 32, lo: 28, hi: 39 });
    expect(p).toMatchObject({ basis: 'prior', priorLength: 32, priorFromUser: true });
  });

  test.each([0, 10, 120, Number.NaN])('an unusable onboarding answer (%p) falls back to 28', (typicalCycleLength) => {
    const p = predict(history('2026-09-20', []), { settings: settings({ typicalCycleLength }) });
    expect(p).toMatchObject({ priorLength: 28, priorFromUser: false });
    expect(offsets(p).center).toBe(28);
  });

  test('a fractional onboarding answer is rounded to whole days', () => {
    const p = predict(history('2026-09-20', []), { settings: settings({ typicalCycleLength: 29.6 }) });
    expect(offsets(p).center).toBe(30);
  });
});

describe('predictNextPeriod: early data (1-2 cycles)', () => {
  test('one cycle is averaged with the prior, with at least +-4 days', () => {
    const p = predict(history('2026-08-01', [30]));
    expect(p).toMatchObject({ basis: 'early', confidence: 'early', regular: null, eligibleLengths: [30] });
    expect(offsets(p)).toEqual({ center: 29, lo: 25, hi: 33 });
  });

  test('two cycles: the range widens to their spread', () => {
    const p = predict(history('2026-07-01', [26, 34]));
    // round(mean(26, 34, 28)) = round(29.33) = 29; spread max(4, 8) = 8
    expect(offsets(p)).toEqual({ center: 29, lo: 21, hi: 37 });
  });

  test('short history shrinks toward the onboarding answer', () => {
    const p = predict(history('2026-08-01', [36]), { settings: settings({ typicalCycleLength: 30 }) });
    expect(offsets(p)).toEqual({ center: 33, lo: 29, hi: 37 });
  });

  test.each([
    [[45], { center: 37, lo: 33, hi: 45 }],
    [[40, 42], { center: 37, lo: 33, hi: 42 }],
    [[20], { center: 24, lo: 20, hi: 28 }],
  ])('the range always covers the observed cycles (%j)', (lengths, expected) => {
    // Shrinking toward the prior moves the centre, but a period exactly as long as last time is never "late".
    expect(offsets(predict(history('2026-01-05', lengths)))).toEqual(expected);
  });

  test('a very wide early range never starts before day 15 of the current cycle', () => {
    const p = predict(history('2026-06-01', [15, 45]));
    // center round(88 / 3) = 29, spread 30 -> lo would be -1
    expect(offsets(p)).toEqual({ center: 29, lo: 15, hi: 59 });
    expect(p.askAboutCycles).toEqual([1]);
    expect(p.eligibleLengths).toEqual([15, 45]);
  });
});

describe('predictNextPeriod: established history', () => {
  test('regular user: median of 6 cycles, range never narrower than +-2', () => {
    const p = predict(history('2026-01-05', [28, 29, 27, 28, 30, 28]));
    expect(p).toMatchObject({
      basis: 'calendar',
      confidence: 'established',
      regular: true,
      eligibleLengths: [28, 29, 27, 28, 30, 28],
      askAboutCycles: [],
    });
    expect(offsets(p)).toEqual({ center: 28, lo: 26, hi: 30 });
  });

  test('3 to 5 cycles are "building"', () => {
    const p = predict(history('2026-03-01', [28, 31, 29, 30]));
    expect(p.confidence).toBe('building');
    // median 29.5 rounds to 30; lo min(28, 28); hi max(31, 32)
    expect(offsets(p)).toEqual({ center: 30, lo: 28, hi: 32 });
  });

  test('only the last 6 eligible cycles count', () => {
    const p = predict(history('2025-10-01', [40, 40, 28, 28, 29, 28, 28, 27]));
    expect(p.eligibleLengths).toEqual([28, 28, 29, 28, 28, 27]);
    expect(offsets(p)).toEqual({ center: 28, lo: 26, hi: 30 });
  });

  test('one outlier widens the range but barely moves the center', () => {
    const p = predict(history('2026-01-05', [28, 28, 28, 41, 28, 28]));
    // The mean would be 30; the median stays 28.
    expect(offsets(p)).toEqual({ center: 28, lo: 26, hi: 41 });
    expect(p.regular).toBe(false);
    expect(p.askAboutCycles).toEqual([]);
    expect(p.excludedCycles).toEqual([{ index: 6, reason: 'open' }]);
  });

  test('a cycle of 1.5x the median is asked about but kept', () => {
    const p = predict(history('2026-01-05', [28, 28, 45, 28, 28, 28]));
    expect(p.askAboutCycles).toEqual([2]);
    expect(p.eligibleLengths).toContain(45);
    expect(offsets(p)).toEqual({ center: 28, lo: 26, hi: 45 });
  });

  test('a user with consistently long cycles is not asked about them', () => {
    const p = predict(history('2026-01-05', [45, 46, 44, 45]));
    expect(p.askAboutCycles).toEqual([]);
    expect(offsets(p)).toEqual({ center: 45, lo: 43, hi: 47 });
  });
});

describe('predictNextPeriod: suspected missed logs', () => {
  const missed = history('2026-01-01', [29, 29, 29, 58, 29, 29]);

  test('a 58-day cycle among 29-day cycles is excluded until confirmed', () => {
    const p = predict(missed);
    expect(p.excludedCycles).toEqual([
      { index: 3, reason: 'suspected_missed_log' },
      { index: 6, reason: 'open' },
    ]);
    expect(p.askAboutCycles).toEqual([3]);
    expect(p.suspectedMissedLogCycles).toEqual([3]);
    expect(p.eligibleLengths).toEqual([29, 29, 29, 29, 29]);
    expect(p.confidence).toBe('building');
    expect(offsets(p)).toEqual({ center: 29, lo: 27, hi: 31 });
  });

  test('a long cycle the user confirmed as real counts and widens the range', () => {
    const p = predict(missed, { confirmedRealCycles: [3] });
    expect(p.excludedCycles).toEqual([{ index: 6, reason: 'open' }]);
    expect(p.askAboutCycles).toEqual([]);
    expect(p.suspectedMissedLogCycles).toEqual([]);
    expect(p.eligibleLengths).toEqual([29, 29, 29, 58, 29, 29]);
    expect(offsets(p)).toEqual({ center: 29, lo: 27, hi: 58 });
    expect(p.regular).toBe(false);
  });

  test('about 3x the median is also a suspected missed log', () => {
    const p = predict(history('2026-01-01', [28, 28, 28, 85, 28]));
    expect(p.excludedCycles).toContainEqual({ index: 3, reason: 'suspected_missed_log' });
  });

  test('two missed logs in a row are both caught', () => {
    const p = predict(history('2026-01-01', [29, 29, 58, 58, 29, 29]));
    expect(p.excludedCycles.filter((e) => e.reason === 'suspected_missed_log').map((e) => e.index)).toEqual([2, 3]);
  });

  test('with too little history the prior is the reference', () => {
    const p = predict(history('2026-07-01', [58]));
    expect(p.excludedCycles).toContainEqual({ index: 0, reason: 'suspected_missed_log' });
    expect(p.basis).toBe('prior');
    expect(offsets(p)).toEqual({ center: 28, lo: 24, hi: 35 });
  });

  test('the detector follows the design-note thresholds', () => {
    expect(isSuspectedMissedLog(58, 29)).toBe(true);
    expect(isSuspectedMissedLog(45, 29)).toBe(false);
    // 2 x 28 = 56, tolerance max(5, 8.4) = 8.4
    expect(isSuspectedMissedLog(64, 28)).toBe(true);
    expect(isSuspectedMissedLog(65, 28)).toBe(false);
    // 3 x 28 = 84, tolerance max(5, 12.6) = 12.6
    expect(isSuspectedMissedLog(96, 28)).toBe(true);
  });
});

describe('predictNextPeriod: implausible lengths', () => {
  test('cycles under 15 or over 90 days are excluded; a very long one is still asked about', () => {
    const p = predict(history('2025-10-01', [28, 12, 28, 95, 28, 28]));
    expect(p.excludedCycles).toEqual([
      { index: 1, reason: 'implausible_length' },
      { index: 3, reason: 'implausible_length' },
      { index: 6, reason: 'open' },
    ]);
    expect(p.askAboutCycles).toEqual([3]);
    expect(p.eligibleLengths).toEqual([28, 28, 28, 28]);
    // 95 days is about 3 x 28, so it is also listed as a suspected missed log (for the red flags).
    expect(p.suspectedMissedLogCycles).toEqual([3]);
  });

  test('15 and 90 days are plausible; 14 and 91 are not, even when confirmed', () => {
    const kept = predict(history('2025-10-01', [28, 28, 15, 90, 28]), { confirmedRealCycles: [3] });
    expect(kept.eligibleLengths).toEqual([28, 28, 15, 90, 28]);

    const dropped = predict(history('2025-10-01', [28, 28, 14, 91, 28]), { confirmedRealCycles: [3] });
    expect(dropped.excludedCycles.filter((e) => e.reason === 'implausible_length').map((e) => e.index)).toEqual([2, 3]);
  });
});

describe('predictNextPeriod: context periods', () => {
  // Starts: Jan 5, Feb 2, Mar 2, Mar 30, Apr 27, May 25 (open)
  const cycles = history('2026-01-05', [28, 28, 28, 28, 28]);

  test('cycles that overlap a context period are excluded', () => {
    const p = predict(cycles, { contexts: [context('2026-02-10', '2026-03-10')] });
    expect(p.excludedCycles).toEqual([
      { index: 1, reason: 'context' },
      { index: 2, reason: 'context' },
      { index: 5, reason: 'open' },
    ]);
    expect(p.eligibleLengths).toEqual([28, 28, 28]);
  });

  test('context dates are inclusive at both ends', () => {
    // Cycle 1 runs Feb 2 - Mar 1.
    const touchingEnd = predict(cycles, { contexts: [context('2026-03-01', '2026-03-01', 'emergency_contraception')] });
    expect(touchingEnd.excludedCycles).toContainEqual({ index: 1, reason: 'context' });
    expect(touchingEnd.excludedCycles).not.toContainEqual({ index: 2, reason: 'context' });

    const before = predict(cycles, { contexts: [context('2025-12-01', '2026-01-04')] });
    expect(before.excludedCycles).toEqual([{ index: 5, reason: 'open' }]);
  });

  test('an open-ended context excludes every completed cycle from its start', () => {
    const p = predict(cycles, { contexts: [context('2026-03-15', undefined, 'breastfeeding')] });
    expect(p.excludedCycles.filter((e) => e.reason === 'context').map((e) => e.index)).toEqual([2, 3, 4]);
    expect(p.eligibleLengths).toEqual([28, 28]);
    expect(p.basis).toBe('early');
  });

  test('a long cycle inside a context period is never asked about', () => {
    const long = history('2026-01-05', [28, 28, 60, 28, 28]);
    const p = predict(long, { contexts: [context('2026-03-10', '2026-04-10', 'postpartum')] });
    expect(p.excludedCycles).toContainEqual({ index: 2, reason: 'context' });
    expect(p.askAboutCycles).toEqual([]);
  });

  test('a context period only in the open cycle leaves past cycles eligible', () => {
    const p = predict(cycles, { contexts: [context('2026-06-01')] });
    expect(p.eligibleLengths).toEqual([28, 28, 28, 28, 28]);
  });
});

describe('predictNextPeriod: regularity', () => {
  // Spread of 8 days.
  const cycles = history('2026-01-05', [26, 30, 34, 28, 28]);

  test('the limit is 7 days at ages 26-41', () => {
    expect(predict(cycles, { settings: settings({ birthYear: 1996 }) }).regular).toBe(false);
  });

  test('the limit is 9 days at other ages and when the age is unknown', () => {
    expect(predict(cycles, { settings: settings({ birthYear: 2004 }) }).regular).toBe(true);
    expect(predict(cycles).regular).toBe(true);
  });

  test('a spread of exactly the limit is regular', () => {
    const seven = history('2026-01-05', [26, 33, 28, 29]);
    expect(predict(seven, { settings: settings({ birthYear: 1996 }) }).regular).toBe(true);
  });

  test('age bands', () => {
    expect(regularityLimit(2001, TODAY)).toBe(9); // 25
    expect(regularityLimit(2000, TODAY)).toBe(7); // 26
    expect(regularityLimit(1985, TODAY)).toBe(7); // 41
    expect(regularityLimit(1984, TODAY)).toBe(9); // 42
    expect(regularityLimit(undefined, TODAY)).toBe(9);
  });
});

describe('predictNextPeriod: after a confirmed temperature rise', () => {
  test('re-predicts from the first higher measurement: +12, range 10-16, narrower than the calendar', () => {
    const cycles = history('2026-01-01', [24, 35, 29, 40, 26, 31]);
    const calendar = predict(cycles);
    const fhm = rise(current(cycles), 18);
    const p = predict(cycles, { rises: [fhm] });

    expect(p.basis).toBe('post_rise');
    expect(offsets(p, fhm.fhmDate)).toEqual({ center: 12, lo: 10, hi: 16 });
    const width = (q: Prediction) => offsets(q).hi - offsets(q).lo;
    expect(width(p)).toBeLessThan(width(calendar));
    // Confidence and regularity still describe the cycle history.
    expect(p).toMatchObject({ confidence: 'established', regular: false, cycleStart: current(cycles).start });
  });

  test('uses the personal median and min-1..max+1 once 3 past cycles had a rise', () => {
    const cycles = history('2026-01-01', [28, 28, 28, 28]);
    // Days from FHM to the next start: 28 - 15 = 13, 28 - 14 = 14, 28 - 16 = 12.
    const past = [rise(cycles[1], 16), rise(cycles[2], 15), rise(cycles[3], 17)];
    const fhm = rise(current(cycles), 15);
    const p = predict(cycles, { rises: [...past, fhm] });
    expect(offsets(p, fhm.fhmDate)).toEqual({ center: 13, lo: 11, hi: 15 });
  });

  test('with fewer than 3 past rises the defaults apply', () => {
    const cycles = history('2026-01-01', [28, 28, 28, 28]);
    const fhm = rise(current(cycles), 15);
    const p = predict(cycles, { rises: [rise(cycles[1], 16), rise(cycles[2], 15), fhm] });
    expect(offsets(p, fhm.fhmDate)).toEqual({ center: 12, lo: 10, hi: 16 });
  });

  test('rises in excluded cycles do not count toward the personal median', () => {
    const cycles = history('2026-01-01', [28, 28, 28, 28]);
    const past = [rise(cycles[1], 16), rise(cycles[2], 15), rise(cycles[3], 17)];
    const fhm = rise(current(cycles), 15);
    const contexts = [context(cycles[3].start, cycles[3].start, 'emergency_contraception')];
    const p = predict(cycles, { rises: [...past, fhm], contexts });
    expect(offsets(p, fhm.fhmDate)).toEqual({ center: 12, lo: 10, hi: 16 });
  });

  test('only the 6 most recent past rises count', () => {
    const cycles = history('2025-09-01', [28, 28, 28, 28, 28, 28, 28, 28]);
    // The oldest cycle's interval is 28 - 20 = 8; the rest are 13.
    const past = cycles.slice(0, 8).map((c, i) => rise(c, i === 0 ? 21 : 16));
    const fhm = rise(current(cycles), 16);
    const p = predict(cycles, { rises: [...past, fhm] });
    expect(offsets(p, fhm.fhmDate)).toEqual({ center: 13, lo: 12, hi: 14 });
  });

  test('a rise dated outside the open cycle, or only in past cycles, keeps the calendar prediction', () => {
    const cycles = history('2026-01-01', [28, 28, 28]);
    const stale: RiseInfo = { cycleIndex: current(cycles).index, fhmDate: addDays(current(cycles).start, -3) };
    expect(predict(cycles, { rises: [stale] }).basis).toBe('calendar');
    expect(predict(cycles, { rises: [rise(cycles[1], 15)] }).basis).toBe('calendar');
  });

  test('if several rises are listed for the open cycle, the earliest is used', () => {
    const cycles = history('2026-01-01', [28, 28, 28]);
    const early = rise(current(cycles), 14);
    const p = predict(cycles, { rises: [rise(current(cycles), 17), early] });
    expect(offsets(p, early.fhmDate).center).toBe(12);
  });

  test('works with no completed cycles at all', () => {
    const cycles = history('2026-09-20', []);
    const fhm = rise(current(cycles), 16);
    const p = predict(cycles, { rises: [fhm] });
    expect(p).toMatchObject({ basis: 'post_rise', confidence: 'estimate' });
    expect(offsets(p, fhm.fhmDate)).toEqual({ center: 12, lo: 10, hi: 16 });
  });
});

describe('predictNextPeriod: status and late periods', () => {
  // Current cycle starts 2026-06-24; range +26..+30 = Jul 20..Jul 24.
  const cycles = history('2026-01-05', [28, 29, 27, 28, 30, 28]);
  const start = current(cycles).start;
  const on = (offset: number) => predict(cycles, { today: addDays(start, offset) });

  test('upcoming before the range, in range inside it', () => {
    expect(on(10)).toMatchObject({ status: 'upcoming', lateByDays: 0 });
    expect(on(26)).toMatchObject({ status: 'in_range', lateByDays: 0 });
    expect(on(30)).toMatchObject({ status: 'in_range', lateByDays: 0 });
  });

  test('after the range: late by N days, and the prediction never slides forward', () => {
    const before = on(20);
    const late = on(33);
    expect(late).toMatchObject({ status: 'late', lateByDays: 3 });
    expect([late.center, late.lo, late.hi]).toEqual([before.center, before.lo, before.hi]);
    expect(on(60).lateByDays).toBe(30);
    expect(on(60).hi).toBe(before.hi);
  });

  test('after a rise, lateness is measured from the post-rise range', () => {
    const fhm = rise(current(cycles), 15);
    const p = predict(cycles, { rises: [fhm], today: addDays(fhm.fhmDate, 18) });
    expect(p).toMatchObject({ status: 'late', lateByDays: 2 });
  });

  test('a prior-only prediction can be late too', () => {
    const only = history('2026-08-01', []);
    const p = predict(only, { today: '2026-09-10' });
    // hi = Aug 1 + 35 = Sep 5
    expect(p).toMatchObject({ hi: '2026-09-05', status: 'late', lateByDays: 5 });
  });
});

describe('predictNextPeriod: daylight-saving changes', () => {
  // EU clocks change on 2026-03-29 and 2026-10-25; US clocks on 2026-03-08 and 2026-11-01.
  test('spring: whole calendar days across both transitions', () => {
    const cycles = history('2025-12-07', [28, 28, 28]);
    expect(current(cycles).start).toBe('2026-03-01');
    const p = predict(cycles, { today: '2026-03-29' });
    expect(p).toMatchObject({ center: '2026-03-29', lo: '2026-03-27', hi: '2026-03-31', status: 'in_range' });
    expect(predict(cycles, { today: '2026-04-03' })).toMatchObject({ status: 'late', lateByDays: 3 });
  });

  test('autumn: whole calendar days across both transitions', () => {
    const cycles = history('2026-07-12', [28, 28, 28]);
    expect(current(cycles).start).toBe('2026-10-04');
    const p = predict(cycles, { today: '2026-10-25' });
    expect(p).toMatchObject({ center: '2026-11-01', lo: '2026-10-30', hi: '2026-11-03', status: 'upcoming' });
  });

  test('cycle lengths that span a transition are whole days', () => {
    const cycles = history('2026-03-01', [28, 28]);
    expect(cycles.map((c) => c.length)).toEqual([28, 28, null]);
    expect(predict(cycles).eligibleLengths).toEqual([28, 28]);
  });

  test('post-rise dates across a transition', () => {
    const cycles = history('2026-09-13', [28]);
    const fhm: RiseInfo = { cycleIndex: 1, fhmDate: '2026-10-24' };
    expect(predict(cycles, { rises: [fhm] })).toMatchObject({ center: '2026-11-05', lo: '2026-11-03', hi: '2026-11-09' });
  });
});

describe('classifyCycles', () => {
  test('lists the open cycle and keeps real long cycles the user confirmed', () => {
    const cycles = history('2026-01-01', [29, 29, 58]);
    expect(classifyCycles(cycles, [], 28)).toEqual({
      excluded: [
        { index: 2, reason: 'suspected_missed_log' },
        { index: 3, reason: 'open' },
      ],
      askAbout: [2],
      suspectedMissedLogs: [2],
    });
    expect(classifyCycles(cycles, [], 28, [2])).toEqual({
      excluded: [{ index: 3, reason: 'open' }],
      askAbout: [],
      suspectedMissedLogs: [],
    });
  });
});

describe('prediction accuracy', () => {
  test('a snapshot keeps what the prediction said; nothing without a prediction', () => {
    const cycles = history('2026-01-05', [28, 29, 27, 28, 30, 28]);
    const p = predict(cycles);
    expect(predictionSnapshot(p)).toEqual({ cycleStart: '2026-06-24', basis: 'calendar', center: p.center, lo: p.lo, hi: p.hi });
    expect(predictionSnapshot(predict([]))).toBeNull();
  });

  test('each closed cycle is scored against its actual start', () => {
    // Snapshot taken while 2026-06-24 was the open cycle: range Jul 20..Jul 24, centre Jul 22.
    const before = history('2026-01-05', [28, 29, 27, 28, 30, 28]);
    const snapshot = predictionSnapshot(predict(before));
    if (!snapshot) throw new Error('no snapshot');

    const onTime = history('2026-01-05', [28, 29, 27, 28, 30, 28, 29]);
    expect(scorePredictions([snapshot], onTime)).toEqual([
      { cycleStart: '2026-06-24', basis: 'calendar', actualStart: '2026-07-23', errorDays: 1, inRange: true },
    ]);
    const late = history('2026-01-05', [28, 29, 27, 28, 30, 28, 33]);
    expect(scorePredictions([snapshot], late)).toMatchObject([{ errorDays: 5, inRange: false }]);
    const early = history('2026-01-05', [28, 29, 27, 28, 30, 28, 25]);
    expect(scorePredictions([snapshot], early)).toMatchObject([{ errorDays: -3, inRange: false }]);
  });

  test('the open cycle, and a start that no longer exists, are not scored', () => {
    const cycles = history('2026-01-05', [28, 29, 27, 28, 30, 28]);
    const snapshot = predictionSnapshot(predict(cycles));
    if (!snapshot) throw new Error('no snapshot');
    expect(scorePredictions([snapshot], cycles)).toEqual([]);
    expect(scorePredictions([{ ...snapshot, cycleStart: '2026-06-25' }], history('2026-01-05', [28, 29, 27, 28, 30, 28, 29]))).toEqual([]);
  });
});

describe('calendarFertileWindow', () => {
  // Lengths 26, 30, 28: median 28, range 26..30.
  const cycles = history('2026-01-05', [26, 30, 28]);
  const cur = current(cycles);
  const p = predict(cycles);
  const cd = (day: number) => addDays(cur.start, day - 1);

  test('design-note example: lo 26, hi 30 with luteal 11-15 gives cycle days 6-20', () => {
    expect(offsets(p)).toEqual({ center: 28, lo: 26, hi: 30 });
    expect(calendarFertileWindow(p, cur)).toEqual({ start: cd(6), end: cd(20) });
  });

  test('a custom luteal range', () => {
    expect(calendarFertileWindow(p, cur, [10, 14])).toEqual({ start: cd(7), end: cd(21) });
    expect(calendarFertileWindow(p, cur, [14, 10])).toEqual({ start: cd(7), end: cd(21) });
  });

  test('never starts before cycle day 1', () => {
    const short = history('2026-06-01', [15, 45]);
    const w = calendarFertileWindow(predict(short), current(short));
    // lo 15, hi 59: ovulation on cycle days 0-48, so the window would start on day -5
    expect(w).toEqual({ start: current(short).start, end: addDays(current(short).start, 48) });
  });

  test('null without a prediction or for a different cycle', () => {
    expect(calendarFertileWindow(predict([]), undefined)).toBeNull();
    expect(calendarFertileWindow(p, undefined)).toBeNull();
    expect(calendarFertileWindow(p, cycles[0])).toBeNull();
  });

  test('dates across a daylight-saving change', () => {
    const spring = history('2025-12-07', [26, 30, 28]);
    expect(current(spring).start).toBe('2026-03-01');
    expect(calendarFertileWindow(predict(spring), current(spring))).toEqual({ start: '2026-03-06', end: '2026-03-20' });
  });
});
