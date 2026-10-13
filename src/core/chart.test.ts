import { overlayCycles, temperatureChart, temperatureRange, type TemperatureChartData } from './chart';
import { addDays, type ISODate } from './date';
import { derive, type DerivedState } from './derive';
import {
  cycleLogs,
  DEVICE_OFFSET,
  historyCycle,
  noAnswer,
  readingF,
  withDays,
  type DaySpec,
} from './fertility/testing';
import { appData, logs } from './testing/fixtures';
import type { AppData, DailyLog, TempUnit } from './types';

// Cycles placed back to back from FIRST; the last one is the open cycle.
const FIRST = '2026-06-01';

interface Built {
  data: AppData;
  derived: DerivedState;
  starts: ISODate[];
}

function build(cycles: DaySpec[][], today: ISODate, extra: DailyLog[] = [], unitOf: (i: number) => TempUnit = () => 'C'): Built {
  const starts: ISODate[] = [];
  let start = FIRST;
  for (const specs of cycles) {
    starts.push(start);
    start = addDays(start, specs.length);
  }
  const entries = cycles.flatMap((specs, i) => cycleLogs(starts[i], specs, { unit: unitOf(i) }));
  const data = appData({ logs: logs(...entries, ...extra), cycleContextAnswers: starts.map(noAnswer) });
  const derived = derive(data, { today, now: { date: today, time: '08:00' }, deviceUtcOffsetMinutes: DEVICE_OFFSET });
  return { data, derived, starts };
}

/** A 28-day charted cycle as in historyCycle, but with no temperatures at all. */
function untakenCycle(): DaySpec[] {
  return historyCycle(15, 28).map((spec) => ({ ...spec, t: null }));
}

/** historyCycle with its temperatures converted to °F (still integer hundredths once read). */
function fahrenheitCycle(fhm = 15, length = 28): DaySpec[] {
  return historyCycle(fhm, length).map((spec) => ({ ...spec, t: spec.t == null ? spec.t : spec.t * 1.8 + 32 }));
}

const kinds = (chart: TemperatureChartData) => chart.days.map((d) => d.kind[0]).join('');

