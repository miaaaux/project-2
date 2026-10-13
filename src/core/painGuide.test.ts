import { deriveCycles } from './cycles';
import { addDays, dateRange, type ISODate } from './date';
import {
  HABITS,
  habitAdherenceBefore,
  habitPatterns,
  periodPainOutcome,
  periodPainWindow,
  prepCard,
  type HabitKey,
  type HabitStatus,
} from './painGuide';
import { log, logs, series, settings } from './testing/fixtures';
import type { DailyLog, ExerciseSession, Settings } from './types';

const TODAY = '2026-10-19';
/** Predicted start of the range; the magnesium and sugar window is Oct 10-19 (10 days). */
const LO = '2026-10-24';

let sessionSeq = 0;
function session(date: ISODate, minutes: number): ExerciseSession {
  sessionSeq += 1;
  return { id: `s${sessionSeq}`, date, kind: 'aerobic', minutes, exerciseIds: [] };
}

function card(
  entries: DailyLog[],
  opts: { exercise?: ExerciseSession[]; settings?: Settings; lo?: ISODate | null; today?: ISODate } = {},
) {
  return prepCard({
    logs: logs(...entries),
    exercise: opts.exercise ?? [],
    settings: opts.settings ?? settings(),
    prediction: { lo: opts.lo === undefined ? LO : opts.lo },
    today: opts.today ?? TODAY,
  });
}

function habit(statuses: HabitStatus[] | undefined, key: HabitKey): HabitStatus {
  const h = statuses?.find((s) => s.habit === key);
  if (!h) throw new Error(`no ${key}`);
  return h;
}

/** One log per day of the 10-day magnesium/sugar window. */
const windowDays = (values: (Partial<DailyLog> | null)[]) => series('2026-10-10', values);

