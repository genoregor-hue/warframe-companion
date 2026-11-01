import { describe, expect, it } from 'vitest';
import { armorReduction, ENEMY_PRESETS, enemyMultiplier, typeMultiplier } from './enemy';
import { DAMAGE_TYPES, type DamageType } from './damageTypes';

const damage = (parts: Partial<Record<DamageType, number>>) =>
  Object.fromEntries(DAMAGE_TYPES.map((t) => [t, parts[t] ?? 0])) as Record<DamageType, number>;

describe('armorReduction', () => {
  it('follows armor / (armor + 300)', () => {
    expect(armorReduction(0, 0)).toBe(0);
    expect(armorReduction(300, 0)).toBeCloseTo(0.5);
  });

  it('is capped at 90%', () => {
    expect(armorReduction(100_000, 0)).toBe(0.9);
  });

  it('applies armor strip first', () => {
    expect(armorReduction(600, 0.5)).toBeCloseTo(0.5);
    expect(armorReduction(600, 1)).toBe(0);
  });
});

describe('typeMultiplier', () => {
  const enemy = { armor: 0, armorStrip: 0, weak: ['corrosive'] as DamageType[], resist: ['viral'] as DamageType[] };

  it('adds 50% for weaknesses and removes 50% for resistances', () => {
    expect(typeMultiplier('corrosive', enemy)).toBe(1.5);
    expect(typeMultiplier('viral', enemy)).toBe(0.5);
    expect(typeMultiplier('heat', enemy)).toBe(1);
  });
});

describe('enemyMultiplier', () => {
  it('is 1 against an enemy without armor or weaknesses', () => {
    expect(enemyMultiplier(damage({ impact: 10 }), ENEMY_PRESETS.none)).toBe(1);
  });

  it('weights type multipliers by the damage mix and applies armor', () => {
    const enemy = { armor: 300, armorStrip: 0, weak: ['corrosive'] as DamageType[], resist: [] };
    const mix = damage({ corrosive: 50, slash: 50 });
    expect(enemyMultiplier(mix, enemy)).toBeCloseTo(((50 * 1.5 + 50) / 100) * 0.5);
  });

  it('lets true damage ignore armor', () => {
    const enemy = { armor: 300, armorStrip: 0, weak: [], resist: [] };
    expect(enemyMultiplier(damage({ true: 10 }), enemy)).toBe(1);
  });

  it('returns 0 for no damage', () => {
    expect(enemyMultiplier(damage({}), ENEMY_PRESETS.grineer)).toBe(0);
  });

  it('ships faction presets with their weaknesses', () => {
    expect(ENEMY_PRESETS.grineer.weak).toEqual(['impact', 'corrosive']);
    expect(ENEMY_PRESETS.corpus.weak).toEqual(['puncture', 'magnetic']);
    expect(ENEMY_PRESETS.infested.weak).toEqual(['slash', 'heat']);
  });
});
