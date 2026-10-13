import { useState } from 'react';
import { View } from 'react-native';

import { temperatureChart } from '../../core/chart';
import { useAppData } from '../../state/AppDataProvider';
import { Body, Button, Card, Screen, Title } from '../../ui/components';
import { range } from '../../ui/format';
import { TemperatureChart } from '../../ui/TemperatureChart';
import { space } from '../../ui/theme';

export default function ChartScreen() {
  const { data, derived } = useAppData();
  const [picked, setPicked] = useState<number | null>(null);
  if (!derived) return null;

  const cycles = derived.cycles;
  if (cycles.length === 0) {
    return (
      <Screen>
        <Title>Temperature chart</Title>
        <Body muted>Log a period start to see your first cycle chart.</Body>
      </Screen>
    );
  }
  const index = picked ?? cycles[cycles.length - 1].index;
  const cycle = cycles[index];
  const chart = temperatureChart(data, derived, index);
  const summary = derived.fertility.cycles.find((c) => c.cycleIndex === index);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
        <Button kind="secondary" label="‹" disabled={index === 0} onPress={() => setPicked(index - 1)} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Title>Cycle {index + 1}</Title>
          <Body muted small>{range(cycle.start, cycle.end ?? cycle.start)}{cycle.end ? '' : ' (current)'}</Body>
        </View>
        <Button kind="secondary" label="›" disabled={index === cycles.length - 1} onPress={() => setPicked(index + 1)} />
      </View>

      <TemperatureChart chart={chart} />

      <Card>
        {summary?.rise ? (
          <Body>Temperature rise on cycle day {chart.fhmCycleDay}. The dashed line is the coverline; ovulation is estimated just before the rise and is only confirmed afterwards.</Body>
        ) : (
          <Body>No temperature rise detected in this cycle yet.</Body>
        )}
        {summary?.temperatureBlocked ? <Body muted small>Temperature evaluation is paused for this cycle; see the Today screen for why.</Body> : null}
        <Body muted small>Hollow dots are excluded or suspect readings: they are shown but not used to detect the rise. Gaps are days without a reading.</Body>
      </Card>
    </Screen>
  );
}
