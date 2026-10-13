// Every case in docs/fertility-test-cases.json (reconciled_cases 01-29 and
// redteam_cases 30-53). Where an amendment changes the documented outcome, the
// expectation follows the amendment and a comment cites it.
//
// Day codes (see testing.ts): P infertile_pre_ovulatory, I infertile_post_ovulatory,
// F fertile, E fertile with eveningTransition, N not_applicable.

import { addDays, type ISODate } from '../date';
import { parseTemperature } from '../input';
import type { DailyLog, MucusObservation, TemperatureReading } from '../types';
import { log } from '../testing/fixtures';
import { assessMucus, evalMucus, NOT_LOGGED } from './mucus';
import { newlyFertileDays } from './diff';
import {
  build,
  codes,
  dayOf,
  hstd,
  historyCycle,
  localInstant,
  mbase,
  noAnswer,
  obs,
  P,
  reading,
  run,
  seq,
  standardCycle,
  withDays,
  type DaySpec,
  type Scenario,
} from './testing';

const START = '2026-05-01';

/** The standard scenario: Hstd + the given current cycle. */
function hstdCase(current: DaySpec[], extra: Partial<Scenario> = {}) {
  return build(START, { previous: hstd(), current, ...extra });
}

/** Temperatures for cycle days from `from` on. */
function temps(from: number, values: number[]): Record<number, DaySpec> {
  return Object.fromEntries(values.map((t, i) => [from + i, { t }]));
}

function mucusDays(from: number, codesList: DaySpec['m'][]): Record<number, DaySpec> {
  return Object.fromEntries(codesList.map((m, i) => [from + i, { m }]));
}

function repeat<T>(value: T, n: number): T[] {
  return Array.from({ length: n }, () => value);
}

