// Pain guide (SPEC §7; design notes §5): the period prep card, habit adherence
// before each period, each period's pain outcome, and the user's own patterns.
//
// Nothing here predicts a low-pain period. A habit with too few logged days is
// "not enough logs", never "missed": an unlogged day is not a day without
// magnesium, sleep or sugar.

import type { Cycle } from './cycles';
import { addDays, compareDates, dateRange, type ISODate } from './date';
import type { Prediction } from './prediction';
import type { DailyLog, ExerciseSession, Settings } from './types';

export type HabitKey = 'magnesium' | 'exercise' | 'sugar' | 'sleep';
/** Display order; all four are always shown. */
export const HABITS: HabitKey[] = ['magnesium', 'exercise', 'sugar', 'sleep'];

export interface DateWindow {
  start: ISODate;
  /** Inclusive. */
  end: ISODate;
}

export interface HabitStatus {
  habit: HabitKey;
  state: 'on_track' | 'off_track' | 'not_enough_logs';
  /** Share of logged days (magnesium, sugar), exercise days per week, or mean hours (sleep); null without enough logs. */
  value: number | null;
  /** Share of the window's days with this habit logged (for exercise: a daily log or a session). */
  coverage: number;
  target: number;
  window: DateWindow;
}

export interface HabitInput {
  logs: Record<ISODate, DailyLog>;
  exercise: ExerciseSession[];
  settings: Settings;
}

export interface PrepCard {
  habits: HabitStatus[];
  onTrackCount: number;
  knownCount: number;
}

export interface PainOutcome {
  /** Highest cramp score in the pain window, or null with fewer than 2 logged cramp days. */
  peakCramps: number | null;
  /** Days in the window with cramps logged (0 counts as logged). */
  loggedDays: number;
  painReliefDays: number;
  highImpactDays: number;
}

export interface GroupSummary {
  n: number;
  /** Median peak cramps; null until both groups have enough cycles. */
  median: number | null;
}

export interface HabitPattern {
  habit: HabitKey;
  state: 'need_more_cycles' | 'no_clear_difference' | 'pattern';
  onTrack: GroupSummary;
  offTrack: GroupSummary;
  /** Share of the group's cycles with pain relief taken, among those where pain relief was logged. */
  painReliefShareOn: number | null;
  painReliefShareOff: number | null;
}

export const MIN_COVERAGE = 0.6;
/** Magnesium taken, or at most one sugar serving, on this share of logged days. */
export const SHARE_TARGET = 0.7;
export const EXERCISE_DAYS_PER_WEEK_TARGET = 3;
/** A day counts as an exercise day if any session lasted this long. */
export const MIN_EXERCISE_MINUTES = 10;
const MAX_LOW_SUGAR_SERVINGS = 1;
const LUTEAL_WINDOW_DAYS = 14;
const EXERCISE_WINDOW_DAYS = 28;
const SLEEP_WINDOW_NIGHTS = 7;
/** The pain outcome spans 2 days before day 1 through day 3. */
const PAIN_DAYS_BEFORE = 2;
const PAIN_DAYS_AFTER = 2;
const MIN_PAIN_LOGGED_DAYS = 2;
export const MIN_CYCLES_PER_GROUP = 3;
/** Differences of medians smaller than this are "no clear difference". */
export const CLEAR_DIFFERENCE = 2;

// ------------------------------------------------------------- helpers

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function inWindow(date: ISODate, w: DateWindow): boolean {
  return compareDates(date, w.start) >= 0 && compareDates(date, w.end) <= 0;
}

/** The `days` days ending on `end`, inclusive. */
function daysEndingOn(end: ISODate, days: number): DateWindow {
  return { start: addDays(end, -(days - 1)), end };
}

/** The `days` days before `periodStart`, ending the day before it. */
function daysBefore(periodStart: ISODate, days: number): DateWindow {
  return { start: addDays(periodStart, -days), end: addDays(periodStart, -1) };
}

// ----------------------------------------------------------- adherence

