import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { isInPeriod } from '../../core/cycles';
import { compareDates, dateRange, type ISODate } from '../../core/date';
import { useAppData } from '../../state/AppDataProvider';
import { Body, Button, Card, Screen, Title } from '../../ui/components';
import { monthTitle } from '../../ui/format';
import { font, radius, space, useTheme } from '../../ui/theme';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function iso(y: number, m0: number, d: number): ISODate {
  return `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export default function CalendarScreen() {
  const { data, derived, clock } = useAppData();
  const t = useTheme();
  const [y0, m0] = clock.today.split('-').map(Number);
  const [view, setView] = useState({ y: y0, m: m0 - 1 });

  const fertilityByDate = useMemo(() => {
    const map = new Map<ISODate, string>();
    if (derived?.fertilityVisible) for (const d of derived.fertility.days) map.set(d.date, d.status);
    return map;
  }, [derived]);

  if (!derived) return null;
  const { cycles, prediction } = derived;

  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const firstWeekday = (new Date(view.y, view.m, 1).getDay() + 6) % 7; // Monday = 0
  const cells: (ISODate | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => iso(view.y, view.m, i + 1)),
  ];
  const predicted = new Set(
    prediction.lo && prediction.hi && prediction.status !== 'late' ? dateRange(prediction.lo, prediction.hi) : [],
  );

  const shift = (delta: number) =>
    setView(({ y, m }) => {
      const n = m + delta;
      return { y: y + Math.floor(n / 12), m: ((n % 12) + 12) % 12 };
    });

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Button kind="secondary" label="‹" onPress={() => shift(-1)} />
        <Title>{monthTitle(view.y, view.m)}</Title>
        <Button kind="secondary" label="›" onPress={() => shift(1)} />
      </View>

      <View style={{ flexDirection: 'row' }}>
        {WEEKDAYS.map((w) => (
          <Text key={w} style={{ flex: 1, textAlign: 'center', color: t.textMuted, fontSize: font.small }}>{w}</Text>
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((d, i) => {
          if (!d) return <View key={`b${i}`} style={{ width: `${100 / 7}%`, aspectRatio: 1 }} />;
          const future = compareDates(d, clock.today) > 0;
          const period = cycles.some((c) => isInPeriod(c, d));
          const fertility = fertilityByDate.get(d);
          const isToday = d === clock.today;
          return (
            <Pressable
              key={d}
              disabled={future}
              accessibilityRole="button"
              accessibilityLabel={`${d}${period ? ', period' : ''}${predicted.has(d) ? ', predicted period' : ''}${fertility ? `, ${fertility.replace(/_/g, ' ')}` : ''}`}
              onPress={() => router.push({ pathname: '/log/[date]', params: { date: d } })}
              style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 2 }}
            >
              <View
                style={{
                  flex: 1, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: period ? t.periodSoft : t.surface,
                  borderWidth: isToday ? 2 : predicted.has(d) ? 1 : 0,
                  borderStyle: predicted.has(d) && !isToday ? 'dashed' : 'solid',
                  borderColor: isToday ? t.accent : t.period,
                  opacity: future && !predicted.has(d) ? 0.5 : 1,
                }}
              >
                <Text style={{ color: t.text, fontSize: font.body }}>{Number(d.slice(8))}</Text>
                <View style={{ flexDirection: 'row', gap: 2, height: 6 }}>
                  {fertility ? (
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: fertility === 'fertile' ? t.fertile : fertility === 'not_applicable' ? t.inactive : t.infertile }} />
                  ) : null}
                  {data.logs[d] ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.textMuted }} /> : null}
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Card>
        <Body small>Shaded: period · dashed outline: predicted period · grey dot: logged</Body>
        {derived.fertilityVisible ? <Body small>Pink dot: fertile · slate dot: not fertile (by the method rules)</Body> : null}
      </Card>
    </Screen>
  );
}
