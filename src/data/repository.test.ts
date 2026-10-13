import { log, mucus, temp } from '../core/testing/fixtures';
import { DEFAULT_SETTINGS } from '../core/types';
import {
  deleteEverything,
  deleteLog,
  exportAll,
  loadAppData,
  loadShownStatuses,
  recordShownStatus,
  saveContextPeriod,
  saveLog,
  saveSettings,
  withSettingsDefaults,
} from './repository';
import { migrate, SCHEMA_VERSION } from './store';
import { FakeDb } from './testing/fakeDb';

const NOW = '2026-10-13T08:00:00.000Z';

async function freshDb() {
  const db = new FakeDb();
  await migrate(db);
  return db;
}

test('migrate brings an empty database to the current schema and is idempotent', async () => {
  const db = await freshDb();
  expect(db.userVersion).toBe(SCHEMA_VERSION);
  await migrate(db);
  expect(db.userVersion).toBe(SCHEMA_VERSION);
});

test('migrate refuses a database from a newer app version', async () => {
  const db = new FakeDb();
  db.userVersion = SCHEMA_VERSION + 1;
  await expect(migrate(db)).rejects.toThrow(/newer/);
});

test('logs round-trip, keyed by local date', async () => {
  const db = await freshDb();
  const entry = log('2026-10-12', { flow: 'light', temperatures: [temp(36.55)], mucus: mucus('dry', 'nothing') });
  await saveLog(db, entry);
  const data = await loadAppData(db);
  expect(data.logs['2026-10-12']).toEqual(entry);
  await deleteLog(db, '2026-10-12');
  expect((await loadAppData(db)).logs).toEqual({});
});

test('an empty database loads default settings', async () => {
  expect((await loadAppData(await freshDb())).settings).toEqual(DEFAULT_SETTINGS);
});

test('settings saved by an older version get new nested defaults', () => {
  const s = withSettingsDefaults({ unit: 'F', reminders: { time: '08:00' } as never });
  expect(s.unit).toBe('F');
  expect(s.reminders).toEqual({ ...DEFAULT_SETTINGS.reminders, time: '08:00' });
  expect(s.sleepTargetHours).toBe(8);
});

test('settings and contexts persist', async () => {
  const db = await freshDb();
  await saveSettings(db, { ...DEFAULT_SETTINGS, unit: 'F' }, NOW);
  await saveContextPeriod(db, { id: 'c1', kind: 'breastfeeding', start: '2026-01-01' }, NOW);
  const data = await loadAppData(db);
  expect(data.settings.unit).toBe('F');
  expect(data.contexts).toEqual([{ id: 'c1', kind: 'breastfeeding', start: '2026-01-01' }]);
});

test('a shown status is recorded once, keeping the first time it was shown', async () => {
  const db = await freshDb();
  await recordShownStatus(db, { date: '2026-10-12', status: 'infertile_post_ovulatory', shownAt: NOW });
  await recordShownStatus(db, { date: '2026-10-12', status: 'infertile_post_ovulatory', shownAt: '2026-10-13T20:00:00.000Z' });
  expect(await loadShownStatuses(db)).toEqual([{ date: '2026-10-12', status: 'infertile_post_ovulatory', shownAt: NOW }]);
});

test('export contains everything and delete removes everything', async () => {
  const db = await freshDb();
  await saveLog(db, log('2026-10-12', { cramps: 3 }));
  const file = await exportAll(db, NOW);
  expect(file.format).toBe('period-tracker-export');
  expect(file.data.logs['2026-10-12'].cramps).toBe(3);
  await deleteEverything(db);
  expect((await loadAppData(db)).logs).toEqual({});
});
