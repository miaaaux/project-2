// Round, labelled colour swatches. Tapping the selected swatch again clears it.

import { Pressable, Text, View } from 'react-native';

import type { MucusColor } from '../core/types';
import { font, space, TOUCH, useTheme } from './theme';

/** Real-world colours, the same in light and dark mode; each swatch has a border so pale ones stay visible. */
export const MUCUS_SWATCHES: { value: MucusColor; label: string; fill: string | null }[] = [
  { value: 'none', label: 'None', fill: null },
  { value: 'clear', label: 'Clear', fill: '#EEF4F7' },
  { value: 'white', label: 'White', fill: '#FFFFFF' },
  { value: 'cloudy', label: 'Cloudy', fill: '#D9DCDF' },
  { value: 'cream', label: 'Cream', fill: '#F2E2C2' },
  { value: 'yellowish', label: 'Yellowish', fill: '#EBD57A' },
  { value: 'blood_tinged', label: 'Brown / pink', fill: '#A8644E' },
  { value: 'green_grey', label: 'Green / grey', fill: '#97A387' },
];

export function ColorSwatches({ value, onChange }: { value: MucusColor | undefined; onChange: (v: MucusColor | undefined) => void }) {
  const t = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Colour" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
      {MUCUS_SWATCHES.map((s) => {
        const selected = s.value === value;
        return (
          <Pressable
            key={s.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`Colour: ${s.label}`}
            onPress={() => onChange(selected ? undefined : s.value)}
            style={{ width: 72, minHeight: TOUCH + 20, alignItems: 'center', gap: space.xs }}
          >
            <View
              style={{
                width: 40, height: 40, borderRadius: 20, backgroundColor: s.fill ?? t.surface,
                borderWidth: selected ? 3 : 1, borderColor: selected ? t.accent : t.border,
                alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
              }}
            >
              {s.fill === null ? <View style={{ width: 52, height: 2, backgroundColor: t.textMuted, transform: [{ rotate: '-45deg' }] }} /> : null}
            </View>
            <Text style={{ color: selected ? t.text : t.textMuted, fontSize: font.small, fontWeight: selected ? '700' : '400', textAlign: 'center' }}>{s.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
