import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { listSources } from "../catalog.js";
import type { Catalog } from "../types.js";
import type { FetchResult } from "../fetch-source.js";
import {
  atomicJson,
  externalStateDirectory,
  readConfirmedHash,
  readFetchState,
  readIssuerState,
  readState,
} from "./state.js";
import { validatePlan } from "./queue.js";
import type { RunPlan } from "./queue.js";

export interface CheckResult {
  source_id: string;
  products: string[];
  status: "changed" | "unchanged" | "failed";
  cached: boolean;
  hash: string | null;
  previous_hash: string | null;
  confirmed_hash: string | null;
  needs_review: boolean;
  consecutive_failures: number;
  error: string | null;
}
export async function runChecks(
  catalog: Catalog,
  plan: RunPlan,
  options: {
    stateDir: string;
    check: (sourceId: string) => Promise<FetchResult>;
    now?: () => Date;
    cardfactsMode?: "report-only" | "pr";
  },
) {
  validatePlan(catalog, plan);
  const cardfactsMode = options.cardfactsMode ?? "report-only";
  if (!["report-only", "pr"].includes(cardfactsMode))
    throw new Error("Invalid CARDFACTS_MODE; expected report-only or pr");
  const now = options.now ?? (() => new Date());
  const started = now().toISOString();
  const runId = `${started.slice(0, 19).replaceAll(/[-:]/g, "")}Z-${plan.mode}`;
  const directory = await externalStateDirectory(catalog.root, options.stateDir);
  const lock = join(directory, ".run-checks-lock");
  try {
    await mkdir(lock);
  } catch {
    throw new Error("Cannot acquire .run-checks-lock; another batch may be running");
  }
  try {
    const runs = await externalStateDirectory(catalog.root, join(directory, "runs"));
    const path = join(runs, `${runId}.json`);
    if ((await readState(path)) !== undefined)
      throw new Error("Run ID already exists; retry in a later UTC second");
    const sources = listSources(catalog);
    const baselines = new Map<string, string | null>();
    // Preflight all state before any checks, so corruption never becomes a source failure.
    for (const entry of plan.queue) {
      await readFetchState(directory, entry.url);
      await readIssuerState(directory, entry.issuer);
      baselines.set(
        entry.source_id,
        await readConfirmedHash(directory, { id: entry.source_id, url: entry.url }),
      );
    }
    const results: CheckResult[] = [],
      manualDue = [...plan.manual_due];
    for (const entry of plan.queue) {
      if (sources.find((s) => s.id === entry.source_id)!.manual_only) {
        manualDue.push(entry);
        continue;
      }
      const result = await options.check(entry.source_id);
      if (result.status === "manual_only") {
        manualDue.push(entry);
        continue;
      }
      const confirmed = baselines.get(entry.source_id)!;
      const hash = result.last_success?.hash ?? null;
      results.push({
        source_id: entry.source_id,
        products: entry.products,
        status: result.status,
        cached: result.cached,
        hash,
        previous_hash: result.previous_hash,
        confirmed_hash: confirmed,
        needs_review: result.status !== "failed" && hash !== null && hash !== confirmed,
        consecutive_failures: result.consecutive_failures,
        error: result.error ?? null,
      });
    }
    const report = {
      format_version: 1 as const,
      run_id: runId,
      mode: plan.mode,
      cardfacts_mode: cardfactsMode,
      started_at: started,
      finished_at: now().toISOString(),
      results,
      needs_review: results.filter((r) => r.needs_review).map((r) => r.source_id),
      unreachable: results
        .filter((r) => r.status === "failed" && r.consecutive_failures >= 3)
        .map((r) => ({ source_id: r.source_id, consecutive_failures: r.consecutive_failures })),
      manual_due: manualDue,
      deferred: plan.deferred,
    };
    await atomicJson(path, report);
    return report;
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
