import { buildCatalog, type Catalog } from '../src/data/catalog';
import { parseDropTables, type DropEntry } from '../src/data/dropTables';
import { normalizeOfficial, normalizeWarframestat, type WorldState } from '../src/data/worldstate';
import { fetchJson, fetchText } from './http';
import type { ExportLang, PublicExportClient } from './publicExport';
import { defineSource, type SourceContext, type SourceDef } from './sources';

const DROP_TABLES_URL = 'https://www.warframe.com/droptables';
const WARFRAMESTAT_URL = 'https://api.warframestat.us/pc/?language=en';
const OFFICIAL_WORLDSTATE_URL = 'https://api.warframe.com/cdn/worldState.php';
const WORLDSTATE_TTL_MS = 60_000;
const DROP_TABLES_TIMEOUT_MS = 90_000;

const EXPORTS = ['ExportWeapons', 'ExportWarframes', 'ExportUpgrades', 'ExportRelicArcane', 'ExportResources', 'ExportRecipes', 'ExportRegions'] as const;
const LANGS: readonly ExportLang[] = ['en', 'ru'];

export const exportId = (name: (typeof EXPORTS)[number], lang: ExportLang) => `export:${name}:${lang}`;

export interface DropTablesData {
  readonly entries: readonly DropEntry[];
}

const MANIFEST_ID = 'export:ExportManifest';

function exportSources(client: PublicExportClient): SourceDef[] {
  const manifest = defineSource({
    id: MANIFEST_ID,
    title: 'Public Export: картинки предметов',
    ttlMs: Infinity,
    refreshable: true,
    load: () => client.fetchExportFile('ExportManifest.json'),
  });
  return [manifest, ...EXPORTS.flatMap((name) =>
    LANGS.map((lang) =>
      defineSource({
        id: exportId(name, lang),
        title: `Public Export: ${name} (${lang})`,
        ttlMs: Infinity,
        refreshable: true,
        load: () => client.fetchExport(name, lang),
      }),
    ),
  )];
}

async function loadCatalog(ctx: SourceContext): Promise<Catalog> {
  const set = async (lang: ExportLang) => {
    const [weapons, warframes, upgrades, relicArcane, resources] = await Promise.all([
      ctx.get(exportId('ExportWeapons', lang)),
      ctx.get(exportId('ExportWarframes', lang)),
      ctx.get(exportId('ExportUpgrades', lang)),
      ctx.get(exportId('ExportRelicArcane', lang)),
      ctx.get(exportId('ExportResources', lang)),
    ]);
    return { weapons, warframes, upgrades, relicArcane, resources };
  };
  const manifest = ctx.get(MANIFEST_ID).catch((error: Error) => {
    console.warn('[catalog] картинки недоступны:', error.message);
    return undefined;
  });
  const [en, ru, recipes, icons] = await Promise.all([set('en'), set('ru'), ctx.get(exportId('ExportRecipes', 'en')), manifest]);
  return buildCatalog({ en, ru, recipes, manifest: icons });
}

type Raw = Record<string, unknown>;

async function officialNames(ctx: SourceContext): Promise<Record<string, string>> {
  const regions = (await ctx.get<Raw>(exportId('ExportRegions', 'ru'))).ExportRegions;
  const nodes = Array.isArray(regions) ? (regions as Raw[]) : [];
  const catalog = await ctx.get<Catalog>('catalog');
  const items = Object.fromEntries(Object.entries(catalog.names).map(([id, name]) => [id, name.ru]));
  const nodeNames = Object.fromEntries(nodes.map((n) => [String(n.uniqueName), `${String(n.name)} (${String(n.systemName)})`]));
  return { ...items, ...nodeNames };
}

async function loadWorldState(ctx: SourceContext): Promise<WorldState> {
  try {
    return normalizeWarframestat(await fetchJson(WARFRAMESTAT_URL));
  } catch (error) {
    console.warn('[worldstate] warframestat недоступен, беру официальный worldState:', (error as Error).message);
    const [raw, names] = await Promise.all([fetchJson(OFFICIAL_WORLDSTATE_URL), officialNames(ctx)]);
    return normalizeOfficial(raw, names);
  }
}

export function createCoreSources(client: PublicExportClient): SourceDef[] {
  return [
    ...exportSources(client),
    defineSource<Catalog>({ id: 'catalog', title: 'Каталог предметов (Public Export)', ttlMs: Infinity, refreshable: true, load: loadCatalog }),
    defineSource<DropTablesData>({
      id: 'droptables',
      title: 'Официальные таблицы дропа',
      ttlMs: Infinity,
      refreshable: true,
      load: async () => ({ entries: parseDropTables(await fetchText(DROP_TABLES_URL, DROP_TABLES_TIMEOUT_MS)) }),
    }),
    defineSource<WorldState>({ id: 'worldstate', title: 'Состояние мира (разрывы, вторжения, Варзия)', ttlMs: WORLDSTATE_TTL_MS, load: loadWorldState }),
  ];
}
