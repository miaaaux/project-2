// Colour and spacing tokens, light and dark.
//
// Fertility colours deliberately avoid green: no day is ever presented as "safe".

import { useColorScheme } from 'react-native';

export interface Theme {
  dark: boolean;
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  onAccent: string;
  period: string;
  periodSoft: string;
  fertile: string;
  fertileSoft: string;
  infertile: string;
  infertileSoft: string;
  inactive: string;
  warning: string;
  warningSoft: string;
  danger: string;
  chartLine: string;
  chartGrid: string;
}

const light: Theme = {
  dark: false,
  bg: '#FAF7F5',
  surface: '#FFFFFF',
  surfaceAlt: '#F2ECE8',
  border: '#E3DAD4',
  text: '#2B2321',
  textMuted: '#6E625D',
  accent: '#8E3B5A',
  onAccent: '#FFFFFF',
  period: '#B3261E',
  periodSoft: '#F6D9D7',
  fertile: '#B4436C',
  fertileSoft: '#F7DCE6',
  infertile: '#4F6475',
  infertileSoft: '#DDE5EB',
  inactive: '#8A8A8A',
  warning: '#8A5A00',
  warningSoft: '#FCEFD2',
  danger: '#B3261E',
  chartLine: '#4F6475',
  chartGrid: '#E3DAD4',
};

const dark: Theme = {
  dark: true,
  bg: '#161213',
  surface: '#221C1D',
  surfaceAlt: '#2C2526',
  border: '#3E3536',
  text: '#F2EAE7',
  textMuted: '#B7AAA6',
  accent: '#E59AB7',
  onAccent: '#2B1320',
  period: '#F2867E',
  periodSoft: '#4A2221',
  fertile: '#EE9BBB',
  fertileSoft: '#4A2434',
  infertile: '#A9BDCB',
  infertileSoft: '#26323B',
  inactive: '#8A8A8A',
  warning: '#F0C46A',
  warningSoft: '#3E3218',
  danger: '#F2867E',
  chartLine: '#A9BDCB',
  chartGrid: '#3E3536',
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const font = { small: 13, body: 16, title: 20, hero: 28 } as const;
/** Minimum touch target (iOS HIG 44 pt, Android 48 dp). */
export const TOUCH = 48;
