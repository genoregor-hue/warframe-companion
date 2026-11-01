import { describe, expect, it } from 'vitest';
import { parseDropTables, parseChance } from './dropTables';

const SAMPLE = `
<h3 id="missionRewards">Missions:</h3>
<table>
<tr><th colspan="2">Mercury/Apollodorus (Survival)</th></tr>
<tr><th colspan="2">Rotation A</th></tr>
<tr><td>100 Endo</td><td>Common (50.00%)</td></tr>
<tr><th colspan="2">Rotation C</th></tr>
<tr><td>Lith L8 Relic</td><td>Uncommon (11.06%)</td></tr>
<tr class="blank-row"><td class="blank-row" colspan="2"></td></tr>
<tr><th colspan="2">Earth/Mantle (Capture)</th></tr>
<tr><td>Serration</td><td>Rare (7.69%)</td></tr>
</table>
<h3 id="relicRewards">Relics:</h3>
<table>
<tr><th colspan="2">Axi A1 Relic (Intact)</th></tr>
<tr><td>Akstiletto Prime Barrel</td><td>Uncommon (11.00%)</td></tr>
<tr><td>Nikana Prime Blueprint</td><td>Rare (2.00%)</td></tr>
<tr class="blank-row"><td class="blank-row" colspan="2"></td></tr>
<tr><th colspan="2">Axi A1 Relic (Radiant)</th></tr>
<tr><td>Nikana Prime Blueprint</td><td>Rare (10.00%)</td></tr>
</table>
<h3 id="transientRewards">Dynamic Location Rewards:</h3>
<table>
<tr id="arbitrations"><th colspan="2">Arbitrations</th></tr>
<tr><th>Rotation B</th><td></td></tr>
<tr><td>Arcane Bodyguard</td><td>Rare (5.00%)</td></tr>
</table>
<h3 id="cetusRewards">Cetus Bounty Rewards:</h3>
<table><tr><th colspan="3">Level 5 - 15 Cetus Bounty</th></tr>
<tr><th colspan="3">Rotation A</th></tr>
<tr><td class="pad-cell"></td><th colspan="2">Stage 1</th></tr>
<tr><td></td><td>Gara Chassis Blueprint</td><td>Rare (7.52%)</td></tr>
</table>
<h3 id="modByAvatar">Mod Drops by Source:</h3>
<table>
<tr><th>Scaldra Screamer</th><th colspan="2">Mod Drop Chance: 100.00%</th></tr><tr><td></td><td>Arcane Truculence</td><td>Uncommon (12.50%)</td></tr>
</table>
<h3 id="modByDrop">Mod Drops by Mod:</h3>
<table>
<tr><th colspan="3">Target Acquired</th></tr>
<tr><th>Source</th><th>Mod Drop Chance</th><th>Chance</th></tr>
<tr><td>Tusk Thumper</td><td>15.00%</td><td>Uncommon (12.50%)</td></tr>
</table>
<h3 id="resourceByDrop">Resource Drops by Resource:</h3>
<table>
<tr><th colspan="3">Sharrac Teeth</th></tr>
<tr><th>Source</th><th>Resource Drop Chance</th><th>Chance</th></tr>
<tr><td>Tusk Thumper Doma</td><td>800.00%</td><td>Rare (4.17%)</td></tr>
</table>
<h3 id="relicByAvatar">Relic Drops by Source:</h3>
<table>
<tr><th>Hemocyte</th><th colspan="2">Relic Drop Chance: 20.00%</th></tr><tr><td></td><td>Lith A13 Relic</td><td>Uncommon (12.91%)</td></tr>
</table>
<h3 id="keyRewards">Keys:</h3>
<table>
<tr><th colspan="2">Recover The Orokin Archive</th></tr><tr><th colspan="2">Rotation A</th></tr><tr><td>Kavat&#39;s Grace &amp; Co</td><td>Uncommon (15.18%)</td></tr>
</table>
`;

describe('parseChance', () => {
  it('reads rarity and percentage', () => {
    expect(parseChance('Uncommon (11.06%)')).toEqual({ rarity: 'Uncommon', chance: 0.1106 });
  });

  it('reads multi-word rarity', () => {
    expect(parseChance('Very Common (100.00%)')).toEqual({ rarity: 'Very Common', chance: 1 });
  });

  it('returns null for unparsable text', () => {
    expect(parseChance('n/a')).toBeNull();
  });
});

describe('parseDropTables', () => {
  const entries = parseDropTables(SAMPLE);
  const find = (item: string) => entries.filter((e) => e.item === item);

  it('parses mission rewards with rotations', () => {
    expect(find('Lith L8 Relic')).toEqual([
      { item: 'Lith L8 Relic', kind: 'mission', source: 'Mercury/Apollodorus (Survival)', rotation: 'C', rarity: 'Uncommon', chance: 0.1106 },
    ]);
  });

  it('resets rotation when a new mission starts', () => {
    expect(find('Serration')[0]).toMatchObject({ source: 'Earth/Mantle (Capture)', rotation: undefined, chance: 0.0769 });
  });

  it('parses relic refinements separately', () => {
    const nikana = find('Nikana Prime Blueprint');
    expect(nikana.map((e) => [e.source, e.refinement, e.chance])).toEqual([
      ['Axi A1 Relic', 'Intact', 0.02],
      ['Axi A1 Relic', 'Radiant', 0.1],
    ]);
    expect(nikana[0].kind).toBe('relic');
  });

  it('parses dynamic locations with th+td rotation rows', () => {
    expect(find('Arcane Bodyguard')[0]).toMatchObject({ kind: 'dynamic', source: 'Arbitrations', rotation: 'B', chance: 0.05 });
  });

  it('parses bounty stages', () => {
    expect(find('Gara Chassis Blueprint')[0]).toMatchObject({
      kind: 'bounty', source: 'Level 5 - 15 Cetus Bounty', rotation: 'A', stage: 'Stage 1', chance: 0.0752,
    });
  });

  it('multiplies source chance in by-drop tables', () => {
    const [entry] = find('Target Acquired');
    expect(entry).toMatchObject({ kind: 'enemy', source: 'Tusk Thumper' });
    expect(entry.chance).toBeCloseTo(0.15 * 0.125, 6);
  });

  it('multiplies multi-roll resource drop chances', () => {
    expect(find('Sharrac Teeth')[0].chance).toBeCloseTo(0.3336, 6);
  });

  it('skips by-source mod tables that duplicate by-drop tables', () => {
    expect(find('Arcane Truculence')).toEqual([]);
  });

  it('parses relic drops by enemy source', () => {
    const [entry] = find('Lith A13 Relic');
    expect(entry).toMatchObject({ kind: 'enemy', source: 'Hemocyte' });
    expect(entry.chance).toBeCloseTo(0.2 * 0.1291, 6);
  });

  it('decodes html entities and tags key rewards', () => {
    expect(find("Kavat's Grace & Co")[0]).toMatchObject({ kind: 'key', rotation: 'A' });
  });

  it('returns an empty list for html without known sections', () => {
    expect(parseDropTables('<html><body>nothing</body></html>')).toEqual([]);
  });
});
