import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { listSources, loadCatalog, sha256, versionGroups } from "../scripts/lib/catalog.js";
import { planRun, validatePlan } from "../scripts/lib/maintenance/queue.js";
import { atomicJson, readFetchState } from "../scripts/lib/maintenance/state.js";

const catalog = await loadCatalog(resolve(import.meta.dirname, ".."));
const automated = () => {
  const c = structuredClone(catalog);
  c.issuers.manual_only = [];
  return c;
};
const asOf = "2026-11-10";
async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "cardfacts-queue-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const options = (directory: string) => ({
  mode: "daily" as const,
  asOf,
  maxSources: 100,
  schedule: { daily: [], rotation_days: 7 },
  readState: (url: string) => readFetchState(directory, url),
});
async function checked(directory: string, source: { id: string; url: string }, date: string) {
  await atomicJson(join(directory, `${sha256(source.url)}.json`), {
    source_id: source.id,
    url: source.url,
    checked_at: date,
    status: "failed",
    previous_hash: null,
    last_success: null,
    consecutive_failures: 1,
    error: "Source returned HTTP 403",
  });
}

test("queue prioritizes reports then daily then rotation, deduplicates overlapping reasons and truncates deterministically", async () =>
  fixture(async (directory) => {
    const c = automated(),
      sources = listSources(c),
      settings = options(directory);
    const report = "us-amex-gold",
      daily = "us-chase-sapphire-reserve";
    const input = {
      ...settings,
      changeReports: [report, report],
      schedule: { daily: [report, daily], rotation_days: 7 },
    };
    const all = await planRun(c, input);
    const reportSources = sources.filter((s) => s.products.includes(report)).map((s) => s.id);
    const dailySources = sources.filter((s) => s.products.includes(daily)).map((s) => s.id);
    assert.deepEqual(
      all.queue.slice(0, reportSources.length).map((e) => [e.source_id, e.reason]),
      reportSources.map((id) => [id, "change_report"]),
    );
    assert.deepEqual(
      all.queue
        .slice(reportSources.length, reportSources.length + dailySources.length)
        .map((e) => [e.source_id, e.reason]),
      dailySources.map((id) => [id, "daily"]),
    );
    assert.equal(new Set(all.queue.map((e) => e.source_id)).size, sources.length);
    const limited = await planRun(c, { ...input, maxSources: 2 });
    assert.deepEqual(limited.queue, all.queue.slice(0, 2));
    assert.equal(limited.deferred, sources.length - 2);
    assert.deepEqual(await planRun(c, input), all);
    assert.equal((await planRun(c, { ...input, maxSources: 0 })).deferred, sources.length);
    validatePlan(c, limited);
  }));

test("rotation counts failed attempts, uses strict UTC date boundaries and puts never-checked sources before oldest attempts", async () =>
  fixture(async (directory) => {
    const c = automated(),
      sources = listSources(c),
      [old, newer, boundary, later, never] = sources;
    for (const source of sources) await checked(directory, source, "2026-11-09T00:00:00.000Z");
    await checked(directory, old!, "2026-11-01T23:00:00.000Z");
    await checked(directory, newer!, "2026-11-02T00:00:00Z");
    await checked(directory, boundary!, "2026-11-03T00:00:00Z");
    await checked(directory, later!, "2026-11-03T23:59:59Z");
    await rm(join(directory, `${sha256(never!.url)}.json`));
    const result = await planRun(c, options(directory));
    assert.deepEqual(
      result.queue.map((e) => [e.source_id, e.last_checked]),
      [
        [never!.id, null],
        [old!.id, "2026-11-01"],
        [newer!.id, "2026-11-02"],
      ],
    );
    const short = await planRun(c, { ...options(directory), schedule: { daily: [], rotation_days: 1 } });
    assert.ok(short.queue.some((e) => e.source_id === boundary!.id));
    await checked(directory, old!, "2026-11-02T23:00:00Z");
    const sameDay = await planRun(c, options(directory));
    assert.deepEqual(
      sameDay.queue.map((e) => e.source_id),
      [never!.id, newer!.id, old!.id],
    );
  }));

