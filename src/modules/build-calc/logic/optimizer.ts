/**
 * Generic slot optimizer: greedy fill followed by local search (swap one item
 * or drop one item, then greedily refill). Fast enough for 8 slots and ~100
 * candidates, and escapes the usual greedy traps (synergy, tight capacity).
 */

export interface Candidate {
  readonly id: string;
  /** Items of one family are mutually exclusive (e.g. Serration and Primed Serration). */
  readonly family: string;
}

export interface OptimizeInput<C extends Candidate> {
  readonly candidates: readonly C[];
  readonly slots: number;
  fits(selection: readonly C[]): boolean;
  score(selection: readonly C[]): number;
  /** Always kept, never swapped out. */
  readonly locked?: readonly C[];
  /** Starting point, e.g. the player's current build. */
  readonly initial?: readonly C[];
  readonly maxRounds?: number;
}

export interface OptimizeResult<C extends Candidate> {
  readonly selection: readonly C[];
  readonly score: number;
}

const EPSILON = 1e-9;
const DEFAULT_ROUNDS = 30;

function uniqueFamilies<C extends Candidate>(items: readonly C[], slots: number): C[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.family)) return false;
    seen.add(item.family);
    return true;
  }).slice(0, slots);
}

export function optimizeSelection<C extends Candidate>(input: OptimizeInput<C>): OptimizeResult<C> {
  const { candidates, slots, fits, score } = input;
  const locked = uniqueFamilies(input.locked ?? [], slots);
  const lockedIds = new Set(locked.map((c) => c.id));

  const greedyFill = (start: readonly C[], startScore: number): OptimizeResult<C> => {
    let selection = start;
    let best = startScore;
    while (selection.length < slots) {
      const families = new Set(selection.map((c) => c.family));
      let pick: OptimizeResult<C> | undefined;
      for (const candidate of candidates) {
        if (families.has(candidate.family)) continue;
        const next = [...selection, candidate];
        if (!fits(next)) continue;
        const value = score(next);
        if (value > (pick?.score ?? best) + EPSILON) pick = { selection: next, score: value };
      }
      if (!pick) break;
      selection = pick.selection;
      best = pick.score;
    }
    return { selection, score: best };
  };

  const seed = uniqueFamilies([...locked, ...(input.initial ?? []).filter((c) => !lockedIds.has(c.id))], slots);
  const start = fits(seed) ? seed : locked;
  let current = greedyFill(start, score(start));

  for (let round = 0; round < (input.maxRounds ?? DEFAULT_ROUNDS); round += 1) {
    let best: OptimizeResult<C> | undefined;
    current.selection.forEach((item, index) => {
      if (lockedIds.has(item.id)) return;
      const others = current.selection.filter((_, i) => i !== index);
      const families = new Set(others.map((c) => c.family));
      const moves = [others, ...candidates.filter((c) => !families.has(c.family) && c.id !== item.id).map((c) => [...others, c])];
      for (const move of moves) {
        if (!fits(move)) continue;
        const filled = greedyFill(move, score(move));
        if (filled.score > (best?.score ?? current.score) + EPSILON) best = filled;
      }
    });
    if (!best) break;
    current = best;
  }
  return current;
}
