// Owns the database connection and the in-memory AppData, and exposes the
// derived state plus write actions to every screen.
//
// Every write: persist -> update state -> derive() runs in a memo -> reminders
// re-sync and the "shown infertile day became fertile" check run in effects.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import { localDateOf, type ISODate } from '../core/date';
import { derive, type DerivedState } from '../core/derive';
import { newlyFertileDays, type FertilityStatus } from '../core/fertility';
import { planReminderSync, type StoredReminder } from '../core/reminders';
import type {
  AppData,
  ContextPeriod,
  CycleContextAnswer,
  DailyLog,
  ExerciseSession,
  Settings,
} from '../core/types';
import { destroyAppDatabase, openAppDatabase } from '../data/db';
import * as repo from '../data/repository';
import { applyReminderPlan, configureNotifications, markDelivered } from '../notifications/reminders';

export interface Clock {
  today: ISODate;
  now: { date: ISODate; time: string };
  deviceUtcOffsetMinutes: number;
  instant: string;
}

export function readClock(at: Date = new Date()): Clock {
  const today = localDateOf(at);
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  return { today, now: { date: today, time }, deviceUtcOffsetMinutes: -at.getTimezoneOffset(), instant: at.toISOString() };
}

export interface EditAlert {
  dates: ISODate[];
  unprotectedDates: ISODate[];
}

interface AppDataValue {
  ready: boolean;
  error: string | null;
  data: AppData;
  derived: DerivedState | null;
  clock: Clock;
  editAlert: EditAlert | null;
  dismissEditAlert(): void;
  saveLog(log: Omit<DailyLog, 'updatedAt'>): Promise<void>;
  deleteLog(date: ISODate): Promise<void>;
  saveExerciseSession(s: ExerciseSession): Promise<void>;
  deleteExerciseSession(id: string): Promise<void>;
  saveContext(c: ContextPeriod): Promise<void>;
  deleteContext(id: string): Promise<void>;
  saveCycleAnswer(a: Omit<CycleContextAnswer, 'answeredAt'>): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  markFertilityShown(date: ISODate, status: string): Promise<void>;
  exportData(): Promise<repo.ExportFile>;
  deleteAllData(): Promise<void>;
}

/** The most recent status shown for each date. ISO instants compare correctly as strings. */
function latestShownPerDate(shown: repo.ShownStatus[]): { date: ISODate; status: FertilityStatus }[] {
  const latest = new Map<ISODate, repo.ShownStatus>();
  for (const s of shown) {
    const prev = latest.get(s.date);
    if (!prev || s.shownAt > prev.shownAt) latest.set(s.date, s);
  }
  return [...latest.values()].map((s) => ({ date: s.date, status: s.status as FertilityStatus }));
}

const EMPTY: AppData = { logs: {}, exercise: [], contexts: [], cycleContextAnswers: [], settings: repo.withSettingsDefaults(null) };

const Ctx = createContext<AppDataValue | null>(null);

