import { clockMinutes, isCompletedInEvening, isRecalled, localEpochMs, validOffset } from './time';

describe('time helpers', () => {
  test('clock times are strict HH:MM', () => {
    expect(clockMinutes('06:30')).toBe(390);
    expect(clockMinutes('23:59')).toBe(1439);
    for (const bad of ['6:30', '24:00', '06:60', '0630', '', undefined, 630]) expect(clockMinutes(bad)).toBeNull();
  });

  test('offsets must be plausible integers', () => {
    expect(validOffset(60)).toBe(60);
    expect(validOffset(-300)).toBe(-300);
    for (const bad of [Number.NaN, 1.5, 24 * 60, '60', undefined]) expect(validOffset(bad)).toBeNull();
  });

  test('an instant is read on the wall clock of the given offset, whatever its own suffix', () => {
    const z = localEpochMs('2026-05-01T19:00:00.000Z', 60);
    expect(localEpochMs('2026-05-01T20:00:00+01:00', 60)).toBe(z);
    expect(localEpochMs('2026-05-01T21:00:00+0200', 60)).toBe(z);
    expect(localEpochMs('2026-05-01T19:00Z', 60)).toBe(z);
    expect(localEpochMs('2026-05-01T19:00:00.5Z', 60)).toBe((z as number) + 500);
    for (const bad of ['2026-05-01 19:00', '2026-02-30T10:00:00Z', '2026-05-01T19:00:00', 'yesterday', 42]) {
      expect(localEpochMs(bad, 60)).toBeNull();
    }
    expect(localEpochMs('2026-05-01T19:00:00Z', null)).toBeNull();
  });

  test('recalled means later than 12:00 local on the next day; unreadable counts as recalled', () => {
    expect(isRecalled('2026-05-02T12:00:00+01:00', '2026-05-01', 60)).toBe(false);
    expect(isRecalled('2026-05-02T12:00:01+01:00', '2026-05-01', 60)).toBe(true);
    expect(isRecalled('2026-05-02T11:30:00Z', '2026-05-01', 60)).toBe(true);
    expect(isRecalled('garbage', '2026-05-01', 60)).toBe(true);
    expect(isRecalled('2026-05-01T20:00:00+01:00', '2026-05-01', null)).toBe(true);
  });

  test('completion counts from the evening time on its own date, or any later day', () => {
    const evening = 18 * 60;
    expect(isCompletedInEvening('2026-05-01T18:00:00+01:00', '2026-05-01', evening, 60)).toBe(true);
    expect(isCompletedInEvening('2026-05-01T17:59:59+01:00', '2026-05-01', evening, 60)).toBe(false);
    expect(isCompletedInEvening('2026-05-02T07:00:00+01:00', '2026-05-01', evening, 60)).toBe(true);
    expect(isCompletedInEvening('2026-04-30T20:00:00+01:00', '2026-05-01', evening, 60)).toBe(false);
    expect(isCompletedInEvening(undefined, '2026-05-01', evening, 60)).toBe(false);
    expect(isCompletedInEvening('2026-05-01T20:00:00+01:00', '2026-05-01', null, 60)).toBe(false);
  });
});
