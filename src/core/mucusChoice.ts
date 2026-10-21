// The log screen asks two things about cervical mucus: one combined
// "consistency" choice and a colour. The consistency choice covers both what
// is felt and what is seen, and is stored as the sensation + appearance pair
// the fertility rules read, so each choice keeps its method rating:
// dry (t) < nothing (Ø) < moist (f) < sticky / creamy (S) < watery / egg-white (S+).

import type { MucusAppearance, MucusObservation, MucusSensation } from './types';

export type MucusChoice = 'dry' | 'nothing' | 'moist' | 'sticky' | 'creamy' | 'watery' | 'egg_white';

export interface MucusChoiceOption {
  value: MucusChoice;
  label: string;
  hint: string;
}

/** In the order mucus usually appears as the fertile time approaches. */
export const MUCUS_CHOICES: MucusChoiceOption[] = [
  { value: 'dry', label: 'Dry', hint: 'Feels dry, nothing seen' },
  { value: 'nothing', label: 'Nothing', hint: 'No particular feeling, nothing seen' },
  { value: 'moist', label: 'Moist', hint: 'Feels damp, nothing seen' },
  { value: 'sticky', label: 'Sticky', hint: 'Thick, tacky or crumbly; breaks when stretched' },
  { value: 'creamy', label: 'Creamy', hint: 'Smooth like lotion' },
  { value: 'watery', label: 'Watery', hint: 'Thin and wet' },
  { value: 'egg_white', label: 'Egg-white', hint: 'Clear, stretchy, slippery' },
];

const FIELDS: Record<MucusChoice, { sensation: MucusSensation; appearance: MucusAppearance; stretchy?: true }> = {
  dry: { sensation: 'dry', appearance: 'nothing' },
  nothing: { sensation: 'nothing', appearance: 'nothing' },
  moist: { sensation: 'moist', appearance: 'nothing' },
  sticky: { sensation: 'nothing', appearance: 'sticky' },
  creamy: { sensation: 'nothing', appearance: 'creamy' },
  watery: { sensation: 'wet', appearance: 'watery' },
  egg_white: { sensation: 'slippery', appearance: 'egg_white', stretchy: true },
};

/** The stored fields for a choice; `undefined` clears them (not logged). */
export function mucusFieldsFor(choice: MucusChoice | undefined): Pick<MucusObservation, 'sensation' | 'appearance' | 'stretchy'> {
  if (!choice) return { sensation: undefined, appearance: undefined, stretchy: undefined };
  const f = FIELDS[choice];
  return { sensation: f.sensation, appearance: f.appearance, stretchy: f.stretchy };
}

const BY_SEEN: Partial<Record<MucusAppearance, MucusChoice>> = { egg_white: 'egg_white', watery: 'watery', creamy: 'creamy', sticky: 'sticky' };
const BY_FELT: Record<MucusSensation, MucusChoice> = { slippery: 'egg_white', wet: 'watery', moist: 'moist', nothing: 'nothing', dry: 'dry' };
const RANK: Record<MucusChoice, number> = { dry: 0, nothing: 1, moist: 2, sticky: 3, creamy: 3, watery: 4, egg_white: 4 };

/**
 * The choice to show for a stored observation, including entries saved with
 * the earlier separate feeling/appearance fields: the more fertile of the two wins.
 */
export function mucusChoiceOf(m: Pick<MucusObservation, 'sensation' | 'appearance' | 'stretchy'> | undefined): MucusChoice | undefined {
  if (!m) return undefined;
  if (m.stretchy) return 'egg_white';
  const seen = m.appearance ? BY_SEEN[m.appearance] : undefined;
  const felt = m.sensation ? BY_FELT[m.sensation] : undefined;
  if (seen && felt) return RANK[felt] > RANK[seen] ? felt : seen;
  return seen ?? felt;
}
