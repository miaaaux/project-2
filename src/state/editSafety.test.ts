import type { DayFertility } from '../core/fertility';
import { datesNeedingAlert, shouldRecordShown } from './editSafety';

const day = (date: string, status: DayFertility['status'], eveningTransition?: true): DayFertility => ({
  date, cycleDay: 1, status, inPeriod: false, reasons: [], ...(eveningTransition ? { eveningTransition } : {}),
});

const SHOWN = '2026-10-10T07:00:00.000Z';

test('only not-fertile labels are recorded', () => {
  expect(shouldRecordShown(day('2026-10-10', 'fertile'))).toBe(false);
  expect(shouldRecordShown(day('2026-10-10', 'fertile', true))).toBe(true);
  expect(shouldRecordShown(day('2026-10-10', 'infertile_post_ovulatory'))).toBe(true);
});

test('a day shown as not fertile that is now fertile needs the alert', () => {
  const shown = [{ date: '2026-10-10', status: 'infertile_post_ovulatory', shownAt: SHOWN }];
  expect(datesNeedingAlert(shown, [], [day('2026-10-10', 'fertile')])).toEqual(['2026-10-10']);
});

test('the alert does not repeat once acknowledged', () => {
  const shown = [{ date: '2026-10-10', status: 'infertile_post_ovulatory', shownAt: SHOWN }];
  const acks = [{ date: '2026-10-10', ackAt: '2026-10-10T09:00:00.000Z' }];
  expect(datesNeedingAlert(shown, acks, [day('2026-10-10', 'fertile')])).toEqual([]);
});

test('a later showing after an acknowledgement can raise the alert again', () => {
  const shown = [{ date: '2026-10-10', status: 'infertile_post_ovulatory', shownAt: '2026-10-10T20:00:00.000Z' }];
  const acks = [{ date: '2026-10-10', ackAt: '2026-10-10T09:00:00.000Z' }];
  expect(datesNeedingAlert(shown, acks, [day('2026-10-10', 'fertile')])).toEqual(['2026-10-10']);
});

test('a withdrawn "not fertile from this evening" needs the alert', () => {
  const shown = [{ date: '2026-10-10', status: 'fertile', eveningTransition: true, shownAt: SHOWN }];
  expect(datesNeedingAlert(shown, [], [day('2026-10-10', 'fertile')])).toEqual(['2026-10-10']);
});

test('fertile days shown on the Today screen never hide an earlier not-fertile label', () => {
  // Fertile showings are never recorded, so the race between recording today's
  // status and running the check cannot suppress the alert.
  const shown = [{ date: '2026-10-10', status: 'infertile_pre_ovulatory', shownAt: SHOWN }];
  expect(datesNeedingAlert(shown, [], [day('2026-10-10', 'fertile')])).toEqual(['2026-10-10']);
});
