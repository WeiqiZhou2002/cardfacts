import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { listSources, loadCatalog, sha256 } from "../scripts/lib/catalog.js";
import { fetchSource, type SourceTransport } from "../scripts/lib/fetch-source.js";
import { runChecks } from "../scripts/lib/maintenance/checks.js";
import { planRun } from "../scripts/lib/maintenance/queue.js";
import type { RunPlan } from "../scripts/lib/maintenance/queue.js";
import { atomicJson, readConfirmedHash, readFetchState } from "../scripts/lib/maintenance/state.js";

const root = resolve(import.meta.dirname, ".."),
  catalog = await loadCatalog(root);
const automated = () => {
  const c = structuredClone(catalog);
  c.issuers.manual_only = [];
  return c;
};
const sourceId = "chase-csr-page",
  source = listSources(catalog).find((s) => s.id === sourceId)!,
  key = sha256(source.url);
const pageText = "Controlled public source fixture for maintenance tests. ".repeat(5);
const transport: SourceTransport = {
  robots: async () => ({ status: 200, text: "User-agent: *\nAllow: /" }),
  render: async (url) => ({ status: 200, url, text: pageText }),
};
async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "cardfacts-checks-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
async function plan(directory: string) {
  const result = await planRun(automated(), {
    mode: "daily",
    asOf: "2026-11-02",
    maxSources: 25,
    schedule: { daily: [], rotation_days: 7 },
    readState: (url) => readFetchState(directory, url),
  });
  result.queue = result.queue.filter((e) => e.source_id === sourceId);
  result.deferred = 0;
  return result;
}
async function baseline(directory: string, hash: string) {
  await mkdir(join(directory, "confirmed"), { recursive: true });
  await atomicJson(join(directory, "confirmed", `${key}.json`), {
    format_version: 1,
    source_id: sourceId,
    url: source.url,
    hash,
  });
}

test("checks use the confirmed baseline even when a new day's page is unchanged; same-day cache remains visible", async () =>
  fixture(async (directory) => {
    const c = automated(),
      p = await plan(directory);
    let time = "2026-11-02T06:15:00Z",
      body = pageText,
      calls = 0;
    const now = () => new Date(time);
    const check = (id: string) =>
      fetchSource(c, id, {
        stateDir: directory,
        now,
        transport: {
          ...transport,
          render: async (url) => {
            calls++;
            return { status: 200, url, text: body };
          },
        },
      });
    const options = { stateDir: directory, now, check };
    const first = await runChecks(c, p, options);
    assert.equal(first.run_id, "20261102T061500Z-daily");
    assert.equal(first.cardfacts_mode, "report-only");
    assert.equal(first.results[0]!.status, "changed");
    assert.equal(first.results[0]!.confirmed_hash, null);
    assert.deepEqual(first.needs_review, [sourceId]);
    assert.equal(first.results[0]!.cached, false);
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, "runs", `${first.run_id}.json`), "utf8")),
      first,
    );
    time = "2026-11-02T06:15:01Z";
    const cached = await runChecks(c, p, options);
    assert.equal(cached.results[0]!.cached, true);
    assert.equal(calls, 1);
    assert.deepEqual(cached.needs_review, [sourceId]);
    time = "2026-11-03T06:15:00Z";
    const unchanged = await runChecks(c, p, options);
    assert.equal(unchanged.results[0]!.status, "unchanged");
    assert.deepEqual(unchanged.needs_review, [sourceId]);
    const hash = first.results[0]!.hash!;
    await baseline(directory, hash);
    time = "2026-11-03T06:15:01Z";
    const confirmed = await runChecks(c, p, { ...options, cardfactsMode: "pr" });
    assert.equal(confirmed.cardfacts_mode, "pr");
    assert.deepEqual(confirmed.needs_review, []);
    assert.equal(confirmed.results[0]!.confirmed_hash, hash);
    time = "2026-11-04T06:15:00Z";
    body = pageText + "New terms.";
    const changed = await runChecks(c, p, options);
    assert.equal(changed.results[0]!.previous_hash, hash);
    assert.deepEqual(changed.needs_review, [sourceId]);
    time = "2026-11-05T06:15:00Z";
    const pending = await runChecks(c, p, options);
    assert.equal(pending.results[0]!.status, "unchanged");
    assert.deepEqual(pending.needs_review, [sourceId]);
    assert.equal(await readConfirmedHash(directory, source), hash);
    assert.ok(!(await readdir(directory)).includes(".run-checks-lock"));
    assert.ok(!(await readdir(join(directory, "runs"))).some((f) => f.endsWith(".tmp")));
  }));

