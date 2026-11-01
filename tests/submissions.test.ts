import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { loadCatalog } from "../scripts/lib/catalog.js";
import { historyErrors } from "../scripts/lib/history.js";
import { recordRevision, revisionErrors } from "../scripts/lib/revisions.js";
import {
  applyProductSubmission,
  describeProduct,
  reverifyDiffErrors,
  reverifySummary,
  SubmissionError,
  validateSubmission,
} from "../scripts/lib/submissions.js";
import type { ProductSubmission, Submission } from "../scripts/lib/submissions.js";
import type { CreditVersion } from "../scripts/lib/types.js";

const root = resolve(import.meta.dirname, "..");
const catalog = await loadCatalog(root);
const card = (id: string) => catalog.cards.find((c) => c.id === id)!;
const now = new Date("2026-11-01T07:00:00Z");
const hash = "a".repeat(64);
const gold = (): ProductSubmission => ({
  product_id: "us-amex-gold",
  sources: [
    {
      source_id: "us-amex-gold-benefits",
      url: "https://www.americanexpress.com/en-us/account/get-started/gold/explore-benefits",
      fetched_at: "2026-11-01T06:05:00Z",
      text_sha256: hash,
    },
    {
      source_id: "us-amex-gold-page",
      url: "https://www.americanexpress.com/us/credit-cards/card/gold-card/",
      fetched_at: "2026-11-01T06:06:00Z",
      text_sha256: hash,
    },
  ],
  verified: [{ target: "/fees", source_id: "us-amex-gold-page" }],
  changes: [
    {
      target: "/credits/resy",
      source_id: "us-amex-gold-benefits",
      set: { amount: "60.00" },
      effective_from: "2027-01-01",
      effective_from_basis: "stated",
      notes: "Up to $60 each half-year at US Resy restaurants from 2027.",
      evidence: "Benefits page, Resy credit",
    },
  ],
  flags: [],
});
const submission = (...products: ProductSubmission[]): Submission => ({
  format_version: 1,
  submission_id: "20261101T060000Z-test",
  agent: { name: "cardfacts-agent", version: "0.1.0", model: "test-model" },
  checked_at: "2026-11-01T06:10:00Z",
  products,
});

test("valid submissions pass; schema and catalog mismatches are rejected with paths", async () => {
  await validateSubmission(catalog, submission(gold()), now);
  const reject = async (edit: (s: Submission) => void, pattern: RegExp) => {
    const s = structuredClone(submission(gold()));
    edit(s);
    await assert.rejects(
      validateSubmission(catalog, s, now),
      (e: Error) => e instanceof SubmissionError && pattern.test(e.message),
    );
  };
  await reject((s) => (s.products[0]!.product_id = "us-nope"), /unknown product/);
  await reject(
    (s) => (s.products[0]!.sources[0]!.url = "https://www.americanexpress.com/other"),
    /URL does not match/,
  );
  await reject(
    (s) => (s.products[0]!.sources[0]!.source_id = "us-chase-sapphire-reserve-page"),
    /not a source/,
  );
  await reject(
    (s) => s.products[0]!.verified.push({ target: "/credits/resy", source_id: "us-amex-gold-benefits" }),
    /more than once/,
  );
  await reject((s) => (s.products[0]!.changes[0]!.set = { rate: "5" }), /cannot be set on credits/);
  await reject((s) => (s.products[0]!.changes[0]!.target = "/credits/missing"), /unknown target/);
  await reject((s) => (s.products[0]!.changes[0]!.effective_from = null), /submission/);
  await reject((s) => (s.checked_at = "2026-10-01T00:00:00Z"), /more than 14 days old/);
  await reject((s) => (s.checked_at = "2026-11-02T00:00:00Z"), /in the future/);
  await reject((s) => (s.products[0]!.sources[0]!.fetched_at = "2026-11-01T06:30:00Z"), /fetched_at/);
  await reject((s) => ((s as { extra?: number }).extra = 1), /must NOT have additional properties/);
  await reject((s) => (s.products[0]!.changes[0]!.set = { amount: "60" }), /pattern/);
  await reject((s) => s.products.push(gold()), /duplicate product/);
});

test("a stated change closes the current version and appends a verified one; unchanged values re-verify", () => {
  const product = gold();
  product.changes.push({
    target: "/credits/uber",
    source_id: "us-amex-gold-benefits",
    set: { amount: "10.00" },
    effective_from: null,
    effective_from_basis: "detected",
    notes: "Unchanged.",
    evidence: "Uber Cash",
  });
  const { card: next, result } = applyProductSubmission(card("us-amex-gold"), product);
  const resy = next.credits.find((c) => c.id === "resy")!.versions as CreditVersion[];
  assert.equal(resy.length, 2);
  assert.equal(resy[0]!.effective_to, "2026-12-31");
  assert.equal(resy[0]!.amount, "50.00");
  assert.equal(resy[0]!.last_verified, "2026-10-28");
  assert.deepEqual(
    [
      resy[1]!.amount,
      resy[1]!.effective_from,
      resy[1]!.effective_from_basis,
      resy[1]!.status,
      resy[1]!.last_verified,
    ],
    ["60.00", "2027-01-01", "stated", "verified", "2026-11-01"],
  );
  assert.deepEqual(
    result.changes.map((c) => [c.label, c.field, c.before, c.after]),
    [["credits.resy", "amount", "50.00", "60.00"]],
  );
  assert.deepEqual(result.verified.map((v) => v.target).sort(), ["/credits/uber", "/fees"]);
  assert.equal(next.fees[0]!.last_verified, "2026-11-01");
  assert.equal(next.sources.find((s) => s.id === "us-amex-gold-page")!.accessed, "2026-11-01");
  // Applying the same findings to the result changes nothing more.
  const again = applyProductSubmission(next, product);
  assert.equal(again.result.changes.length, 0);
  assert.deepEqual(again.card, next);
});

