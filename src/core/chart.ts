// Data for the cycle temperature chart (SPEC §4). Values stay integer
// hundredths of the unit they were entered in and are never converted, so a
// reading in another unit than the chart's is left off the plot. Missing days
// are gaps: lines are drawn only across consecutive drawable days.

import { cycleDay, type Cycle } from './cycles';
import { dateRange, minDate, type ISODate } from './date';
import type { DerivedState } from './derive';
import type { CycleFertilitySummary, DayReadingInfo, ReadingKind } from './fertility';
import type { AppData, Flow, TempUnit } from './types';

export interface ChartDay {
  cycleDay: number;
  date: ISODate;
  /** Integer hundredths of the chart unit, or null when nothing can be drawn. */
  value: number | null;
  kind: ReadingKind;
  /** As logged; absent when bleeding was not logged. */
  flow?: Flow;
  /** 0..4, or null when unknown or not logged. */
  mucusQuality: number | null;
  /** The confirmed mucus peak ("P"). */
  isPeak: boolean;
  sexDrive?: number;
}

/** Inclusive run of x positions (cycle days on the main chart). */
export interface ChartSegment {
  from: number;
  to: number;
}

export interface TemperatureChartData {
  unit: TempUnit;
  days: ChartDay[];
  /** Integer hundredths of `unit`, once a temperature rise is detected. */
  coverline: number | null;
  fhmCycleDay: number | null;
  /** The last low day before the first higher measurement; ovulation is only confirmed afterwards. */
  estimatedOvulationCycleDay: number | null;
  /** Integer hundredths of `unit`; the span is at least 1.0 °C or 1.8 °F. */
  yMin: number;
  yMax: number;
  /** Runs of 2 or more consecutive VALID or SUSPECT days, never across missing or excluded days. */
  segments: ChartSegment[];
}

export type OverlayAlignment = 'cycle_day' | 'rise';

export interface OverlayDay {
  /** Position on the target chart's x axis (its cycle days). */
  x: number;
  cycleDay: number;
  date: ISODate;
  value: number | null;
  kind: ReadingKind;
}

export interface OverlaySeries {
  cycleIndex: number;
  start: ISODate;
  /** Added to each cycle day to get its x position: 0 by cycle day, the difference of the rise days by rise. */
  shift: number;
  days: OverlayDay[];
  segments: ChartSegment[];
}

export const MAX_OVERLAY_CYCLES = 3;

const MIN_SPAN: Record<TempUnit, number> = { C: 100, F: 180 };
/** Grid step of the y axis (0.1 °C, 0.2 °F); the range is padded by one step on each side. */
const GRID_STEP: Record<TempUnit, number> = { C: 10, F: 20 };
/** Range shown before any reading: 36.00-37.00 °C, 96.80-98.60 °F. */
const DEFAULT_RANGE: Record<TempUnit, { yMin: number; yMax: number }> = {
  C: { yMin: 3600, yMax: 3700 },
  F: { yMin: 9680, yMax: 9860 },
};

// ------------------------------------------------------------- helpers

function summaryOf(derived: DerivedState, cycle: Cycle): CycleFertilitySummary | undefined {
  return derived.fertility.cycles.find((c) => c.cycleIndex === cycle.index);
}

/** Days shown for a cycle: through its end, or through today for the open cycle. */
function cycleDates(derived: DerivedState, cycle: Cycle): ISODate[] {
  return dateRange(cycle.start, cycle.end === null ? derived.today : minDate(cycle.end, derived.today));
}

type Readings = Map<ISODate, DayReadingInfo>;

function readingsByDate(derived: DerivedState): Readings {
  return new Map(derived.fertility.readings.map((r) => [r.date, r]));
}

/** The unit the cycle was charted in: the rise's, else the first reading's, else the setting. */
function cycleUnit(data: AppData, derived: DerivedState, readings: Readings, cycle: Cycle): TempUnit {
  const rise = summaryOf(derived, cycle)?.rise;
  if (rise) return rise.unit;
  for (const date of cycleDates(derived, cycle)) {
    const unit = readings.get(date)?.unit;
    if (unit) return unit;
  }
  return data.settings.unit;
}

function isDrawnAsLine(day: { kind: ReadingKind; value: number | null }): boolean {
  return (day.kind === 'VALID' || day.kind === 'SUSPECT') && day.value !== null;
}

/** Runs of 2 or more consecutive x positions whose days are VALID or SUSPECT. */
function segmentsOf(days: { x: number; kind: ReadingKind; value: number | null }[]): ChartSegment[] {
  const out: ChartSegment[] = [];
  let run: ChartSegment | null = null;
  for (const day of days) {
    if (isDrawnAsLine(day) && run !== null && day.x === run.to + 1) {
      run.to = day.x;
      continue;
    }
    if (run !== null && run.to > run.from) out.push(run);
    run = isDrawnAsLine(day) ? { from: day.x, to: day.x } : null;
  }
  if (run !== null && run.to > run.from) out.push(run);
  return out;
}

