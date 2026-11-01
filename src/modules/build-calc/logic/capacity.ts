export interface DrainMod {
  readonly baseDrain: number;
  readonly rank: number;
  readonly polarity: string;
}

const UNIVERSAL = 'AP_UNIVERSAL';
const MISMATCH_PENALTY = 1.25;
const AURA_MISMATCH = 0.8;
const BASE_CAPACITY = 30;
const POTATO_MULTIPLIER = 2;

export const isMatching = (slot: string, polarity: string): boolean => slot !== '' && (slot === UNIVERSAL || slot === polarity);

/** Capacity a mod costs in a slot: halved on a match, +25% on a mismatch (both rounded up). */
export function modDrain(mod: DrainMod, slot: string): number {
  const drain = Math.abs(mod.baseDrain) + mod.rank;
  if (slot === '') return drain;
  return isMatching(slot, mod.polarity) ? Math.ceil(drain / 2) : Math.ceil(drain * MISMATCH_PENALTY);
}

/** Capacity an aura adds: doubled on a match, reduced on a mismatch. */
export function auraBonus(mod: DrainMod, slot: string): number {
  const bonus = Math.abs(mod.baseDrain) + mod.rank;
  if (slot === '') return bonus;
  return isMatching(slot, mod.polarity) ? bonus * 2 : Math.round(bonus * AURA_MISMATCH);
}

/** Orokin Reactor/Catalyst ("potato") doubles the base 30 capacity. */
export function buildCapacity({ potato, bonus = 0 }: { potato: boolean; bonus?: number }): number {
  return BASE_CAPACITY * (potato ? POTATO_MULTIPLIER : 1) + bonus;
}

/** Places mods into slots to spend as little capacity as possible (biggest mods first). */
export function placeDrain(mods: readonly DrainMod[], slots: readonly string[]): number {
  const free = [...slots];
  return [...mods]
    .sort((a, b) => modDrain(b, '') - modDrain(a, ''))
    .reduce((sum, mod) => {
      if (free.length === 0) return sum + modDrain(mod, '');
      const costs = free.map((slot) => modDrain(mod, slot));
      const index = costs.indexOf(Math.min(...costs));
      free.splice(index, 1);
      return sum + costs[index];
    }, 0);
}

