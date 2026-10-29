import { listSources, staleVersions } from "../catalog.js";
import { compare, isDate } from "../primitives.js";
import type { Catalog } from "../types.js";
import type { FetchState } from "../fetch-source.js";
import { object } from "./state.js";

export type RunMode = "daily" | "reverify";
export type Reason = "change_report" | "daily" | "rotation" | "reverify";
export interface Schedule {
  daily: string[];
  rotation_days: number;
}
export interface QueueEntry {
  source_id: string;
  url: string;
  issuer: string;
  products: string[];
  reason: Reason;
  last_checked: string | null;
}
export interface RunPlan {
  format_version: 1;
  mode: RunMode;
  as_of: string;
  max_sources: number;
  queue: QueueEntry[];
  manual_due: QueueEntry[];
  deferred: number;
}
const priorities: Record<Reason, number> = { change_report: 0, daily: 1, rotation: 2, reverify: 0 };
const nonnegative = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
export async function planRun(
  catalog: Catalog,
  options: {
    mode: RunMode;
    asOf: string;
    maxSources: number;
    changeReports?: string[];
    schedule: Schedule;
    readState: (url: string) => Promise<FetchState | undefined>;
  },
): Promise<RunPlan> {
  const { mode, asOf, maxSources, schedule } = options;
  if (!["daily", "reverify"].includes(mode) || !isDate(asOf) || !nonnegative(maxSources))
    throw new Error(
      "Plan requires daily/reverify mode, a valid --as-of date and a non-negative integer --max",
    );
  if (!Number.isSafeInteger(schedule.rotation_days) || schedule.rotation_days < 1)
    throw new Error("Invalid rotation interval");
  const reports = new Set(options.changeReports ?? []);
  if (mode === "reverify" && reports.size) throw new Error("--change-report is only supported in daily mode");
  for (const id of [...reports, ...schedule.daily])
    if (!catalog.cards.some((c) => c.id === id))
      throw new Error("Unknown product in change reports or schedule");
  const stale = new Set(
    mode === "reverify"
      ? staleVersions(catalog, 7, asOf)
          .filter((v) => v.status === "verified")
          .map((v) => v.source)
      : [],
  );
  const due: (QueueEntry & { manual: boolean; checkedAt: number })[] = [];
  for (const source of listSources(catalog)) {
    const state = await options.readState(source.url);
    const lastChecked = state?.checked_at.slice(0, 10) ?? null;
    let reason: Reason;
    if (mode === "reverify") {
      if (!stale.has(source.id)) continue;
      reason = "reverify";
    } else if (source.products.some((id) => reports.has(id))) reason = "change_report";
    else if (source.products.some((id) => schedule.daily.includes(id))) reason = "daily";
    else if (
      lastChecked === null ||
      Date.parse(lastChecked) < Date.parse(asOf) - schedule.rotation_days * 86400000
    )
      reason = "rotation";
    else continue;
    due.push({
      source_id: source.id,
      url: source.url,
      issuer: source.issuer,
      products: [...source.products].sort(compare),
      reason,
      last_checked: lastChecked,
      manual: source.manual_only,
      checkedAt: state ? Date.parse(state.checked_at) : -Infinity,
    });
  }
  due.sort(
    (a, b) =>
      priorities[a.reason] - priorities[b.reason] ||
      a.checkedAt - b.checkedAt ||
      compare(a.source_id, b.source_id),
  );
  const entries = (manual: boolean) =>
    due
      .filter((e) => e.manual === manual)
      .map(({ manual: _manual, checkedAt: _checkedAt, ...entry }) => entry);
  const automatic = entries(false);
  return {
    format_version: 1,
    mode,
    as_of: asOf,
    max_sources: maxSources,
    queue: automatic.slice(0, maxSources),
    manual_due: entries(true),
    deferred: Math.max(0, automatic.length - maxSources),
  };
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every((k) => Object.hasOwn(value, k));
}
export function validatePlan(catalog: Catalog, value: unknown): asserts value is RunPlan {
  const invalid = () => {
    throw new Error("Invalid run plan; regenerate it with plan-run");
  };
  if (
    !object(value) ||
    !exactKeys(value, [
      "format_version",
      "mode",
      "as_of",
      "max_sources",
      "queue",
      "manual_due",
      "deferred",
    ]) ||
    value.format_version !== 1 ||
    typeof value.mode !== "string" ||
    !["daily", "reverify"].includes(value.mode) ||
    typeof value.as_of !== "string" ||
    !isDate(value.as_of) ||
    !nonnegative(value.max_sources) ||
    !nonnegative(value.deferred) ||
    !Array.isArray(value.queue) ||
    !Array.isArray(value.manual_due)
  )
    return invalid();
  if (value.queue.length > value.max_sources) return invalid();
  const sources = listSources(catalog),
    seen = new Set<string>();
  for (const item of [...value.queue, ...value.manual_due]) {
    if (
      !object(item) ||
      !exactKeys(item, ["source_id", "url", "issuer", "products", "reason", "last_checked"]) ||
      typeof item.source_id !== "string"
    )
      return invalid();
    const source = sources.find((s) => s.id === item.source_id);
    if (
      !source ||
      seen.has(source.id) ||
      item.url !== source.url ||
      item.issuer !== source.issuer ||
      !Array.isArray(item.products) ||
      JSON.stringify(item.products) !== JSON.stringify([...source.products].sort(compare)) ||
      !(item.last_checked === null || (typeof item.last_checked === "string" && isDate(item.last_checked))) ||
      !(value.mode === "reverify"
        ? item.reason === "reverify"
        : typeof item.reason === "string" && ["change_report", "daily", "rotation"].includes(item.reason))
    )
      return invalid();
    seen.add(source.id);
  }
}
