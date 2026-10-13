// Period exercise library and routines (SPEC §8).
//
// Built from docs/exercise-research.json with the fact-checker's corrections
// applied: claims that could not be confirmed are labelled as such or left
// out, and app defaults are labelled as app defaults, not trial doses. There is
// deliberately no pelvic-floor strengthening (Kegels): it can worsen pain with
// a tight pelvic floor.
//
// No trial tested these exercises on bleeding days, and the trials reported no
// adverse-event data. So `gentleOnBleedingDays` means "a gentle option to try
// if it feels good", never "proven safe".

import { addDays, compareDates, isISODate, type ISODate } from './date';
import type { ExerciseKind, ExerciseSession } from './types';

export interface Exercise {
  /** Stable: stored in exercise sessions and "made it worse" flags. */
  id: string;
  name: string;
  kind: ExerciseKind;
  steps: string[];
  dose: string;
  /** Offered on heavy or high-pain days. Not a safety claim (see the module comment). */
  gentleOnBleedingDays: boolean;
  cautions: string[];
  evidence: { summary: string; quality: 'low' | 'very_low' | 'indirect'; sources: string[] };
}

export interface Routine {
  /** Stable: stored in exercise sessions and used in the routine screen's URL. */
  id: string;
  name: string;
  minutes: number;
  exerciseIds: string[];
  schedule: string;
  timing: 'any' | 'luteal' | 'ovulation_to_period';
  basedOn: string;
}

export type ExercisePhase = 'menstrual' | 'follicular' | 'luteal' | 'unknown';

export const WEEKLY_EXERCISE_DAYS_GOAL = 3;
/** A day counts as an exercise day if any one session lasted this long (the pain guide uses the same rule). */
const MIN_SESSION_MINUTES = 10;
const DEFAULT_WINDOW_DAYS = 28;

const BLEEDING_DAY_CAUTION =
  'On period days, this is a gentle option if it feels good. Trials did not report side effects, so its safety on bleeding days is not established.';
const HEAVY_DAY_CAUTION = 'Skip it on heavy-flow or very painful days.';
const PREGNANCY_CAUTION =
  'If you are pregnant or have recently given birth, check with a doctor, nurse or physiotherapist first.';

const SOURCES = {
  rakhshaee:
    "Rakhshaee 2011, yoga poses for primary dysmenorrhoea, J Pediatr Adolesc Gynecol 24(4):192-196 (PMID 21514190): https://pubmed.ncbi.nlm.nih.gov/21514190/",
  nationwideChildrens:
    "Nationwide Children's Hospital, Yoga exercises and menstrual cramps: https://www.nationwidechildrens.org/yoga-exercises-and-menstrual-cramps",
  nct05709951: 'ClinicalTrials.gov NCT05709951 (registered trial; results not seen): https://clinicaltrials.gov/study/NCT05709951',
  kirmizigil:
    'Kirmizigil & Demiralp 2020, Arch Gynecol Obstet 302(1):153-163; registry NCT03625375: https://clinicaltrials.gov/study/NCT03625375',
  vaziri: 'Vaziri 2015, J Family Reprod Health 9(1):23-28: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4405513/',
  shahrjerdiCore:
    'Shahrjerdi 2019, core-stability trial, Journal of Modern Rehabilitation 13(1):113-122: https://jmr.tums.ac.ir/index.php/jmr/article/view/241',
  shahrJerdy: 'Shahr-jerdy 2012, Biomed Hum Kinet 4:127-132: https://doaj.org/article/b835f0eb00664795a72706dd5146638e',
  tsai: 'Tsai 2024, network meta-analysis, Sports Med Open 10:63: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11139836/',
  celenay:
    'Toprak Celenay 2024, Taiwan J Obstet Gynecol 63(3):329-335: https://doaj.org/article/135c785e09a5491696ad6c69738726c9',
  cochrane: 'Armour 2019, Cochrane review, Exercise for dysmenorrhoea (CD004142): https://pubmed.ncbi.nlm.nih.gov/31538328/',
  kannan:
    'Kannan 2019, treadmill aerobic exercise trial, Contemp Clin Trials 81:80-86: https://research.polyu.edu.hk/en/publications/effectiveness-of-a-treadmill-based-aerobic-exercise-intervention--2/',
  nhs: 'NHS, Period pain: https://www.nhs.uk/conditions/period-pain/',
};

