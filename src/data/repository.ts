// Reads and writes AppData through the document store.

import type { ISODate } from '../core/date';
import {
  DEFAULT_SETTINGS,
  type AppData,
  type ContextPeriod,
  type CycleContextAnswer,
  type DailyLog,
  type ExerciseSession,
  type Instant,
  type Settings,
} from '../core/types';
import { allDocs, clearAll, deleteDoc, getDoc, putDoc, type SqlDatabase } from './store';

const SETTINGS_ID = 'settings';

/** Settings saved by an older app version may lack newer fields; fill them from the defaults. */
export function withSettingsDefaults(saved: Partial<Settings> | null): Settings {
  if (!saved) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    thermometer: { ...DEFAULT_SETTINGS.thermometer, ...saved.thermometer },
    contraceptionMode: { ...DEFAULT_SETTINGS.contraceptionMode, ...saved.contraceptionMode },
    reminders: { ...DEFAULT_SETTINGS.reminders, ...saved.reminders },
    usualMeasurementTimes: saved.usualMeasurementTimes ?? DEFAULT_SETTINGS.usualMeasurementTimes,
  };
}

export async function loadAppData(db: SqlDatabase): Promise<AppData> {
  const [logRows, exercise, contexts, answers, settings] = await Promise.all([
    allDocs<DailyLog>(db, 'daily_logs'),
    allDocs<ExerciseSession>(db, 'exercise_sessions'),
    allDocs<ContextPeriod>(db, 'context_periods'),
    allDocs<CycleContextAnswer>(db, 'cycle_context_answers'),
    getDoc<Partial<Settings>>(db, 'settings', SETTINGS_ID),
  ]);
  const logs: Record<ISODate, DailyLog> = {};
  for (const { doc } of logRows) logs[doc.date] = { ...doc, temperatures: doc.temperatures ?? [] };
  return {
    logs,
    exercise: exercise.map((r) => r.doc),
    contexts: contexts.map((r) => r.doc),
    cycleContextAnswers: answers.map((r) => r.doc),
    settings: withSettingsDefaults(settings),
  };
}

export function saveLog(db: SqlDatabase, log: DailyLog): Promise<void> {
  return putDoc(db, 'daily_logs', log.date, log, log.updatedAt);
}

export function deleteLog(db: SqlDatabase, date: ISODate): Promise<void> {
  return deleteDoc(db, 'daily_logs', date);
}

export function saveExerciseSession(db: SqlDatabase, s: ExerciseSession, now: Instant): Promise<void> {
  return putDoc(db, 'exercise_sessions', s.id, s, now);
}

export function deleteExerciseSession(db: SqlDatabase, id: string): Promise<void> {
  return deleteDoc(db, 'exercise_sessions', id);
}

export function saveContextPeriod(db: SqlDatabase, c: ContextPeriod, now: Instant): Promise<void> {
  return putDoc(db, 'context_periods', c.id, c, now);
}

export function deleteContextPeriod(db: SqlDatabase, id: string): Promise<void> {
  return deleteDoc(db, 'context_periods', id);
}

export function saveCycleContextAnswer(db: SqlDatabase, a: CycleContextAnswer): Promise<void> {
  return putDoc(db, 'cycle_context_answers', a.cycleStart, a, a.answeredAt);
}

export function saveSettings(db: SqlDatabase, s: Settings, now: Instant): Promise<void> {
  return putDoc(db, 'settings', SETTINGS_ID, s, now);
}

// ------------------------------------------------- reminder and audit state

export async function loadReminderStates<T extends { key: string }>(db: SqlDatabase): Promise<T[]> {
  return (await allDocs<T>(db, 'reminders')).map((r) => r.doc);
}

export function saveReminderState<T extends { key: string }>(db: SqlDatabase, r: T, now: Instant): Promise<void> {
  return putDoc(db, 'reminders', r.key, r, now);
}

/** A not-fertile status as it was shown to the user (amendment A17). */
export interface ShownStatus {
  date: ISODate;
  status: string;
  eveningTransition?: boolean;
  /** The latest time this status was shown for this date. */
  shownAt: Instant;
}

export async function loadShownStatuses(db: SqlDatabase): Promise<ShownStatus[]> {
  return (await allDocs<ShownStatus>(db, 'shown_statuses')).map((r) => r.doc);
}

/** Records (or refreshes the time of) a status shown for a date. */
export async function recordShownStatus(db: SqlDatabase, s: ShownStatus): Promise<void> {
  const id = `${s.date}:${s.status}:${s.eveningTransition ? 'evening' : ''}`;
  await putDoc(db, 'shown_statuses', id, s, s.shownAt);
}

/** The user acknowledged that a day previously shown as not fertile is now fertile. */
export interface AlertAck {
  date: ISODate;
  ackAt: Instant;
}

export async function loadAlertAcks(db: SqlDatabase): Promise<AlertAck[]> {
  return (await allDocs<AlertAck>(db, 'alert_acks')).map((r) => r.doc);
}

export async function recordAlertAck(db: SqlDatabase, a: AlertAck): Promise<void> {
  await putDoc(db, 'alert_acks', a.date, a, a.ackAt);
}

// --------------------------------------------------------- export / delete

export interface ExportFile {
  format: 'period-tracker-export';
  version: 1;
  exportedAt: Instant;
  data: AppData;
}

export async function exportAll(db: SqlDatabase, now: Instant): Promise<ExportFile> {
  return { format: 'period-tracker-export', version: 1, exportedAt: now, data: await loadAppData(db) };
}

export function deleteEverything(db: SqlDatabase): Promise<void> {
  return clearAll(db);
}
