import { deriveCycles } from './cycles';
import { addDays, type ISODate } from './date';
import { evaluateRedFlags, type RedFlag, type RedFlagCode } from './redFlags';
import { log, logs, series } from './testing/fixtures';
import type { ContextPeriod, DailyLog, Flow } from './types';

const TODAY = '2026-10-13';
const CURRENT = '2026-09-29';
/** Ten period starts 28 days apart, oldest first; the last one opens the current cycle. */
const STARTS = Array.from({ length: 10 }, (_, i) => addDays(CURRENT, -28 * (9 - i)));
/** The n-th most recent period start (1 = the current cycle). */
const back = (n: number) => STARTS[STARTS.length - n];

/** A confirmed period of `days` bleeding days. */
function period(start: ISODate, days = 5, flow: Flow = 'medium'): DailyLog[] {
  return series(
    start,
    Array.from({ length: days }, (_, i) => (i === 0 ? { flow: 'heavy', periodStartConfirmed: true } : { flow })),
  );
}

const HISTORY = STARTS.flatMap((s) => period(s));

/** Cramp scores on consecutive days from `start`. */
function cramps(start: ISODate, ...scores: number[]): DailyLog[] {
  return series(start, scores.map((c) => ({ cramps: c })));
}

function evaluate(
  entries: DailyLog[],
  opts: { suspectedMissedLogCycles?: number[]; contexts?: ContextPeriod[]; today?: ISODate } = {},
): RedFlag[] {
  const data = logs(...entries);
  return evaluateRedFlags({
    cycles: deriveCycles(data),
    logs: data,
    contexts: opts.contexts ?? [],
    prediction: { suspectedMissedLogCycles: opts.suspectedMissedLogCycles ?? [] },
    today: opts.today ?? TODAY,
  });
}

const codes = (flags: RedFlag[]) => flags.map((f) => f.code);
const only = (flags: RedFlag[], code: RedFlagCode) => {
  expect(codes(flags)).toEqual([code]);
  return flags[0];
};

function context(kind: ContextPeriod['kind'], start: ISODate, end?: ISODate): ContextPeriod {
  return { id: `${kind}-${start}`, kind, start, end };
}

test('a plain history raises nothing', () => {
  expect(evaluate(HISTORY)).toEqual([]);
  expect(evaluate([])).toEqual([]);
});

test('unlogged days are never evidence', () => {
  // Bleeding only, no comfort fields at all, over a long history.
  expect(evaluate(HISTORY)).toEqual([]);
});

describe('severe_pain', () => {
  test('cramps of 8 or more around one of the last 2 periods, even if it is the only day logged', () => {
    const flag = only(evaluate([...HISTORY, log(addDays(back(1), 1), { cramps: 8 })]), 'severe_pain');
    expect(flag).toEqual({
      code: 'severe_pain',
      level: 'see_doctor',
      since: '2026-09-30',
      detail: 'Cramps of 8/10 around the period that started 2026-09-29.',
    });
  });

  test('"couldn\'t do usual things" counts too, from 2 days before day 1', () => {
    const flag = only(evaluate([...HISTORY, log(addDays(back(2), -2), { painImpact: 'couldnt_do_usual' })]), 'severe_pain');
    expect(flag.since).toBe(addDays(back(2), -2));
    expect(flag.detail).toBe(`"Couldn't do usual things" logged around the period that started ${back(2)}.`);
  });

  test('7 is not severe, and day 4 or a period 3 back is outside the rule', () => {
    expect(evaluate([...HISTORY, log(back(1), { cramps: 7 })])).toEqual([]);
    expect(evaluate([...HISTORY, log(addDays(back(1), 3), { cramps: 9 })])).toEqual([]);
    expect(evaluate([...HISTORY, log(back(3), { cramps: 9 })])).toEqual([]);
  });

  test('since is the earliest evidence; detail describes the latest period', () => {
    const flag = evaluate([...HISTORY, ...cramps(back(2), 9), ...cramps(back(1), 0, 8)]).find((f) => f.code === 'severe_pain');
    expect(flag?.since).toBe(back(2));
    expect(flag?.detail).toBe(`Cramps of 8/10 around the period that started ${back(1)}.`);
  });
});

