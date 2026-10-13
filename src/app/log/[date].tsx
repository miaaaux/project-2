import * as Crypto from 'expo-crypto';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { compareDates, isISODate } from '../../core/date';
import { clockMinutes, format, parseClockTime, parseTemperature } from '../../core/input';
import type {
  DailyLog,
  ExclusionReason,
  Flow,
  Intercourse,
  MucusAppearance,
  MucusColor,
  MucusObservation,
  MucusSensation,
  NotAssessableReason,
  PainImpact,
  Scale5,
  SugarServings,
} from '../../core/types';
import { useAppData } from '../../state/AppDataProvider';
import { Body, Button, Card, ChipGroup, Field, Scale10, Screen, Section, Stepper, ToggleRow } from '../../ui/components';
import { shortDate } from '../../ui/format';
import { space } from '../../ui/theme';

type Draft = Omit<DailyLog, 'updatedAt'>;

const FLOW: { value: Flow; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'spotting', label: 'Spotting' },
  { value: 'light', label: 'Light' },
  { value: 'medium', label: 'Medium' },
  { value: 'heavy', label: 'Heavy' },
];
const SENSATION: { value: MucusSensation; label: string }[] = [
  { value: 'dry', label: 'Dry' },
  { value: 'nothing', label: 'Nothing felt' },
  { value: 'moist', label: 'Moist' },
  { value: 'wet', label: 'Wet' },
  { value: 'slippery', label: 'Slippery' },
];
const APPEARANCE: { value: MucusAppearance; label: string }[] = [
  { value: 'nothing', label: 'Nothing seen' },
  { value: 'sticky', label: 'Sticky' },
  { value: 'creamy', label: 'Creamy' },
  { value: 'watery', label: 'Watery' },
  { value: 'egg_white', label: 'Egg-white' },
];
const COLOR: { value: MucusColor; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'white', label: 'White' },
  { value: 'cream', label: 'Cream' },
  { value: 'yellowish', label: 'Yellowish' },
  { value: 'cloudy', label: 'Cloudy' },
  { value: 'clear', label: 'Clear' },
  { value: 'blood_tinged', label: 'Blood-tinged / brown' },
  { value: 'green_grey', label: 'Green / grey' },
];
const NOT_ASSESSABLE: { value: NotAssessableReason; label: string }[] = [
  { value: 'bleeding', label: 'Bleeding' },
  { value: 'possible_infection', label: 'Possible infection' },
  { value: 'vaginal_medication', label: 'Vaginal medication' },
  { value: 'semen', label: 'Semen' },
  { value: 'lubricant', label: 'Lubricant' },
];
const EXCLUSION: { value: ExclusionReason; label: string }[] = [
  { value: 'fever_illness', label: 'Fever / ill' },
  { value: 'alcohol', label: 'Alcohol' },
  { value: 'short_sleep', label: 'Short or broken sleep' },
  { value: 'off_time', label: 'Measured at an unusual time' },
  { value: 'travel', label: 'Travel / time zone' },
  { value: 'medication', label: 'Medication' },
  { value: 'other', label: 'Other' },
];
const IMPACT: { value: PainImpact; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'some', label: 'Some' },
  { value: 'couldnt_do_usual', label: "Couldn't do usual things" },
];
const SUGAR: { value: SugarServings; label: string }[] = [
  { value: 0, label: 'None' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3+' },
];
const SCALE5: { value: Scale5; label: string }[] = [1, 2, 3, 4, 5].map((v) => ({ value: v as Scale5, label: String(v) }));
const INTERCOURSE: { value: Intercourse; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'protected', label: 'Protected' },
  { value: 'unprotected', label: 'Unprotected' },
];

function YesNo({ label, value, onChange }: { label: string; value: boolean | undefined; onChange: (v: boolean | undefined) => void }) {
  return (
    <View style={{ gap: space.xs }}>
      <Body>{label}</Body>
      <ChipGroup
        label={label}
        value={value === undefined ? undefined : value ? 'yes' : 'no'}
        onChange={(v) => onChange(v === undefined ? undefined : v === 'yes')}
        options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
      />
    </View>
  );
}

