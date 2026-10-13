import { deriveCycles, type Cycle } from './cycles';
import { addDays, diffDays, type ISODate } from './date';
import { predictNextPeriod } from './prediction';
import {
  desiredReminders,
  planReminderSync,
  reminderKey,
  remindersPaused,
  type DesiredReminder,
  type ReminderPrediction,
  type ReminderSyncPlan,
  type StoredReminder,
} from './reminders';
import { logs, series, settings } from './testing/fixtures';
import type { ContextPeriod, DailyLog, Settings } from './types';

const START = '2026-10-01';

/** A confirmed period of `days` bleeding days from `start`. */
function period(start: ISODate, days: number): DailyLog[] {
  return series(
    start,
    Array.from({ length: days }, (_, i) => (i === 0 ? { flow: 'heavy', periodStartConfirmed: true } : { flow: 'medium' })),
  );
}

function openCycle(start: ISODate = START, periodDays = 5): Cycle {
  const cycles = deriveCycles(logs(...period(start, periodDays)));
  return cycles[cycles.length - 1];
}

/** lo/center/hi as offsets from START. */
function pred(lo: number | null, center = 28, status: ReminderPrediction['status'] = 'upcoming'): ReminderPrediction {
  return {
    lo: lo === null ? null : addDays(START, lo),
    center: lo === null ? null : addDays(START, center),
    status,
  };
}

function reminderSettings(reminders: Partial<Settings['reminders']> = {}): Settings {
  const s = settings();
  return { ...s, reminders: { ...s.reminders, ...reminders } };
}

function desired(
  partial: {
    currentCycle?: Cycle | undefined;
    prediction?: ReminderPrediction;
    settings?: Settings;
    contexts?: ContextPeriod[];
    today?: ISODate;
  } = {},
): DesiredReminder[] {
  return desiredReminders({
    currentCycle: 'currentCycle' in partial ? partial.currentCycle : openCycle(),
    prediction: partial.prediction ?? pred(26),
    settings: partial.settings ?? reminderSettings(),
    contexts: partial.contexts ?? [],
    today: partial.today ?? addDays(START, 10),
  });
}

function context(kind: ContextPeriod['kind'], start: ISODate, end?: ISODate): ContextPeriod {
  return { id: `${kind}-${start}`, kind, start, end };
}

const brief = (rs: DesiredReminder[]) => rs.map((r) => [r.type, r.fireDate]);

