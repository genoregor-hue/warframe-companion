import type { ModuleContext } from '../../core/context';
import { copyText, errorBox, h, heroBlock, loading, replace, searchBox, stageImage } from '../../core/dom';
import { glyph } from '../../core/icons';
import type { Catalog } from '../../data/catalog';
import type { MarketQuote, MarketService } from './contract';
import type { MarketIndex, Seller } from './logic/orders';

const STATUS_LABEL: Readonly<Record<Seller['status'], string>> = { ingame: 'в игре', online: 'на сайте', offline: 'не в сети' };
const STATUS_BADGE: Readonly<Record<Seller['status'], string>> = { ingame: 'green', online: 'blue', offline: '' };
const TAG_SELLERS = 5;

function sellersTable(service: MarketService, quote: MarketQuote, limit?: number): HTMLElement {
  const rows = quote.sellers.slice(0, limit).map((seller, i) => h('tr', {},
    h('td', {}, h('span', { class: `badge ${STATUS_BADGE[seller.status]}` }, STATUS_LABEL[seller.status])),
    h('td', {}, seller.ingameName),
    h('td', { class: 'num' }, `${seller.platinum} пл.`),
    h('td', { class: 'num' }, seller.rank === undefined ? '—' : `ранг ${seller.rank}`),
    h('td', { class: 'num' }, `×${seller.quantity}`),
    h('td', {}, h('button', {
      class: 'btn ghost', type: 'button',
      on: { click: () => { const text = service.whisper(quote, i); if (text) void copyText(text); } },
    }, glyph('copy', 14), 'Купить')),
  ));
  return h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Статус'), h('th', {}, 'Продавец'), h('th', { class: 'num' }, 'Цена'), h('th', { class: 'num' }, 'Ранг'), h('th', { class: 'num' }, 'Кол-во'), h('th', {}, ''))),
    h('tbody', {}, ...rows));
}

function summaryLine(quote: MarketQuote): string {
  if (quote.sellCount === 0) return 'Сейчас никто не продаёт';
  const ingame = quote.minIngame === undefined ? 'нет продавцов в игре' : `от ${quote.minIngame} пл. в игре`;
  return `${ingame} · минимум ${quote.minAny} пл. · предложений: ${quote.sellCount}`;
}

/** Compact price tag other modules embed via the market service. */
export function createPriceTag(service: MarketService, uniqueName: string, rank?: number): HTMLElement {
  const root = h('span', { class: 'price-tag' }, h('span', { class: 'spinner' }));
  service.quote(uniqueName, rank).then((quote) => {
    if (!quote) return replace(root, h('span', { class: 'muted small' }, 'не торгуется'));
    if (quote.sellCount === 0) return replace(root, h('span', { class: 'muted small' }, 'нет продавцов'));
    const details = h('div', { class: 'card inset', hidden: true, style: 'margin-top:8px' },
      sellersTable(service, quote, TAG_SELLERS),
      h('a', { href: quote.url, target: '_blank', rel: 'noopener noreferrer', class: 'small' }, 'Открыть на warframe.market'));
    const price = quote.minIngame ?? quote.minAny ?? 0;
    const button = h('button', { class: 'btn secondary', type: 'button', on: { click: () => { details.hidden = !details.hidden; } } },
      `${quote.minIngame === undefined ? 'от' : 'в игре от'} ${price} пл.`);
    replace(root, button, details);
  }).catch((error: Error) => {
    console.error('[market] quote', error);
    replace(root, h('span', { class: 'muted small', title: error.message }, 'цена недоступна'));
  });
  return root;
}

export function mountMarket(root: HTMLElement, ctx: ModuleContext, service: MarketService): void {
  const result = h('div', { class: 'section' });
  const searchSlot = h('div', {}, loading('Загружаю список предметов warframe.market…'));
  replace(root,
    heroBlock('Маркет', 'Лучшая цена.', 'Сразу.', 'Продавцы warframe.market, которые сейчас в игре. Покупка — через личные сообщения: скопируйте готовое сообщение продавцу.', glyph('market', 16)),
    h('div', { class: 'card' }, searchSlot),
    result);

  let pictures: Catalog['images'] = {};
  let ruNames: Catalog['names'] = {};

  const show = async (uniqueName: string, refresh = false) => {
    replace(result, h('div', { class: 'card' }, loading('Смотрю заказы…')));
    try {
      const quote = await service.quote(uniqueName, undefined, refresh);
      if (!quote) return replace(result, h('div', { class: 'card' }, errorBox('Этот предмет не продаётся на warframe.market')));
      ctx.storage.set('last', uniqueName);
      const name = ruNames[uniqueName]?.ru ?? quote.nameEn;
      const price = quote.minIngame ?? quote.minAny;
      replace(result,
        h('div', { class: 'card item-hero' },
          stageImage(pictures[uniqueName], name),
          h('div', {},
            h('div', { class: 'eyebrow' }, quote.rank === undefined ? 'warframe.market' : `Ранг ${quote.rank}`),
            h('div', { class: 'title' }, name),
            name !== quote.nameEn ? h('div', { class: 'sub' }, quote.nameEn) : null,
            price === undefined ? h('div', { class: 'sub' }, 'Сейчас никто не продаёт')
              : h('div', { class: 'price' }, String(price), h('small', {}, quote.minIngame === undefined ? 'пл. · минимум' : 'пл. · в игре')),
            h('div', { class: 'small muted' }, summaryLine(quote)),
            h('div', { class: 'chips' },
              h('button', { class: 'btn secondary', type: 'button', on: { click: () => void show(uniqueName, true) } }, glyph('refresh', 14), 'Обновить цены'),
              h('a', { class: 'btn ghost', href: quote.url, target: '_blank', rel: 'noopener noreferrer' }, 'warframe.market ↗')))),
        quote.sellCount > 0 ? h('div', { class: 'card' }, h('h2', { style: 'margin-bottom:12px' }, 'Продавцы'), sellersTable(service, quote)) : null);
    } catch (error) {
      replace(result, h('div', { class: 'card' }, errorBox(`Не удалось получить цены: ${(error as Error).message}`)));
    }
  };

  const catalogData = ctx.data.source<Catalog>('catalog').then((r) => r.data).catch(() => ({ names: {}, images: {} } as unknown as Catalog));
  Promise.all([ctx.data.source<MarketIndex>('market:items'), catalogData]).then(([{ data }, catalog]) => {
    pictures = catalog.images;
    ruNames = catalog.names;
    const names = catalog.names;
    // warframe.market returns English names only; Russian ones come from the Public Export by uniqueName.
    const items = Object.entries(data).map(([uniqueName, item]) => {
      const ru = names[uniqueName]?.ru ?? item.name.ru;
      return { uniqueName, ...item, name: { ...item.name, ru }, haystack: `${ru} ${item.name.en}`.toLowerCase() };
    });
    const find = (query: string) => {
      const q = query.toLowerCase();
      return items
        .filter((i) => i.haystack.includes(q))
        .sort((a, b) => Number(!a.haystack.startsWith(q)) - Number(!b.haystack.startsWith(q)) || a.name.ru.length - b.name.ru.length)
        .map((i) => ({ label: i.name.ru, hint: i.name.en, image: pictures[i.uniqueName], value: i.uniqueName }));
    };
    replace(searchSlot, searchBox('Название предмета: мод, часть прайма, аркейн…', find, (id) => void show(id)));
    const last = ctx.storage.get<string | null>('last', null);
    if (last && data[last]) void show(last);
  }).catch((error: Error) => replace(searchSlot, errorBox(`Список предметов маркета недоступен: ${error.message}`)));
}