describe('reconciled cases', () => {
  test('01 normal cycle, 5-day rule, regular temperature rule', () => {
    const b = hstdCase(standardCycle(), { next: [{ flow: 'heavy', m: 'NA' }] });
    const r = run(b.data, b.cd(29));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F12 E1 I10'));
    expect([1, 2, 3, 4, 5, 6].map((cd) => dayOf(r, b.cd(cd)).inPeriod)).toEqual([true, true, true, true, true, false]);
    const c = r.cycles[1];
    expect(c.rise).toEqual({ fhmDate: b.cd(16), coverline: 3650, unit: 'C', rule: 'regular', completeDate: b.cd(18) });
    expect(c.mucus).toEqual({ peakDate: b.cd(15), effectivePeakDate: b.cd(15), completeDate: b.cd(18), maxQuality: 4 });
    expect(c.doubleCheckDate).toBe(b.cd(18));
    expect(c.preOvulatoryDays).toBe(5);
    expect(c.firstCycle).toBe(false);
    expect(dayOf(r, b.cd(18)).reasons).toContain('evening_transition');
    expect(dayOf(r, b.cd(19)).reasons).toContain('double_check_complete');
  });

  test('02 third higher reading exactly +0.20 passes', () => {
    const r = run(hstdCase(withDays(standardCycle(), { 18: { t: 36.7 } })).data, addDays(START, 27));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F12 E1 I10'));
    expect(r.cycles[1].rise?.rule).toBe('regular');
  });

  test('03 third higher reading +0.19 fails the regular rule; Exception 1 completes on the 4th', () => {
    const r = run(hstdCase(withDays(standardCycle(), { 18: { t: 36.69 }, 19: { t: 36.75 } })).data, addDays(START, 27));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F13 E1 I9'));
    expect(r.cycles[1].rise).toMatchObject({ rule: 'exception1', completeDate: addDays(START, 18) });
  });

  test('04 first cycle ever: no pre-ovulatory phase and one extra higher reading', () => {
    const b = build(START, { current: standardCycle() });
    const r = run(b.data, b.cd(28));
    expect(codes(r, START, 1, 28)).toBe(seq('F18 E1 I9'));
    expect(r.cycles[0]).toMatchObject({ firstCycle: true, preOvulatoryDays: 0 });
    expect(r.cycles[0].rise?.completeDate).toBe(b.cd(19));
    expect(dayOf(r, b.cd(1)).reasons).toContain('first_cycle');
    // A18: period days are a badge on a fertile day.
    expect(dayOf(r, b.cd(1))).toMatchObject({ status: 'fertile', inPeriod: true });
  });

  test('05 first cycle with Exception 1 needs a 5th higher reading', () => {
    const b = build(START, { current: withDays(standardCycle(), temps(16, [36.6, 36.65, 36.65, 36.6])) });
    expect(codes(run(b.data, b.cd(28)), START, 1, 28)).toBe(seq('F19 E1 I8'));
  });

  test('06 Exception 1 (third higher reading < +0.2, 4th above coverline)', () => {
    const r = run(hstdCase(withDays(standardCycle(), temps(16, [36.6, 36.65, 36.65, 36.6]))).data, addDays(START, 27));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F13 E1 I9'));
    expect(r.cycles[1].rise).toMatchObject({ fhmDate: addDays(START, 15), coverline: 3650, rule: 'exception1' });
  });

  test('07 Exception 1 fails: 4th reading on the coverline; no later shift', () => {
    const current = withDays(standardCycle(21), temps(16, [36.6, 36.65, 36.65, 36.5, 36.55, 36.55]));
    const r = run(hstdCase(current).data, addDays(START, 20));
    expect(codes(r, START, 1, 21)).toBe(seq('P5 F16'));
    expect(r.cycles[1].rise).toBeNull();
    expect(r.cycles[1].doubleCheckDate).toBeNull();
  });

  test('08 Exception 2 (one dip below the coverline, 4th >= +0.2)', () => {
    const r = run(hstdCase(withDays(standardCycle(), temps(16, [36.6, 36.45, 36.65, 36.75]))).data, addDays(START, 27));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F13 E1 I9'));
    expect(r.cycles[1].rise?.rule).toBe('exception2');
  });

  test('09 exceptions cannot be combined; a later FHM confirms', () => {
    const current = withDays(standardCycle(), temps(16, [36.6, 36.45, 36.65, 36.65, 36.7, ...repeat(36.8, 8)]));
    const r = run(hstdCase(current).data, addDays(START, 27));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F15 E1 I7'));
    expect(r.cycles[1].rise).toMatchObject({ fhmDate: addDays(START, 17), coverline: 3660, rule: 'exception1' });
  });

  test('10 reading 0.03 above the coverline counts as a dip', () => {
    const r = run(hstdCase(withDays(standardCycle(), temps(16, [36.6, 36.53, 36.72, 36.7]))).data, addDays(START, 27));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F13 E1 I9'));
    expect(r.cycles[1].rise?.rule).toBe('exception2');
  });

  test('11A fever reading among the lows, bracketed: one gap', () => {
    const current = withDays(standardCycle(), { 13: { t: 37.1, tOpts: { excluded: { reason: 'fever_illness' } } } });
    const r = run(hstdCase(current).data, addDays(START, 27));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F12 E1 I10'));
    expect(r.cycles[1].rise?.coverline).toBe(3650);
  });

  test('11B fever reading among the lows, not bracketed (SUSPECT keeps the coverline high)', () => {
    const current = withDays(standardCycle(), { 13: { t: 37.1, extra: { illness: true } } });
    const r = run(hstdCase(current).data, addDays(START, 27));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F23'));
    expect(r.readings.find((x) => x.date === addDays(START, 12))?.kind).toBe('SUSPECT');
  });

  test('12 bracketed (alcohol) reading inside the higher readings counts as a dip', () => {
    const current = withDays(standardCycle(), { 17: { t: 36.9, tOpts: { excluded: { reason: 'alcohol' } } } });
    const r = run(hstdCase(current).data, addDays(START, 27));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F13 E1 I9'));
    expect(r.cycles[1].rise?.rule).toBe('exception2');
  });

  test('13 off-time measurement cannot serve as a higher reading', () => {
    const current = withDays(standardCycle(), { 18: { tOpts: { measuredAt: '08:00' } } });
    const r = run(hstdCase(current).data, addDays(START, 27));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F13 E1 I9'));
    expect(r.cycles[1].rise?.rule).toBe('exception2');
  });

  test('14 too many missing readings among the lows: no evaluation', () => {
    const current = withDays(standardCycle(), { 11: { t: null }, 12: { t: null }, 13: { t: null } });
    const r = run(hstdCase(current).data, addDays(START, 27));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F23'));
    expect(dayOf(r, addDays(START, 20)).reasons).toContain('waiting_for_temperature_rise');
  });

  test('15 missing mucus entry after the peak moves the effective peak', () => {
    const current = withDays(standardCycle(), { 17: { m: null } });
    const r = run(hstdCase(current).data, addDays(START, 27));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F14 E1 I8'));
    expect(r.cycles[1].mucus.effectivePeakDate).toBe(addDays(START, 16));
  });

  test('16 temperature first, mucus later', () => {
    const current = withDays(standardCycle(), mucusDays(11, ['f', 'S', 'S', ...repeat<DaySpec['m']>('S+', 7), 'S', 'f', 'Ø']));
    const r = run(hstdCase(current).data, addDays(START, 27));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F17 E1 I5'));
    expect(r.cycles[1].mucus.peakDate).toBe(addDays(START, 19));
    // A3.2: the CD16 rise is 4 days before the CD20 peak, so the paired rise is the CD17 candidate.
    expect(r.cycles[1].rise?.fhmDate).toBe(addDays(START, 16));
  });

  test('17 mucus complete but no temperature shift; next cycle loses the 5-day rule', () => {
    const alternating = Array.from({ length: 15 }, (_, i) => (i % 2 === 0 ? 36.45 : 36.5));
    const current = withDays(mbase(30).map((s, i) => ({ ...s, t: P15(i) })), temps(16, alternating));
    const next: DaySpec[] = [...mbase(5), ...repeat<DaySpec>({ flow: 'none', m: 't' }, 5)];
    const b = hstdCase(current, { next });
    const r = run(b.data, addDays(START, 39));
    expect(codes(r, START, 1, 30)).toBe(seq('P5 F25'));
    expect(codes(r, addDays(START, 30), 1, 10)).toBe(seq('F10'));
    expect(r.cycles[2].preOvulatoryDays).toBe(0);
    expect(dayOf(r, addDays(START, 30)).reasons).toContain('previous_cycle_not_qualifying');
  });

  test('18 best mucus is only f: no peak, no post-ovulatory phase', () => {
    const current = withDays(standardCycle(), { ...mucusDays(11, repeat<DaySpec['m']>('f', 5)), ...mucusDays(16, repeat<DaySpec['m']>('t', 13)) });
    const b = hstdCase(current, { next: mbase(6) });
    const r = run(b.data, addDays(START, 33));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F23'));
    expect(r.cycles[1].mucus).toMatchObject({ maxQuality: 2, peakDate: null });
    expect(codes(r, addDays(START, 28), 1, 6)).toBe(seq('F6'));
  });

  test('19 fertile mucus ends the 5-day rule early', () => {
    const current = withDays(mbase(6), {
      4: { flow: 'light', m: 'f', mOpts: { appearance: undefined } },
      5: { flow: 'none', m: 't' },
    });
    const r = run(hstdCase(current).data, addDays(START, 5));
    expect(codes(r, START, 1, 5)).toBe('PPPFF');
    expect(dayOf(r, addDays(START, 3))).toMatchObject({ status: 'fertile', inPeriod: true });
    expect(dayOf(r, addDays(START, 3)).reasons).toContain('fertile_sign_observed');
  });

  test('20A 5-day rule with a missing day', () => {
    const current = withDays(mbase(5), { 4: null, 5: { flow: 'none', m: 't' } });
    const r = run(hstdCase(current).data, addDays(START, 4));
    expect(codes(r, START, 1, 5)).toBe('PPPFF');
    expect(dayOf(r, addDays(START, 3)).reasons).toContain('missing_observation');
  });

  test('20B 5-day rule with a provisional entry', () => {
    const cd2 = addDays(START, 1);
    const provisional = {
      mOpts: { observationComplete: false, completedAt: undefined, enteredAt: localInstant(cd2, '07:00'), updatedAt: localInstant(cd2, '07:00') },
    };
    const current = withDays(mbase(5), { 2: provisional, 5: { flow: 'light', m: 'NA' } });
    const later = run(hstdCase(current).data, addDays(START, 4));
    expect(codes(later, START, 1, 5)).toBe('PFFFF');
    const sameDay = run(hstdCase(current.slice(0, 2)).data, cd2);
    expect(dayOf(sameDay, cd2).status).toBe('fertile');
    expect(dayOf(sameDay, cd2).reasons).toContain('awaiting_evening_observation');
  });

  test('21 minus-8 shortens the phase (early FHM in an earlier cycle)', () => {
    const current = withDays(mbase(6), { 5: { flow: 'light', m: 'NA' } });
    const b = build(START, { previous: [historyCycle(12), historyCycle(15)], current });
    const r = run(b.data, b.cd(6));
    expect(codes(r, START, 1, 6)).toBe('PPPPFF');
    expect(r.cycles[2].preOvulatoryDays).toBe(4);
  });

  const case22Current = withDays(mbase(28), { 7: { m: 'Ø' } });

  test('22A minus-8 lengthens with 12 double-checked cycles', () => {
    const b = build(START, { previous: hstd(12), current: case22Current });
    const r = run(b.data, b.cd(10));
    expect(codes(r, START, 1, 8)).toBe(seq('P7 F1'));
    expect(r.cycles[12].preOvulatoryDays).toBe(7);
  });

  test('22B with only 11 double-checked cycles the 5-day rule applies', () => {
    const b = build(START, { previous: hstd(11), current: case22Current });
    expect(codes(run(b.data, b.cd(10)), START, 1, 8)).toBe(seq('P5 F3'));
  });

  test('23 a temperature-only early FHM in history blocks lengthening', () => {
    const noMucus = historyCycle(13).map((s) => ({ ...s, m: null }));
    const b = build(START, { previous: [noMucus, ...hstd(12)], current: case22Current });
    const r = run(b.data, b.cd(10));
    expect(codes(r, START, 1, 8)).toBe(seq('P5 F3'));
    expect(r.cycles[13].preOvulatoryDays).toBe(5);
  });

  test('24 bleeding on day 6 inside a 7-day minus-8 window', () => {
    const current = withDays(mbase(7), { 5: { flow: 'light', m: 'NA' }, 6: { flow: 'light', m: 'NA' }, 7: { flow: 'none', m: 't' } });
    const b = build(START, { previous: hstd(12), current });
    const r = run(b.data, b.cd(7));
    expect(codes(r, START, 1, 7)).toBe('PPPPPFF');
    expect(dayOf(r, b.cd(6)).reasons).toContain('bleeding_hides_mucus');
  });

  test('25 previous cycle without a double check disables the pre-ovulatory phase despite 12 good cycles', () => {
    const fOnly = historyCycle(15).map((s) => (s.m === 'S' || s.m === 'S+' ? { ...s, m: 'f' as const } : s));
    const b = build(START, { previous: [...hstd(12), fOnly], current: standardCycle() });
    const r = run(b.data, b.cd(28));
    expect(codes(r, START, 1, 28)).toBe(seq('F17 E1 I10'));
    expect(r.cycles[13]).toMatchObject({ firstCycle: false, preOvulatoryDays: 0 });
  });

  test('26 fertile mucus returns after the post-ovulatory confirmation', () => {
    const current = withDays(standardCycle(), { 22: { m: 'S+' }, 23: { m: 'S' } });
    const r = run(hstdCase(current).data, addDays(START, 27));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F12 E1 I3 F3 E1 I3'));
    expect(dayOf(r, addDays(START, 21)).reasons).toEqual(['fertile_mucus_after_confirmation']);
  });

  describe('27 hormonal contraception, then the first natural cycle', () => {
    const pillDays: DailyLog[] = Array.from({ length: 28 }, (_, i) =>
      log(addDays('2026-03-01', i), { temperatures: [reading(36.7, addDays('2026-03-01', i))], flow: 'none' }),
    );
    const contexts = [{ id: 'pill', kind: 'hormonal_contraception' as const, start: '2026-03-01', end: '2026-03-28' }];

    test('pill days are not applicable; cycle 1 follows first-cycle rules', () => {
      const b = build('2026-03-31', { current: standardCycle(), contexts, extraLogs: pillDays });
      const r = run(b.data, b.cd(28));
      expect(codes(r, '2026-03-01', 1, 30)).toBe(seq('N28 F2'));
      expect(dayOf(r, '2026-03-29').reasons).toEqual(['cycle_start_unknown']);
      expect(dayOf(r, '2026-03-01').reasons).toEqual(['context_not_applicable', 'cycle_start_unknown']);
      expect(codes(r, '2026-03-31', 1, 28)).toBe(seq('F18 E1 I9'));
      expect(dayOf(r, '2026-04-18').eveningTransition).toBe(true);
      expect(dayOf(r, '2026-04-19').status).toBe('infertile_post_ovulatory');
    });

    test('A13: answering "hormonal contraception since the last period" locks the cycle', () => {
      const answers = [{ ...noAnswer('2026-03-31'), hormonalContraceptionSinceLastPeriod: true }];
      const b = build('2026-03-31', { current: standardCycle(), contexts, extraLogs: pillDays, answers });
      const r = run(b.data, b.cd(28));
      expect(codes(r, '2026-03-31', 1, 28)).toBe(seq('F28'));
      expect(dayOf(r, '2026-04-20').reasons).toEqual(['cycle_locked_context']);
    });
  });

  describe('28 Fahrenheit thresholds (0.36 °F rise, 0.09 °F above)', () => {
    const lowsF = [97.52, 97.4, 97.45, 97.4, 97.52, 97.45, 97.4, 97.45, 97.52, 97.4, 97.45, 97.4, 97.52, 97.45, 97.4];
    const cycleF = (cd18: number) =>
      mbase(28).map((s, i) => ({ ...s, t: i < 15 ? lowsF[i] : ([97.7, 97.75, cd18][i - 15] ?? 97.8) }));

    test('+0.36 °F completes the regular rule', () => {
      const r = run(hstdCase(cycleF(97.88), { unit: 'F' }).data, addDays(START, 27));
      expect(codes(r, START, 1, 28)).toBe(seq('P5 F12 E1 I10'));
      expect(r.cycles[1].rise).toMatchObject({ coverline: 9752, unit: 'F', rule: 'regular' });
    });

    test('+0.35 °F fails the regular rule; Exception 1 completes', () => {
      const r = run(hstdCase(cycleF(97.87), { unit: 'F' }).data, addDays(START, 27));
      expect(codes(r, START, 1, 28)).toBe(seq('P5 F13 E1 I9'));
      expect(r.cycles[1].rise?.rule).toBe('exception1');
    });
  });

  test('29 route change within the cycle blocks the temperature evaluation', () => {
    const current = withDays(standardCycle(), { 17: { tOpts: { route: 'vaginal' } } });
    const b = hstdCase(current, { next: mbase(3) });
    const r = run(b.data, addDays(START, 30));
    // A13 "a blocked temperature only prevents post-ovulatory infertility": CD1-5 keep the 5-day rule.
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F23'));
    expect(r.cycles[1].temperatureBlocked).toBe('temperature_blocked_mixed_measurements');
    expect(dayOf(r, addDays(START, 10)).reasons).toContain('temperature_blocked_mixed_measurements');
    expect(codes(r, addDays(START, 28), 1, 3)).toBe('FFF');
  });
});

