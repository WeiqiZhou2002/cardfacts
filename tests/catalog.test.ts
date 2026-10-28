import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  buildCatalog,
  cardErrors,
  isDate,
  listSources,
  loadCatalog,
  normalizeKeyword,
  sha256,
  staleVersions,
} from "../scripts/lib/catalog.js";
import { historyErrors, readBaseCards } from "../scripts/lib/history.js";
import type { Card } from "../scripts/lib/types.js";

const root = resolve(import.meta.dirname, "..");
const catalog = await loadCatalog(root);
const amex = catalog.cards.find((c) => c.id === "us-amex-platinum")!;
const issuer = catalog.issuers.issuers.find((i) => i.name === amex.issuer)!;
const earnCategories = new Set(amex.earn_rates.map((r) => r.category));
const creditCategories = new Set(amex.credits.map((c) => c.category));
const errors = (card: Card) => cardErrors(card, issuer, earnCategories, creditCategories);

test("production schema rejects bad dates, amounts, unknown fields and synthetic status", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cardfacts-schema-"));
  try {
    for (const item of ["data", "vocab", "schema", "maintenance", "vectors", "catalog.json"])
      await cp(join(root, item), join(directory, item), { recursive: true });
    const file = join(directory, "data/us/amex/us-amex-platinum.json");
    const cases: [string, (card: Card) => void][] = [
      [
        "impossible date",
        (c) => {
          c.fees[0]!.last_verified = "2026-02-30";
        },
      ],
      [
        "numeric money",
        (c) => {
          Object.assign(c.fees[0]!, { annual_fee: 895 });
        },
      ],
      [
        "negative money",
        (c) => {
          c.fees[0]!.annual_fee = "-1.00";
        },
      ],
      [
        "unknown key",
        (c) => {
          Object.assign(c, { typo: true });
        },
      ],
      [
        "synthetic production",
        (c) => {
          Object.assign(c.fees[0]!, { status: "synthetic" });
        },
      ],
      [
        "unverified amount",
        (c) => {
          c.credits[0]!.versions[0]!.status = "to_verify";
        },
      ],
      [
        "invented date basis",
        (c) => {
          c.fees[0]!.effective_from_basis = "detected";
        },
      ],
    ];
    for (const [name, mutate] of cases)
      await t.test(name, async () => {
        const card = structuredClone(amex);
        mutate(card);
        await writeFile(file, JSON.stringify(card));
        await assert.rejects(loadCatalog(directory), /data\/us\/amex/);
      });
    await writeFile(file, JSON.stringify(amex));
    const config = structuredClone(catalog.issuers);
    config.manual_only.push("unknown-bank");
    await writeFile(join(directory, "maintenance/issuer-domains.json"), JSON.stringify(config));
    await assert.rejects(loadCatalog(directory), /unknown issuer/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("semantic validation reports bad references, domains, vocab and intervals", async (t) => {
  const cases: [string, (card: Card) => void, RegExp][] = [
    [
      "lookalike domain",
      (c) => {
        c.sources[0]!.url = "https://americanexpress.com.attacker.example/card";
      },
      /issuer domain/,
    ],
    [
      "other issuer",
      (c) => {
        c.sources[0]!.url = "https://chase.com/card";
      },
      /issuer domain/,
    ],
    [
      "HTTP",
      (c) => {
        c.sources[0]!.url = "http://americanexpress.com/card";
      },
      /issuer domain/,
    ],
    [
      "unresolved source",
      (c) => {
        c.fees[0]!.source = "missing";
      },
      /unresolved/,
    ],
    [
      "duplicate credit",
      (c) => {
        c.credits.push(structuredClone(c.credits[0]!));
      },
      /duplicate/,
    ],
    [
      "unknown category",
      (c) => {
        c.credits[0]!.category = "missing";
      },
      /unknown category/,
    ],
    [
      "empty keyword",
      (c) => {
        c.credits[0]!.match.keywords = ["***"];
      },
      /empty after/,
    ],
    [
      "no keywords",
      (c) => {
        c.credits[0]!.match.keywords = [];
      },
      /require keywords/,
    ],
    [
      "overlap",
      (c) => {
        c.fees.push(structuredClone(c.fees[0]!));
      },
      /overlapping/,
    ],
    [
      "inclusive boundary",
      (c) => {
        c.fees[0]!.effective_to = "2026-01-01";
        c.fees.push({
          ...c.fees[0]!,
          effective_from: "2026-01-01",
          effective_from_basis: "stated",
          effective_to: null,
        });
      },
      /overlapping/,
    ],
    [
      "bad cadence",
      (c) => {
        c.credits[0]!.versions[0]!.reset_basis = "since_last_credit";
      },
      /multi_year/,
    ],
    [
      "bad statement year",
      (c) => {
        c.credits[0]!.versions[0]!.reset_basis = "anniversary_statement";
      },
      /requires annual/,
    ],
    [
      "extraneous period years",
      (c) => {
        c.credits[0]!.versions[0]!.period_years = 4;
      },
      /period_years/,
    ],
    [
      "any channel combined",
      (c) => {
        c.earn_rates[0]!.versions[0]!.conditions.channels = ["any", "direct"];
      },
      /stand alone/,
    ],
    [
      "bad shared cap",
      (c) => {
        c.earn_rates[0]!.versions[0]!.cap!.shared_with = ["missing"];
      },
      /invalid rule/,
    ],
  ];
  for (const [name, mutate, message] of cases)
    await t.test(name, () => {
      const card = structuredClone(amex);
      mutate(card);
      assert.match(errors(card).join("\n"), message);
    });
  const good = structuredClone(amex);
  good.fees[0]!.effective_to = "2025-12-31";
  good.fees.push({
    ...good.fees[0]!,
    effective_from: "2026-01-01",
    effective_from_basis: "stated",
    effective_to: null,
  });
  assert.deepEqual(errors(good), []);
});

test("normalization follows the shared contract and dates reject invalid leap days", () => {
  assert.equal(normalizeKeyword(" ＦＬＩＸ-PREMIUM*CREDIT "), "FLIX PREMIUM CREDIT");
  assert.equal(normalizeKeyword("Walmart+ & café"), "WALMART+ & CAFÉ");
  assert.equal(isDate("2024-02-29"), true);
  assert.equal(isDate("2026-02-29"), false);
});

test("build is reproducible, preserves source data, and hashes exact output bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cardfacts-build-"));
  try {
    await buildCatalog(catalog, directory);
    const first = await readFile(join(directory, "cards.json"), "utf8");
    const min = await readFile(join(directory, "cards.min.json"), "utf8");
    const sums = await readFile(join(directory, "SHA256SUMS"), "utf8");
    assert.deepEqual(JSON.parse(first), JSON.parse(min));
    assert.deepEqual(JSON.parse(first).products, catalog.cards);
    assert.equal(sums, `${sha256(first)}  cards.json\n${sha256(min)}  cards.min.json\n`);
    await buildCatalog(catalog, directory);
    assert.equal(await readFile(join(directory, "cards.json"), "utf8"), first);
    assert.equal(await readFile(join(directory, "SHA256SUMS"), "utf8"), sums);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("source listing traces individual fields; stale uses strictly older than N days", () => {
  const sources = listSources(catalog);
  const source = sources.find((s) => s.id === amex.fees[0]!.source)!;
  assert.ok(source.fields.some((f) => f.product === amex.id && f.path === "/fees/0/annual_fee"));
  const clone = structuredClone(catalog);
  clone.cards = [structuredClone(amex)];
  const allVersions = [
    clone.cards[0]!.fees,
    ...clone.cards[0]!.earn_rates.map((r) => r.versions),
    ...clone.cards[0]!.credits.map((c) => c.versions),
  ];
  for (const group of allVersions) for (const v of group) v.last_verified = "2026-01-01";
  assert.equal(staleVersions(clone, 90, "2026-04-01").length, 0);
  const result = staleVersions(clone, 90, "2026-04-02");
  assert.equal(result.length, allVersions.flat().length);
  assert.ok(result.every((r) => r.age_days === 91));
  assert.throws(() => staleVersions(clone, -1, "2026-01-01"));
  assert.throws(() => staleVersions(clone, 90, "2026-02-30"));
});

test("history permits closing and appending, but rejects rewriting or removing terms", () => {
  const before = [structuredClone(amex)];
  const after = structuredClone(before);
  const fee = after[0]!.fees[0]!;
  fee.effective_to = "2026-10-31";
  after[0]!.fees.push({
    ...fee,
    effective_from: "2026-11-01",
    effective_from_basis: "stated",
    effective_to: null,
    annual_fee: "999.00",
  });
  assert.deepEqual(historyErrors(before, after), []);
  const closed = structuredClone(after);
  closed[0]!.fees[0]!.annual_fee = "1.00";
  assert.match(historyErrors(after, closed).join("\n"), /historical terms changed/);
  closed[0]!.fees[0] = structuredClone(after[0]!.fees[0]!);
  closed[0]!.fees[0]!.effective_to = "2026-10-30";
  assert.match(historyErrors(after, closed).join("\n"), /historical terms changed/);
  assert.match(historyErrors(before, []).join("\n"), /product removed/);
  const sourceChange = structuredClone(before);
  sourceChange[0]!.sources[0]!.url += "?replacement=1";
  assert.match(historyErrors(before, sourceChange).join("\n"), /source URL changed/);
  const conditionChange = structuredClone(before);
  conditionChange[0]!.earn_rates[0]!.versions[0]!.conditions.channels = ["any"];
  assert.match(historyErrors(before, conditionChange).join("\n"), /historical terms changed/);
});

test("CLI emits parseable JSON and rejects unsupported or malformed options", () => {
  const run = (...args: string[]) =>
    execFileSync(process.execPath, ["--import", "tsx", "scripts/cli.ts", ...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  assert.deepEqual(JSON.parse(run("sources", "--json")), listSources(catalog));
  assert.ok(Array.isArray(JSON.parse(run("stale", "--days", "90", "--as-of", "2027-12-31", "--json"))));
  assert.throws(() => run("build", "--days", "3"));
  assert.throws(() => run("stale", "--days", "nope"));
  assert.throws(() => run("validate", "unexpected"));
  assert.doesNotThrow(() => readBaseCards(root, "HEAD"));
});