describe('prepCard', () => {
  test('null without a predicted start, and before the 14-day window opens', () => {
    expect(card([], { lo: null })).toBeNull();
    expect(card([], { today: addDays(LO, -15) })).toBeNull();
    expect(card([], { today: addDays(LO, -14) })).not.toBeNull();
  });

  test('all four habits, in order, with their windows and targets', () => {
    const c = card([]);
    expect(c?.habits.map((h) => [h.habit, h.window, h.target])).toEqual([
      ['magnesium', { start: '2026-10-10', end: TODAY }, 0.7],
      ['exercise', { start: '2026-09-22', end: TODAY }, 3],
      ['sugar', { start: '2026-10-10', end: TODAY }, 0.7],
      ['sleep', { start: '2026-10-13', end: TODAY }, 8],
    ]);
  });

  test('with nothing logged every habit is "not enough logs", never "off track"', () => {
    const c = card([]);
    expect(c?.habits.map((h) => [h.state, h.value, h.coverage])).toEqual([
      ['not_enough_logs', null, 0],
      ['not_enough_logs', null, 0],
      ['not_enough_logs', null, 0],
      ['not_enough_logs', null, 0],
    ]);
    expect(c).toMatchObject({ onTrackCount: 0, knownCount: 0 });
  });

  describe('magnesium', () => {
    const taken = (n: number, notTaken: number, unlogged = 0) =>
      windowDays([
        ...Array<Partial<DailyLog>>(n).fill({ magnesiumTaken: true }),
        ...Array<Partial<DailyLog>>(notTaken).fill({ magnesiumTaken: false }),
        ...Array<null>(unlogged).fill(null),
      ]);

    test('on track when taken on at least 70% of logged days', () => {
      expect(habit(card(taken(7, 3))?.habits, 'magnesium')).toMatchObject({ state: 'on_track', value: 0.7, coverage: 1 });
      expect(habit(card(taken(6, 4))?.habits, 'magnesium')).toMatchObject({ state: 'off_track', value: 0.6, coverage: 1 });
    });

    test('unlogged days are not days without magnesium', () => {
      expect(habit(card(taken(6, 0, 4))?.habits, 'magnesium')).toMatchObject({ state: 'on_track', value: 1, coverage: 0.6 });
    });

    test('fewer than 60% of days logged is "not enough logs"', () => {
      expect(habit(card(taken(5, 0, 5))?.habits, 'magnesium')).toMatchObject({
        state: 'not_enough_logs',
        value: null,
        coverage: 0.5,
      });
    });

    test('a day logged without the magnesium field does not count as logged', () => {
      const entries = [...taken(5, 0, 5), ...series('2026-10-15', [{ sleepHours: 8 }, { cramps: 2 }])];
      expect(habit(card(entries)?.habits, 'magnesium').state).toBe('not_enough_logs');
    });

    test('days outside the window are ignored', () => {
      const entries = [
        ...taken(6, 0, 4),
        log('2026-10-09', { magnesiumTaken: false }),
        log('2026-10-20', { magnesiumTaken: false }),
      ];
      expect(habit(card(entries)?.habits, 'magnesium')).toMatchObject({ value: 1, coverage: 0.6 });
    });
  });

  describe('sugar', () => {
    test('a day counts as low when at most one serving was logged', () => {
      const servings = [0, 1, 1, 0, 2, 3, 0, 1, 2, 0] as const;
      const c = card(windowDays(servings.map((sugarServings) => ({ sugarServings }))));
      expect(habit(c?.habits, 'sugar')).toMatchObject({ state: 'on_track', value: 0.7, coverage: 1 });
    });

    test('off track below 70%, and an unlogged day is not a low-sugar day', () => {
      const c = card(windowDays([{ sugarServings: 0 }, { sugarServings: 3 }, { sugarServings: 2 }, { sugarServings: 0 }, { sugarServings: 1 }, { sugarServings: 3 }, null, null, null, null]));
      expect(habit(c?.habits, 'sugar')).toMatchObject({ state: 'off_track', value: 0.5, coverage: 0.6 });
    });
  });

  describe('exercise', () => {
    const exerciseDays = (n: number, minutes = 20) =>
      dateRange('2026-09-22', TODAY)
        .slice(0, n)
        .map((d) => session(d, minutes));
    /** A daily log (with nothing about exercise) on each of the first `n` days of the 28-day window. */
    const loggedDays = (n = 28) =>
      dateRange('2026-09-22', TODAY)
        .slice(0, n)
        .map((d) => log(d));

    test('on track with 12 exercise days in the last 28 (3 a week on average)', () => {
      expect(habit(card(loggedDays(), { exercise: exerciseDays(12) })?.habits, 'exercise')).toMatchObject({
        state: 'on_track',
        value: 3,
        coverage: 1,
      });
      expect(habit(card(loggedDays(), { exercise: exerciseDays(11) })?.habits, 'exercise')).toMatchObject({
        state: 'off_track',
        value: 2.75,
      });
    });

    test('enough exercise days are on track even when few other days are logged', () => {
      // Unlogged days can only hide more exercise, never less.
      expect(habit(card([], { exercise: exerciseDays(12) })?.habits, 'exercise')).toMatchObject({
        state: 'on_track',
        value: 3,
        coverage: 12 / 28,
      });
    });

    test('too few exercise days with under 60% of days logged is "not enough logs", not off track', () => {
      expect(habit(card([], { exercise: exerciseDays(11) })?.habits, 'exercise')).toMatchObject({
        state: 'not_enough_logs',
        value: null,
        coverage: 11 / 28,
      });
    });

    test('a day counts only with a session of at least 10 minutes; several sessions on a day count once', () => {
      const sessions = [
        ...exerciseDays(11),
        session('2026-10-19', 9),
        session('2026-10-18', 5),
        session('2026-10-18', 5),
        session('2026-09-22', 30),
      ];
      expect(habit(card(loggedDays(), { exercise: sessions })?.habits, 'exercise')).toMatchObject({ state: 'off_track', value: 2.75 });
      expect(habit(card(loggedDays(), { exercise: [...sessions, session('2026-10-19', 10)] })?.habits, 'exercise')).toMatchObject({
        state: 'on_track',
        value: 3,
      });
    });

    test('a short session still makes its day a logged day', () => {
      // 16 daily logs plus a 5-minute session on another day: 17 of 28 days logged.
      const sessions = [session('2026-10-19', 5)];
      expect(habit(card(loggedDays(16), { exercise: sessions })?.habits, 'exercise')).toMatchObject({
        state: 'off_track',
        value: 0,
        coverage: 17 / 28,
      });
    });

    test('sessions outside the last 28 days do not count', () => {
      const sessions = [...exerciseDays(11), session('2026-09-21', 60), session('2026-10-20', 60)];
      expect(habit(card(loggedDays(), { exercise: sessions })?.habits, 'exercise').value).toBe(2.75);
    });

    test('with no logs and no sessions at all it is "not enough logs"', () => {
      expect(habit(card([log('2026-09-21', { sleepHours: 8 })])?.habits, 'exercise')).toMatchObject({
        state: 'not_enough_logs',
        value: null,
        coverage: 0,
      });
    });

    test('logged days without sessions are zero exercise days only when at least 60% of days are logged', () => {
      expect(habit(card(loggedDays(17))?.habits, 'exercise')).toMatchObject({
        state: 'off_track',
        value: 0,
        coverage: 17 / 28,
      });
      expect(habit(card(loggedDays(16))?.habits, 'exercise')).toMatchObject({
        state: 'not_enough_logs',
        value: null,
        coverage: 16 / 28,
      });
      expect(habit(card([log('2026-10-01', { cramps: 0 })])?.habits, 'exercise')).toMatchObject({
        state: 'not_enough_logs',
        value: null,
        coverage: 1 / 28,
      });
    });
  });

  describe('sleep', () => {
    const nights = (hours: (number | null)[]) =>
      series('2026-10-13', hours.map((h) => (h === null ? null : { sleepHours: h })));

    test('on track when the last 7 nights average at least the target', () => {
      expect(habit(card(nights([8, 8, 8, 8, 8, 8, 8]))?.habits, 'sleep')).toMatchObject({ state: 'on_track', value: 8, coverage: 1 });
      expect(habit(card(nights([8, 8, 8, 8, 8, 8, 7.5]))?.habits, 'sleep').state).toBe('off_track');
    });

    test('5 of 7 nights is enough, 4 is not', () => {
      expect(habit(card(nights([9, 7, 8, null, 8, null, 8]))?.habits, 'sleep')).toMatchObject({ state: 'on_track', value: 8 });
      expect(habit(card(nights([9, 9, 9, null, 9, null, null]))?.habits, 'sleep')).toMatchObject({
        state: 'not_enough_logs',
        value: null,
      });
    });

    test('the target comes from settings', () => {
      const c = card(nights([7, 7, 7, 7, 7, 7, 7]), { settings: settings({ sleepTargetHours: 7 }) });
      expect(habit(c?.habits, 'sleep')).toMatchObject({ state: 'on_track', target: 7 });
    });

    test('the night before the window is ignored', () => {
      const entries = [log('2026-10-12', { sleepHours: 3 }), ...nights([8, 8, 8, 8, 8, 8, 8])];
      expect(habit(card(entries)?.habits, 'sleep').value).toBe(8);
    });
  });

  test('counts on-track and known habits as neutral numbers', () => {
    const entries = [
      // Logged days with no sessions before the 10-day window, so all 28 exercise days are logged.
      ...dateRange('2026-09-22', '2026-10-09').map((d) => log(d)),
      ...windowDays(Array(10).fill({ magnesiumTaken: true, sugarServings: 3 })),
      ...series('2026-10-13', Array(7).fill({ sleepHours: 8 })),
    ];
    const c = card(entries);
    expect(c?.habits.map((h) => h.state)).toEqual(['on_track', 'off_track', 'off_track', 'on_track']);
    expect(c).toMatchObject({ onTrackCount: 2, knownCount: 4 });
  });

  test('while the period is late the window keeps running from lo - 14 to today', () => {
    const c = card([], { today: '2026-11-02' });
    expect(habit(c?.habits, 'magnesium').window).toEqual({ start: '2026-10-10', end: '2026-11-02' });
  });
});

