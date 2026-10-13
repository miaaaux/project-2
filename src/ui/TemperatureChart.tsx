// Cycle temperature chart: readings, period shading, coverline, estimated
// ovulation, and mucus / sex-drive strips. Missing days are gaps, never
// interpolated; excluded and suspect readings are hollow.

import { ScrollView, useWindowDimensions } from 'react-native';
import Svg, { Circle, G, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import type { TemperatureChartData } from '../core/chart';
import { format } from '../core/input';
import { useTheme } from './theme';

const PAD_LEFT = 44;
const PAD_TOP = 12;
const PLOT_H = 220;
const STRIP_H = 22;
const DAY_W = 24;

const FLOW_OPACITY: Record<string, number> = { spotting: 0.25, light: 0.45, medium: 0.7, heavy: 0.95 };

export function TemperatureChart({ chart }: { chart: TemperatureChartData }) {
  const t = useTheme();
  const { width: screenW } = useWindowDimensions();
  const n = chart.days.length;
  const width = Math.max(screenW - 32, PAD_LEFT + n * DAY_W + 8);
  const height = PAD_TOP + PLOT_H + 16 + STRIP_H * 2 + 24;

  const x = (cycleDay: number) => PAD_LEFT + (cycleDay - 1) * DAY_W + DAY_W / 2;
  const span = Math.max(1, chart.yMax - chart.yMin);
  const y = (v: number) => PAD_TOP + ((chart.yMax - v) / span) * PLOT_H;

  const gridStep = chart.unit === 'C' ? 10 : 20; // 0.1 °C or 0.2 °F
  const gridLines: number[] = [];
  for (let v = Math.ceil(chart.yMin / gridStep) * gridStep; v <= chart.yMax; v += gridStep) gridLines.push(v);

  const byDay = new Map(chart.days.map((d) => [d.cycleDay, d]));
  const stripTop = PAD_TOP + PLOT_H + 16;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator accessibilityLabel="Temperature chart">
      <Svg width={width} height={height}>
        {/* period shading */}
        {chart.days.map((d) =>
          d.flow && d.flow !== 'none' ? (
            <Rect key={`p${d.cycleDay}`} x={x(d.cycleDay) - DAY_W / 2} y={PAD_TOP} width={DAY_W} height={PLOT_H}
              fill={t.period} opacity={(FLOW_OPACITY[d.flow] ?? 0.3) * 0.35} />
          ) : null,
        )}

        {/* grid */}
        {gridLines.map((v, i) => (
          <G key={`g${v}`}>
            <Line x1={PAD_LEFT} x2={width} y1={y(v)} y2={y(v)} stroke={t.chartGrid} strokeWidth={1} />
            {i % 2 === 0 ? (
              <SvgText x={PAD_LEFT - 6} y={y(v) + 4} fontSize={10} fill={t.textMuted} textAnchor="end">{format(v)}</SvgText>
            ) : null}
          </G>
        ))}

        {/* coverline */}
        {chart.coverline !== null && chart.fhmCycleDay !== null ? (
          <Line x1={x(Math.max(1, chart.fhmCycleDay - 6)) - DAY_W / 2} x2={width} y1={y(chart.coverline)} y2={y(chart.coverline)}
            stroke={t.accent} strokeWidth={1.5} strokeDasharray="6 4" />
        ) : null}

        {/* estimated ovulation, confirmed afterwards */}
        {chart.estimatedOvulationCycleDay !== null ? (
          <Line x1={x(chart.estimatedOvulationCycleDay)} x2={x(chart.estimatedOvulationCycleDay)} y1={PAD_TOP} y2={PAD_TOP + PLOT_H}
            stroke={t.textMuted} strokeWidth={1} strokeDasharray="3 3" />
        ) : null}

        {/* lines only across consecutive drawable days */}
        {chart.segments.map((s) => {
          const pts: string[] = [];
          for (let cd = s.from; cd <= s.to; cd++) {
            const d = byDay.get(cd);
            if (d?.value != null) pts.push(`${x(cd)},${y(d.value)}`);
          }
          return pts.length > 1 ? <Polyline key={`s${s.from}`} points={pts.join(' ')} fill="none" stroke={t.chartLine} strokeWidth={2} /> : null;
        })}

        {/* readings */}
        {chart.days.map((d) =>
          d.value == null ? null : (
            <Circle key={`r${d.cycleDay}`} cx={x(d.cycleDay)} cy={y(d.value)} r={4.5}
              fill={d.kind === 'VALID' ? t.chartLine : t.surface}
              stroke={d.kind === 'EXCLUDED' ? t.textMuted : t.chartLine} strokeWidth={1.5}
              strokeDasharray={d.kind === 'EXCLUDED' ? '2 2' : undefined} />
          ),
        )}

        {/* mucus strip */}
        <SvgText x={4} y={stripTop + 14} fontSize={10} fill={t.textMuted}>Mucus</SvgText>
        {chart.days.map((d) => (
          <G key={`m${d.cycleDay}`}>
            {d.mucusQuality !== null ? (
              <Circle cx={x(d.cycleDay)} cy={stripTop + 10} r={2 + d.mucusQuality * 1.5} fill={t.fertile} opacity={0.35 + d.mucusQuality * 0.15} />
            ) : null}
            {d.isPeak ? <SvgText x={x(d.cycleDay)} y={stripTop + 14} fontSize={10} fontWeight="bold" fill={t.text} textAnchor="middle">P</SvgText> : null}
          </G>
        ))}

        {/* sex drive strip */}
        <SvgText x={4} y={stripTop + STRIP_H + 14} fontSize={10} fill={t.textMuted}>Drive</SvgText>
        {chart.days.map((d) =>
          d.sexDrive ? (
            <Rect key={`d${d.cycleDay}`} x={x(d.cycleDay) - 3} y={stripTop + STRIP_H + 18 - d.sexDrive * 3} width={6} height={d.sexDrive * 3} fill={t.accent} opacity={0.6} />
          ) : null,
        )}

        {/* x axis: cycle days */}
        {chart.days.filter((d) => d.cycleDay === 1 || d.cycleDay % 5 === 0).map((d) => (
          <SvgText key={`x${d.cycleDay}`} x={x(d.cycleDay)} y={height - 6} fontSize={10} fill={t.textMuted} textAnchor="middle">{d.cycleDay}</SvgText>
        ))}
      </Svg>
    </ScrollView>
  );
}
