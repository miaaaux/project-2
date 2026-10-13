import { deriveCycles } from './cycles';
import { addDays, diffDays, type ISODate } from './date';
import { confirmedRises, derive, isFertilityVisible, logsThrough, type DerivedState } from './derive';
import { evaluateFertility } from './fertility';
import { cycleLogs, DEVICE_OFFSET, historyCycle, noAnswer } from './fertility/testing';
import { HABITS } from './painGuide';
import { appData, log, logs, series, settings } from './testing/fixtures';
import type { AppData, ContextPeriod, DailyLog, ExerciseSession, Settings } from './types';

// ------------------------------------------------------------ scenario
//
// Four completed cycles of 28, 30, 27 and 29 days, each charted with its first
// higher measurement (FHM) on cycle day 15 and its mucus peak on day 14, then
// the current cycle, whose FHM falls on day 13 and is confirmed on day 15.
// Every day also logs 8 h of sleep, magnesium, 2 sweet servings and cramps
// (6, 5, 3 on days 1-3, otherwise 0); there is a 20-minute session every
// other day.

const CURRENT_START = '2026-09-21';
const COMPLETED_LENGTHS = [28, 30, 27, 29];
const CURRENT_FHM_DAY = 13;
const CRAMPS_BY_DAY = [6, 5, 3];
const ACKNOWLEDGED = { enabled: true, acknowledgedAt: '2026-01-01T10:00:00Z' };

/** Cycle day `n` of the current cycle. */
const cd = (n: number): ISODate => addDays(CURRENT_START, n - 1);

/** Every confirmed start, oldest first; the last is the current cycle's. */
function cycleStarts(): ISODate[] {
  const starts = [CURRENT_START];
  for (const length of [...COMPLETED_LENGTHS].reverse()) starts.unshift(addDays(starts[0], -length));
  return starts;
}

function withHabits(entry: DailyLog, cycleDay: number): DailyLog {
  return {
    ...entry,
    sleepHours: 8,
    magnesiumTaken: true,
    sugarServings: 2,
    cramps: CRAMPS_BY_DAY[cycleDay - 1] ?? 0,
    painReliefDoses: cycleDay === 1 ? 1 : 0,
  };
}

function sessionsEveryOtherDay(from: ISODate, to: ISODate): ExerciseSession[] {
  const out: ExerciseSession[] = [];
  for (let d = from; diffDays(to, d) >= 0; d = addDays(d, 2)) {
    out.push({ id: `ex-${d}`, date: d, kind: 'yoga', minutes: 20, routineId: 'luteal-yoga', exerciseIds: ['cobra'] });
  }
  return out;
}

/** The scenario as logged up to and including `today` (a day of the current cycle). */
function scenario(today: ISODate, overrides: Partial<Settings> = {}): AppData {
  const starts = cycleStarts();
  const currentDays = diffDays(today, CURRENT_START) + 1;
  const cycles = [
    ...COMPLETED_LENGTHS.map((length, i) => cycleLogs(starts[i], historyCycle(15, length))),
    cycleLogs(CURRENT_START, historyCycle(CURRENT_FHM_DAY, currentDays)),
  ];
  const entries = cycles.flatMap((cycle) => cycle.map((entry, i) => withHabits(entry, i + 1)));
  return appData({
    logs: logs(...entries),
    exercise: sessionsEveryOtherDay(starts[0], today),
    cycleContextAnswers: starts.map(noAnswer),
    settings: settings(overrides),
  });
}

