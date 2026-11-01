import { describe, expect, it } from 'vitest';
import { auraBonus, buildCapacity, modDrain, placeDrain } from './capacity';

describe('modDrain', () => {
  it('is base drain plus rank in an unpolarized slot', () => {
    expect(modDrain({ baseDrain: 4, rank: 10, polarity: 'AP_ATTACK' }, '')).toBe(14);
  });

  it('halves drain on a matching polarity, rounding up', () => {
    expect(modDrain({ baseDrain: 4, rank: 10, polarity: 'AP_ATTACK' }, 'AP_ATTACK')).toBe(7);
    expect(modDrain({ baseDrain: 5, rank: 10, polarity: 'AP_ATTACK' }, 'AP_ATTACK')).toBe(8);
  });

  it('adds 25% on a mismatched polarity, rounding up', () => {
    expect(modDrain({ baseDrain: 4, rank: 10, polarity: 'AP_ATTACK' }, 'AP_DEFENSE')).toBe(18);
  });

  it('treats universal slots as matching', () => {
    expect(modDrain({ baseDrain: 4, rank: 10, polarity: 'AP_ATTACK' }, 'AP_UNIVERSAL')).toBe(7);
  });
});

describe('auraBonus', () => {
  it('gives capacity instead of draining it', () => {
    expect(auraBonus({ baseDrain: -4, rank: 5, polarity: 'AP_ATTACK' }, '')).toBe(9);
  });

  it('doubles on a matching polarity', () => {
    expect(auraBonus({ baseDrain: -4, rank: 5, polarity: 'AP_ATTACK' }, 'AP_ATTACK')).toBe(18);
  });

  it('shrinks on a mismatched polarity', () => {
    expect(auraBonus({ baseDrain: -4, rank: 5, polarity: 'AP_ATTACK' }, 'AP_DEFENSE')).toBe(7);
  });
});

describe('buildCapacity', () => {
  it('is 60 with a reactor or catalyst, 30 without', () => {
    expect(buildCapacity({ potato: true })).toBe(60);
    expect(buildCapacity({ potato: false })).toBe(30);
  });

  it('adds aura and stance bonuses', () => {
    expect(buildCapacity({ potato: true, bonus: 18 })).toBe(78);
  });
});

describe('placeDrain', () => {
  const big = { baseDrain: 10, rank: 5, polarity: 'AP_ATTACK' };
  const small = { baseDrain: 2, rank: 3, polarity: 'AP_ATTACK' };

  it('puts the biggest mod into the matching slot', () => {
    expect(placeDrain([small, big], ['AP_ATTACK', ''])).toBe(8 + 5);
  });

  it('prefers an empty slot over a mismatched one', () => {
    expect(placeDrain([big], ['AP_DEFENSE', ''])).toBe(15);
  });

  it('charges full drain when slots run out', () => {
    expect(placeDrain([big, small], ['AP_ATTACK'])).toBe(8 + 5);
  });
});

