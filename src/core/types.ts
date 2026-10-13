// Shared data contracts for everything the user logs.
//
// "Not logged" is always `undefined`, never a default value: an unlogged day
// must never be read as "dry", "no magnesium" or "0 pain".

import type { ISODate } from './date';

/** Local wall-clock time 'HH:MM' (24 h). */
export type ClockTime = string;
/** An absolute instant as an ISO-8601 string with offset, e.g. new Date().toISOString(). */
export type Instant = string;

// ---------------------------------------------------------------- bleeding

export type Flow = 'none' | 'spotting' | 'light' | 'medium' | 'heavy';

// ------------------------------------------------------------- temperature

export type TempUnit = 'C' | 'F';
export type TempRoute = 'oral' | 'vaginal' | 'rectal';

export type ExclusionReason =
  | 'fever_illness'
  | 'alcohol'
  | 'short_sleep'
  | 'off_time'
  | 'travel'
  | 'medication'
  | 'other';

export interface TemperatureReading {
  id: string;
  /** Integer hundredths of `unit`: 3655 means 36.55 °C. Never converted between units. */
  value: number;
  unit: TempUnit;
  /** Exactly what the user typed, kept for audit. */
  raw: string;
  /** Local wall-clock time of the measurement. */
  measuredAt: ClockTime;
  /** Device UTC offset when measured, in minutes (e.g. 120 for UTC+2). */
  utcOffsetMinutes: number;
  route: TempRoute;
  thermometerId: string;
  /** The user "bracketed" this reading; a reason is mandatory. */
  excluded?: { reason: ExclusionReason; note?: string };
  /** When the reading was saved. Readings typed in long after the fact are treated with suspicion. */
  enteredAt: Instant;
}

// ------------------------------------------------------------------ mucus

/** Feeling at the vulva during the day. */
export type MucusSensation = 'dry' | 'nothing' | 'moist' | 'wet' | 'slippery';
/** What is seen (the app's "consistency"). */
export type MucusAppearance = 'nothing' | 'sticky' | 'creamy' | 'watery' | 'egg_white';
export type MucusColor =
  | 'none'
  | 'white'
  | 'cream'
  | 'yellowish'
  | 'cloudy'
  | 'clear'
  | 'blood_tinged'
  | 'green_grey';
export type NotAssessableReason =
  | 'bleeding'
  | 'possible_infection'
  | 'vaginal_medication'
  | 'semen'
  | 'lubricant';

export interface MucusObservation {
  sensation?: MucusSensation;
  appearance?: MucusAppearance;
  stretchy?: boolean;
  color?: MucusColor;
  /** The user was unsure; the method rates the day upwards. */
  unsure?: boolean;
  notAssessable?: NotAssessableReason;
  /** The user confirmed this is the most fertile observation of the whole day (normally in the evening). */
  observationComplete: boolean;
  completedAt?: Instant;
  enteredAt: Instant;
  updatedAt: Instant;
}

// ------------------------------------------------------------- daily log

export type Intercourse = 'none' | 'protected' | 'unprotected';
export type PainImpact = 'none' | 'some' | 'couldnt_do_usual';
/** 3 means "3 or more" sweet foods or drinks. */
export type SugarServings = 0 | 1 | 2 | 3;
export type Scale5 = 1 | 2 | 3 | 4 | 5;

export interface DailyLog {
  date: ISODate;

  // bleeding
  flow?: Flow;
  /** The user tapped "my period started" on this day. Only this starts a cycle. */
  periodStartConfirmed?: boolean;
  /** Soaking a pad/tampon within 1-2 hours, or clots larger than about 2.5 cm. */
  flooding?: boolean;

  // fertility signs
  temperatures: TemperatureReading[];
  mucus?: MucusObservation;
  sexDrive?: Scale5;
  intercourse?: Intercourse;