describe('repeated_high_pain', () => {
  test('cramps of 7 or more around 2 of the last 3 periods', () => {
    const flag = only(evaluate([...HISTORY, ...cramps(back(3), 2, 7), ...cramps(back(1), 7)]), 'repeated_high_pain');
    expect(flag.since).toBe(addDays(back(3), 1));
    expect(flag.detail).toBe('Cramps of 7/10 or more around 2 of your last 3 periods.');
  });

  test('one recent period and an older one is not enough', () => {
    expect(evaluate([...HISTORY, ...cramps(back(4), 7), ...cramps(back(1), 7)])).toEqual([]);
  });

  test('with only two periods, both count', () => {
    const entries = [...period('2026-08-20'), ...period('2026-09-18'), log('2026-09-19', { cramps: 7 }), log('2026-08-21', { cramps: 7 })];
    only(evaluate(entries), 'repeated_high_pain');
  });
});

describe('worsening_pain', () => {
  /** Peaks for each period, oldest first, each logged on day 1 and (one lower) day 2. */
  const peaks = (values: (number | null)[]) =>
    values.flatMap((p, i) => (p === null ? [] : cramps(STARTS[STARTS.length - values.length + i], p, Math.max(0, p - 1))));

  test('median of the last 3 periods at least 2 above the median of the 6 before', () => {
    const flag = only(evaluate([...HISTORY, ...peaks([2, 3, 3, 3, 2, 3, 5, 6, 5])]), 'worsening_pain');
    expect(flag.since).toBe(back(3));
    expect(flag.detail).toBe('Peak cramps had a median of 5/10 in your last 3 periods, up from 3/10 in the 6 before.');
  });

  test('exactly 2 points is enough, 1 is not', () => {
    expect(codes(evaluate([...HISTORY, ...peaks([3, 3, 3, 5, 5, 5])]))).toEqual(['worsening_pain']);
    expect(evaluate([...HISTORY, ...peaks([3, 3, 3, 4, 4, 4])])).toEqual([]);
  });

  test('needs at least 3 baseline periods with a pain outcome', () => {
    expect(evaluate([...HISTORY, ...peaks([1, 1, 6, 6, 6])])).toEqual([]);
  });

  test('periods with a single logged cramp day have no outcome and do not count', () => {
    const singleDayBaseline = [back(6), back(5), back(4)].flatMap((s) => cramps(s, 1));
    expect(evaluate([...HISTORY, ...singleDayBaseline, ...peaks([6, 6, 6])])).toEqual([]);
    const twoDayBaseline = [back(6), back(5), back(4)].flatMap((s) => cramps(s, 1, 1));
    expect(codes(evaluate([...HISTORY, ...twoDayBaseline, ...peaks([6, 6, 6])]))).toEqual(['worsening_pain']);
  });

  test('only up to 6 baseline periods are used', () => {
    // Baseline 1, 1, 1, 3, 3, 3 has median 2; adding the 10th-back period (9) would make it 3.
    expect(codes(evaluate([...HISTORY, ...peaks([9, 1, 1, 1, 3, 3, 3, 4, 4, 4])]))).toEqual(['worsening_pain']);
    expect(evaluate([...HISTORY, ...peaks([1, 1, 1, 3, 3, 3, 3, 4, 4, 4])])).toEqual([]);
  });
});