describe('desiredReminders', () => {
  test('prep fires 3 days before the start of the predicted range, at the reminder time', () => {
    expect(desired()).toEqual([
      { key: 'prep:2026-10-01', type: 'prep', cycleStart: START, fireDate: '2026-10-24', fireTime: '09:00' },
    ]);
  });

  test('the opt-in sugar reminder fires 14 days before the range start, ahead of prep', () => {
    const rs = desired({ settings: reminderSettings({ sugarEnabled: true, time: '19:30' }) });
    expect(rs).toEqual([
      { key: 'sugar:2026-10-01', type: 'sugar', cycleStart: START, fireDate: '2026-10-13', fireTime: '19:30' },
      { key: 'prep:2026-10-01', type: 'prep', cycleStart: START, fireDate: '2026-10-24', fireTime: '19:30' },
    ]);
  });

  test('both anchor to lo, not to the center of the range', () => {
    const rs = desired({ prediction: pred(22, 30), settings: reminderSettings({ sugarEnabled: true }) });
    expect(brief(rs)).toEqual([
      ['sugar', addDays(START, 8)],
      ['prep', addDays(START, 19)],
    ]);
  });

  test('each type can be switched off', () => {
    expect(desired({ settings: reminderSettings({ prepEnabled: false }) })).toEqual([]);
    expect(brief(desired({ settings: reminderSettings({ prepEnabled: false, sugarEnabled: true }) }))).toEqual([
      ['sugar', '2026-10-13'],
    ]);
  });

  test('sugar never fires during the period: it moves to the day after the period ends', () => {
    // lo = Oct 19, so lo - 14 = Oct 5, but the period runs Oct 1-7.
    const rs = desired({ currentCycle: openCycle(START, 7), prediction: pred(18, 20), settings: reminderSettings({ sugarEnabled: true }) });
    expect(brief(rs)).toEqual([
      ['sugar', '2026-10-08'],
      ['prep', '2026-10-16'],
    ]);
  });

  test('sugar never fires before cycle start + 5, even after a one-day period', () => {
    const rs = desired({ currentCycle: openCycle(START, 1), prediction: pred(17, 20), settings: reminderSettings({ sugarEnabled: true }) });
    expect(brief(rs)).toEqual([
      ['sugar', '2026-10-06'],
      ['prep', '2026-10-15'],
    ]);
  });

  test('in a very short cycle sugar is dropped when it would fall within 4 days of prep', () => {
    const sugarOn = reminderSettings({ sugarEnabled: true });
    // lo = Oct 16, prep = Oct 13. An 8-day period puts sugar on Oct 9: exactly 4 days before prep, kept.
    expect(brief(desired({ currentCycle: openCycle(START, 8), prediction: pred(15, 18), settings: sugarOn }))).toEqual([
      ['sugar', '2026-10-09'],
      ['prep', '2026-10-13'],
    ]);
    // A 9-day period puts sugar on Oct 10: 3 days before prep, dropped.
    expect(brief(desired({ currentCycle: openCycle(START, 9), prediction: pred(15, 18), settings: sugarOn }))).toEqual([
      ['prep', '2026-10-13'],
    ]);
  });

  test('the short-cycle drop uses the prep date even when prep is switched off', () => {
    const rs = desired({
      currentCycle: openCycle(START, 9),
      prediction: pred(15, 18),
      settings: reminderSettings({ prepEnabled: false, sugarEnabled: true }),
    });
    expect(rs).toEqual([]);
  });

  test('none without a prediction, without an open cycle, or when the period is late', () => {
    expect(desired({ prediction: pred(null) })).toEqual([]);
    expect(desired({ currentCycle: undefined })).toEqual([]);
    expect(desired({ prediction: pred(26, 28, 'late') })).toEqual([]);
    const [closed] = deriveCycles(logs(...period(START, 5), ...period('2026-10-29', 5)));
    expect(desired({ currentCycle: closed })).toEqual([]);
  });

  test('a prediction that is in range still has reminders (the past-due rules decide)', () => {
    expect(brief(desired({ prediction: pred(26, 28, 'in_range'), today: addDays(START, 27) }))).toEqual([
      ['prep', '2026-10-24'],
    ]);
  });

  test.each(['pregnancy', 'postpartum', 'hormonal_contraception'] as const)(
    'reminders pause while a %s context covers today',
    (kind) => {
      const today = addDays(START, 10);
      expect(desired({ today, contexts: [context(kind, '2026-09-01')] })).toEqual([]);
      expect(desired({ today, contexts: [context(kind, '2026-09-01', today)] })).toEqual([]);
      expect(desired({ today, contexts: [context(kind, today, '2026-12-01')] })).toEqual([]);
    },
  );

  test('a context that ended before today or starts after it does not pause reminders', () => {
    const today = addDays(START, 10);
    expect(desired({ today, contexts: [context('pregnancy', '2026-01-01', addDays(today, -1))] })).toHaveLength(1);
    expect(desired({ today, contexts: [context('hormonal_contraception', addDays(today, 1))] })).toHaveLength(1);
  });

  test('breastfeeding, perimenopause and emergency contraception do not pause reminders', () => {
    const contexts = [
      context('breastfeeding', '2026-03-01'),
      context('perimenopause', '2026-01-01'),
      context('emergency_contraception', '2026-10-05', '2026-10-20'),
    ];
    expect(desired({ contexts })).toHaveLength(1);
    expect(remindersPaused(contexts, '2026-10-11')).toBe(false);
  });

  test('the reminder time is normalised, and a malformed one falls back to 09:00', () => {
    expect(desired({ settings: reminderSettings({ time: '7:05' }) })[0].fireTime).toBe('07:05');
    expect(desired({ settings: reminderSettings({ time: 'later' }) })[0].fireTime).toBe('09:00');
  });

  test('works with the real prediction: prep is lo - 3 for the open cycle', () => {
    const history = logs(...period('2026-07-06', 5), ...period('2026-08-03', 5), ...period('2026-08-31', 5), ...period('2026-09-28', 5));
    const cycles = deriveCycles(history);
    const prediction = predictNextPeriod({ cycles, contexts: [], settings: settings(), rises: [], today: '2026-10-05' });
    const current = cycles[cycles.length - 1];
    const rs = desiredReminders({ currentCycle: current, prediction, settings: settings(), contexts: [], today: '2026-10-05' });
    expect(prediction.lo).not.toBeNull();
    expect(rs).toHaveLength(1);
    expect(rs[0].key).toBe(reminderKey('prep', '2026-09-28'));
    expect(diffDays(prediction.lo as ISODate, rs[0].fireDate)).toBe(3);
  });
});