export function useAppData(): AppDataValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppData must be used inside <AppDataProvider>');
  return v;
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const dbRef = useRef<SQLiteDatabase | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AppData>(EMPTY);
  const [clock, setClock] = useState<Clock>(() => readClock());
  const [editAlert, setEditAlert] = useState<EditAlert | null>(null);
  // Always the latest data, for actions that derive a new value from it.
  const dataRef = useRef(data);
  dataRef.current = data;

  // Open the database once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await configureNotifications();
        const db = await openAppDatabase();
        if (cancelled) return;
        dbRef.current = db;
        setData(await repo.loadAppData(db));
        setReady(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep "today" current: on foreground and every minute.
  useEffect(() => {
    const tick = () => setClock(readClock());
    const sub = AppState.addEventListener('change', (s) => s === 'active' && tick());
    const id = setInterval(tick, 60_000);
    return () => {
      sub.remove();
      clearInterval(id);
    };
  }, []);

  const derived = useMemo(
    () => (ready ? derive(data, { today: clock.today, now: clock.now, deviceUtcOffsetMinutes: clock.deviceUtcOffsetMinutes }) : null),
    [ready, data, clock.today, clock.now, clock.deviceUtcOffsetMinutes],
  );

  // Re-sync reminders whenever the derived reminders change.
  const reminderSignature = derived ? JSON.stringify([derived.reminders, data.settings.reminders]) : '';
  useEffect(() => {
    const db = dbRef.current;
    if (!db || !derived) return;
    (async () => {
      const stored = markDelivered(await repo.loadReminderStates<StoredReminder>(db), clock.now);
      const plan = planReminderSync(derived.reminders, stored, clock.now, derived.prediction);
      const next = await applyReminderPlan(plan, stored, data.settings);
      for (const s of next) await repo.saveReminderState(db, s, clock.instant);
    })().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminderSignature, clock.today]);

  // Amendment A17: a day already shown as not fertile must never silently become fertile.
  useEffect(() => {
    const db = dbRef.current;
    if (!db || !derived) return;
    (async () => {
      const dates = newlyFertileDays(latestShownPerDate(await repo.loadShownStatuses(db)), derived.fertility.days);
      if (dates.length === 0) return;
      const unprotectedDates = dates.filter((d) => data.logs[d]?.intercourse === 'unprotected');
      setEditAlert({ dates, unprotectedDates });
    })().catch(() => undefined);
  }, [derived, data.logs]);

  const withDb = useCallback(async (fn: (db: SQLiteDatabase) => Promise<void>) => {
    const db = dbRef.current;
    if (!db) throw new Error('Database is not open yet');
    await fn(db);
  }, []);

  const markFertilityShown = useCallback(
    (date: ISODate, status: string) => withDb((db) => repo.recordShownStatus(db, { date, status, shownAt: readClock().instant })),
    [withDb],
  );

  const value: AppDataValue = {
    ready,
    error,
    data,
    derived,
    clock,
    editAlert,
    dismissEditAlert: () => {
      const alert = editAlert;
      setEditAlert(null);
      if (!alert) return;
      // The user has now seen these days as fertile; record that so the alert does not repeat.
      void withDb(async (db) => {
        const shownAt = readClock().instant;
        for (const date of alert.dates) await repo.recordShownStatus(db, { date, status: 'fertile', shownAt });
      }).catch(() => undefined);
    },
    saveLog: (log) =>
      withDb(async (db) => {
        const full: DailyLog = { ...log, updatedAt: readClock().instant };
        await repo.saveLog(db, full);
        setData((d) => ({ ...d, logs: { ...d.logs, [full.date]: full } }));
      }),
    deleteLog: (date) =>
      withDb(async (db) => {
        await repo.deleteLog(db, date);
        setData((d) => {
          const logs = { ...d.logs };
          delete logs[date];
          return { ...d, logs };
        });
      }),
    saveExerciseSession: (s) =>
      withDb(async (db) => {
        await repo.saveExerciseSession(db, s, readClock().instant);
        setData((d) => ({ ...d, exercise: [...d.exercise.filter((x) => x.id !== s.id), s] }));
      }),
    deleteExerciseSession: (id) =>
      withDb(async (db) => {
        await repo.deleteExerciseSession(db, id);
        setData((d) => ({ ...d, exercise: d.exercise.filter((x) => x.id !== id) }));
      }),
    saveContext: (c) =>
      withDb(async (db) => {
        await repo.saveContextPeriod(db, c, readClock().instant);
        setData((d) => ({ ...d, contexts: [...d.contexts.filter((x) => x.id !== c.id), c] }));
      }),
    deleteContext: (id) =>
      withDb(async (db) => {
        await repo.deleteContextPeriod(db, id);
        setData((d) => ({ ...d, contexts: d.contexts.filter((x) => x.id !== id) }));
      }),
    saveCycleAnswer: (a) =>
      withDb(async (db) => {
        const full: CycleContextAnswer = { ...a, answeredAt: readClock().instant };
        await repo.saveCycleContextAnswer(db, full);
        setData((d) => ({ ...d, cycleContextAnswers: [...d.cycleContextAnswers.filter((x) => x.cycleStart !== a.cycleStart), full] }));
      }),
    updateSettings: (patch) =>
      withDb(async (db) => {
        const next = { ...dataRef.current.settings, ...patch };
        dataRef.current = { ...dataRef.current, settings: next };
        await repo.saveSettings(db, next, readClock().instant);
        setData((d) => ({ ...d, settings: next }));
      }),
    markFertilityShown,
    exportData: async () => {
      const db = dbRef.current;
      if (!db) throw new Error('Database is not open yet');
      return repo.exportAll(db, readClock().instant);
    },
    deleteAllData: () =>
      withDb(async (db) => {
        await destroyAppDatabase(db);
        const fresh = await openAppDatabase();
        dbRef.current = fresh;
        setData(EMPTY);
        setEditAlert(null);
      }),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
