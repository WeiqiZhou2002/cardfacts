import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { ValidateFunction } from "ajv";
import type { Card, Catalog, CreditVersion, Issuer, IssuerConfig, Version } from "./types.js";

// ajv-formats is CommonJS; its declared default is exposed differently by NodeNext.
const addFormats = addFormatsModule.default ?? addFormatsModule;
export const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
export const normalizeKeyword = (value: string) =>
  value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}+&]+/gu, " ")
    .trim();
export const isDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
export const matchesDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
export function allowedUrl(value: string, issuer: Issuer): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      issuer.domains.some((d) => matchesDomain(url.hostname, d))
    );
  } catch {
    return false;
  }
}
export async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: ${error instanceof SyntaxError ? "invalid JSON" : "cannot read JSON"}`, {
      cause: error,
    });
  }
}
export async function jsonFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isSymbolicLink()) throw new Error(`${path}: symlinks are not allowed in data`);
    if (item.isDirectory()) files.push(...(await jsonFiles(path)));
    else if (item.name.endsWith(".json")) files.push(path);
  }
  return files.sort(compare);
}
function assertSchema<T>(validator: ValidateFunction<T>, value: unknown, file: string): asserts value is T {
  if (!validator(value))
    throw new Error(
      validator.errors
        ?.map(
          (e) =>
            `${file}${e.instancePath || "/"}: ${e.message}${e.params.additionalProperty ? ` (${e.params.additionalProperty})` : ""}`,
        )
        .join("\n"),
    );
}
function unique(values: string[], path: string, errors: string[]) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) errors.push(`${path}: duplicate id/value ${value}`);
    seen.add(value);
  }
}
export function versionGroups(card: Card): { path: string; versions: Version[] }[] {
  return [
    { path: "/fees", versions: card.fees },
    ...card.earn_rates.map((rule, i) => ({ path: `/earn_rates/${i}/versions`, versions: rule.versions })),
    ...card.credits.map((credit, i) => ({ path: `/credits/${i}/versions`, versions: credit.versions })),
  ];
}
export function intervalErrors(
  versions: Pick<Version, "effective_from" | "effective_to">[],
  path: string,
): string[] {
  const errors: string[] = [];
  versions.forEach((v, i) => {
    if (v.effective_from && v.effective_to && v.effective_from > v.effective_to)
      errors.push(`${path}/${i}: reversed effective interval`);
    if (i > 0) {
      const previous = versions[i - 1]!;
      if (
        v.effective_from === null ||
        previous.effective_to === null ||
        previous.effective_to >= v.effective_from
      )
        errors.push(`${path}/${i}: overlapping or unordered versions (end dates are inclusive)`);
    }
  });
  return errors;
}
export function creditTermsErrors(
  v: Pick<CreditVersion, "period" | "period_years" | "reset_basis" | "amount">,
  path: string,
): string[] {
  const errors: string[] = [];
  if ((v.period === "multi_year") !== (v.reset_basis === "since_last_credit"))
    errors.push(`${path}: multi_year must pair with since_last_credit`);
  if ((v.period === "multi_year") !== (v.period_years !== undefined))
    errors.push(`${path}: period_years is required only for multi_year`);
  if (v.reset_basis === "anniversary_statement" && v.period !== "annual")
    errors.push(`${path}: anniversary_statement requires annual`);
  return errors;
}
export function cardErrors(
  card: Card,
  issuer: Issuer,
  earnCategories: Set<string>,
  creditCategories: Set<string>,
): string[] {
  const errors: string[] = [];
  unique(
    card.sources.map((s) => s.id),
    "/sources",
    errors,
  );
  unique(
    card.credits.map((c) => c.id),
    "/credits",
    errors,
  );
  unique(
    card.earn_rates.map((r) => r.id),
    "/earn_rates",
    errors,
  );
  const sources = new Map(card.sources.map((s) => [s.id, s]));
  card.sources.forEach((s, i) => {
    if (!allowedUrl(s.url, issuer)) errors.push(`/sources/${i}/url: HTTPS issuer domain required`);
  });
  for (const group of versionGroups(card)) {
    errors.push(...intervalErrors(group.versions, group.path));
    group.versions.forEach((v, i) => {
      const source = sources.get(v.source);
      if (!source) errors.push(`${group.path}/${i}/source: unresolved ${v.source}`);
      else if (source.accessed < v.last_verified)
        errors.push(`${group.path}/${i}/last_verified: later than source.accessed`);
    });
  }
  const normalized = (values: string[], path: string) => {
    const words = values.map(normalizeKeyword);
    if (words.some((w) => !w)) errors.push(`${path}: empty after keyword normalization`);
    unique(words, path, errors);
  };
  normalized(card.aliases, "/aliases");
  card.credits.forEach((c, i) => {
    if (!creditCategories.has(c.category))
      errors.push(`/credits/${i}/category: unknown category ${c.category}`);
    if (c.delivery === "statement_credit" && !c.match.keywords.length)
      errors.push(`/credits/${i}/match: statement credits require keywords`);
    normalized(c.match.keywords, `/credits/${i}/match/keywords`);
    normalized(c.match.exclude ?? [], `/credits/${i}/match/exclude`);
    c.versions.forEach((v, j) => errors.push(...creditTermsErrors(v, `/credits/${i}/versions/${j}`)));
  });
  card.earn_rates.forEach((rule, i) => {
    if (!earnCategories.has(rule.category))
      errors.push(`/earn_rates/${i}/category: unknown category ${rule.category}`);
    rule.versions.forEach((v, j) => {
      const path = `/earn_rates/${i}/versions/${j}`;
      if (v.conditions.channels.includes("any") && v.conditions.channels.length !== 1)
        errors.push(`${path}/conditions/channels: any must stand alone`);
      if (v.cap?.shared_with) {
        for (const id of v.cap.shared_with) {
          if (id === rule.id || !card.earn_rates.some((r) => r.id === id))
            errors.push(`${path}/cap/shared_with: invalid rule ${id}`);
        }
      }
    });
  });
  return errors;
}

export async function loadCatalog(root: string): Promise<Catalog> {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const compile = async <T>(file: string) => ajv.compile<T>((await readJson(join(root, file))) as object);
  const validateCard = await compile<Card>("schema/card.schema.json");
  const validateVocab = await compile<{ id: string }[]>("schema/vocab.schema.json");
  const categories: Set<string>[] = [];
  const errors: string[] = [];
  for (const name of ["earn", "credit"]) {
    const path = `vocab/${name}-categories.json`;
    const value = await readJson(join(root, path));
    assertSchema(validateVocab, value, path);
    unique(
      value.map((c) => c.id),
      path,
      errors,
    );
    categories.push(new Set(value.map((c) => c.id)));
  }
  const maintenance = (await readJson(join(root, "schema/maintenance.schema.json"))) as {
    $defs: Record<string, object>;
  };
  const issuers = await readJson(join(root, "maintenance/issuer-domains.json"));
  assertSchema(
    ajv.compile<IssuerConfig>(maintenance.$defs.issuers!),
    issuers,
    "maintenance/issuer-domains.json",
  );
  unique(
    issuers.issuers.map((i) => i.id),
    "issuers",
    errors,
  );
  unique(
    issuers.issuers.map((i) => i.name),
    "issuer names",
    errors,
  );
  for (const id of issuers.manual_only)
    if (!issuers.issuers.some((i) => i.id === id)) errors.push(`manual_only: unknown issuer ${id}`);
  const cards: Card[] = [];
  for (const file of await jsonFiles(join(root, "data"))) {
    const path = relative(root, file).replaceAll("\\", "/");
    const value = await readJson(file);
    assertSchema(validateCard, value, path);
    const issuer = issuers.issuers.find((i) => i.name === value.issuer);
    if (!issuer) {
      errors.push(`${path}/issuer: unknown issuer`);
      continue;
    }
    if (path !== `data/us/${issuer.id}/${value.id}.json` || !value.id.startsWith(`us-${issuer.id}-`))
      errors.push(`${path}: product id/path does not match issuer`);
    errors.push(...cardErrors(value, issuer, categories[0]!, categories[1]!).map((e) => path + e));
    cards.push(value);
  }
  if (!cards.length) errors.push("data/: catalog must contain at least one card");
  unique(
    cards.map((c) => c.id),
    "data",
    errors,
  );
  unique(
    cards.flatMap((c) => c.sources.map((s) => s.id)),
    "source ids (global)",
    errors,
  );
  const schedule = await readJson(join(root, "maintenance/schedule.json"));
  assertSchema(
    ajv.compile<{ daily: string[]; rotation_days: number }>(maintenance.$defs.schedule!),
    schedule,
    "maintenance/schedule.json",
  );
  const leads = await readJson(join(root, "maintenance/leads.json"));
  assertSchema(
    ajv.compile<{ feeds: { id: string; url: string; products: string[] }[] }>(maintenance.$defs.leads!),
    leads,
    "maintenance/leads.json",
  );
  unique(
    leads.feeds.map((f) => f.id),
    "leads",
    errors,
  );
  for (const id of [...schedule.daily, ...leads.feeds.flatMap((f) => f.products)])
    if (!cards.some((c) => c.id === id)) errors.push(`maintenance: unknown product ${id}`);
  for (const feed of leads.feeds)
    if (!issuers.issuers.some((i) => allowedUrl(feed.url, i)))
      errors.push(`leads/${feed.id}: issuer HTTPS URL required`);
  const metadata = await readJson(join(root, "catalog.json"));
  assertSchema(
    ajv.compile<Catalog["metadata"]>({
      type: "object",
      additionalProperties: false,
      required: ["schema_version", "catalog_version", "license"],
      properties: {
        schema_version: { const: 1 },
        catalog_version: { type: "string", pattern: "^[0-9]{4}\\.[0-9]{2}\\.[0-9]{2}(?:-[a-z0-9.-]+)?$" },
        license: { const: "CC0-1.0" },
      },
    }),
    metadata,
    "catalog.json",
  );
  if (!isDate(metadata.catalog_version.slice(0, 10).replaceAll(".", "-")))
    errors.push("catalog.json: invalid version date");
  const vectors = await readJson(join(root, "vectors/credit-progress.json"));
  const validateVectors = await compile<{
    vectors: { id: string; catalog: { credits: { id: string; versions: CreditVersion[] }[] } }[];
  }>("schema/vectors.schema.json");
  assertSchema(validateVectors, vectors, "vectors/credit-progress.json");
  unique(
    vectors.vectors.map((v) => v.id),
    "vectors",
    errors,
  );
  for (const vector of vectors.vectors) {
    unique(
      vector.catalog.credits.map((c) => c.id),
      vector.id,
      errors,
    );
    for (const c of vector.catalog.credits) {
      errors.push(...intervalErrors(c.versions, `${vector.id}/${c.id}`));
      for (const v of c.versions) {
        errors.push(...creditTermsErrors(v, `${vector.id}/${c.id}`));
        if ((v.status === "to_verify") !== (v.amount === null))
          errors.push(`${vector.id}/${c.id}: inconsistent status/amount`);
      }
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  cards.sort((a, b) => compare(a.id, b.id));
  return { root, metadata, cards, issuers };
}

export interface SourceRecord {
  id: string;
  url: string;
  title: string;
  accessed: string;
  issuer: string;
  manual_only: boolean;
  products: string[];
  fields: { product: string; path: string }[];
}
export function listSources(catalog: Catalog): SourceRecord[] {
  return catalog.cards
    .flatMap((card) =>
      card.sources.map((source) => {
        const issuer = catalog.issuers.issuers.find((i) => i.name === card.issuer)!;
        const fields: SourceRecord["fields"] = [];
        function leaves(value: unknown, path: string) {
          if (value !== null && typeof value === "object")
            for (const [key, item] of Object.entries(value)) leaves(item, `${path}/${key}`);
          else fields.push({ product: card.id, path });
        }
        for (const group of versionGroups(card))
          group.versions.forEach((v, index) => {
            if (v.source === source.id)
              for (const [key, value] of Object.entries(v))
                if (!["source", "last_verified", "status", "notes", "effective_from_basis"].includes(key))
                  leaves(value, `${group.path}/${index}/${key}`);
          });
        return {
          ...source,
          issuer: issuer.id,
          manual_only: catalog.issuers.manual_only.includes(issuer.id),
          products: [card.id],
          fields,
        };
      }),
    )
    .sort((a, b) => compare(a.id, b.id));
}
export function staleVersions(catalog: Catalog, days: number, asOf: string) {
  if (!Number.isInteger(days) || days < 0 || !isDate(asOf))
    throw new Error("stale requires non-negative integer days and a valid YYYY-MM-DD as-of date");
  return catalog.cards.flatMap((card) =>
    versionGroups(card).flatMap((group) =>
      group.versions.flatMap((v, i) => {
        const age = (Date.parse(asOf) - Date.parse(v.last_verified)) / 86_400_000;
        return age > days
          ? [
              {
                product: card.id,
                path: `${group.path}/${i}`,
                source: v.source,
                status: v.status,
                last_verified: v.last_verified,
                age_days: age,
              },
            ]
          : [];
      }),
    ),
  );
}
export async function buildCatalog(catalog: Catalog, directory = join(catalog.root, "dist")) {
  const payload = { ...catalog.metadata, products: catalog.cards };
  const files = {
    "cards.json": JSON.stringify(payload, null, 2) + "\n",
    "cards.min.json": JSON.stringify(payload) + "\n",
  };
  await mkdir(directory, { recursive: true });
  for (const [name, content] of Object.entries(files)) await writeFile(join(directory, name), content);
  await writeFile(
    join(directory, "SHA256SUMS"),
    Object.entries(files)
      .map(([name, content]) => `${sha256(content)}  ${name}\n`)
      .join(""),
  );
  return Object.keys(files);
}
