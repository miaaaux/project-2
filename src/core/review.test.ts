// Review of prediction, reminders, painGuide, redFlags, exercises and content
// against SPEC.md sections 3, 6, 7, 8 and 9. Every test here fails on purpose:
// each one demonstrates a deviation from the spec found during review.

import { deriveCycles, type Cycle } from './cycles';
import { addDays, diffDays, type ISODate } from './date';
import { prepCard } from './painGuide';
import { predictNextPeriod } from './prediction';
import { evaluateRedFlags, type RedFlag } from './redFlags';
import { desiredReminders } from './reminders';
import { log, logs, series, settings } from './testing/fixtures';
import type { ContextPeriod, DailyLog, Flow } from './types';

const TODAY = '2026-10-13';

/** A confirmed period of `days` bleeding days from `start`. */
function period(start: ISODate, days = 5, flow: Flow = 'medium'): DailyLog[] {
  return series(
    start,
    Array.from({ length: days }, (_, i) => (i === 0 ? { flow: 'heavy', periodStartConfirmed: true } : { flow })),
  );
}

/** Confirmed periods starting at `first`, then `lengths` days apart; the last start opens the current cycle. */
function periodsEvery(first: ISODate, lengths: number[]): DailyLog[] {
  const starts = [first];
  for (const length of lengths) starts.push(addDays(starts[starts.length - 1], length));
  return starts.flatMap((s) => period(s));
}

function context(kind: ContextPeriod['kind'], start: ISODate, end?: ISODate): ContextPeriod {
  return { id: `${kind}-${start}`, kind, start, end };
}

/** Red flags with the eligible lengths taken from the real prediction, as the app would wire them. */
function redFlagsFor(entries: DailyLog[], opts: { contexts?: ContextPeriod[]; today?: ISODate } = {}): RedFlag[] {
  const data = logs(...entries);
  const cycles = deriveCycles(data);
  const contexts = opts.contexts ?? [];
  const today = opts.today ?? TODAY;
  const prediction = predictNextPeriod({ cycles, contexts, settings: settings(), rises: [], today });
  return evaluateRedFlags({ cycles, logs: data, contexts, prediction, today });
}

const codes = (flags: RedFlag[]) => flags.map((f) => f.code);

// ------------------------------------------------------------ SPEC §3

describe('SPEC §3 prediction with 1-2 cycles', () => {
  // "Show it as a range from the shortest to the longest of those cycles"; with 1-2 cycles the
  // range is "at least ±4 days" around the prior-shrunk average. Shrinking the centre toward the
  // prior must not push the user's own observed cycle lengths out of the "usual range", or a
  // period that comes exactly when it did last time is reported as late.
  test.each([
    [[45], 'one 45-day cycle'],
    [[40, 42], 'cycles of 40 and 42 days'],
  ])('the range still covers the observed cycle lengths (%j: %s)', (lengths) => {
    const cycles = deriveCycles(logs(...periodsEvery('2026-01-05', lengths)));
    const current = cycles[cycles.length - 1];
    const p = predictNextPeriod({ cycles, contexts: [], settings: settings(), rises: [], today: current.start });
    expect(p.basis).toBe('early');
    const lo = diffDays(p.lo as ISODate, current.start);
    const hi = diffDays(p.hi as ISODate, current.start);
    expect(lo).toBeLessThanOrEqual(Math.min(...lengths));
    expect(hi).toBeGreaterThanOrEqual(Math.max(...lengths));
  });
});

// ------------------------------------------------------------ SPEC §6

describe('SPEC §6 reminders pause only during pregnancy, postpartum and hormonal contraception', () => {
  test('breastfeeding on its own does not pause reminders', () => {
    const cycles = deriveCycles(logs(...period('2026-10-01')));
    const currentCycle: Cycle = cycles[cycles.length - 1];
    const rs = desiredReminders({
      currentCycle,
      prediction: { lo: '2026-10-27', center: '2026-10-29', status: 'upcoming' },
      settings: settings(),
      contexts: [context('breastfeeding', '2026-03-01')],
      today: '2026-10-11',
    });
    expect(rs.map((r) => [r.type, r.fireDate])).toEqual([['prep', '2026-10-24']]);
  });
});

// ------------------------------------------------------------ SPEC §7: prep card