describe('pain_outside_period', () => {
  // The last completed cycle runs Sep 1-28; its period is Sep 1-5 and the next starts Sep 29.
  test('cramps of 5 or more on 3 days of the last completed cycle, outside its period', () => {
    const entries = [...HISTORY, log('2026-09-10', { cramps: 5 }), log('2026-09-15', { cramps: 6 }), log('2026-09-20', { cramps: 5 })];
    const flag = only(evaluate(entries), 'pain_outside_period');
    expect(flag.since).toBe('2026-09-10');
    expect(flag.detail).toBe('Cramps of 5/10 or more on 3 days outside your period in the cycle that started 2026-09-01.');
  });

  test('2 days, or scores under 5, are not enough', () => {
    expect(evaluate([...HISTORY, log('2026-09-10', { cramps: 5 }), log('2026-09-15', { cramps: 5 })])).toEqual([]);
    expect(evaluate([...HISTORY, ...['2026-09-10', '2026-09-15', '2026-09-20'].map((d) => log(d, { cramps: 4 }))])).toEqual([]);
  });

  test('period days and the 2 days before the next period do not count', () => {
    const entries = [
      ...HISTORY,
      ...cramps('2026-09-03', 6, 6, 6), // Sep 3-5: in the period
      log('2026-09-27', { cramps: 6 }), // 2 days before Sep 29
      log('2026-09-28', { cramps: 6 }),
      log('2026-09-20', { cramps: 6 }),
    ];
    expect(evaluate(entries)).toEqual([]);
    expect(codes(evaluate([...entries, log('2026-09-26', { cramps: 5 }), log('2026-09-06', { cramps: 5 })]))).toEqual([
      'pain_outside_period',
    ]);
  });

  test('the current cycle counts up to 2 days before today, which might be the 2 days before the next period', () => {
    // The current period runs Sep 29 - Oct 3; today is Oct 13.
    const pain = (dates: ISODate[]) => [...HISTORY, ...dates.map((d) => log(d, { cramps: 5 }))];
    expect(only(evaluate(pain(['2026-10-06', '2026-10-08', '2026-10-11'])), 'pain_outside_period').since).toBe('2026-10-06');
    expect(evaluate(pain(['2026-10-06', '2026-10-12', TODAY]))).toEqual([]);
  });

  test('premenstrual cramps do not raise the flag before or after the period is confirmed', () => {
    const premenstrual = ['2026-10-11', '2026-10-12', TODAY].map((d) => log(d, { cramps: 6 }));
    expect(evaluate([...HISTORY, ...premenstrual])).toEqual([]);
    // The early period makes a 15-day cycle, which is irregular; the cramps before it are not pain outside the period.
    expect(codes(evaluate([...HISTORY, ...premenstrual, ...period('2026-10-14')], { today: '2026-10-14' }))).toEqual([
      'irregular_cycles',
    ]);
  });

  test('older cycles are not considered', () => {
    expect(evaluate([...HISTORY, ...['2026-08-10', '2026-08-15', '2026-08-20'].map((d) => log(d, { cramps: 7 }))])).toEqual([]);
  });

  test('cramps during unanswered period-like bleeding wait for the answer to "Did your period start?"', () => {
    const run = (answer: Partial<DailyLog> = {}) =>
      series('2026-09-14', [{ flow: 'medium', cramps: 6, ...answer }, { flow: 'medium', cramps: 6 }, { flow: 'light', cramps: 5 }]);
    expect(evaluate([...HISTORY, ...run()])).toEqual([]);
    expect(codes(evaluate([...HISTORY, ...run({ notPeriodStart: true })]))).toEqual(['pain_outside_period']);
  });
});

describe('severe_headache', () => {
  test('a headache of 8 or more in the last 30 days', () => {
    const flag = only(evaluate([...HISTORY, log('2026-09-14', { headache: 8 }), log('2026-10-01', { headache: 9 })]), 'severe_headache');
    expect(flag.since).toBe('2026-09-14');
    expect(flag.detail).toBe('Headache up to 9/10 on 2 days in the last 30 days.');
  });

  test('31 days ago, or a 7, does not count', () => {
    expect(evaluate([...HISTORY, log('2026-09-13', { headache: 10 })])).toEqual([]);
    expect(evaluate([...HISTORY, log('2026-10-12', { headache: 7 })])).toEqual([]);
  });
});

describe('flooding', () => {
  test('flooding logged in the last 90 days', () => {
    const flag = only(evaluate([...HISTORY, log('2026-07-16', { flooding: true })]), 'flooding');
    expect(flag).toMatchObject({ since: '2026-07-16', detail: 'Flooding logged on 1 day in the last 90 days.' });
  });

  test('91 days ago, or flooding: false, does not count', () => {
    expect(evaluate([...HISTORY, log('2026-07-15', { flooding: true })])).toEqual([]);
    expect(evaluate([...HISTORY, log(CURRENT, { flooding: false })])).toEqual([]);
  });
});

