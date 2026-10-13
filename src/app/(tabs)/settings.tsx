import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { DISCLAIMER } from '../../core/content';
import { compareDates, type ISODate } from '../../core/date';
import { parseClockTime } from '../../core/input';
import type { ContextKind, TempRoute, TempUnit } from '../../core/types';
import { requestNotificationPermission } from '../../notifications/reminders';
import { useAppData } from '../../state/AppDataProvider';
import { Body, Button, Card, ChipGroup, Field, Screen, Section, Stepper, ToggleRow } from '../../ui/components';
import { DateField } from '../../ui/DateField';
import { space } from '../../ui/theme';

const CONTEXT_LABEL: Record<ContextKind, string> = {
  hormonal_contraception: 'Hormonal contraception',
  pregnancy: 'Pregnancy',
  postpartum: 'After giving birth',
  breastfeeding: 'Breastfeeding',
  perimenopause: 'Perimenopause',
  emergency_contraception: 'Emergency contraception',
};

export default function SettingsScreen() {
  const { data, clock, updateSettings, saveContext, deleteContext, exportData, deleteAllData } = useAppData();
  const s = data.settings;
  const [usualTime, setUsualTime] = useState(s.usualMeasurementTimes.at(-1)?.time ?? '06:30');
  const [eveningTime, setEveningTime] = useState(s.eveningObservationTime);
  const [reminderTime, setReminderTime] = useState(s.reminders.time);
  const [message, setMessage] = useState<string | null>(null);
  const [newKind, setNewKind] = useState<ContextKind | undefined>();
  const [newStart, setNewStart] = useState<ISODate | undefined>();

  const saveTime = (raw: string, apply: (t: string) => Promise<void>) => {
    const r = parseClockTime(raw);
    if (!r.ok) return setMessage(r.error);
    void apply(r.value).then(() => setMessage('Saved.'));
  };

  const setUnit = (unit: TempUnit | undefined) => {
    if (!unit || unit === s.unit) return;
    Alert.alert(
      'Change temperature unit?',
      'Readings are never converted. Mixing units in one cycle pauses temperature evaluation for that cycle, so change units only at the start of a cycle.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Change', onPress: () => void updateSettings({ unit }) }],
    );
  };

  const doExport = async () => {
    const file = await exportData();
    const out = new File(Paths.cache, `period-tracker-export-${clock.today}.json`);
    if (out.exists) out.delete();
    out.create();
    out.write(JSON.stringify(file, null, 2));
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(out.uri, { mimeType: 'application/json' });
  };

  const confirmDeleteAll = () =>
    Alert.alert('Delete all data?', 'This permanently deletes everything on this phone. It cannot be undone. Export first if you want a copy.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete everything', style: 'destructive', onPress: () => void deleteAllData() },
    ]);

  const active = data.contexts.filter((c) => !c.end || compareDates(c.end, clock.today) >= 0);

  return (
    <Screen>
      <Section title="Contraception mode">
        <Card tone={s.contraceptionMode.enabled ? 'infertile' : 'default'}>
          <Body>{s.contraceptionMode.enabled ? 'On: the app shows fertile and not-fertile days by the method rules.' : 'Off: the app shows your signs but never labels a day as not fertile.'}</Body>
          <Button kind="secondary" label={s.contraceptionMode.enabled ? 'Review or turn off' : 'Learn more'} onPress={() => router.push('/contraception')} />
        </Card>
      </Section>

      <Section title="Temperature">
        <Body>Unit</Body>
        <ChipGroup<TempUnit> label="Unit" options={[{ value: 'C', label: '°C' }, { value: 'F', label: '°F' }]} value={s.unit} onChange={setUnit} />
        <Body>Where you measure</Body>
        <ChipGroup<TempRoute>
          label="Route"
          options={[{ value: 'oral', label: 'Mouth' }, { value: 'vaginal', label: 'Vagina' }, { value: 'rectal', label: 'Rectum' }]}
          value={s.route}
          onChange={(route) => route && void updateSettings({ route })}
        />
        <Body>Thermometer steps</Body>
        <ChipGroup<string>
          label="Resolution"
          options={[{ value: '0.01', label: '0.01' }, { value: '0.05', label: '0.05' }]}
          value={String(s.thermometer.resolution)}
          onChange={(v) => v && void updateSettings({ thermometer: { ...s.thermometer, resolution: v === '0.05' ? 0.05 : 0.01 } })}
        />
        <Button
          kind="secondary"
          label="I switched to a different thermometer"
          onPress={() =>
            Alert.alert(
              'New thermometer?',
              'Readings from different thermometers are never compared, so switch at the start of a cycle if you can.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Switch', onPress: () => void updateSettings({ thermometer: { ...s.thermometer, id: Crypto.randomUUID() } }) },
              ],
            )
          }
        />
        <Field label="Usual measurement time (applies from today on)" value={usualTime} onChangeText={setUsualTime} />
        <Button
          kind="secondary"
          label="Save measurement time"
          onPress={() =>
            saveTime(usualTime, (time) =>
              updateSettings({
                usualMeasurementTimes: [
                  ...s.usualMeasurementTimes.filter((u) => compareDates(u.effectiveFrom, clock.today) < 0),
                  { effectiveFrom: clock.today, time },
                ],
              }),
            )
          }
        />
        <Field label="Evening check time for mucus" value={eveningTime} onChangeText={setEveningTime} />
        <Button kind="secondary" label="Save evening time" onPress={() => saveTime(eveningTime, (t) => updateSettings({ eveningObservationTime: t }))} />
      </Section>

      <Section title="Reminders">
        <ToggleRow label="Get-ready reminder" hint="3 days before your period: tea, heat and supplies" value={s.reminders.prepEnabled} onChange={(v) => void updateSettings({ reminders: { ...s.reminders, prepEnabled: v } })} />
        <ToggleRow label="Sugar experiment" hint="Opt-in, 2 weeks before your period. Turn this off if food reminders are not good for you." value={s.reminders.sugarEnabled} onChange={(v) => void updateSettings({ reminders: { ...s.reminders, sugarEnabled: v } })} />
        <ToggleRow label="Discreet notifications" hint="Lock-screen text never mentions periods" value={s.reminders.discreet} onChange={(v) => void updateSettings({ reminders: { ...s.reminders, discreet: v } })} />
        <Field label="Reminder time" value={reminderTime} onChangeText={setReminderTime} />
        <Button kind="secondary" label="Save reminder time" onPress={() => saveTime(reminderTime, (t) => updateSettings({ reminders: { ...s.reminders, time: t } }))} />
        <Button kind="secondary" label="Allow notifications" onPress={async () => setMessage((await requestNotificationPermission()) ? 'Notifications allowed.' : 'Notifications are off; reminders will show on the Today screen.')} />
      </Section>

      <Section title="Goals and profile">
        <Body>Sleep target</Body>
        <Stepper label="Sleep target" value={s.sleepTargetHours} onChange={(v) => v !== undefined && void updateSettings({ sleepTargetHours: v })} step={0.5} min={6} max={10} format={(h) => `${h} h`} />
        <Body>Usual cycle length (until the app has learned yours)</Body>
        <Stepper label="Usual cycle length" value={s.typicalCycleLength} onChange={(v) => void updateSettings({ typicalCycleLength: v })} step={1} min={20} max={45} format={(d) => `${d} days`} />
      </Section>

      <Section title="Life situations" hint="These pause predictions and the method rules while they apply.">
        {active.map((c) => (
          <Card key={c.id}>
            <Body>{CONTEXT_LABEL[c.kind]} since {c.start}{c.end ? ` until ${c.end}` : ''}</Body>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {!c.end ? <Button kind="secondary" label="Ended today" onPress={() => void saveContext({ ...c, end: clock.today })} /> : null}
              <Button kind="secondary" label="Delete" onPress={() => void deleteContext(c.id)} />
            </View>
          </Card>
        ))}
        <ChipGroup<ContextKind> label="Add" options={(Object.keys(CONTEXT_LABEL) as ContextKind[]).map((k) => ({ value: k, label: CONTEXT_LABEL[k] }))} value={newKind} onChange={setNewKind} />
        {newKind ? <DateField label="Since" value={newStart} onChange={setNewStart} max={clock.today} /> : null}
        {newKind && newStart ? (
          <Button label="Add" onPress={() => { void saveContext({ id: Crypto.randomUUID(), kind: newKind, start: newStart }); setNewKind(undefined); setNewStart(undefined); }} />
        ) : null}
      </Section>

      <Section title="Your data" hint="Everything stays on this phone, encrypted. There is no account and nothing is sent anywhere.">
        <Button kind="secondary" label="Export my data (JSON)" onPress={() => void doExport()} />
        <Button kind="danger" label="Delete all data" onPress={confirmDeleteAll} />
      </Section>

      {message ? <Body muted small>{message}</Body> : null}
      <Body muted small>{DISCLAIMER}</Body>
    </Screen>
  );
}
