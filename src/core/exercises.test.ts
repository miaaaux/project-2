import { addDays, type ISODate } from './date';
import {
  EXERCISE_SAFETY_NOTES,
  EXERCISES,
  exerciseDaysPerWeek,
  ROUTINES,
  suggestRoutines,
  WEEKLY_EXERCISE_DAYS_GOAL,
  type ExercisePhase,
} from './exercises';
import { EXERCISE_DAYS_PER_WEEK_TARGET, MIN_EXERCISE_MINUTES } from './painGuide';
import type { ExerciseSession } from './types';

let seq = 0;
function session(date: ISODate, minutes: number, partial: Partial<ExerciseSession> = {}): ExerciseSession {
  seq += 1;
  return { id: `s${seq}`, date, kind: 'aerobic', minutes, exerciseIds: [], ...partial };
}

const routine = (id: string) => {
  const r = ROUTINES.find((x) => x.id === id);
  if (!r) throw new Error(`no routine ${id}`);
  return r;
};
const exercise = (id: string) => {
  const e = EXERCISES.find((x) => x.id === id);
  if (!e) throw new Error(`no exercise ${id}`);
  return e;
};
const ids = (routines: { id: string }[]) => routines.map((r) => r.id);

function allExerciseStrings(): string[] {
  return [
    ...EXERCISES.flatMap((e) => [e.name, e.dose, ...e.steps, ...e.cautions, e.evidence.summary, ...e.evidence.sources]),
    ...ROUTINES.flatMap((r) => [r.name, r.schedule, r.basedOn]),
    ...EXERCISE_SAFETY_NOTES,
  ];
}

