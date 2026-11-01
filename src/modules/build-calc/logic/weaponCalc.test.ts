import { describe, expect, it } from 'vitest';
import { averageCritMultiplier, computeWeapon, withBonusElement, type WeaponBase } from './weaponCalc';
import { parseStatLines } from './modStats';

/** Soma Prime numbers from the Public Export. */
const SOMA_PRIME: WeaponBase = {
  damage: [1.2, 4.8, 6, ...Array(17).fill(0)],
  critChance: 0.3, critMultiplier: 3, statusChance: 0.1, fireRate: 15, multishot: 1,
  magazine: 200, reload: 3, isBow: false,
};

const mods = (...lines: string[][]) => lines.map((l) => parseStatLines(l).stats);
const NO_CONDITIONALS = { conditional: false };

describe('averageCritMultiplier', () => {
  it('weights the crit multiplier by crit chance', () => {
    expect(averageCritMultiplier(0.75, 6.6)).toBeCloseTo(1 + 0.75 * 5.6);
  });

  it('stays linear past 100% crit chance (orange crits)', () => {
    expect(averageCritMultiplier(1.5, 2)).toBeCloseTo(2.5);
  });

  it('is 1 without crit chance', () => {
    expect(averageCritMultiplier(0, 5)).toBe(1);
  });
});

