import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadCatalog, readJson } from "./catalog.js";
import { compare, isDate, isTimestamp } from "./primitives.js";
import { revisionAt, revisionDiff, termsAt } from "./temporal.js";
import type { Card, Catalog } from "./types.js";

// One URL scheme for both deployments: the static files under /api/v1/ answer every path without a
// query string, and the self-hosted server answers the same paths plus query parameters.
export interface Category {
  id: string;
  name: { en: string; zh: string };
  definition: { en: string; zh: string };
}
export interface ApiContext {
  catalog: Catalog;
  earn: Category[];
  credit: Category[];
  asOf: string;
  schemas: Record<string, unknown>;
}
export interface ApiResult {
  status: number;
  body: unknown;
}
export const WIKI = "https://weiqizhou2002.github.io/cardfacts/";
const SCHEMAS = ["card", "revision"];

export async function apiContext(root: string): Promise<ApiContext> {
  const catalog = await loadCatalog(root);
  return {
    catalog,
    earn: (await readJson(join(root, "vocab/earn-categories.json"))) as Category[],
    credit: (await readJson(join(root, "vocab/credit-categories.json"))) as Category[],
    asOf: catalog.metadata.catalog_version.slice(0, 10).replaceAll(".", "-"),
    schemas: Object.fromEntries(
      await Promise.all(SCHEMAS.map(async (s) => [s, await readJson(join(root, `schema/${s}.schema.json`))])),
    ),
  };
}
const envelope = (ctx: ApiContext, data: unknown) => ({
  api_version: 1,
  catalog_version: ctx.catalog.metadata.catalog_version,
  license: "CC0-1.0",
  data,
});
const fail = (status: number, code: string, message: string): ApiResult => ({
  status,
  body: { api_version: 1, error: { status, code, message } },
});
const ok = (ctx: ApiContext, data: unknown): ApiResult => ({ status: 200, body: envelope(ctx, data) });

function summary(card: Card, asOf: string) {
  const terms = termsAt(card, asOf);
  const current = [...(terms.fees ? [terms.fees] : []), ...terms.earn_rates, ...terms.credits];
  return {
    id: card.id,
    name: card.name,
    issuer: card.issuer,
    audience: card.audience,
    networks: card.networks,
    availability: card.availability,
    rewards: card.rewards,
    aliases: card.aliases,
    annual_fee: terms.fees
      ? {
          amount: terms.fees.version.annual_fee,
          status: terms.fees.version.status,
          certainty: terms.fees.certainty,
        }
      : null,
    earn_rates: terms.earn_rates.map((r) => ({
      id: r.id,
      category: r.category,
      rate: r.version.rate,
      status: r.version.status,
      certainty: r.certainty,
    })),
    credits: terms.credits.map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      amount: c.version.amount,
      period: c.version.period,
      status: c.version.status,
      certainty: c.certainty,
    })),
    pending: current.filter((x) => x.version.status === "to_verify").length,
    last_verified:
      current
        .map((x) => x.version.last_verified)
        .sort(compare)
        .at(-1) ?? null,
    links: {
      self: `cards/${card.id}.json`,
      terms: `cards/${card.id}/terms.json`,
      history: `cards/${card.id}/history.json`,
      wiki: `${WIKI}cards/${card.id}/`,
    },
  };
}

// Query parameters each path accepts; anything else is rejected rather than silently ignored.
const PARAMS: Record<string, string[]> = {
  cards: [
    "as_of",
    "q",
    "issuer",
    "audience",
    "network",
    "availability",
    "unit",
    "annual_fee_min",
    "annual_fee_max",
    "earn_category",
    "min_rate",
    "credit_category",
  ],
  terms: ["as_of", "recorded_at"],
  category: ["as_of"],
  diff: ["from", "to"],
};
function checkQuery(query: URLSearchParams, allowed: string[] = []): ApiResult | null {
  for (const key of new Set(query.keys())) {
    if (!allowed.includes(key))
      return fail(
        400,
        "unknown_parameter",
        `Unknown query parameter "${key}". Allowed: ${allowed.join(", ") || "none"}.`,
      );
    if (query.getAll(key).length > 1) return fail(400, "repeated_parameter", `Give "${key}" only once.`);
  }
  const asOf = query.get("as_of");
  if (asOf !== null && !isDate(asOf))
    return fail(400, "invalid_date", "as_of must be a calendar date YYYY-MM-DD.");
  return null;
}
const decimal = (value: string | null) =>
  value !== null && /^\d+(\.\d+)?$/.test(value) ? Number(value) : null;

