import {
  addDays, dateRange, diffDays, fromDayNumber, isISODate, localDateOf, maxDate, minDate, toDayNumber,
} from './date';

describe('date', () => {
  test('validates real calendar dates only', () => {
    expect(isISODate('2026-10-13')).toBe(true);
    expect(isISODate('2024-02-29')).toBe(true);
    expect(isISODate('2026-02-29')).toBe(false);
    expect(isISODate('2026-13-01')).toBe(false);
    expect(isISODate('2026-1-01')).toBe(false);
  });

  test('round-trips day numbers', () => {
    expect(toDayNumber('1970-01-01')).toBe(0);
    expect(fromDayNumber(toDayNumber('2026-10-13'))).toBe('2026-10-13');
  });

  test('adds days across month, year and leap-day boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  test('is unaffected by daylight-saving transitions', () => {
    // EU and US DST changes in 2026
    expect(diffDays('2026-03-30', '2026-03-28')).toBe(2);
    expect(diffDays('2026-11-02', '2026-10-31')).toBe(2);
  });

  test('builds inclusive ranges', () => {
    expect(dateRange('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(dateRange('2026-11-02', '2026-11-01')).toEqual([]);
  });

  test('min and max', () => {
    expect(minDate('2026-01-02', '2026-01-01')).toBe('2026-01-01');
    expect(maxDate('2026-01-02', '2026-01-01')).toBe('2026-01-02');
  });

  test('uses the local calendar day of an instant', () => {
    expect(localDateOf(new Date(2026, 9, 13, 23, 59))).toBe('2026-10-13');
  });

  test('rejects invalid input', () => {
    expect(() => toDayNumber('2026-02-30')).toThrow();
  });
});
