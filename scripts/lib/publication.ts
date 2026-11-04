import { isDate } from "./primitives.js";
import type { Catalog } from "./types.js";

// A published build is stamped with the catalog version it ships and the date its terms describe.
// Local builds and tests leave both unset: the version comes from catalog.json and the terms date
// is that version's date, so their output stays deterministic.
export interface Stamp {
  catalog_version?: string;
  as_of?: string;
}
export const VERSION_PATTERN = /^[0-9]{4}\.[0-9]{2}\.[0-9]{2}(?:-[a-z0-9.-]+)?$/;
// Paths whose content makes up a catalog version. A change elsewhere (code, docs) keeps the version.
export const DATA_PATHS = ["catalog.json", "data", "history", "schema", "vocab"];
export const TAG_PREFIX = "catalog-";

export const versionDate = (version: string) => version.slice(0, 10).replaceAll(".", "-");

export function isVersion(value: string) {
  return VERSION_PATTERN.test(value) && isDate(versionDate(value));
}

export function stampCatalog(catalog: Catalog, stamp: Stamp = {}): { catalog: Catalog; asOf: string } {
  const version = stamp.catalog_version || catalog.metadata.catalog_version;
  if (!isVersion(version)) throw new Error(`Invalid catalog version "${version}"`);
  const asOf = stamp.as_of || versionDate(version);
  if (!isDate(asOf)) throw new Error(`Invalid terms date "${asOf}"`);
  return { catalog: { ...catalog, metadata: { ...catalog.metadata, catalog_version: version } }, asOf };
}

// The stamp a published build reads from CARDFACTS_CATALOG_VERSION and CARDFACTS_AS_OF.
export function stampFromEnv(env: Record<string, string | undefined> = process.env): Stamp {
  return {
    ...(env.CARDFACTS_CATALOG_VERSION ? { catalog_version: env.CARDFACTS_CATALOG_VERSION } : {}),
    ...(env.CARDFACTS_AS_OF ? { as_of: env.CARDFACTS_AS_OF } : {}),
  };
}

/**
 * Chooses the version a publish ships. The data is unchanged since the latest published version
 * reachable from this commit → that version again. Otherwise a new one dated `today`, keeping the
 * release label from catalog.json (for example "-draft"), with a counter if that name is taken.
 */
export function planPublication(input: {
  label: string;
  today: string;
  latest: string | null;
  changed: boolean;
  published: string[];
}): { catalog_version: string; created: boolean } {
  if (!isVersion(input.label)) throw new Error(`Invalid catalog.json version "${input.label}"`);
  if (!isDate(input.today)) throw new Error(`Invalid publish date "${input.today}"`);
  if (input.latest !== null && !input.changed) return { catalog_version: input.latest, created: false };
  const suffix = input.label.slice(10);
  const base = input.today.replaceAll("-", ".") + suffix;
  const taken = new Set(input.published);
  let version = base;
  for (let n = 2; taken.has(version); n++) version = `${base}${suffix ? "." : "-"}${n}`;
  return { catalog_version: version, created: true };
}