export const EXERCISES: Exercise[] = [
  {
    id: 'cobra',
    name: 'Cobra (gentle backbend)',
    kind: 'yoga',
    steps: [
      'Lie face down on a mat, legs hip-width apart, with the tops of your feet on the floor.',
      'Place your hands flat under your shoulders, elbows tucked in close to your sides.',
      'Breathe in and slowly press up, straightening your arms to lift your head and chest. Keep your hips on the floor.',
      'Gentler option: keep your elbows bent and lift only as far as feels comfortable for your lower back.',
      'Relax your shoulders down, away from your ears, and breathe slowly into your belly.',
      'Breathe out and lower yourself down slowly. This is a big stretch for the lower back, so take your time.',
      "Rest in child's pose for a few breaths before you repeat: kneel, sit back on your heels, fold forward and rest your arms on the floor.",
    ],
    dose: "Hold for 5 slow belly breaths, or 30–60 seconds if it feels comfortable, then rest. The app suggests 3 rounds. The trial's own hold times are not known.",
    gentleOnBleedingDays: true,
    cautions: [
      'If your lower back is sensitive, or you have back pain or a back injury, use the bent-elbow option or skip it.',
      'Stop if you feel sharp back or pelvic pain.',
      PREGNANCY_CAUTION,
      BLEEDING_DAY_CAUTION,
    ],
    evidence: {
      summary:
        "One small trial (Rakhshaee 2011, 92 students aged 18–22) found that cobra, cat and fish poses done in the second half of the cycle reduced period pain and how long it lasted, compared with no yoga. Its quality is reported as low. The steps come from Nationwide Children's Hospital guidance, which uses straight arms; the bent-elbow option and the rest in child's pose are this app's additions. A registered trial (NCT05709951) also includes cobra, but its results have not been seen.",
      quality: 'low',
      sources: [SOURCES.rakhshaee, SOURCES.nationwideChildrens, SOURCES.nct05709951],
    },
  },
  {
    id: 'cat-cow',
    name: 'Cat-cow',
    kind: 'yoga',
    steps: [
      'Start on your hands and knees in a tabletop position, hands under your shoulders and knees under your hips.',
      'Breathe in: let your belly drop toward the floor and lift your chin and tailbone (cow).',
      'Breathe out: round your back up toward the ceiling, tuck your chin and tailbone, and gently draw your belly in (cat).',
      'Move slowly with your breath, and stay in a range that feels comfortable.',
    ],
    dose: "5–10 slow rounds, or stay for 2–3 breaths in each position. These are app defaults; the trial's dose is not known.",
    gentleOnBleedingDays: true,
    cautions: [
      'Put padding under your knees if needed.',
      'If your wrists or knees hurt, stop, or try it resting on your forearms.',
      BLEEDING_DAY_CAUTION,
    ],
    evidence: {
      summary:
        "Cat pose is one of the three poses in the Rakhshaee 2011 trial (see cobra): one small trial, reported as low quality. Cat-camel is also part of a registered core-stability trial (NCT05709951) whose results have not been seen. The starting position follows Nationwide Children's Hospital guidance.",
      quality: 'low',
      sources: [SOURCES.rakhshaee, SOURCES.nationwideChildrens, SOURCES.nct05709951],
    },
  },
  {
    id: 'supported-fish',
    name: 'Supported fish (chest opener on a pillow)',
    kind: 'yoga',
    steps: [
      'Sit on the floor with a firm pillow or folded blanket placed lengthwise behind you.',
      "Lie back so the pillow supports your upper back and head. Don't drop your head back onto its crown as in the classic fish pose.",
      'Keep your legs straight, or bend your knees if your lower back complains. Rest your arms by your sides, palms up.',
      'Breathe gently into your belly and chest.',
      'To come out, roll onto your side and push yourself up with your hands.',
    ],
    dose: "Stay as long as it feels comfortable. The app suggests starting with 30–60 seconds and building up to 1–2 minutes; the trial's hold time is not known.",
    gentleOnBleedingDays: true,
    cautions: [
      'Skip it if you have neck problems or feel dizzy.',
      'Never put weight on the top of your head.',
      PREGNANCY_CAUTION,
      BLEEDING_DAY_CAUTION,
    ],
    evidence: {
      summary:
        "The third pose of the Rakhshaee 2011 trial (one small trial, reported as low quality; see cobra). This pillow-supported version follows Nationwide Children's Hospital guidance and avoids putting weight on the head. Which version the trial used is not known.",
      quality: 'low',
      sources: [SOURCES.rakhshaee, SOURCES.nationwideChildrens],
    },
  },
  {
    id: 'pelvic-tilt',
    name: 'Pelvic tilt (pelvic rocking)',
    kind: 'stretch',
    steps: [
      'Lie on your back with your knees bent and feet flat on the floor, hip-width apart.',
      'Breathe out: gently tip your pelvis so your lower back flattens toward the floor, tightening your lower belly a little.',
      'Breathe in: let your pelvis roll back so your lower back arches slightly away from the floor.',
      'Keep rocking slowly and smoothly with your breath, with your upper body relaxed.',
    ],
    dose: '10–15 slow tilts, 1–2 sets (app default; no trial dose was found).',
    gentleOnBleedingDays: true,
    cautions: [
      'Keep the movements small and comfortable.',
      'Stop if back or pelvic pain sharply increases.',
      BLEEDING_DAY_CAUTION,
    ],
    evidence: {
      summary:
        'Indirect. According to its trial registration, pelvic movements were one part of a combined exercise programme (Kirmizigil 2020: 28 women, 3 times a week for 8 weeks) that improved period symptoms and sleep. That programme also included pelvic-floor strengthening (Kegels), which this app leaves out because it can worsen pain for people with a tight pelvic floor. The effect of pelvic tilts on their own is not known. The steps are standard exercise practice, not taken from a trial.',
      quality: 'indirect',
      sources: [SOURCES.kirmizigil],
    },
  },
  {
    id: 'butterfly',
    name: 'Butterfly (inner-thigh stretch)',
    kind: 'stretch',
    steps: [
      'Sit tall on the floor, on a folded blanket if your back rounds.',
      'Bring the soles of your feet together and let your knees fall out to the sides.',
      'Hold your ankles or feet and lengthen your spine.',
      "Breathe out and lean forward slightly from your hips until you feel a gentle stretch in your inner thighs and groin. Don't bounce.",
      'Breathe slowly, then sit up slowly.',
    ],
    dose: 'Hold for 20–30 seconds, 2–3 times (app default; no trial dose was found).',
    gentleOnBleedingDays: true,
    cautions: [
      'Keep it gentle if you have hip or groin pain, or rest your knees on pillows.',
      BLEEDING_DAY_CAUTION,
    ],
    evidence: {
      summary:
        "Indirect. In Vaziri 2015 (105 students, 3 times a week for 8 weeks), both a stretching programme and aerobic exercise reduced period pain compared with no exercise. The trial's registration describes abdomen, pelvis and groin stretches, but the exact stretches were not seen, so this is a typical groin stretch rather than a confirmed trial exercise.",
      quality: 'indirect',
      sources: [SOURCES.vaziri],
    },
  },
  {
    id: 'glute-bridge',
    name: 'Glute bridge',
    kind: 'strength',
    steps: [
      'Lie on your back with your knees bent, feet flat and hip-width apart, arms by your sides.',
      'Breathe out, gently brace your belly and squeeze your buttocks.',
      "Lift your hips until your shoulders, hips and knees form a straight line. Don't over-arch your back.",
      'Hold briefly while breathing, then lower slowly, one part of your spine at a time.',
    ],
    dose: '10 slow lifts with a 3–5 second hold at the top, 1–2 sets (app default).',
    gentleOnBleedingDays: false,
    cautions: [
      'Make the movement smaller, or skip it, if your pelvis or lower back hurts.',
      "Breathe throughout; don't hold your breath.",
      HEAVY_DAY_CAUTION,
    ],
    evidence: {
      summary:
        'Indirect. An 8-week core-stability trial (Shahrjerdi 2019: 34 women aged 18–25, 3 sessions a week of 45–60 minutes) reduced pain intensity, pain duration and painkiller use compared with no exercise, but which exercises it used was not seen, and its sessions were much longer than this routine. Bridging is part of registered trials whose results have not been seen (NCT05709951). Low certainty.',
      quality: 'indirect',
      sources: [SOURCES.shahrjerdiCore, SOURCES.nct05709951],
    },
  },
  {
    id: 'modified-plank',
    name: 'Modified forearm plank',
    kind: 'strength',
    steps: [
      'Lie face down, then come up onto your forearms with your elbows under your shoulders.',
      'Keep your knees on the floor (easier) or lift onto your toes (harder).',
      "Make a straight line from your head to your knees (or heels). Gently draw your belly in and don't let your hips sag.",
      'Breathe normally throughout. Lower your knees to rest.',
    ],
    dose: "Hold for 10–30 seconds, 3 times, with 30 seconds' rest in between (app default). Build up the hold time over the weeks.",
    gentleOnBleedingDays: false,
    cautions: [
      'Use the knees-down version if your back or belly feels strained, and stop if pain increases.',
      'Pad your knees if needed.',
      PREGNANCY_CAUTION,
      HEAVY_DAY_CAUTION,
    ],
    evidence: {
      summary:
        'Indirect. Planks are part of registered core-stability trials whose results have not been seen (NCT05709951). A core-stability trial (Shahrjerdi 2019) reduced period pain, but which exercises it used was not seen, and its sessions were much longer. No trial has tested planks on their own.',
      quality: 'indirect',
      sources: [SOURCES.nct05709951, SOURCES.shahrjerdiCore],
    },
  },
  {
    id: 'squat-heel-raise',
    name: 'Squat and heel raise',
    kind: 'strength',
    steps: [
      'Stand with your feet hip-width apart. Hold the back of a chair if you like.',
      'Squat: push your hips back as if sitting into a chair, bend your knees to a comfortable depth and keep your chest up. Then stand up by pushing through your heels.',
      'After the squats, rise slowly onto the balls of your feet (heel raise) and lower slowly.',
    ],
    dose: '10 squats and 10–15 heel raises, 1–2 rounds (app default).',
    gentleOnBleedingDays: false,
    cautions: ['Use a chair for balance.', 'Keep the squat shallow if your knees hurt.', HEAVY_DAY_CAUTION],
    evidence: {
      summary:
        'Indirect and unconfirmed. A secondary summary (Tsai 2024) describes the Shahr-jerdy 2012 home routine as including squats and heel raises, but the original paper calls it active stretching, so this exercise has no confirmed trial basis. Shahr-jerdy 2012: 179 girls aged 15–17, 10 minutes twice a day, 3 days a week for 8 weeks; pain scores fell from 7.65 to 4.88 out of 10.',
      quality: 'indirect',
      sources: [SOURCES.shahrJerdy, SOURCES.tsai],
    },
  },
  {
    id: 'pmr',
    name: 'Progressive muscle relaxation with belly breathing',
    kind: 'relaxation',
    steps: [
      'Lie or sit comfortably. Put one hand on your belly and take a few slow breaths, letting your belly rise as you breathe in.',
      'Working from your feet up to your face (feet, calves, thighs, buttocks, belly, hands, arms, shoulders, face), tense one muscle group firmly but not painfully for about 10 seconds as you breathe in.',
      'Breathe out slowly and let that muscle group go completely. Notice the difference for 15–20 seconds.',
      'Move on to the next group.',
      'Finish with 1–2 minutes of slow belly breathing.',
    ],
    dose: "About 15–20 minutes per session (app default). The trial's session length is not known.",
    gentleOnBleedingDays: true,
    cautions: [
      'Skip tensing any muscle group that is injured or cramping, such as your belly during strong cramps: just breathe and let that area relax.',
      'Stop if tensing brings on cramps.',
      BLEEDING_DAY_CAUTION,
    ],
    evidence: {
      summary:
        'One trial (Toprak Celenay 2024) found that progressive muscle relaxation 3 times a week, from estimated ovulation until the next period, reduced period pain, other period symptoms and anxiety more than no treatment. A 2024 analysis of 29 trials (Tsai) ranked relaxation exercise highest for pain at 4 and 8 weeks, but how it defined relaxation exercise is not confirmed. Small trials, low certainty.',
      quality: 'low',
      sources: [SOURCES.celenay, SOURCES.tsai],
    },
  },
  {
    id: 'brisk-walk',
    name: 'Brisk walking (or other moderate aerobic exercise)',
    kind: 'aerobic',
    steps: [
      'Warm up with 5 minutes of easy walking.',
      'Speed up to a brisk pace where you can talk but not sing. Cycling, swimming, dancing or a treadmill count too.',
      'Keep going for the session time.',
      'Cool down with 5 minutes of easy walking.',
    ],
    dose: '45–60 minutes, at least 3 times a week, kept up for at least 8 weeks. On painful or heavy days, a gentle 20–30 minute walk instead.',
    gentleOnBleedingDays: true,
    cautions: [
      'If your flow is very heavy, or you feel dizzy, breathless or unusually tired, keep it gentle and talk to a doctor: heavy periods can lead to low iron.',
      'Drink water.',
      BLEEDING_DAY_CAUTION,
    ],
    evidence: {
      summary:
        'A Cochrane review (2019; 12 small trials, 854 women) found that regular exercise reduced period pain compared with no exercise, by roughly 2.5 points on a 0–10 scale. The evidence is low quality. Most trials used at least 3 sessions a week of about 45–60 minutes; it is not known whether shorter or less frequent sessions work as well, or whether the benefit lasts after stopping. In Kannan 2019 (70 women, treadmill training 3 times a week), pain intensity improved at 4 weeks but pain at the time of testing did not, and benefits were still seen at 7 months. Vaziri 2015 also found that aerobic exercise reduced period pain.',
      quality: 'low',
      sources: [SOURCES.cochrane, SOURCES.kannan, SOURCES.vaziri, SOURCES.nhs],
    },
  },
];

