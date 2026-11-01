import { describe, expect, it } from 'vitest';
import { DAMAGE_TYPES, type DamageType } from './damageTypes';
import { corrosiveStrip, procRates, steadyStacks, targetDps, viralBonus } from './statusEffects';
import type { WeaponResult } from './weaponCalc';

function result(parts: Partial<Record<DamageType, number>>, extra: Partial<WeaponResult> = {}): WeaponResult {
  const damage = Object.fromEntries(DAMAGE_TYPES.map((t) => [t, parts[t] ?? 0])) as Record<DamageType, number>;
  const total = Object.values(damage).reduce((s, d) => s + d, 0);
  return {
    damage, totalPerPellet: total, critChance: 0, critMultiplier: 2, averageCrit: 1, statusChance: 1, multishot: 1,
    fireRate: 5, magazine: 0, reloadTime: 0, factionMultiplier: 1, burstDps: total * 5, sustainedDps: total * 5, procsPerSecond: 5,
    ...extra,
  };
}

const NO_ARMOR = { armor: 0, armorStrip: 0, weak: [], resist: [] };

describe('viralBonus', () => {
  it('gives +100% for the first stack and +25% for each next one, up to +325%', () => {
    expect(viralBonus(0)).toBe(0);
    expect(viralBonus(0.5)).toBeCloseTo(0.5);
    expect(viralBonus(1)).toBe(1);
    expect(viralBonus(10)).toBeCloseTo(3.25);
    expect(viralBonus(25)).toBeCloseTo(3.25);
  });
});

describe('corrosiveStrip', () => {
  it('strips 26% for the first stack and 6% more per stack, up to 80%', () => {
    expect(corrosiveStrip(0)).toBe(0);
    expect(corrosiveStrip(1)).toBeCloseTo(0.26);
    expect(corrosiveStrip(2)).toBeCloseTo(0.32);
    expect(corrosiveStrip(10)).toBeCloseTo(0.8);
    expect(corrosiveStrip(40)).toBeCloseTo(0.8);
  });
});

describe('steadyStacks', () => {
  it('is procs per second times duration, capped', () => {
    expect(steadyStacks(0.5, 6, 10)).toBeCloseTo(3);
    expect(steadyStacks(5, 6, 10)).toBe(10);
  });
});

describe('procRates', () => {
  it('splits status procs by damage share', () => {
    const rates = procRates(result({ slash: 30, viral: 70 }));
    expect(rates.slash).toBeCloseTo(1.5);
    expect(rates.viral).toBeCloseTo(3.5);
  });
});

describe('targetDps', () => {
  it('matches direct damage when statuses are off', () => {
    const r = result({ viral: 10 });
    expect(targetDps(r, NO_ARMOR, false).total).toBeCloseTo(r.burstDps);
  });

  it('boosts damage with viral stacks', () => {
    const r = result({ viral: 10 });
    const out = targetDps(r, NO_ARMOR, true);
    expect(out.viralBonus).toBeCloseTo(3.25);
    expect(out.direct).toBeCloseTo(r.burstDps * 4.25);
  });

  it('strips armor with corrosive procs', () => {
    const r = result({ corrosive: 10 });
    const armored = { armor: 600, armorStrip: 0, weak: [], resist: [] };
    const out = targetDps(r, armored, true);
    expect(out.armorStrip).toBeCloseTo(0.8);
    expect(out.direct).toBeGreaterThan(targetDps(r, armored, false).direct);
  });

  it('adds slash bleed that ignores armor', () => {
    const r = result({ slash: 10 });
    const heavy = { armor: 100_000, armorStrip: 0, weak: [], resist: [] };
    const out = targetDps(r, heavy, true);
    expect(out.dot).toBeCloseTo(5 * 0.35 * 6 * 10);
    expect(out.direct).toBeCloseTo(r.burstDps * 0.1);
  });

  it('works without an enemy profile (raw target)', () => {
    const r = result({ heat: 10 });
    expect(targetDps(r, undefined, true).dot).toBeGreaterThan(0);
  });
});
