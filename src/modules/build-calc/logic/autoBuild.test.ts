import { describe, expect, it } from 'vitest';
import type { ArcaneEntry, ModEntry, WeaponEntry, FrameEntry } from '../../../data/catalog';
import { autoBuildFrame, autoBuildWeapon } from './autoBuild';
import { applyAutoBuild, emptyBuild, evaluateBuild } from './buildEval';
import { frameCompatible, weaponCompatible } from './compat';

const name = (en: string) => ({ en, ru: en });

function mod(id: string, line: string, extra: Partial<ModEntry> = {}): ModEntry {
  return {
    uniqueName: `/Mods/Rifle/${id}`, name: name(id), polarity: 'AP_ATTACK', rarity: 'RARE', baseDrain: 4, fusionLimit: 5,
    type: 'PRIMARY', compatName: 'Rifle', isUtility: false, family: `/Mods/Rifle/${id}`,
    stats: Array.from({ length: 6 }, (_, rank) => [line.replace('N', String(((rank + 1) / 6) * Number(/\d+/.exec(line)?.[0] ?? 0)))]).map((l, i) => (i === 5 ? [line.replace('N', /\d+/.exec(line)?.[0] ?? '0')] : l)),
    statsRu: [], ...extra,
  };
}

/** Max-rank lines are written literally; lower ranks are scaled. */
function flat(id: string, maxLine: string, extra: Partial<ModEntry> = {}): ModEntry {
  return { ...mod(id, maxLine, extra), stats: [[maxLine], [maxLine], [maxLine], [maxLine], [maxLine], [maxLine]] };
}

const SOMA: WeaponEntry = {
  uniqueName: '/W/Soma', name: name('Soma Prime'), category: 'primary', weaponClass: 'Rifle',
  damage: [1.2, 4.8, 6, ...Array(17).fill(0)], critChance: 0.3, critMultiplier: 3, statusChance: 0.1,
  fireRate: 15, multishot: 1, magazine: 200, reload: 3, masteryReq: 7,
};

const MODS: ModEntry[] = [
  flat('Serration', '+165% Damage', { fusionLimit: 10 }),
  flat('PrimedSerration', '+180% Damage', { family: '/Mods/Rifle/Serration', fusionLimit: 10 }),
  flat('PointStrike', '+150% Critical Chance'),
  flat('VitalSense', '+120% Critical Damage'),
  flat('SplitChamber', '+90% Multishot'),
  flat('Heat', '+90% <DT_FIRE_COLOR>Heat'),
  flat('Cold', '+90% <DT_FREEZE_COLOR>Cold'),
  flat('Toxin', '+90% <DT_POISON_COLOR>Toxin'),
  flat('Electric', '+90% <DT_ELECTRICITY_COLOR>Electricity'),
  flat('Speed', '+60% Fire Rate (x2 for Bows)'),
  flat('AmmoDrum', '+30% Ammo Maximum'),
  flat('Shotty', '+90% Damage', { compatName: 'Shotgun' }),
  flat('Scope', '+20% Zoom', { isUtility: true }),
];

const ARCANES: ArcaneEntry[] = [
  { uniqueName: '/A/Merciless', name: name('Primary Merciless'), rarity: 'RARE', target: 'primary', stats: [['On Kill:\r\n+30% Damage for 4s. Stacks up to 12x.']], statsRu: [] },
  { uniqueName: '/A/Grace', name: name('Arcane Grace'), rarity: 'RARE', target: 'warframe', stats: [['+1 Arcane Revive']], statsRu: [] },
];

const BASE_OPTIONS = { goal: 'burst' as const, conditional: false, autoForma: true, potato: true };

describe('weaponCompatible', () => {
  it('accepts class mods and rejects other classes', () => {
    expect(weaponCompatible(MODS[0], SOMA)).toBe(true);
    expect(weaponCompatible(MODS[11], SOMA)).toBe(false);
  });

  it('accepts augments named after the weapon', () => {
    expect(weaponCompatible(flat('Aug', '+10% Damage', { compatName: 'Soma' }), SOMA)).toBe(true);
  });
});