export default function LogScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const { data, clock, saveLog, deleteLog } = useAppData();
  const { settings } = data;
  const valid = typeof date === 'string' && isISODate(date) && compareDates(date, clock.today) <= 0;

  const [draft, setDraft] = useState<Draft>(() => {
    const existing = valid ? data.logs[date] : undefined;
    if (existing) {
      const { updatedAt: _u, ...rest } = existing;
      return rest;
    }
    return { date: date as string, temperatures: [] };
  });
  const [tempRaw, setTempRaw] = useState('');
  const [tempTime, setTempTime] = useState(() =>
    date === clock.today ? clock.now.time : settings.usualMeasurementTimes.at(-1)?.time ?? '06:30',
  );
  const [excludeReason, setExcludeReason] = useState<ExclusionReason | undefined>(undefined);
  const [tempMessage, setTempMessage] = useState<string | null>(null);

  if (!valid) {
    return (
      <Screen>
        <Body>Logs can only be added for today or past days.</Body>
      </Screen>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const setMucus = (patch: Partial<MucusObservation>) =>
    setDraft((d) => ({
      ...d,
      mucus: {
        observationComplete: false,
        enteredAt: d.mucus?.enteredAt ?? clock.instant,
        ...d.mucus,
        ...patch,
        updatedAt: clock.instant,
      },
    }));

  const eveningReached =
    compareDates(date, clock.today) < 0 ||
    (clockMinutes(clock.now.time) ?? 0) >= (clockMinutes(settings.eveningObservationTime) ?? 18 * 60);

  const addReading = () => {
    const parsed = parseTemperature(tempRaw, settings.unit, settings.thermometer.resolution);
    if (!parsed.ok) return setTempMessage(parsed.error);
    const time = parseClockTime(tempTime);
    if (!time.ok) return setTempMessage(time.error);
    const reading = {
      id: Crypto.randomUUID(),
      value: parsed.value,
      unit: settings.unit,
      raw: tempRaw.trim(),
      measuredAt: time.value,
      utcOffsetMinutes: clock.deviceUtcOffsetMinutes,
      route: settings.route,
      thermometerId: settings.thermometer.id,
      excluded: excludeReason ? { reason: excludeReason } : undefined,
      enteredAt: clock.instant,
    };
    setDraft((d) => ({ ...d, temperatures: [...d.temperatures, reading] }));
    setTempRaw('');
    setExcludeReason(undefined);
    setTempMessage(`Saved as ${format(parsed.value)} °${settings.unit}${excludeReason ? ' (excluded)' : ''}.`);
  };

  const save = async () => {
    await saveLog(draft);
    router.back();
  };

  const confirmDelete = () =>
    Alert.alert('Delete this day?', 'Everything logged for this day will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteLog(date); router.back(); } },
    ]);

  const m = draft.mucus;

  return (
    <Screen>
      <Stack.Screen options={{ title: shortDate(date) }} />

      <Section title="Bleeding">
        <ChipGroup label="Flow" options={FLOW} value={draft.flow} onChange={(v) => set('flow', v)} />
        <ToggleRow label="My period started today" value={draft.periodStartConfirmed} onChange={(v) => set('periodStartConfirmed', v)} hint="Only this starts a new cycle. Spotting never does." />
        <ToggleRow label="Flooding" value={draft.flooding} onChange={(v) => set('flooding', v)} hint="Soaking a pad or tampon within 1–2 hours, or clots bigger than about 2.5 cm" />
      </Section>

      <Section title="Temperature" hint={`On waking, before getting up. Two decimals, in °${settings.unit}.`}>
        {draft.temperatures.map((r) => (
          <Card key={r.id}>
            <Body>{format(r.value)} °{r.unit} at {r.measuredAt}{r.excluded ? ' · excluded' : ''}</Body>
            <Button kind="secondary" label="Remove" onPress={() => set('temperatures', draft.temperatures.filter((x) => x.id !== r.id))} />
          </Card>
        ))}
        <Field label="Reading" value={tempRaw} onChangeText={setTempRaw} keyboardType="decimal-pad" placeholder={settings.unit === 'C' ? '36.55' : '97.79'} />
        <Field label="Measured at" value={tempTime} onChangeText={setTempTime} keyboardType="numbers-and-punctuation" />
        <Body muted small>Exclude this reading? Pick a reason, or leave empty.</Body>
        <ChipGroup label="Exclusion reason" options={EXCLUSION} value={excludeReason} onChange={setExcludeReason} />
        <Button label="Add reading" onPress={addReading} />
        {tempMessage ? <Body muted small>{tempMessage}</Body> : null}
        <ToggleRow label="Ill today" value={draft.illness} onChange={(v) => set('illness', v)} />
        <ToggleRow label="Alcohol last evening" value={draft.alcoholPreviousEvening} onChange={(v) => set('alcoholPreviousEvening', v)} />
      </Section>

      <Section title="Cervical mucus" hint="Notice how it feels and looks through the day; record the most fertile observation.">
        <Body>Feeling</Body>
        <ChipGroup label="Sensation" options={SENSATION} value={m?.sensation} onChange={(v) => setMucus({ sensation: v })} />
        <Body>Appearance</Body>
        <ChipGroup label="Appearance" options={APPEARANCE} value={m?.appearance} onChange={(v) => setMucus({ appearance: v })} />
        <ToggleRow label="Stretchy" value={m?.stretchy} onChange={(v) => setMucus({ stretchy: v })} />
        <Body>Color</Body>
        <ChipGroup label="Color" options={COLOR} value={m?.color} onChange={(v) => setMucus({ color: v })} />
        <ToggleRow label="I'm unsure" value={m?.unsure} onChange={(v) => setMucus({ unsure: v })} hint="Unsure days are counted as possibly fertile." />
        <Body muted small>Couldn’t assess it because of:</Body>
        <ChipGroup label="Not assessable" options={NOT_ASSESSABLE} value={m?.notAssessable} onChange={(v) => setMucus({ notAssessable: v })} />
        <ToggleRow
          label="This is the most fertile observation of my day"
          value={m?.observationComplete}
          onChange={(v) => {
            if (v && !eveningReached) return;
            setMucus({ observationComplete: v, completedAt: v ? clock.instant : undefined });
          }}
          hint={eveningReached ? 'Confirm in the evening, once the day is done.' : `Available from ${settings.eveningObservationTime}.`}
        />
      </Section>

      <Section title="Sex">
        <Body>Sex drive</Body>
        <ChipGroup label="Sex drive" options={SCALE5} value={draft.sexDrive} onChange={(v) => set('sexDrive', v)} />
        <Body>Intercourse</Body>
        <ChipGroup label="Intercourse" options={INTERCOURSE} value={draft.intercourse} onChange={(v) => set('intercourse', v)} />
      </Section>

      <Section title="Comfort">
        <Body>Cramps (0–10)</Body>
        <Scale10 label="Cramps" value={draft.cramps} onChange={(v) => set('cramps', v)} />
        <Body>Headache (0–10)</Body>
        <Scale10 label="Headache" value={draft.headache} onChange={(v) => set('headache', v)} />
        <Body>Effect on your day</Body>
        <ChipGroup label="Impact" options={IMPACT} value={draft.painImpact} onChange={(v) => set('painImpact', v)} />
        <YesNo label="Woke up because of cramps" value={draft.wokeFromCramps} onChange={(v) => set('wokeFromCramps', v)} />
        <Body>Pain relief doses</Body>
        <Stepper label="Pain relief doses" value={draft.painReliefDoses} onChange={(v) => set('painReliefDoses', v)} step={1} min={0} max={10} />
        <YesNo label="Used heat" value={draft.heatUsed} onChange={(v) => set('heatUsed', v)} />
        <YesNo label="Had tea" value={draft.teaTaken} onChange={(v) => set('teaTaken', v)} />
      </Section>

      <Section title="Habits">
        <Body>Sleep last night</Body>
        <Stepper label="Sleep" value={draft.sleepHours} onChange={(v) => set('sleepHours', v)} step={0.5} min={0} max={16} format={(h) => `${h} h`} />
        <Body>Sleep quality</Body>
        <ChipGroup label="Sleep quality" options={SCALE5} value={draft.sleepQuality} onChange={(v) => set('sleepQuality', v)} />
        <Body>Sweet foods or drinks today</Body>
        <ChipGroup label="Sugar" options={SUGAR} value={draft.sugarServings} onChange={(v) => set('sugarServings', v)} />
        <YesNo label="Took magnesium" value={draft.magnesiumTaken} onChange={(v) => set('magnesiumTaken', v)} />
        {draft.magnesiumTaken ? (
          <Field
            label="Magnesium (mg, optional; use the amount on the label)"
            value={draft.magnesiumMg === undefined ? '' : String(draft.magnesiumMg)}
            onChangeText={(t) => set('magnesiumMg', /^\d{1,4}$/.test(t) ? Number(t) : undefined)}
            keyboardType="number-pad"
          />
        ) : null}
      </Section>

      <Field label="Note" value={draft.note ?? ''} onChangeText={(t) => set('note', t || undefined)} multiline style={{ minHeight: 80 }} />

      <Button label="Save" onPress={save} />
      {data.logs[date] ? <Button kind="danger" label="Delete this day" onPress={confirmDelete} /> : null}
    </Screen>
  );
}