export const ROUTINES: Routine[] = [
  {
    id: 'stretch-strength',
    name: '10-minute stretch & strength',
    minutes: 10,
    exerciseIds: ['pelvic-tilt', 'butterfly', 'cat-cow', 'squat-heel-raise', 'glute-bridge', 'modified-plank'],
    schedule:
      "Twice a day (for example morning and evening), 3 days a week, for 8 weeks, at any point in your cycle. Spreading the days through the week and checking your pain after 2 cycles are this app's suggestions. The plank is optional. On heavy or very painful days, choose a gentler routine.",
    timing: 'any',
    basedOn:
      "The dose comes from Shahr-jerdy 2012 (179 girls aged 15–17): 10 minutes of active stretching at home, twice a day, 3 days a week for 8 weeks. Pain scores fell from 7.65 to 4.88 out of 10 and painkiller use fell; the control group's pain duration also fell, which weakens that part of the result. Low-quality evidence. Which exercises the trial used is not confirmed, so this mix is the app's choice, drawing on stretching and core-strength trials.",
  },
  {
    id: 'luteal-yoga',
    name: 'Luteal yoga: 3 poses',
    minutes: 20,
    exerciseIds: ['cobra', 'cat-cow', 'supported-fish'],
    schedule:
      "About 20 minutes, about 3 times a week, in the second half of your cycle: from your confirmed temperature rise (or about 14 days before your predicted period) until your period starts. Go through cobra, a short rest in child's pose, cat-cow and supported fish, and repeat until the time is up. Do the poses when your body is warm, for example after a walk or a bath. Keep it up for at least 2 cycles before judging whether it helps.",
    timing: 'luteal',
    basedOn:
      "Rakhshaee 2011: one small trial (92 students aged 18–22) in which cobra, cat and fish poses in the luteal phase reduced period pain and its duration compared with no yoga. Low-quality evidence. Sessions of about 20 minutes come from a secondary summary; how often the trial did them is not confirmed (one secondary source says 3 times a week). Pose instructions are from Nationwide Children's Hospital. Timing it from the confirmed temperature rise is this app's adaptation, and starts a few days after ovulation.",
  },
  {
    id: 'weekly-aerobic',
    name: 'Weekly aerobic goal',
    minutes: 45,
    exerciseIds: ['brisk-walk'],
    schedule:
      'Sessions of 45–60 minutes, 3 times a week, at a pace where you can talk but not sing, kept up for at least 8 weeks, all cycle long. The days after a period ends are a good time to start. On painful or heavy days, swap in a gentle 20–30 minute walk, or the yoga or relaxation routine. Shorter walks still count as exercise days, though it is not known whether they help pain as much.',
    timing: 'any',
    basedOn:
      'Cochrane review 2019 (12 small trials, 854 women): most trials used at least 3 sessions a week of about 45–60 minutes, and exercise reduced period pain compared with no exercise (low-quality evidence). Also Kannan 2019 (treadmill training, 70 women) and Vaziri 2015 (aerobic exercise, 105 students).',
  },
  {
    id: 'relax-release',
    name: 'Relax & release (PMR)',
    minutes: 20,
    exerciseIds: ['pmr'],
    schedule:
      'About 20 minutes, 3 times a week, from around ovulation (your confirmed temperature rise) until your period starts. You can also use it whenever cramps come on: skip tensing your belly and just breathe.',
    timing: 'ovulation_to_period',
    basedOn:
      "Toprak Celenay 2024: progressive muscle relaxation 3 times a week, from the estimated ovulation date until the next period, reduced period pain more than no treatment. The trial's session length is not known; 20 minutes is the app's default. Timing it from the confirmed temperature rise is this app's adaptation, and starts a few days later than the trial did. Tsai 2024 (29 trials) ranked relaxation exercise highest for pain, but how it defined relaxation is not confirmed.",
  },
];

