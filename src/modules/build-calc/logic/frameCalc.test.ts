import { describe, expect, it } from 'vitest';
import { computeFrame, SHARD_OPTIONS, type FrameBase } from './frameCalc';
import { parseStatLines } from './modStats';

const EXCALIBUR: FrameBase = { health: 270, shield: 270, armor: 225, energy: 100 };
const mods = (...lines: string[][]) => lines.map((l) => parseStatLines(l).stats);
const OPTIONS = { conditional: false };

describe('computeFrame', () => {
  it('uses rank 30 base values', () => {
    const r = computeFrame(EXCALIBUR, [], OPTIONS);
    expect(r).toMatchObject({ health: 370, shield: 370, armor: 225, energy: 150, strength: 1, duration: 1, range: 1, efficiency: 1 });
  });

  it('adds ability stats from mods', () => {
    const r = computeFrame(EXCALIBUR, mods(['+30% Ability Strength'], ['-60% Ability Strength', '+90% Ability Range']), OPTIONS);
    expect(r.strength).toBeCloseTo(0.7);
    expect(r.range).toBeCloseTo(1.9);
  });

  it('caps efficiency at 175%', () => {
    const r = computeFrame(EXCALIBUR, mods(['+30% Ability Efficiency'], ['+60% Ability Efficiency']), OPTIONS);
    expect(r.efficiency).toBe(1.75);
  });

  it('keeps duration and range above their floors', () => {
    const r = computeFrame(EXCALIBUR, mods(['-90% Ability Duration'], ['-90% Ability Range']), OPTIONS);
    expect(r.duration).toBe(0.125);
    expect(r.range).toBe(0.34);
  });

  it('never drops strength below zero', () => {
    expect(computeFrame(EXCALIBUR, mods(['-150% Ability Strength']), OPTIONS).strength).toBe(0);
  });

  it('scales health, shield, armor and energy by percentage of base', () => {
    const r = computeFrame(EXCALIBUR, mods(['+100% Health'], ['+100% Shield Capacity'], ['+100% Armor'], ['+50% Energy Max']), OPTIONS);
    expect(r).toMatchObject({ health: 740, shield: 740, armor: 450, energy: 225 });
  });

  it('computes damage reduction and effective health', () => {
    const r = computeFrame(EXCALIBUR, [], OPTIONS);
    expect(r.damageReduction).toBeCloseTo(225 / 525);
    expect(r.effectiveHealth).toBeCloseTo(370 * (1 + 225 / 300) + 370);
  });
});

describe('archon shards', () => {
  it('adds ability strength and duration from crimson shards, more when tauforged', () => {
    const r = computeFrame(EXCALIBUR, [], { conditional: false, shards: [{ type: 'crimson', stat: 'strength', tauforged: false }, { type: 'crimson', stat: 'strength', tauforged: true }] });
    expect(r.strength).toBeCloseTo(1.25);
  });

  it('adds flat survivability from azure shards', () => {
    const r = computeFrame(EXCALIBUR, [], { conditional: false, shards: [{ type: 'azure', stat: 'health', tauforged: false }, { type: 'azure', stat: 'armor', tauforged: false }] });
    expect(r.health).toBeCloseTo(370 + 150);
    expect(r.armor).toBeCloseTo(225 + 150);
  });

  it('lists the shard options it supports', () => {
    expect(SHARD_OPTIONS.map((o) => `${o.type}:${o.stat}`)).toEqual(['crimson:strength', 'crimson:duration', 'azure:health', 'azure:shield', 'azure:armor', 'azure:energy']);
  });
});
