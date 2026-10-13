// In-memory stand-in for expo-sqlite that understands exactly the statements in store.ts.

import type { SqlDatabase } from '../store';

type Row = { id: string; data: string; updated_at: string };

export class FakeDb implements SqlDatabase {
  tables = new Map<string, Map<string, Row>>();
  userVersion = 0;

  private table(name: string): Map<string, Row> {
    let t = this.tables.get(name);
    if (!t) {
      t = new Map();
      this.tables.set(name, t);
    }
    return t;
  }

  async execAsync(source: string): Promise<void> {
    const version = /PRAGMA user_version = (\d+)/.exec(source);
    if (version) {
      this.userVersion = Number(version[1]);
      return;
    }
    for (const m of source.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) this.table(m[1]);
  }

  async runAsync(source: string, ...params: (string | number | null)[]): Promise<unknown> {
    let m = /^INSERT OR REPLACE INTO (\w+)/.exec(source);
    if (m) {
      const [id, data, updated_at] = params as string[];
      this.table(m[1]).set(id, { id, data, updated_at });
      return;
    }
    m = /^DELETE FROM (\w+) WHERE id = \?/.exec(source);
    if (m) {
      this.table(m[1]).delete(params[0] as string);
      return;
    }
    m = /^DELETE FROM (\w+)$/.exec(source);
    if (m) {
      this.table(m[1]).clear();
      return;
    }
    throw new Error(`FakeDb: unsupported statement: ${source}`);
  }

  async getAllAsync<T>(source: string): Promise<T[]> {
    const m = /^SELECT id, data FROM (\w+) ORDER BY id$/.exec(source);
    if (!m) throw new Error(`FakeDb: unsupported query: ${source}`);
    return [...this.table(m[1]).values()].sort((a, b) => a.id.localeCompare(b.id)) as T[];
  }

  async getFirstAsync<T>(source: string, ...params: (string | number | null)[]): Promise<T | null> {
    if (source === 'PRAGMA user_version') return { user_version: this.userVersion } as T;
    const m = /^SELECT data FROM (\w+) WHERE id = \?$/.exec(source);
    if (!m) throw new Error(`FakeDb: unsupported query: ${source}`);
    return (this.table(m[1]).get(params[0] as string) ?? null) as T | null;
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    await task();
  }
}