describe('red-team cases', () => {
  test('30A unconfirmed spotting and low temperatures after S end the infertile phase', () => {
    const spotting = (t?: number): DaySpec => ({ flow: 'spotting', t: t ?? null, m: null });
    const current = withDays(standardCycle(), { 29: spotting(36.4), 30: spotting(36.4), 31: spotting(36.4), 32: spotting(), 33: spotting() });
    const r = run(hstdCase(current).data, addDays(START, 49));
    expect(codes(r, START, 1, 50)).toBe(seq('P5 F12 E1 I10 F22'));
    expect(dayOf(r, addDays(START, 28)).reasons).toEqual(['possible_new_cycle', 'temperature_drop']);
    expect(r.cycles[1].postOvulatoryEnd).toEqual({ date: addDays(START, 28), reason: 'possible_new_cycle' });
    expect(r.days[r.days.length - 1].date).toBe(addDays(START, 49));
  });

  test('30B no entries after CD28: the FHM + 19 cap ends the phase', () => {
    const r = run(hstdCase(standardCycle()).data, addDays(START, 39));
    expect(codes(r, START, 1, 41)).toBe(seq('P5 F12 E1 I16 F6 -1'));
    expect(dayOf(r, addDays(START, 34)).reasons).toEqual(['luteal_phase_too_long']);
  });

  test('31 mucus Q is never NaN (no-contribution inputs)', () => {
    const current = withDays(mbase(5), {
      4: { flow: 'none', m: null, mucus: undefined, mOpts: undefined },
      5: { flow: 'none', m: 't' },
    });
    current[3] = {
      flow: 'none',
      mucus: obs('t', addDays(START, 3), { sensation: 'slippery', appearance: 'nothing', color: 'none', stretchy: false }),
    };
    const r = run(hstdCase(current).data, addDays(START, 4));
    expect(codes(r, START, 1, 5)).toBe('PPPFF');
    expect(r.readings.find((x) => x.date === addDays(START, 3))?.mucusQuality).toBe(4);
  });

  test('31 property: every combination gives an integer 0..4 or UNKNOWN', () => {
    const sensations = ['dry', 'nothing', 'moist', 'wet', 'slippery', undefined] as const;
    const appearances = ['nothing', 'sticky', 'creamy', 'watery', 'egg_white', undefined] as const;
    const colors = ['none', 'white', 'cream', 'yellowish', 'cloudy', 'clear', 'blood_tinged', 'green_grey', undefined] as const;
    const notAssessable = [undefined, 'bleeding', 'possible_infection', 'vaginal_medication', 'semen', 'lubricant'] as const;
    let count = 0;
    const bad: string[] = [];
    for (const sensation of sensations)
      for (const appearance of appearances)
        for (const color of colors)
          for (const stretchy of [true, false, undefined])
            for (const unsure of [true, false, undefined])
              for (const na of notAssessable)
                for (const complete of [true, false])
                  for (const recalled of [true, false]) {
                    const o: MucusObservation = { sensation, appearance, color, stretchy, unsure, notAssessable: na, observationComplete: complete, enteredAt: '', updatedAt: '' };
                    const q = assessMucus(o, { complete, recalled }).quality;
                    count++;
                    if (q !== null && !(Number.isInteger(q) && q >= 0 && q <= 4)) bad.push(`${q} for ${JSON.stringify(o)}`);
                  }
    expect(bad).toEqual([]);
    expect(count).toBe(6 * 6 * 9 * 3 * 3 * 6 * 2 * 2);
  });

  test('31 evalMucus on a cycle where every entry has missing fields returns NONE', () => {
    const days = Array.from({ length: 28 }, () => assessMucus({ observationComplete: true, enteredAt: '', updatedAt: '' }, { complete: true, recalled: false }));
    expect(evalMucus(days, 28)).toEqual({ status: 'NONE', maxQuality: null });
    expect(evalMucus([NOT_LOGGED, NOT_LOGGED], 2).status).toBe('NONE');
  });

  test('32 early mucus patch plus a false temperature rise must not double-check (A3)', () => {
    const t = [...P, 36.6, 36.65, 36.7, ...repeat(36.45, 5), 36.6, 36.65, ...repeat(36.75, 14)];
    const fromCD6: DaySpec['m'][] = [
      't', 'f', 'S+', 'S+', 'S', 'f', ...repeat<DaySpec['m']>('t', 9), 'f', 'S', 'S', 'S', 'Ø', ...repeat<DaySpec['m']>('t', 14),
    ];
    const current = mbase(39).map((s, i) => ({ ...s, t: t[i], m: i < 5 ? s.m : fromCD6[i - 5] }));
    const b = hstdCase(current, { next: [{ flow: 'heavy', m: 'NA' }] });
    const r = run(b.data, b.cd(40));
    // The spec without A3 gave S = CD18. A3.1 resets the peak to CD24; A3.2/A3.3 void the CD16 rise.
    expect(codes(r, START, 1, 39)).toBe(seq('P5 F22 E1 I11'));
    expect(r.cycles[1].rise).toMatchObject({ fhmDate: b.cd(25), coverline: 3660, rule: 'exception1', completeDate: b.cd(28) });
    expect(r.cycles[1].mucus.effectivePeakDate).toBe(b.cd(24));
  });

  test('33 temperature collapse before late mucus completion (A3.3)', () => {
    const current = withDays(
      withDays(standardCycle(), temps(16, [36.6, 36.65, 36.75, 36.45, 36.45, 36.45])),
      mucusDays(11, ['f', 'S', 'S', ...repeat<DaySpec['m']>('S+', 7), 'S', 'f', 'Ø']),
    );
    const r = run(hstdCase(current).data, addDays(START, 27));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F23'));
    expect(r.cycles[1].doubleCheckDate).toBeNull();
  });

  test('34A missing measurement times make the readings SUSPECT (A5)', () => {
    const noTime = { tOpts: { measuredAt: undefined as unknown as string } };
    const b = build(START, { current: withDays(standardCycle(), { 17: noTime, 18: noTime }) });
    const r = run(b.data, b.cd(28));
    expect(codes(r, START, 1, 28)).toBe(seq('F28'));
    expect(r.readings.filter((x) => x.kind === 'SUSPECT').map((x) => x.date)).toEqual([b.cd(17), b.cd(18)]);
  });

  test('34B no usual measurement time blocks evaluation (A5)', () => {
    const b = build(START, { current: standardCycle(), settings: { usualMeasurementTimes: [] } });
    const r = run(b.data, b.cd(28));
    expect(codes(r, START, 1, 28)).toBe(seq('F28'));
    expect(r.cycles[0].temperatureBlocked).toBe('set_usual_measurement_time');
    expect(dayOf(r, b.cd(20)).reasons).toContain('set_usual_measurement_time');
  });

  test('35 a later measurement time after a settings change (A5)', () => {
    const at = (time: string) => (s: DaySpec): DaySpec => ({ ...s, tOpts: { measuredAt: time } });
    const current = standardCycle().map((s, i) => at(i < 15 ? '06:00' : '07:30')(s));
    const b = build(START, {
      previous: [historyCycle().map(at('06:00'))],
      current,
      settings: { usualMeasurementTimes: [{ effectiveFrom: '2000-01-01', time: '06:00' }, { effectiveFrom: addDays(START, 15), time: '07:30' }] },
    });
    const r = run(b.data, b.cd(28));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F23'));
    expect(r.cycles[1].rise).toBeNull();
  });

  describe('36 DST fall-back makes post-change readings suspect (A6)', () => {
    function dstCase(cd1: ISODate, before: number, after: number) {
      const offsetOn = (date: ISODate) => (date < addDays(cd1, 16) ? before : after);
      const withOffsets = (start: ISODate, specs: DaySpec[]) =>
        specs.map((s, i) => ({ ...s, tOpts: { utcOffsetMinutes: offsetOn(addDays(start, i)) } }));
      const prevStart = addDays(cd1, -28);
      const b = build(cd1, {
        previous: [withOffsets(prevStart, historyCycle())],
        current: withOffsets(cd1, standardCycle()),
        mucusOffset: after,
      });
      return { b, r: run(b.data, b.cd(28), after) };
    }

    test('Europe/Berlin, CD17 = 2026-10-25', () => {
      const { b, r } = dstCase('2026-10-09', 120, 60);
      expect(b.cd(17)).toBe('2026-10-25');
      expect(codes(r, '2026-10-09', 1, 28)).toBe(seq('P5 F23'));
      expect(r.readings.filter((x) => x.kind === 'SUSPECT').map((x) => x.date)).toEqual(['2026-10-25', '2026-10-26', '2026-10-27']);
    });

    test('America/New_York, CD17 = 2026-11-01', () => {
      const { b, r } = dstCase('2026-10-16', -240, -300);
      expect(b.cd(17)).toBe('2026-11-01');
      expect(codes(r, '2026-10-16', 1, 28)).toBe(seq('P5 F23'));
      expect(r.readings.filter((x) => x.kind === 'SUSPECT').map((x) => x.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    });
  });

  describe('37 calendar-date arithmetic across DST', () => {
    test.each([
      ['2026-10-25', { '2026-10-29': 'P', '2026-10-30': 'F' }],
      ['2026-03-28', { '2026-03-30': 'P', '2026-04-01': 'P', '2026-04-02': 'F' }],
    ] as const)('CD1 = %s', (cd1, expected) => {
      const b = build(cd1, { previous: hstd(), current: mbase(6) });
      const r = run(b.data, b.cd(6));
      expect(codes(r, cd1, 1, 6)).toBe('PPPPPF');
      for (const [date, code] of Object.entries(expected)) {
        const day = dayOf(r, date);
        expect(day.status === 'fertile' ? 'F' : 'P').toBe(code);
      }
      expect(dayOf(r, cd1 === '2026-03-28' ? '2026-03-30' : '2026-10-29').cycleDay).toBe(cd1 === '2026-03-28' ? 3 : 5);
    });
  });

  test('38 decimal comma input is stored from its digits', () => {
    // Parsing is the input layer (src/core/input.ts); the engine only sees integers.
    expect(parseTemperature('36,50', 'C', 0.01)).toEqual({ ok: true, value: 3650 });
    expect(parseTemperature('36,555', 'C', 0.01).ok).toBe(false);
    const short = parseTemperature('36,5', 'C', 0.01);
    expect(!short.ok || short.value === 3650).toBe(true);

    const comma = (t: number): Partial<TemperatureReading> => ({ raw: t.toFixed(2).replace('.', ',') });
    const current = standardCycle().map((s, i) => (i < 15 ? { ...s, tOpts: comma(s.t as number) } : s));
    const r = run(hstdCase(current).data, addDays(START, 27));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F12 E1 I10'));

    // Fail closed if a reading's stored value does not match what was typed (the parseFloat('36,50') = 36 bug).
    const corrupted = withDays(current, { 3: { readings: [reading(36.0, addDays(START, 2), { raw: '36,45' })] } });
    const blocked = run(hstdCase(corrupted).data, addDays(START, 27));
    expect(codes(blocked, START, 1, 28)).toBe(seq('P5 F23'));
    expect(blocked.cycles[1].temperatureBlocked).toBe('temperature_blocked_mixed_measurements');
  });

  test('39 °F evaluation is never done on rounded °C (A8)', () => {
    const lows = [97.54, 97.4, 97.45, 97.4, 97.54, 97.45, 97.4, 97.45, 97.54, 97.4, 97.45, 97.4, 97.54, 97.45, 97.4];
    const current = mbase(28).map((s, i) => ({ ...s, t: i < 15 ? lows[i] : i === 15 ? 97.62 : i === 16 ? 97.63 : 97.89 }));
    const r = run(hstdCase(current, { unit: 'F' }).data, addDays(START, 27));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F15 E1 I7'));
    expect(r.cycles[1].rise).toMatchObject({ fhmDate: addDays(START, 17), coverline: 9763, unit: 'F', rule: 'exception1' });
  });

  test('40 a SUSPECT low must not push a higher low out of the coverline (A9)', () => {
    const t = [...P.slice(0, 8), 36.58, 36.4, 36.45, 36.4, 36.48, 36.45, 36.2, 36.55, 36.58, 36.7, ...repeat(36.75, 10)];
    const current = mbase(28).map((s, i) => ({ ...s, t: t[i], tOpts: i === 14 ? { measuredAt: '05:00' } : undefined }));
    const r = run(hstdCase(current).data, addDays(START, 27));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F15 E1 I7'));
    expect(r.cycles[1].rise).toMatchObject({ fhmDate: addDays(START, 17), coverline: 3658, rule: 'exception1' });
  });

  test('41 an incomplete fertile-sign entry cannot certify P+3 (A10)', () => {
    const cd18 = addDays(START, 17);
    const current = withDays(standardCycle(), {
      18: { m: 'f', mOpts: { observationComplete: false, completedAt: undefined, enteredAt: localInstant(cd18, '08:00'), updatedAt: localInstant(cd18, '08:00') } },
    });
    const r = run(hstdCase(current).data, addDays(START, 27));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F15 E1 I7'));
    expect(r.cycles[1].mucus.effectivePeakDate).toBe(cd18);
  });

  test('42 period-only history still means a first charted cycle (A11)', () => {
    const bleedingOnly: DaySpec[] = withDays(
      [{ flow: 'heavy' }, { flow: 'heavy' }, { flow: 'medium' }, { flow: 'light' }],
      Object.fromEntries(Array.from({ length: 24 }, (_, i) => [5 + i, null])),
    );
    const b = build(START, { previous: repeat(bleedingOnly, 6), current: standardCycle() });
    const r = run(b.data, b.cd(28));
    expect(codes(r, START, 1, 28)).toBe(seq('F18 E1 I9'));
    expect(r.cycles[6]).toMatchObject({ firstCycle: true, preOvulatoryDays: 0, doubleCheckDate: b.cd(19) });
  });

  test('43 a bleed too soon after the previous FHM gets no 5-day rule (A12)', () => {
    const b = build(START, { previous: [historyCycle(), standardCycle(21)], current: mbase(6) });
    const r = run(b.data, b.cd(6));
    expect(r.cycles[1].doubleCheckDate).toBe(addDays(b.starts[1], 17));
    expect(codes(r, START, 1, 6)).toBe('FFFFFF');
    expect(r.cycles[2].preOvulatoryDays).toBe(0);
  });

  test('44 a lock ending mid-cycle leaves the cycle without infertile days (A13)', () => {
    const contexts = [{ id: 'bf', kind: 'breastfeeding' as const, start: addDays(START, -20), end: addDays(START, 9) }];
    const b = build(START, { current: standardCycle(), next: standardCycle(), contexts });
    const next = addDays(START, 28);
    const r = run(b.data, addDays(next, 27));
    expect(codes(r, START, 1, 28)).toBe(seq('F28'));
    // Section 10 / test case 44: the breastfeeding days carry method_not_supported_postpartum,
    // the rest of the affected cycle the general lock reason.
    expect(dayOf(r, b.cd(5)).reasons).toEqual(['method_not_supported_postpartum']);
    expect(dayOf(r, b.cd(10)).reasons).toEqual(['method_not_supported_postpartum']);
    expect(dayOf(r, b.cd(11)).reasons).toEqual(['cycle_locked_context']);
    expect(dayOf(r, b.cd(20)).reasons).toEqual(['cycle_locked_context']);
    expect(r.cycles[0].locked).toBe(true);
    expect(codes(r, next, 1, 28)).toBe(seq('F18 E1 I9'));
    expect(r.cycles[1]).toMatchObject({ firstCycle: true, preOvulatoryDays: 0, doubleCheckDate: addDays(next, 18) });
  });

  test('45 "unsure" on a dry day closes the pre-ovulatory phase (A14)', () => {
    const current = withDays(mbase(5), { 5: { flow: 'none', m: 't', mOpts: { unsure: true } } });
    const r = run(hstdCase(current).data, addDays(START, 4));
    expect(codes(r, START, 1, 5)).toBe('PPPPF');
    expect(dayOf(r, addDays(START, 4)).reasons).toContain('fertile_sign_observed');
  });

  test('46 recalled entries do not open infertile days, and revisions alert (A10, A17)', () => {
    const cd = (n: number) => addDays(START, n - 1);
    const recalledAt = localInstant(cd(5), '20:00');
    const recalled = { m: 't' as const, flow: 'none' as const, mOpts: { completedAt: recalledAt, enteredAt: recalledAt, updatedAt: recalledAt } };
    const current: DaySpec[] = [...mbase(2), recalled, recalled, { flow: 'none', m: 't' }];
    const shown = run(hstdCase(current).data, cd(5));
    expect(codes(shown, START, 1, 5)).toBe('PPFFF');

    const editedAt = localInstant(cd(6), '09:00');
    const edited = withDays([...current, { flow: 'none', m: 't' }], {
      2: { m: 'f', mOpts: { appearance: undefined, updatedAt: editedAt }, extra: { intercourse: 'unprotected' } },
    });
    const b = hstdCase(edited);
    const after = run(b.data, cd(6));
    expect(dayOf(after, cd(2)).status).toBe('fertile');
    const alert = newlyFertileDays(shown.days, after.days);
    expect(alert).toEqual([cd(2)]);
    expect(alert.filter((d) => b.data.logs[d]?.intercourse === 'unprotected')).toEqual([cd(2)]);
  });

  test('47 after-midnight entry and early completion (A10)', () => {
    const cd = (n: number) => addDays(START, n - 1);
    const lateNight = localInstant(cd(4), '00:30');
    const base: DaySpec[] = [
      ...mbase(2),
      { flow: 'medium', m: 't', mOpts: { completedAt: lateNight, enteredAt: lateNight, updatedAt: lateNight } },
    ];
    const morning = localInstant(cd(4), '07:00');
    const early = run(hstdCase([...base, { flow: 'light', m: 't', mOpts: { completedAt: morning, updatedAt: morning } }]).data, cd(4));
    expect(codes(early, START, 1, 4)).toBe('PPPF');
    expect(dayOf(early, cd(4)).reasons).toContain('awaiting_evening_observation');

    const at = (time: string) => localInstant(cd(4), time);
    const almost = run(hstdCase([...base, { flow: 'light', m: 't', mOpts: { completedAt: at('17:59'), updatedAt: at('17:59') } }]).data, cd(4));
    expect(codes(almost, START, 1, 4)).toBe('PPPF');
    const evening = run(hstdCase([...base, { flow: 'light', m: 't', mOpts: { completedAt: at('18:00'), updatedAt: at('18:00') } }]).data, cd(4));
    expect(codes(evening, START, 1, 4)).toBe('PPPP');
  });

  test('48 compatiblePre strictness on bleeding days (A15)', () => {
    const current: DaySpec[] = [
      { flow: 'heavy', m: 'NA' },
      { flow: 'light', m: 'NA', mOpts: { notAssessable: 'semen' } },
      { mucus: obs('t', addDays(START, 2), { sensation: undefined, appearance: undefined }) },
    ];
    const r = run(hstdCase(current).data, addDays(START, 2));
    expect(codes(r, START, 1, 3)).toBe('PFF');
  });

  test('49 imported temperatures without metadata block evaluation', () => {
    const imported = { tOpts: { route: undefined as unknown as 'oral', thermometerId: '' } };
    const b = hstdCase(withDays(standardCycle(), { 16: imported, 17: imported, 18: imported }), { next: mbase(3) });
    const r = run(b.data, addDays(START, 30));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F23'));
    expect(r.cycles[1].temperatureBlocked).toBe('temperature_blocked_mixed_measurements');
    expect(codes(r, addDays(START, 28), 1, 3)).toBe('FFF');
  });

  test('50 one-decimal readings on a two-decimal profile block evaluation (A8)', () => {
    const t = [...Array.from({ length: 15 }, (_, i) => (i % 2 === 0 ? 36.4 : 36.5)), 36.6, 36.7, ...repeat(36.8, 11)];
    const r = run(hstdCase(mbase(28).map((s, i) => ({ ...s, t: t[i] }))).data, addDays(START, 27));
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F23'));
    expect(r.cycles[1].temperatureBlocked).toBe('temperature_blocked_low_resolution');
  });

  test('51 a short uncharted cycle shortens N (A16 pseudo-FHM)', () => {
    const short = Array.from({ length: 21 }, (_, i): DaySpec => ({
      ...(mbase(21)[i]),
      t: i >= 7 && i <= 13 ? null : P[i % 15],
      m: i < 4 ? 'NA' : 't',
    }));
    const current = withDays(mbase(6), { 5: { flow: 'light', m: 'NA' } });
    const b = build(START, { previous: [short, historyCycle(), historyCycle()], current });
    const r = run(b.data, b.cd(6));
    expect(codes(r, START, 1, 6)).toBe('FFFFFF');
    expect(r.cycles[3].preOvulatoryDays).toBe(0);
  });

  test('52 re-confirmation needs the cycle\'s own route (A19)', () => {
    const vaginal = { t: 36.85, tOpts: { route: 'vaginal' as const } };
    const current = withDays(standardCycle(), { 22: { m: 'S+', ...vaginal }, 23: { m: 'S', ...vaginal }, 24: vaginal, 25: vaginal });
    const r = run(hstdCase(current).data, addDays(START, 27));
    expect(codes(r, START, 22, 28)).toBe(seq('F7'));
    expect(dayOf(r, addDays(START, 24)).eveningTransition).toBeUndefined();
    // A8 blocks temperature evaluation for the whole cycle once it mixes routes, so the
    // CD19-21 infertile days from before the route change are withdrawn as well (stricter than the case text).
    expect(codes(r, START, 1, 28)).toBe(seq('P5 F23'));
  });

  test('53 a reopened-unresolved cycle does not count toward 12 (A16)', () => {
    const reopened = withDays(historyCycle(), { 26: { m: 'S+' }, 27: { m: 'S+' }, 28: { m: 'S+' } });
    const previous = hstd(12);
    previous[5] = reopened;
    const b = build(START, { previous, current: case22CurrentCopy() });
    const r = run(b.data, b.cd(10));
    expect(codes(r, START, 1, 8)).toBe(seq('P5 F3'));
    expect(r.cycles[12].preOvulatoryDays).toBe(5);
  });
});

// ------------------------------------------------------------------ helpers

function P15(i: number): number | null {
  return i < 15 ? P[i] : null;
}

function case22CurrentCopy(): DaySpec[] {
  return withDays(mbase(28), { 7: { m: 'Ø' } });
}
