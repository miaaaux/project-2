import { View } from 'react-native';

import type { HabitStatus } from '../core/painGuide';
import { Body, Pill } from './components';
import { space } from './theme';

const NAMES: Record<HabitStatus['habit'], string> = {
  magnesium: 'Magnesium',
  exercise: 'Exercise',
  sugar: 'Less sugar',
  sleep: 'Sleep',
};

const STATE: Record<HabitStatus['state'], { label: string; tone: 'infertile' | 'inactive' | 'warning' }> = {
  on_track: { label: 'On track', tone: 'infertile' },
  off_track: { label: 'Not yet', tone: 'inactive' },
  not_enough_logs: { label: 'Not enough logs', tone: 'inactive' },
};

export function HabitList({ habits }: { habits: HabitStatus[] }) {
  return (
    <View style={{ gap: space.sm }}>
      {habits.map((h) => (
        <View key={h.habit} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Body>{NAMES[h.habit]}</Body>
          <Pill label={STATE[h.state].label} tone={STATE[h.state].tone} />
        </View>
      ))}
    </View>
  );
}
