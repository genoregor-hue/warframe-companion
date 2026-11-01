/** Pure helpers for warframe.market v2 responses. */

export interface MarketItem {
  readonly slug: string;
  readonly name: { readonly en: string; readonly ru: string };
  readonly maxRank?: number;
}

/** uniqueName (gameRef) → market item. */
export type MarketIndex = Readonly<Record<string, MarketItem>>;

export interface Seller {
  readonly ingameName: string;
  readonly platinum: number;
  readonly quantity: number;
  readonly rank?: number;
  readonly status: 'ingame' | 'online' | 'offline';
  readonly reputation: number;
}

export interface OrderSummary {
  readonly sellers: readonly Seller[];
  readonly sellCount: number;
  readonly minIngame?: number;
  readonly minAny?: number;
}

type Raw = Record<string, unknown>;

const DEFAULT_LIMIT = 8;
const STATUS_ORDER: Readonly<Record<Seller['status'], number>> = { ingame: 0, online: 1, offline: 2 };

const arr = (value: unknown): readonly Raw[] => (Array.isArray(value) ? (value as Raw[]) : []);
const obj = (value: unknown): Raw => (value && typeof value === 'object' ? (value as Raw) : {});
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

export function indexMarketItems(payload: unknown): Record<string, MarketItem> {
  const entries = arr(obj(payload).data).flatMap((item) => {
    const gameRef = str(item.gameRef);
    const slug = str(item.slug);
    const i18n = obj(item.i18n);
    const en = str(obj(i18n.en).name);
    if (!gameRef || !slug || !en) return [];
    const market: MarketItem = {
      slug,
      name: { en, ru: str(obj(i18n.ru).name) || en },
      ...(typeof item.maxRank === 'number' ? { maxRank: item.maxRank } : {}),
    };
    return [[gameRef, market] as const];
  });
  return Object.fromEntries(entries);
}

function toSeller(order: Raw): Seller | undefined {
  const user = obj(order.user);
  const status = str(user.status);
  if (order.type !== 'sell' || order.visible === false || typeof order.platinum !== 'number') return undefined;
  return {
    ingameName: str(user.ingameName),
    platinum: order.platinum,
    quantity: typeof order.quantity === 'number' ? order.quantity : 1,
    ...(typeof order.rank === 'number' ? { rank: order.rank } : {}),
    status: status === 'ingame' || status === 'online' ? status : 'offline',
    reputation: typeof user.reputation === 'number' ? user.reputation : 0,
  };
}

/** Keeps sell orders for the requested rank, in-game sellers first, then by price. */
export function summarizeOrders(payload: unknown, options: { rank?: number; limit?: number }): OrderSummary {
  const sellers = arr(obj(payload).data)
    .map(toSeller)
    .filter((s): s is Seller => s !== undefined)
    .filter((s) => options.rank === undefined || s.rank === undefined || s.rank === options.rank)
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.platinum - b.platinum);
  if (sellers.length === 0) return { sellers: [], sellCount: 0 };
  const ingame = sellers.filter((s) => s.status === 'ingame');
  return {
    sellers: sellers.slice(0, options.limit ?? DEFAULT_LIMIT),
    sellCount: sellers.length,
    ...(ingame.length > 0 ? { minIngame: Math.min(...ingame.map((s) => s.platinum)) } : {}),
    minAny: Math.min(...sellers.map((s) => s.platinum)),
  };
}

/** The message warframe.market itself suggests; the player pastes it into in-game chat. */
export function whisperMessage({ seller, itemName, rank, platinum }: { seller: string; itemName: string; rank?: number; platinum: number }): string {
  const label = rank === undefined ? itemName : `${itemName} (rank ${rank})`;
  return `/w ${seller} Hi! I want to buy: "${label}" for ${platinum} platinum. (warframe.market)`;
}
