/**
 * "My mods" and build import: screenshots, clipboard images, pasted text
 * (e.g. from overframe.gg) or a live screen capture the player starts.
 * Everything is recognized locally; the game itself is never touched.
 */
import { errorBox, h, replace, toast } from '../../core/dom';
import { glyph } from '../../core/icons';
import type { Catalog } from '../../data/catalog';
import type { MetaLibrary } from './logic/metaLearning';
import { matchNames, type NameEntry, type OcrMatch } from './logic/ocrMatch';

type OcrInput = HTMLCanvasElement | Blob;
type OcrWorker = { recognize(image: OcrInput): Promise<{ data: { text: string } }>; terminate(): Promise<unknown> };

const WATCH_INTERVAL_MS = 2_500;
const SHOWN_OWNED = 80;

let worker: Promise<OcrWorker> | undefined;

async function recognize(image: OcrInput): Promise<string> {
  worker ??= import('tesseract.js').then(({ createWorker }) => createWorker(['rus', 'eng']) as Promise<OcrWorker>);
  worker.catch(() => { worker = undefined; });
  const { data } = await (await worker).recognize(image);
  return data.text;
}

export interface OwnedProps {
  readonly catalog: Catalog;
  readonly owned: Readonly<Record<string, number>>;
  readonly library: MetaLibrary;
  onOwned(next: Readonly<Record<string, number>>): void;
  onImport(modIds: readonly string[], panel: 'A' | 'B', isTopBuild: boolean): void;
  onResetLibrary(): void;
}

