import { router } from 'expo-router';
import { useState } from 'react';

import { CONTEXT_QUESTIONS, DISCLAIMER } from '../core/content';
import { parseClockTime } from '../core/input';
import type { CycleContextAnswer, TempUnit } from '../core/types';
import { requestNotificationPermission } from '../notifications/reminders';
import { useAppData } from '../state/AppDataProvider';
import { Body, Button, Card, ChipGroup, Field, Screen, Section, Stepper, Title, ToggleRow } from '../ui/components';
import { DateField } from '../ui/DateField';

type AnswerKey = Exclude<keyof CycleContextAnswer, 'cycleStart' | 'answeredAt'>;

export default function Onboarding() {
  const { data, clock, saveLog, saveCycleAnswer, updateSettings } = useAppData();
  const [lastStart, setLastStart] = useState<string | undefined>();
  const [dontRemember, setDontRemember] = useState(false);
  const [cycleLength, setCycleLength] = useState<number | undefined>();
  const [birthYear, setBirthYear] = useState('');
  const [answers, setAnswers] = useState<Partial<Record<AnswerKey, boolean>>>({});
  const [unit, setUnit] = useState<TempUnit>('C');
  const [usualTime, setUsualTime] = useState('06:30');
  const [error, setError] = useState<string | null>(null);

  const needsAnswers = !!lastStart && !dontRemember;
  const answered = CONTEXT_QUESTIONS.every((q) => answers[q.key] !== undefined);
  const canFinish = (dontRemember || !!lastStart) && (!needsAnswers || answered);

  const finish = async () => {
    const time = parseClockTime(usualTime);
    if (!time.ok) return setError(time.error);
    const year = /^\d{4}$/.test(birthYear) ? Number(birthYear) : undefined;
    if (needsAnswers && lastStart) {
      await saveLog({ ...(data.logs[lastStart] ?? { date: lastStart, temperatures: [] }), periodStartConfirmed: true });
      await saveCycleAnswer({
        cycleStart: lastStart,
        birthInLast12Months: !!answers.birthInLast12Months,
        breastfeeding: !!answers.breastfeeding,
        hormonalContraceptionSinceLastPeriod: !!answers.hormonalContraceptionSinceLastPeriod,
        emergencyContraceptionSinceLastPeriod: !!answers.emergencyContraceptionSinceLastPeriod,
      });
    }
    await updateSettings({
      unit,
      typicalCycleLength: cycleLength,
      birthYear: year,
      // The first usual time also covers the past: there are no readings yet.
      usualMeasurementTimes: [{ effectiveFrom: '1970-01-01', time: time.value }],
      onboardedAt: clock.instant,
    });
    await requestNotificationPermission().catch(() => false);
    router.replace('/');
  };

  return (
    <Screen>
      <Title>Welcome</Title>
      <Body>Track your period, your temperature and cervical mucus, and the habits that may help with period pain. Everything stays encrypted on this phone.</Body>
      <Card><Body muted small>{DISCLAIMER}</Body></Card>

      <Section title="When did your last period start?">
        {!dontRemember ? <DateField label="First day of bleeding" value={lastStart} onChange={setLastStart} max={clock.today} /> : null}
        <ToggleRow label="I don't remember" value={dontRemember} onChange={setDontRemember} hint="You can log your next period instead." />
      </Section>

      <Section title="How long is your cycle usually?" hint="From the first day of one period to the first day of the next. Leave it if you don't know.">
        <Stepper label="Usual cycle length" value={cycleLength} onChange={setCycleLength} step={1} min={20} max={45} format={(d) => `${d} days`} />
      </Section>

      {needsAnswers ? (
        <Section title="A few questions about this cycle">
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
        </Section>
      ) : null}

      <Section title="Temperature" hint="Measure on waking, before getting up, at about the same time each day.">
        <ChipGroup<TempUnit> label="Unit" options={[{ value: 'C', label: '°C' }, { value: 'F', label: '°F' }]} value={unit} onChange={(u) => u && setUnit(u)} />
        <Field label="Usual measurement time" value={usualTime} onChangeText={setUsualTime} />
      </Section>

      <Section title="Year of birth (optional)" hint="Used only to judge how regular your cycles are for your age.">
        <Field label="Year of birth" value={birthYear} onChangeText={setBirthYear} keyboardType="number-pad" maxLength={4} />
      </Section>

      {error ? <Body>{error}</Body> : null}
      <Button label="Start" disabled={!canFinish} onPress={() => void finish()} />
    </Screen>
  );
}
