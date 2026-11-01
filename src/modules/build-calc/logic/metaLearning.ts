/**
 * "Learning" from community builds the player imports (screenshots or text
 * from sites like overframe.gg): counts how often each mod is used per
 * weapon/frame group. The optimizer turns that into small score bonuses for
 * mods whose effects the formulas cannot model (e.g. Hunter Munitions).
 */

export type BuildSource = 'overframe' | 'screenshot' | 'manual' | 'optimizer';

export interface LibraryBuild {
  readonly group: string;
  readonly itemId: string;
  readonly mods: readonly string[];
  readonly source: BuildSource;
  readonly score: number;
  readonly savedAt?: string;
}

export interface GroupStats {
  readonly builds: number;
  readonly mods: Readonly<Record<string, number>>;
}

export interface MetaLibrary {
  readonly groups: Readonly<Record<string, GroupStats>>;
  /** Newest first. */
  readonly builds: readonly LibraryBuild[];
}

const MAX_HISTORY = 200;
/** Bonus for a mod used in every imported build of the group: +8% score. */
const META_STRENGTH = 0.08;
const DEFAULT_MIN_BUILDS = 2;

export const emptyLibrary = (): MetaLibrary => ({ groups: {}, builds: [] });

export function recordBuild(library: MetaLibrary, build: LibraryBuild): MetaLibrary {
  const previous = library.groups[build.group] ?? { builds: 0, mods: {} };
  const mods = { ...previous.mods };
  for (const id of new Set(build.mods)) mods[id] = (mods[id] ?? 0) + 1;
  return {
    groups: { ...library.groups, [build.group]: { builds: previous.builds + 1, mods } },
    builds: [build, ...library.builds].slice(0, MAX_HISTORY),
  };
}

export function metaWeights(
  library: MetaLibrary,
  group: string,
  isUnmodelled: (uniqueName: string) => boolean,
  minBuilds = DEFAULT_MIN_BUILDS,
): Record<string, number> {
  const stats = library.groups[group];
  if (!stats || stats.builds < minBuilds) return {};
  return Object.fromEntries(
    Object.entries(stats.mods)
      .filter(([id]) => isUnmodelled(id))
      .map(([id, count]) => [id, Math.round(META_STRENGTH * (count / stats.builds) * 1e6) / 1e6]),
  );
}
