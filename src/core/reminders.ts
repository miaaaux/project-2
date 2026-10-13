// Period reminders (SPEC §6; design notes §2).
//
// desiredReminders says which reminders the current cycle should have, from the
// prediction alone. planReminderSync diffs that against what was stored, so
// re-running it after every log, edit or app open never sends a reminder twice.
// Both anchor to the start of the predicted range (`lo`), the earliest likely
// day, because a reminder that arrives after the period started is useless.

import type { Cycle } from './cycles';
import { addDays, compareDates, diffDays, fromDayNumber, maxDate, toDayNumber, type ISODate } from './date';
import { clockMinutes } from './input';
import type { Prediction } from './prediction';
import { DEFAULT_SETTINGS, type ClockTime, type ContextKind, type ContextPeriod, type Settings } from './types';

export type ReminderType = 'prep' | 'sugar';

export interface DesiredReminder {
  /** `${type}:${cycleStart}`. Also the OS notification id, so scheduling the same key replaces it. */
  key: string;
  type: ReminderType;
  cycleStart: ISODate;
  fireDate: ISODate;
  fireTime: ClockTime;
}

export interface StoredReminder {
  key: string;
  type: ReminderType;
  fireDate: ISODate;
  fireTime: ClockTime;
  status: 'pending' | 'sent' | 'cancelled' | 'skipped';
  sentDate?: ISODate;
}

export interface ReminderSyncPlan {
  /** Hand these to the OS: new, moved, or past-due ones moved to the next minute. */
  schedule: DesiredReminder[];
  /** Keys whose pending OS request must be cancelled. */
  cancel: string[];
  /** Keys to record as skipped, never to be sent. A skipped key with a pending OS request is in `cancel` too. */
  skip: string[];
}

/** The prediction fields reminders read. */
export type ReminderPrediction = Pick<Prediction, 'lo' | 'center' | 'status'>;

const PREP_DAYS_BEFORE = 3;
const SUGAR_DAYS_BEFORE = 14;
/** The sugar reminder never fires before this cycle day offset (cycle start + 5). */
const SUGAR_EARLIEST_DAYS_AFTER_START = 5;
/** In very short cycles the sugar reminder is dropped if it would fall closer than this to the prep reminder. */
const MIN_DAYS_SUGAR_BEFORE_PREP = 4;
/** A past-due sugar reminder still goes out while `lo` is at least this many days away. */
const SUGAR_PAST_DUE_MIN_DAYS_TO_LO = 5;
/** Two reminders of one type must fire at least this many days apart (guards against edited cycle starts). */
const RESEND_GUARD_DAYS: Record<ReminderType, number> = { prep: 10, sugar: 18 };

/** SPEC §6. Breastfeeding alone does not pause them: once periods return, the reminders are useful again. */
const PAUSING_CONTEXTS: ContextKind[] = ['pregnancy', 'postpartum', 'hormonal_contraception'];
const MINUTES_PER_DAY = 24 * 60;

export function reminderKey(type: ReminderType, cycleStart: ISODate): string {
  return `${type}:${cycleStart}`;
}

/** Reminders pause during pregnancy, postpartum and hormonal contraception. */
export function remindersPaused(contexts: ContextPeriod[], today: ISODate): boolean {
  return contexts.some(
    (ctx) =>
      PAUSING_CONTEXTS.includes(ctx.kind) &&
      compareDates(ctx.start, today) <= 0 &&
      (ctx.end === undefined || compareDates(ctx.end, today) >= 0),
  );
}

/** Minutes since midnight; a malformed time falls back to the default reminder time, as the scheduler does. */
function minutesOf(time: ClockTime): number {
  return clockMinutes(time) ?? (clockMinutes(DEFAULT_SETTINGS.reminders.time) as number);
}

