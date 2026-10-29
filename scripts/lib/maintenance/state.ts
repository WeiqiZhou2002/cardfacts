import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { sha256 } from "../catalog.js";
import { isDate } from "../primitives.js";
import type { FetchState } from "../fetch-source.js";

export class MaintenanceStateError extends Error {}
export async function readState<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new MaintenanceStateError("Cannot read maintenance state; repair it before checking", { cause: e });
  }
}
export async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    throw new MaintenanceStateError("Cannot write maintenance state", { cause: error });
  }
}
async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return join(await canonicalPath(dirname(path)), basename(path));
  }
}
export async function externalStateDirectory(root: string, requested: string) {
  const repo = await realpath(root);
  const state = await canonicalPath(resolve(requested));
  const path = relative(repo, state);
  if (!path || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path)))
    throw new Error("CARDFACTS_STATE_DIR must be outside the repository (including symlinks)");
  await mkdir(state, { recursive: true, mode: 0o700 });
  return state;
}

export const hashValue = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function utcTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    isDate(value.slice(0, 10)) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === (value.includes(".") ? value : value.replace("Z", ".000Z"))
  );
}
export const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export async function readFetchState(directory: string, url: string): Promise<FetchState | undefined> {
  const value = await readState<unknown>(join(directory, `${sha256(url)}.json`));
  if (value === undefined) return undefined;
  if (
    !object(value) ||
    typeof value.source_id !== "string" ||
    !value.source_id ||
    value.url !== url ||
    !utcTime(value.checked_at) ||
    typeof value.status !== "string" ||
    !["changed", "unchanged", "failed"].includes(value.status) ||
    !(value.previous_hash === null || hashValue(value.previous_hash)) ||
    !Number.isSafeInteger(value.consecutive_failures) ||
    Number(value.consecutive_failures) < 0 ||
    !(value.error === undefined || typeof value.error === "string")
  )
    throw new Error("Invalid source state; repair it before checking");
  const success = value.last_success;
  if (
    success !== null &&
    (!object(success) ||
      !hashValue(success.hash) ||
      !utcTime(success.checked_at) ||
      Date.parse(success.checked_at) > Date.parse(value.checked_at) ||
      success.text_file !== `${sha256(url)}-${success.hash}.txt`)
  )
    throw new Error("Invalid successful snapshot in source state");
  if (
    (value.status !== "failed" && (success === null || value.consecutive_failures !== 0)) ||
    (value.status === "failed" && Number(value.consecutive_failures) < 1)
  )
    throw new Error("Invalid failure count or missing successful snapshot in source state");
  return value as unknown as FetchState;
}
export async function readIssuerState(directory: string, issuer: string) {
  const value = await readState<unknown>(join(directory, `issuer-${issuer}.json`));
  if (value === undefined) return undefined;
  if (!object(value) || !utcTime(value.requested_at)) throw new Error("Invalid issuer throttle state");
  return { requested_at: value.requested_at };
}
// M1 reads the baseline identity/hash only. Confirming or writing baselines belongs to M2.
export async function readConfirmedHash(directory: string, source: { id: string; url: string }) {
  const value = await readState<unknown>(join(directory, "confirmed", `${sha256(source.url)}.json`));
  if (value === undefined) return null;
  if (
    !object(value) ||
    value.format_version !== 1 ||
    value.source_id !== source.id ||
    value.url !== source.url ||
    !hashValue(value.hash)
  )
    throw new Error("Invalid confirmed-source baseline");
  return value.hash;
}
