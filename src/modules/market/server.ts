/**
 * Server-side sources of the market module, auto-loaded by server/plugin.ts.
 * warframe.market asks for at most ~3 requests per second, so calls are spaced out.
 */
import { fetchJson } from '../../../server/http';
import { defineSource } from '../../../server/sources';
import { indexMarketItems } from './logic/orders';

const API = 'https://api.warframe.market/v2';
const MIN_GAP_MS = 350;
const ITEMS_TTL_MS = 24 * 60 * 60 * 1000;
const ORDERS_TTL_MS = 5 * 60 * 1000;
const SLUG = /^market:orders:([a-z0-9_]+)$/;

let queue: Promise<unknown> = Promise.resolve();

function throttled<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined).then(() => new Promise((done) => setTimeout(done, MIN_GAP_MS)));
  return run;
}

type Raw = Record<string, unknown>;

/** Keep only what the client needs: visible PC sell orders. */
function slimOrders(payload: unknown): { data: Raw[] } {
  const data = Array.isArray((payload as Raw | undefined)?.data) ? ((payload as Raw).data as Raw[]) : [];
  return {
    data: data
      .filter((o) => o.type === 'sell' && o.visible !== false)
      .map((o) => {
        const user = (o.user ?? {}) as Raw;
        return {
          type: o.type, platinum: o.platinum, quantity: o.quantity, rank: o.rank, visible: o.visible,
          user: { ingameName: user.ingameName, status: user.status, reputation: user.reputation },
        };
      }),
  };
}

export const sources = [
  defineSource({
    id: 'market:items',
    title: 'warframe.market: список предметов',
    ttlMs: ITEMS_TTL_MS,
    refreshable: true,
    load: async () => indexMarketItems(await throttled(() => fetchJson(`${API}/items`))),
  }),
  defineSource({
    id: 'market:orders:*',
    idPattern: SLUG,
    title: 'warframe.market: заказы',
    ttlMs: ORDERS_TTL_MS,
    load: async (_ctx, id) => {
      const slug = SLUG.exec(id)?.[1];
      if (!slug) throw new Error(`Некорректный предмет маркета: ${id}`);
      return slimOrders(await throttled(() => fetchJson(`${API}/orders/item/${slug}`)));
    },
  }),
];
