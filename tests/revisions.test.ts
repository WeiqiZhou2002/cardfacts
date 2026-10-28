import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { cardErrors, loadCatalog, readJson } from "../scripts/lib/catalog.js";
import {
  canonical,
  isTimestamp,
  recordRevision,
  revisionAt,
  revisionDiff,
  revisionErrors,
  revisionHash,
  termsAt,
} from "../scripts/lib/revisions.js";
import type { Revision } from "../scripts/lib/revisions.js";

const root = resolve(import.meta.dirname, "..");
const catalog = await loadCatalog(root);
const card = (id: string) => catalog.cards.find((c) => c.id === id)!;
const latest = (id: string) => revisionAt(catalog.revisions, id)!;

test("catalog has 20 personal and 10 business cards, each fully preserved in a latest snapshot", () => {
  assert.equal(catalog.cards.filter((c) => c.audience === "personal").length, 20);
  assert.equal(catalog.cards.filter((c) => c.audience === "business").length, 10);
  for (const product of catalog.cards) assert.deepEqual(latest(product.id).product, product);
});

test("recorded-time lookup preserves seed content and never invents pre-catalog history", () => {
  const id = "us-capital-one-venture-x";
  const first = catalog.revisions.filter((r) => r.product_id === id)[0]!;
  assert.equal(revisionAt(catalog.revisions, id, "2000-01-01T00:00:00Z"), null);
  assert.deepEqual(revisionAt(catalog.revisions, id, first.recorded_at), first);
  assert.ok(!first.product.earn_rates.some((r) => r.id === "capital-one-entertainment"));
  assert.ok(latest(id).product.earn_rates.some((r) => r.id === "capital-one-entertainment"));
  assert.ok(revisionDiff(first, latest(id)).changes.some((c) => c.path === "/earn_rates"));
});

test("effective-time lookup handles inclusive end dates and future announced eligibility", () => {
  const product = card("us-amex-business-platinum");
  const before = termsAt(product, "2026-12-31").credits.find((c) => c.id === "hotel")!;
  const after = termsAt(product, "2027-01-01").credits.find((c) => c.id === "hotel")!;
  assert.equal(before.certainty, "unknown_start");
  assert.equal(before.version.conditions, undefined);
  assert.equal(after.certainty, "stated");
  assert.equal(after.version.conditions!.minimum_nights, 2);
  assert.equal(
    termsAt(product, "2027-02-16").credits.find((c) => c.id === "wireless")!.version.amount,
    "10.00",
  );
  assert.equal(
    termsAt(product, "2027-02-17").credits.find((c) => c.id === "wireless")!.certainty,
    "to_verify",
  );
});

test("rotation switches at quarter boundaries and does not project unpublished quarters", () => {
  const product = card("us-chase-freedom-flex");
  const rotation = (date: string) => termsAt(product, date).earn_rates.find((r) => r.id === "rotating");
  assert.ok(rotation("2026-09-30")!.version.conditions.selection!.categories.includes("gas"));
  assert.ok(rotation("2026-10-01")!.version.conditions.selection!.categories.includes("dining"));
  assert.ok(rotation("2027-01-01")!.version.conditions.selection!.categories.includes("streaming"));
  assert.equal(rotation("2027-04-01"), undefined);
});

test("dates and unknown-start terms do not imply unsupported certainty", () => {
  for (const invalid of [
    "2026-02-30T12:00:00Z",
    "2026-10-28T24:00:00Z",
    "2026-10-28",
    "2026-10-28T12:00:00-07:00",
  ])
    assert.equal(isTimestamp(invalid), false);
  assert.equal(isTimestamp("2024-02-29T23:59:59Z"), true);
  assert.throws(() => revisionAt([], "missing", "yesterday"));
  assert.throws(() => termsAt(catalog.cards[0]!, "2026-02-30"));
  assert.equal(termsAt(card("us-amex-gold"), "2000-01-01").fees!.certainty, "unknown_start");
});

test("archived snapshots cannot be rewritten, removed, or inserted into recorded history", () => {
  const original = latest("us-amex-gold");
  const changed = structuredClone(original);
  changed.reason = "A different reason";
  assert.match(revisionErrors([original], [changed]).join(), /removed or modified/);
  assert.match(revisionErrors([original], []).join(), /removed or modified/);
  const backdated = { ...original, id: "another", recorded_at: "2020-01-01T00:00:00Z" };
  assert.match(revisionErrors([original], [original, backdated]).join(), /after existing history/);
});

test("diff includes editorial changes, fees and source metadata; hashes ignore key order", () => {
  const before = latest("us-amex-gold");
  const after = structuredClone(before);
  after.product.credits[0]!.versions[0]!.notes = "Corrected description";
  after.product.fees[0]!.annual_fee = "400.00";
  after.product.sources[0]!.title = "Retitled source";
  assert.deepEqual(
    revisionDiff(before, after).changes.map((c) => c.path),
    ["/credits/0/versions/0/notes", "/fees/0/annual_fee", "/sources/0/title"],
  );
  assert.equal(canonical({ b: 1, a: [2, 3] }), canonical({ a: [2, 3], b: 1 }));
  assert.notEqual(revisionHash(before.product), revisionHash(after.product));
  assert.throws(() => revisionDiff(before, latest("us-amex-platinum")), /same product/);
});

