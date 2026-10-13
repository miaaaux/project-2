import * as content from './content';
import {
  CONTEXT_QUESTIONS,
  CONTRACEPTION_MODE,
  DISCLAIMER,
  EDIT_ALERT_TEXT,
  FERTILITY_REASON_TEXT,
  FERTILITY_STATUS_TEXT,
  HABIT_INFO,
  LATE_PERIOD_TEXT,
  PAIN_FOOTER,
  patternSentence,
  prepCardMessage,
  RED_FLAG_TEXT,
  REMINDER_TEXT,
  type PatternInput,
} from './content';
import {
  FERTILITY_REASON_CODES as ENGINE_REASON_CODES,
  type FertilityReason as EngineFertilityReason,
  type FertilityStatus as EngineFertilityStatus,
} from './fertility/model';
import { HABITS, MIN_CYCLES_PER_GROUP, type HabitPattern } from './painGuide';
import type { RedFlagCode } from './redFlags';
import type { CycleContextAnswer } from './types';

// Compile-time: the text tables cover exactly what the engines produce.
const reasonTextForEngine: Record<EngineFertilityReason, string> = FERTILITY_REASON_TEXT;
const statusTextForEngine: Record<EngineFertilityStatus, { label: string; detail: string }> = FERTILITY_STATUS_TEXT;
const patternFromEngine = (p: HabitPattern): string => patternSentence(p);
void reasonTextForEngine;
void statusTextForEngine;
void patternFromEngine;

const MAGNESIUM_CARD = 'HABIT_INFO.magnesium.body';

function collectStrings(value: unknown, path: string, out: [string, string][]): void {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => collectStrings(v, `${path}[${i}]`, out));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collectStrings(v, `${path}.${k}`, out);
  }
}

const PATTERN_STATES: HabitPattern['state'][] = ['need_more_cycles', 'no_clear_difference', 'pattern'];
const SHARES = [null, 0, 0.5, 1];

function patternInputs(): PatternInput[] {
  return HABITS.flatMap((habit) =>
    PATTERN_STATES.flatMap((state) =>
      SHARES.flatMap((on) =>
        SHARES.map((off) => ({
          habit,
          state,
          onTrack: { n: 1 + (on === null ? 0 : 3), median: state === 'need_more_cycles' ? null : 4 },
          offTrack: { n: 3, median: state === 'need_more_cycles' ? null : state === 'pattern' ? 6.5 : 5 },
          painReliefShareOn: on,
          painReliefShareOff: off,
        })),
      ),
    ),
  );
}

/** Every exported string, plus the output of every exported function over its whole input range. */
function everyString(): [string, string][] {
  const out: [string, string][] = [];
  for (const [name, value] of Object.entries(content)) {
    if (typeof value !== 'function') collectStrings(value, name, out);
  }
  for (let known = 0; known <= 4; known++) {
    for (let on = 0; on <= known; on++) out.push([`prepCardMessage(${on}, ${known})`, prepCardMessage(on, known)]);
  }
  for (const p of patternInputs()) out.push([`patternSentence(${JSON.stringify(p)})`, patternSentence(p)]);
  return out;
}

