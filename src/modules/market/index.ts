import type { CoreContext } from '../../core/context';
import { defineModule } from '../../core/registry';
import { MARKET_SERVICE, type MarketQuote, type MarketService } from './contract';
import { summarizeOrders, whisperMessage, type MarketIndex } from './logic/orders';
import { createPriceTag, mountMarket } from './view';

function createMarketService(core: CoreContext): MarketService {
  const index = async () => (await core.data.source<MarketIndex>('market:items')).data;

  const service: MarketService = {
    async quote(uniqueName, rank, refresh = false): Promise<MarketQuote | undefined> {
      const item = (await index())[uniqueName];
      if (!item) return undefined;
      const orders = await core.data.source(`market:orders:${item.slug}`, { refresh });
      const effectiveRank = item.maxRank === undefined ? undefined : Math.min(rank ?? item.maxRank, item.maxRank);
      return {
        ...summarizeOrders(orders.data, { rank: effectiveRank }),
        slug: item.slug,
        nameEn: item.name.en,
        ...(effectiveRank === undefined ? {} : { rank: effectiveRank }),
        url: `https://warframe.market/items/${item.slug}`,
      };
    },
    whisper(quote, sellerIndex = 0) {
      const seller = quote.sellers[sellerIndex];
      return seller ? whisperMessage({ seller: seller.ingameName, itemName: quote.nameEn, rank: quote.rank, platinum: seller.platinum }) : undefined;
    },
    priceTag: (uniqueName, rank) => createPriceTag(service, uniqueName, rank),
  };
  return service;
}

export default defineModule({
  id: 'market',
  title: 'Маркет',
  icon: 'market',
  order: 30,
  description: 'Цены warframe.market и готовое сообщение продавцу',
  setup(core) {
    core.services.provide(MARKET_SERVICE, createMarketService(core));
  },
  mount(root, ctx) {
    const service = ctx.services.get<MarketService>(MARKET_SERVICE);
    if (service) mountMarket(root, ctx, service);
  },
});
