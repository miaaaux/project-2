// Every user-facing sentence the core hands to the UI (SPEC §9).
//
// Plain, kind English. Never "safe days", never a promise of a low-pain period,
// never blame. No medication or supplement doses: the magnesium card's
// 350 mg/day supplement limit is the only one. Contraception text always says
// the app is not a certified contraceptive. Notification text has no dates or
// countdowns, because a local notification can fire long after it was written.
// content.test.ts checks these rules against every export.

import type { FertilityReason } from './fertility/model';
import type { HabitKey, HabitPattern } from './painGuide';
import type { RedFlagCode } from './redFlags';
import type { ReminderType } from './reminders';
import type { CycleContextAnswer } from './types';

// ----------------------------------------------------------- reminders

export interface ReminderText {
  title: string;
  body: string;
  /** Lock-screen text: never mentions periods, fertility or the reminder's subject. */
  discreetTitle: string;
  discreetBody: string;
}

const DISCREET_TITLE = 'You have a reminder';
const DISCREET_BODY = 'Open the app to see it.';

export const REMINDER_TEXT: Record<ReminderType, ReminderText> = {
  prep: {
    title: 'Get ready for your period',
    body: "Your period may start in the next few days. A good time to get ready: caffeine-free tea (such as ginger or chamomile), a heat pad or hot-water bottle, and pads, tampons or a cup. Check you have your usual pain relief, and ask a pharmacist if you're unsure. If your period has already started, tap to log it.",
    discreetTitle: DISCREET_TITLE,
    discreetBody: DISCREET_BODY,
  },
  sugar: {
    title: 'Optional sugar experiment',
    body: "If you'd like to try it this cycle, swap one sugary drink a day for something unsweetened, and see what your logs show. It's an experiment, not a rule: skip it any day, and turn this reminder off in Settings whenever you like.",
    discreetTitle: DISCREET_TITLE,
    discreetBody: DISCREET_BODY,
  },
};

// --------------------------------------------------------- habit info

export type HabitInfoKey = HabitKey | 'tea_heat';

export interface HabitInfo {
  title: string;
  evidence: 'low' | 'weak' | 'mixed';
  body: string;
}

export const HABIT_INFO: Record<HabitInfoKey, HabitInfo> = {
  magnesium: {
    title: 'Magnesium',
    evidence: 'weak',
    body: "A few small, mostly older trials suggest magnesium may ease period pain for some people. A later review of supplements for period pain found no high-quality evidence for any supplement, and it didn't assess magnesium. If you choose to take a supplement, don't take more than 350 mg a day from supplements (magnesium in food doesn't count toward this). Too much can cause diarrhoea. Don't take magnesium supplements if you have kidney disease, and check with a pharmacist or doctor first if you take antibiotics, bisphosphonates (bone medicines), diuretics (water tablets) or proton-pump inhibitors (stomach-acid medicines), because they can interact.",
  },
  exercise: {
    title: 'Exercise',
    evidence: 'low',
    body: "Exercise has the best evidence of the four habits, though it is still low certainty. A Cochrane review of 12 small trials found that regular exercise reduced period pain compared with no exercise, by roughly 2.5 points on a 0–10 scale. Most trials used sessions of 45–60 minutes at least 3 times a week, over 4–12 weeks. Different kinds of exercise, including aerobic exercise, stretching, yoga, strength and relaxation, all seemed to help. It isn't known whether shorter sessions work as well, whether the benefit lasts after stopping, or whether exercising only on period days helps.",
  },
  sugar: {
    title: 'Less sugar',
    evidence: 'weak',
    body: "Some surveys found that people who have more sweet foods or sugary drinks report more period pain. Surveys can't show cause: pain itself can bring on cravings, and appetite naturally rises before a period. No trial has tested eating less sugar, and there's no evidence for starting two weeks before a period. If you're curious, you can try it as an experiment and see what your own logs show. If you have diabetes or have had difficulties with eating, follow your own care plan; this is never a rule.",
  },
  sleep: {
    title: 'Sleep',
    evidence: 'weak',
    body: "Surveys have found that people who sleep less, or sleep poorly, tend to report more period pain. Surveys can't show cause, and it isn't clear which way it runs: pain disturbs sleep, and poor sleep may make pain feel stronger. No trial has tested whether more sleep eases period pain. The prep card looks at your sleep in the week before your period, against your sleep target (8 hours unless you change it).",
  },
  tea_heat: {
    title: 'Tea and heat',
    evidence: 'weak',
    body: "Heat has the better evidence of the two: in one trial, a heat patch on the lower belly eased period pain about as well as an over-the-counter painkiller. A heat pad or hot-water bottle works the same way; wrap it so it feels warm, not hot, on your skin. Tea has weak evidence as a treatment. Ginger has been studied in small trials, mostly as capsules rather than tea. Caffeinated tea was linked with more period pain in one survey and can disturb sleep, so if you'd like a warm drink, a caffeine-free tea such as ginger or chamomile is a good pick.",
  },
};