test("changes the data contradicts are not applied and come back as conflict flags", () => {
  const conflicts = (product: ProductSubmission, id = "us-amex-gold") =>
    applyProductSubmission(card(id), product)
      .result.flags.filter((f) => f.kind === "conflict")
      .map((f) => f.summary);
  const early = gold();
  early.changes[0]!.effective_from = "2026-10-01";
  assert.match(conflicts(early).join(), /not after 2026-10-28, when the current value was last verified/);
  const cap = gold();
  cap.changes = [
    {
      target: "/earn_rates/flights",
      source_id: "us-amex-gold-benefits",
      set: { cap_amount: "1000.00" },
      effective_from: null,
      effective_from_basis: "detected",
      notes: "Cap.",
      evidence: "Rewards",
    },
  ];
  assert.match(conflicts(cap).join(), /no structured cap/);
  const csr: ProductSubmission = {
    product_id: "us-chase-sapphire-reserve",
    sources: [
      {
        source_id: "chase-csr-page",
        url: "https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve",
        fetched_at: "2026-11-01T06:00:00Z",
        text_sha256: hash,
      },
    ],
    verified: [],
    changes: [
      {
        target: "/credits/stubhub",
        source_id: "chase-csr-page",
        set: { amount: "200.00" },
        effective_from: null,
        effective_from_basis: "detected",
        notes: "Higher StubHub credit.",
        evidence: "StubHub",
      },
    ],
    flags: [],
  };
  assert.match(conflicts(csr, "us-chase-sapphire-reserve").join(), /already ends on 2027-12-31/);
});

test("a pending credit is resolved by a detected verified version only when its amount is supplied", () => {
  const vx: ProductSubmission = {
    product_id: "us-capital-one-venture-x",
    sources: [
      {
        source_id: "capone-venture-x-page",
        url: "https://www.capitalone.com/credit-cards/venture-x/",
        fetched_at: "2026-11-01T06:00:00Z",
        text_sha256: hash,
      },
    ],
    verified: [{ target: "/credits/trusted-traveler", source_id: "capone-venture-x-page" }],
    changes: [
      {
        target: "/credits/travel",
        source_id: "capone-venture-x-page",
        set: { amount: "300.00" },
        effective_from: null,
        effective_from_basis: "detected",
        notes: "Up to $300 each account year for Capital One Travel bookings.",
        evidence: "Travel credit section",
      },
    ],
    flags: [],
  };
  const { card: next, result } = applyProductSubmission(card("us-capital-one-venture-x"), vx);
  const travel = next.credits.find((c) => c.id === "travel")!.versions as CreditVersion[];
  assert.deepEqual(
    travel.map((v) => [v.status, v.amount, v.effective_from, v.effective_from_basis, v.effective_to]),
    [
      ["to_verify", null, null, "unknown", "2026-10-31"],
      ["verified", "300.00", "2026-11-01", "detected", null],
    ],
  );
  assert.equal(result.changes[0]!.detected_after, "2026-10-27");
  assert.deepEqual(result.skipped, [
    { target: "/credits/trusted-traveler", reason: "a pending version has no value to re-verify" },
  ]);
  const { title, body } = describeProduct(next, submission(vx), vx, result);
  assert.match(title, /credits\.travel amount pending → 300\.00 \(checked 2026-11-01\)/);
  assert.match(body, /between 2026-10-27 and 2026-11-01 \(detected\)/);
});

test("applied submissions pass catalog validation and history protection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cardfacts-submission-"));
  try {
    for (const path of ["catalog.json", "data", "history", "maintenance", "schema", "vectors", "vocab"])
      await cp(join(root, path), join(dir, path), { recursive: true });
    const { card: next } = applyProductSubmission(card("us-amex-gold"), gold());
    await writeFile(join(dir, "data/us/amex/us-amex-gold.json"), JSON.stringify(next, null, 2) + "\n");
    await recordRevision(
      await loadCatalog(dir, { allowUnrecorded: true }),
      next.id,
      "2026-11-01T06:11:00Z",
      "Test.",
    );
    const after = await loadCatalog(dir);
    assert.deepEqual(historyErrors(catalog.cards, after.cards), []);
    assert.deepEqual(revisionErrors(catalog.revisions, after.revisions), []);
    assert.deepEqual(reverifyDiffErrors(catalog.cards, after.cards).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("re-verification diffs allow only forward verification and access dates", () => {
  const product = gold();
  product.changes = [];
  product.verified.push({ target: "/credits/dining", source_id: "us-amex-gold-benefits" });
  const { card: next } = applyProductSubmission(card("us-amex-gold"), product);
  const after = catalog.cards.map((c) => (c.id === next.id ? next : c));
  assert.deepEqual(reverifyDiffErrors(catalog.cards, after), []);
  assert.deepEqual(
    reverifySummary(catalog.cards, after).map((e) => [e.label, e.from, e.to]),
    [
      ["fees", "2026-10-28", "2026-11-01"],
      ["credits.dining", "2026-10-28", "2026-11-01"],
    ],
  );
  const notes = structuredClone(next);
  notes.notes = "Edited.";
  assert.match(reverifyDiffErrors(catalog.cards, [notes]).join(), /only last_verified/);
  const backwards = structuredClone(next);
  backwards.fees[0]!.last_verified = "2026-01-01";
  assert.match(reverifyDiffErrors(catalog.cards, [backwards]).join(), /moved backwards/);
});