function listCards(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const asOf = query.get("as_of") ?? ctx.asOf;
  for (const key of ["annual_fee_min", "annual_fee_max", "min_rate"])
    if (query.has(key) && decimal(query.get(key)) === null)
      return fail(400, "invalid_number", `${key} must be a non-negative decimal number.`);
  if (query.has("network") && !["amex", "discover", "mastercard", "visa"].includes(query.get("network")!))
    return fail(400, "invalid_network", "network must be amex, discover, mastercard or visa.");
  const text = query.get("q")?.normalize("NFKC").toLowerCase().trim();
  const feeMin = decimal(query.get("annual_fee_min"));
  const feeMax = decimal(query.get("annual_fee_max"));
  const minRate = decimal(query.get("min_rate"));
  const earn = query.get("earn_category");
  const credit = query.get("credit_category");
  const cards = ctx.catalog.cards.filter((card) => {
    const terms = termsAt(card, asOf);
    const match = (key: string, value: string | null) => !query.has(key) || query.get(key) === value;
    if (text && ![card.name, card.issuer, card.id, ...card.aliases].join(" ").toLowerCase().includes(text))
      return false;
    if (
      !match("issuer", card.issuer) ||
      !match("audience", card.audience) ||
      !match("unit", card.rewards.unit)
    )
      return false;
    if (!match("availability", card.availability)) return false;
    const network = query.get("network");
    if (
      network !== null &&
      !(card.networks.status === "verified" && (card.networks.values as string[]).includes(network))
    )
      return false;
    if (feeMin !== null || feeMax !== null) {
      const fee = terms.fees?.version.status === "verified" ? Number(terms.fees.version.annual_fee) : null;
      if (fee === null || (feeMin !== null && fee < feeMin) || (feeMax !== null && fee > feeMax))
        return false;
    }
    if (earn !== null || minRate !== null) {
      const hit = terms.earn_rates.some(
        (r) =>
          r.version.status === "verified" &&
          (earn === null ||
            r.category === earn ||
            r.version.conditions.selection?.categories.includes(earn)) &&
          Number(r.version.rate) >= (minRate ?? 0),
      );
      if (!hit) return false;
    }
    if (
      credit !== null &&
      !terms.credits.some((c) => c.category === credit && c.version.status === "verified")
    )
      return false;
    return true;
  });
  return ok(ctx, { as_of: asOf, count: cards.length, cards: cards.map((c) => summary(c, asOf)) });
}
function categoryCards(ctx: ApiContext, kind: "earn" | "credits", id: string, asOf: string): ApiResult {
  const category = (kind === "earn" ? ctx.earn : ctx.credit).find((c) => c.id === id);
  if (!category) return fail(404, "not_found", `Unknown ${kind} category "${id}".`);
  const cards = ctx.catalog.cards.flatMap((card): object[] => {
    const terms = termsAt(card, asOf);
    if (kind === "earn") {
      const rules = terms.earn_rates.filter(
        (r) => r.category === id || r.version.conditions.selection?.categories.includes(id),
      );
      return rules.length
        ? [
            {
              id: card.id,
              name: card.name,
              issuer: card.issuer,
              unit: card.rewards.unit,
              earn_rates: rules.map((r) => ({
                id: r.id,
                category: r.category,
                rate: r.version.rate,
                conditions: r.version.conditions,
                cap: r.version.cap,
                status: r.version.status,
                certainty: r.certainty,
              })),
            },
          ]
        : [];
    }
    const credits = terms.credits.filter((c) => c.category === id);
    return credits.length
      ? [
          {
            id: card.id,
            name: card.name,
            issuer: card.issuer,
            credits: credits.map((c) => ({
              id: c.id,
              name: c.name,
              amount: c.version.amount,
              period: c.version.period,
              reset_basis: c.version.reset_basis,
              enrollment: c.enrollment,
              status: c.version.status,
              certainty: c.certainty,
            })),
          },
        ]
      : [];
  });
  return ok(ctx, { category, as_of: asOf, count: cards.length, cards });
}