const BANNED: RegExp[] = [
  /\bsafe\b/i,
  /safe days?/i,
  /low[- ]pain period/i,
  /expect(ed)? (a )?(low|less|little|no)[- ]?pain/i,
  /your (own )?fault/i,
  /\bblame/i,
  /try harder/i,
  /\bfail(ed|ure)?\b/i,
  /\bmissed\b/i,
  /\bstreaks?\b/i,
  /you must/i,
  /you should have/i,
  /because you (skipped|didn'?t|did not|forgot|missed)/i,
  /\bguarantee/i,
  /\b(ibuprofen|paracetamol|acetaminophen|naproxen|aspirin|mefenamic)\b/i,
];

/** A number followed by a medicine or supplement unit. */
const DOSE = /\d[\d.,]*\s*(?:–|-|to)?\s*\d*\s*(?:mg|g|mcg|µg|ug|ml|iu|units?|tablets?|pills?|capsules?|caplets?|drops?|sachets?|doses?)\b/i;

describe('wording rules (SPEC §9) across every exported string', () => {
  const strings = everyString();

  it('scans a meaningful amount of text', () => {
    expect(strings.length).toBeGreaterThan(150);
  });

  it.each(BANNED.map((re) => [re.source, re] as const))('never matches /%s/', (_source, re) => {
    const hits = strings.filter(([, s]) => re.test(s)).map(([path]) => path);
    expect(hits).toEqual([]);
  });

  it('has no medication or supplement doses, except the magnesium supplement limit', () => {
    const doses = strings.filter(([path, s]) => path !== MAGNESIUM_CARD && (DOSE.test(s) || /\bmg\b/i.test(s)));
    expect(doses.map(([path]) => path)).toEqual([]);
  });

  it('mentions only the 350 mg/day supplement upper limit on the magnesium card', () => {
    const card = HABIT_INFO.magnesium.body;
    const amounts = [...card.matchAll(/(\d[\d.,]*)\s*mg/g)].map((m) => m[1]);
    expect(amounts).toEqual(['350']);
    expect(card).toMatch(/350 mg a day from supplements/);
    expect(card).toMatch(/kidney disease/);
    expect(card).toMatch(/antibiotics/);
    expect(card).toMatch(/bisphosphonates/);
    expect(card).toMatch(/diuretics/);
    expect(card).toMatch(/proton-pump inhibitors/);
  });

  it('has no empty or untrimmed strings', () => {
    for (const [path, s] of strings) {
      expect([path, s.trim().length > 0 && s.trim() === s && !/ {2}/.test(s)]).toEqual([path, true]);
    }
  });
});

describe('REMINDER_TEXT', () => {
  const all = Object.values(REMINDER_TEXT).flatMap((t) => [t.title, t.body, t.discreetTitle, t.discreetBody]);

  it('has no dates or countdowns, because notifications can fire long after they were written', () => {
    for (const s of all) {
      expect(s).not.toMatch(/\d/);
      expect(s).not.toMatch(/\b(today|tonight|tomorrow|yesterday)\b/i);
      expect(s).not.toMatch(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
      // Case-sensitive, because "may" is also an ordinary word.
      expect(s).not.toMatch(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/);
      expect(s).not.toMatch(/\bin (a|an|one|two|three|four|five|\d+) (days?|weeks?)\b/i);
      expect(s).not.toMatch(/\bdays? (left|to go|until)\b/i);
    }
  });

  it('keeps discreet text free of anything about periods, fertility or the reminder subject', () => {
    for (const t of Object.values(REMINDER_TEXT)) {
      for (const s of [t.discreetTitle, t.discreetBody]) {
        expect(s).not.toMatch(
          /period|fertil|pain|cramp|sugar|tampon|\bpads?\b|\bcup\b|bleed|cycle|ovulat|\btea\b|heat|pregnan|contracept|magnesium/i,
        );
      }
    }
  });

  it('prep covers caffeine-free tea, heat, supplies and usual pain relief with a pharmacist', () => {
    const { body } = REMINDER_TEXT.prep;
    expect(body).toMatch(/caffeine-free tea \(such as ginger or chamomile\)/);
    expect(body).toMatch(/heat pad or hot-water bottle/);
    expect(body).toMatch(/pads, tampons or a cup/);
    expect(body).toMatch(/usual pain relief/);
    expect(body).toMatch(/pharmacist/);
    expect(body).toMatch(/already started, tap to log it/);
  });

  it('frames sugar as an optional experiment with no pressure', () => {
    const { title, body } = REMINDER_TEXT.sugar;
    expect(title).toMatch(/Optional/);
    expect(body).toMatch(/swap one sugary drink a day/);
    expect(body).toMatch(/experiment, not a rule/);
    expect(body).toMatch(/turn this reminder off/);
    expect(body).not.toMatch(/\b(cut|bad|junk|guilt|cheat|should)\b/i);
  });
});

describe('HABIT_INFO', () => {
  it('labels each habit with the evidence strength from SPEC §7', () => {
    // SPEC §7: exercise is low certainty; magnesium, sugar and sleep are weak.
    expect(Object.fromEntries(Object.entries(HABIT_INFO).map(([k, v]) => [k, v.evidence]))).toEqual({
      magnesium: 'weak',
      exercise: 'low',
      sugar: 'weak',
      sleep: 'weak',
      tea_heat: 'weak',
    });
  });

  it('covers every pain-guide habit', () => {
    for (const h of HABITS) expect(HABIT_INFO[h]).toBeDefined();
  });

  it('says what is not known instead of overstating', () => {
    expect(HABIT_INFO.exercise.body).toMatch(/low certainty/);
    expect(HABIT_INFO.sugar.body).toMatch(/No trial has tested/);
    expect(HABIT_INFO.sugar.body).toMatch(/no evidence for starting two weeks before/);
    expect(HABIT_INFO.sleep.body).toMatch(/isn't clear which way it runs/);
    expect(HABIT_INFO.tea_heat.body).toMatch(/Heat has the better evidence/);
    expect(HABIT_INFO.tea_heat.body).toMatch(/Tea has weak evidence/);
  });
});

describe('PAIN_FOOTER', () => {
  it('is the exact SPEC §9 text', () => {
    expect(PAIN_FOOTER).toBe(
      "If pain stops you doing normal things, doesn't ease with over-the-counter pain relief, or is getting worse, please talk to a doctor.",
    );
  });
});

describe('prepCardMessage', () => {
  it('shows neutral counts', () => {
    expect(prepCardMessage(3, 4)).toBe('3 of 4 habits on track. Small steps still count.');
    expect(prepCardMessage(1, 4)).toBe('1 of 4 habits on track. Small steps still count.');
  });

  it('celebrates all four without promising a low-pain period', () => {
    expect(prepCardMessage(4, 4)).toMatch(/all 4 habits that may help/);
    expect(prepCardMessage(4, 4)).toMatch(/compare it with your earlier ones/);
  });

  it('never counts habits without enough logs as missed', () => {
    expect(prepCardMessage(2, 3)).toBe(
      "2 of 3 habits on track. 1 habit doesn't have enough logs yet, so it isn't counted. Small steps still count.",
    );
    expect(prepCardMessage(1, 2)).toMatch(/2 habits don't have enough logs yet, so they aren't counted/);
    expect(prepCardMessage(3, 3)).toMatch(/^3 of 3 habits on track/);
  });

  it('is kind when nothing is on track', () => {
    expect(prepCardMessage(0, 4)).toBe(
      "0 of 4 habits on track so far. That's okay: anything you manage in the next few days still counts.",
    );
  });

  it('asks for more logs when no habit has enough', () => {
    expect(prepCardMessage(0, 0)).toBe('Log your habits for a few more days to see your period prep summary.');
  });

  it('clamps impossible inputs instead of printing nonsense', () => {
    expect(prepCardMessage(5, 7)).toBe(prepCardMessage(4, 4));
    expect(prepCardMessage(3, 2)).toBe(prepCardMessage(2, 2));
    expect(prepCardMessage(-1, Number.NaN)).toBe(prepCardMessage(0, 0));
  });
});

describe('patternSentence', () => {
  const base: PatternInput = {
    habit: 'sleep',
    state: 'pattern',
    onTrack: { n: 4, median: 4 },
    offTrack: { n: 3, median: 6.5 },
  };

  it('describes a pattern in the logs, not proof', () => {
    expect(patternSentence(base)).toBe(
      'Sleep: in your logs, peak cramps had a median of 4/10 over 4 cycles when you averaged your sleep target in the week before the period, and 6.5/10 over 3 cycles without. This is a pattern in your logs, not proof that sleep made the difference. Pain varies from cycle to cycle for many reasons.',
    );
  });

  it('reports small differences as no clear difference', () => {
    const s = patternSentence({ ...base, habit: 'magnesium', state: 'no_clear_difference', offTrack: { n: 5, median: 5 } });
    expect(s).toMatch(/^Magnesium: no clear difference in your logs so far/);
    expect(s).toMatch(/4\/10 over 4 cycles when you took magnesium/);
    expect(s).toMatch(/5\/10 over 5 cycles without/);
    expect(s).toMatch(/pattern in your logs, not proof either way/);
  });

  it('says how many cycles each group has until both have at least 3', () => {
    const s = patternSentence({
      habit: 'exercise',
      state: 'need_more_cycles',
      onTrack: { n: 1, median: null },
      offTrack: { n: 2, median: null },
    });
    expect(s).toBe(
      'Exercise: not enough cycles to compare yet. So far, 1 cycle with 3 or more exercise days a week on average, and 2 cycles without. A comparison needs at least 3 of each.',
    );
    expect(s).toMatch(new RegExp(`at least ${MIN_CYCLES_PER_GROUP} of each`));
  });

  it('falls back to "not enough cycles" if a median is missing', () => {
    const s = patternSentence({ ...base, onTrack: { n: 3, median: null } });
    expect(s).toMatch(/not enough cycles to compare yet/);
  });

  it('shows pain relief alongside the comparison where it was logged', () => {
    expect(patternSentence({ ...base, painReliefShareOn: 0.5, painReliefShareOff: 1 })).toMatch(
      /Pain relief was taken in 50% of the first group's periods and 100% of the others\.$/,
    );
    expect(patternSentence({ ...base, painReliefShareOn: 0.25, painReliefShareOff: null })).toMatch(
      /25% of the first group's periods; it wasn't logged for the others\.$/,
    );
    expect(patternSentence({ ...base, painReliefShareOn: null, painReliefShareOff: 0 })).toMatch(
      /0% of the other periods; it wasn't logged for the first group\.$/,
    );
    expect(patternSentence({ ...base, painReliefShareOn: null, painReliefShareOff: null })).not.toMatch(/Pain relief/);
  });

  it('names the habit in every state, and never claims cause', () => {
    for (const p of patternInputs()) {
      const s = patternSentence(p);
      expect(s.startsWith(`${HABIT_INFO[p.habit].title}:`)).toBe(true);
      expect(s).not.toMatch(/\b(caused|because of|thanks to|proves?)\b/i);
      if (p.state !== 'need_more_cycles') expect(s).toMatch(/pattern in your logs, not proof/);
    }
  });
});

describe('RED_FLAG_TEXT', () => {
  const codes: RedFlagCode[] = [
    'severe_pain',
    'repeated_high_pain',
    'worsening_pain',
    'pain_outside_period',
    'severe_headache',
    'flooding',
    'long_bleeding',
    'intermenstrual_bleeding',
    'irregular_cycles',
    'no_period_90_days',
  ];

  it('has text for exactly the red-flag codes', () => {
    expect(Object.keys(RED_FLAG_TEXT).sort()).toEqual([...codes].sort());
  });

  it.each(codes)('%s: worth talking to a doctor or nurse, not a diagnosis, never "try harder"', (code) => {
    const { title, body } = RED_FLAG_TEXT[code];
    expect(title.length).toBeGreaterThan(0);
    expect(body).toMatch(/worth talking to a doctor or nurse/);
    expect(body).toMatch(/This isn't a diagnosis\./);
    // Once a red flag shows, the guide stops implying that more habits are the answer.
    expect(body).not.toMatch(/\btry\b|habit|magnesium|exercise|sugar|sleep/i);
  });
});

describe('fertility text', () => {
  it('uses exactly the engine reason codes, in the same order', () => {
    expect(ENGINE_REASON_CODES).toHaveLength(25);
    expect(Object.keys(FERTILITY_REASON_TEXT).sort()).toEqual([...ENGINE_REASON_CODES].sort());
  });

  it('tells the user to use a condom or abstain on fertile days', () => {
    expect(FERTILITY_STATUS_TEXT.fertile.label).toBe('Fertile');
    expect(FERTILITY_STATUS_TEXT.fertile.detail).toMatch(/use a condom or abstain/i);
  });

  it('uses the SPEC labels and says "not a certified contraceptive" with every not-fertile status', () => {
    expect(FERTILITY_STATUS_TEXT.infertile_pre_ovulatory.label).toBe('Not fertile (early cycle)');
    expect(FERTILITY_STATUS_TEXT.infertile_post_ovulatory.label).toBe('Not fertile (after ovulation, double-checked)');
    expect(FERTILITY_STATUS_TEXT.not_applicable.label).toBe('Method not active');
    for (const s of [FERTILITY_STATUS_TEXT.infertile_pre_ovulatory, FERTILITY_STATUS_TEXT.infertile_post_ovulatory]) {
      expect(s.detail).toMatch(/not a certified contraceptive/);
    }
  });

  it('explains the evening transition and the pregnancy-test hint for a long luteal phase', () => {
    expect(FERTILITY_REASON_TEXT.evening_transition).toMatch(/^Fertile today\. Not fertile from this evening/);
    expect(FERTILITY_REASON_TEXT.luteal_phase_too_long).toMatch(/pregnancy test/);
    expect(FERTILITY_REASON_TEXT.cycle_checkin_unanswered).toMatch(/check-in/);
  });
});

describe('CONTRACEPTION_MODE', () => {
  it('always says the app is not a certified contraceptive, first', () => {
    expect(CONTRACEPTION_MODE.intro[0]).toMatch(/^This app is not a certified contraceptive\./);
  });

  it('requires a tick for each SPEC §5 point', () => {
    const acks = CONTRACEPTION_MODE.acknowledgements.join('\n');
    expect(acks).toMatch(/not a certified contraceptive/);
    expect(acks).toMatch(/not been checked against the Sensiplan handbook/);
    expect(acks).toMatch(/certified teacher is strongly recommended/);
    expect(acks).toMatch(/use a condom or abstain/);
  });

  it('frames the Sensiplan figures as not this app\'s', () => {
    const intro = CONTRACEPTION_MODE.intro.join(' ');
    expect(intro).toMatch(/0\.6 pregnancies per 100 women/);
    expect(intro).toMatch(/Those are not this app's numbers/);
  });

  it('explains how to take temperature and observe mucus', () => {
    const how = CONTRACEPTION_MODE.howToObserve.join('\n');
    expect(how).toMatch(/as soon as you wake, before getting up/);
    expect(how).toMatch(/at about the same time each day/);
    expect(how).toMatch(/at least 3–4 hours of sleep/);
    expect(how).toMatch(/same route .* and the same thermometer/);
    expect(how).toMatch(/both decimal places/);
    expect(how).toMatch(/through the day, notice how your vulva feels/);
    expect(how).toMatch(/In the evening, record the most fertile observation of the whole day/);
  });
});

describe('LATE_PERIOD_TEXT', () => {
  it('lists the urgent symptoms of a possible ectopic pregnancy', () => {
    const urgent = LATE_PERIOD_TEXT.urgentSymptoms.join('\n');
    expect(urgent).toMatch(/Severe pain on one side/);
    expect(urgent).toMatch(/tip of your shoulder/);
    expect(urgent).toMatch(/Fainting/);
    expect(urgent).toMatch(/Heavy bleeding with dizziness/);
    expect(LATE_PERIOD_TEXT.body).toMatch(/urgent medical help/);
    expect(LATE_PERIOD_TEXT.body).toMatch(/pregnancy test/);
  });
});

describe('EDIT_ALERT_TEXT', () => {
  it('gives general emergency contraception time limits without naming a medicine', () => {
    expect(EDIT_ALERT_TEXT.body).toMatch(/the sooner the better/);
    expect(EDIT_ALERT_TEXT.body).toMatch(/some options work up to 5 days after sex/);
    expect(EDIT_ALERT_TEXT.body).toMatch(/Ask a pharmacist or doctor/);
    expect(EDIT_ALERT_TEXT.unprotected).toMatch(/^Unprotected sex was logged on:$/);
  });
});

describe('CONTEXT_QUESTIONS', () => {
  it('asks the four cycle check-in questions, one per answer field', () => {
    const fields: Exclude<keyof CycleContextAnswer, 'cycleStart' | 'answeredAt'>[] = [
      'birthInLast12Months',
      'breastfeeding',
      'hormonalContraceptionSinceLastPeriod',
      'emergencyContraceptionSinceLastPeriod',
    ];
    expect(CONTEXT_QUESTIONS.map((q) => q.key)).toEqual(fields);
    for (const q of CONTEXT_QUESTIONS) expect(q.text).toMatch(/\?$/);
  });
});

describe('DISCLAIMER', () => {
  it('says not a medical device and not a certified contraceptive', () => {
    expect(DISCLAIMER).toMatch(/^This app is not a medical device\./);
    expect(DISCLAIMER).toMatch(/not a certified contraceptive/);
  });
});
