import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { HABIT_INFO, PAIN_FOOTER, RED_FLAG_TEXT, patternSentence, prepCardMessage } from '../../core/content';
import { isInPeriod } from '../../core/cycles';
import { compareDates } from '../../core/date';
import { exerciseDaysPerWeek, suggestRoutines, WEEKLY_EXERCISE_DAYS_GOAL } from '../../core/exercises';
import { useAppData } from '../../state/AppDataProvider';
import { Body, Button, Card, Pill, Screen, Section, Title } from '../../ui/components';
import { HabitList } from '../../ui/HabitList';
import { space } from '../../ui/theme';

type InfoKey = keyof typeof HABIT_INFO;

export default function Insights() {
  const { data, derived, clock } = useAppData();
  const [open, setOpen] = useState<InfoKey | null>(null);
  if (!derived) return null;

  const today = clock.today;
  const todayLog = data.logs[today];
  const cycle = derived.currentCycle;
  const rise = cycle ? derived.fertility.cycles.find((c) => c.cycleIndex === cycle.index)?.rise : null;
  const phase = !cycle
    ? 'unknown'
    : isInPeriod(cycle, today)
      ? 'menstrual'
      : rise && compareDates(rise.fhmDate, today) <= 0
        ? 'luteal'
        : 'follicular';
  const gentleOnly = (todayLog?.cramps ?? 0) >= 6 || todayLog?.flow === 'heavy' || !!todayLog?.flooding;
  const madeWorse = data.exercise.flatMap((s) => s.madeWorse ?? []);
  const routines = suggestRoutines({ phase, gentleOnly, madeWorse });
  const daysPerWeek = exerciseDaysPerWeek(data.exercise, today);

  return (
    <Screen>
      <Title>Pain guide</Title>

      {derived.redFlags.map((f) => (
        <Card key={f.code} tone="warning">
          <Body>{RED_FLAG_TEXT[f.code].title}</Body>
          <Body muted>{RED_FLAG_TEXT[f.code].body}</Body>
        </Card>
      ))}

      {derived.prepCard ? (
        <Section title="Period prep">
          <Card>
            <Body muted>{prepCardMessage(derived.prepCard.onTrackCount, derived.prepCard.knownCount)}</Body>
            <HabitList habits={derived.prepCard.habits} />
          </Card>
        </Section>
      ) : null}

      <Section title="Your patterns" hint="Comparisons appear once you have at least 3 cycles with and 3 without a habit.">
        {derived.patterns.map((p) => (
          <Card key={p.habit}>
            <Body>{patternSentence(p)}</Body>
          </Card>
        ))}
      </Section>

      <Section title="Period exercises" hint={`${daysPerWeek.toFixed(1)} exercise days a week lately · goal ${WEEKLY_EXERCISE_DAYS_GOAL}. Give it 2–3 cycles before judging.`}>
        {gentleOnly ? <Body muted small>Showing gentle options only today.</Body> : null}
        {routines.map((r) => (
          <Card key={r.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Body>{r.name}</Body>
              <Pill label={`${r.minutes} min`} tone="inactive" />
            </View>
            <Body muted small>{r.schedule}</Body>
            <Button kind="secondary" label="Open" onPress={() => router.push({ pathname: '/routine/[id]', params: { id: r.id } })} />
          </Card>
        ))}
        <Button kind="secondary" label="Log other exercise" onPress={() => router.push('/exercise-log')} />
      </Section>

      <Section title="What the evidence says">
        {(Object.keys(HABIT_INFO) as InfoKey[]).map((k) => (
          <Card key={k}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm }}>
              <Body>{HABIT_INFO[k].title}</Body>
              <Pill label={`Evidence: ${HABIT_INFO[k].evidence}`} tone="inactive" />
            </View>
            {open === k ? <Body muted>{HABIT_INFO[k].body}</Body> : null}
            <Button kind="secondary" label={open === k ? 'Hide' : 'Read more'} onPress={() => setOpen(open === k ? null : k)} />
          </Card>
        ))}
      </Section>

      <Body muted small>{PAIN_FOOTER}</Body>
    </Screen>
  );
}