/** Shown with the exercise library. */
export const EXERCISE_SAFETY_NOTES: string[] = [
  'These exercises are for ordinary period cramps. You can use them alongside your usual pain relief, and they are not a substitute for medical care.',
  "Stop if pain becomes sharp, stabbing or clearly worse, or if you feel dizzy, faint or short of breath. Mark the exercise as \"made it worse\" and the app won't suggest it again.",
  'The trials did not report side effects, so how safe these exercises are, including on bleeding days, has not been established. On period days, treat them as gentle options to try if they feel good.',
  'Do yoga poses and stretches when your body is warm, for example after a walk or a bath.',
  'Pelvic-floor strengthening (Kegels) is not included, because it can make pelvic pain worse for people with a tight pelvic floor. If you have pain with sex or tampons, a frequent urge to pee, or constipation, a pelvic-health physiotherapist can help.',
  'If you are pregnant or have recently given birth, check with a doctor, nurse or physiotherapist before doing the cobra, fish or plank.',
  'If your period is late and you have pain, take a pregnancy test rather than exercising. Severe pain on one side, shoulder-tip pain or fainting need urgent care.',
  'In trials, benefits showed up after 4–8 weeks (about 2–3 cycles) of regular exercise. The evidence is low quality, and it is not known whether benefits last after stopping, so give it 2–3 cycles before judging.',
];