describe('exercise library', () => {
  it('has the 10 exercises of SPEC §8 with stable ids', () => {
    // These ids are stored in sessions and "made it worse" flags: never rename them.
    expect(EXERCISES.map((e) => e.id)).toEqual([
      'cobra',
      'cat-cow',
      'supported-fish',
      'pelvic-tilt',
      'butterfly',
      'glute-bridge',
      'modified-plank',
      'squat-heel-raise',
      'pmr',
      'brisk-walk',
    ]);
  });

  it('groups exercises by kind as in the spec', () => {
    const byKind = (kind: string) => EXERCISES.filter((e) => e.kind === kind).map((e) => e.id);
    expect(byKind('yoga')).toEqual(['cobra', 'cat-cow', 'supported-fish']);
    expect(byKind('stretch')).toEqual(['pelvic-tilt', 'butterfly']);
    expect(byKind('strength')).toEqual(['glute-bridge', 'modified-plank', 'squat-heel-raise']);
    expect(byKind('relaxation')).toEqual(['pmr']);
    expect(byKind('aerobic')).toEqual(['brisk-walk']);
  });

  it('gives every exercise steps, a dose, cautions and evidence with sources', () => {
    for (const e of EXERCISES) {
      expect(e.steps.length).toBeGreaterThan(0);
      expect(e.dose.length).toBeGreaterThan(0);
      expect(e.cautions.length).toBeGreaterThan(0);
      expect(e.evidence.summary.length).toBeGreaterThan(0);
      expect(e.evidence.sources.length).toBeGreaterThan(0);
    }
  });

  it('keeps honest evidence labels', () => {
    const quality = Object.fromEntries(EXERCISES.map((e) => [e.id, e.evidence.quality]));
    expect(quality).toEqual({
      cobra: 'low',
      'cat-cow': 'low',
      'supported-fish': 'low',
      'pelvic-tilt': 'indirect',
      butterfly: 'indirect',
      'glute-bridge': 'indirect',
      'modified-plank': 'indirect',
      'squat-heel-raise': 'indirect',
      pmr: 'low',
      'brisk-walk': 'low',
    });
    for (const e of EXERCISES.filter((x) => x.evidence.quality === 'indirect')) {
      expect(e.evidence.summary).toMatch(/^Indirect/);
    }
  });

  it('has no pelvic-floor strengthening (Kegel) exercise', () => {
    for (const e of EXERCISES) {
      expect([e.id, e.name, ...e.steps].join(' ')).not.toMatch(/kegel|pelvic[- ]floor/i);
    }
    expect(EXERCISE_SAFETY_NOTES.some((n) => /Kegels\) is not included/.test(n))).toBe(true);
  });

  it('offers only floor, stretch, relaxation and walking work as gentle options, not strength', () => {
    expect(EXERCISES.filter((e) => !e.gentleOnBleedingDays).map((e) => e.id)).toEqual([
      'glute-bridge',
      'modified-plank',
      'squat-heel-raise',
    ]);
  });

  it('phrases bleeding-day use as a gentle option whose safety is not established', () => {
    for (const e of EXERCISES.filter((x) => x.gentleOnBleedingDays)) {
      const caution = e.cautions.find((c) => /period days/i.test(c));
      expect(caution).toMatch(/gentle option if it feels good/);
      expect(caution).toMatch(/did not report side effects/);
      expect(caution).toMatch(/not established/);
    }
    for (const e of EXERCISES.filter((x) => !x.gentleOnBleedingDays)) {
      expect(e.cautions.some((c) => /heavy-flow or very painful days/.test(c))).toBe(true);
    }
    expect(EXERCISE_SAFETY_NOTES.some((n) => /did not report side effects/.test(n) && /bleeding days/.test(n))).toBe(
      true,
    );
  });

  describe("fact-checker's corrections", () => {
    it('cobra presses up with straight arms and offers bent elbows as the gentler option', () => {
      const steps = exercise('cobra').steps.join(' ');
      expect(steps).toMatch(/straightening your arms/);
      expect(steps).toMatch(/Gentler option: keep your elbows bent/);
      expect(exercise('cobra').evidence.summary).toMatch(/uses straight arms/);
      expect(exercise('cobra').evidence.summary).toMatch(/this app's additions/);
    });

    it('the luteal yoga routine is about 20 minutes about 3 times a week, never daily', () => {
      const r = routine('luteal-yoga');
      expect(r.minutes).toBe(20);
      expect(r.timing).toBe('luteal');
      expect(r.exerciseIds).toEqual(['cobra', 'cat-cow', 'supported-fish']);
      expect(r.schedule).toMatch(/about 3 times a week/);
      expect(`${r.schedule} ${r.basedOn}`).not.toMatch(/daily|every day/i);
      expect(r.basedOn).toMatch(/how often the trial did them is not confirmed/);
    });

    it('includes the "do the poses when warm, after a walk or bath" tip', () => {
      expect(routine('luteal-yoga').schedule).toMatch(/when your body is warm, for example after a walk or a bath/);
      expect(EXERCISE_SAFETY_NOTES.some((n) => /warm, for example after a walk or a bath/.test(n))).toBe(true);
    });

    it('does not label the routines suitable for adolescents', () => {
      for (const s of allExerciseStrings()) expect(s).not.toMatch(/suitable for (adolescents|teens)/i);
    });

    it('marks trial doses it could not confirm as unknown or app defaults', () => {
      expect(exercise('cat-cow').dose).toMatch(/app defaults; the trial's dose is not known/);
      expect(exercise('pmr').dose).toMatch(/session length is not known/);
      expect(exercise('butterfly').evidence.summary).not.toMatch(/10 stretches/);
      expect(exercise('glute-bridge').evidence.summary).toMatch(/Journal of Modern Rehabilitation|Shahrjerdi 2019/);
      expect(exercise('glute-bridge').evidence.sources.join(' ')).toMatch(/Journal of Modern Rehabilitation/);
      expect(exercise('pelvic-tilt').evidence.summary).toMatch(/Kegels/);
      expect(exercise('pmr').evidence.summary).not.toMatch(/dropout/i);
      expect(exercise('brisk-walk').evidence.summary).toMatch(/pain at the time of testing did not/);
      expect(routine('stretch-strength').basedOn).toMatch(/control group's pain duration also fell/);
      expect(routine('relax-release').basedOn).toMatch(/adaptation/);
    });
  });

  it('uses no banned wording', () => {
    for (const s of allExerciseStrings()) {
      expect(s).not.toMatch(/safe day/i);
      expect(s).not.toMatch(/low[- ]pain period/i);
      expect(s).not.toMatch(/\bmg\b/i);
      expect(s).not.toMatch(/your fault/i);
      expect(s.trim()).toBe(s);
      expect(s.length).toBeGreaterThan(0);
    }
  });
});

describe('routines', () => {
  it('match the SPEC §8 table', () => {
    expect(ROUTINES.map((r) => [r.id, r.minutes, r.timing])).toEqual([
      ['stretch-strength', 10, 'any'],
      ['luteal-yoga', 20, 'luteal'],
      ['weekly-aerobic', 45, 'any'],
      ['relax-release', 20, 'ovulation_to_period'],
    ]);
    expect(routine('stretch-strength').schedule).toMatch(/Twice a day.*3 days a week, for 8 weeks/);
    expect(routine('weekly-aerobic').schedule).toMatch(/45–60 minutes, 3 times a week/);
    expect(routine('relax-release').schedule).toMatch(/3 times a week, from around ovulation/);
  });

  it('only reference exercises in the library, and ids are unique', () => {
    const known = new Set(EXERCISES.map((e) => e.id));
    for (const r of ROUTINES) for (const id of r.exerciseIds) expect(known.has(id)).toBe(true);
    expect(new Set(ROUTINES.map((r) => r.id)).size).toBe(ROUTINES.length);
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(EXERCISES.length);
  });
});

describe('WEEKLY_EXERCISE_DAYS_GOAL', () => {
  it('is 3 days a week, the same target the pain guide uses', () => {
    expect(WEEKLY_EXERCISE_DAYS_GOAL).toBe(3);
    expect(WEEKLY_EXERCISE_DAYS_GOAL).toBe(EXERCISE_DAYS_PER_WEEK_TARGET);
  });
});

describe('exerciseDaysPerWeek', () => {
  const today = '2026-03-31';

  it('is 0 with no sessions', () => {
    expect(exerciseDaysPerWeek([], today)).toBe(0);
  });

  it('counts distinct days with a session of at least 10 minutes, per 7 days of a 28-day window', () => {
    const sessions = [
      session('2026-03-31', 45),
      session('2026-03-31', 20), // same day: counts once
      session('2026-03-29', 10), // exactly 10 minutes counts
      session('2026-03-27', 9), // too short
      session('2026-03-20', 30),
    ];
    expect(exerciseDaysPerWeek(sessions, today)).toBeCloseTo((3 * 7) / 28);
  });

  it('does not add up short sessions on the same day', () => {
    expect(exerciseDaysPerWeek([session(today, 5), session(today, 6)], today)).toBe(0);
  });

  it('includes the first day of the window and nothing before it or after today', () => {
    const first = addDays(today, -27);
    const sessions = [session(first, 30), session(addDays(first, -1), 30), session(addDays(today, 1), 30)];
    expect(exerciseDaysPerWeek(sessions, today)).toBeCloseTo(7 / 28);
  });

  it('reaches the goal with 3 exercise days every week', () => {
    const sessions = [0, 2, 4, 7, 9, 11, 14, 16, 18, 21, 23, 25].map((d) => session(addDays(today, -d), 45));
    expect(exerciseDaysPerWeek(sessions, today)).toBe(WEEKLY_EXERCISE_DAYS_GOAL);
  });

  it('uses the same minimum session length as the pain guide', () => {
    expect(exerciseDaysPerWeek([session(today, MIN_EXERCISE_MINUTES)], today, 7)).toBe(1);
    expect(exerciseDaysPerWeek([session(today, MIN_EXERCISE_MINUTES - 1)], today, 7)).toBe(0);
  });

  it('supports a custom window across month and year boundaries', () => {
    const sessions = [session('2026-01-01', 30), session('2025-12-29', 30), session('2025-12-25', 30)];
    expect(exerciseDaysPerWeek(sessions, '2026-01-01', 7)).toBe(2);
    expect(exerciseDaysPerWeek(sessions, '2026-01-01', 14)).toBe(1.5);
  });

  it('ignores sessions with an invalid date or a non-finite length', () => {
    const sessions = [session('2026-02-30', 30), session(today, Number.NaN), session(today, Number.POSITIVE_INFINITY)];
    expect(exerciseDaysPerWeek(sessions, today)).toBe(0);
  });

  it('rejects a window that is not a positive whole number of days', () => {
    expect(() => exerciseDaysPerWeek([], today, 0)).toThrow();
    expect(() => exerciseDaysPerWeek([], today, 2.5)).toThrow();
    expect(() => exerciseDaysPerWeek([], 'not-a-date')).toThrow();
  });
});

describe('suggestRoutines', () => {
  const suggest = (phase: ExercisePhase, gentleOnly = false, madeWorse: string[] = []) =>
    ids(suggestRoutines({ phase, gentleOnly, madeWorse }));

  it('offers the all-cycle routines in the follicular phase', () => {
    expect(suggest('follicular')).toEqual(['stretch-strength', 'weekly-aerobic']);
  });

  it('adds luteal yoga and relaxation in the luteal phase', () => {
    expect(suggest('luteal')).toEqual(['stretch-strength', 'luteal-yoga', 'weekly-aerobic', 'relax-release']);
  });

  it('offers relaxation on demand during the period, but not the luteal yoga routine', () => {
    expect(suggest('menstrual')).toEqual(['stretch-strength', 'weekly-aerobic', 'relax-release']);
  });

  it('offers every routine when the phase is unknown', () => {
    expect(suggest('unknown')).toEqual(ids(ROUTINES));
  });

  it('keeps only routines made entirely of gentle options on heavy or high-pain days', () => {
    expect(suggest('luteal', true)).toEqual(['luteal-yoga', 'weekly-aerobic', 'relax-release']);
    expect(suggest('menstrual', true)).toEqual(['weekly-aerobic', 'relax-release']);
    for (const r of suggestRoutines({ phase: 'unknown', gentleOnly: true, madeWorse: [] })) {
      for (const id of r.exerciseIds) expect(exercise(id).gentleOnBleedingDays).toBe(true);
    }
  });

  it('never suggests a routine containing an exercise that made pain worse', () => {
    expect(suggest('luteal', false, ['cat-cow'])).toEqual(['weekly-aerobic', 'relax-release']);
    expect(suggest('luteal', false, ['modified-plank'])).toEqual(['luteal-yoga', 'weekly-aerobic', 'relax-release']);
    expect(suggest('menstrual', true, ['pmr', 'brisk-walk'])).toEqual([]);
  });

  it('ignores unknown or repeated "made it worse" ids', () => {
    expect(suggest('luteal', false, ['no-such-exercise', 'pmr', 'pmr'])).toEqual([
      'stretch-strength',
      'luteal-yoga',
      'weekly-aerobic',
    ]);
  });

  it('returns library routines without changing them', () => {
    const before = JSON.stringify(ROUTINES);
    const out = suggestRoutines({ phase: 'luteal', gentleOnly: false, madeWorse: [] });
    expect(out[0]).toBe(ROUTINES[0]);
    expect(JSON.stringify(ROUTINES)).toBe(before);
  });
});
