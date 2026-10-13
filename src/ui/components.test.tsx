import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { ChipGroup, Stepper } from './components';

function FlowPicker() {
  const [v, setV] = useState<string | undefined>(undefined);
  return (
    <ChipGroup
      label="Flow"
      value={v}
      onChange={setV}
      options={[{ value: 'light', label: 'Light' }, { value: 'heavy', label: 'Heavy' }]}
    />
  );
}

test('a chip toggles on, and tapping it again clears back to not logged', async () => {
  await render(<FlowPicker />);
  const light = screen.getByLabelText('Flow: Light');
  await fireEvent.press(light);
  expect(screen.getByLabelText('Flow: Light')).toBeSelected();
  await fireEvent.press(screen.getByLabelText('Flow: Light'));
  expect(screen.getByLabelText('Flow: Light')).not.toBeSelected();
});

function SleepStepper() {
  const [v, setV] = useState<number | undefined>(undefined);
  return <Stepper label="Sleep" value={v} onChange={setV} step={0.5} min={0} max={16} format={(h) => `${h} h`} />;
}

test('the stepper starts at "not logged" and never goes out of range', async () => {
  await render(<SleepStepper />);
  expect(screen.getByText('not logged')).toBeTruthy();
  await fireEvent.press(screen.getByText('+'));
  expect(screen.getByText('0 h')).toBeTruthy();
  await fireEvent.press(screen.getByText('−'));
  expect(screen.getByText('0 h')).toBeTruthy();
});