describe('autoBuildWeapon', () => {
  it('picks damage mods, prefers the stronger family member and skips useless mods', () => {
    const build = autoBuildWeapon(SOMA, MODS, ARCANES, BASE_OPTIONS);
    const ids = build.mods.map((m) => m.uniqueName.split('/').pop());
    expect(ids).toContain('PrimedSerration');
    expect(ids).not.toContain('Serration');
    expect(ids).not.toContain('AmmoDrum');
    expect(ids).not.toContain('Shotty');
    expect(build.mods.length).toBeLessThanOrEqual(8);
    expect(build.result.burstDps).toBeGreaterThan(10_000);
  });

  it('uses only owned mods at owned ranks when asked', () => {
    const owned = { '/Mods/Rifle/Serration': 5, '/Mods/Rifle/PointStrike': 5 };
    const build = autoBuildWeapon(SOMA, MODS, ARCANES, { ...BASE_OPTIONS, owned, allowMissing: false });
    expect(build.mods.map((m) => m.uniqueName).sort()).toEqual(['/Mods/Rifle/PointStrike', '/Mods/Rifle/Serration']);
    expect(build.missing).toEqual([]);
  });

  it('lists mods to buy when missing mods are allowed', () => {
    const owned = { '/Mods/Rifle/Serration': 10 };
    const build = autoBuildWeapon(SOMA, MODS, ARCANES, { ...BASE_OPTIONS, owned, allowMissing: true });
    expect(build.missing.length).toBeGreaterThan(0);
    expect(build.missing.every((m) => !(m.uniqueName in owned))).toBe(true);
  });

  it('builds the requested combined element', () => {
    const build = autoBuildWeapon(SOMA, MODS, ARCANES, { ...BASE_OPTIONS, requiredElement: 'viral' });
    expect(build.result.damage.viral).toBeGreaterThan(0);
  });

  it('respects capacity without forma', () => {
    const build = autoBuildWeapon(SOMA, MODS, ARCANES, { ...BASE_OPTIONS, autoForma: false, potato: false });
    expect(build.capacityUsed).toBeLessThanOrEqual(30);
  });

  it('adds a weapon arcane when conditional bonuses count', () => {
    expect(autoBuildWeapon(SOMA, MODS, ARCANES, { ...BASE_OPTIONS, conditional: true }).arcanes).toEqual(['/A/Merciless']);
    expect(autoBuildWeapon(SOMA, MODS, ARCANES, BASE_OPTIONS).arcanes).toEqual([]);
  });

  it('improves a given starting build', () => {
    const start = autoBuildWeapon(SOMA, MODS, ARCANES, { ...BASE_OPTIONS, initial: ['/Mods/Rifle/AmmoDrum'] });
    expect(start.mods.map((m) => m.uniqueName)).not.toContain('/Mods/Rifle/AmmoDrum');
  });
});

const EXCAL: FrameEntry = { uniqueName: '/P/Excal', name: name('Excalibur'), health: 270, shield: 270, armor: 225, energy: 100, sprint: 1, masteryReq: 0, abilities: [] };
const frameMod = (id: string, line: string, extra: Partial<ModEntry> = {}) => flat(id, line, { type: 'WARFRAME', compatName: 'WARFRAME', ...extra });
const FRAME_MODS: ModEntry[] = [
  frameMod('Intensify', '+30% Ability Strength'),
  frameMod('Transient', '-60% Ability Strength', { stats: Array(6).fill(['+99% Ability Duration', '-60% Ability Strength']) }),
  frameMod('Vitality', '+440% Health'),
  frameMod('Streamline', '+30% Ability Efficiency'),
  frameMod('Stretch', '+45% Ability Range'),
  frameMod('Aura', '+18% Ability Strength', { type: 'AURA', baseDrain: -4 }),
];

describe('frameCompatible', () => {
  it('accepts warframe mods and frame augments', () => {
    expect(frameCompatible(FRAME_MODS[0], EXCAL)).toBe(true);
    expect(frameCompatible(frameMod('Aug', '+1% Ability Strength', { compatName: 'Excalibur' }), EXCAL)).toBe(true);
    expect(frameCompatible(frameMod('Other', '+1% Ability Strength', { compatName: 'Volt' }), EXCAL)).toBe(false);
  });
});