export function handle(ctx: ApiContext, path: string, query = new URLSearchParams()): ApiResult {
  const route = (allowed?: string[]) => checkQuery(query, allowed);
  const revisions = (id: string) => ctx.catalog.revisions.filter((r) => r.product_id === id);
  let m: RegExpExecArray | null;
  if (path === "" || path === "index.json") return route() ?? ok(ctx, index(ctx));
  if (path === "openapi.json") return route() ?? { status: 200, body: openapi() };
  if (path === "cards.json") return route(PARAMS.cards) ?? listCards(ctx, query);
  if (path === "issuers.json")
    return (
      route() ??
      ok(
        ctx,
        ctx.catalog.issuers.issuers.map((i) => ({
          id: i.id,
          name: i.name,
          domains: i.domains,
          cards: ctx.catalog.cards.filter((c) => c.issuer === i.name).map((c) => c.id),
        })),
      )
    );
  if (path === "categories.json") {
    const count = (kind: "earn" | "credits", id: string) =>
      (categoryCards(ctx, kind, id, ctx.asOf).body as { data: { count: number } }).data.count;
    return (
      route() ??
      ok(ctx, {
        as_of: ctx.asOf,
        earn: ctx.earn.map((c) => ({
          ...c,
          cards: count("earn", c.id),
          links: { self: `categories/earn/${c.id}.json` },
        })),
        credits: ctx.credit.map((c) => ({
          ...c,
          cards: count("credits", c.id),
          links: { self: `categories/credits/${c.id}.json` },
        })),
      })
    );
  }
  if ((m = /^categories\/(earn|credits)\/([a-z0-9_]+)\.json$/.exec(path)))
    return (
      route(PARAMS.category) ??
      categoryCards(ctx, m[1] as "earn" | "credits", m[2]!, query.get("as_of") ?? ctx.asOf)
    );
  if ((m = /^schema\/([a-z]+)\.schema\.json$/.exec(path)) && SCHEMAS.includes(m[1]!))
    return route() ?? { status: 200, body: ctx.schemas[m[1]!] };
  m =
    /^cards\/([a-z0-9]+(?:-[a-z0-9]+)*)(\.json|\/terms\.json|\/history\.json|\/diff\.json|\/revisions\/([0-9TZ]+-[a-f0-9]{12})\.json)$/.exec(
      path,
    );
  if (!m) return fail(404, "not_found", `No API resource at "${path}". See index.json.`);
  const card = ctx.catalog.cards.find((c) => c.id === m![1]);
  if (!card) return fail(404, "not_found", `Unknown card "${m[1]}".`);
  if (m[2] === ".json") return route() ?? ok(ctx, card);
  if (m[2] === "/history.json")
    return (
      route() ??
      ok(ctx, {
        product_id: card.id,
        revisions: revisions(card.id).map(({ product: _product, ...r }) => ({
          ...r,
          links: { self: `cards/${card.id}/revisions/${r.id}.json` },
        })),
      })
    );
  if (m[3]) {
    const revision = revisions(card.id).find((r) => r.id === m![3]);
    return route() ?? (revision ? ok(ctx, revision) : fail(404, "not_found", `Unknown revision "${m[3]}".`));
  }
  if (m[2] === "/terms.json") {
    const invalid = route(PARAMS.terms);
    if (invalid) return invalid;
    const recorded = query.get("recorded_at");
    if (recorded !== null && !isTimestamp(recorded))
      return fail(400, "invalid_time", "recorded_at must be a UTC time YYYY-MM-DDTHH:mm:ssZ.");
    const revision = revisionAt(ctx.catalog.revisions, card.id, recorded ?? undefined);
    if (!revision) return fail(404, "not_recorded", "The catalog had no record of this card at that time.");
    return ok(ctx, {
      revision: { id: revision.id, recorded_at: revision.recorded_at },
      ...termsAt(revision.product, query.get("as_of") ?? ctx.asOf),
    });
  }
  // Comparing two revisions needs parameters, so it exists only on the server.
  const invalid = route(PARAMS.diff);
  if (invalid) return invalid;
  const before = revisions(card.id).find((r) => r.id === query.get("from"));
  const after = revisions(card.id).find((r) => r.id === query.get("to"));
  if (!before || !after) return fail(400, "invalid_revision", "Give existing revision ids as from and to.");
  return ok(ctx, revisionDiff(before, after));
}

