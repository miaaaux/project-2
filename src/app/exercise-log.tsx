import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useState } from 'react';

import type { ExerciseKind } from '../core/types';
import { useAppData } from '../state/AppDataProvider';
import { Body, Button, ChipGroup, Scale10, Screen, Section, Stepper } from '../ui/components';

const KINDS: { value: ExerciseKind; label: string }[] = [
  { value: 'aerobic', label: 'Walk / cardio' },
  { value: 'stretch', label: 'Stretching' },
  { value: 'yoga', label: 'Yoga' },
  { value: 'strength', label: 'Strength' },
  { value: 'relaxation', label: 'Relaxation' },
  { value: 'other', label: 'Other' },
];

export default function ExerciseLog() {
  const { clock, saveExerciseSession } = useAppData();
  const [kind, setKind] = useState<ExerciseKind | undefined>();
  const [minutes, setMinutes] = useState<number | undefined>(30);
  const [intensity, setIntensity] = useState<'easy' | 'moderate' | 'hard' | undefined>();
  const [painBefore, setPainBefore] = useState<number | undefined>();
  const [painAfter, setPainAfter] = useState<number | undefined>();

  const save = async () => {
    if (!kind || !minutes) return;
    await saveExerciseSession({ id: Crypto.randomUUID(), date: clock.today, kind, minutes, exerciseIds: [], intensity, painBefore, painAfter });
    router.back();
  };

  return (
    <Screen>
      <Section title="What did you do?">
        <ChipGroup label="Kind" options={KINDS} value={kind} onChange={setKind} />
      </Section>
      <Section title="How long?">
        <Stepper label="Minutes" value={minutes} onChange={setMinutes} step={5} min={5} max={240} format={(m) => `${m} min`} />
      </Section>
      <Section title="How hard?">
        <ChipGroup
          label="Intensity"
          options={[{ value: 'easy', label: 'Easy' }, { value: 'moderate', label: 'Moderate' }, { value: 'hard', label: 'Hard' }]}
          value={intensity}
          onChange={setIntensity}
        />
      </Section>
      <Section title="Pain (optional)">
        <Body>Before</Body>
        <Scale10 label="Pain before" value={painBefore} onChange={setPainBefore} />
        <Body>After</Body>
        <Scale10 label="Pain after" value={painAfter} onChange={setPainAfter} />
      </Section>
      <Button label="Save" onPress={save} disabled={!kind || !minutes} />
    </Screen>
  );
}