test("source failures are successful batch results, preserve last success and count unreachable sources without incrementing cache hits", async () =>
  fixture(async (directory) => {
    const c = automated(),
      p = await plan(directory);
    let time = "2026-11-02T06:15:00Z",
      fail = false;
    const now = () => new Date(time);
    const check = (id: string) =>
      fetchSource(c, id, {
        stateDir: directory,
        now,
        transport: {
          ...transport,
          render: async (url) => ({ status: fail ? 503 : 200, url, text: pageText }),
        },
      });
    const options = { stateDir: directory, now, check };
    const good = await runChecks(c, p, options);
    await baseline(directory, good.results[0]!.hash!);
    fail = true;
    for (const day of [3, 4, 5]) {
      time = `2026-11-0${day}T06:15:00Z`;
      const failed = await runChecks(c, p, options);
      assert.equal(failed.results[0]!.status, "failed");
      assert.equal(failed.results[0]!.consecutive_failures, day - 2);
      assert.equal(failed.results[0]!.hash, good.results[0]!.hash);
      assert.equal(failed.results[0]!.needs_review, false);
      assert.match(failed.results[0]!.error!, /HTTP 503/);
      assert.deepEqual(
        failed.unreachable,
        day === 5 ? [{ source_id: sourceId, consecutive_failures: 3 }] : [],
      );
    }
    time = "2026-11-05T06:15:01Z";
    const cached = await runChecks(c, p, options);
    assert.equal(cached.results[0]!.cached, true);
    assert.equal(cached.results[0]!.consecutive_failures, 3);
    time = "2026-11-06T06:15:00Z";
    fail = false;
    const recovered = await runChecks(c, p, options);
    assert.equal(recovered.results[0]!.consecutive_failures, 0);
    assert.deepEqual(recovered.unreachable, []);
    assert.deepEqual(recovered.needs_review, []);
  }));

test("batch execution is sequential and leaves issuer rate limiting in the fetcher", async () =>
  fixture(async (directory) => {
    const c = automated();
    let millis = Date.parse("2026-11-02T06:15:00Z");
    const now = () => new Date(millis),
      waits: number[] = [],
      order: string[] = [];
    const p = await plan(directory),
      second = listSources(c).find((s) => s.issuer === "chase" && s.id !== sourceId)!;
    p.queue.push({
      source_id: second.id,
      url: second.url,
      issuer: second.issuer,
      products: second.products,
      reason: "rotation",
      last_checked: null,
    });
    let active = false;
    const report = await runChecks(c, p, {
      stateDir: directory,
      now,
      check: async (id) => {
        assert.equal(active, false);
        active = true;
        order.push(id);
        const result = await fetchSource(c, id, {
          stateDir: directory,
          now,
          transport,
          sleep: async (ms) => {
            waits.push(ms);
            millis += ms;
          },
        });
        active = false;
        return result;
      },
    });
    assert.deepEqual(
      order,
      p.queue.map((e) => e.source_id),
    );
    assert.deepEqual(waits, [10000]);
    assert.deepEqual(
      report.results.map((e) => e.source_id),
      order,
    );
    assert.equal(report.finished_at, "2026-11-02T06:15:10.000Z");
  }));

test("execution rechecks manual policy and never calls the fetch callback for manual-only sources", async () =>
  fixture(async (directory) => {
    const p = await plan(directory);
    p.deferred = 4;
    const report = await runChecks(catalog, p, {
      stateDir: directory,
      check: async () => {
        throw new Error("must not fetch");
      },
    });
    assert.deepEqual(report.results, []);
    assert.deepEqual(report.manual_due, p.queue);
    assert.equal(report.deferred, 4);
    assert.ok(!(await readdir(directory)).some((f) => f.endsWith(".txt")));
  }));

test("corrupt state, locks, run-ID collisions and tool errors stop the batch without turning into source failures", async () =>
  fixture(async (directory) => {
    const c = automated(),
      p = await plan(directory);
    let calls = 0;
    const options = {
      stateDir: directory,
      now: () => new Date("2026-11-02T06:15:00Z"),
      check: async () => {
        calls++;
        throw new Error("injected tool error");
      },
    };
    for (const content of ["{broken", JSON.stringify({ checked_at: "2026-11-01" }), "null"]) {
      await writeFile(join(directory, `${key}.json`), content);
      await assert.rejects(runChecks(c, p, options), /state/);
      assert.equal(calls, 0);
    }
    await rm(join(directory, `${key}.json`));
    await mkdir(join(directory, "confirmed"));
    await writeFile(join(directory, "confirmed", `${key}.json`), "{}");
    await assert.rejects(runChecks(c, p, options), /baseline/);
    await rm(join(directory, "confirmed"), { recursive: true });
    await atomicJson(join(directory, "issuer-chase.json"), { requested_at: "not a date" });
    await assert.rejects(runChecks(c, p, options), /throttle/);
    await rm(join(directory, "issuer-chase.json"));
    await mkdir(join(directory, ".run-checks-lock"));
    await assert.rejects(runChecks(c, p, options), /lock/);
    await rm(join(directory, ".run-checks-lock"), { recursive: true });
    await mkdir(join(directory, ".fetch-lock"));
    await assert.rejects(
      runChecks(c, p, { ...options, check: (id) => fetchSource(c, id, { stateDir: directory, transport }) }),
      /fetch-lock/,
    );
    await rm(join(directory, ".fetch-lock"), { recursive: true });
    await assert.rejects(runChecks(c, p, options), /injected tool error/);
    assert.equal(calls, 1);
    assert.deepEqual(await readdir(join(directory, "runs")), []);
    const actual = await runChecks(catalog, p, { ...options, check: options.check });
    await assert.rejects(runChecks(catalog, p, options), /Run ID already exists/);
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, "runs", `${actual.run_id}.json`), "utf8")),
      actual,
    );
    assert.equal(calls, 1);
  }));