// ------------------------------------------------------------------ sync

const NOW = { date: '2026-10-13', time: '12:00' };

function want(type: DesiredReminder['type'], fireDate: ISODate, fireTime = '09:00', cycleStart = START): DesiredReminder {
  return { key: reminderKey(type, cycleStart), type, cycleStart, fireDate, fireTime };
}

function stored(r: DesiredReminder, status: StoredReminder['status'], sentDate?: ISODate): StoredReminder {
  const s: StoredReminder = { key: r.key, type: r.type, fireDate: r.fireDate, fireTime: r.fireTime, status };
  return sentDate ? { ...s, sentDate } : s;
}

/** Prediction around NOW: lo and center as day offsets from NOW. */
function around(lo: number, center: number): ReminderPrediction {
  return { lo: addDays(NOW.date, lo), center: addDays(NOW.date, center), status: 'upcoming' };
}

const FAR = around(20, 22);
const EMPTY: ReminderSyncPlan = { schedule: [], cancel: [], skip: [] };

/** What the notifications layer does with a plan, without the OS. */
function apply(plan: ReminderSyncPlan, before: StoredReminder[]): StoredReminder[] {
  const byKey = new Map(before.map((s) => [s.key, s]));
  for (const key of plan.cancel) byKey.set(key, { ...byKey.get(key)!, status: 'cancelled' });
  for (const key of plan.skip) {
    const s = byKey.get(key);
    if (s) byKey.set(key, { ...s, status: 'skipped' });
  }
  for (const r of plan.schedule) byKey.set(r.key, { key: r.key, type: r.type, fireDate: r.fireDate, fireTime: r.fireTime, status: 'pending' });
  return [...byKey.values()];
}

