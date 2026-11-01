/**
 * Normalizes world state from api.warframestat.us (primary) or the official
 * worldState.php (fallback) into one small shape the modules can rely on.
 */

export type RelicTier = 'Lith' | 'Meso' | 'Neo' | 'Axi' | 'Requiem' | 'Omnia';

export interface Fissure {
  readonly node: string;
  readonly missionType: string;
  readonly tier: RelicTier;
  readonly steelPath: boolean;
  readonly storm: boolean;
  readonly expiry: string;
}

export interface RewardItem {
  readonly uniqueName: string;
  readonly name: string;
  readonly count: number;
}

export interface Invasion {
  readonly node: string;
  readonly completion: number;
  readonly rewards: readonly RewardItem[];
}

export interface VaultTrader {
  readonly expiry?: string;
  readonly location?: string;
  readonly items: readonly string[];
}

export interface WorldEvent {
  readonly name: string;
  readonly expiry?: string;
  readonly rewards: readonly RewardItem[];
}

export interface WorldState {
  readonly source: 'warframestat' | 'official';
  readonly fissures: readonly Fissure[];
  readonly invasions: readonly Invasion[];
  readonly events: readonly WorldEvent[];
  readonly vaultTrader?: VaultTrader;
}

type Raw = Record<string, unknown>;

const TIERS: Readonly<Record<string, RelicTier>> = {
  VoidT1: 'Lith', VoidT2: 'Meso', VoidT3: 'Neo', VoidT4: 'Axi', VoidT5: 'Requiem', VoidT6: 'Omnia',
};
const TIER_NAMES: ReadonlySet<string> = new Set(Object.values(TIERS));
const PERCENT = 100;

const arr = (value: unknown): readonly Raw[] => (Array.isArray(value) ? (value as Raw[]) : []);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const obj = (value: unknown): Raw => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {});

export function stripStoreItems(path: string): string {
  return path.replace('/StoreItems/', '/');
}

function isActive(expiry: string, now: number): boolean {
  const time = Date.parse(expiry);
  return Number.isNaN(time) || time > now;
}

// ---------- api.warframestat.us ----------

function statRewards(reward: unknown): RewardItem[] {
  return arr(obj(reward).countedItems).map((item) => ({
    uniqueName: stripStoreItems(str(item.uniqueName)),
    name: str(item.type),
    count: typeof item.count === 'number' ? item.count : 1,
  }));
}

function statVaultTrader(raw: unknown, now: number): VaultTrader | undefined {
  const trader = obj(raw);
  const active = trader.active === true || (trader.active === undefined && arr(trader.inventory).length > 0 && isActive(str(trader.expiry), now));
  if (!active) return undefined;
  return {
    expiry: str(trader.expiry) || undefined,
    location: str(trader.location) || undefined,
    items: arr(trader.inventory).map((i) => stripStoreItems(str(i.uniqueName))),
  };
}

export function normalizeWarframestat(raw: unknown, now = Date.now()): WorldState {
  const data = obj(raw);
  const fissures = arr(data.fissures)
    .filter((f) => TIER_NAMES.has(str(f.tier)) && isActive(str(f.expiry), now))
    .map((f) => ({
      node: str(f.node),
      missionType: str(f.missionType),
      tier: str(f.tier) as RelicTier,
      steelPath: f.isHard === true,
      storm: f.isStorm === true,
      expiry: str(f.expiry),
    }));
  const invasions = arr(data.invasions)
    .filter((inv) => inv.completed !== true)
    .map((inv) => ({
      node: str(inv.node),
      completion: typeof inv.completion === 'number' ? inv.completion : 0,
      rewards: [...statRewards(obj(inv.attacker).reward), ...statRewards(obj(inv.defender).reward)],
    }));
  const events = arr(data.events)
    .filter((e) => isActive(str(e.expiry), now))
    .map((e) => ({ name: str(e.description), expiry: str(e.expiry) || undefined, rewards: arr(e.rewards).flatMap(statRewards) }));
  const vaultTrader = statVaultTrader(data.vaultTrader, now);
  return { source: 'warframestat', fissures, invasions, events, ...(vaultTrader ? { vaultTrader } : {}) };
}

// ---------- official worldState.php ----------

function officialDate(value: unknown): string {
  const ms = Number(str(obj(obj(value).$date).$numberLong));
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : '';
}

function missionTypeName(code: string): string {
  return code
    .replace(/^MT_/, '')
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function officialRewards(reward: unknown, names: Readonly<Record<string, string>>): RewardItem[] {
  return arr(obj(reward).countedItems).map((item) => {
    const uniqueName = stripStoreItems(str(item.ItemType));
    return { uniqueName, name: names[uniqueName] ?? uniqueName.split('/').pop() ?? uniqueName, count: Number(item.ItemCount) || 1 };
  });
}

/** Invasion Count runs from -Goal (attackers win) to +Goal (defenders win). */
function invasionCompletion(count: number, goal: number): number {
  const safeGoal = goal > 0 ? goal : 1;
  const percent = (Math.abs(count) / safeGoal) * PERCENT;
  return Math.min(PERCENT, Math.max(0, Math.round(percent * 100) / 100));
}

/** `names` maps SolNode ids and item uniqueNames to display names. */
export function normalizeOfficial(raw: unknown, names: Readonly<Record<string, string>>, now = Date.now()): WorldState {
  const data = obj(raw);
  const node = (id: string) => names[id] ?? id;
  const missions = arr(data.ActiveMissions).map((m) => ({
    node: node(str(m.Node)), missionType: missionTypeName(str(m.MissionType)), tier: TIERS[str(m.Modifier)],
    steelPath: m.Hard === true, storm: false, expiry: officialDate(m.Expiry),
  }));
  const storms = arr(data.VoidStorms).map((m) => ({
    node: node(str(m.Node)), missionType: 'Railjack', tier: TIERS[str(m.ActiveMissionTier)],
    steelPath: false, storm: true, expiry: officialDate(m.Expiry),
  }));
  const fissures = [...missions, ...storms].filter((f): f is Fissure => Boolean(f.tier) && isActive(f.expiry, now));
  const invasions = arr(data.Invasions)
    .filter((inv) => inv.Completed !== true)
    .map((inv) => ({
      node: node(str(inv.Node)),
      completion: invasionCompletion(Number(inv.Count) || 0, Number(inv.Goal) || 0),
      rewards: [...officialRewards(inv.AttackerReward, names), ...officialRewards(inv.DefenderReward, names)],
    }));
  const trader = arr(data.PrimeVaultTraders)[0];
  const vaultTrader = trader
    ? { expiry: officialDate(trader.Expiry) || undefined, items: arr(trader.Manifest).map((i) => stripStoreItems(str(i.ItemType))) }
    : undefined;
  return { source: 'official', fissures, invasions, events: [], ...(vaultTrader ? { vaultTrader } : {}) };
}