// ---------------------------------------------------------- pain guide

/** SPEC §9: shown at the foot of every pain screen. */
export const PAIN_FOOTER =
  "If pain stops you doing normal things, doesn't ease with over-the-counter pain relief, or is getting worse, please talk to a doctor.";

const HABIT_COUNT = 4;
/** Cycles each group needs before a comparison is shown (the pain guide uses the same number). */
const MIN_CYCLES_PER_GROUP = 3;

function wholeCount(n: number, max: number): number {
  return Number.isFinite(n) ? Math.min(max, Math.max(0, Math.floor(n))) : 0;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Neutral counts for the period prep card ("3 of 4"); habits without enough logs are never called missed. */
export function prepCardMessage(onTrackCount: number, knownCount: number): string {
  const known = wholeCount(knownCount, HABIT_COUNT);
  const onTrack = wholeCount(onTrackCount, known);
  if (known === 0) return 'Log your habits for a few more days to see your period prep summary.';
  if (onTrack === HABIT_COUNT) {
    return "You're on track with all 4 habits that may help with period pain. After your period, the app will compare it with your earlier ones.";
  }
  const unknown = HABIT_COUNT - known;
  const notCounted =
    unknown === 0
      ? ''
      : ` ${plural(unknown, "habit doesn't", "habits don't")} have enough logs yet, so ${unknown === 1 ? "it isn't" : "they aren't"} counted.`;
  if (onTrack === 0) {
    return `0 of ${known} habits on track so far.${notCounted} That's okay: anything you manage in the next few days still counts.`;
  }
  return `${onTrack} of ${known} habits on track.${notCounted} Small steps still count.`;
}

export type PatternInput = Pick<HabitPattern, 'habit' | 'state' | 'onTrack' | 'offTrack'> &
  Partial<Pick<HabitPattern, 'painReliefShareOn' | 'painReliefShareOff'>>;

const PATTERN_WORDS: Record<HabitKey, { name: string; cause: string; onGroup: string }> = {
  magnesium: {
    name: 'Magnesium',
    cause: 'magnesium',
    onGroup: 'when you took magnesium on most logged days before the period',
  },
  exercise: {
    name: 'Exercise',
    cause: 'exercise',
    onGroup: 'with 3 or more exercise days a week on average',
  },
  sugar: {
    name: 'Less sugar',
    cause: 'less sugar',
    onGroup: 'with at most one sweet food or drink on most logged days before the period',
  },
  sleep: {
    name: 'Sleep',
    cause: 'sleep',
    onGroup: 'when you averaged your sleep target in the week before the period',
  },
};

function score(median: number): string {
  return Number.isInteger(median) ? `${median}/10` : `${median.toFixed(1)}/10`;
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** Pain relief is a confounder, so it is shown next to every comparison where it was logged. */
function painReliefLine(p: PatternInput): string {
  const on = p.painReliefShareOn ?? null;
  const off = p.painReliefShareOff ?? null;
  if (on !== null && off !== null) {
    return ` Pain relief was taken in ${percent(on)} of the first group's periods and ${percent(off)} of the others.`;
  }
  if (on !== null) return ` Pain relief was taken in ${percent(on)} of the first group's periods; it wasn't logged for the others.`;
  if (off !== null) return ` Pain relief was taken in ${percent(off)} of the other periods; it wasn't logged for the first group.`;
  return '';
}

/** One sentence per habit for "Your patterns". It is a pattern in the user's logs, never proof of cause. */
export function patternSentence(p: PatternInput): string {
  const words = PATTERN_WORDS[p.habit];
  const on = p.onTrack;
  const off = p.offTrack;
  if (p.state === 'need_more_cycles' || on.median === null || off.median === null) {
    return `${words.name}: not enough cycles to compare yet. So far, ${plural(on.n, 'cycle', 'cycles')} ${words.onGroup}, and ${plural(off.n, 'cycle', 'cycles')} without. A comparison needs at least ${MIN_CYCLES_PER_GROUP} of each.`;
  }
  const medians = `peak cramps had a median of ${score(on.median)} over ${plural(on.n, 'cycle', 'cycles')} ${words.onGroup}, and ${score(off.median)} over ${plural(off.n, 'cycle', 'cycles')} without.`;
  if (p.state === 'no_clear_difference') {
    return `${words.name}: no clear difference in your logs so far: ${medians} This is a pattern in your logs, not proof either way.${painReliefLine(p)}`;
  }
  return `${words.name}: in your logs, ${medians} This is a pattern in your logs, not proof that ${words.cause} made the difference. Pain varies from cycle to cycle for many reasons.${painReliefLine(p)}`;
}

// ----------------------------------------------------------- red flags

export interface RedFlagText {
  title: string;
  body: string;
}

const NOT_A_DIAGNOSIS = "This isn't a diagnosis.";
const TREATABLE =
  "Pain like this isn't something you just have to put up with: there are effective treatments, and sometimes a cause such as endometriosis or fibroids that can be checked.";

export const RED_FLAG_TEXT: Record<RedFlagCode, RedFlagText> = {
  severe_pain: {
    title: 'Severe period pain',
    body: `Your logs show period pain of 8 out of 10 or more, or pain that stopped you doing your usual things. That's worth talking to a doctor or nurse about. ${TREATABLE} ${NOT_A_DIAGNOSIS}`,
  },
  repeated_high_pain: {
    title: 'Strong pain around several periods',
    body: `Your logs show period pain of 7 out of 10 or more around at least 2 of your last 3 periods. That's worth talking to a doctor or nurse about. ${TREATABLE} ${NOT_A_DIAGNOSIS}`,
  },
  worsening_pain: {
    title: 'Period pain getting stronger',
    body: `Your logs show your period pain has become stronger than it used to be. Pain that changes like this is worth talking to a doctor or nurse about. ${TREATABLE} ${NOT_A_DIAGNOSIS}`,
  },
  pain_outside_period: {
    title: 'Pain outside your period',
    body: `Your logs show pelvic pain on 3 or more days away from your period. That's worth talking to a doctor or nurse about, as it can have causes that are worth checking. ${NOT_A_DIAGNOSIS}`,
  },
  severe_headache: {
    title: 'Severe headache',
    body: `Your logs show a severe headache (8 out of 10 or more) recently. That's worth talking to a doctor or nurse about, especially if headaches are new for you or getting worse. ${NOT_A_DIAGNOSIS} Get urgent help if a headache comes on suddenly and is the worst you've ever had.`,
  },
  flooding: {
    title: 'Very heavy bleeding',
    body: `You logged flooding: soaking a pad or tampon within 1–2 hours, or passing clots larger than about 2.5 cm. Heavy periods are common and treatable, and they can lower your iron levels, so it's worth talking to a doctor or nurse about. ${NOT_A_DIAGNOSIS} If you feel dizzy, faint or short of breath while bleeding heavily, get urgent help.`,
  },
  long_bleeding: {
    title: 'Long period',
    body: `Your logs show a period lasting more than 8 days. That's worth talking to a doctor or nurse about, as there are treatments that can help. ${NOT_A_DIAGNOSIS}`,
  },
  intermenstrual_bleeding: {
    title: 'Bleeding between periods',
    body: `Your logs show bleeding between periods in at least 2 recent cycles. It often has a simple cause, but it's worth talking to a doctor or nurse about, especially if it also happens after sex. ${NOT_A_DIAGNOSIS}`,
  },
  irregular_cycles: {
    title: 'Cycles outside the usual range',
    body: `Your recent cycles have often been shorter than 24 days or longer than 38 days, or have varied a lot in length. Cycles can change for many reasons, and it's worth talking to a doctor or nurse to check what's going on. ${NOT_A_DIAGNOSIS}`,
  },
  no_period_90_days: {
    title: 'No period for 90 days',
    body: `It has been 90 days or more since your last period started. If there's any chance you could be pregnant, take a pregnancy test. Either way, it's worth talking to a doctor or nurse about. ${NOT_A_DIAGNOSIS}`,
  },
};

// ----------------------------------------------------------- fertility

export type FertilityStatusKey = 'fertile' | 'infertile_pre_ovulatory' | 'infertile_post_ovulatory' | 'not_applicable';


const NOT_CERTIFIED = 'This app is not a certified contraceptive.';

export const FERTILITY_STATUS_TEXT: Record<FertilityStatusKey, { label: string; detail: string }> = {
  fertile: {
    label: 'Fertile',
    detail:
      "Use a condom or abstain from sex if you want to avoid pregnancy. Any day the app can't double-check counts as fertile.",
  },
  infertile_pre_ovulatory: {
    label: 'Not fertile (early cycle)',
    detail: `Your earlier cycles and this day's complete evening observation meet the early-cycle rules. If you notice any moistness or mucus, log it: the day becomes fertile. ${NOT_CERTIFIED}`,
  },
  infertile_post_ovulatory: {
    label: 'Not fertile (after ovulation, double-checked)',
    detail: `Your temperature rise and your mucus peak both confirm that ovulation has passed. ${NOT_CERTIFIED}`,
  },
  not_applicable: {
    label: 'Method not active',
    detail:
      "The method doesn't work with hormonal contraception or during pregnancy, so the app doesn't show fertile or not-fertile days right now.",
  },
};

export const FERTILITY_REASON_TEXT: Record<FertilityReason, string> = {
  default_fertile: 'Every day counts as fertile unless the rules can show otherwise.',
  cycle_start_unknown: "The app doesn't know when this cycle started. Log the first day of your period to begin.",
  context_not_applicable:
    "You've logged hormonal contraception or pregnancy for this time, so the method doesn't apply.",
  cycle_locked_context:
    "This cycle includes something the method doesn't cover, such as a recent birth, breastfeeding, perimenopause, or hormonal or emergency contraception. Every day of this cycle stays fertile.",
  method_not_supported_postpartum:
    "After a birth and while breastfeeding, the method's rules don't apply until your cycles return. Every day stays fertile until you end this in your settings.",
  cycle_checkin_unanswered: 'Answer the cycle check-in. Until then, every day of this cycle stays fertile.',
  temperature_blocked_mixed_measurements:
    "This cycle's temperatures were taken with more than one thermometer, way of measuring or unit, so the temperature rise can't be checked. Keep to one thermometer and one way of measuring for the whole cycle.",
  temperature_blocked_low_resolution:
    "This cycle's temperatures look rounded, or don't match your thermometer setting, so the temperature rise can't be checked. Enter both decimal places exactly as your thermometer shows them.",
  set_usual_measurement_time:
    "Set your usual measurement time in Settings. Without it, the app can't check that readings were taken at a similar time each day.",
  first_cycle:
    "There's no fully charted cycle just before this one (for example, it's your first cycle in the app, or the first after hormonal contraception or a birth), so early-cycle days stay fertile.",
  previous_cycle_not_qualifying:
    'Your previous cycle does not meet the conditions for early-cycle not-fertile days (among them: fully charted, 21 to 40 days long, and double-checked), so early-cycle days stay fertile.',
  pre_ovulatory_rule:
    'Early-cycle rule: only the first few days of a cycle can count as not fertile, up to a limit set by your earlier cycles, and only while every evening observation is dry or shows nothing.',
  awaiting_evening_observation:
    "Today stays fertile until you confirm your evening observation, from your evening observation time onwards.",
  fertile_sign_observed:
    'You noted a possible fertile sign, such as feeling moist, wet or slippery, seeing mucus, or being unsure.',
  bleeding_hides_mucus: 'Bleeding can hide mucus, so this day counts as fertile.',
  missing_observation:
    "This day's observation is missing, incomplete or was entered much later, so it counts as fertile. Logging bleeding (even none) and a complete evening observation each day helps.",
  waiting_for_temperature_rise:
    'Waiting for a confirmed temperature rise: three higher readings after six lower ones.',
  waiting_for_mucus_peak:
    'Waiting for the mucus peak to be confirmed: three days of less fertile signs after your most fertile day.',
  double_check_complete: 'Double-checked: your temperature rise and your mucus peak both confirm that ovulation has passed.',
  evening_transition:
    'Fertile today. Not fertile from this evening: your temperature rise and your mucus peak are both confirmed.',
  possible_new_cycle:
    "Bleeding was logged, which may be a new period, so days count as fertile again. If your period has started, log it.",
  temperature_drop:
    'Your temperature has dropped, which may mean your period is coming, so days count as fertile again.',
  luteal_phase_too_long:
    "Your temperature has stayed high for longer than usual, so days count as fertile again. If your period has started, log it. If it hasn't, consider taking a pregnancy test.",
  temperature_collapse:
    'Your temperature fell back down soon after the rise, so it may not have marked ovulation. Days count as fertile for the rest of this cycle.',
  fertile_mucus_after_confirmation:
    'You logged fertile mucus after the double check, so days count as fertile again until both signs confirm ovulation again.',
};

export const CONTRACEPTION_MODE: {
  title: string;
  intro: string[];
  /** The user must tick every one before the mode can be turned on. */
  acknowledgements: string[];
  howToObserve: string[];
} = {
  title: 'Contraception mode',
  intro: [
    `${NOT_CERTIFIED} Its rules have not been checked against the Sensiplan handbook, and the app has not been tested in a study.`,
    'Contraception mode uses your temperature and cervical mucus to label each day as fertile or not fertile, with cautious symptothermal rules. It stays off unless you turn it on.',
    "Any day the app is unsure about, or where something is missing, counts as fertile. On fertile days, use a condom or abstain if you want to avoid pregnancy.",
    'Sensiplan, taught in person, has strong published results: in one large study, 0.6 pregnancies per 100 women over 13 cycles among couples who never had unprotected sex in the fertile time, and 1.8 per 100 overall. Those are not this app\'s numbers.',
    'Learning the method from a certified teacher is strongly recommended.',
    "The method doesn't work with hormonal contraception or during pregnancy, and it isn't reliable after a recent birth or while breastfeeding. You'll be asked about these at the start of each period.",
    "It doesn't protect against sexually transmitted infections.",
  ],
  acknowledgements: [
    `I understand that this app is not a certified contraceptive.`,
    'I understand that its rules have not been checked against the Sensiplan handbook.',
    'I understand that learning the method from a certified teacher is strongly recommended.',
    'I understand that any missing or uncertain observation makes a day fertile.',
    'On fertile days, I will use a condom or abstain if I want to avoid pregnancy.',
  ],
  howToObserve: [
    'Temperature: take it as soon as you wake, before getting up, talking or drinking, at about the same time each day, after at least 3–4 hours of sleep.',
    'Use the same route (mouth, vagina or rectum) and the same thermometer for the whole cycle.',
    'Enter both decimal places exactly as your thermometer shows them, for example 36.55.',
    'If something may have disturbed a reading, such as fever, alcohol the evening before, short sleep, measuring at an unusual time, travel or medication, exclude it and choose the reason.',
    'Mucus: through the day, notice how your vulva feels (dry, nothing, moist, wet or slippery) and what you see on toilet paper or underwear (nothing, sticky, creamy, watery or like raw egg white, and whether it stretches).',
    "In the evening, record the most fertile observation of the whole day and mark it as final. If you're unsure, say so: the app treats unsure as fertile.",
    "Log bleeding every day, even when it's none.",
  ],
};

export const LATE_PERIOD_TEXT: { title: string; body: string; urgentSymptoms: string[] } = {
  title: 'Your period is late',
  body: "Cycles vary, and a late period is common. If there's any chance you could be pregnant, a pregnancy test can tell you; if it's negative and your period still hasn't come a week later, test again or talk to a doctor or nurse. Get urgent medical help straight away if you have any of these, as they can be signs of a pregnancy outside the womb (ectopic pregnancy):",
  urgentSymptoms: [
    'Severe pain on one side of your lower belly',
    'Pain in the tip of your shoulder',
    'Fainting, or feeling very dizzy or faint',
    'Heavy bleeding with dizziness',
  ],
};

/** Fertility amendment A17: a day the user saw as not fertile is fertile after an edit. */
export const EDIT_ALERT_TEXT: { title: string; body: string; unprotected: string } = {
  title: 'A day you saw as not fertile is now fertile',
  body: "After your latest change, the app checked your chart again, and one or more days it showed as not fertile now count as fertile. If you had unprotected sex on those days and want to avoid pregnancy, emergency contraception may help: the sooner the better, and some options work up to 5 days after sex. Ask a pharmacist or doctor as soon as you can.",
  unprotected: 'Unprotected sex was logged on:',
};

export type ContextQuestionKey = Exclude<keyof CycleContextAnswer, 'cycleStart' | 'answeredAt'>;

/** The cycle check-in, asked at onboarding and at every period start. */
export const CONTEXT_QUESTIONS: { key: ContextQuestionKey; text: string }[] = [
  { key: 'birthInLast12Months', text: 'Have you given birth in the last 12 months?' },
  { key: 'breastfeeding', text: 'Are you breastfeeding?' },
  {
    key: 'hormonalContraceptionSinceLastPeriod',
    text: 'Since your last period, have you used hormonal contraception (such as the pill, patch, ring, injection, implant or hormonal coil)?',
  },
  { key: 'emergencyContraceptionSinceLastPeriod', text: 'Since your last period, have you taken emergency contraception?' },
];

/** For the store listing, onboarding and Settings. */
export const DISCLAIMER =
  "This app is not a medical device. It is for self-tracking and information only, and it doesn't diagnose, treat or prevent any condition. It is not a certified contraceptive: its fertility rules have not been validated, so don't rely on it alone to avoid pregnancy. For medical advice, talk to a doctor, nurse or pharmacist.";
