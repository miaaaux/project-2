// Natural-contraception fertility engine (docs/fertility-rules.md, amendments binding).
// Not a validated or certified contraceptive algorithm; see SPEC.md section 5.

export { evaluateFertility } from './evaluate';
export { newlyFertileDays, type ShownDayStatus } from './diff';
export { FERTILITY_REASON_CODES } from './model';
export type {
  CycleFertilitySummary,
  DayFertility,
  DayReadingInfo,
  FertilityReason,
  FertilityResult,
  FertilityStatus,
  ReadingKind,
  TemperatureRule,
} from './model';
