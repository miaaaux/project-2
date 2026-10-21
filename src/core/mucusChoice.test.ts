import { assessMucus } from './fertility/mucus';
import { MUCUS_CHOICES, mucusChoiceOf, mucusFieldsFor, type MucusChoice } from './mucusChoice';
import { mucus } from './testing/fixtures';

const quality = (choice: MucusChoice) =>
  assessMucus(mucus(undefined, undefined, { ...mucusFieldsFor(choice), color: 'none' }), { complete: true, recalled: false }).quality;

test('each consistency choice keeps its rating in the method (t, Ø, f, S, S+)', () => {
  expect(MUCUS_CHOICES.map((c) => [c.value, quality(c.value)])).toEqual([
    ['dry', 0],
    ['nothing', 1],
    ['moist', 2],
    ['sticky', 3],
    ['creamy', 3],
    ['watery', 4],
    ['egg_white', 4],
  ]);
});

test('every choice round-trips through the stored fields', () => {
  for (const { value } of MUCUS_CHOICES) expect(mucusChoiceOf(mucusFieldsFor(value))).toBe(value);
});

test('clearing the choice clears the fields', () => {
  expect(mucusFieldsFor(undefined)).toEqual({ sensation: undefined, appearance: undefined, stretchy: undefined });
  expect(mucusChoiceOf(mucusFieldsFor(undefined))).toBeUndefined();
});

test('older entries with separate feeling and appearance show the more fertile of the two', () => {
  expect(mucusChoiceOf({ sensation: 'slippery', appearance: 'nothing' })).toBe('egg_white');
  expect(mucusChoiceOf({ sensation: 'moist', appearance: 'creamy' })).toBe('creamy');
  expect(mucusChoiceOf({ sensation: 'wet', appearance: 'sticky' })).toBe('watery');
  expect(mucusChoiceOf({ sensation: 'dry', appearance: undefined })).toBe('dry');
  expect(mucusChoiceOf({ appearance: 'sticky', stretchy: true })).toBe('egg_white');
});
