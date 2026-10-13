import { cycleDay, deriveCycles, findCycle, isInPeriod, unconfirmedBleedingStarts } from './cycles';
import { log, logs, series } from './testing/fixtures';

const start = (date: string, flow: 'light' | 'medium' | 'heavy' = 'heavy') =>
  log(date, { flow, periodStartConfirmed: true });

describe('deriveCycles', () => {
  test('confirmed starts delimit cycles; the last cycle is open', () => {
    const cycles = deriveCycles(logs(start('2026-01-01'), start('2026-01-29'), start('2026-02-28')));
    expect(cycles.map((c) => [c.start, c.end, c.length])).toEqual([
      ['2026-01-01', '2026-01-28', 28],
      ['2026-01-29', '2026-02-27', 30],
      ['2026-02-28', null, null],
    ]);
  });

  test('period run covers contiguous period flow plus at most two trailing spotting days', () => {
    const data = logs(
      ...series('2026-03-01', [
        { flow: 'heavy', periodStartConfirmed: true },
        { flow: 'medium' },
        { flow: 'light' },
        { flow: 'spotting' },
        { flow: 'spotting' },
        { flow: 'spotting' },
      ]),
    );
    const [c] = deriveCycles(data);
    expect(c.periodEnd).toBe('2026-03-05');
    expect(c.periodLength).toBe(5);
  });

  test('an unlogged day ends the period run', () => {
    const data = logs(
      ...series('2026-03-01', [{ flow: 'heavy', periodStartConfirmed: true }, { flow: 'medium' }, null, { flow: 'light' }]),
    );
    expect(deriveCycles(data)[0].periodEnd).toBe('2026-03-02');
  });

  test('spotting never starts a cycle, and a duplicate confirmation inside the run is ignored', () => {
    const data = logs(
      log('2026-03-01', { flow: 'spotting', periodStartConfirmed: false }),
      ...series('2026-03-02', [{ flow: 'heavy', periodStartConfirmed: true }, { flow: 'heavy', periodStartConfirmed: true }]),
    );
    const cycles = deriveCycles(data);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].start).toBe('2026-03-02');
    expect(cycles[0].leadingSpottingDays).toBe(1);
  });

  test('a confirmation on a day that continues the current bleed is the same period', () => {
    const data = logs(
      ...series('2026-03-01', [{ flow: 'heavy', periodStartConfirmed: true }, { flow: 'heavy' }]),
      start('2026-03-03'),
    );
    const cycles = deriveCycles(data);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].periodEnd).toBe('2026-03-03');
  });
});

describe('cycle lookup', () => {
  const cycles = deriveCycles(logs(start('2026-01-01'), start('2026-01-29')));

  test('cycleDay is 1-based', () => {
    expect(cycleDay(cycles[0], '2026-01-01')).toBe(1);
    expect(cycleDay(cycles[0], '2026-01-28')).toBe(28);
  });

  test('findCycle returns undefined before the first confirmed start', () => {
    expect(findCycle(cycles, '2025-12-31')).toBeUndefined();
    expect(findCycle(cycles, '2026-01-28')?.index).toBe(0);
    expect(findCycle(cycles, '2026-05-01')?.index).toBe(1);
  });

  test('isInPeriod', () => {
    expect(isInPeriod(cycles[0], '2026-01-01')).toBe(true);
    expect(isInPeriod(cycles[0], '2026-01-02')).toBe(false);
  });
});

test('unconfirmed period-like bleeding is surfaced for confirmation', () => {
  const data = logs(start('2026-01-01'), log('2026-01-27', { flow: 'light' }), log('2026-01-28', { flow: 'medium' }));
  expect(unconfirmedBleedingStarts(data, deriveCycles(data))).toEqual(['2026-01-27']);
});