// ------------------------------------------------------------- helpers

const EXERCISES_BY_ID = new Map(EXERCISES.map((e) => [e.id, e]));

/** Unknown ids are not gentle: an unrecognised exercise is never offered on a heavy day. */
function isGentle(exerciseId: string): boolean {
  return EXERCISES_BY_ID.get(exerciseId)?.gentleOnBleedingDays === true;
}

/** Routines that can also be used on demand during the period, outside their usual timing. */
const ON_DEMAND_DURING_PERIOD = new Set(['relax-release']);

function fitsPhase(routine: Routine, phase: ExercisePhase): boolean {
  if (routine.timing === 'any') return true;
  switch (phase) {
    case 'luteal':
      return true;
    case 'menstrual':
      return ON_DEMAND_DURING_PERIOD.has(routine.id);
    case 'follicular':
      return false;
    case 'unknown':
      // Without a known phase, every routine is offered; its schedule says when to do it.
      return true;
  }
}

// -------------------------------------------------------------- public

/**
 * Average exercise days per 7 days over the `windowDays` days ending today.
 * A day counts once, if any one session that day lasted at least 10 minutes.
 * Sessions are events, so no session means no exercise day.
 */
export function exerciseDaysPerWeek(
  sessions: ExerciseSession[],
  today: ISODate,
  windowDays = DEFAULT_WINDOW_DAYS,
): number {
  if (!Number.isInteger(windowDays) || windowDays < 1) {
    throw new Error(`windowDays must be a positive integer: ${windowDays}`);
  }
  const start = addDays(today, -(windowDays - 1));
  const days = new Set(
    sessions
      .filter((s) => isISODate(s.date) && compareDates(s.date, start) >= 0 && compareDates(s.date, today) <= 0)
      .filter((s) => Number.isFinite(s.minutes) && s.minutes >= MIN_SESSION_MINUTES)
      .map((s) => s.date),
  );
  return (days.size * 7) / windowDays;
}

/**
 * Routines worth suggesting today, in library order. A routine is left out if
 * it does not fit the cycle phase, if it contains an exercise the user flagged
 * as making pain worse, or, on heavy or high-pain days (`gentleOnly`), if any
 * of its exercises is not a gentle option.
 */
export function suggestRoutines(input: {
  phase: ExercisePhase;
  gentleOnly: boolean;
  madeWorse: string[];
}): Routine[] {
  const worse = new Set(input.madeWorse);
  return ROUTINES.filter(
    (r) =>
      fitsPhase(r, input.phase) &&
      !r.exerciseIds.some((id) => worse.has(id)) &&
      (!input.gentleOnly || r.exerciseIds.every(isGentle)),
  );
}