describe('habitAdherenceBefore', () => {
  const P = '2026-11-01';

  test('windows end the day before the period start', () => {
    expect(habitAdherenceBefore(P, { logs: {}, exercise: [], settings: settings() }).map((h) => [h.habit, h.window])).toEqual([
      ['magnesium', { start: '2026-10-18', end: '2026-10-31' }],
      ['exercise', { start: '2026-10-04', end: '2026-10-31' }],
      ['sugar', { start: '2026-10-18', end: '2026-10-31' }],
      ['sleep', { start: '2026-10-25', end: '2026-10-31' }],
    ]);
  });

  test('uses the same thresholds as the prep card, and day 1 itself does not count', () => {
    const entries = [
      ...series('2026-10-18', Array(14).fill({ magnesiumTaken: true, sugarServings: 1 })),
      ...series('2026-10-25', Array(7).fill({ sleepHours: 8 })),
      log(P, { sleepHours: 2, magnesiumTaken: false, sugarServings: 3 }),
    ];
    const sessions = dateRange('2026-10-04', '2026-10-31')
      .filter((_, i) => i % 7 < 3)
      .map((d) => session(d, 15));
    const result = habitAdherenceBefore(P, { logs: logs(...entries), exercise: [...sessions, session(P, 60)], settings: settings() });
    expect(result.map((h) => [h.habit, h.state, h.value])).toEqual([
      ['magnesium', 'on_track', 1],
      ['exercise', 'on_track', 3],
      ['sugar', 'on_track', 1],
      ['sleep', 'on_track', 8],
    ]);
  });
});

