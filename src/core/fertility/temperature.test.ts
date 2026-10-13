import type { DayTemp } from './temperature';
import { collectLows, evaluateStrictRise, lenientFhm } from './temperature';
import { build, historyCycle, mbase, run, withDays } from './testing';

const day = (value: number | null, kind: DayTemp['kind'] = 'VALID'): DayTemp => ({
  kind: value === null ? 'MISSING' : kind,
  value,
  minutes: 390,
  unit: 'C',
  route: 'oral',
  thermometerId: 'default',
});

const P = [3650, 3640, 3645, 3640, 3650, 3645, 3640, 3645, 3650, 3640, 3645, 3640, 3650, 3645, 3640];

describe('STRICT rise', () => {
  test('a candidate needing a later day is PENDING and stops the scan', () => {
    const days = [...P, 3660, 3665].map((v) => day(v));
    expect(evaluateStrictRise(days, 17, false, 'C')).toEqual({ status: 'PENDING', fhm: 16, coverline: 3650 });
  });

  test('a voided candidate lets the scan continue', () => {
    const days = [...P, 3660, 3665, 3675, 3675, 3675, 3675].map((v) => day(v));
    const first = evaluateStrictRise(days, 21, false, 'C');
    expect(first).toMatchObject({ status: 'CONFIRMED', rise: { fhm: 16 } });
    const later = evaluateStrictRise(days, 21, false, 'C', (rise) => rise.fhm !== 16);
    expect(later).toMatchObject({ status: 'CONFIRMED', rise: { fhm: 17, rule: 'exception1', completeDay: 20 } });
  });

  test('lows: SUSPECT readings raise the coverline without counting toward the 6 (A9)', () => {
    const days = [...P.slice(0, 14), 3700, 3660].map((v, i) => day(v, i === 14 ? 'SUSPECT' : 'VALID'));
    expect(collectLows(days, 16)?.coverline).toBe(3700);
    expect(collectLows(days.slice(0, 6), 7)?.coverline).toBe(3650);
    expect(collectLows(days.slice(0, 5), 6)).toBeNull();
  });
});

describe('LENIENT history rise', () => {
  test('ignores gaps and rounds to the 0.05 °C grid', () => {
    // 36.53 rounds to 36.55 (above 36.50) and 36.72 to 36.70: the regular rule on rounded values.
    const days = [...P, 3660, 3653, 3672].map((v) => day(v));
    expect(lenientFhm(days, 18, 'C')).toBe(16);
    expect(evaluateStrictRise(days, 18, false, 'C').status).toBe('PENDING');
    const gappy = [...P.slice(0, 7), null, null, null, ...P.slice(10), 3660, 3665, 3675].map((v) => day(v));
    expect(lenientFhm(gappy, gappy.length, 'C')).toBe(16);
  });

  test('uses the 3200 + 9k grid in °F', () => {
    const lowsF = [9752, 9740, 9745, 9740, 9752, 9745];
    const f = (v: number): DayTemp => ({ ...day(v), unit: 'F' });
    // Grid points near 97.5 °F are 97.52 and 97.61: 97.56 rounds down to 97.52 (not above), 97.57 up to 97.61.
    expect(lenientFhm([...lowsF, 9756, 9800, 9800].map(f), 9, 'F')).toBeNull();
    expect(lenientFhm([...lowsF, 9757, 9800, 9800].map(f), 9, 'F')).toBe(7);
  });

  test('an earlier LENIENT FHM in history shortens N (minus-8)', () => {
    // Strict evaluation skips every candidate (3 missing lows); LENIENT finds the CD12 rise.
    const gappy = withDays(historyCycle(12), { 8: { t: null }, 9: { t: null }, 10: { t: null } });
    const b = build('2026-05-01', { previous: [gappy, historyCycle(15)], current: mbase(6) });
    const r = run(b.data, b.cd(6));
    expect(r.cycles[0].rise).toBeNull();
    expect(r.cycles[2].preOvulatoryDays).toBe(4);
  });
});
