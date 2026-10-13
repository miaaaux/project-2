import { clockMinutes, format, parseClockTime, parseTemperature } from './input';

describe('parseTemperature', () => {
  test('accepts a dot or a decimal comma and returns integer hundredths', () => {
    expect(parseTemperature('36.55', 'C', 0.01)).toEqual({ ok: true, value: 3655 });
    expect(parseTemperature('36,55', 'C', 0.01)).toEqual({ ok: true, value: 3655 });
    expect(parseTemperature(' 97.62 ', 'F', 0.01)).toEqual({ ok: true, value: 9762 });
  });

  test('requires exactly two decimals, so a 1-decimal reading is not silently padded', () => {
    expect(parseTemperature('36.5', 'C', 0.01).ok).toBe(false);
    expect(parseTemperature('36', 'C', 0.01).ok).toBe(false);
    expect(parseTemperature('36.555', 'C', 0.01).ok).toBe(false);
    expect(parseTemperature('3,655.00', 'C', 0.01).ok).toBe(false);
  });

  test('rejects values outside the plausible range for the unit', () => {
    expect(parseTemperature('34.99', 'C', 0.01).ok).toBe(false);
    expect(parseTemperature('36.55', 'F', 0.01).ok).toBe(false);
    expect(parseTemperature('39.20', 'C', 0.01)).toEqual({ ok: true, value: 3920 });
  });

  test('a 0.05 thermometer only produces multiples of 5 hundredths', () => {
    expect(parseTemperature('36.55', 'C', 0.05).ok).toBe(true);
    expect(parseTemperature('36.53', 'C', 0.05).ok).toBe(false);
  });

  test('never goes through floating point', () => {
    // 36.29 * 100 is 3628.9999999999995 in floating point
    expect(parseTemperature('36.29', 'C', 0.01)).toEqual({ ok: true, value: 3629 });
  });
});

test('format renders hundredths with two decimals', () => {
  expect(format(3655)).toBe('36.55');
  expect(format(3605)).toBe('36.05');
  expect(format(9762)).toBe('97.62');
});

test('clock times', () => {
  expect(parseClockTime('6:30')).toEqual({ ok: true, value: '06:30' });
  expect(parseClockTime('06.30')).toEqual({ ok: true, value: '06:30' });
  expect(parseClockTime('24:00').ok).toBe(false);
  expect(clockMinutes('06:30')).toBe(390);
  expect(clockMinutes(undefined)).toBeNull();
  expect(clockMinutes('nope')).toBeNull();
});
