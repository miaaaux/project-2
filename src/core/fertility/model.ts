// Public result types of the fertility engine (docs/fertility-rules.md, "Output contract").

import type { ISODate } from '../date';
import type { TempUnit } from '../types';

export type FertilityStatus =
  | 'fertile'
  | 'infertile_pre_ovulatory'
  | 'infertile_post_ovulatory'
  | 'not_applicable';

/** Stable rule codes explaining a day's status ("show the evidence"). */
export const FERTILITY_REASON_CODES = [
  'default_fertile',
  'cycle_start_unknown',
  'context_not_applicable',
  'cycle_locked_context',
  'method_not_supported_postpartum',
  'cycle_checkin_unanswered',
  'temperature_blocked_mixed_measurements',
  'temperature_blocked_low_resolution',
  'set_usual_measurement_time',
  'first_cycle',
  'previous_cycle_not_qualifying',
  'pre_ovulatory_rule',
  'awaiting_evening_observation',
  'fertile_sign_observed',
  'bleeding_hides_mucus',
  'missing_observation',
  'waiting_for_temperature_rise',
  'waiting_for_mucus_peak',
  'double_check_complete',
  'evening_transition',
  'possible_new_cycle',
  'temperature_drop',
  'luteal_phase_too_long',
  'temperature_collapse',
  'fertile_mucus_after_confirmation',
] as const;

export type FertilityReason = (typeof FERTILITY_REASON_CODES)[number];

export interface DayFertility {
  date: ISODate;
  /** 1-based cycle day, or null before the first confirmed period start. */
  cycleDay: number | null;
  status: FertilityStatus;
  /** A secondary badge (A18): period days can still be fertile. */
  inPeriod: boolean;
  /** The day stays fertile; infertile from this evening. */
  eveningTransition?: true;
  reasons: FertilityReason[];
}

export type TemperatureRule = 'regular' | 'exception1' | 'exception2';

export interface CycleFertilitySummary {
  cycleIndex: number;
  firstCycle: boolean;
  /** Affected by a context period or an answered "yes", or the cycle check-in is unanswered (A13). */
  locked: boolean;
  /** Why temperature evaluation is blocked for the whole cycle (A5, A8), or null. */
  temperatureBlocked: FertilityReason | null;
  /** The accepted temperature rise; for display it is also the first confirmed rise without a double check. */
  rise: {
    fhmDate: ISODate;
    /** Integer hundredths of `unit`. */
    coverline: number;
    unit: TempUnit;
    rule: TemperatureRule;
    completeDate: ISODate;
  } | null;
  mucus: {
    peakDate: ISODate | null;
    effectivePeakDate: ISODate | null;
    completeDate: ISODate | null;
    maxQuality: number | null;
  };
  /** Day S: both signs confirmed. Infertile from its evening. */
  doubleCheckDate: ISODate | null;
  postOvulatoryEnd: { date: ISODate; reason: FertilityReason } | null;
  /** N: how many early-cycle days may be infertile (each still needs a compatible observation). */
  preOvulatoryDays: number;
}

export type ReadingKind = 'VALID' | 'SUSPECT' | 'EXCLUDED' | 'MISSING';

export interface DayReadingInfo {
  date: ISODate;
  /** Integer hundredths of `unit`: the coverline value (maximum of the non-excluded readings). */
  value: number | null;
  unit: TempUnit | null;
  kind: ReadingKind;
  /** Mucus quality 0..4, or null for UNKNOWN or not logged. */
  mucusQuality: number | null;
}

export interface FertilityResult {
  /** Every date from the first log through today, ascending. */
  days: DayFertility[];
  cycles: CycleFertilitySummary[];
  readings: DayReadingInfo[];
}
