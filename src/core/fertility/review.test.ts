// Adversarial review of the fertility engine against docs/fertility-rules.md
// (amendments binding). Every test here FAILS on the engine as reviewed: each
// one demonstrates a deviation from the spec. Severity is in the describe name.

import { addDays } from '../date';
import type { ContextPeriod, ExclusionReason } from '../types';
import { newlyFertileDays } from './diff';
import {
  build,
  dayOf,
  historyCycle,
  hstd,
  mbase,
  reading,
  run,
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

function mucusFrom(from: number, list: DaySpec['m'][]): Record<number, DaySpec> {
  return Object.fromEntries(list.map((m, i) => [from + i, { m }]));
}

/** Standard cycle with the mucus peak moved (same helper as amendments.test.ts). */
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

describe('major: A3.3 sustained rise must apply the A5 lows-median time rule', () => {
  test('a reading between temperature and mucus completion that is > 60 min from the lows median voids the rise', () => {
    // All readings at 05:40 (50 min before the usual 06:30, so VALID). CD20 is at 07:20:
    // 50 min after the usual time (VALID by the setting) but 100 min after the median of
    // the 6 lows, so A5 makes it SUSPECT as a higher reading. A3.3 then voids the CD16
    // candidate, and no later candidate confirms.
    const early = withPeakOn(19, 11).map((s) => ({ ...s, tOpts: { measuredAt: '05:40' } }));
    const current = withDays(early, { 20: { tOpts: { measuredAt: '07:20' } } });
    const r = run(hstdCase(current).data, cd(28));
    expect(r.cycles[1].doubleCheckDate).toBeNull();
    expect(dayOf(r, cd(23)).status).toBe('fertile');
  });
});

describe('major: A4 / A7 a day with several low readings must count as a low', () => {
  test('two consecutive days, each with two readings <= CL, collapse the post-ovulatory phase', () => {
    // A7 makes a multi-reading day SUSPECT only "as a higher reading"; as a low its value is
    // the maximum of its readings (36.45 <= CL 36.50). The engine marks the whole day SUSPECT,
    // so the collapse is never detected and CD20-28 stay infertile.
    const twoLow = (n: number): DaySpec => ({
      readings: [reading(36.45, cd(n)), reading(36.4, cd(n), { measuredAt: '06:40' })],
    });
    const r = run(hstdCase(withDays(standardCycle(), { 20: twoLow(20), 21: twoLow(21) })).data, cd(28));
    expect(dayOf(r, cd(21)).status).toBe('fertile');
    expect(dayOf(r, cd(21)).reasons).toContain('temperature_collapse');
  });
});

describe('major (spec wording "2 consecutive VALID readings"): a skipped day must not hide a collapse', () => {
  test('VALID lows on CD20 and CD22 with no reading on CD21 are 2 consecutive readings <= CL', () => {
    const current = withDays(standardCycle(), { 20: { t: 36.45 }, 21: { t: null }, 22: { t: 36.45 } });
    const r = run(hstdCase(current).data, cd(28));
    expect(dayOf(r, cd(22)).status).toBe('fertile');
    expect(dayOf(r, cd(22)).reasons).toContain('temperature_collapse');
  });
});

describe('major: section 5 "bracketing is never allowed without a reason" must fail closed', () => {
  test.each([
    ['no reason', {}],
    ['an unknown reason', { reason: 'bogus' }],
  ])('a high low bracketed with %s is not dropped from the coverline', (_label, excluded) => {
    // CD13 = 36.58 would hold the coverline at 36.58 (FHM CD17, Exception 1, S = CD20).
    // Honouring an invalid bracket lowers the coverline to 36.50 and gives S = CD18,
    // so CD19-20 are labelled infertile.
    const bracket = { reason: undefined as unknown as ExclusionReason, ...excluded } as { reason: ExclusionReason };
    const current = withDays(standardCycle(), { 13: { t: 36.58, tOpts: { excluded: bracket } } });
    const r = run(hstdCase(current).data, cd(28));
    expect(r.cycles[1].doubleCheckDate).not.toBe(cd(18));
    expect(dayOf(r, cd(19)).status).toBe('fertile');
  });
});

describe('major: section 3 / A16 period flow just before the confirmed CD1 must shorten N', () => {
  test('light flow on the day before the confirmed start counts at least like leading spotting', () => {
    // The previous day had light flow (a possible period start the app asks about). Spotting
    // there would cut N to 4 (A16); light flow leaves N = 5, so the true CD6 (engine CD5) is
    // labelled infertile_pre_ovulatory.
    const previous = withDays(historyCycle(), { 28: { flow: 'light', m: 'NA' } });
    const b = build(START, { previous: [historyCycle(), previous], current: mbase(6) });
    const r = run(b.data, cd(6));
    expect(dayOf(r, cd(5)).status).toBe('fertile');
  });
});

describe('major: A17 the edit diff must cover a withdrawn evening transition', () => {
  test('S shown as "infertile from this evening" and later withdrawn is reported', () => {
    const shown = run(hstdCase(standardCycle(18)).data, cd(18));
    expect(dayOf(shown, cd(18)).eveningTransition).toBe(true);
    // An edit to the CD18 reading moves S to CD19: the evening of CD18 is no longer infertile.
    const edited = run(hstdCase(withDays(standardCycle(19), { 18: { t: 36.45 } })).data, cd(19));
    expect(dayOf(edited, cd(18)).eveningTransition).toBeUndefined();
    expect(newlyFertileDays(shown.days, edited.days)).toContain(cd(18));
  });
});

describe('minor: section 10 reason code for postpartum / breastfeeding locks', () => {
  test('a breastfeeding lock gives reason method_not_supported_postpartum (test case 44)', () => {
    const contexts: ContextPeriod[] = [{ id: 'bf', kind: 'breastfeeding', start: addDays(START, -20), end: cd(10) }];
    const r = run(build(START, { current: standardCycle(), contexts }).data, cd(28));
    expect(dayOf(r, cd(5)).reasons).toContain('method_not_supported_postpartum');
  });
});

describe('minor: section 3 period run (inPeriod badge, A18)', () => {
  test('contiguous bleeding after a spotting day stays in the period run', () => {
    const current: DaySpec[] = [
      { flow: 'heavy', m: 'NA' },
      { flow: 'spotting', m: 'NA' },
      { flow: 'light', m: 'NA' },
      { flow: 'none', m: 't' },
    ];
    const r = run(hstdCase(current).data, cd(4));
    expect([1, 2, 3, 4].map((n) => dayOf(r, cd(n)).inPeriod)).toEqual([true, true, true, false]);
  });

  test('three trailing spotting days all belong to the run', () => {
    const current: DaySpec[] = [
      { flow: 'heavy', m: 'NA' },
      { flow: 'spotting', m: 'NA' },
      { flow: 'spotting', m: 'NA' },
      { flow: 'spotting', m: 'NA' },
      { flow: 'none', m: 't' },
    ];
    const r = run(hstdCase(current).data, cd(5));
    expect([1, 2, 3, 4, 5].map((n) => dayOf(r, cd(n)).inPeriod)).toEqual([true, true, true, true, false]);
  });
});
