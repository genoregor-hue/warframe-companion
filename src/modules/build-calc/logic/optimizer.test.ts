import { describe, expect, it } from 'vitest';
import { optimizeSelection, type Candidate } from './optimizer';

interface Item extends Candidate {
  readonly value: number;
  readonly drain: number;
}

const item = (id: string, value: number, drain: number, family = id): Item => ({ id, family, drain, value });
const sum = (selection: readonly Item[]) => selection.reduce((total, c) => total + c.value, 0);
const fitsIn = (capacity: number) => (selection: readonly Item[]) => selection.reduce((t, c) => t + c.drain, 0) <= capacity;

function bruteForce(items: readonly Item[], slots: number, capacity: number): number {
  let best = 0;
  const walk = (start: number, chosen: Item[]) => {
    const families = new Set(chosen.map((c) => c.family));
    if (fitsIn(capacity)(chosen)) best = Math.max(best, sum(chosen));
    if (chosen.length === slots) return;
    for (let i = start; i < items.length; i += 1) {
      if (!families.has(items[i].family)) walk(i + 1, [...chosen, items[i]]);
    }
  };
  walk(0, []);
  return best;
}

describe('optimizeSelection', () => {
  it('fills free slots with the best items', () => {
    const items = [item('a', 5, 1), item('b', 3, 1), item('c', 1, 1)];
    const result = optimizeSelection({ candidates: items, slots: 2, fits: fitsIn(10), score: sum });
    expect(result.selection.map((c) => c.id).sort()).toEqual(['a', 'b']);
    expect(result.score).toBe(8);
  });

  it('respects capacity', () => {
    const items = [item('big', 10, 9), item('x', 6, 4), item('y', 6, 4)];
    const result = optimizeSelection({ candidates: items, slots: 2, fits: fitsIn(8), score: sum });
    expect(result.score).toBe(12);
  });

  it('never equips two mods of one family', () => {
    const items = [item('serration', 5, 1, 'dmg'), item('primed', 6, 1, 'dmg'), item('other', 1, 1)];
    const result = optimizeSelection({ candidates: items, slots: 3, fits: fitsIn(10), score: sum });
    expect(result.selection.map((c) => c.id).sort()).toEqual(['other', 'primed']);
  });

  it('matches brute force on a tight knapsack', () => {
    const items = [item('a', 7, 6), item('b', 6, 5), item('c', 5, 4), item('d', 4, 3), item('e', 3, 2), item('f', 2, 1)];
    const result = optimizeSelection({ candidates: items, slots: 3, fits: fitsIn(10), score: sum });
    expect(result.score).toBe(bruteForce(items, 3, 10));
  });

  it('keeps locked items', () => {
    const items = [item('a', 5, 1), item('b', 3, 1), item('weak', 0, 1)];
    const result = optimizeSelection({ candidates: items, slots: 2, fits: fitsIn(10), score: sum, locked: [items[2]] });
    expect(result.selection.map((c) => c.id)).toContain('weak');
    expect(result.score).toBe(5);
  });

  it('improves an initial build instead of starting from scratch', () => {
    const items = [item('a', 5, 1), item('b', 3, 1), item('c', 1, 1)];
    const result = optimizeSelection({ candidates: items, slots: 2, fits: fitsIn(10), score: sum, initial: [items[2]] });
    expect(result.score).toBe(8);
  });

  it('handles synergy that greedy alone would miss', () => {
    const items = [item('solo', 5, 1), item('pairA', 1, 1), item('pairB', 1, 1)];
    const score = (s: readonly Item[]) => {
      const ids = new Set(s.map((c) => c.id));
      return sum(s) + (ids.has('pairA') && ids.has('pairB') ? 10 : 0);
    };
    const result = optimizeSelection({ candidates: items, slots: 2, fits: fitsIn(10), score });
    expect(result.score).toBe(12);
  });

  it('returns an empty selection when nothing fits', () => {
    const result = optimizeSelection({ candidates: [item('a', 5, 50)], slots: 2, fits: fitsIn(10), score: sum });
    expect(result.selection).toEqual([]);
  });
});
