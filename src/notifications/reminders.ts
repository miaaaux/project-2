// Applies the pure reminder plan (src/core/reminders.ts) to the OS notification scheduler.
//
// The notification identifier is the reminder key (`type:cycleStart`), so
// re-scheduling the same key replaces the pending request instead of adding a
// duplicate.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { REMINDER_TEXT } from '../core/content';
import { compareDates, type ISODate } from '../core/date';
import { clockMinutes } from '../core/input';
import type { DesiredReminder, ReminderSyncPlan, StoredReminder } from '../core/reminders';
import type { ClockTime, Settings } from '../core/types';

const CHANNEL_ID = 'reminders';

export async function configureNotifications(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

/** Local wall-clock date and time as a JS Date (the only place a Date is built from a local date). */
function localInstant(date: ISODate, time: ClockTime): Date {
  const [y, m, d] = date.split('-').map(Number);
  const minutes = clockMinutes(time) ?? 9 * 60;
  return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
}

function notificationContent(r: DesiredReminder, settings: Settings) {
  const text = REMINDER_TEXT[r.type];
  return settings.reminders.discreet
    ? { title: text.discreetTitle, body: text.discreetBody }
    : { title: text.title, body: text.body };
}

/** Reminders whose fire time has passed are recorded as sent. */
export function markDelivered(stored: StoredReminder[], now: { date: ISODate; time: ClockTime }): StoredReminder[] {
  const nowMin = clockMinutes(now.time) ?? 0;
  return stored.map((s) => {
    if (s.status !== 'pending') return s;
    const cmp = compareDates(s.fireDate, now.date);
    const due = cmp < 0 || (cmp === 0 && (clockMinutes(s.fireTime) ?? 0) <= nowMin);
    return due ? { ...s, status: 'sent', sentDate: s.fireDate } : s;
  });
}

/**
 * Executes a sync plan and returns the new stored states.
 * If scheduling fails (e.g. permission denied) the reminder stays out of the
 * store, so the home-screen card still shows the same content.
 */
export async function applyReminderPlan(
  plan: ReminderSyncPlan,
  stored: StoredReminder[],
  settings: Settings,
): Promise<StoredReminder[]> {
  const byKey = new Map(stored.map((s) => [s.key, s]));

  for (const key of plan.cancel) {
    await Notifications.cancelScheduledNotificationAsync(key).catch(() => undefined);
    const s = byKey.get(key);
    if (s) byKey.set(key, { ...s, status: 'cancelled' });
  }
  for (const key of plan.skip) {
    const s = byKey.get(key);
    if (s) byKey.set(key, { ...s, status: 'skipped' });
  }
  for (const r of plan.schedule) {
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: r.key,
        content: notificationContent(r, settings),
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: localInstant(r.fireDate, r.fireTime),
          channelId: CHANNEL_ID,
        },
      });
      byKey.set(r.key, { key: r.key, type: r.type, fireDate: r.fireDate, fireTime: r.fireTime, status: 'pending' });
    } catch {
      // Not scheduled; the in-app card covers it.
    }
  }
  return [...byKey.values()];
}