/** A habit read from the daily log, compared on the mean of the logged values. */
function dailyHabitStatus(
  habit: HabitKey,
  window: DateWindow,
  logs: Record<ISODate, DailyLog>,
  read: (l: DailyLog) => number | undefined,
  target: number,
): HabitStatus {
  const days = dateRange(window.start, window.end);
  const values = days.flatMap((d) => {
    const v = logs[d] ? read(logs[d]) : undefined;
    return v === undefined ? [] : [v];
  });
  const coverage = days.length === 0 ? 0 : values.length / days.length;
  if (values.length === 0 || coverage < MIN_COVERAGE) {
    return { habit, state: 'not_enough_logs', value: null, coverage, target, window };
  }
  const value = mean(values);
  return { habit, state: value >= target ? 'on_track' : 'off_track', value, coverage, target, window };
}

/**
 * Exercise sessions are events with no "none" entry, so a day counts as logged
 * when it has a daily log or a session. Unlogged days can only hide exercise:
 * enough exercise days are on track whatever the coverage, but too few are
 * "off track" only when at least 60% of the days were logged.
 */
function exerciseStatus(window: DateWindow, input: HabitInput): HabitStatus {
  const days = dateRange(window.start, window.end);
  const sessions = input.exercise.filter((s) => inWindow(s.date, window));
  const sessionDays = new Set(sessions.map((s) => s.date));
  const loggedDays = days.filter((d) => input.logs[d] !== undefined || sessionDays.has(d)).length;
  const coverage = days.length === 0 ? 0 : loggedDays / days.length;
  const target = EXERCISE_DAYS_PER_WEEK_TARGET;
  const exerciseDays = new Set(sessions.filter((s) => s.minutes >= MIN_EXERCISE_MINUTES).map((s) => s.date)).size;
  const value = days.length === 0 ? 0 : (exerciseDays * 7) / days.length;
  if (loggedDays > 0 && value >= target) {
    return { habit: 'exercise', state: 'on_track', value, coverage, target, window };
  }
  if (loggedDays === 0 || coverage < MIN_COVERAGE) {
    return { habit: 'exercise', state: 'not_enough_logs', value: null, coverage, target, window };
  }
  return { habit: 'exercise', state: 'off_track', value, coverage, target, window };
}

function habitStatuses(windows: Record<HabitKey, DateWindow>, input: HabitInput): HabitStatus[] {
  const { logs, settings } = input;
  const byHabit: Record<HabitKey, HabitStatus> = {
    magnesium: dailyHabitStatus(
      'magnesium',
      windows.magnesium,
      logs,
      (l) => (l.magnesiumTaken === undefined ? undefined : Number(l.magnesiumTaken)),
      SHARE_TARGET,
    ),
    exercise: exerciseStatus(windows.exercise, input),
    sugar: dailyHabitStatus(
      'sugar',
      windows.sugar,
      logs,
      (l) => (l.sugarServings === undefined ? undefined : Number(l.sugarServings <= MAX_LOW_SUGAR_SERVINGS)),
      SHARE_TARGET,
    ),
    sleep: dailyHabitStatus('sleep', windows.sleep, logs, (l) => l.sleepHours, settings.sleepTargetHours),
  };
  return HABITS.map((h) => byHabit[h]);
}

/**
 * The prep card for the upcoming period. Magnesium and sugar count from 14 days
 * before the predicted start (the earliest likely day) to today; it is null
 * without a prediction or before that window opens.
 */
export function prepCard(
  input: HabitInput & { prediction: Pick<Prediction, 'lo'>; today: ISODate },
): PrepCard | null {
  const { prediction, today } = input;
  if (prediction.lo === null) return null;
  const lutealStart = addDays(prediction.lo, -LUTEAL_WINDOW_DAYS);
  if (compareDates(today, lutealStart) < 0) return null;

  const luteal = { start: lutealStart, end: today };
  const habits = habitStatuses(
    {
      magnesium: luteal,
      sugar: luteal,
      exercise: daysEndingOn(today, EXERCISE_WINDOW_DAYS),
      sleep: daysEndingOn(today, SLEEP_WINDOW_NIGHTS),
    },
    input,
  );
  return {
    habits,
    onTrackCount: habits.filter((h) => h.state === 'on_track').length,
    knownCount: habits.filter((h) => h.state !== 'not_enough_logs').length,
  };
}