describe('temperatureChart', () => {
  // Cycle 1 (the one charted): day 3 not taken, day 5 bracketed for alcohol, day 7 taken while ill.
  const target = withDays(historyCycle(15, 28), {
    3: { t: null },
    5: { tOpts: { excluded: { reason: 'alcohol' } } },
    7: { extra: { illness: true } },
    12: { extra: { sexDrive: 4 } },
  });
  const { data, derived, starts } = build([historyCycle(15, 28), target, historyCycle(15, 10)], addDays(FIRST, 28 + 28 + 5));
  const chart = temperatureChart(data, derived, 1);

  test('one day per cycle day, through the end of a closed cycle', () => {
    expect(chart.unit).toBe('C');
    expect(chart.days).toHaveLength(28);
    expect(chart.days[0]).toMatchObject({ cycleDay: 1, date: starts[1], value: 3650, kind: 'VALID', flow: 'heavy' });
    expect(chart.days[27]).toMatchObject({ cycleDay: 28, date: addDays(starts[2], -1) });
  });

  test('reading kinds come from the fertility engine; missing days have no value', () => {
    expect(kinds(chart)).toBe('VVMVEVS' + 'V'.repeat(21));
    expect(chart.days[2]).toMatchObject({ value: null, kind: 'MISSING', flow: 'medium' });
    // Excluded and suspect readings keep their value, for hollow markers.
    expect(chart.days[4]).toMatchObject({ value: 3650, kind: 'EXCLUDED', flow: 'spotting' });
    expect(chart.days[6]).toMatchObject({ value: 3640, kind: 'SUSPECT' });
  });

  test('lines never cross missing or excluded days, and single days get no line', () => {
    // Day 4 sits alone between the missing day 3 and the excluded day 5.
    expect(chart.segments).toEqual([
      { from: 1, to: 2 },
      { from: 6, to: 28 },
    ]);
  });

  test('coverline, first higher measurement and estimated ovulation after the rise', () => {
    expect(chart.coverline).toBe(3650);
    expect(chart.fhmCycleDay).toBe(15);
    expect(chart.estimatedOvulationCycleDay).toBe(14);
  });

  test('mucus strip: quality per day and the confirmed peak marked once', () => {
    expect(chart.days.filter((d) => d.isPeak).map((d) => d.cycleDay)).toEqual([14]);
    expect(chart.days[13].mucusQuality).toBe(4);
    // Days 1-4 are not assessable because of bleeding.
    expect(chart.days[0].mucusQuality).toBeNull();
  });

  test('flow and sex drive appear only where logged', () => {
    expect(chart.days[11].sexDrive).toBe(4);
    expect(chart.days.filter((d) => 'sexDrive' in d)).toHaveLength(1);
    expect(chart.days[5].flow).toBe('none');
    const unlogged = build([historyCycle(15, 28), withDays(historyCycle(15, 28), { 9: null })], addDays(FIRST, 40));
    const day9 = temperatureChart(unlogged.data, unlogged.derived, 1).days[8];
    expect(day9).toEqual({ cycleDay: 9, date: addDays(unlogged.starts[1], 8), value: null, kind: 'MISSING', mucusQuality: null, isPeak: false });
  });

  test('y range: on grid lines, covering every value, at least 1.0 °C', () => {
    // Values 36.40-36.75 padded to 36.30-36.90, then widened to 1.0 °C around the middle.
    expect([chart.yMin, chart.yMax]).toEqual([3610, 3710]);
  });

  test('the open cycle runs through today, with no rise yet', () => {
    const open = temperatureChart(data, derived, 2);
    expect(open.days.map((d) => d.date)).toEqual([0, 1, 2, 3, 4, 5].map((n) => addDays(starts[2], n)));
    expect(open).toMatchObject({ coverline: null, fhmCycleDay: null, estimatedOvulationCycleDay: null });
    expect(open.days.some((d) => d.isPeak)).toBe(false);
  });

  test('the mucus peak is marked only after 3 lower days', () => {
    const cycles = [historyCycle(15, 28), historyCycle(15, 20)];
    const pending = build(cycles, addDays(FIRST, 28 + 15));
    expect(temperatureChart(pending.data, pending.derived, 1).days.some((d) => d.isPeak)).toBe(false);
    const complete = build(cycles, addDays(FIRST, 28 + 16));
    expect(temperatureChart(complete.data, complete.derived, 1).days.filter((d) => d.isPeak).map((d) => d.cycleDay)).toEqual([14]);
  });

  test('a reading in another unit is left off the plot and stops the rise', () => {
    const mixed = withDays(historyCycle(15, 28), { 8: { readings: [] } });
    const day8 = addDays(FIRST, 28 + 7);
    const b = build([historyCycle(15, 28), mixed, historyCycle(15, 3)], addDays(FIRST, 58), [
      { date: day8, temperatures: [readingF(97.5, day8)], updatedAt: '2026-01-01T20:00:00.000Z' },
    ]);
    const c = temperatureChart(b.data, b.derived, 1);
    expect(c.unit).toBe('C');
    expect(c.days[7]).toMatchObject({ value: null, kind: 'EXCLUDED' });
    expect(b.derived.fertility.cycles[1].temperatureBlocked).toBe('temperature_blocked_mixed_measurements');
    expect(c).toMatchObject({ coverline: null, fhmCycleDay: null });
    expect(c.segments).toEqual([
      { from: 1, to: 7 },
      { from: 9, to: 28 },
    ]);
  });

  test('a °F cycle is charted in °F with a span of at least 1.8 °F', () => {
    const b = build([fahrenheitCycle(), fahrenheitCycle(15, 10)], addDays(FIRST, 30), [], () => 'F');
    const c = temperatureChart(b.data, b.derived, 0);
    expect(c.unit).toBe('F');
    expect(c.days[0].value).toBe(9770);
    expect(c.yMax - c.yMin).toBeGreaterThanOrEqual(180);
    expect(c.coverline).toBe(9770);
    expect(c.fhmCycleDay).toBe(15);
  });

  test('an unknown cycle index gives an empty chart', () => {
    expect(temperatureChart(data, derived, 7)).toEqual({
      unit: 'C',
      days: [],
      coverline: null,
      fhmCycleDay: null,
      estimatedOvulationCycleDay: null,
      yMin: 3600,
      yMax: 3700,
      segments: [],
    });
  });
});