describe('SPEC §7 prep card: fewer than 60% of days logged is "not enough logs", not missed', () => {
  // Window for exercise: the last 28 days (2026-09-16 .. 2026-10-13).
  const prediction = { lo: '2026-10-20' };

  test.each([
    [1, 'one logged day out of 28'],
    [10, '10 logged days out of 28 (36%)'],
  ])('exercise with %i logged days and no sessions is not shown as off track (%s)', (n) => {
    const entries = Array.from({ length: n }, (_, i) => log(addDays(TODAY, -i), { sleepHours: 8 }));
    const card = prepCard({ logs: logs(...entries), exercise: [], settings: settings(), prediction, today: TODAY });
    const exercise = card?.habits.find((h) => h.habit === 'exercise');
    expect(exercise?.state).toBe('not_enough_logs');
  });
});

// ------------------------------------------------------------ SPEC §7: red flags

describe('SPEC §7 red flag: 90 days with no period (when not pregnant or breastfeeding)', () => {
  // The 90 days must be days when the user was not pregnant or breastfeeding. The last period
  // before a pregnancy is naturally many months back, so the flag must not fire right after
  // the pregnancy or breastfeeding ends.
  test.each([
    ['a pregnancy that ended 3 days ago', '2025-11-25', [context('pregnancy', '2025-12-20', '2026-10-10')]],
    [
      'breastfeeding that ended 2 days ago',
      '2025-01-05',
      [context('pregnancy', '2025-01-25', '2025-10-20'), context('breastfeeding', '2025-10-21', '2026-10-11')],
    ],
  ])('is not raised just after %s', (_label, lastPeriod, contexts) => {
    expect(codes(redFlagsFor(period(lastPeriod), { contexts }))).not.toContain('no_period_90_days');
  });
});

describe('SPEC §7 red flag: bleeding between periods in 2 cycles', () => {
  test('mid-cycle spotting in the current cycle counts as one of the 2 cycles', () => {
    // 28-day cycles; the current cycle started 2026-09-22 and today is its day 22.
    const entries = [
      ...periodsEvery('2026-06-30', [28, 28, 28]),
      log('2026-09-08', { flow: 'spotting' }), // day 15 of the last completed cycle
      log('2026-10-06', { flow: 'spotting' }), // day 15 of the current cycle, a week after its period ended
    ];
    expect(codes(redFlagsFor(entries))).toContain('intermenstrual_bleeding');
  });
});

describe('SPEC §3/§7: unconfirmed period-like bleeding is not yet "bleeding between periods"', () => {
  test('two unanswered "Did your period start?" prompts do not raise intermenstrual_bleeding', () => {
    // The user forgot to tap "period started" on 2026-06-02 and 2026-07-28: 5-day runs of
    // heavy/medium bleeding that cycles.unconfirmedBleedingStarts turns into prompts. Until the
    // user answers (notPeriodStart), the app does not know they were between periods.
    const unconfirmed = (start: ISODate) =>
      series(start, [{ flow: 'heavy' }, { flow: 'medium' }, { flow: 'medium' }, { flow: 'medium' }, { flow: 'medium' }]);
    const entries = [
      ...period('2026-05-05'),
      ...unconfirmed('2026-06-02'),
      ...period('2026-06-30'),
      ...unconfirmed('2026-07-28'),
      ...period('2026-08-25'),
      ...period('2026-09-22'),
    ];
    expect(codes(redFlagsFor(entries))).not.toContain('intermenstrual_bleeding');
  });
});

describe('SPEC §7 red flag: cycles persistently under 24 or over 38 days', () => {
  // The flag reads prediction.eligibleLengths, which drops cycles under 15 or over 90 days.
  // Those are exactly the most extreme short and long cycles.
  test('periods every 14 days', () => {
    const entries = periodsEvery('2026-08-04', [14, 14, 14, 14, 14]);
    expect(codes(redFlagsFor(entries))).toContain('irregular_cycles');
  });

  test('cycles of about 100 days', () => {
    // Three completed cycles of 98-102 days; today is day 30 of the current one.
    const entries = periodsEvery('2025-09-18', [100, 98, 102]);
    const today = addDays('2025-09-18', 300 + 29);
    expect(codes(redFlagsFor(entries, { today }))).toContain('irregular_cycles');
  });
});