/** Adherence with the same thresholds as the prep card, in windows ending the day before a confirmed period start. */
export function habitAdherenceBefore(periodStart: ISODate, input: HabitInput): HabitStatus[] {
  return habitStatuses(
    {
      magnesium: daysBefore(periodStart, LUTEAL_WINDOW_DAYS),
      sugar: daysBefore(periodStart, LUTEAL_WINDOW_DAYS),
      exercise: daysBefore(periodStart, EXERCISE_WINDOW_DAYS),
      sleep: daysBefore(periodStart, SLEEP_WINDOW_NIGHTS),
    },
    input,
  );
}

// ------------------------------------------------------------- outcome

/** 2 days before day 1 through day 3. */
export function periodPainWindow(periodStart: ISODate): DateWindow {
  return { start: addDays(periodStart, -PAIN_DAYS_BEFORE), end: addDays(periodStart, PAIN_DAYS_AFTER) };
}

function painWindowLogs(periodStart: ISODate, logs: Record<ISODate, DailyLog>): DailyLog[] {
  const w = periodPainWindow(periodStart);
  return dateRange(w.start, w.end).flatMap((d) => (logs[d] ? [logs[d]] : []));
}

export function periodPainOutcome(periodStart: ISODate, logs: Record<ISODate, DailyLog>): PainOutcome {
  const days = painWindowLogs(periodStart, logs);
  const cramps = days.flatMap((l) => (l.cramps === undefined ? [] : [l.cramps]));
  return {
    peakCramps: cramps.length >= MIN_PAIN_LOGGED_DAYS ? Math.max(...cramps) : null,
    loggedDays: cramps.length,
    painReliefDays: days.filter((l) => l.painReliefDoses !== undefined && l.painReliefDoses > 0).length,
    highImpactDays: days.filter((l) => l.painImpact === 'couldnt_do_usual').length,
  };
}

/** Whether pain relief was taken around a period; undefined if it was never logged there. */
function painReliefTaken(periodStart: ISODate, logs: Record<ISODate, DailyLog>): boolean | undefined {
  const doses = painWindowLogs(periodStart, logs).flatMap((l) =>
    l.painReliefDoses === undefined ? [] : [l.painReliefDoses],
  );
  return doses.length === 0 ? undefined : doses.some((n) => n > 0);
}

// ------------------------------------------------------------ patterns

interface PeriodSample {
  peak: number;
  painRelief: boolean | undefined;
  adherence: HabitStatus[];
}

function painReliefShare(samples: PeriodSample[]): number | null {
  const known = samples.filter((s) => s.painRelief !== undefined);
  return known.length === 0 ? null : known.filter((s) => s.painRelief).length / known.length;
}

function comparePattern(habit: HabitKey, samples: PeriodSample[]): HabitPattern {
  const stateOf = (s: PeriodSample) => s.adherence.find((h) => h.habit === habit)?.state;
  const on = samples.filter((s) => stateOf(s) === 'on_track');
  const off = samples.filter((s) => stateOf(s) === 'off_track');
  if (on.length < MIN_CYCLES_PER_GROUP || off.length < MIN_CYCLES_PER_GROUP) {
    // No comparison is shown until each group has enough cycles.
    return {
      habit,
      state: 'need_more_cycles',
      onTrack: { n: on.length, median: null },
      offTrack: { n: off.length, median: null },
      painReliefShareOn: null,
      painReliefShareOff: null,
    };
  }
  const medianOn = median(on.map((s) => s.peak));
  const medianOff = median(off.map((s) => s.peak));
  return {
    habit,
    state: Math.abs(medianOff - medianOn) < CLEAR_DIFFERENCE ? 'no_clear_difference' : 'pattern',
    onTrack: { n: on.length, median: medianOn },
    offTrack: { n: off.length, median: medianOff },
    painReliefShareOn: painReliefShare(on),
    painReliefShareOff: painReliefShare(off),
  };
}

/**
 * Peak cramps after periods where each habit was on track, against periods
 * where it was not. A pattern in the user's logs, never proof of cause.
 */
export function habitPatterns(input: HabitInput & { cycles: Cycle[] }): HabitPattern[] {
  const samples = input.cycles.flatMap((c): PeriodSample[] => {
    const { peakCramps } = periodPainOutcome(c.start, input.logs);
    if (peakCramps === null) return [];
    return [
      {
        peak: peakCramps,
        painRelief: painReliefTaken(c.start, input.logs),
        adherence: habitAdherenceBefore(c.start, input),
      },
    ];
  });
  return HABITS.map((habit) => comparePattern(habit, samples));
}
