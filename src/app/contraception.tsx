import { router } from 'expo-router';
import { useState } from 'react';

import { CONTRACEPTION_MODE } from '../core/content';
import { useAppData } from '../state/AppDataProvider';
import { Body, Button, Card, Screen, Section, Title, ToggleRow } from '../ui/components';

export default function ContraceptionMode() {
  const { data, clock, updateSettings } = useAppData();
  const mode = data.settings.contraceptionMode;
  const [ticked, setTicked] = useState<boolean[]>(() => CONTRACEPTION_MODE.acknowledgements.map(() => false));
  const allTicked = ticked.every(Boolean);

  return (
    <Screen>
      <Title>{CONTRACEPTION_MODE.title}</Title>
      {CONTRACEPTION_MODE.intro.map((p, i) => <Body key={i}>{p}</Body>)}

      <Section title="How to observe">
        {CONTRACEPTION_MODE.howToObserve.map((p, i) => <Body key={i}>• {p}</Body>)}
      </Section>

      {mode.enabled ? (
        <Card tone="infertile">
          <Body>Contraception mode is on.</Body>
          <Button kind="secondary" label="Turn off" onPress={async () => { await updateSettings({ contraceptionMode: { enabled: false } }); router.back(); }} />
        </Card>
      ) : (
        <Section title="Before you turn it on">
          {CONTRACEPTION_MODE.acknowledgements.map((a, i) => (
            <ToggleRow key={i} label={a} value={ticked[i]} onChange={(v) => setTicked((t) => t.map((x, j) => (j === i ? v : x)))} />
          ))}
          <Button
            label="Turn on contraception mode"
            disabled={!allTicked}
            onPress={async () => {
              await updateSettings({ contraceptionMode: { enabled: true, acknowledgedAt: clock.instant } });
              router.back();
            }}
          />
        </Section>
      )}
    </Screen>
  );
}