describe('periodPainOutcome', () => {
  const P = '2026-11-01';

  test('the window is 2 days before day 1 through day 3', () => {
    expect(periodPainWindow(P)).toEqual({ start: '2026-10-30', end: '2026-11-03' });
    const data = logs(log('2026-10-29', { cramps: 10 }), ...series('2026-10-30', [{ cramps: 3 }, null, { cramps: 5 }]), log('2026-11-04', { cramps: 10 }));
    expect(periodPainOutcome(P, data)).toEqual({ peakCramps: 5, loggedDays: 2, painReliefDays: 0, highImpactDays: 0 });
  });

  test('the peak needs at least 2 logged cramp days', () => {
    expect(periodPainOutcome(P, logs(log(P, { cramps: 8 }))).peakCramps).toBeNull();
    expect(periodPainOutcome(P, logs(log(P, { cramps: 8 }), log('2026-11-02', { headache: 3 }))).peakCramps).toBeNull();
    expect(periodPainOutcome(P, {})).toEqual({ peakCramps: null, loggedDays: 0, painReliefDays: 0, highImpactDays: 0 });
  });

  test('0 is a logged score', () => {
    expect(periodPainOutcome(P, logs(log(P, { cramps: 0 }), log('2026-11-02', { cramps: 0 })))).toMatchObject({
      peakCramps: 0,
      loggedDays: 2,
    });
  });

  test('counts pain relief days (doses > 0) and days where usual things were not possible', () => {
    const data = logs(
      ...series('2026-10-30', [
        { painReliefDoses: 0, painImpact: 'some' },
        { painReliefDoses: 2, painImpact: 'couldnt_do_usual' },
        { painReliefDoses: 1, painImpact: 'couldnt_do_usual' },
        { painImpact: 'none' },
        { painReliefDoses: 3 },
      ]),
    );
    expect(periodPainOutcome(P, data)).toMatchObject({ painReliefDays: 3, highImpactDays: 2 });
  });
});

