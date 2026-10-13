import * as Crypto from 'expo-crypto';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { EXERCISES, ROUTINES } from '../../core/exercises';
import { useAppData } from '../../state/AppDataProvider';
import { Body, Button, Card, Scale10, Screen, Section, Stepper, ToggleRow } from '../../ui/components';

export default function RoutineScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { clock, saveExerciseSession } = useAppData();
  const routine = ROUTINES.find((r) => r.id === id);
  const [minutes, setMinutes] = useState<number | undefined>(routine?.minutes);
  const [painBefore, setPainBefore] = useState<number | undefined>();
  const [painAfter, setPainAfter] = useState<number | undefined>();
  const [worse, setWorse] = useState<string[]>([]);

  if (!routine) return <Screen><Body>This routine no longer exists.</Body></Screen>;
  const exercises = routine.exerciseIds.map((eid) => EXERCISES.find((e) => e.id === eid)).filter((e) => e !== undefined);

  const save = async () => {
    if (!minutes) return;
    const kind = exercises[0]?.kind ?? 'other';
    await saveExerciseSession({
      id: Crypto.randomUUID(),
      date: clock.today,
      kind,
      minutes,
      routineId: routine.id,
      exerciseIds: routine.exerciseIds,
      painBefore,
      painAfter,
      madeWorse: worse.length ? worse : undefined,
    });
    router.back();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: routine.name }} />
      <Card>
        <Body>{routine.schedule}</Body>
        <Body muted small>Based on: {routine.basedOn}</Body>
      </Card>

      {exercises.map((e) => (
        <Section key={e.id} title={e.name} hint={e.dose}>
          {e.steps.map((s, i) => <Body key={i}>{i + 1}. {s}</Body>)}
          {e.cautions.map((c, i) => <Body key={`c${i}`} muted small>⚠︎ {c}</Body>)}
          <Body muted small>Evidence ({e.evidence.quality.replace('_', ' ')}): {e.evidence.summary}</Body>
          <ToggleRow
            label="This made my pain worse"
            value={worse.includes(e.id)}
            onChange={(v) => setWorse((w) => (v ? [...w, e.id] : w.filter((x) => x !== e.id)))}
            hint="It won't be suggested again."
          />
        </Section>
      ))}

      <Section title="Log this session">
        <Stepper label="Minutes" value={minutes} onChange={setMinutes} step={5} min={5} max={180} format={(m) => `${m} min`} />
        <Body>Pain before (optional)</Body>
        <Scale10 label="Pain before" value={painBefore} onChange={setPainBefore} />
        <Body>Pain after (optional)</Body>
        <Scale10 label="Pain after" value={painAfter} onChange={setPainAfter} />
        <Button label="Save session" onPress={save} disabled={!minutes} />
        <Body muted small>Stop if pain gets sharply worse, or if you feel dizzy or faint.</Body>
      </Section>
    </Screen>
  );
}
