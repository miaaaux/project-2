// Shown above every screen: loading and error states, the onboarding redirect,
// and the blocking alert when an edit turns a day the user saw as not fertile
// into a fertile one (fertility amendment A17).

import { Redirect, usePathname } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Modal, View } from 'react-native';

import { EDIT_ALERT_TEXT } from '../core/content';
import { useAppData } from '../state/AppDataProvider';
import { Body, Button, Card, Screen, Title } from './components';
import { space, useTheme } from './theme';

export function Gate({ children }: { children: ReactNode }) {
  const { ready, error, data, editAlert, dismissEditAlert } = useAppData();
  const pathname = usePathname();
  const t = useTheme();

  if (error) {
    return (
      <Screen>
        <Title>Something went wrong</Title>
        <Body>Your data could not be opened. Nothing has been deleted. Please restart the app.</Body>
        <Body muted small>{error}</Body>
      </Screen>
    );
  }
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}>
        <ActivityIndicator accessibilityLabel="Loading" />
      </View>
    );
  }
  if (!data.settings.onboardedAt && pathname !== '/onboarding') {
    return <Redirect href="/onboarding" />;
  }

  return (
    <>
      {children}
      <Modal visible={!!editAlert} animationType="slide" transparent onRequestClose={dismissEditAlert}>
        <View style={{ flex: 1, justifyContent: 'center', padding: space.lg, backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <Card tone="warning">
            <Title>{EDIT_ALERT_TEXT.title}</Title>
            <Body>{EDIT_ALERT_TEXT.body}</Body>
            {editAlert ? <Body>Days affected: {editAlert.dates.join(', ')}</Body> : null}
            {editAlert && editAlert.unprotectedDates.length > 0 ? (
              <Body>{EDIT_ALERT_TEXT.unprotected} {editAlert.unprotectedDates.join(', ')}</Body>
            ) : null}
            <Button label="I understand" onPress={dismissEditAlert} />
          </Card>
        </View>
      </Modal>
    </>
  );
}
