// The cycle check-in. Until it is answered for a cycle, the method rules keep
// every day of that cycle fertile (fertility amendment A13).

import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { CONTEXT_QUESTIONS } from '../core/content';
import { isISODate } from '../core/date';
import type { CycleContextAnswer } from '../core/types';
import { useAppData } from '../state/AppDataProvider';
import { Body, Button, ChipGroup, Screen, Section } from '../ui/components';
import { shortDate } from '../ui/format';

type AnswerKey = Exclude<keyof CycleContextAnswer, 'cycleStart' | 'answeredAt'>;

export default function CheckIn() {
  const { cycleStart } = useLocalSearchParams<{ cycleStart: string }>();
  const { data, saveCycleAnswer } = useAppData();
  const previous = data.cycleContextAnswers.find((a) => a.cycleStart === cycleStart);
  const [answers, setAnswers] = useState<Partial<Record<AnswerKey, boolean>>>(() =>
    previous
      ? {
          birthInLast12Months: previous.birthInLast12Months,
          breastfeeding: previous.breastfeeding,
          hormonalContraceptionSinceLastPeriod: previous.hormonalContraceptionSinceLastPeriod,
          emergencyContraceptionSinceLastPeriod: previous.emergencyContraceptionSinceLastPeriod,
        }
      : {},
  );

  if (typeof cycleStart !== 'string' || !isISODate(cycleStart)) {
    return <Screen><Body>Open the check-in from the Today screen.</Body></Screen>;
  }
  const complete = CONTEXT_QUESTIONS.every((q) => answers[q.key] !== undefined);

  return (
    <Screen>
      <Body>For the cycle that started {shortDate(cycleStart)}. Answering “yes” to any question pauses the not-fertile labels for this cycle, because the method does not cover these situations.</Body>
      {CONTEXT_QUESTIONS.map((q) => (
        <Section key={q.key} title={q.text}>
          <ChipGroup
            label={q.text}
            value={answers[q.key] === undefined ? undefined : answers[q.key] ? 'yes' : 'no'}
            onChange={(v) => setAnswers((a) => ({ ...a, [q.key]: v === undefined ? undefined : v === 'yes' }))}
            options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
          />
        </Section>
      ))}
      <Button
        label="Save"
        disabled={!complete}
        onPress={async () => {
          await saveCycleAnswer({
            cycleStart,
            birthInLast12Months: !!answers.birthInLast12Months,
            breastfeeding: !!answers.breastfeeding,
            hormonalContraceptionSinceLastPeriod: !!answers.hormonalContraceptionSinceLastPeriod,
            emergencyContraceptionSinceLastPeriod: !!answers.emergencyContraceptionSinceLastPeriod,
          });
          router.back();
        }}
      />
    </Screen>
  );
}