function nameEntries(catalog: Catalog): readonly NameEntry[] {
  return catalog.mods
    .filter((m) => !/\/(Beginner|Intermediate)\//.test(m.uniqueName))
    .map((m) => ({ id: m.uniqueName, names: [m.name.ru, m.name.en] }));
}

export function renderOwned(props: OwnedProps): { element: HTMLElement; cleanup: () => void } {
  const { catalog } = props;
  const entries = nameEntries(catalog);
  const modName = (id: string) => catalog.mods.find((m) => m.uniqueName === id)?.name.ru ?? id;
  const status = h('div', { class: 'small muted' }, 'Распознавание работает локально, при первом запуске скачиваются языковые данные (~20 МБ).');
  const found = h('div', { class: 'stack' });
  let matches: readonly OcrMatch[] = [];
  let selected = new Set<string>();
  let stopWatch: (() => void) | undefined;

  const showFound = () => {
    if (matches.length === 0) return replace(found);
    const isTop = h('input', { type: 'checkbox', checked: true });
    const chips = matches.map((m) => {
      const box = h('input', { type: 'checkbox', checked: selected.has(m.id) });
      box.addEventListener('change', () => { selected = box.checked ? new Set([...selected, m.id]) : new Set([...selected].filter((id) => id !== m.id)); });
      return h('label', { class: 'check badge', title: `распознано: «${m.text}» (${Math.round(m.similarity * 100)}%)` }, box, modName(m.id));
    });
    const chosen = () => matches.map((m) => m.id).filter((id) => selected.has(id));
    replace(found,
      h('b', {}, `Найдено модов: ${matches.length}`),
      h('div', { class: 'row' }, ...chips),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', on: { click: () => {
          const next = { ...props.owned };
          for (const id of chosen()) next[id] = next[id] ?? catalog.mods.find((m) => m.uniqueName === id)?.fusionLimit ?? 0;
          props.onOwned(next);
          toast(`Добавлено в «Мои моды»: ${chosen().length}`);
        } } }, 'Добавить в мои моды'),
        h('button', { class: 'btn secondary', type: 'button', on: { click: () => props.onImport(chosen(), 'A', isTop.checked) } }, 'Как сборку → A'),
        h('button', { class: 'btn secondary', type: 'button', on: { click: () => props.onImport(chosen(), 'B', isTop.checked) } }, 'Как сборку → B'),
        h('label', { class: 'check', title: 'Сборка с сайта или от сильного игрока: приложение учится на ней' }, isTop, 'Это топ-сборка (учить мету)')));
  };

  const absorb = (text: string, append = false) => {
    const next = matchNames(text, entries);
    const merged = append ? [...matches, ...next.filter((m) => !matches.some((o) => o.id === m.id))] : next;
    if (next.some((m) => !matches.some((o) => o.id === m.id))) selected = new Set([...selected, ...next.map((m) => m.id)]);
    matches = merged;
    if (!append) selected = new Set(next.map((m) => m.id));
    showFound();
    return next.length;
  };

  const fromImage = async (image: OcrInput) => {
    replace(status, h('span', { class: 'spinner' }), ' Распознаю изображение…');
    try {
      const count = absorb(await recognize(image));
      replace(status, count ? `Готово: найдено ${count}. Проверьте галочки.` : 'Названия модов не найдены. Попробуйте скрин крупнее или с другим масштабом интерфейса.');
    } catch (error) {
      console.error('[ocr]', error);
      replace(status, errorBox(`Не удалось распознать: ${(error as Error).message}`));
    }
  };

  const watch = h('button', { class: 'btn secondary', type: 'button' }, 'Смотреть экран');
  const startWatch = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = h('video', { muted: true, playsInline: true });
      video.srcObject = stream;
      await video.play();
      const canvas = h('canvas', {});
      let busy = false;
      const timer = setInterval(async () => {
        if (busy || video.videoWidth === 0) return;
        busy = true;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d')?.drawImage(video, 0, 0);
        try {
          absorb(await recognize(canvas), true);
          replace(status, `Смотрю экран… найдено модов: ${matches.length}. Листайте коллекцию модов в игре.`);
        } catch (error) {
          console.error('[ocr] frame', error);
        } finally {
          busy = false;
        }
      }, WATCH_INTERVAL_MS);
      stopWatch = () => {
        clearInterval(timer);
        stream.getTracks().forEach((t) => t.stop());
        stopWatch = undefined;
        watch.textContent = 'Смотреть экран';
        replace(status, `Просмотр остановлен. Найдено модов: ${matches.length}.`);
      };
      stream.getVideoTracks()[0]?.addEventListener('ended', () => stopWatch?.());
      watch.textContent = 'Остановить просмотр';
    } catch (error) {
      replace(status, (error as Error).name === 'NotAllowedError' ? 'Доступ к экрану не выдан.' : errorBox(`Захват экрана недоступен: ${(error as Error).message}`));
    }
  };
  watch.addEventListener('click', () => (stopWatch ? stopWatch() : void startWatch()));

  const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
  file.addEventListener('change', () => { const f = file.files?.[0]; if (f) void fromImage(f); file.value = ''; });
  const zone = h('div', { class: 'drop-zone' }, glyph('image', 30), h('b', {}, 'Перетащите скриншот сюда'), h('span', { class: 'small' }, 'из игры или со страницы сборки на overframe.gg — или нажмите Ctrl+V'));
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const f = e.dataTransfer?.files[0];
    if (f?.type.startsWith('image/')) void fromImage(f);
  });
  const onPaste = (e: ClipboardEvent) => {
    const image = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))?.getAsFile();
    if (image) void fromImage(image);
  };
  document.addEventListener('paste', onPaste);

  const text = h('textarea', { class: 'field', rows: 3, placeholder: 'Или вставьте текст: список модов со страницы сборки (overframe.gg), из чата или заметок', style: 'width:100%' });
  const ownedIds = Object.keys(props.owned);
  const ownedChips = ownedIds.slice(0, SHOWN_OWNED).map((id) => h('span', { class: 'badge' }, modName(id), ' ',
    h('button', { class: 'btn ghost', type: 'button', title: 'Убрать', style: 'padding:0 4px', on: { click: () => {
      const next = { ...props.owned };
      delete next[id];
      props.onOwned(next);
    } } }, '×')));
  const learned = Object.values(props.library.groups).reduce((sum, g) => sum + g.builds, 0);

  const element = h('div', { class: 'card stack' },
    h('h2', { style: 'margin:0' }, 'Мои моды и импорт сборок'),
    h('div', { class: 'row' },
      h('button', { class: 'btn secondary', type: 'button', on: { click: () => file.click() } }, glyph('image', 15), 'Загрузить скриншот'), file, watch,
      h('span', { class: 'small muted' }, 'Экран захватывается средствами браузера; в игру ничего не передаётся и память игры не читается.')),
    zone,
    h('div', { class: 'row' }, text, h('button', { class: 'btn secondary', type: 'button', on: { click: () => {
      const count = absorb(text.value);
      replace(status, count ? `Найдено модов: ${count}` : 'В тексте не найдено названий модов');
    } } }, 'Распознать текст')),
    status,
    found,
    h('div', { class: 'stack' },
      h('div', { class: 'row' }, h('b', {}, `Отмечено модов: ${ownedIds.length}`),
        ownedIds.length ? h('button', { class: 'btn ghost', type: 'button', on: { click: () => props.onOwned({}) } }, 'Очистить') : null),
      ownedIds.length ? h('div', { class: 'row' }, ...ownedChips, ownedIds.length > SHOWN_OWNED ? h('span', { class: 'muted small' }, `и ещё ${ownedIds.length - SHOWN_OWNED}`) : null)
        : h('div', { class: 'small muted' }, 'Пока пусто: оптимизатор считает, что у вас есть все моды максимального ранга.')),
    h('div', { class: 'row small' }, h('span', {}, `Изучено топ-сборок: ${learned}`),
      learned ? h('button', { class: 'btn ghost', type: 'button', on: { click: props.onResetLibrary } }, 'Сбросить обучение') : null));

  const cleanup = () => {
    stopWatch?.();
    document.removeEventListener('paste', onPaste);
  };
  return { element, cleanup };
}

export async function shutdownOcr(): Promise<void> {
  const current = worker;
  worker = undefined;
  await (await current)?.terminate();
}
