// "What to expect" popup for cervical mucus.

import { useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';

import { MUCUS_GUIDE } from '../core/content';
import { Body, Button, Card, Title } from './components';
import { space, useTheme } from './theme';

export function MucusGuideButton() {
  const [open, setOpen] = useState(false);
  const t = useTheme();
  return (
    <>
      <Button kind="secondary" label="What to expect" onPress={() => setOpen(true)} />
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <View style={{ maxHeight: '85%', backgroundColor: t.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
            <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
              <Title>{MUCUS_GUIDE.title}</Title>
              <Body>{MUCUS_GUIDE.intro}</Body>
              {MUCUS_GUIDE.stages.map((s) => (
                <Card key={s.label}>
                  <Body>{s.label}</Body>
                  <Body muted small>{s.text}</Body>
                </Card>
              ))}
              <Body muted>{MUCUS_GUIDE.variation}</Body>
              <Body muted>{MUCUS_GUIDE.colors}</Body>
              <Button label="Close" onPress={() => setOpen(false)} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
