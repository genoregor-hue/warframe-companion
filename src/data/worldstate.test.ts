import { describe, expect, it } from 'vitest';
import { normalizeOfficial, normalizeWarframestat, stripStoreItems } from './worldstate';

const NOW = Date.parse('2026-10-30T17:00:00Z');

describe('stripStoreItems', () => {
  it('removes the StoreItems folder', () => {
    expect(stripStoreItems('/Lotus/StoreItems/Types/Game/Projections/T1Relic')).toBe('/Lotus/Types/Game/Projections/T1Relic');
  });
});

describe('normalizeWarframestat', () => {
  const raw = {
    fissures: [
      { node: 'Callisto (Jupiter)', missionType: 'Interception', tier: 'Meso', isHard: true, isStorm: false, expiry: '2026-10-30T18:31:19.027Z' },
      { node: 'Old (Mars)', missionType: 'Capture', tier: 'Lith', isHard: false, isStorm: false, expiry: '2026-10-30T16:00:00.000Z' },
    ],
    invasions: [
      { node: 'Amalthea (Jupiter)', completed: false, completion: 22.1,
        attacker: { reward: { countedItems: [{ uniqueName: '/Lotus/Types/Items/Research/ChemComponent', type: 'Detonite Injector', count: 3 }] } },
        defender: { reward: { countedItems: [] } } },
      { node: 'Done (Earth)', completed: true, attacker: { reward: { countedItems: [{ uniqueName: '/X', type: 'X', count: 1 }] } }, defender: {} },
    ],
    vaultTrader: { active: true, expiry: '2026-11-26T18:00:00.000Z', location: "Maroo's Bazaar (Mars)",
      inventory: [{ uniqueName: '/Lotus/StoreItems/Types/Game/Projections/T1VoidProjectionA', item: 'T1' }] },
    events: [{ description: 'Hallowed Nightmares', expiry: '2026-11-02T16:00:00.000Z',
      rewards: [{ countedItems: [{ uniqueName: '/Lotus/StoreItems/Upgrades/Skins/Dangle', type: 'Pumpkin Dangle', count: 1 }] }] }],
  };
  const ws = normalizeWarframestat(raw, NOW);

  it('keeps only active fissures', () => {
    expect(ws.fissures).toEqual([
      { node: 'Callisto (Jupiter)', missionType: 'Interception', tier: 'Meso', steelPath: true, storm: false, expiry: '2026-10-30T18:31:19.027Z' },
    ]);
  });

  it('collects rewards of unfinished invasions', () => {
    expect(ws.invasions).toEqual([{ node: 'Amalthea (Jupiter)', completion: 22.1,
      rewards: [{ uniqueName: '/Lotus/Types/Items/Research/ChemComponent', name: 'Detonite Injector', count: 3 }] }]);
  });

  it('reads the vault trader inventory without StoreItems', () => {
    expect(ws.vaultTrader).toEqual({ expiry: '2026-11-26T18:00:00.000Z', location: "Maroo's Bazaar (Mars)",
      items: ['/Lotus/Types/Game/Projections/T1VoidProjectionA'] });
  });

  it('reads events with their rewards', () => {
    expect(ws.events).toEqual([{ name: 'Hallowed Nightmares', expiry: '2026-11-02T16:00:00.000Z',
      rewards: [{ uniqueName: '/Lotus/Upgrades/Skins/Dangle', name: 'Pumpkin Dangle', count: 1 }] }]);
  });

  it('treats a vault trader without an "active" flag as active until it expires', () => {
    const trader = { expiry: '2026-11-26T18:00:00.000Z', inventory: [{ uniqueName: '/Lotus/StoreItems/X' }] };
    expect(normalizeWarframestat({ vaultTrader: trader }, NOW).vaultTrader?.items).toEqual(['/Lotus/X']);
    expect(normalizeWarframestat({ vaultTrader: { ...trader, expiry: '2026-10-01T00:00:00Z' } }, NOW).vaultTrader).toBeUndefined();
  });

  it('tolerates missing sections', () => {
    expect(normalizeWarframestat({}, NOW)).toEqual({ source: 'warframestat', fissures: [], invasions: [], events: [] });
  });
});

describe('normalizeOfficial', () => {
  const date = (iso: string) => ({ $date: { $numberLong: String(Date.parse(iso)) } });
  const raw = {
    ActiveMissions: [
      { Node: 'SolNode718', MissionType: 'MT_EXTERMINATION', Modifier: 'VoidT4', Hard: true, Expiry: date('2026-10-30T18:00:00Z') },
      { Node: 'SolNode1', MissionType: 'MT_WEIRD_THING', Modifier: 'VoidT6', Expiry: date('2026-10-30T18:00:00Z') },
    ],
    VoidStorms: [{ Node: 'CrewBattleNode1', ActiveMissionTier: 'VoidT1', Expiry: date('2026-10-30T18:00:00Z') }],
    Invasions: [{ Node: 'SolNode97', Completed: false, Count: -16000, Goal: 32000,
      AttackerReward: { countedItems: [{ ItemType: '/Lotus/Types/Items/Research/ChemComponent', ItemCount: 3 }] },
      DefenderReward: [] }],
    PrimeVaultTraders: [{ Expiry: date('2026-11-26T18:00:00Z'), Manifest: [{ ItemType: '/Lotus/StoreItems/Types/Game/Projections/T2' }] }],
  };
  const names = { SolNode718: 'Узел (Плутон)', SolNode97: 'Амальтея (Юпитер)', '/Lotus/Types/Items/Research/ChemComponent': 'Детонитовый инжектор' };
  const ws = normalizeOfficial(raw, names, NOW);

  it('maps tiers, nodes and mission types', () => {
    expect(ws.fissures[0]).toEqual({ node: 'Узел (Плутон)', missionType: 'Extermination', tier: 'Axi', steelPath: true, storm: false, expiry: '2026-10-30T18:00:00.000Z' });
    expect(ws.fissures[1]).toMatchObject({ node: 'SolNode1', missionType: 'Weird Thing', tier: 'Omnia' });
  });

  it('marks void storms as railjack fissures', () => {
    expect(ws.fissures[2]).toMatchObject({ tier: 'Lith', storm: true });
  });

  it('computes invasion completion and names rewards', () => {
    expect(ws.invasions).toEqual([{ node: 'Амальтея (Юпитер)', completion: 50,
      rewards: [{ uniqueName: '/Lotus/Types/Items/Research/ChemComponent', name: 'Детонитовый инжектор', count: 3 }] }]);
  });

  it('reads Varzia inventory', () => {
    expect(ws.vaultTrader?.items).toEqual(['/Lotus/Types/Game/Projections/T2']);
  });
});