describe('long_bleeding', () => {
  const withPeriod = (start: ISODate, days: number, flow: Flow = 'medium') => [...HISTORY, ...period(start, days, flow)];

  test('a period run longer than 8 days in the last 3 cycles', () => {
    const flag = only(evaluate(withPeriod(back(2), 9)), 'long_bleeding');
    expect(flag).toMatchObject({ since: back(2), detail: `The period that started ${back(2)} lasted 9 days.` });
  });

  test('8 days is not long, and a long period 4 cycles back is outside the rule', () => {
    expect(evaluate(withPeriod(back(2), 8))).toEqual([]);
    expect(evaluate(withPeriod(back(4), 10))).toEqual([]);
  });

  test('an ongoing period in the current cycle counts', () => {
    expect(only(evaluate(withPeriod(CURRENT, 9), { today: addDays(CURRENT, 8) }), 'long_bleeding').since).toBe(CURRENT);
  });

  test('trailing spotting is part of the period run', () => {
    const entries = [...withPeriod(back(1), 7), log(addDays(back(1), 7), { flow: 'spotting' }), log(addDays(back(1), 8), { flow: 'spotting' })];
    expect(codes(evaluate(entries))).toEqual(['long_bleeding']);
  });
});

describe('intermenstrual_bleeding', () => {
  // The last 3 completed cycles start at back(4), back(3) and back(2): Jul 7, Aug 4 and Sep 1.
  const midCycle = (n: number, flow: Flow = 'spotting') => log(addDays(back(n), 13), { flow });

  test('bleeding between periods in 2 of the last 3 completed cycles', () => {
    // A light day looks like a period start, so the user has answered "Did your period start?" with no.
    const light = log(addDays(back(2), 13), { flow: 'light', notPeriodStart: true });
    const flag = only(evaluate([...HISTORY, midCycle(4), light]), 'intermenstrual_bleeding');
    expect(flag.since).toBe(addDays(back(4), 13));
    expect(flag.detail).toBe('Bleeding between periods in 2 of your last 3 cycles.');
  });

  test('one cycle, or a cycle older than the last 3 completed, is not enough', () => {
    expect(evaluate([...HISTORY, midCycle(2)])).toEqual([]);
    expect(evaluate([...HISTORY, midCycle(5), midCycle(2)])).toEqual([]);
  });

  test('the open cycle counts up to 2 days before today', () => {
    // The current period runs Sep 29 - Oct 3; today is Oct 13.
    const flag = only(evaluate([...HISTORY, log('2026-10-09', { flow: 'spotting' }), midCycle(2)]), 'intermenstrual_bleeding');
    expect(flag.since).toBe(addDays(back(2), 13));
    expect(flag.detail).toBe('Bleeding between periods in 2 of your last 4 cycles, including the current one.');
    // Yesterday's spotting may be the start of the next period.
    expect(evaluate([...HISTORY, log('2026-10-12', { flow: 'spotting' }), midCycle(2)])).toEqual([]);
  });

  test('period-like bleeding behind an unanswered "Did your period start?" does not count until answered', () => {
    // 3 days of bleeding from day 14, never confirmed as a period start.
    const run = (n: number, answer: Partial<DailyLog> = {}) =>
      series(addDays(back(n), 13), [{ flow: 'medium', ...answer }, { flow: 'medium' }, { flow: 'light' }]);
    expect(evaluate([...HISTORY, ...run(2), ...run(3)])).toEqual([]);
    // "No, it was bleeding between periods".
    const answered = [...HISTORY, ...run(2, { notPeriodStart: true }), ...run(3, { notPeriodStart: true })];
    expect(only(evaluate(answered), 'intermenstrual_bleeding').since).toBe(addDays(back(3), 13));
  });

  test('neither do the 2 days before an unanswered start', () => {
    const run = series(addDays(back(2), 13), [{ flow: 'medium' }, { flow: 'medium' }]);
    expect(evaluate([...HISTORY, ...run, log(addDays(back(2), 11), { flow: 'spotting' }), midCycle(3)])).toEqual([]);
    expect(codes(evaluate([...HISTORY, ...run, log(addDays(back(2), 10), { flow: 'spotting' }), midCycle(3)]))).toEqual([
      'intermenstrual_bleeding',
    ]);
  });

  test('spotting in the 2 days before the next start, and the run\'s trailing spotting, do not count', () => {
    const entries = [
      ...HISTORY,
      // Spotting right before the next period.
      log(addDays(back(1), -1), { flow: 'spotting' }),
      log(addDays(back(1), -2), { flow: 'spotting' }),
      // Two trailing spotting days extend the period run.
      log(addDays(back(3), 5), { flow: 'spotting' }),
      log(addDays(back(3), 6), { flow: 'spotting' }),
    ];
    expect(evaluate(entries)).toEqual([]);
    // A third spotting day before the next period is bleeding between periods.
    expect(codes(evaluate([...entries, log(addDays(back(1), -3), { flow: 'spotting' }), midCycle(3)]))).toEqual([
      'intermenstrual_bleeding',
    ]);
  });

  test('flow "none" is not bleeding', () => {
    expect(evaluate([...HISTORY, midCycle(2, 'none'), midCycle(3, 'none')])).toEqual([]);
  });
});

