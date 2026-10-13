// Opens the encrypted on-device database.
//
// The SQLCipher key is 32 random bytes generated on first launch and kept in
// the iOS Keychain / Android Keystore via expo-secure-store, readable only
// while the device is unlocked and never migrated to another device or backup.
// Requires `"useSQLCipher": true` for the expo-sqlite plugin in app.json.

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';

import { migrate } from './store';

const DB_NAME = 'period-tracker.db';
const KEY_NAME = 'period-tracker.db-key';
const KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function getOrCreateKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_NAME, KEY_OPTIONS);
  if (existing && /^[0-9a-f]{64}$/.test(existing)) return existing;
  const key = toHex(await Crypto.getRandomBytesAsync(32));
  await SecureStore.setItemAsync(KEY_NAME, key, KEY_OPTIONS);
  return key;
}

export async function openAppDatabase(): Promise<SQLite.SQLiteDatabase> {
  const key = await getOrCreateKey();
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  // A raw 256-bit key; must be the first statement on the connection.
  await db.execAsync(`PRAGMA key = "x'${key}'"`);
  await db.execAsync('PRAGMA foreign_keys = ON');
  await migrate(db);
  return db;
}

/** Deletes the database file and its key: used by "delete all my data". */
export async function destroyAppDatabase(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.closeAsync();
  await SQLite.deleteDatabaseAsync(DB_NAME);
  await SecureStore.deleteItemAsync(KEY_NAME, KEY_OPTIONS);
}