function deriveOn(data: AppData, today: ISODate): DerivedState {
  return derive(data, { today, now: { date: today, time: '08:00' }, deviceUtcOffsetMinutes: DEVICE_OFFSET });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const isInfertile = (status: string) => status === 'infertile_pre_ovulatory' || status === 'infertile_post_ovulatory';

// ------------------------------------------------------------ end to end

describe('derive: five logged cycles end to end', () => {
  const TODAY = cd(20);

  test('cycles come from the confirmed period starts and line up with the fertility engine', () => {
    const d = deriveOn(scenario(TODAY), TODAY);
    expect(d.today).toBe(TODAY);
    expect(d.cycles.map((c) => c.start)).toEqual(cycleStarts());
    expect(d.cycles.map((c) => c.length)).toEqual([...COMPLETED_LENGTHS, null]);
    expect(d.currentCycle).toMatchObject({ index: 4, start: CURRENT_START, end: null });
    expect(d.fertility.cycles.map((c) => c.cycleIndex)).toEqual(d.cycles.map((c) => c.index));
    expect(d.fertility.days[d.fertility.days.length - 1].date).toBe(TODAY);
  });

  test('before the current rise, the prediction comes from the cycle lengths', () => {
    const today = cd(12);
    const d = deriveOn(scenario(today), today);
    expect(d.rises.map((r) => r.cycleIndex)).toEqual([0, 1, 2, 3]);
    expect(d.prediction).toMatchObject({
      basis: 'calendar',
      cycleStart: CURRENT_START,
      eligibleLengths: COMPLETED_LENGTHS,
      // Median of 27-30 is 28.5, rounded to 29; the range runs from the shortest to the longest cycle.
      center: addDays(CURRENT_START, 29),
      lo: addDays(CURRENT_START, 27),
      hi: addDays(CURRENT_START, 31),
      confidence: 'building',
      regular: true,
      status: 'upcoming',
    });
  });

  test('the confirmed rise in the current cycle feeds the post-rise prediction', () => {
    // On day 14 only two higher readings exist, so the rise is not confirmed yet.
    const before = deriveOn(scenario(cd(14)), cd(14));
    expect(before.rises.some((r) => r.cycleIndex === 4)).toBe(false);
    expect(before.prediction.basis).toBe('calendar');

    const d = deriveOn(scenario(cd(15)), cd(15));
    const fhm = cd(CURRENT_FHM_DAY);
    expect(d.rises).toContainEqual({ cycleIndex: 4, fhmDate: fhm });
    expect(d.rises).toEqual(confirmedRises(d.fertility));
    // Earlier cycles ran 14, 16, 13 and 15 days from their FHM: median 14.5 rounds to 15, range 13-1 to 16+1.
    expect(d.prediction).toMatchObject({
      basis: 'post_rise',
      center: addDays(fhm, 15),
      lo: addDays(fhm, 12),
      hi: addDays(fhm, 17),
      // Cycle history still describes confidence and regularity.
      confidence: 'building',
      regular: true,
    });
  });

  test('reminders anchor to the start of the predicted range and follow it after the rise', () => {
    const sugarOn = { reminders: { ...settings().reminders, sugarEnabled: true } };
    const early = deriveOn(scenario(cd(12), sugarOn), cd(12));
    expect(early.reminders.map((r) => [r.key, r.fireDate])).toEqual([
      ['sugar:2026-09-21', addDays(early.prediction.lo as ISODate, -14)],
      ['prep:2026-09-21', addDays(early.prediction.lo as ISODate, -3)],
    ]);

    const late = deriveOn(scenario(TODAY, sugarOn), TODAY);
    expect(late.prediction.lo).toBe('2026-10-15');
    expect(late.reminders).toEqual([
      { key: 'sugar:2026-09-21', type: 'sugar', cycleStart: CURRENT_START, fireDate: '2026-10-01', fireTime: '09:00' },
      { key: 'prep:2026-09-21', type: 'prep', cycleStart: CURRENT_START, fireDate: '2026-10-12', fireTime: '09:00' },
    ]);
  });

  test('the prep card appears 14 days before the predicted start and counts habits on track', () => {
    // On day 12 the range starts on 2026-10-18, so the card's window opens on 2026-10-04.
    expect(deriveOn(scenario(cd(12)), cd(12)).prepCard).toBeNull();

    const d = deriveOn(scenario(TODAY), TODAY);
    const card = d.prepCard;
    expect(card).not.toBeNull();
    expect(card!.habits.map((h) => [h.habit, h.state])).toEqual([
      ['magnesium', 'on_track'],
      ['exercise', 'on_track'],
      ['sugar', 'off_track'],
      ['sleep', 'on_track'],
    ]);
    expect(card!.onTrackCount).toBe(3);
    expect(card!.knownCount).toBe(4);
    expect(card!.habits[0].window).toEqual({ start: addDays(d.prediction.lo as ISODate, -14), end: TODAY });
  });

  test('patterns show all four habits, and these logs raise no red flags', () => {
    const d = deriveOn(scenario(TODAY), TODAY);
    expect(d.patterns.map((p) => p.habit)).toEqual(HABITS);
    // Every period followed the same habits, so there is nothing to compare against yet.
    expect(d.patterns.every((p) => p.state === 'need_more_cycles')).toBe(true);
    expect(d.redFlags).toEqual([]);
    expect(d.unconfirmedBleedingStarts).toEqual([]);
  });

  test('the calendar fertile window estimate covers the current cycle only', () => {
    const d = deriveOn(scenario(cd(12)), cd(12));
    const w = d.fertileWindowEstimate;
    expect(w).not.toBeNull();
    expect(diffDays(w!.start, CURRENT_START)).toBeGreaterThanOrEqual(0);
    expect(diffDays(w!.end, w!.start)).toBeGreaterThan(0);
    expect(diffDays(d.prediction.lo as ISODate, w!.end)).toBeGreaterThan(0);
  });

  describe('contraception mode', () => {
    test('off by default: fertility is computed for the chart but never shown', () => {
      const data = scenario(TODAY);
      expect(data.settings.contraceptionMode.enabled).toBe(false);
      const d = deriveOn(data, TODAY);
      expect(d.fertilityVisible).toBe(false);
      expect(d.todayFertility).toBeNull();
      expect(d.fertility.cycles[4].rise?.fhmDate).toBe(cd(CURRENT_FHM_DAY));
      expect(d.fertility.cycles[4].doubleCheckDate).not.toBeNull();
      expect(d.fertility.days.some((day) => isInfertile(day.status) || day.eveningTransition)).toBe(false);
    });

    test('enabled but not acknowledged is still hidden', () => {
      const d = deriveOn(scenario(TODAY, { contraceptionMode: { enabled: true } }), TODAY);
      expect(d.fertilityVisible).toBe(false);
      expect(d.todayFertility).toBeNull();
      expect(d.fertility.days.some((day) => isInfertile(day.status))).toBe(false);
    });

    test('visible after acknowledgement: today is infertile after the double check', () => {
      const d = deriveOn(scenario(TODAY, { contraceptionMode: ACKNOWLEDGED }), TODAY);
      expect(d.fertilityVisible).toBe(true);
      expect(d.todayFertility).toMatchObject({ date: TODAY, cycleDay: 20, status: 'infertile_post_ovulatory' });
      expect(d.todayFertility).toBe(d.fertility.days.find((day) => day.date === TODAY));
    });

    test('the mode changes nothing but the fertility labels', () => {
      const off = deriveOn(scenario(TODAY), TODAY);
      const on = deriveOn(scenario(TODAY, { contraceptionMode: ACKNOWLEDGED }), TODAY);
      for (const key of ['cycles', 'rises', 'prediction', 'reminders', 'prepCard', 'patterns', 'redFlags'] as const) {
        expect(on[key]).toEqual(off[key]);
      }
      expect(on.fertility.cycles).toEqual(off.fertility.cycles);
    });
  });

  test('derive is deterministic and does not mutate its input', () => {
    const data = scenario(TODAY, { contraceptionMode: ACKNOWLEDGED });
    const before = JSON.stringify(data);
    deepFreeze(data);
    const first = deriveOn(data, TODAY);
    const second = deriveOn(data, TODAY);
    expect(second).toEqual(first);
    expect(JSON.stringify(data)).toBe(before);
  });
});

// ------------------------------------------------------------ edge cases

describe('derive: edge cases', () => {
  const TODAY = '2026-10-13';

  test('no data at all', () => {
    const d = deriveOn(appData({ settings: settings({ contraceptionMode: ACKNOWLEDGED }) }), TODAY);
    expect(d).toMatchObject({
      cycles: [],
      currentCycle: null,
      fertility: { days: [], cycles: [], readings: [] },
      fertilityVisible: true,
      todayFertility: null,
      rises: [],
      fertileWindowEstimate: null,
      reminders: [],
      prepCard: null,
      redFlags: [],
      unconfirmedBleedingStarts: [],
    });
    expect(d.prediction.basis).toBe('none');
    expect(d.patterns.map((p) => p.state)).toEqual(['need_more_cycles', 'need_more_cycles', 'need_more_cycles', 'need_more_cycles']);
  });

  test('a single period start uses the onboarding answer', () => {
    const data = appData({
      logs: logs(log('2026-10-01', { flow: 'heavy', periodStartConfirmed: true })),
      settings: settings({ typicalCycleLength: 30 }),
    });
    const d = deriveOn(data, TODAY);
    expect(d.prediction).toMatchObject({ basis: 'prior', center: '2026-10-31', lo: '2026-10-27', hi: '2026-11-07' });
    expect(d.reminders.map((r) => [r.type, r.fireDate])).toEqual([['prep', '2026-10-24']]);
  });

  test('logs dated after today are ignored, so cycle indices match the fertility engine', () => {
    const base = logs(
      log('2026-09-01', { flow: 'heavy', periodStartConfirmed: true }),
      log('2026-09-29', { flow: 'heavy', periodStartConfirmed: true }),
    );
    const withFuture = { ...base, '2026-10-14': log('2026-10-14', { flow: 'heavy', periodStartConfirmed: true }) };
    const d = deriveOn(appData({ logs: withFuture }), TODAY);
    expect(d.cycles).toEqual(deriveCycles(base));
    expect(d.currentCycle?.start).toBe('2026-09-29');
    expect(d.fertility.cycles.map((c) => c.cycleIndex)).toEqual([0, 1]);

    const tomorrow = deriveOn(appData({ logs: withFuture }), '2026-10-14');
    expect(tomorrow.currentCycle?.start).toBe('2026-10-14');
  });

  test('bleeding the user answered "no" about is no longer an open question', () => {
    const entries = [
      ...series('2026-09-01', [{ flow: 'heavy', periodStartConfirmed: true }, { flow: 'medium' }, { flow: 'light' }]),
      log('2026-09-15', { flow: 'light' }),
    ];
    expect(deriveOn(appData({ logs: logs(...entries) }), TODAY).unconfirmedBleedingStarts).toEqual(['2026-09-15']);

    const answered = logs(...entries, log('2026-09-15', { flow: 'light', notPeriodStart: true }));
    expect(deriveOn(appData({ logs: answered }), TODAY).unconfirmedBleedingStarts).toEqual([]);
  });

  test('a pregnancy pauses reminders but keeps the cycle history', () => {
    const data = appData({
      logs: logs(...[0, 28, 56].map((n) => log(addDays('2026-07-20', n), { flow: 'heavy', periodStartConfirmed: true }))),
    });
    const pregnancy: ContextPeriod = { id: 'p', kind: 'pregnancy', start: '2026-10-01' };
    expect(deriveOn(data, TODAY).reminders.length).toBeGreaterThan(0);
    const d = deriveOn({ ...data, contexts: [pregnancy] }, TODAY);
    expect(d.reminders).toEqual([]);
    expect(d.cycles).toHaveLength(3);
  });

  test('an invalid today is rejected', () => {
    expect(() => deriveOn(appData(), '2026-13-01')).toThrow('Invalid ISO date');
  });
});

describe('derive helpers', () => {
  test('isFertilityVisible needs both the switch and the acknowledgement', () => {
    expect(isFertilityVisible(settings())).toBe(false);
    expect(isFertilityVisible(settings({ contraceptionMode: { enabled: true } }))).toBe(false);
    expect(isFertilityVisible(settings({ contraceptionMode: { enabled: true, acknowledgedAt: '' } }))).toBe(false);
    expect(isFertilityVisible(settings({ contraceptionMode: { enabled: false, acknowledgedAt: '2026-01-01T10:00:00Z' } }))).toBe(false);
    expect(isFertilityVisible(settings({ contraceptionMode: ACKNOWLEDGED }))).toBe(true);
  });

  test('logsThrough keeps today and earlier, and drops keys that are not dates', () => {
    const entries = logs(log('2026-10-12'), log('2026-10-13'), log('2026-10-14'));
    const out = logsThrough({ ...entries, 'not-a-date': log('not-a-date') }, '2026-10-13');
    expect(Object.keys(out).sort()).toEqual(['2026-10-12', '2026-10-13']);
    expect(out['2026-10-12']).toBe(entries['2026-10-12']);
  });

  test('confirmedRises lists one rise per cycle that has one', () => {
    const today = cd(20);
    const fertility = evaluateFertility(scenario(today), today, DEVICE_OFFSET);
    expect(confirmedRises(fertility).map((r) => r.cycleIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(confirmedRises({ days: [], cycles: [], readings: [] })).toEqual([]);
  });
});

describe('derive: a long cycle the user confirmed as real', () => {
  // Cycles of 28, 28, 28 and 58 days: the 58-day cycle looks like a forgotten period log.
  const starts = ['2026-01-01', '2026-01-29', '2026-02-26', '2026-03-26', '2026-05-23'];
  const base = appData({ logs: logs(...starts.map((d) => log(d, { flow: 'heavy', periodStartConfirmed: true }))) });
  const options = { today: '2026-06-01', now: { date: '2026-06-01', time: '09:00' }, deviceUtcOffsetMinutes: 60 };

  test('is asked about and left out of the prediction until confirmed', () => {
    const d = derive(base, options);
    expect(d.prediction.askAboutCycles).toEqual([3]);
    expect(d.prediction.eligibleLengths).not.toContain(58);
  });

  test('once confirmed by its start date, it is no longer asked about and counts', () => {
    const confirmed = { ...base, settings: { ...base.settings, confirmedRealCycleStarts: ['2026-03-26'] } };
    const d = derive(confirmed, options);
    expect(d.prediction.askAboutCycles).toEqual([]);
    expect(d.prediction.eligibleLengths).toContain(58);
  });
});