describe('irregular_cycles', () => {
  /** Confirmed periods `lengths` days apart from 2025-06-01; today is day 6 of the current cycle. */
  function cyclesOf(lengths: number[]) {
    const starts = ['2025-06-01'];
    for (const length of lengths) starts.push(addDays(starts[starts.length - 1], length));
    return { entries: starts.flatMap((s) => period(s)), starts, today: addDays(starts[starts.length - 1], 5) };
  }
  const flagsFor = (lengths: number[], opts: { suspectedMissedLogCycles?: number[]; contexts?: ContextPeriod[] } = {}) => {
    const h = cyclesOf(lengths);
    return evaluate(h.entries, { today: h.today, ...opts });
  };

  test('half or more of the last 6 lengths under 24 or over 38 days', () => {
    const flag = only(flagsFor([28, 29, 22, 21, 40]), 'irregular_cycles');
    expect(flag.detail).toBe('Your last 5 cycles were 28, 29, 22, 21, 40 days long.');
    expect(codes(flagsFor([22, 23, 28, 29]))).toEqual(['irregular_cycles']);
    expect(flagsFor([22, 28, 29, 30])).toEqual([]);
  });

  test('or a spread of 10 days or more', () => {
    expect(codes(flagsFor([25, 30, 35]))).toEqual(['irregular_cycles']);
    expect(flagsFor([25, 30, 34])).toEqual([]);
  });

  test('needs at least 3 lengths and looks at the last 6 only', () => {
    expect(flagsFor([20, 45])).toEqual([]);
    expect(flagsFor([20, 45, 20, 28, 28, 28, 28, 28, 28])).toEqual([]);
  });

  test('cycles under 15 or over 90 days count, although the prediction leaves them out', () => {
    expect(only(flagsFor([14, 14, 14]), 'irregular_cycles').detail).toBe('Your last 3 cycles were 14, 14, 14 days long.');
    expect(codes(flagsFor([100, 98, 102]))).toEqual(['irregular_cycles']);
  });

  test('unconfirmed suspected missed logs and cycles that overlap a context do not count', () => {
    expect(codes(flagsFor([28, 28, 60, 28]))).toEqual(['irregular_cycles']);
    expect(flagsFor([28, 28, 60, 28], { suspectedMissedLogCycles: [2] })).toEqual([]);
    // The 60-day cycle runs 2025-07-26 to 2025-09-23.
    expect(flagsFor([28, 28, 60, 28], { contexts: [context('hormonal_contraception', '2025-08-01', '2025-09-01')] })).toEqual([]);
  });

  test('a cycle holding an unanswered "Did your period start?" does not count', () => {
    const h = cyclesOf([28, 28, 56, 28]);
    const run = (answer: Partial<DailyLog> = {}) =>
      series(addDays(h.starts[2], 28), [{ flow: 'heavy', ...answer }, { flow: 'medium' }, { flow: 'medium' }]);
    expect(evaluate([...h.entries, ...run()], { today: h.today })).toEqual([]);
    expect(codes(evaluate([...h.entries, ...run({ notPeriodStart: true })], { today: h.today }))).toEqual(['irregular_cycles']);
  });

  test('since is the start of the oldest cycle counted, skipping excluded cycles', () => {
    const h = cyclesOf([28, 60, 22, 21, 41]);
    const flag = evaluate(h.entries, { today: h.today, suspectedMissedLogCycles: [1] }).find((f) => f.code === 'irregular_cycles');
    expect(flag).toMatchObject({ since: h.starts[0], detail: 'Your last 4 cycles were 28, 22, 21, 41 days long.' });
    const recent = evaluate(h.entries, { today: h.today, suspectedMissedLogCycles: [0, 1] }).find((f) => f.code === 'irregular_cycles');
    expect(recent?.since).toBe(h.starts[2]);
  });
});