test("editing a card requires a fresh snapshot; append is immutable and checksum-validated", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cardfacts-history-"));
  try {
    for (const item of ["data", "history", "vocab", "schema", "maintenance", "vectors", "catalog.json"])
      await cp(join(root, item), join(directory, item), { recursive: true });
    const id = "us-amex-gold";
    const original = latest(id);
    const originalPath = join(directory, "history", id, `${original.id}.json`);
    const originalBytes = await readFile(originalPath, "utf8");
    const product = structuredClone(card(id));
    product.credits[0]!.versions[0]!.notes += " Editorial clarification.";
    await writeFile(join(directory, "data/us/amex", `${id}.json`), JSON.stringify(product));
    await assert.rejects(loadCatalog(directory), /needs a new snapshot/);
    const working = await loadCatalog(directory, { allowUnrecorded: true });
    await assert.rejects(recordRevision(working, id, original.recorded_at, "Edit"), /after the latest/);
    await assert.rejects(recordRevision(working, id, "2099-01-01T00:00:00Z", " "), /non-empty/);
    const revision = await recordRevision(working, id, "2099-01-01T00:00:00Z", "Clarify notes");
    assert.equal(await readFile(originalPath, "utf8"), originalBytes);
    assert.equal(revisionAt((await loadCatalog(directory)).revisions, id)!.id, revision.id);
    await assert.rejects(recordRevision(working, id, "2099-01-02T00:00:00Z", "Duplicate"), /unchanged/);
    const file = join(directory, "history", id, `${revision.id}.json`);
    revision.product.notes = "Tampered";
    await writeFile(file, JSON.stringify(revision));
    await assert.rejects(loadCatalog(directory), /checksum/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("semantic checks reject invalid selectors, shared caps, timezones and activity resets", async () => {
  const earn = new Set(
    ((await readJson(join(root, "vocab/earn-categories.json"))) as { id: string }[]).map((x) => x.id),
  );
  const credits = new Set(
    ((await readJson(join(root, "vocab/credit-categories.json"))) as { id: string }[]).map((x) => x.id),
  );
  const errors = (product: (typeof catalog.cards)[number]) =>
    cardErrors(
      product,
      catalog.issuers.issuers.find((i) => i.name === product.issuer)!,
      earn,
      credits,
    ).join();
  const gold = structuredClone(card("us-amex-business-gold"));
  const selected = gold.earn_rates.find((r) => r.id === "gas")!.versions[0]!;
  selected.conditions.selection = {
    type: "top_spend",
    count: 7,
    period: "billing_cycle",
    categories: ["gas", "missing"],
  };
  selected.cap!.amount = "1.00";
  assert.match(errors(gold), /unknown category/);
  assert.match(errors(gold), /top-spend count/);
  assert.match(errors(gold), /inconsistent shared cap/);
  const flex = structuredClone(card("us-chase-freedom-flex"));
  flex.earn_rates.find((r) => r.id === "rotating")!.versions.at(-1)!.effective_to = null;
  assert.match(errors(flex), /dated window/);
  const elite = structuredClone(card("us-citi-strata-elite"));
  elite.earn_rates.find((r) => r.id === "citi-nights")!.versions[0]!.conditions.time_window!.timezone =
    "nowhere";
  assert.match(errors(elite), /invalid timezone/);
  const go = structuredClone(card("us-us-bank-altitude-go"));
  delete go.credits[0]!.versions[0]!.conditions;
  assert.match(errors(go), /consecutive_months/);
});

test("history CLI supports listing, two time axes, comparison and explicit missing history", () => {
  const run = (...args: string[]) =>
    JSON.parse(
      execFileSync(process.execPath, ["--import", "tsx", "scripts/cli.ts", "history", ...args], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  const id = "us-capital-one-venture-x";
  const history = run(id, "--json") as Revision[];
  assert.ok(history.length >= 2);
  assert.ok(!("product" in history[0]!));
  const first = history[0]!;
  const result = run(id, "--recorded-at", first.recorded_at, "--as-of", "2026-10-28", "--json");
  assert.equal(result.revision_id, first.id);
  assert.equal(result.terms.credits[0].certainty, "to_verify");
  assert.equal(run(id, "--recorded-at", "2000-01-01T00:00:00Z").status, "not_recorded");
  assert.ok(run(id, "--from", first.id, "--to", history.at(-1)!.id).changes.length);
  assert.throws(() => run(id, "--from", first.id));
  assert.throws(() => run(id, "--recorded-at", ""));
  assert.throws(() => run(id, "--recorded-at", "2000-01-01T00:00:00Z", "--as-of", "2026-02-30"));
  assert.throws(() => run("missing"));
});