function formatMinutes(minutes: number): ClockTime {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Minutes since 1970-01-01 00:00 local wall-clock time. */
function moment(date: ISODate, time: ClockTime): number {
  return toDayNumber(date) * MINUTES_PER_DAY + minutesOf(time);
}

export function desiredReminders(input: {
  currentCycle: Cycle | undefined;
  prediction: ReminderPrediction;
  settings: Settings;
  contexts: ContextPeriod[];
  today: ISODate;
}): DesiredReminder[] {
  const { currentCycle: cycle, prediction, settings, contexts, today } = input;
  // Only the current, open cycle gets reminders; a late period gets none (one check-in instead).
  if (!cycle || cycle.end !== null) return [];
  if (prediction.lo === null || prediction.status === 'late') return [];
  if (remindersPaused(contexts, today)) return [];

  const fireTime = formatMinutes(minutesOf(settings.reminders.time));
  const reminder = (type: ReminderType, fireDate: ISODate): DesiredReminder => ({
    key: reminderKey(type, cycle.start),
    type,
    cycleStart: cycle.start,
    fireDate,
    fireTime,
  });

  // The prep date is also the reference for dropping sugar in short cycles, whether or not prep is on.
  const prep = addDays(prediction.lo, -PREP_DAYS_BEFORE);
  const out: DesiredReminder[] = [];
  if (settings.reminders.sugarEnabled) {
    // Never during the period, and never in the first days of the cycle.
    const sugar = [
      addDays(prediction.lo, -SUGAR_DAYS_BEFORE),
      addDays(cycle.periodEnd, 1),
      addDays(cycle.start, SUGAR_EARLIEST_DAYS_AFTER_START),
    ].reduce(maxDate);
    if (diffDays(prep, sugar) >= MIN_DAYS_SUGAR_BEFORE_PREP) out.push(reminder('sugar', sugar));
  }
  if (settings.reminders.prepEnabled) out.push(reminder('prep', prep));
  return out;
}

/** A reminder whose fire time has passed is still worth sending late (design notes 2.3). */
function stillUsefulLate(type: ReminderType, today: ISODate, prediction: ReminderPrediction): boolean {
  if (type === 'prep') return prediction.center !== null && compareDates(today, prediction.center) < 0;
  return prediction.lo !== null && diffDays(prediction.lo, today) >= SUGAR_PAST_DUE_MIN_DAYS_TO_LO;
}

/** A pending reminder whose fire time has passed was already handed to the OS for that moment: treat it as sent. */
function withDelivered(s: StoredReminder, nowMoment: number): StoredReminder {
  if (s.status !== 'pending' || moment(s.fireDate, s.fireTime) > nowMoment) return s;
  return { ...s, status: 'sent', sentDate: s.sentDate ?? s.fireDate };
}

function sentTooRecently(states: StoredReminder[], r: DesiredReminder, fireDate: ISODate): boolean {
  return states.some(
    (s) =>
      s.key !== r.key &&
      s.type === r.type &&
      s.status === 'sent' &&
      Math.abs(diffDays(fireDate, s.sentDate ?? s.fireDate)) < RESEND_GUARD_DAYS[r.type],
  );
}

export function planReminderSync(
  desired: DesiredReminder[],
  stored: StoredReminder[],
  now: { date: ISODate; time: ClockTime },
  prediction: ReminderPrediction,
): ReminderSyncPlan {
  const nowMoment = moment(now.date, now.time);
  const states = stored.map((s) => withDelivered(s, nowMoment));
  const byKey = new Map(states.map((s) => [s.key, s]));
  const wanted = new Map(desired.map((r) => [r.key, r]));
  const plan: ReminderSyncPlan = { schedule: [], cancel: [], skip: [] };

  for (const s of states) {
    if (s.status === 'pending' && !wanted.has(s.key)) plan.cancel.push(s.key);
  }

  for (const r of wanted.values()) {
    const s = byKey.get(r.key);
    if (s?.status === 'sent' || s?.status === 'skipped') continue;
    const pending = s?.status === 'pending' ? s : undefined;

    let slot = { fireDate: r.fireDate, fireTime: r.fireTime };
    if (moment(r.fireDate, r.fireTime) <= nowMoment) {
      if (!stillUsefulLate(r.type, now.date, prediction)) {
        if (pending) plan.cancel.push(r.key);
        plan.skip.push(r.key);
        continue;
      }
      const next = nowMoment + 1;
      slot = { fireDate: fromDayNumber(Math.floor(next / MINUTES_PER_DAY)), fireTime: formatMinutes(next % MINUTES_PER_DAY) };
    }

    if (sentTooRecently(states, r, slot.fireDate)) {
      if (pending) plan.cancel.push(r.key);
      continue;
    }
    if (pending && pending.fireDate === slot.fireDate && pending.fireTime === slot.fireTime) continue;
    plan.schedule.push({ ...r, ...slot });
  }
  return plan;
}