test("state persistence failures are tool errors, not successful fetch attempts", async () =>
  fixture(async (directory) => {
    const c = automated(),
      p = await plan(directory),
      hash = sha256(pageText.trim());
    await mkdir(join(directory, `${key}-${hash}.txt`));
    await assert.rejects(
      runChecks(c, p, {
        stateDir: directory,
        check: (id) => fetchSource(c, id, { stateDir: directory, transport }),
      }),
      /EISDIR/,
    );
    assert.equal(await readFetchState(directory, source.url), undefined);
    assert.deepEqual(await readdir(join(directory, "runs")), []);
  }));

function cli(directory: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", join(root, "scripts/cli.ts"), ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      CARDFACTS_STATE_DIR: directory,
      CARDFACTS_MAX_SOURCES: "25",
      CARDFACTS_MODE: "report-only",
      ...env,
    },
  });
}
test("maintenance CLI accepts both product-list forms, prints JSON, enforces option/empty-value checks and persists a manual-only report", async () =>
  fixture(async (directory) => {
    const args = ["plan-run", "--mode", "daily", "--as-of", "2026-11-02", "--json"];
    const run = cli(directory, [...args, "--change-report", "us-amex-gold", "us-capital-one-venture-x"]);
    assert.equal(run.status, 0, run.stderr);
    const p = JSON.parse(run.stdout) as RunPlan;
    assert.equal(p.queue.length, 0);
    assert.equal(p.manual_due.length, listSources(catalog).length);
    assert.equal(p.max_sources, 25);
    assert.equal(p.deferred, 0);
    const repeated = cli(directory, [
      ...args,
      "--change-report",
      "us-amex-gold",
      "--change-report",
      "us-capital-one-venture-x",
    ]);
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.deepEqual(JSON.parse(repeated.stdout), p);
    assert.equal(JSON.parse(cli(directory, args, { CARDFACTS_MAX_SOURCES: "2" }).stdout).max_sources, 2);
    assert.equal(
      JSON.parse(cli(directory, [...args, "--max", "0"], { CARDFACTS_MAX_SOURCES: "2" }).stdout).max_sources,
      0,
    );
    const path = join(directory, "input-plan.json");
    await atomicJson(path, p);
    const result = cli(directory, ["run-checks", "--plan", path, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.results, []);
    assert.deepEqual(report.manual_due, p.manual_due);
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, "runs", `${report.run_id}.json`), "utf8")),
      report,
    );
    for (const bad of [
      ["plan-run"],
      ["run-checks"],
      [...args, "--max", ""],
      [...args, "--max", "-1"],
      [...args, "--max", "1.5"],
      [...args, "--max", "Infinity"],
      [...args, "--change-report", ""],
      [...args, "--change-report", "unknown"],
      [...args, "unexpected"],
      [...args, "--days", "7"],
      ["plan-run", "--mode", "daily", "--as-of", "2026-02-30"],
      ["run-checks", "--plan", ""],
      ["run-checks", "--plan", path, "--max", "1"],
    ]) {
      const error = cli(directory, bad);
      assert.equal(error.status, 1, bad.join(" "));
      assert.equal(error.stdout, "");
    }
    for (const [name, value] of [
      ["CARDFACTS_MODE", "PRIVATE_ENV_VALUE"],
      ["CARDFACTS_STATE_DIR", ""],
      ["CARDFACTS_MAX_SOURCES", "PRIVATE_ENV_VALUE"],
    ]) {
      const error = cli(directory, name === "CARDFACTS_MAX_SOURCES" ? args : ["run-checks", "--plan", path], {
        [name!]: value!,
      });
      assert.equal(error.status, 1);
      assert.ok(!error.stderr.includes("PRIVATE_ENV_VALUE"));
    }
    await writeFile(path, '{"format_version":1}');
    assert.equal(cli(directory, ["run-checks", "--plan", path]).status, 1);
  }));