function index(ctx: ApiContext) {
  return {
    description: "Open, cited, versioned data on US credit cards. Paths are relative to this API root.",
    as_of: ctx.asOf,
    cards: ctx.catalog.cards.length,
    endpoints: {
      cards: "cards.json",
      card: "cards/{id}.json",
      terms: "cards/{id}/terms.json",
      history: "cards/{id}/history.json",
      revision: "cards/{id}/revisions/{revision_id}.json",
      diff: "cards/{id}/diff.json?from={revision_id}&to={revision_id} (server only)",
      issuers: "issuers.json",
      categories: "categories.json",
      category: "categories/{earn|credits}/{category_id}.json",
      openapi: "openapi.json",
      schemas: SCHEMAS.map((s) => `schema/${s}.schema.json`),
    },
    query_parameters:
      "Static files serve every path without query parameters. The self-hosted server serves the same paths and also accepts the parameters listed in openapi.json.",
    links: {
      wiki: WIKI,
      repository: "https://github.com/WeiqiZhou2002/cardfacts",
      downloads: `${WIKI}data/cards.json`,
    },
  };
}

// Paths the static build writes: every resource that needs no query parameters.
export function staticPaths(ctx: ApiContext) {
  return [
    "index.json",
    "openapi.json",
    "cards.json",
    "issuers.json",
    "categories.json",
    ...ctx.earn.map((c) => `categories/earn/${c.id}.json`),
    ...ctx.credit.map((c) => `categories/credits/${c.id}.json`),
    ...SCHEMAS.map((s) => `schema/${s}.schema.json`),
    ...ctx.catalog.cards.flatMap((card) => [
      `cards/${card.id}.json`,
      `cards/${card.id}/terms.json`,
      `cards/${card.id}/history.json`,
      ...ctx.catalog.revisions
        .filter((r) => r.product_id === card.id)
        .map((r) => `cards/${card.id}/revisions/${r.id}.json`),
    ]),
  ];
}
export const serialize = (body: unknown) => JSON.stringify(body, null, 2) + "\n";
export async function writeStaticApi(ctx: ApiContext, out: string) {
  const paths = staticPaths(ctx);
  for (const path of paths) {
    const result = handle(ctx, path);
    if (result.status !== 200) throw new Error(`Static API path ${path} returned ${result.status}`);
    await mkdir(dirname(join(out, path)), { recursive: true });
    await writeFile(join(out, path), serialize(result.body));
  }
  return paths;
}