describe('no_period_90_days', () => {
  test('90 days or more since the last confirmed start', () => {
    const flag = only(evaluate(period('2026-07-15')), 'no_period_90_days');
    expect(flag).toMatchObject({ since: '2026-07-15', detail: '90 days since your last period started.' });
    expect(evaluate(period('2026-07-16'))).toEqual([]);
  });

  test.each(['pregnancy', 'breastfeeding', 'postpartum', 'hormonal_contraception'] as const)(
    'not while a %s context covers today',
    (kind) => {
      expect(evaluate(period('2026-06-01'), { contexts: [context(kind, '2026-06-20')] })).toEqual([]);
    },
  );

  test('after such a context ends, the 90 days count from the next day', () => {
    const pregnancy = (end: ISODate) => [context('pregnancy', '2026-06-20', end)];
    expect(only(evaluate(period('2026-06-01'), { contexts: pregnancy('2026-07-14') }), 'no_period_90_days')).toMatchObject({
      since: '2026-07-15',
      detail: 'No period confirmed in the 90 days since 2026-07-15.',
    });
    expect(evaluate(period('2026-06-01'), { contexts: pregnancy('2026-07-15') })).toEqual([]);
    expect(evaluate(period('2026-06-01'), { contexts: [context('breastfeeding', '2026-06-20', '2026-10-12')] })).toEqual([]);
  });

  test('a context that ended before the last period, or perimenopause, does not change the count', () => {
    const before = evaluate(period('2026-07-15'), { contexts: [context('pregnancy', '2025-09-01', '2026-06-01')] });
    expect(only(before, 'no_period_90_days')).toMatchObject({ since: '2026-07-15', detail: '90 days since your last period started.' });
    expect(codes(evaluate(period('2026-06-01'), { contexts: [context('perimenopause', '2026-01-01')] }))).toEqual([
      'no_period_90_days',
    ]);
  });

  test('unanswered period-like bleeding may have been a period', () => {
    const bleeding = (answer: Partial<DailyLog> = {}) =>
      series('2026-08-01', [{ flow: 'medium', ...answer }, { flow: 'medium' }, { flow: 'light' }]);
    expect(evaluate([...period('2026-06-01'), ...bleeding()])).toEqual([]);
    expect(only(evaluate([...period('2026-06-01'), ...bleeding({ notPeriodStart: true })]), 'no_period_90_days').since).toBe(
      '2026-06-01',
    );
  });

  test('nothing without any confirmed start', () => {
    expect(evaluate([log('2026-01-01', { flow: 'medium' })])).toEqual([]);
  });
});

test('several flags come back in a fixed order, all "see a doctor"', () => {
  // Cycles of 20, 21 and 22 days, then the current one.
  const starts = [addDays(CURRENT, -63), addDays(CURRENT, -43), addDays(CURRENT, -22), CURRENT];
  const entries = [
    ...starts.flatMap((s) => period(s)),
    log('2026-10-01', { flooding: true, cramps: 9, headache: 9 }),
    log(addDays(starts[2], 1), { cramps: 7 }),
  ];
  const flags = evaluate(entries);
  expect(codes(flags)).toEqual(['severe_pain', 'repeated_high_pain', 'severe_headache', 'flooding', 'irregular_cycles']);
  expect(flags.every((f) => f.level === 'see_doctor')).toBe(true);
});
