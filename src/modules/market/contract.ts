import type { OrderSummary } from './logic/orders';

/**
 * Service other modules can use when the market module is installed:
 *   const market = ctx.services.get<MarketService>(MARKET_SERVICE);
 * Always check for undefined: the module may be removed.
 */
export const MARKET_SERVICE = 'market.prices';

export interface MarketQuote extends OrderSummary {
  readonly slug: string;
  readonly nameEn: string;
  readonly rank?: number;
  readonly url: string;
}

export interface MarketService {
  /** Price for a game item by uniqueName; undefined if it is not tradeable on warframe.market. */
  quote(uniqueName: string, rank?: number, refresh?: boolean): Promise<MarketQuote | undefined>;
  whisper(quote: MarketQuote, sellerIndex?: number): string | undefined;
  /** Ready-made price tag: loads the price, lists sellers, copies the whisper on click. */
  priceTag(uniqueName: string, rank?: number): HTMLElement;
}
