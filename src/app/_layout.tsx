import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppDataProvider } from '../state/AppDataProvider';
import { Gate } from '../ui/Gate';
import { useTheme } from '../ui/theme';

export default function RootLayout() {
  const t = useTheme();
  return (
    <SafeAreaProvider>
      <AppDataProvider>
        <StatusBar style={t.dark ? 'light' : 'dark'} />
        <Gate>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: t.surface },
              headerTintColor: t.text,
              contentStyle: { backgroundColor: t.bg },
              headerBackTitle: 'Back',
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="log/[date]" options={{ title: 'Log' }} />
            <Stack.Screen name="onboarding" options={{ title: 'Welcome', headerBackVisible: false, gestureEnabled: false }} />
            <Stack.Screen name="contraception" options={{ title: 'Contraception mode' }} />
            <Stack.Screen name="checkin" options={{ title: 'Cycle check-in' }} />
            <Stack.Screen name="routine/[id]" options={{ title: 'Routine' }} />
            <Stack.Screen name="exercise-log" options={{ title: 'Log exercise' }} />
          </Stack>
        </Gate>
      </AppDataProvider>
    </SafeAreaProvider>
  );
}
