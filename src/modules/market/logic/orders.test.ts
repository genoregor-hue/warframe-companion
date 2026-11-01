import { describe, expect, it } from 'vitest';
import { indexMarketItems, summarizeOrders, whisperMessage } from './orders';

const order = (name: string, platinum: number, status: string, extra: Record<string, unknown> = {}) => ({
  type: 'sell', platinum, quantity: 1, rank: 10, visible: true,
  user: { ingameName: name, status, platform: 'pc', reputation: 5 }, ...extra,
});

describe('indexMarketItems', () => {
  it('maps game uniqueNames to market slugs and names', () => {
    const index = indexMarketItems({ data: [
      { slug: 'serration', gameRef: '/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod', maxRank: 10, i18n: { en: { name: 'Serration' }, ru: { name: 'Зазубрины' } } },
      { slug: 'broken', i18n: {} },
    ] });
    expect(index).toEqual({ '/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod': { slug: 'serration', name: { en: 'Serration', ru: 'Зазубрины' }, maxRank: 10 } });
  });

  it('returns an empty index for malformed payloads', () => {
    expect(indexMarketItems(null)).toEqual({});
  });
});

describe('summarizeOrders', () => {
  const payload = { data: [
    order('Cheap', 20, 'offline'),
    order('Ingame', 35, 'ingame'),
    order('Online', 30, 'online'),
    order('Buyer', 90, 'ingame', { type: 'buy' }),
    order('Unranked', 12, 'ingame', { rank: 0 }),
    order('Hidden', 1, 'ingame', { visible: false }),
    order('Ingame2', 40, 'ingame'),
  ] };

  it('lists in-game sellers first, cheapest first', () => {
    const summary = summarizeOrders(payload, { rank: 10 });
    expect(summary.sellers.map((s) => s.ingameName)).toEqual(['Ingame', 'Ingame2', 'Online', 'Cheap']);
  });

  it('reports the cheapest in-game and overall prices for the rank', () => {
    expect(summarizeOrders(payload, { rank: 10 })).toMatchObject({ minIngame: 35, minAny: 20, sellCount: 4 });
  });

  it('can look at unranked copies', () => {
    expect(summarizeOrders(payload, { rank: 0 })).toMatchObject({ minIngame: 12, sellCount: 1 });
  });

  it('ignores rank for items without ranks', () => {
    const plain = { data: [order('A', 15, 'ingame', { rank: undefined })] };
    expect(summarizeOrders(plain, {}).minIngame).toBe(15);
  });

  it('handles empty or broken responses', () => {
    expect(summarizeOrders({}, { rank: 10 })).toEqual({ sellers: [], sellCount: 0 });
  });

  it('limits the number of sellers', () => {
    expect(summarizeOrders(payload, { rank: 10, limit: 2 }).sellers).toHaveLength(2);
  });
});

describe('whisperMessage', () => {
  it('builds the standard warframe.market whisper', () => {
    expect(whisperMessage({ seller: 'Tenno', itemName: 'Serration', rank: 10, platinum: 35 }))
      .toBe('/w Tenno Hi! I want to buy: "Serration (rank 10)" for 35 platinum. (warframe.market)');
  });

  it('omits rank when it does not apply', () => {
    expect(whisperMessage({ seller: 'Tenno', itemName: 'Soma Prime Barrel', platinum: 8 }))
      .toBe('/w Tenno Hi! I want to buy: "Soma Prime Barrel" for 8 platinum. (warframe.market)');
  });
});