test("manual-only sources are listed only when eligible and never consume the automatic budget", async () =>
  fixture(async (directory) => {
    const c = automated(),
      sources = listSources(c);
    c.issuers.manual_only = ["amex"];
    const plan = await planRun(c, { ...options(directory), maxSources: 1, changeReports: ["us-amex-gold"] });
    const manual = sources.filter((s) => s.issuer === "amex");
    assert.equal(plan.manual_due.length, manual.length);
    assert.equal(plan.queue.length, 1);
    assert.notEqual(plan.queue[0]!.issuer, "amex");
    assert.equal(plan.deferred, sources.length - manual.length - 1);
    assert.ok(
      plan.manual_due
        .filter((e) => e.products.includes("us-amex-gold"))
        .every((e) => e.reason === "change_report"),
    );
    for (const source of sources) await checked(directory, source, "2026-11-10T00:00:00Z");
    assert.equal((await planRun(c, options(directory))).manual_due.length, 0);
    const actual = await planRun(catalog, {
      ...options(directory),
      schedule: { daily: ["us-amex-platinum"], rotation_days: 7 },
    });
    assert.equal(actual.queue.length, 0);
    assert.equal(actual.deferred, 0);
    assert.ok(
      actual.manual_due.every((e) => e.products.includes("us-amex-platinum") && e.reason === "daily"),
    );
    assert.equal(catalog.issuers.manual_only.length, 7);
  }));

test("reverify includes only sources cited by verified versions strictly older than seven days", async () =>
  fixture(async (directory) => {
    const c = automated();
    for (const card of c.cards)
      for (const group of versionGroups(card)) for (const v of group.versions) v.last_verified = "2026-11-03";
    const gold = c.cards.find((c) => c.id === "us-amex-gold")!,
      vx = c.cards.find((c) => c.id === "us-capital-one-venture-x")!;
    gold.fees[0]!.last_verified = "2026-11-02";
    gold.fees[0]!.effective_to = "2026-01-01";
    gold.earn_rates[0]!.versions[0]!.last_verified = "2026-11-02";
    vx.fees[0]!.last_verified = "2026-01-01";
    vx.fees[0]!.status = "to_verify";
    const result = await planRun(c, { ...options(directory), mode: "reverify" });
    assert.deepEqual(
      result.queue.map((e) => e.source_id),
      [...new Set([gold.fees[0]!.source, gold.earn_rates[0]!.versions[0]!.source])].sort(),
    );
    assert.ok(result.queue.every((e) => e.reason === "reverify"));
    assert.ok(!result.queue.some((e) => e.source_id === vx.fees[0]!.source));
    c.issuers.manual_only = ["amex"];
    const manual = await planRun(c, { ...options(directory), mode: "reverify", maxSources: 0 });
    assert.equal(manual.queue.length, 0);
    assert.equal(manual.deferred, 0);
    assert.equal(manual.manual_due.length, result.queue.length);
  }));

test("plans reject invalid dates, budgets, modes, unknown products and unsafe or forged queue entries", async () =>
  fixture(async (directory) => {
    const c = automated(),
      base = options(directory);
    await assert.rejects(planRun(c, { ...base, asOf: "2026-02-30" }), /Plan requires/);
    await assert.rejects(planRun(c, { ...base, maxSources: -1 }), /Plan requires/);
    await assert.rejects(planRun(c, { ...base, maxSources: 1.5 }), /Plan requires/);
    await assert.rejects(planRun(c, { ...base, changeReports: ["unknown"] }), /Unknown product/);
    await assert.rejects(
      planRun(c, { ...base, mode: "reverify", changeReports: [c.cards[0]!.id] }),
      /only supported/,
    );
    const plan = await planRun(c, base);
    for (const change of [
      (v: typeof plan) => {
        v.queue.push(v.queue[0]!);
      },
      (v: typeof plan) => {
        v.queue[0]!.url = "https://example.invalid/";
      },
      (v: typeof plan) => {
        v.queue[0]!.products = ["unknown"];
      },
      (v: typeof plan) => {
        v.queue[0]!.source_id = "../outside";
      },
      (v: typeof plan) => {
        v.max_sources = 0;
      },
      (v: typeof plan) => {
        v.manual_due.push(v.queue[0]!);
      },
      (v: typeof plan) => {
        v.as_of = "2026-02-30";
      },
    ]) {
      const invalid = structuredClone(plan);
      change(invalid);
      assert.throws(() => validatePlan(c, invalid), /Invalid run plan/);
    }
    assert.throws(() => validatePlan(c, { ...plan, format_version: 2 }), /Invalid run plan/);
    assert.throws(() => validatePlan(c, { ...plan, mode: ["daily"] }), /Invalid run plan/);
    assert.throws(
      () => validatePlan(c, { ...plan, queue: [{ ...plan.queue[0], reason: ["daily"] }] }),
      /Invalid run plan/,
    );
    assert.throws(() => validatePlan(c, { ...plan, extra: true }), /Invalid run plan/);
  }));
