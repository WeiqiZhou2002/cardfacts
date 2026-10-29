import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { loadCatalog, readJson, sha256 } from "../scripts/lib/catalog.js";
import { buildSite } from "../scripts/lib/site.js";
import {
  context,
  filterCards,
  href,
  normalizeBase,
  reviewItems,
  scriptJson,
  selectedRevision,
} from "../site/model.js";
import type { Category, SiteData } from "../site/model.js";
import { renderPage } from "../site/views.js";

const root = resolve(import.meta.dirname, "..");
const catalog = await loadCatalog(root);
const data: SiteData = {
  cards: catalog.cards,
  revisions: catalog.revisions,
  earnCategories: (await readJson(join(root, "vocab/earn-categories.json"))) as Category[],
  creditCategories: (await readJson(join(root, "vocab/credit-categories.json"))) as Category[],
  asOf: "2026-10-28",
  version: catalog.metadata.catalog_version,
  base: "/cardfacts/",
  repository: "https://github.com/WeiqiZhou2002/cardfacts",
};
const query = (q = "") => context(data, "catalog", "zh", new URLSearchParams(q));

test("filters combine audience, units and conditional earn categories without valuing points", () => {
  assert.equal(filterCards(query()).length, 30);
  assert.equal(filterCards(query("audience=business")).length, 10);
  const cash = filterCards(query("unit=cash&earn=groceries&min_rate=3"));
  assert.ok(cash.length > 0);
  assert.ok(cash.every((c) => c.rewards.unit === "cash"));
  assert.ok(!cash.some((c) => c.id === "us-amex-gold"));
  assert.ok(
    filterCards(query("q=gold&unit=points&earn=groceries&min_rate=4")).some((c) => c.id === "us-amex-gold"),
  );
  assert.equal(filterCards(query("q=no-such-card")).length, 0);
  assert.ok(
    filterCards(query("fee=free")).every((c) =>
      c.fees.some((v) => v.annual_fee !== null && Number(v.annual_fee) === 0 && v.status === "verified"),
    ),
  );
  const unknown = structuredClone(data);
  unknown.cards[0]!.fees[0]!.annual_fee = null;
  unknown.cards[0]!.fees[0]!.status = "to_verify";
  assert.ok(
    !filterCards(context(unknown, "catalog", "zh", new URLSearchParams("fee=free"))).includes(
      unknown.cards[0]!,
    ),
  );
});

test("quarterly filters use only applicable rotations; review queue uses a strict 90-day boundary", () => {
  const flex = catalog.cards.find((c) => c.id === "us-chase-freedom-flex")!;
  const rotation = flex.earn_rates.find((r) => r.category === "rotating")!;
  const version = rotation.versions.find((v) => v.effective_from === "2026-10-01")!;
  const category = version.conditions.selection!.categories[1]!;
  assert.ok(filterCards(query(`q=freedom+flex&earn=${category}&min_rate=5&asof=2026-12-31`)).length > 0);
  assert.equal(filterCards(query(`q=freedom+flex&earn=${category}&min_rate=5&asof=2027-01-01`)).length, 0);
  assert.equal(reviewItems(catalog.cards, "2026-10-28").filter((x) => x.pending).length, 10);
  const card = structuredClone(catalog.cards[0]!);
  card.earn_rates = [];
  card.credits = [];
  card.fees = [{ ...card.fees[0]!, status: "verified", last_verified: "2026-01-01" }];
  assert.equal(reviewItems([card], "2026-04-01").length, 0);
  assert.equal(reviewItems([card], "2026-04-02")[0]!.age, 91);
});