describe('autoBuildFrame', () => {
  it('follows the stat weights', () => {
    const strength = autoBuildFrame(EXCAL, FRAME_MODS, ARCANES, { weights: { strength: 1 }, conditional: false, autoForma: true, potato: true });
    expect(strength.result.strength).toBeGreaterThan(1.3);
    expect(strength.mods.map((m) => m.uniqueName)).not.toContain('/Mods/Rifle/Transient');

    const tank = autoBuildFrame(EXCAL, FRAME_MODS, ARCANES, { weights: { survivability: 1 }, conditional: false, autoForma: true, potato: true });
    expect(tank.mods.map((m) => m.uniqueName)).toContain('/Mods/Rifle/Vitality');
  });

  it('puts an aura into the aura slot', () => {
    const build = autoBuildFrame(EXCAL, FRAME_MODS, ARCANES, { weights: { strength: 1 }, conditional: false, autoForma: true, potato: true });
    expect(build.aura?.uniqueName).toBe('/Mods/Rifle/Aura');
    expect(build.mods.map((m) => m.uniqueName)).not.toContain('/Mods/Rifle/Aura');
  });
});

const CATALOG = { weapons: [SOMA], frames: [EXCAL], mods: [...MODS, ...FRAME_MODS], arcanes: ARCANES, relics: [], recipes: [], names: {}, images: {} };

describe('evaluateBuild', () => {
  it('returns nothing until an item is chosen', () => {
    expect(evaluateBuild(emptyBuild('weapon'), CATALOG)).toBeUndefined();
  });

  it('computes a manual weapon build and its capacity', () => {
    const base = emptyBuild('weapon');
    const state = { ...base, itemId: SOMA.uniqueName, slots: base.slots.map((s, i) => (i === 0 ? { uniqueName: '/Mods/Rifle/Serration', rank: 10, polarity: 'AP_ATTACK' } : s)) };
    const evaluation = evaluateBuild(state, CATALOG)!;
    expect(evaluation.weapon?.totalPerPellet).toBeCloseTo(12 * 2.65);
    expect(evaluation.capacityUsed).toBe(7);
    expect(evaluation.capacity).toBe(60);
  });

  it('reports stat lines the calculator does not model', () => {
    const base = emptyBuild('weapon');
    const state = { ...base, itemId: SOMA.uniqueName, slots: base.slots.map((s, i) => (i === 0 ? { uniqueName: '/Mods/Rifle/AmmoDrum', rank: 5, polarity: '' } : s)) };
    expect(evaluateBuild(state, CATALOG)!.ignoredLines).toEqual(['+30% Ammo Maximum']);
  });

  it('adds aura capacity for warframes', () => {
    const base = emptyBuild('frame');
    const state = { ...base, itemId: EXCAL.uniqueName, aura: { uniqueName: '/Mods/Rifle/Aura', rank: 5, polarity: 'AP_ATTACK' } };
    const evaluation = evaluateBuild(state, CATALOG)!;
    expect(evaluation.capacity).toBe(60 + 18);
    expect(evaluation.frame?.strength).toBeCloseTo(1.18);
  });
});

describe('applyAutoBuild', () => {
  it('reproduces the optimizer result when loaded into the slots', () => {
    const auto = autoBuildWeapon(SOMA, MODS, ARCANES, { ...BASE_OPTIONS, conditional: true });
    const state = applyAutoBuild({ ...emptyBuild('weapon'), conditional: true, itemId: SOMA.uniqueName }, auto);
    const evaluation = evaluateBuild(state, CATALOG)!;
    expect(evaluation.weapon?.burstDps).toBeCloseTo(auto.result.burstDps);
    expect(evaluation.capacityUsed).toBe(auto.capacityUsed);
  });

  it('fills the aura slot for frames', () => {
    const auto = autoBuildFrame(EXCAL, FRAME_MODS, ARCANES, { weights: { strength: 1 }, conditional: false, autoForma: true, potato: true });
    const state = applyAutoBuild({ ...emptyBuild('frame'), itemId: EXCAL.uniqueName }, auto);
    expect(state.aura.uniqueName).toBe('/Mods/Rifle/Aura');
    expect(evaluateBuild(state, CATALOG)!.frame?.strength).toBeCloseTo(auto.result.strength);
  });
});

