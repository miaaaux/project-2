// Shared building blocks for every screen. Keep screens free of ad-hoc styling.

import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { font, radius, space, TOUCH, useTheme } from './theme';

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const t = useTheme();
  const body = <View style={{ padding: space.lg, gap: space.lg }}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['left', 'right']}>
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled">{body}</ScrollView> : body}
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <Text accessibilityRole="header" style={{ color: t.text, fontSize: font.title, fontWeight: '700' }}>
      {children}
    </Text>
  );
}

export function Body({ children, muted, small }: { children: ReactNode; muted?: boolean; small?: boolean }) {
  const t = useTheme();
  return (
    <Text style={{ color: muted ? t.textMuted : t.text, fontSize: small ? font.small : font.body, lineHeight: small ? 18 : 22 }}>
      {children}
    </Text>
  );
}

export function Card({ children, tone }: { children: ReactNode; tone?: 'default' | 'warning' | 'fertile' | 'infertile' | 'period' }) {
  const t = useTheme();
  const bg =
    tone === 'warning' ? t.warningSoft
    : tone === 'fertile' ? t.fertileSoft
    : tone === 'infertile' ? t.infertileSoft
    : tone === 'period' ? t.periodSoft
    : t.surface;
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.lg, padding: space.lg, gap: space.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border }}>
      {children}
    </View>
  );
}

export function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Text accessibilityRole="header" style={{ color: t.text, fontSize: font.body, fontWeight: '700' }}>{title}</Text>
      {hint ? <Text style={{ color: t.textMuted, fontSize: font.small }}>{hint}</Text> : null}
      {children}
    </View>
  );
}

export function Button({ label, onPress, kind = 'primary', disabled }: { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; disabled?: boolean }) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.accent : kind === 'danger' ? t.danger : t.surfaceAlt;
  const fg = kind === 'secondary' ? t.text : t.onAccent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH, borderRadius: radius.md, backgroundColor: bg, alignItems: 'center', justifyContent: 'center',
        paddingHorizontal: space.lg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
      })}
    >
      <Text style={{ color: fg, fontSize: font.body, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export interface ChipOption<T> { value: T; label: string }

/** Single choice; tapping the selected chip again clears it (back to "not logged"). */
export function ChipGroup<T extends string | number>({ options, value, onChange, label }: {
  options: ChipOption<T>[]; value: T | undefined; onChange: (v: T | undefined) => void; label: string;
}) {
  const t = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${label}: ${o.label}`}
            onPress={() => onChange(selected ? undefined : o.value)}
            style={{
              minHeight: TOUCH - 8, minWidth: TOUCH - 8, paddingHorizontal: space.md, borderRadius: radius.pill,
              justifyContent: 'center', alignItems: 'center', borderWidth: 1,
              borderColor: selected ? t.accent : t.border, backgroundColor: selected ? t.accent : t.surface,
            }}
          >
            <Text style={{ color: selected ? t.onAccent : t.text, fontSize: font.body }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 0-10 scale; undefined means not logged. */
export function Scale10({ value, onChange, label }: { value: number | undefined; onChange: (v: number | undefined) => void; label: string }) {
  return (
    <ChipGroup
      label={label}
      value={value}
      onChange={onChange}
      options={Array.from({ length: 11 }, (_, i) => ({ value: i, label: String(i) }))}
    />
  );
}

export function ToggleRow({ label, value, onChange, hint }: { label: string; value: boolean | undefined; onChange: (v: boolean) => void; hint?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: TOUCH, gap: space.md }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: font.body }}>{label}</Text>
        {hint ? <Text style={{ color: t.textMuted, fontSize: font.small }}>{hint}</Text> : null}
      </View>
      <Switch accessibilityLabel={label} value={!!value} onValueChange={onChange} />
    </View>
  );
}

export function Stepper({ value, onChange, step, min, max, label, format }: {
  value: number | undefined; onChange: (v: number | undefined) => void; step: number; min: number; max: number; label: string; format?: (v: number) => string;
}) {
  const t = useTheme();
  const shown = value === undefined ? 'not logged' : format ? format(value) : String(value);
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v / step) * step)));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }} accessibilityLabel={`${label}: ${shown}`}>
      <Button kind="secondary" label="−" onPress={() => set((value ?? min) - step)} />
      <Text style={{ color: t.text, fontSize: font.body, minWidth: 96, textAlign: 'center' }}>{shown}</Text>
      <Button kind="secondary" label="+" onPress={() => set(value === undefined ? min : value + step)} />
      {value !== undefined ? <Button kind="secondary" label="Clear" onPress={() => onChange(undefined)} /> : null}
    </View>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const t = useTheme();
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ color: t.textMuted, fontSize: font.small }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.textMuted}
        style={[{ minHeight: TOUCH, borderRadius: radius.md, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.text, paddingHorizontal: space.md, fontSize: font.body }, style]}
        {...rest}
      />
    </View>
  );
}

export function Pill({ label, tone }: { label: string; tone: 'fertile' | 'infertile' | 'period' | 'inactive' | 'warning' }) {
  const t = useTheme();
  const map = {
    fertile: [t.fertileSoft, t.fertile],
    infertile: [t.infertileSoft, t.infertile],
    period: [t.periodSoft, t.period],
    inactive: [t.surfaceAlt, t.inactive],
    warning: [t.warningSoft, t.warning],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs }}>
      <Text style={{ color: fg, fontSize: font.small, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}
