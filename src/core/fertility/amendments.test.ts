// Tests for each binding amendment (A1-A19) beyond the documented cases, plus
// contraception-mode gating and time-zone independence.

import { addDays } from '../date';
import type { ContextPeriod, MucusObservation } from '../types';
import { evaluateFertility, FERTILITY_REASON_CODES, newlyFertileDays } from './index';
import { APPEARANCE_QUALITY, assessMucus, COLOR_HIDES_MUCUS, COLOR_QUALITY, SENSATION_QUALITY } from './mucus';
import {
  build,
  codes,
  dayOf,
  DEVICE_OFFSET,
  historyCycle,
  hstd,
  localInstant,
  mbase,
  noAnswer,
  reading,
  run,
  seq,
  standardCycle,
  withDays,
  type DaySpec,
  type Scenario,
} from './testing';

const START = '2026-05-01';
const cd = (n: number) => addDays(START, n - 1);

function hstdCase(current: DaySpec[], extra: Partial<Scenario> = {}) {
  return build(START, { previous: hstd(), current, ...extra });
}

function temps(from: number, values: number[]): Record<number, DaySpec> {
  return Object.fromEntries(values.map((t, i) => [from + i, { t }]));
}

function mucusFrom(from: number, list: DaySpec['m'][]): Record<number, DaySpec> {
  return Object.fromEntries(list.map((m, i) => [from + i, { m }]));
}

function repeat<T>(value: T, n: number): T[] {
  return Array.from({ length: n }, () => value);
}

/** Standard cycle with the mucus peak moved: f, S, S+ ... S+ (until `peak`), S, f, Ø, then t. */
function withPeakOn(peak: number, firstFertile: number, base = standardCycle()): DaySpec[] {
  const list: DaySpec['m'][] = [];
  for (let d = 6; d <= 28; d++) {
    if (d < firstFertile) list.push('t');
    else if (d === firstFertile) list.push('f');
    else if (d === firstFertile + 1) list.push('S');
    else if (d <= peak) list.push('S+');
    else list.push((['S', 'f', 'Ø'] as const)[d - peak - 1] ?? 't');
  }
  return withDays(base, mucusFrom(6, list));
}

describe('A1 ending post-ovulatory infertility (critical)', () => {
  test('(a) unconfirmed period-like bleeding on any day after S ends it', () => {
    const r = run(hstdCase(withDays(standardCycle(), { 24: { flow: 'light' } })).data, cd(28));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F12 E1 I5 F5'));
    expect(dayOf(r, cd(24)).reasons).toEqual(['possible_new_cycle']);
    expect(r.cycles[1].postOvulatoryEnd).toEqual({ date: cd(24), reason: 'possible_new_cycle' });
  });

  test('(b) two consecutive spotting days on or after FHM + 10 end it from the first', () => {
    const one = run(hstdCase(withDays(standardCycle(), { 27: { flow: 'spotting' } })).data, cd(28));
    expect(codes(one, START, 19, 28)).toBe(seq('I10'));
    const two = run(hstdCase(withDays(standardCycle(), { 27: { flow: 'spotting' }, 28: { flow: 'spotting' } })).data, cd(28));
    expect(codes(two, START, 19, 28)).toBe(seq('I8 F2'));
    expect(dayOf(two, cd(27)).reasons).toEqual(['possible_new_cycle']);
  });

  test('(b) spotting before FHM + 10 does not end it', () => {
    const r = run(hstdCase(withDays(standardCycle(), { 22: { flow: 'spotting' }, 23: { flow: 'spotting' } })).data, cd(28));
    expect(codes(r, START, 19, 28)).toBe(seq('I10'));
  });

  test('(c) two consecutive VALID readings on or below the coverline from FHM + 10', () => {
    const one = run(hstdCase(withDays(standardCycle(), temps(27, [36.5]))).data, cd(28));
    expect(codes(one, START, 19, 28)).toBe(seq('I10'));
    const two = run(hstdCase(withDays(standardCycle(), temps(27, [36.5, 36.45]))).data, cd(28));
    expect(codes(two, START, 19, 28)).toBe(seq('I8 F2'));
    expect(dayOf(two, cd(27)).reasons).toEqual(['temperature_drop']);
    // Exactly as specified, only VALID readings count: two off-time lows do not end it.
    const offTime = { tOpts: { measuredAt: '09:00' } };
    const suspect = run(hstdCase(withDays(withDays(standardCycle(), temps(27, [36.5, 36.45])), { 27: offTime, 28: offTime })).data, cd(28));
    expect(codes(suspect, START, 19, 28)).toBe(seq('I10'));
  });

  test('(d) hard cap on FHM + 19, also in °F', () => {
    const r = run(hstdCase(standardCycle(40)).data, cd(40));
    expect(codes(r, START, 33, 36)).toBe('IIFF');
    expect(dayOf(r, cd(35)).reasons).toEqual(['luteal_phase_too_long']);
  });

  test('future days are never evaluated, and logs dated after today are ignored', () => {
    const b = hstdCase(withDays(standardCycle(), { 25: { flow: 'heavy', extra: { periodStartConfirmed: true } } }));
    const r = run(b.data, cd(22));
    expect(r.days[r.days.length - 1].date).toBe(cd(22));
    expect(r.days.every((d) => d.date <= cd(22))).toBe(true);
    expect(r.cycles).toHaveLength(2);
    expect(codes(r, START, 19, 22)).toBe('IIII');
  });

  test('a second spotting day turns an already shown day fertile and is reported for the alert', () => {
    const first = run(hstdCase(withDays(standardCycle(), { 27: { flow: 'spotting' } })).data, cd(27));
    expect(dayOf(first, cd(27)).status).toBe('infertile_post_ovulatory');
    const second = run(hstdCase(withDays(standardCycle(), { 27: { flow: 'spotting' }, 28: { flow: 'spotting' } })).data, cd(28));
    expect(newlyFertileDays(first.days, second.days)).toEqual([cd(27)]);
  });
});