describe('meta weights', () => {
  it('lets popular mods with unmodelled effects win a slot', () => {
    const hunter = flat('Hunter', '+30% chance to apply Slash when Damage is a Critical Hit');
    const pool = [...MODS.filter((m) => !m.uniqueName.endsWith('Speed')), hunter];
    const without = autoBuildWeapon(SOMA, pool, [], { ...BASE_OPTIONS, autoForma: true });
    const withMeta = autoBuildWeapon(SOMA, pool, [], { ...BASE_OPTIONS, metaWeights: { [hunter.uniqueName]: 0.5 } });
    expect(without.mods.map((m) => m.uniqueName)).not.toContain(hunter.uniqueName);
    expect(withMeta.mods.map((m) => m.uniqueName)).toContain(hunter.uniqueName);
  });
});

describe('description-based restrictions', () => {
  const cannonade = flat('Cannonade', '+240% Damage', { semiAutoOnly: true, locksFireRate: true });
  const aimScope = flat('AimScope', '+200% Critical Damage', { conditional: true });

  it('keeps semi-auto-only mods off automatic weapons', () => {
    expect(weaponCompatible(cannonade, { ...SOMA, trigger: 'AUTO' })).toBe(false);
    expect(weaponCompatible(cannonade, { ...SOMA, trigger: 'SEMI' })).toBe(true);
  });

  it('cancels fire rate mods next to a fire-rate-locking mod', () => {
    const semi = { ...SOMA, trigger: 'SEMI' };
    const build = autoBuildWeapon(semi, [...MODS, cannonade], [], BASE_OPTIONS);
    const ids = build.mods.map((m) => m.uniqueName);
    expect(ids.includes(cannonade.uniqueName) && ids.includes('/Mods/Rifle/Speed')).toBe(false);
  });

  it('treats mods with a trigger description as conditional', () => {
    const build = autoBuildWeapon(SOMA, [...MODS, aimScope], [], BASE_OPTIONS);
    expect(build.mods.map((m) => m.uniqueName)).not.toContain(aimScope.uniqueName);
  });
});

describe('warframe aura and exilus', () => {
  const plainAura = frameMod('CapAura', '+10% Shield Recharge', { type: 'AURA', baseDrain: -7 });
  const rangeExilus = frameMod('Exi', '+25% Ability Range', { isUtility: true });

  it('fills the aura slot even when capacity is not tight', () => {
    const build = autoBuildFrame(EXCAL, [FRAME_MODS[0], plainAura], [], { weights: { strength: 1 }, conditional: false, autoForma: true, potato: true });
    expect(build.aura?.uniqueName).toBe(plainAura.uniqueName);
  });

  it('fills the exilus slot with a useful utility mod', () => {
    const build = autoBuildFrame(EXCAL, [...FRAME_MODS, rangeExilus], [], { weights: { range: 1 }, conditional: false, autoForma: true, potato: true });
    expect([build.exilus?.uniqueName, ...build.mods.map((m) => m.uniqueName)]).toContain(rangeExilus.uniqueName);
  });

  it('values survivability on a log scale so it does not drown other stats', () => {
    const build = autoBuildFrame(EXCAL, FRAME_MODS, [], { weights: { strength: 2, survivability: 1 }, conditional: false, autoForma: true, potato: true });
    expect(build.result.strength).toBeGreaterThan(1.3);
  });
});

describe('enemy-aware optimization', () => {
  const grineer = { armor: 0, armorStrip: 0, weak: ['impact', 'corrosive'] as const, resist: [] as const };

  it('builds the element the enemy is weak to', () => {
    const build = autoBuildWeapon(SOMA, MODS, [], { ...BASE_OPTIONS, enemy: { ...grineer, weak: [...grineer.weak], resist: [] } });
    expect(build.result.damage.corrosive).toBeGreaterThan(0);
  });

  it('reports DPS against the enemy, reduced by armor', () => {
    const build = autoBuildWeapon(SOMA, MODS, [], { ...BASE_OPTIONS, enemy: { armor: 300, armorStrip: 0, weak: [], resist: [] } });
    expect(build.effectiveDps).toBeCloseTo(build.result.burstDps * 0.5);
  });
});

