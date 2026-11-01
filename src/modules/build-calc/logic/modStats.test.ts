import { describe, expect, it } from 'vitest';
import { parseStatLines, statsAtRank, sumStats } from './modStats';

describe('parseStatLines', () => {
  it('reads a plain percentage stat', () => {
    expect(parseStatLines(['+165% Damage']).stats).toEqual([{ key: 'damage', value: 1.65, conditional: false, maxStacks: 1 }]);
  });

  it('maps melee damage to damage', () => {
    expect(parseStatLines(['+120% Melee Damage']).stats[0]).toMatchObject({ key: 'damage', value: 1.2 });
  });

  it('reads elemental damage by its color tag', () => {
    expect(parseStatLines(['+90% <DT_FIRE_COLOR>Heat']).stats[0]).toMatchObject({ key: 'heat', value: 0.9 });
    expect(parseStatLines(['+60% <DT_POISON_COLOR>Toxin']).stats[0]).toMatchObject({ key: 'toxin', value: 0.6 });
  });

  it('does not confuse resistances with damage', () => {
    const parsed = parseStatLines(['+60% <DT_POISON_COLOR>Toxin Resistance']);
    expect(parsed.stats).toEqual([]);
    expect(parsed.unknown).toEqual(['+60% <DT_POISON_COLOR>Toxin Resistance']);
  });

  it('marks on-kill stats as conditional with stacks', () => {
    const parsed = parseStatLines(['+80% Multishot', 'On Kill:\r\n+30% Multishot for 20s. Stacks up to 5x.']);
    expect(parsed.stats).toEqual([
      { key: 'multishot', value: 0.8, conditional: false, maxStacks: 1 },
      { key: 'multishot', value: 0.3, conditional: true, maxStacks: 5 },
    ]);
  });

  it('does not double count passive lines repeated after a condition', () => {
    const parsed = parseStatLines(['On Kill:\r\n+30% Damage for 4s. Stacks up to 12x.\r\n+30% Reload Speed', '+30% Reload Speed']);
    expect(parsed.stats).toEqual([
      { key: 'damage', value: 0.3, conditional: true, maxStacks: 12 },
      { key: 'reloadSpeed', value: 0.3, conditional: false, maxStacks: 1 },
    ]);
  });

  it('reads faction damage multipliers', () => {
    expect(parseStatLines(['x1.55 Damage to Grineer']).stats[0]).toMatchObject({ key: 'factionGrineer', value: 0.55 });
  });

  it('keeps the bow multiplier of fire rate mods', () => {
    expect(parseStatLines(['+90% Fire Rate (x2 for Bows)']).stats[0]).toEqual({ key: 'fireRate', value: 0.9, conditional: false, maxStacks: 1, bowMultiplier: 2 });
  });

  it('reads negative values and heavy-attack crit', () => {
    const parsed = parseStatLines(['-60% Ability Strength', '+90% Ability Range', '+60% Critical Chance (x2 for Heavy Attacks)']);
    expect(parsed.stats.map((s) => [s.key, s.value])).toEqual([['strength', -0.6], ['range', 0.9], ['critChance', 0.6]]);
  });

  it('treats timed buffs as conditional', () => {
    expect(parseStatLines(['+100% Critical Chance when Aiming for 9s']).stats[0]).toMatchObject({ key: 'critChance', conditional: true });
  });

  it('treats "On Equip:" blocks as permanent', () => {
    expect(parseStatLines(['On Equip:\r\n+20% Ability Strength']).stats[0]).toMatchObject({ key: 'strength', conditional: false });
  });

  it('reads warframe survivability stats', () => {
    const parsed = parseStatLines(['+100% Health', '+100% Shield Capacity', '+100% Armor', '+50% Energy Max']);
    expect(parsed.stats.map((s) => s.key)).toEqual(['health', 'shield', 'armor', 'energy']);
  });
});

describe('sumStats', () => {
  const stats = parseStatLines(['+80% Multishot', 'On Kill:\r\n+30% Multishot for 20s. Stacks up to 5x.', '+90% Fire Rate (x2 for Bows)']).stats;

  it('ignores conditional stats unless asked', () => {
    expect(sumStats(stats, { conditional: false }).multishot).toBeCloseTo(0.8);
  });

  it('applies conditional stats at max stacks when asked', () => {
    expect(sumStats(stats, { conditional: true }).multishot).toBeCloseTo(0.8 + 1.5);
  });

  it('applies the bow multiplier only for bows', () => {
    expect(sumStats(stats, { conditional: false }).fireRate).toBeCloseTo(0.9);
    expect(sumStats(stats, { conditional: false, isBow: true }).fireRate).toBeCloseTo(1.8);
  });
});

describe('statsAtRank', () => {
  const levels = [['+10% Damage'], ['+20% Damage'], ['+30% Damage']];

  it('returns the lines of the requested rank', () => {
    expect(statsAtRank(levels, 1)).toEqual(['+20% Damage']);
  });

  it('clamps out-of-range ranks', () => {
    expect(statsAtRank(levels, 99)).toEqual(['+30% Damage']);
    expect(statsAtRank(levels, -3)).toEqual(['+10% Damage']);
    expect(statsAtRank([], 0)).toEqual([]);
  });
});

describe('situational scaling', () => {
  it('reads combo-scaled stats', () => {
    expect(parseStatLines(['+40% Critical Chance stacks with Combo Multiplier']).stats[0]).toEqual({ key: 'critChance', value: 0.4, conditional: false, maxStacks: 1, scaling: 'combo' });
    expect(parseStatLines(['+40% Status Chance per Combo Multiplier']).stats[0]).toMatchObject({ key: 'statusChance', scaling: 'combo' });
  });

  it('reads status-type-scaled stats, including direct damage', () => {
    expect(parseStatLines(['+80% Melee Damage per Status Type affecting the target']).stats[0]).toMatchObject({ key: 'damage', value: 0.8, scaling: 'status' });
    const galvanized = parseStatLines(['On Kill:\r\n+40% Direct Damage per Status Type affecting the target for 20s. Stacks up to 2x.']).stats[0];
    expect(galvanized).toMatchObject({ key: 'damage', scaling: 'status', conditional: true, maxStacks: 2 });
  });

  it('multiplies combo stats by (multiplier - 1) and status stats by the status count', () => {
    const stats = parseStatLines(['+40% Critical Chance stacks with Combo Multiplier', '+80% Melee Damage per Status Type affecting the target']).stats;
    expect(sumStats(stats, { conditional: false })).toEqual({});
    expect(sumStats(stats, { conditional: false, comboMultiplier: 12, statusTypes: 3 })).toEqual({ critChance: 0.4 * 11, damage: 0.8 * 3 });
  });
});