test("historical pages restore snapshots and reject invalid time queries without showing current terms", () => {
  const product = "us-capital-one-venture-x";
  const old = context(data, "card", "zh", new URLSearchParams("recorded_at=2026-10-28T22:00:00Z"), product);
  assert.equal(
    selectedRevision(old)!.product.earn_rates.some((r) => r.category === "entertainment"),
    false,
  );
  assert.match(renderPage(old), /正在查看存档/);
  const latest = context(data, "card", "en", new URLSearchParams(), product);
  assert.ok(selectedRevision(latest)!.product.earn_rates.some((r) => r.category === "entertainment"));
  assert.match(renderPage(latest), /content changes/);
  const missing = context(
    data,
    "card",
    "en",
    new URLSearchParams("recorded_at=2000-01-01T00:00:00Z"),
    product,
  );
  assert.equal(selectedRevision(missing), null);
  assert.match(renderPage(missing), /No record at this time/);
  assert.doesNotMatch(renderPage(missing), /id="earn"/);
  for (const q of [
    "asof=2026-02-30",
    "recorded_at=2026-10-28",
    "revision=x&recorded_at=2026-10-28T22:00:00Z",
    "min_rate=NaN",
  ]) {
    const ctx = context(data, "card", "en", new URLSearchParams(q), product);
    assert.ok(ctx.error);
    assert.doesNotMatch(renderPage(ctx), /id="earn"/);
  }
});

test("URLs preserve dates and card selections under a project path, and untrusted text stays escaped", () => {
  const ctx = query("cards=us-amex-gold,invalid,us-amex-gold,us-amex-platinum&asof=2027-01-01");
  assert.equal(ctx.selected.length, 2);
  assert.equal(
    href(ctx, "compare/", undefined, "en"),
    "/cardfacts/en/compare/?asof=2027-01-01&cards=us-amex-gold%2Cus-amex-platinum",
  );
  assert.throws(() => normalizeBase("//example.com/"));
  assert.throws(() => normalizeBase("/missing-slash"));
  const attack = '</script><img src=x onerror="alert(1)">';
  assert.ok(!scriptJson({ attack }).includes("<"));
  assert.equal(JSON.parse(scriptJson({ attack })).attack, attack);
  const html = renderPage(query("q=" + encodeURIComponent(attack)));
  assert.ok(!html.includes(attack));
  assert.ok(html.includes("&lt;/script&gt;"));
});

test("static build is reproducible, contains all bilingual pages, and resolves every internal asset/link", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "cardfacts-site-"));
  try {
    const left = join(tmp, "one"),
      right = join(tmp, "two");
    const result = await buildSite(root, left, "/cardfacts/");
    await buildSite(root, right, "/cardfacts/");
    assert.equal(result.pages.length, 70);
    const files = await readdir(left, { recursive: true, withFileTypes: true });
    for (const entry of files.filter((e) => e.isFile())) {
      const relative = join(entry.parentPath, entry.name).slice(left.length + 1);
      const a = await readFile(join(left, relative)),
        b = await readFile(join(right, relative));
      assert.equal(sha256(a.toString()), sha256(b.toString()), relative);
      if (!relative.endsWith(".html")) continue;
      const html = a.toString();
      assert.doesNotMatch(html, /日期无效|Invalid date/);
      assert.ok(html.includes('type="application/json"'));
      for (const match of html.matchAll(/(?:href|src)="(\/cardfacts\/[^"?#]*)(?:[^"\s]*)"/g)) {
        const path = match[1]!.slice("/cardfacts/".length);
        await assert.doesNotReject(
          readFile(join(left, path + (path.endsWith("/") || !path ? "index.html" : ""))),
          `${relative} -> ${path}`,
        );
      }
    }
    const html = await readFile(join(left, "index.html"), "utf8");
    assert.equal((html.match(/class="catalog-row"/g) ?? []).length, 30);
    const detail = await readFile(join(left, "en/cards/us-capital-one-venture-x/index.html"), "utf8");
    assert.match(detail, /id="history"/);
    assert.match(detail, /id="sources"/);
    const payload = JSON.parse(
      detail.match(/<script id="site-data" type="application\/json">(.*?)<\/script>/s)![1]!,
    );
    assert.equal(payload.data.revisions.length, 2);
    assert.equal(payload.data.asOf, "2026-10-28");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