describe('riven, bonus element and situational inputs', () => {
  const riven = { lines: ['+200% Critical Chance', '+100% Multishot'], drain: 12 };

  it('keeps a riven in the build and leaves one slot less for mods', () => {
    const withRiven = autoBuildWeapon(SOMA, MODS, [], { ...BASE_OPTIONS, riven });
    const without = autoBuildWeapon(SOMA, MODS, [], BASE_OPTIONS);
    expect(withRiven.mods.length).toBeLessThanOrEqual(7);
    expect(withRiven.result.multishot).toBeGreaterThan(1.9);
    expect(withRiven.result.burstDps).toBeGreaterThan(without.result.burstDps);
    expect(withRiven.capacityUsed).toBeGreaterThanOrEqual(12);
  });

  it('uses the Kuva/Tenet bonus element', () => {
    const build = autoBuildWeapon(SOMA, MODS.filter((m) => !/Heat|Cold|Toxin|Electric/.test(m.uniqueName)), [], { ...BASE_OPTIONS, bonusElement: { type: 'heat', fraction: 0.6 } });
    expect(build.result.damage.heat).toBeGreaterThan(0);
  });

  it('values combo mods only when a combo multiplier is set', () => {
    const bloodRush = flat('BloodRush', '+400% Critical Chance stacks with Combo Multiplier');
    const pool = [...MODS, bloodRush];
    expect(autoBuildWeapon(SOMA, pool, [], BASE_OPTIONS).mods.map((m) => m.uniqueName)).not.toContain(bloodRush.uniqueName);
    expect(autoBuildWeapon(SOMA, pool, [], { ...BASE_OPTIONS, comboMultiplier: 12 }).mods.map((m) => m.uniqueName)).toContain(bloodRush.uniqueName);
  });
});

describe('evaluateBuild with the new inputs', () => {
  const soma = (state: Partial<ReturnType<typeof emptyBuild>>) => ({ ...emptyBuild('weapon'), itemId: SOMA.uniqueName, ...state });

  it('adds riven stats and drain', () => {
    const evaluation = evaluateBuild(soma({ riven: { text: '+100% Multishot\n+50% Critical Chance', drain: 9 } }), CATALOG)!;
    expect(evaluation.weapon?.multishot).toBeCloseTo(2);
    expect(evaluation.capacityUsed).toBe(9);
  });

  it('applies the bonus element and the enemy model', () => {
    const evaluation = evaluateBuild(soma({ bonusElement: { type: 'toxin', fraction: 0.5 }, enemy: { armor: 300, armorStrip: 0, weak: [], resist: [] } }), CATALOG)!;
    expect(evaluation.weapon?.damage.toxin).toBeCloseTo(6);
    expect(evaluation.effectiveDps).toBeCloseTo((evaluation.weapon?.burstDps ?? 0) * 0.5);
  });

  it('adds archon shards to warframes', () => {
    const state = { ...emptyBuild('frame'), itemId: EXCAL.uniqueName, shards: [{ type: 'crimson' as const, stat: 'strength' as const, tauforged: true }] };
    expect(evaluateBuild(state, CATALOG)!.frame?.strength).toBeCloseTo(1.15);
  });
});

describe('status effects in optimization', () => {
  const statusGun = { ...SOMA, statusChance: 0.5, critChance: 0.05 };

  it('builds Viral on a status weapon when statuses are modelled', () => {
    const build = autoBuildWeapon(statusGun, MODS, [], { ...BASE_OPTIONS, statusEffects: true });
    expect(build.result.damage.viral).toBeGreaterThan(0);
    expect(build.effectiveDps).toBeGreaterThan(build.result.burstDps);
  });

  it('shows the status-aware damage in a manual build', () => {
    const state = { ...emptyBuild('weapon'), itemId: SOMA.uniqueName, statusEffects: true, bonusElement: { type: 'viral' as const, fraction: 0.5 } };
    const evaluation = evaluateBuild(state, CATALOG)!;
    expect(evaluation.target?.viralBonus).toBeGreaterThan(0);
    expect(evaluation.effectiveDps).toBeCloseTo(evaluation.target?.total ?? 0);
  });
});