describe('planReminderSync', () => {
  test('a new future reminder is scheduled as is', () => {
    const r = want('prep', '2026-10-30');
    expect(planReminderSync([r], [], NOW, FAR)).toEqual({ schedule: [r], cancel: [], skip: [] });
  });

  test('an unchanged pending reminder is left alone', () => {
    const r = want('prep', '2026-10-30');
    expect(planReminderSync([r], [stored(r, 'pending')], NOW, FAR)).toEqual(EMPTY);
  });

  test('the same key with a new date or time is scheduled again, which replaces it', () => {
    const r = want('prep', '2026-10-30');
    const moved = want('prep', '2026-11-02');
    const retimed = want('prep', '2026-10-30', '20:00');
    expect(planReminderSync([moved], [stored(r, 'pending')], NOW, FAR)).toEqual({ schedule: [moved], cancel: [], skip: [] });
    expect(planReminderSync([retimed], [stored(r, 'pending')], NOW, FAR)).toEqual({ schedule: [retimed], cancel: [], skip: [] });
  });

  test('a pending reminder that is no longer wanted is cancelled', () => {
    const r = want('sugar', '2026-10-20');
    expect(planReminderSync([], [stored(r, 'pending')], NOW, FAR)).toEqual({ schedule: [], cancel: [r.key], skip: [] });
  });

  test('sent, cancelled and skipped reminders that are no longer wanted need nothing', () => {
    const states = (['sent', 'cancelled', 'skipped'] as const).map((status, i) =>
      stored(want('prep', '2026-10-01', '09:00', addDays('2026-08-01', i)), status),
    );
    expect(planReminderSync([], states, NOW, FAR)).toEqual(EMPTY);
  });

  test('a period that starts early cancels the old cycle reminder and schedules the new one', () => {
    const old = want('prep', '2026-10-20', '09:00', '2026-09-26');
    const fresh = want('prep', '2026-11-05', '09:00', '2026-10-12');
    expect(planReminderSync([fresh], [stored(old, 'pending')], NOW, FAR)).toEqual({
      schedule: [fresh],
      cancel: [old.key],
      skip: [],
    });
  });

  test('sent and skipped reminders are never rescheduled, even when their date moves', () => {
    const r = want('prep', '2026-10-10');
    const later = want('prep', '2026-10-30');
    expect(planReminderSync([later], [stored(r, 'sent', '2026-10-10')], NOW, FAR)).toEqual(EMPTY);
    expect(planReminderSync([later], [stored(r, 'skipped')], NOW, FAR)).toEqual(EMPTY);
  });

  test('a cancelled reminder that is wanted again is scheduled', () => {
    const r = want('prep', '2026-10-30');
    expect(planReminderSync([r], [stored(r, 'cancelled')], NOW, FAR).schedule).toEqual([r]);
  });

  describe('past-due reminders', () => {
    test('prep still goes out at the next minute while today is before the center', () => {
      const r = want('prep', '2026-10-12');
      expect(planReminderSync([r], [], NOW, around(1, 1))).toEqual({
        schedule: [{ ...r, fireDate: '2026-10-13', fireTime: '12:01' }],
        cancel: [],
        skip: [],
      });
    });

    test('prep is skipped from the center onwards', () => {
      const r = want('prep', '2026-10-10');
      expect(planReminderSync([r], [], NOW, around(-1, 0))).toEqual({ schedule: [], cancel: [], skip: [r.key] });
    });

    test('a skipped reminder that is still pending in the OS is cancelled as well', () => {
      // Scheduled for later, then the prediction moved earlier past its fire date and center.
      const before = want('prep', '2026-10-20');
      const now = want('prep', '2026-10-09');
      expect(planReminderSync([now], [stored(before, 'pending')], NOW, around(-1, 0))).toEqual({
        schedule: [],
        cancel: [now.key],
        skip: [now.key],
      });
    });

    test('sugar still goes out while lo is at least 5 days away, otherwise it is skipped', () => {
      const r = want('sugar', '2026-10-11');
      expect(planReminderSync([r], [], NOW, around(5, 7)).schedule).toEqual([{ ...r, fireDate: '2026-10-13', fireTime: '12:01' }]);
      expect(planReminderSync([r], [], NOW, around(4, 7))).toEqual({ schedule: [], cancel: [], skip: [r.key] });
    });

    test('a reminder due at this very minute is past due; one due a minute later is not', () => {
      const due = want('prep', NOW.date, NOW.time);
      expect(planReminderSync([due], [], NOW, around(3, 5)).schedule).toEqual([{ ...due, fireTime: '12:01' }]);
      const soon = want('prep', NOW.date, '12:01');
      expect(planReminderSync([soon], [], NOW, around(3, 5)).schedule).toEqual([soon]);
    });

    test('the next minute rolls over midnight', () => {
      const r = want('prep', '2026-10-12');
      const plan = planReminderSync([r], [], { date: '2026-10-13', time: '23:59' }, around(3, 5));
      expect(plan.schedule).toEqual([{ ...r, fireDate: '2026-10-14', fireTime: '00:00' }]);
    });

    test('a pending reminder whose time has passed was delivered: it is not sent again or cancelled', () => {
      const r = want('prep', '2026-10-12');
      const moved = want('prep', '2026-10-15');
      expect(planReminderSync([moved], [stored(r, 'pending')], NOW, FAR)).toEqual(EMPTY);
      expect(planReminderSync([], [stored(r, 'pending')], NOW, FAR)).toEqual(EMPTY);
    });
  });

  describe('resend guard (edited cycle starts)', () => {
    test('prep is not scheduled within 10 days of a prep sent under another key', () => {
      const sent = stored(want('prep', '2026-10-08', '09:00', '2026-09-14'), 'sent', '2026-10-08');
      const edited = want('prep', '2026-10-12', '09:00', '2026-09-15');
      expect(planReminderSync([edited], [sent], NOW, around(3, 5))).toEqual(EMPTY);
    });

    test('the guard is measured to when the new reminder would fire', () => {
      const sent = stored(want('prep', '2026-10-08', '09:00', '2026-09-14'), 'sent', '2026-10-08');
      const nineDays = want('prep', '2026-10-17', '09:00', '2026-10-10');
      const tenDays = want('prep', '2026-10-18', '09:00', '2026-10-10');
      expect(planReminderSync([nineDays], [sent], NOW, FAR)).toEqual(EMPTY);
      expect(planReminderSync([tenDays], [sent], NOW, FAR).schedule).toEqual([tenDays]);
    });

    test('a next cycle reminder weeks away is scheduled straight after the last one was sent', () => {
      const sent = stored(want('prep', '2026-10-10', '09:00', '2026-09-14'), 'sent', '2026-10-10');
      const next = want('prep', '2026-11-06', '09:00', '2026-10-12');
      expect(planReminderSync([next], [sent], NOW, FAR).schedule).toEqual([next]);
    });

    test('sugar uses an 18-day guard', () => {
      const sent = stored(want('sugar', '2026-10-01', '09:00', '2026-09-14'), 'sent', '2026-10-01');
      expect(planReminderSync([want('sugar', '2026-10-18', '09:00', '2026-10-05')], [sent], NOW, FAR)).toEqual(EMPTY);
      const ok = want('sugar', '2026-10-19', '09:00', '2026-10-05');
      expect(planReminderSync([ok], [sent], NOW, FAR).schedule).toEqual([ok]);
    });

    test('the guard is per type', () => {
      const sentSugar = stored(want('sugar', '2026-10-10', '09:00', '2026-09-14'), 'sent', '2026-10-10');
      const prep = want('prep', '2026-10-14', '09:00', '2026-09-15');
      expect(planReminderSync([prep], [sentSugar], NOW, FAR).schedule).toEqual([prep]);
    });

    test('without a sentDate the stored fire date counts as the send date', () => {
      const sent = stored(want('prep', '2026-10-08', '09:00', '2026-09-14'), 'sent');
      expect(planReminderSync([want('prep', '2026-10-15', '09:00', '2026-09-15')], [sent], NOW, FAR)).toEqual(EMPTY);
    });

    test('a delivered-but-unmarked pending reminder also guards', () => {
      const delivered = stored(want('prep', '2026-10-11', '09:00', '2026-09-14'), 'pending');
      const edited = want('prep', '2026-10-14', '09:00', '2026-09-15');
      expect(planReminderSync([edited], [delivered], NOW, FAR)).toEqual(EMPTY);
    });

    test('a guarded reminder that is already pending is cancelled', () => {
      const sent = stored(want('prep', '2026-10-08', '09:00', '2026-09-14'), 'sent', '2026-10-08');
      const edited = want('prep', '2026-10-14', '09:00', '2026-09-15');
      expect(planReminderSync([edited], [sent, stored(edited, 'pending')], NOW, FAR)).toEqual({
        schedule: [],
        cancel: [edited.key],
        skip: [],
      });
    });
  });

  test('syncing twice is a no-op the second time', () => {
    const rs = [want('sugar', '2026-10-12'), want('prep', '2026-10-27')];
    const before = [stored(want('prep', '2026-10-20', '09:00', '2026-09-01'), 'pending')];
    const prediction = around(17, 19);
    const plan = planReminderSync(rs, before, NOW, prediction);
    expect(plan.cancel).toEqual(['prep:2026-09-01']);
    expect(plan.schedule.map((r) => [r.key, r.fireDate, r.fireTime])).toEqual([
      ['sugar:2026-10-01', '2026-10-13', '12:01'],
      ['prep:2026-10-01', '2026-10-27', '09:00'],
    ]);
    const after = apply(plan, before);
    // Same wall-clock minute: the moved sugar reminder is now pending at 12:01.
    expect(planReminderSync(rs.map((r) => (r.type === 'sugar' ? { ...r, fireDate: '2026-10-13', fireTime: '12:01' } : r)), after, NOW, prediction)).toEqual(EMPTY);
    // A minute later the delivered sugar reminder is not resent, though it is still past due.
    expect(planReminderSync(rs, after, { date: NOW.date, time: '12:02' }, prediction)).toEqual(EMPTY);
  });

  test('re-planning with the same desired list after scheduling changes nothing', () => {
    const rs = [want('prep', '2026-10-30')];
    const after = apply(planReminderSync(rs, [], NOW, FAR), []);
    expect(planReminderSync(rs, after, NOW, FAR)).toEqual(EMPTY);
    expect(planReminderSync(rs, after, { date: '2026-10-20', time: '08:00' }, FAR)).toEqual(EMPTY);
  });
});

describe('desiredReminders + planReminderSync', () => {
  test('a late period cancels the pending prep reminder', () => {
    const cycle = openCycle();
    const r = desired({ currentCycle: cycle })[0];
    const late = desired({ currentCycle: cycle, prediction: pred(26, 28, 'late'), today: addDays(START, 40) });
    expect(planReminderSync(late, [stored(r, 'pending')], NOW, pred(26, 28, 'late'))).toEqual({
      schedule: [],
      cancel: [r.key],
      skip: [],
    });
  });

  test('pregnancy pauses: pending reminders are cancelled', () => {
    const cycle = openCycle();
    const rs = desired({ currentCycle: cycle, settings: reminderSettings({ sugarEnabled: true }) });
    const paused = desired({ currentCycle: cycle, contexts: [context('pregnancy', addDays(START, 9))] });
    const plan = planReminderSync(paused, rs.map((r) => stored(r, 'pending')), { date: addDays(START, 10), time: '08:00' }, pred(26));
    expect(plan.cancel.sort()).toEqual(['prep:2026-10-01', 'sugar:2026-10-01']);
  });
});