describe('A2 typed mucus mapping (critical)', () => {
  test('maps are exhaustive over the enums', () => {
    expect(Object.keys(SENSATION_QUALITY).sort()).toEqual(['dry', 'moist', 'nothing', 'slippery', 'wet']);
    expect(Object.keys(APPEARANCE_QUALITY).sort()).toEqual(['creamy', 'egg_white', 'nothing', 'sticky', 'watery']);
    expect(Object.keys(COLOR_QUALITY).sort()).toEqual(Object.keys(COLOR_HIDES_MUCUS).sort());
    expect(Object.keys(COLOR_QUALITY)).toHaveLength(8);
  });

  const base: MucusObservation = { observationComplete: true, enteredAt: '', updatedAt: '' };
  const final = { complete: true, recalled: false };

  test('an unmapped value is UNKNOWN unless another input shows a fertile sign', () => {
    const foamy = { ...base, sensation: 'foamy' as never, appearance: 'nothing' as const };
    expect(assessMucus(foamy, final).quality).toBeNull();
    expect(assessMucus({ ...foamy, appearance: 'egg_white' }, final).quality).toBe(4);
    expect(assessMucus({ ...base, sensation: 'dry', appearance: 'nothing', stretchy: 'yes' as never }, final).quality).toBeNull();
    expect(assessMucus({ ...base, sensation: 'dry', appearance: 'nothing', color: 'purple' as never }, final).quality).toBeNull();
  });

  test('sensation, appearance, stretchy and colour each contribute; "wet" rates as S+', () => {
    const q = (o: Partial<MucusObservation>) => assessMucus({ ...base, sensation: 'dry', appearance: 'nothing', ...o }, final).quality;
    expect(q({})).toBe(0);
    expect(q({ sensation: 'nothing' })).toBe(1);
    expect(q({ sensation: 'wet' })).toBe(4);
    expect(q({ stretchy: true })).toBe(4);
    expect(q({ appearance: 'sticky' })).toBe(3);
    expect(q({ color: 'clear' })).toBe(4);
    expect(q({ color: 'blood_tinged' })).toBeNull();
    expect(q({ notAssessable: 'lubricant' })).toBeNull();
    expect(q({ notAssessable: 'semen', sensation: 'slippery' })).toBe(4);
  });

  test('non-finite inputs fail closed', () => {
    const nanTemp = withDays(standardCycle(), { 10: { readings: [{ ...reading(36.4, cd(10)), value: Number.NaN }] } });
    const r = run(hstdCase(nanTemp).data, cd(28));
    expect(r.cycles[1].temperatureBlocked).toBe('temperature_blocked_mixed_measurements');
    expect(codes(r, START, 6, 28)).toBe(seq('F23'));

    const sleep = run(hstdCase(withDays(standardCycle(), { 18: { extra: { sleepHours: Number.POSITIVE_INFINITY } } })).data, cd(28));
    expect(sleep.readings.find((x) => x.date === cd(18))?.kind).toBe('SUSPECT');

    const b = hstdCase(standardCycle());
    for (const offset of [Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      const bad = evaluateFertility(b.data, cd(28), offset);
      expect(bad.days.filter((d) => d.status !== 'fertile')).toEqual([]);
    }
  });

  test('every reason code is one of the exported codes', () => {
    const r = run(hstdCase(withDays(standardCycle(), { 22: { m: 'S+' } })).data, cd(28));
    for (const day of r.days) for (const reason of day.reasons) expect(FERTILITY_REASON_CODES).toContain(reason);
  });
});

describe('A3 both signs must describe the same ovulation (critical)', () => {
  test('3.1 a new patch after a known dry day discards the old peak', () => {
    // Old patch peaks CD11 (inside the pairing window); a later f-only patch has no peak at all.
    const current = withDays(standardCycle(), mucusFrom(6, ['t', 't', 'f', 'S', 'S+', 'S+', 't', 't', 'f', 'f', ...repeat<DaySpec['m']>('t', 13)]));
    const r = run(hstdCase(current).data, cd(28));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F23'));
    expect(r.cycles[1].mucus).toMatchObject({ maxQuality: 2, effectivePeakDate: null });
  });

  test('3.1 an incomplete dry day does not reset the patch (it is UNKNOWN and moves the peak instead)', () => {
    const incomplete = { m: 't' as const, mOpts: { observationComplete: false } };
    const current = withDays(
      withDays(standardCycle(), mucusFrom(6, ['t', 't', 'f', 'S', 'S+', 'S+', 't', 't', 'f', 'f', ...repeat<DaySpec['m']>('t', 13)])),
      { 12: incomplete, 13: incomplete },
    );
    const r = run(hstdCase(current).data, cd(28));
    expect(r.cycles[1].mucus).toMatchObject({ effectivePeakDate: cd(13), completeDate: cd(16) });
    expect(r.cycles[1].doubleCheckDate).toBe(cd(18));
  });

  test('3.2 pairing window: peak on FHM - 5 pairs, FHM - 6 does not', () => {
    const atMinus5 = run(hstdCase(withPeakOn(11, 8)).data, cd(28));
    expect(atMinus5.cycles[1]).toMatchObject({ doubleCheckDate: cd(18), rise: { fhmDate: cd(16) } });
    const atMinus6 = run(hstdCase(withPeakOn(10, 7)).data, cd(28));
    expect(atMinus6.cycles[1].doubleCheckDate).toBeNull();
    expect(codes(atMinus6, START, 6, 28)).toBe(seq('F23'));
  });

  test('3.2 pairing window: peak on FHM + 3 pairs with that FHM, FHM + 4 needs a later candidate', () => {
    const atPlus3 = run(hstdCase(withPeakOn(19, 11)).data, cd(28));
    expect(atPlus3.cycles[1]).toMatchObject({ doubleCheckDate: cd(22), rise: { fhmDate: cd(16) } });
    const atPlus4 = run(hstdCase(withPeakOn(20, 11)).data, cd(28));
    expect(atPlus4.cycles[1]).toMatchObject({ doubleCheckDate: cd(23), rise: { fhmDate: cd(17) } });
  });

  test('3.3 a SUSPECT reading between the temperature and the mucus completion voids the rise', () => {
    const current = withDays(withPeakOn(19, 11), { 20: { tOpts: { measuredAt: '08:00' } } });
    const r = run(hstdCase(current).data, cd(28));
    expect(r.cycles[1].doubleCheckDate).toBeNull();
    expect(codes(r, START, 6, 28)).toBe(seq('F23'));
  });

  test('3.3 the single Exception 2 dip stays excused', () => {
    const current = withDays(withPeakOn(19, 11), temps(16, [36.6, 36.45, 36.65, 36.75]));
    const r = run(hstdCase(current).data, cd(28));
    expect(r.cycles[1]).toMatchObject({ doubleCheckDate: cd(22), rise: { fhmDate: cd(16), rule: 'exception2' } });
  });
});

describe('A4 temperature collapse after S', () => {
  test('two VALID lows before FHM + 10 reopen the rest of the cycle and fail the next gate', () => {
    const current = withDays(standardCycle(), temps(20, [36.45, 36.5]));
    const b = hstdCase(current, { next: mbase(6) });
    const r = run(b.data, cd(34));
    expect(codes(r, START, 18, 28)).toBe(seq('E1 I1 F9'));
    expect(dayOf(r, cd(20)).reasons).toEqual(['temperature_collapse']);
    expect(r.cycles[1].postOvulatoryEnd).toEqual({ date: cd(20), reason: 'temperature_collapse' });
    expect(codes(r, cd(29), 1, 6)).toBe('FFFFFF');
  });

  test('a single low reading does not', () => {
    const r = run(hstdCase(withDays(standardCycle(), temps(20, [36.45]))).data, cd(28));
    expect(codes(r, START, 19, 28)).toBe(seq('I10'));
  });
});

describe('A5 measurement time', () => {
  test('an unparseable time is SUSPECT; up to 60 minutes off is VALID, 61 is SUSPECT', () => {
    const current = withDays(standardCycle(), {
      10: { tOpts: { measuredAt: '6:30' } },
      11: { tOpts: { measuredAt: '07:30' } },
      12: { tOpts: { measuredAt: '07:31' } },
      13: { tOpts: { measuredAt: '05:29' } },
    });
    const r = run(hstdCase(current).data, cd(28));
    const kind = (n: number) => r.readings.find((x) => x.date === cd(n))?.kind;
    expect([kind(10), kind(11), kind(12), kind(13)]).toEqual(['SUSPECT', 'VALID', 'SUSPECT', 'SUSPECT']);
  });

  test('the usual time is never applied retroactively', () => {
    const b = hstdCase(standardCycle(), { settings: { usualMeasurementTimes: [{ effectiveFrom: cd(10), time: '06:30' }] } });
    const r = run(b.data, cd(28));
    expect(r.cycles[1].temperatureBlocked).toBe('set_usual_measurement_time');
    // The previous cycle had no usual time either, so it has no double check and N = 0.
    expect(r.cycles[0].temperatureBlocked).toBe('set_usual_measurement_time');
    expect(codes(r, START, 1, 28)).toBe(seq('F28'));
  });
});

describe('A6 time zones', () => {
  test('an offset change of 60 minutes makes that day and the next 2 SUSPECT', () => {
    const current = standardCycle().map((s, i) => ({ ...s, tOpts: { utcOffsetMinutes: i >= 9 ? 120 : 60 } }));
    const r = run(hstdCase(current).data, cd(28));
    const kinds = [9, 10, 11, 12, 13].map((n) => r.readings.find((x) => x.date === cd(n))?.kind);
    expect(kinds).toEqual(['VALID', 'SUSPECT', 'SUSPECT', 'SUSPECT', 'VALID']);
  });

  test('a cycle crossing the spring DST change still double-checks when the change falls among early lows', () => {
    // CD1 = 2026-03-25, Europe/Berlin moves to UTC+2 on 2026-03-29 (CD5).
    const cd1 = '2026-03-25';
    const current = standardCycle().map((s, i) => ({ ...s, tOpts: { utcOffsetMinutes: i >= 4 ? 120 : 60 } }));
    const b = build(cd1, { previous: hstd(), current, mucusOffset: 120 });
    const r = run(b.data, b.cd(28), 120);
    expect(r.readings.filter((x) => x.kind === 'SUSPECT').map((x) => x.date)).toEqual(['2026-03-29', '2026-03-30', '2026-03-31']);
    expect(codes(r, cd1, 1, 28)).toBe(seq('P5 F12 E1 I10'));
  });

  test('a reading without a valid offset is SUSPECT', () => {
    const r = run(hstdCase(withDays(standardCycle(), { 17: { tOpts: { utcOffsetMinutes: Number.NaN } } })).data, cd(28));
    expect(r.readings.find((x) => x.date === cd(17))?.kind).toBe('SUSPECT');
  });
});

describe('A7 several readings on one date', () => {
  test('as a higher reading the day is a dip', () => {
    const current = withDays(standardCycle(), { 18: { readings: [reading(36.75, cd(18)), reading(36.8, cd(18), { measuredAt: '06:40' })] } });
    const r = run(hstdCase(current).data, cd(28));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F13 E1 I9'));
    expect(r.cycles[1].rise?.rule).toBe('exception2');
  });

  test('for the coverline the maximum counts', () => {
    const current = withDays(standardCycle(), { 15: { readings: [reading(36.4, cd(15)), reading(36.58, cd(15))] } });
    const r = run(hstdCase(current).data, cd(28));
    expect(r.readings.find((x) => x.date === cd(15))).toMatchObject({ kind: 'SUSPECT', value: 3658 });
    expect(r.cycles[1].rise).toMatchObject({ fhmDate: cd(17), coverline: 3660 });
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F14 E1 I8'));
  });
});

describe('A8 units, rounding and resolution', () => {
  test('mixed units within one cycle block evaluation', () => {
    const current = withDays(standardCycle(), { 5: { readings: [{ ...reading(0, cd(5)), value: 9752, unit: 'F', raw: '97.52' }] } });
    const r = run(hstdCase(current).data, cd(28));
    expect(r.cycles[1].temperatureBlocked).toBe('temperature_blocked_mixed_measurements');
  });

  test('a 0.05 thermometer: digits 0 and 5 evaluate, any other digit blocks', () => {
    const settings = { thermometer: { id: 'default', resolution: 0.05 as const } };
    const ok = run(hstdCase(standardCycle(), { settings }).data, cd(28));
    expect(codes(ok, START, 1, 28)).toBe(seq('P5 F12 E1 I10'));
    const bad = run(hstdCase(withDays(standardCycle(), { 18: { t: 36.73 } }), { settings }).data, cd(28));
    expect(bad.cycles[1].temperatureBlocked).toBe('temperature_blocked_low_resolution');
  });

  test('a reading above 38.50 °C is treated as excluded (fever)', () => {
    const r = run(hstdCase(withDays(standardCycle(), temps(13, [38.6]))).data, cd(28));
    expect(r.readings.find((x) => x.date === cd(13))?.kind).toBe('EXCLUDED');
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F12 E1 I10'));
  });

  test('a thermometer other than the configured one, or a fractional value, blocks', () => {
    const other = run(hstdCase(standardCycle().map((s) => ({ ...s, tOpts: { thermometerId: 'new' } }))).data, cd(28));
    expect(other.cycles[1].temperatureBlocked).toBe('temperature_blocked_mixed_measurements');
    const fractional = withDays(standardCycle(), { 9: { readings: [{ ...reading(36.5, cd(9)), value: 3650.5, raw: 'x' }] } });
    expect(run(hstdCase(fractional).data, cd(28)).cycles[1].temperatureBlocked).toBe('temperature_blocked_mixed_measurements');
  });

  test('a first cycle in °F needs the extra reading too', () => {
    const lowsF = [97.52, 97.4, 97.45, 97.4, 97.52, 97.45, 97.4, 97.45, 97.52, 97.4, 97.45, 97.4, 97.52, 97.45, 97.4];
    const cycleF = mbase(28).map((s, i) => ({ ...s, t: i < 15 ? lowsF[i] : ([97.7, 97.75, 97.88][i - 15] ?? 97.8) }));
    const b = build(START, { current: cycleF, unit: 'F' });
    expect(codes(run(b.data, cd(28)), START, 1, 28)).toBe(seq('F18 E1 I9'));
  });
});

describe('A9 coverline gaps', () => {
  test('two excluded lows are allowed, three are not', () => {
    const ex = { tOpts: { excluded: { reason: 'other' as const } } };
    const two = run(hstdCase(withDays(standardCycle(), { 12: ex, 13: ex })).data, cd(28));
    expect(two.cycles[1].doubleCheckDate).toBe(cd(18));
    const three = run(hstdCase(withDays(standardCycle(), { 11: ex, 12: ex, 13: ex })).data, cd(28));
    expect(three.cycles[1].doubleCheckDate).toBeNull();
  });
});

describe('A10 incomplete and late mucus entries', () => {
  const dryOn5 = (opts: Partial<MucusObservation>) => withDays(mbase(5), { 5: { flow: 'none', m: 't', mOpts: opts } });

  test('a completion before the evening time is not final; the next morning is', () => {
    const early = run(hstdCase(dryOn5({ completedAt: localInstant(cd(5), '17:00') })).data, cd(6));
    expect(codes(early, START, 1, 5)).toBe('PPPPF');
    const nextMorning = localInstant(cd(6), '08:00');
    const late = run(hstdCase(dryOn5({ completedAt: nextMorning, updatedAt: nextMorning })).data, cd(6));
    expect(codes(late, START, 1, 5)).toBe('PPPPP');
  });

  test('"complete" without a completion time is not final', () => {
    expect(codes(run(hstdCase(dryOn5({ completedAt: undefined })).data, cd(6)), START, 1, 5)).toBe('PPPPF');
  });

  test('recalled after 12:00 the next day: a low Q is UNKNOWN, 12:00 exactly is still on time', () => {
    const noon = localInstant(cd(6), '12:00');
    expect(codes(run(hstdCase(dryOn5({ updatedAt: noon })).data, cd(6)), START, 1, 5)).toBe('PPPPP');
    const after = localInstant(cd(6), '12:01');
    expect(codes(run(hstdCase(dryOn5({ updatedAt: after })).data, cd(6)), START, 1, 5)).toBe('PPPPF');
  });

  test('a recalled fertile sign still counts', () => {
    const late = localInstant(cd(8), '09:00');
    const current = withDays(mbase(5), { 5: { flow: 'none', m: 'f', mOpts: { updatedAt: late } } });
    const r = run(hstdCase(current).data, cd(8));
    expect(dayOf(r, cd(5)).reasons).toContain('fertile_sign_observed');
  });

  test('a recalled temperature reading is SUSPECT', () => {
    const current = withDays(standardCycle(), { 18: { tOpts: { enteredAt: localInstant(cd(20), '09:00') } } });
    const r = run(hstdCase(current).data, cd(28));
    expect(r.readings.find((x) => x.date === cd(18))?.kind).toBe('SUSPECT');
    expect(r.cycles[1].rise?.rule).toBe('exception2');
  });
});

describe('A11 first cycle unless the previous cycle was charted', () => {
  test('temperatures on under 80 % of the previous cycle', () => {
    const sparse = withDays(historyCycle(), Object.fromEntries([22, 23, 24, 25, 26, 27].map((d) => [d, { t: null }])));
    const b = build(START, { previous: [historyCycle(), sparse], current: standardCycle() });
    const r = run(b.data, cd(28));
    expect(r.cycles[2]).toMatchObject({ firstCycle: true, preOvulatoryDays: 0, doubleCheckDate: cd(19) });
  });

  test('a run of 4 days with neither temperature nor complete mucus', () => {
    const gap = withDays(historyCycle(), { 22: null, 23: null, 24: null, 25: null });
    const b = build(START, { previous: [historyCycle(), gap], current: standardCycle() });
    expect(run(b.data, cd(28)).cycles[2].firstCycle).toBe(true);
  });
});

describe('A12 plausibility gate', () => {
  test('previous cycle longer than 40 days', () => {
    const b = build(START, { previous: [historyCycle(), historyCycle(15, 41)], current: mbase(6) });
    const r = run(b.data, cd(6));
    expect(r.cycles[2]).toMatchObject({ firstCycle: false, preOvulatoryDays: 0 });
    expect(dayOf(r, cd(1)).reasons).toContain('previous_cycle_not_qualifying');
  });

  test('temperatures on under 70 % of the days from S to the end', () => {
    const sparse = withDays(historyCycle(), Object.fromEntries([20, 21, 22, 23, 24].map((d) => [d, { t: null }])));
    const b = build(START, { previous: [historyCycle(), sparse], current: mbase(6) });
    const r = run(b.data, cd(6));
    expect(r.cycles[2]).toMatchObject({ firstCycle: false, preOvulatoryDays: 0 });
  });

  test('current CD1 exactly FHM + 10 passes, FHM + 9 fails', () => {
    const at10 = build(START, { previous: [historyCycle(), historyCycle(15, 24)], current: mbase(6) });
    expect(run(at10.data, cd(6)).cycles[2].preOvulatoryDays).toBe(5);
    const at9 = build(START, { previous: [historyCycle(), historyCycle(15, 23)], current: mbase(6) });
    expect(run(at9.data, cd(6)).cycles[2].preOvulatoryDays).toBe(0);
  });
});

describe('A13 affected and locked cycles', () => {
  test('an unanswered check-in locks the cycle', () => {
    const b = hstdCase(standardCycle());
    const answers = b.data.cycleContextAnswers.filter((a) => a.cycleStart !== START);
    const r = run({ ...b.data, cycleContextAnswers: answers }, cd(28));
    expect(codes(r, START, 1, 28)).toBe(seq('F28'));
    expect(dayOf(r, cd(1)).reasons).toEqual(['cycle_checkin_unanswered']);
    expect(r.cycles[1].locked).toBe(true);
  });

  test('a non-boolean answer counts as "yes"', () => {
    const b = hstdCase(standardCycle());
    const answers = [...b.data.cycleContextAnswers.filter((a) => a.cycleStart !== START), { ...noAnswer(START), breastfeeding: undefined as never }];
    expect(codes(run({ ...b.data, cycleContextAnswers: answers }, cd(28)), START, 1, 28)).toBe(seq('F28'));
  });

  test.each(['postpartum', 'perimenopause', 'emergency_contraception'] as const)('a %s context locks the whole cycle', (kind) => {
    const contexts: ContextPeriod[] = [{ id: 'c', kind, start: cd(10), end: cd(10) }];
    const r = run(hstdCase(standardCycle(), { contexts }).data, cd(28));
    expect(codes(r, START, 1, 28)).toBe(seq('F28'));
    expect(dayOf(r, cd(20)).reasons).toEqual(['cycle_locked_context']);
  });

  test('pregnancy is not applicable on its days and locks the rest', () => {
    const contexts: ContextPeriod[] = [{ id: 'p', kind: 'pregnancy', start: cd(20) }];
    const r = run(hstdCase(standardCycle(), { contexts }).data, cd(28));
    expect(codes(r, START, 1, 28)).toBe(seq('F19 N9'));
    expect(dayOf(r, cd(22)).reasons).toEqual(['context_not_applicable']);
  });

  test('a context in the previous cycle makes the current cycle a first cycle; its readings are not used', () => {
    const contexts: ContextPeriod[] = [{ id: 'e', kind: 'emergency_contraception', start: addDays(START, -10), end: addDays(START, -10) }];
    const r = run(hstdCase(standardCycle(), { contexts }).data, cd(28));
    expect(r.cycles[0].locked).toBe(true);
    expect(r.cycles[1]).toMatchObject({ firstCycle: true, preOvulatoryDays: 0 });
    expect(r.readings.find((x) => x.date === addDays(START, -10))?.kind).toBe('EXCLUDED');
  });
});

describe('A14 unsure', () => {
  test('an unsure day after the peak is UNKNOWN and moves it', () => {
    const r = run(hstdCase(withDays(standardCycle(), { 17: { mOpts: { unsure: true } } })).data, cd(28));
    expect(r.cycles[1].mucus).toMatchObject({ effectivePeakDate: cd(17), completeDate: cd(20) });
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F14 E1 I8'));
  });

  test('unsure rates upwards to at least f', () => {
    const o: MucusObservation = { sensation: 'dry', appearance: 'nothing', unsure: true, observationComplete: true, enteredAt: '', updatedAt: '' };
    expect(assessMucus(o, { complete: true, recalled: false }).quality).toBe(2);
    expect(assessMucus({ ...o, appearance: 'creamy' }, { complete: true, recalled: false }).quality).toBe(4);
  });
});

describe('A15 strict pre-ovulatory compatibility', () => {
  test('flow not logged is not compatible', () => {
    const current = withDays(mbase(5), { 5: { flow: undefined, m: 't' } });
    current[4] = { m: 't' };
    expect(codes(run(hstdCase(current).data, cd(5)), START, 1, 5)).toBe('PPPPF');
  });

  test('"not assessable (bleeding)" on a day without bleeding is not compatible', () => {
    const current = withDays(mbase(5), { 2: { flow: 'none' } });
    expect(codes(run(hstdCase(current).data, cd(5)), START, 1, 5)).toBe('PFFFF');
  });
});

describe('A16 minus-8 history', () => {
  test('leading spotting days before CD1 shorten N', () => {
    const previous = withDays(historyCycle(), { 27: { flow: 'spotting' }, 28: { flow: 'spotting' } });
    const b = build(START, { previous: [historyCycle(), previous], current: mbase(6) });
    const r = run(b.data, cd(6));
    expect(r.cycles[2].preOvulatoryDays).toBe(3);
    expect(codes(r, START, 1, 6)).toBe('PPPFFF');
  });

  test('a locked cycle does not count toward the 12', () => {
    const b = build(START, { previous: hstd(12), current: withDays(mbase(28), { 7: { m: 'Ø' } }) });
    const answers = b.data.cycleContextAnswers.filter((a) => a.cycleStart !== b.starts[3]);
    const r = run({ ...b.data, cycleContextAnswers: answers }, cd(10));
    expect(r.cycles[12].preOvulatoryDays).toBe(5);
  });
});

describe('A17 edit safety diff', () => {
  const day = (date: string, status: 'fertile' | 'infertile_pre_ovulatory' | 'infertile_post_ovulatory' | 'not_applicable') => ({
    date,
    cycleDay: 1,
    status,
    inPeriod: false,
    reasons: [],
  });

  test('lists days previously shown infertile that no longer are', () => {
    const previous = [
      { date: '2026-05-03', status: 'infertile_pre_ovulatory' as const },
      { date: '2026-05-01', status: 'infertile_post_ovulatory' as const },
      { date: '2026-05-02', status: 'infertile_post_ovulatory' as const },
      { date: '2026-05-04', status: 'fertile' as const },
      { date: '2026-05-05', status: 'infertile_post_ovulatory' as const },
      { date: '2026-05-03', status: 'infertile_pre_ovulatory' as const },
    ];
    const current = [
      day('2026-05-01', 'not_applicable'),
      day('2026-05-02', 'infertile_pre_ovulatory'),
      day('2026-05-03', 'fertile'),
      day('2026-05-04', 'fertile'),
    ];
    expect(newlyFertileDays(previous, current)).toEqual(['2026-05-01', '2026-05-03', '2026-05-05']);
  });
});

describe('A18 display', () => {
  test('inPeriod is a badge on both fertile and infertile period days', () => {
    const r = run(hstdCase(standardCycle()).data, cd(28));
    expect(dayOf(r, cd(1))).toMatchObject({ status: 'infertile_pre_ovulatory', inPeriod: true });
    const first = run(build(START, { current: standardCycle() }).data, cd(28));
    expect(dayOf(first, cd(1))).toMatchObject({ status: 'fertile', inPeriod: true });
  });
});

describe('A19 re-confirmation after reopening', () => {
  test('a different thermometer on the re-confirmation days leaves the cycle fertile', () => {
    const other = { tOpts: { thermometerId: 'spare' } };
    const current = withDays(standardCycle(), { 22: { m: 'S+', ...other }, 23: { m: 'S', ...other }, 24: other, 25: other });
    const r = run(hstdCase(current).data, cd(28));
    expect(codes(r, START, 22, 28)).toBe(seq('F7'));
  });
});

describe('contraception mode and determinism', () => {
  test('with contraception mode off (or not acknowledged) no day is labelled infertile, but the chart data remains', () => {
    const b = hstdCase(standardCycle());
    for (const mode of [{ enabled: false }, { enabled: true }]) {
      const data = { ...b.data, settings: { ...b.data.settings, contraceptionMode: mode } };
      const r = evaluateFertility(data, cd(28), DEVICE_OFFSET);
      expect(codes(r, START, 1, 28)).toBe(seq('F28'));
      expect(r.cycles[1].doubleCheckDate).toBe(cd(18));
      expect(r.cycles[1].rise?.coverline).toBe(3650);
    }
  });

  test('results do not depend on the process time zone', () => {
    const b = hstdCase(withDays(standardCycle(), { 22: { m: 'S+' }, 23: { m: 'S' } }));
    const saved = process.env.TZ;
    const results: string[] = [];
    try {
      for (const tz of ['UTC', 'Europe/Berlin', 'Pacific/Auckland', 'America/New_York']) {
        process.env.TZ = tz;
        results.push(JSON.stringify(evaluateFertility(b.data, cd(28), DEVICE_OFFSET)));
      }
    } finally {
      process.env.TZ = saved;
    }
    expect(new Set(results).size).toBe(1);
  });

  test('no logs gives an empty result; days before the first confirmed start are cycle_start_unknown', () => {
    expect(run(build(START, { current: [] }).data, cd(1))).toEqual({ days: [], cycles: [], readings: [] });
    const b = build(START, { current: standardCycle(), extraLogs: mbase(3).map((_, i) => ({ date: addDays(START, i - 3), temperatures: [], updatedAt: '' })) });
    const r = run(b.data, cd(2));
    expect(r.days.slice(0, 3).map((d) => [d.cycleDay, d.status, d.reasons])).toEqual(repeat([null, 'fertile', ['cycle_start_unknown']], 3));
  });
});

describe('review follow-ups', () => {
  test('A4: a VALID high reading between two lows breaks the pair', () => {
    const r = run(hstdCase(withDays(standardCycle(), temps(20, [36.45, 36.75, 36.45]))).data, cd(28));
    expect(codes(r, START, 19, 28)).toBe(seq('I10'));
  });

  test('A4: a SUSPECT reading between two VALID lows does not hide the collapse', () => {
    const current = withDays(withDays(standardCycle(), temps(20, [36.45, 36.75, 36.45])), { 21: { tOpts: { measuredAt: '09:00' } } });
    const r = run(hstdCase(current).data, cd(28));
    expect(codes(r, START, 18, 28)).toBe(seq('E1 I1 F9'));
    expect(dayOf(r, cd(22)).reasons).toEqual(['temperature_collapse']);
  });

  test('A7: a multi-reading day is still SUSPECT as a higher reading', () => {
    const r = run(hstdCase(withDays(standardCycle(), { 18: { readings: [reading(36.75, cd(18)), reading(36.8, cd(18))] } })).data, cd(28));
    expect(r.cycles[1].doubleCheckDate).not.toBe(cd(18));
  });

  test('A16: several days of period flow before the confirmed CD1 shorten N by as many days', () => {
    const previous = withDays(historyCycle(), { 27: { flow: 'heavy', m: 'NA' }, 28: { flow: 'light', m: 'NA' } });
    const b = build(START, { previous: [historyCycle(), previous], current: mbase(6) });
    const r = run(b.data, cd(6));
    expect(r.cycles[2].preOvulatoryDays).toBe(3);
    expect(codes(r, START, 1, 6)).toBe('PPPFFF');
  });

  test('section 10: a check-in reporting breastfeeding gives method_not_supported_postpartum on every day', () => {
    const b = hstdCase(standardCycle());
    const answers = [...b.data.cycleContextAnswers.filter((a) => a.cycleStart !== START), { ...noAnswer(START), breastfeeding: true }];
    const r = run({ ...b.data, cycleContextAnswers: answers }, cd(28));
    expect(codes(r, START, 1, 28)).toBe(seq('F28'));
    expect(dayOf(r, cd(1)).reasons).toEqual(['method_not_supported_postpartum']);
    expect(dayOf(r, cd(25)).reasons).toEqual(['method_not_supported_postpartum']);
  });

  test('A17: an evening transition that is still infertile, or still a transition, is not reported', () => {
    const shown = [{ date: cd(18), status: 'fertile' as const, eveningTransition: true }];
    const day = (status: 'fertile' | 'infertile_post_ovulatory', eveningTransition?: true) => ({
      date: cd(18),
      cycleDay: 18,
      status,
      inPeriod: false,
      reasons: [],
      ...(eveningTransition ? { eveningTransition } : {}),
    });
    expect(newlyFertileDays(shown, [day('fertile', true)])).toEqual([]);
    expect(newlyFertileDays(shown, [day('infertile_post_ovulatory')])).toEqual([]);
    expect(newlyFertileDays(shown, [day('fertile')])).toEqual([cd(18)]);
    expect(newlyFertileDays(shown, [])).toEqual([cd(18)]);
  });
});
