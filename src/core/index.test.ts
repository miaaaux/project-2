import * as chart from './chart';
import * as content from './content';
import * as core from './index';
import * as cycles from './cycles';
import * as date from './date';
import * as derive from './derive';
import * as exercises from './exercises';
import * as fertility from './fertility';
import * as input from './input';
import * as painGuide from './painGuide';
import * as prediction from './prediction';
import * as redFlags from './redFlags';
import * as reminders from './reminders';
import * as types from './types';

const MODULES = { chart, content, cycles, date, derive, exercises, fertility, input, painGuide, prediction, redFlags, reminders, types };

test.each(Object.entries(MODULES))('every runtime export of %s is re-exported', (_, mod) => {
  const exported = core as Record<string, unknown>;
  const missing = Object.entries(mod)
    .filter(([name, value]) => exported[name] !== value)
    .map(([name]) => name);
  expect(missing).toEqual([]);
});

test('the reason codes have a single source: the fertility engine', () => {
  expect(core.FERTILITY_REASON_CODES).toBe(fertility.FERTILITY_REASON_CODES);
  expect('FERTILITY_REASON_CODES' in content).toBe(false);
});
