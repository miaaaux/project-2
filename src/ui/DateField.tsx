// A local-date picker that reads and writes 'YYYY-MM-DD' strings.

import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, View } from 'react-native';

import { localDateOf, type ISODate } from '../core/date';
import { Body, Button } from './components';
import { space } from './theme';

function toLocalDate(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function DateField({ label, value, onChange, max }: { label: string; value: ISODate | undefined; onChange: (d: ISODate) => void; max?: ISODate }) {
  const [open, setOpen] = useState(false);
  const shown = value ?? 'Choose a date';
  return (
    <View style={{ gap: space.xs }}>
      <Body muted small>{label}</Body>
      <Button kind="secondary" label={shown} onPress={() => setOpen(true)} />
      {open ? (
        <DateTimePicker
          value={toLocalDate(value ?? (max ?? localDateOf(new Date())))}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          maximumDate={max ? toLocalDate(max) : undefined}
          onValueChange={(_, d) => {
            onChange(localDateOf(d));
            if (Platform.OS !== 'ios') setOpen(false);
          }}
          onDismiss={() => setOpen(false)}
        />
      ) : null}
      {open && Platform.OS === 'ios' ? <Button kind="secondary" label="Done" onPress={() => setOpen(false)} /> : null}
    </View>
  );
}
