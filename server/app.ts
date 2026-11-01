/** Builds the data hub: core sources plus sources contributed by modules. */
import { createDiskCache } from './cache';
import { createCoreSources } from './coreSources';
import { createPublicExportClient } from './publicExport';
import { createSourceHub, type SourceDef, type SourceHub } from './sources';

export function createAppHub(moduleSources: readonly SourceDef[], cacheDir: string): SourceHub {
  const client = createPublicExportClient();
  return createSourceHub([...createCoreSources(client), ...moduleSources], {
    cache: createDiskCache(cacheDir),
    onRefreshStart: client.reset,
  });
}
