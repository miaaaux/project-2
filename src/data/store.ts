// A small document store on SQLite: every table holds (id, JSON data, updated_at).
//
// Keeping rows as JSON documents means a new optional field never needs a
// migration; migrations are only for new tables or indexes.

/** The subset of expo-sqlite's SQLiteDatabase the store uses (also implemented by the test fake). */
export interface SqlDatabase {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, ...params: (string | number | null)[]): Promise<unknown>;
  getAllAsync<T>(source: string, ...params: (string | number | null)[]): Promise<T[]>;
  getFirstAsync<T>(source: string, ...params: (string | number | null)[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

export const TABLES = [
  'daily_logs',
  'exercise_sessions',
  'context_periods',
  'cycle_context_answers',
  'settings',
  'reminders',
  'shown_statuses',
] as const;

export type Table = (typeof TABLES)[number];

/** Each entry upgrades the schema by one version (PRAGMA user_version). Never edit a released entry. */
const MIGRATIONS: string[] = [
  TABLES.map(
    (t) => `CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);`,
  ).join('\n'),
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export async function migrate(db: SqlDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current > SCHEMA_VERSION) {
    throw new Error(`Database schema ${current} is newer than this app (${SCHEMA_VERSION}).`);
  }
  for (let v = current; v < SCHEMA_VERSION; v++) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[v]);
      await db.execAsync(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

export async function putDoc(db: SqlDatabase, table: Table, id: string, doc: unknown, updatedAt: string): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO ${table} (id, data, updated_at) VALUES (?, ?, ?)`,
    id,
    JSON.stringify(doc),
    updatedAt,
  );
}

export async function deleteDoc(db: SqlDatabase, table: Table, id: string): Promise<void> {
  await db.runAsync(`DELETE FROM ${table} WHERE id = ?`, id);
}

export async function allDocs<T>(db: SqlDatabase, table: Table): Promise<{ id: string; doc: T }[]> {
  const rows = await db.getAllAsync<{ id: string; data: string }>(`SELECT id, data FROM ${table} ORDER BY id`);
  return rows.map((r) => ({ id: r.id, doc: JSON.parse(r.data) as T }));
}

export async function getDoc<T>(db: SqlDatabase, table: Table, id: string): Promise<T | null> {
  const row = await db.getFirstAsync<{ data: string }>(`SELECT data FROM ${table} WHERE id = ?`, id);
  return row ? (JSON.parse(row.data) as T) : null;
}

export async function clearAll(db: SqlDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const t of TABLES) await db.runAsync(`DELETE FROM ${t}`);
  });
}