  // comfort
  /** 0-10; 0 means logged as no cramps. */
  cramps?: number;
  /** 0-10. */
  headache?: number;
  painImpact?: PainImpact;
  wokeFromCramps?: boolean;
  /** Number of pain-relief doses; 0 means logged as none. */
  painReliefDoses?: number;
  heatUsed?: boolean;
  teaTaken?: boolean;

  // habits
  /** Hours slept in the night that ended on this date, in 0.5 steps. */
  sleepHours?: number;
  sleepQuality?: Scale5;
  sugarServings?: SugarServings;
  magnesiumTaken?: boolean;
  /** Elemental magnesium in mg, optional. */
  magnesiumMg?: number;

  // things that disturb temperature readings
  illness?: boolean;
  alcoholPreviousEvening?: boolean;

  note?: string;
  updatedAt: Instant;
}

// --------------------------------------------------------------- exercise

export type ExerciseKind = 'stretch' | 'yoga' | 'strength' | 'aerobic' | 'relaxation' | 'other';

export interface ExerciseSession {
  id: string;
  date: ISODate;
  kind: ExerciseKind;
  minutes: number;
  routineId?: string;
  exerciseIds: string[];
  intensity?: 'easy' | 'moderate' | 'hard';
  painBefore?: number;
  painAfter?: number;
  /** Exercises the user flagged as making pain worse. */
  madeWorse?: string[];
}

// ---------------------------------------------------------------- context

export type ContextKind =
  | 'hormonal_contraception'
  | 'pregnancy'
  | 'postpartum'
  | 'breastfeeding'
  | 'perimenopause'
  | 'emergency_contraception';

/** A stretch of time the method does not cover. `end` is inclusive; open-ended if absent. */
export interface ContextPeriod {
  id: string;
  kind: ContextKind;
  start: ISODate;
  end?: ISODate;
  detail?: string;
}

/** Asked at onboarding and again at every confirmed period start. Unanswered means the cycle is locked. */
export interface CycleContextAnswer {
  cycleStart: ISODate;
  answeredAt: Instant;
  birthInLast12Months: boolean;
  breastfeeding: boolean;
  hormonalContraceptionSinceLastPeriod: boolean;
  emergencyContraceptionSinceLastPeriod: boolean;
}

// --------------------------------------------------------------- settings

export interface Settings {
  unit: TempUnit;
  route: TempRoute;
  thermometer: { id: string; resolution: 0.01 | 0.05 };
  /** Effective-dated, never retroactive. Sorted by effectiveFrom ascending. */
  usualMeasurementTimes: { effectiveFrom: ISODate; time: ClockTime }[];
  /** A mucus observation can be marked complete only from this local time onwards (or any time on a later day). */
  eveningObservationTime: ClockTime;
  /** From onboarding ("usually about X days"); used until enough cycles exist. */
  typicalCycleLength?: number;
  birthYear?: number;
  /** Showing infertile days requires an explicit opt-in after reading the method information. */
  contraceptionMode: { enabled: boolean; acknowledgedAt?: Instant };
  reminders: {
    time: ClockTime;
    /** 3 days before the period: tea, heat, supplies. */
    prepEnabled: boolean;
    /** 2 weeks before the period: sugar experiment. Opt-in. */
    sugarEnabled: boolean;
    /** Lock-screen text never mentions periods or fertility. */
    discreet: boolean;
  };
  sleepTargetHours: number;
}

export const DEFAULT_SETTINGS: Settings = {
  unit: 'C',
  route: 'oral',
  thermometer: { id: 'default', resolution: 0.01 },
  usualMeasurementTimes: [],
  eveningObservationTime: '18:00',
  contraceptionMode: { enabled: false },
  reminders: { time: '09:00', prepEnabled: true, sugarEnabled: false, discreet: true },
  sleepTargetHours: 8,
};

/** Everything the app stores, as the pure core sees it. */
export interface AppData {
  logs: Record<ISODate, DailyLog>;
  exercise: ExerciseSession[];
  contexts: ContextPeriod[];
  cycleContextAnswers: CycleContextAnswer[];
  settings: Settings;
}