describe('computeWeapon', () => {
  it('returns base numbers without mods', () => {
    const r = computeWeapon(SOMA_PRIME, [], NO_CONDITIONALS);
    expect(r.totalPerPellet).toBeCloseTo(12);
    expect(r.burstDps).toBeCloseTo(12 * 15 * (1 + 0.3 * 2));
  });

  it('scales every type with base damage mods', () => {
    const r = computeWeapon(SOMA_PRIME, mods(['+165% Damage']), NO_CONDITIONALS);
    expect(r.damage.impact).toBeCloseTo(1.2 * 2.65);
    expect(r.totalPerPellet).toBeCloseTo(31.8);
  });

  it('scales only the matching physical type with physical mods', () => {
    const r = computeWeapon(SOMA_PRIME, mods(['+120% <DT_SLASH_COLOR>Slash']), NO_CONDITIONALS);
    expect(r.damage.slash).toBeCloseTo(6 * 2.2);
    expect(r.damage.puncture).toBeCloseTo(4.8);
  });

  it('adds elemental damage from total base damage, boosted by damage mods', () => {
    const r = computeWeapon(SOMA_PRIME, mods(['+165% Damage'], ['+90% <DT_FIRE_COLOR>Heat']), NO_CONDITIONALS);
    expect(r.damage.heat).toBeCloseTo(12 * 2.65 * 0.9);
  });

  it('combines two elements in mod order', () => {
    const r = computeWeapon(SOMA_PRIME, mods(['+90% <DT_FIRE_COLOR>Heat'], ['+90% <DT_FREEZE_COLOR>Cold']), NO_CONDITIONALS);
    expect(r.damage.blast).toBeCloseTo(12 * 1.8);
    expect(r.damage.heat).toBe(0);
    expect(r.damage.cold).toBe(0);
  });

  it('pairs elements left to right and keeps the odd one', () => {
    const r = computeWeapon(SOMA_PRIME, mods(['+90% <DT_FIRE_COLOR>Heat'], ['+60% <DT_POISON_COLOR>Toxin'], ['+90% <DT_FREEZE_COLOR>Cold']), NO_CONDITIONALS);
    expect(r.damage.gas).toBeCloseTo(12 * 1.5);
    expect(r.damage.cold).toBeCloseTo(12 * 0.9);
  });

  it('merges repeated elements into their first position', () => {
    const r = computeWeapon(SOMA_PRIME, mods(['+90% <DT_FIRE_COLOR>Heat'], ['+90% <DT_FREEZE_COLOR>Cold'], ['+60% <DT_FIRE_COLOR>Heat']), NO_CONDITIONALS);
    expect(r.damage.blast).toBeCloseTo(12 * 2.4);
  });

  it('combines innate elements after modded ones', () => {
    const innate: WeaponBase = { ...SOMA_PRIME, damage: [0, 0, 0, 0, 0, 10, ...Array(14).fill(0)] };
    const r = computeWeapon(innate, mods(['+100% <DT_POISON_COLOR>Toxin']), NO_CONDITIONALS);
    expect(r.damage.corrosive).toBeCloseTo(20);
    expect(r.damage.electricity).toBe(0);
  });

  it('applies crit, multishot and fire rate to burst DPS', () => {
    const r = computeWeapon(
      SOMA_PRIME,
      mods(['+165% Damage'], ['+150% Critical Chance'], ['+120% Critical Damage'], ['+90% Multishot'], ['+60% Fire Rate (x2 for Bows)']),
      NO_CONDITIONALS,
    );
    expect(r.critChance).toBeCloseTo(0.75);
    expect(r.critMultiplier).toBeCloseTo(6.6);
    expect(r.multishot).toBeCloseTo(1.9);
    expect(r.fireRate).toBeCloseTo(24);
    expect(r.burstDps).toBeCloseTo(31.8 * 1.9 * (1 + 0.75 * 5.6) * 24);
  });

  it('accounts for reload in sustained DPS', () => {
    const r = computeWeapon(SOMA_PRIME, [], NO_CONDITIONALS);
    const firing = 200 / 15;
    expect(r.sustainedDps).toBeCloseTo(r.burstDps * (firing / (firing + 3)));
  });

  it('shortens reload with reload speed mods', () => {
    expect(computeWeapon(SOMA_PRIME, mods(['+100% Reload Speed']), NO_CONDITIONALS).reloadTime).toBeCloseTo(1.5);
  });

  it('treats weapons without magazine as always firing', () => {
    const melee: WeaponBase = { ...SOMA_PRIME, magazine: 0, reload: 0 };
    const r = computeWeapon(melee, [], NO_CONDITIONALS);
    expect(r.sustainedDps).toBeCloseTo(r.burstDps);
  });

  it('applies conditional stacks only when enabled', () => {
    const galvanized = mods(['+80% Multishot', 'On Kill:\r\n+30% Multishot for 20s. Stacks up to 5x.']);
    expect(computeWeapon(SOMA_PRIME, galvanized, NO_CONDITIONALS).multishot).toBeCloseTo(1.8);
    expect(computeWeapon(SOMA_PRIME, galvanized, { conditional: true }).multishot).toBeCloseTo(3.3);
  });

  it('applies faction multipliers only against that faction', () => {
    const bane = mods(['x1.55 Damage to Grineer']);
    const base = computeWeapon(SOMA_PRIME, bane, NO_CONDITIONALS).burstDps;
    expect(computeWeapon(SOMA_PRIME, bane, { conditional: false, faction: 'Grineer' }).burstDps).toBeCloseTo(base * 1.55);
    expect(computeWeapon(SOMA_PRIME, bane, { conditional: false, faction: 'Corpus' }).burstDps).toBeCloseTo(base);
  });

  it('caps status procs per pellet at one', () => {
    const r = computeWeapon({ ...SOMA_PRIME, statusChance: 0.8 }, mods(['+90% Status Chance']), NO_CONDITIONALS);
    expect(r.statusChance).toBeCloseTo(1.52);
    expect(r.procsPerSecond).toBeCloseTo(15);
  });

  it('ignores fire rate mods when fire rate is locked (Cannonade)', () => {
    expect(computeWeapon(SOMA_PRIME, mods(['+60% Fire Rate (x2 for Bows)']), { conditional: false, fireRateLocked: true }).fireRate).toBeCloseTo(15);
  });

  it('never returns negative fire rate', () => {
    expect(computeWeapon(SOMA_PRIME, mods(['-200% Fire Rate']), NO_CONDITIONALS).fireRate).toBe(0);
  });
});

describe('withBonusElement', () => {
  it('adds a Kuva/Tenet bonus element as innate damage from total base damage', () => {
    const boosted = withBonusElement(SOMA_PRIME, 'toxin', 0.6);
    expect(boosted.damage[6]).toBeCloseTo(12 * 0.6);
    expect(SOMA_PRIME.damage[6]).toBe(0);
  });

  it('combines the bonus element after modded elements', () => {
    const r = computeWeapon(withBonusElement(SOMA_PRIME, 'electricity', 0.5), mods(['+100% <DT_POISON_COLOR>Toxin']), NO_CONDITIONALS);
    // The bonus element is part of base damage, so the Toxin mod scales from 12 + 6.
    expect(r.damage.corrosive).toBeCloseTo(18 + 6);
  });

  it('ignores an empty bonus', () => {
    expect(withBonusElement(SOMA_PRIME, undefined, 0.6)).toBe(SOMA_PRIME);
  });
});
