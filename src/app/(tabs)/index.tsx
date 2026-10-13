import { router } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import {
  FERTILITY_REASON_TEXT,
  FERTILITY_STATUS_TEXT,
  LATE_PERIOD_TEXT,
  PAIN_FOOTER,
  RED_FLAG_TEXT,
  REMINDER_TEXT,
  prepCardMessage,
} from '../../core/content';
import { cycleDay } from '../../core/cycles';
import { compareDates } from '../../core/date';
import { useAppData } from '../../state/AppDataProvider';
import { Body, Button, Card, Pill, Screen, Title } from '../../ui/components';
import { range, shortDate } from '../../ui/format';
import { HabitList } from '../../ui/HabitList';
import { space } from '../../ui/theme';

export default function Today() {
  const { data, derived, clock, saveLog, markFertilityShown } = useAppData();
  const today = clock.today;
  const fertility = derived?.fertilityVisible ? derived.todayFertility : null;

  useEffect(() => {
    if (fertility) void markFertilityShown(today, fertility.status).catch(() => undefined);
  }, [fertility, today, markFertilityShown]);

  if (!derived) return null;
  const { currentCycle, prediction, redFlags, prepCard, reminders } = derived;

  const bleedPrompts = derived.unconfirmedBleedingStarts.filter((d) => !data.logs[d]?.notPeriodStart);
  const needsCheckin = currentCycle && !data.cycleContextAnswers.some((a) => a.cycleStart === currentCycle.start);
  const dueReminders = reminders.filter((r) => compareDates(r.fireDate, today) <= 0);
  const showPrep = prepCard && prediction.lo && prediction.status !== 'late' && compareDates(today, prediction.lo) >= -14;
  const cycleSummary = currentCycle ? derived.fertility.cycles.find((c) => c.cycleIndex === currentCycle.index) : undefined;

  return (
    <Screen>
      <View style={{ gap: space.xs }}>
        <Title>{shortDate(today)}</Title>
        {currentCycle ? <Body muted>Cycle day {cycleDay(currentCycle, today)}</Body> : <Body muted>Log your period to start tracking.</Body>}
      </View>

      {bleedPrompts.map((d) => (
        <Card key={d} tone="period">
          <Body>Did your period start on {shortDate(d)}?</Body>
          <Button label="Yes, it did" onPress={async () => {
            await saveLog({ ...data.logs[d], periodStartConfirmed: true });
            router.push({ pathname: '/checkin', params: { cycleStart: d } });
          }} />
          <Button kind="secondary" label="No, it was bleeding between periods" onPress={() => saveLog({ ...data.logs[d], notPeriodStart: true })} />
        </Card>
      ))}

      {needsCheckin ? (
        <Card tone="warning">
          <Body>Quick check-in for this cycle: four questions that keep the predictions and fertility rules accurate.</Body>
          <Button label="Answer now" onPress={() => router.push({ pathname: '/checkin', params: { cycleStart: currentCycle!.start } })} />
        </Card>
      ) : null}

      {fertility ? (
        <Card tone={fertility.status === 'fertile' ? 'fertile' : fertility.status === 'not_applicable' ? 'default' : 'infertile'}>
          <Pill
            label={FERTILITY_STATUS_TEXT[fertility.status].label}
            tone={fertility.status === 'fertile' ? 'fertile' : fertility.status === 'not_applicable' ? 'inactive' : 'infertile'}
          />
          <Body>{FERTILITY_STATUS_TEXT[fertility.status].detail}</Body>
          {fertility.eveningTransition ? <Body>{FERTILITY_REASON_TEXT.evening_transition}</Body> : null}
          {fertility.reasons.filter((r) => r !== 'evening_transition').map((r) => (
            <Body key={r} muted small>• {FERTILITY_REASON_TEXT[r]}</Body>
          ))}
        </Card>
      ) : (
        <Card>
          <Body>Fertility signs this cycle</Body>
          <Body muted small>
            {cycleSummary?.rise ? 'Temperature rise detected.' : 'No temperature rise detected yet.'}{' '}
            {cycleSummary?.mucus.peakDate ? `Mucus peak on ${shortDate(cycleSummary.mucus.peakDate)}.` : ''}
          </Body>
          {!data.settings.contraceptionMode.enabled ? (
            <Button kind="secondary" label="About contraception mode" onPress={() => router.push('/contraception')} />
          ) : null}
        </Card>
      )}

      {prediction.lo && prediction.hi ? (
        prediction.status === 'late' ? (
          <Card tone="warning">
            <Title>{LATE_PERIOD_TEXT.title}</Title>
            <Body>Your period is {prediction.lateByDays} {prediction.lateByDays === 1 ? 'day' : 'days'} later than your usual range.</Body>
            <Body>{LATE_PERIOD_TEXT.body}</Body>
            {LATE_PERIOD_TEXT.urgentSymptoms.map((s) => <Body key={s} small>• {s}</Body>)}
          </Card>
        ) : (
          <Card>
            <Body>{prediction.status === 'in_range' ? 'Your period may start any day' : 'Next period likely'}: {range(prediction.lo, prediction.hi)}</Body>
            {prediction.regular === false ? <Body muted small>Your cycles vary, so this range is wide.</Body> : null}
          </Card>
        )
      ) : null}

      {dueReminders.map((r) => (
        <Card key={r.key}>
          <Body>{REMINDER_TEXT[r.type].title}</Body>
          <Body muted>{REMINDER_TEXT[r.type].body}</Body>
        </Card>
      ))}

      {showPrep && prepCard ? (
        <Card>
          <Body>Period prep</Body>
          <Body muted>{prepCardMessage(prepCard.onTrackCount, prepCard.knownCount)}</Body>
          <HabitList habits={prepCard.habits} />
        </Card>
      ) : null}

      {redFlags.map((f) => (
        <Card key={f.code} tone="warning">
          <Body>{RED_FLAG_TEXT[f.code].title}</Body>
          <Body muted>{RED_FLAG_TEXT[f.code].body}</Body>
        </Card>
      ))}

      <Button label="Log today" onPress={() => router.push({ pathname: '/log/[date]', params: { date: today } })} />
      <Button kind="secondary" label="Log exercise" onPress={() => router.push('/exercise-log')} />
      <Body muted small>{PAIN_FOOTER}</Body>
    </Screen>
  );
}