function chartDays(data: AppData, derived: DerivedState, readings: Readings, cycle: Cycle, unit: TempUnit): ChartDay[] {
  const mucus = summaryOf(derived, cycle)?.mucus;
  // A peak is only the peak once 3 lower days have followed it.
  const peakDate = mucus?.completeDate ? mucus.peakDate : null;
  return cycleDates(derived, cycle).map((date) => {
    const info = readings.get(date);
    const log = data.logs[date];
    const value = info?.unit === unit && Number.isFinite(info.value) ? info.value : null;
    const day: ChartDay = {
      cycleDay: cycleDay(cycle, date),
      date,
      value,
      // A reading in another unit cannot be placed on this axis, so it is left out like an excluded one.
      kind: !info ? 'MISSING' : info.kind !== 'MISSING' && value === null ? 'EXCLUDED' : info.kind,
      mucusQuality: info?.mucusQuality ?? null,
      isPeak: date === peakDate,
    };
    if (log?.flow !== undefined) day.flow = log.flow;
    if (log?.sexDrive !== undefined) day.sexDrive = log.sexDrive;
    return day;
  });
}

function floorTo(value: number, step: number): number {
  return Math.floor(value / step) * step;
}

function ceilTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

/**
 * The y range for these values (integer hundredths of `unit`): padded by one
 * grid step, on grid lines, and widened around the middle to the minimum span.
 */
export function temperatureRange(values: number[], unit: TempUnit): { yMin: number; yMax: number } {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { ...DEFAULT_RANGE[unit] };
  const step = GRID_STEP[unit];
  let yMin = floorTo(Math.min(...finite) - step, step);
  let yMax = ceilTo(Math.max(...finite) + step, step);
  const missing = MIN_SPAN[unit] - (yMax - yMin);
  if (missing > 0) {
    const below = floorTo(missing / 2, step);
    yMin -= below;
    yMax += missing - below;
  }
  return { yMin, yMax };
}

// --------------------------------------------------------------- chart

function emptyChart(unit: TempUnit): TemperatureChartData {
  return {
    unit,
    days: [],
    coverline: null,
    fhmCycleDay: null,
    estimatedOvulationCycleDay: null,
    ...DEFAULT_RANGE[unit],
    segments: [],
  };
}

/** The last day before the first higher measurement with a drawn reading on or below the coverline. */
function lastLowDayBefore(days: ChartDay[], fhmCycleDay: number, coverline: number): number | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i];
    if (d.cycleDay < fhmCycleDay && isDrawnAsLine(d) && (d.value as number) <= coverline) return d.cycleDay;
  }
  return null;
}

/** Chart data for the cycle with this index; an empty chart if there is no such cycle. */
export function temperatureChart(data: AppData, derived: DerivedState, cycleIndex: number): TemperatureChartData {
  const cycle = derived.cycles.find((c) => c.index === cycleIndex);
  if (!cycle) return emptyChart(data.settings.unit);

  const readings = readingsByDate(derived);
  const unit = cycleUnit(data, derived, readings, cycle);
  const days = chartDays(data, derived, readings, cycle, unit);
  const rise = summaryOf(derived, cycle)?.rise;
  const coverline = rise && rise.unit === unit ? rise.coverline : null;
  const fhmCycleDay = rise && coverline !== null ? cycleDay(cycle, rise.fhmDate) : null;
  const values = days.flatMap((d) => (d.value === null ? [] : [d.value]));

  return {
    unit,
    days,
    coverline,
    fhmCycleDay,
    estimatedOvulationCycleDay:
      fhmCycleDay !== null && coverline !== null ? lastLowDayBefore(days, fhmCycleDay, coverline) : null,
    ...temperatureRange(coverline === null ? values : [...values, coverline], unit),
    segments: segmentsOf(days.map((d) => ({ ...d, x: d.cycleDay }))),
  };
}

// ------------------------------------------------------------- overlay

function riseCycleDay(derived: DerivedState, cycle: Cycle, unit: TempUnit): number | null {
  const rise = summaryOf(derived, cycle)?.rise;
  return rise && rise.unit === unit ? cycleDay(cycle, rise.fhmDate) : null;
}

/**
 * Up to 3 cycles before `cycleIndex`, newest first, placed on that cycle's
 * x axis: by cycle day, or shifted so their first higher measurements line
 * up with its own. Cycles charted in another unit, or (by rise) without a
 * rise, are left out; by rise, nothing is returned until the target cycle has
 * a rise. Days that would fall before cycle day 1 are dropped; days past the
 * target's last day are kept, to show where earlier cycles went.
 */
export function overlayCycles(
  data: AppData,
  derived: DerivedState,
  cycleIndex: number,
  alignment: OverlayAlignment,
): OverlaySeries[] {
  const target = derived.cycles.find((c) => c.index === cycleIndex);
  if (!target) return [];
  const readings = readingsByDate(derived);
  const unit = cycleUnit(data, derived, readings, target);
  const targetRise = riseCycleDay(derived, target, unit);
  if (alignment === 'rise' && targetRise === null) return [];

  const previous = derived.cycles
    .filter((c) => c.index < cycleIndex && c.index >= cycleIndex - MAX_OVERLAY_CYCLES)
    .sort((a, b) => b.index - a.index);

  return previous.flatMap((cycle): OverlaySeries[] => {
    if (cycleUnit(data, derived, readings, cycle) !== unit) return [];
    let shift = 0;
    if (alignment === 'rise') {
      const rise = riseCycleDay(derived, cycle, unit);
      if (rise === null || targetRise === null) return [];
      shift = targetRise - rise;
    }
    const days = chartDays(data, derived, readings, cycle, unit)
      .map((d): OverlayDay => ({ x: d.cycleDay + shift, cycleDay: d.cycleDay, date: d.date, value: d.value, kind: d.kind }))
      .filter((d) => d.x >= 1);
    if (!days.some((d) => d.value !== null)) return [];
    return [{ cycleIndex: cycle.index, start: cycle.start, shift, days, segments: segmentsOf(days) }];
  });
}