describe('temperatureRange', () => {
  test.each([
    [[3640, 3675], 'C', 3610, 3710],
    [[3600, 3800], 'C', 3590, 3810],
    [[3655], 'C', 3610, 3710],
    [[9700], 'F', 9620, 9800],
    [[9770, 9815], 'F', 9700, 9880],
  ] as const)('%j °%s gives %d-%d', (values, unit, yMin, yMax) => {
    expect(temperatureRange([...values], unit)).toEqual({ yMin, yMax });
  });

  test('always integer, on the grid, at least the minimum span, and covering every value', () => {
    const sets: [number[], TempUnit][] = [
      [[3512], 'C'],
      [[3600, 3601], 'C'],
      [[3650, 3720, 3810], 'C'],
      [[9690], 'F'],
      [[9599, 9921], 'F'],
      [[10010, 10012], 'F'],
    ];
    for (const [values, unit] of sets) {
      const { yMin, yMax } = temperatureRange(values, unit);
      const step = unit === 'C' ? 10 : 20;
      expect(Number.isInteger(yMin) && Number.isInteger(yMax)).toBe(true);
      expect(yMin % step).toBe(0);
      expect(yMax % step).toBe(0);
      expect(yMax - yMin).toBeGreaterThanOrEqual(unit === 'C' ? 100 : 180);
      expect(Math.min(...values)).toBeGreaterThan(yMin);
      expect(Math.max(...values)).toBeLessThan(yMax);
    }
  });

  test('without values it shows a typical range', () => {
    expect(temperatureRange([], 'C')).toEqual({ yMin: 3600, yMax: 3700 });
    expect(temperatureRange([], 'F')).toEqual({ yMin: 9680, yMax: 9860 });
  });
});

describe('overlayCycles', () => {
  // FHMs on cycle days 15, 17, 13, 15 and, in the cycle overlaid on, 14.
  const cycles = [historyCycle(15), historyCycle(17), historyCycle(13), historyCycle(15), historyCycle(14, 20)];
  const today = addDays(FIRST, 28 * 4 + 19);
  const { data, derived, starts } = build(cycles, today);

  test('by cycle day: the 3 previous cycles, newest first, unshifted', () => {
    const overlays = overlayCycles(data, derived, 4, 'cycle_day');
    expect(overlays.map((o) => [o.cycleIndex, o.start, o.shift])).toEqual([
      [3, starts[3], 0],
      [2, starts[2], 0],
      [1, starts[1], 0],
    ]);
    for (const o of overlays) {
      expect(o.days).toHaveLength(28);
      expect(o.days.every((d) => d.x === d.cycleDay)).toBe(true);
      expect(o.segments).toEqual([{ from: 1, to: 28 }]);
    }
    expect(overlays[0].days[0]).toEqual({ x: 1, cycleDay: 1, date: starts[3], value: 3650, kind: 'VALID' });
  });

  test('by rise: each first higher measurement lands on the target cycle\'s own', () => {
    const overlays = overlayCycles(data, derived, 4, 'rise');
    expect(overlays.map((o) => [o.cycleIndex, o.shift])).toEqual([
      [3, -1],
      [2, 1],
      [1, -3],
    ]);
    const target = temperatureChart(data, derived, 4);
    expect(target.fhmCycleDay).toBe(14);
    for (const o of overlays) {
      const fhm = derived.fertility.cycles[o.cycleIndex].rise!.fhmDate;
      expect(o.days.find((d) => d.date === fhm)?.x).toBe(14);
      // Days that would fall before cycle day 1 are dropped.
      expect(o.days[0].x).toBe(Math.max(1, 1 + o.shift));
    }
    expect(overlays[2].days).toHaveLength(25);
    expect(overlays[2].segments).toEqual([{ from: 1, to: 25 }]);
    expect(overlays[1].segments).toEqual([{ from: 2, to: 29 }]);
  });

  test('by rise, nothing is returned while the target cycle has no rise', () => {
    const early = build(cycles.slice(0, 4).concat([historyCycle(14, 10)]), addDays(FIRST, 28 * 4 + 9));
    expect(overlayCycles(early.data, early.derived, 4, 'rise')).toEqual([]);
    expect(overlayCycles(early.data, early.derived, 4, 'cycle_day')).toHaveLength(3);
  });

  test('cycles without readings, without a rise (by rise) or in another unit are left out', () => {
    const mixedCycles = [historyCycle(15), fahrenheitCycle(), untakenCycle(), historyCycle(15), historyCycle(14, 20)];
    const b = build(mixedCycles, today, [], (i) => (i === 1 ? 'F' : 'C'));
    expect(overlayCycles(b.data, b.derived, 4, 'cycle_day').map((o) => o.cycleIndex)).toEqual([3]);
    expect(overlayCycles(b.data, b.derived, 4, 'rise').map((o) => o.cycleIndex)).toEqual([3]);
  });

  test('the first cycle has nothing to overlay, and an unknown index gives nothing', () => {
    expect(overlayCycles(data, derived, 0, 'cycle_day')).toEqual([]);
    expect(overlayCycles(data, derived, 9, 'cycle_day')).toEqual([]);
  });
});