describe('habitPatterns', () => {
  interface PeriodSpec {
    /** Hours on each of the 7 nights before day 1. */
    sleep: number;
    /** How many of those nights were logged (default 7). */
    sleepNights?: number;
    /** Cramp scores on day 1, day 2, ... */
    cramps: number[];
    /** Pain-relief doses on day 1; undefined leaves it unlogged. */
    relief?: number;
  }

  /** Periods 28 days apart from Jan 5, each with sleep before it and cramps during it. */
  function history(specs: PeriodSpec[]) {
    const entries = specs.flatMap((spec, i) => {
      const P = addDays('2026-01-05', 28 * i);
      const nights = spec.sleepNights ?? 7;
      return [
        ...series(addDays(P, -7), Array.from({ length: 7 }, (_, n) => (n < 7 - nights ? null : { sleepHours: spec.sleep }))),
        ...series(
          P,
          spec.cramps.map((cramps, d) => ({
            cramps,
            flow: 'medium' as const,
            ...(d === 0 ? { periodStartConfirmed: true } : {}),
            ...(d === 0 && spec.relief !== undefined ? { painReliefDoses: spec.relief } : {}),
          })),
        ),
      ];
    });
    const data = logs(...entries);
    return habitPatterns({ cycles: deriveCycles(data), logs: data, exercise: [], settings: settings() });
  }

  const pattern = (result: ReturnType<typeof habitPatterns>, key: HabitKey) => result.find((p) => p.habit === key)!;
  const on = (peak: number, extra: Partial<PeriodSpec> = {}): PeriodSpec => ({ sleep: 8, cramps: [peak, peak - 1], ...extra });
  const off = (peak: number, extra: Partial<PeriodSpec> = {}): PeriodSpec => ({ sleep: 6, cramps: [peak, peak - 1], ...extra });

  test('always returns all four habits, in order', () => {
    expect(habitPatterns({ cycles: [], logs: {}, exercise: [], settings: settings() }).map((p) => [p.habit, p.state])).toEqual(
      HABITS.map((h) => [h, 'need_more_cycles']),
    );
  });

  test('compares median peak cramps when each group has at least 3 cycles', () => {
    const result = history([on(3), off(7), on(4), off(6), on(3), off(8)]);
    expect(pattern(result, 'sleep')).toEqual({
      habit: 'sleep',
      state: 'pattern',
      onTrack: { n: 3, median: 3 },
      offTrack: { n: 3, median: 7 },
      painReliefShareOn: null,
      painReliefShareOff: null,
    });
  });

  test('habits that were never logged need more cycles', () => {
    const result = history([on(3), off(7), on(4), off(6), on(3), off(8)]);
    expect(pattern(result, 'magnesium')).toMatchObject({ state: 'need_more_cycles', onTrack: { n: 0, median: null }, offTrack: { n: 0, median: null } });
    expect(pattern(result, 'sugar').state).toBe('need_more_cycles');
    // Sleep and cramps are logged on about 9 of the 28 days before each period: too few to call exercise missed.
    expect(pattern(result, 'exercise')).toMatchObject({ state: 'need_more_cycles', onTrack: { n: 0 }, offTrack: { n: 0 } });
  });

  test('a difference under 2 points is "no clear difference"; exactly 2 is a pattern', () => {
    expect(pattern(history([on(4), off(5), on(5), off(6), on(4), off(5)]), 'sleep')).toMatchObject({
      state: 'no_clear_difference',
      onTrack: { n: 3, median: 4 },
      offTrack: { n: 3, median: 5 },
    });
    expect(pattern(history([on(3), off(5), on(3), off(5), on(3), off(5)]), 'sleep').state).toBe('pattern');
  });

  test('a pattern in either direction is reported', () => {
    expect(pattern(history([on(7), off(3), on(7), off(3), on(7), off(3)]), 'sleep')).toMatchObject({
      state: 'pattern',
      onTrack: { median: 7 },
      offTrack: { median: 3 },
    });
  });

  test('medians use the middle of an even group', () => {
    expect(pattern(history([on(2), off(7), on(3), off(7), on(5), off(7), on(6)]), 'sleep')).toMatchObject({
      onTrack: { n: 4, median: 4 },
      offTrack: { n: 3, median: 7 },
    });
  });

  test('with fewer than 3 cycles in a group no comparison is given', () => {
    expect(pattern(history([on(3), off(7), on(4), off(6), off(8)]), 'sleep')).toEqual({
      habit: 'sleep',
      state: 'need_more_cycles',
      onTrack: { n: 2, median: null },
      offTrack: { n: 3, median: null },
      painReliefShareOn: null,
      painReliefShareOff: null,
    });
  });

  test('periods without a pain outcome or without known adherence are left out', () => {
    const result = history([
      on(3),
      off(7),
      on(4),
      off(6),
      { sleep: 8, cramps: [2] }, // only one cramp day logged
      { sleep: 8, sleepNights: 4, cramps: [2, 2] }, // sleep not logged enough
      off(8),
    ]);
    expect(pattern(result, 'sleep')).toMatchObject({ state: 'need_more_cycles', onTrack: { n: 2 }, offTrack: { n: 3 } });
  });

  test('pain relief is shown alongside, as a share of the cycles where it was logged', () => {
    const result = history([
      on(3, { relief: 2 }),
      off(7),
      on(4, { relief: 0 }),
      off(6),
      on(3),
      off(8),
    ]);
    expect(pattern(result, 'sleep')).toMatchObject({ painReliefShareOn: 0.5, painReliefShareOff: null });
  });
});