function openapi() {
  const text = { type: "string" };
  const date = { ...text, format: "date" };
  const param = (
    name: string,
    description: string,
    schema: object = text,
    where = "query",
    required = false,
  ) => ({
    name,
    in: where,
    required,
    description,
    schema,
  });
  const id = param(
    "id",
    "Card id, for example us-amex-gold.",
    { ...text, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
    "path",
    true,
  );
  const asOf = param("as_of", "Terms date (server only). Defaults to the catalog version date.", date);
  const json = (description: string, schema: object = { $ref: "#/components/schemas/Envelope" }) => ({
    description,
    content: { "application/json": { schema } },
  });
  const responses = (description: string, schema?: object) => ({
    200: json(description, schema),
    400: json("Invalid or unknown query parameter.", { $ref: "#/components/schemas/Error" }),
    404: json("Unknown resource.", { $ref: "#/components/schemas/Error" }),
  });
  const get = (summary: string, parameters: object[], description: string, schema?: object) => ({
    get: { summary, parameters, responses: responses(description, schema) },
  });
  return {
    openapi: "3.1.0",
    info: {
      title: "CardFacts API",
      version: "1",
      description:
        "Read-only, cited and versioned US credit card data. Static files on GitHub Pages answer every path without query parameters; the self-hosted server answers the same paths and also accepts the documented query parameters. Data is CC0-1.0 and still a draft: confirm terms with the issuer.",
      license: { name: "CC0-1.0 (data), MIT (code)" },
    },
    servers: [
      { url: `${WIKI}api/v1`, description: "Static files (GitHub Pages)" },
      { url: "http://localhost:8787/api/v1", description: "Self-hosted server (pnpm api:serve)" },
    ],
    paths: {
      "/index.json": get("API root and endpoint list", [], "Index."),
      "/cards.json": get(
        "List cards, optionally filtered (filters: server only)",
        [
          asOf,
          param("q", "Text in the name, issuer, id or aliases."),
          param("issuer", "Exact issuer name, for example Chase."),
          param("audience", "personal or business.", { enum: ["personal", "business"] }),
          param("network", "Cards whose verified networks include this one.", {
            enum: ["amex", "discover", "mastercard", "visa"],
          }),
          param("availability", "open, closed_to_new or discontinued.", {
            enum: ["open", "closed_to_new", "discontinued"],
          }),
          param("unit", "Reward unit.", { enum: ["points", "miles", "cash"] }),
          param("annual_fee_min", "Minimum verified annual fee in USD.", { type: "number", minimum: 0 }),
          param("annual_fee_max", "Maximum verified annual fee in USD.", { type: "number", minimum: 0 }),
          param("earn_category", "A verified earn rule in this category (see categories.json)."),
          param("min_rate", "Minimum verified rate; with earn_category, in that category.", {
            type: "number",
            minimum: 0,
          }),
          param("credit_category", "A verified recurring credit in this category."),
        ],
        "Card summaries with the terms in force on as_of.",
      ),
      "/cards/{id}.json": get("Full card record with every terms version", [id], "Card.", {
        allOf: [
          { $ref: "#/components/schemas/Envelope" },
          { properties: { data: { $ref: "./schema/card.schema.json" } } },
        ],
      }),
      "/cards/{id}/terms.json": get(
        "Terms in force on a date, from the latest or a past catalog revision",
        [
          id,
          asOf,
          param("recorded_at", "Use the catalog as recorded at this UTC time (server only).", {
            ...text,
            pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$",
          }),
        ],
        "Terms with a certainty for each item: stated, detected_start, unknown_start or to_verify.",
      ),
      "/cards/{id}/history.json": get("Recorded revisions of the card", [id], "Revision list."),
      "/cards/{id}/revisions/{revision_id}.json": get(
        "One complete recorded revision",
        [id, param("revision_id", "Revision id from history.json.", text, "path", true)],
        "Revision.",
        {
          allOf: [
            { $ref: "#/components/schemas/Envelope" },
            { properties: { data: { $ref: "./schema/revision.schema.json" } } },
          ],
        },
      ),
      "/cards/{id}/diff.json": get(
        "Differences between two revisions (server only)",
        [
          id,
          param("from", "Earlier revision id.", text, "query", true),
          param("to", "Later revision id.", text, "query", true),
        ],
        "JSON-pointer paths with before and after values.",
      ),
      "/issuers.json": get("Issuers and their cards", [], "Issuers."),
      "/categories.json": get("Earn and credit categories with card counts", [], "Categories."),
      "/categories/{kind}/{category_id}.json": get(
        "Cards with a current rule or credit in a category",
        [
          param("kind", "earn or credits.", { enum: ["earn", "credits"] }, "path", true),
          param("category_id", "Category id from categories.json.", text, "path", true),
          asOf,
        ],
        "Cards and their matching rules or credits.",
      ),
    },
    components: {
      schemas: {
        Envelope: {
          type: "object",
          required: ["api_version", "catalog_version", "license", "data"],
          properties: {
            api_version: { const: 1 },
            catalog_version: text,
            license: { const: "CC0-1.0" },
            data: {},
          },
        },
        Error: {
          type: "object",
          required: ["api_version", "error"],
          properties: {
            api_version: { const: 1 },
            error: {
              type: "object",
              required: ["status", "code", "message"],
              properties: { status: { type: "integer" }, code: text, message: text },
            },
          },
        },
      },
    },
  };
}
