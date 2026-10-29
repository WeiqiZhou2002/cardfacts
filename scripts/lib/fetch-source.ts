import { appendFile, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import robotsParserModule from "robots-parser";
import { allowedUrl, listSources, sha256 } from "./catalog.js";
import type { Catalog, Issuer } from "./types.js";

const robotsParser = robotsParserModule.default ?? robotsParserModule;

export interface FetchState {
  source_id: string;
  url: string;
  checked_at: string;
  status: "changed" | "unchanged" | "failed";
  previous_hash: string | null;
  last_success: { hash: string; checked_at: string; text_file: string } | null;
  consecutive_failures: number;
  error?: string;
}
export type FetchResult =
  (FetchState & { cached: boolean }) | { source_id: string; status: "manual_only"; reason: string };
export interface SourceTransport {
  robots(url: string, userAgent: string): Promise<{ status: number; text: string }>;
  render(
    url: string,
    userAgent: string,
    permitted: (url: string) => Promise<boolean>,
  ): Promise<{ status: number; url: string; text: string }>;
}

export const normalizePage = (text: string) => text.normalize("NFKC").replace(/\s+/gu, " ").trim();
export const browserTransport: SourceTransport = {
  async robots(url, userAgent) {
    const response = await fetch(url, {
      headers: { "User-Agent": userAgent },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    if (text.length > 512_000) throw new Error("robots response too large");
    return { status: response.status, text };
  },
  async render(url, userAgent, permitted) {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        userAgent,
        serviceWorkers: "block",
        acceptDownloads: false,
      });
      let policyFailure: unknown;
      await context.route("**/*", async (route) => {
        try {
          const request = route.request();
          if (
            !["GET", "HEAD"].includes(request.method()) ||
            ["image", "media", "font"].includes(request.resourceType()) ||
            !(await permitted(request.url()))
          )
            await route.abort();
          else await route.continue();
        } catch (error) {
          policyFailure = error;
          await route.abort();
        }
      });
      await context.routeWebSocket(/.*/, (socket) => socket.close());
      const page = await context.newPage();
      const response = await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
      if (policyFailure) throw policyFailure;
      if (!response) throw new Error("no navigation response");
      return {
        status: response.status(),
        url: page.url(),
        text: await page.locator("body").innerText({ timeout: 10_000 }),
      };
    } finally {
      await browser.close();
    }
  },
};

async function readState<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("Cannot read maintenance state; repair it before fetching", { cause: e });
  }
}
async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, path);
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
function safeFailure(error: unknown): string {
  // Never echo arbitrary browser error text: URLs may contain query credentials.
  if (error instanceof FetchFailure) return error.message;
  return "Transport or browser failed; inspect the local environment and browser installation";
}
class FetchFailure extends Error {}

export async function fetchSource(
  catalog: Catalog,
  sourceId: string,
  options: {
    stateDir: string;
    now?: () => Date;
    sleep?: (milliseconds: number) => Promise<unknown>;
    transport?: SourceTransport;
  },
): Promise<FetchResult> {
  const source = listSources(catalog).find((s) => s.id === sourceId);
  if (!source) throw new Error(`Unknown source id: ${sourceId}`);
  const issuer = catalog.issuers.issuers.find((i) => i.id === source.issuer)!;
  if (source.manual_only)
    return { source_id: sourceId, status: "manual_only", reason: issuer.automation_review };
  if (!allowedUrl(source.url, issuer)) throw new Error("Source is outside issuer domain policy");
  const stateDir = await externalStateDirectory(catalog.root, options.stateDir);
  const lock = join(stateDir, ".fetch-lock");
  try {
    await mkdir(lock);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        "Another fetch holds .fetch-lock; remove a stale lock only after confirming no fetch is running",
      );
    throw e;
  }
  try {
    return await fetchLocked(catalog, issuer, sourceId, source.url, stateDir, options);
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

async function fetchLocked(
  catalog: Catalog,
  issuer: Issuer,
  sourceId: string,
  url: string,
  stateDir: string,
  options: {
    now?: () => Date;
    sleep?: (milliseconds: number) => Promise<unknown>;
    transport?: SourceTransport;
  },
): Promise<FetchState & { cached: boolean }> {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? delay;
  const transport = options.transport ?? browserTransport;
  const key = sha256(url);
  const statePath = join(stateDir, `${key}.json`);
  const previous = await readState<FetchState>(statePath);
  let checkedAt = now().toISOString();
  // Failed attempts are also cached: a retry loop must not hammer a blocked source.
  if (previous?.checked_at.slice(0, 10) === checkedAt.slice(0, 10))
    return { ...previous, source_id: sourceId, cached: true };
  const throttlePath = join(stateDir, `issuer-${issuer.id}.json`);
  const throttle = await readState<{ requested_at: string }>(throttlePath);
  const wait = throttle ? 10_000 - (now().getTime() - Date.parse(throttle.requested_at)) : 0;
  if (wait > 0) await sleep(wait);
  checkedAt = now().toISOString();
  await atomicJson(throttlePath, { requested_at: now().toISOString() });
  const robots = new Map<string, Promise<ReturnType<typeof robotsParser>>>();
  const permitted = async (candidate: string): Promise<boolean> => {
    if (!allowedUrl(candidate, issuer)) return false;
    const origin = new URL(candidate).origin;
    if (!robots.has(origin))
      robots.set(
        origin,
        (async () => {
          const robotsUrl = `${origin}/robots.txt`;
          const result = await transport.robots(robotsUrl, catalog.issuers.user_agent);
          if (result.status !== 404 && (result.status < 200 || result.status >= 300))
            throw new FetchFailure(`robots.txt unavailable (HTTP ${result.status})`);
          return robotsParser(robotsUrl, result.status === 404 ? "" : result.text);
        })(),
      );
    const parser = await robots.get(origin)!;
    return parser.isAllowed(candidate, catalog.issuers.user_agent) !== false;
  };
  let result: FetchState;
  try {
    if (!(await permitted(url))) throw new FetchFailure("robots.txt disallows this source");
    const parser = await robots.get(new URL(url).origin)!;
    const crawlDelay = parser.getCrawlDelay(catalog.issuers.user_agent) ?? 0;
    if (throttle && crawlDelay > 10) {
      const elapsed = Math.max(now().getTime() - Date.parse(throttle.requested_at), 10_000);
      if (crawlDelay * 1000 > elapsed) await sleep(crawlDelay * 1000 - elapsed);
      checkedAt = now().toISOString();
      await atomicJson(throttlePath, { requested_at: checkedAt });
    }
    const rendered = await transport.render(url, catalog.issuers.user_agent, permitted);
    if (!(await permitted(rendered.url)))
      throw new FetchFailure("Redirect target is outside issuer/robots policy");
    if (rendered.status < 200 || rendered.status >= 300)
      throw new FetchFailure(`Source returned HTTP ${rendered.status}`);
    const text = normalizePage(rendered.text);
    if (text.length < 80) throw new FetchFailure("Rendered page is empty or too short to verify");
    if (text.length > 5_000_000) throw new FetchFailure("Rendered page exceeds size limit");
    if (
      /captcha|verify (?:that )?you are human|access denied|unusual traffic|checking your browser|just a moment/i.test(
        text,
      )
    )
      throw new FetchFailure("Bot check or CAPTCHA detected; manual review required");
    const hash = sha256(text);
    const textFile = `${key}-${hash}.txt`;
    await writeFile(join(stateDir, textFile), text, { mode: 0o600 });
    result = {
      source_id: sourceId,
      url,
      checked_at: checkedAt,
      status: previous?.last_success?.hash === hash ? "unchanged" : "changed",
      previous_hash: previous?.last_success?.hash ?? null,
      last_success: { hash, checked_at: checkedAt, text_file: textFile },
      consecutive_failures: 0,
    };
  } catch (error) {
    result = {
      source_id: sourceId,
      url,
      checked_at: checkedAt,
      status: "failed",
      previous_hash: previous?.last_success?.hash ?? null,
      last_success: previous?.last_success ?? null,
      consecutive_failures: (previous?.consecutive_failures ?? 0) + 1,
      error: safeFailure(error),
    };
  }
  await atomicJson(statePath, result);
  await appendFile(join(stateDir, `${key}.checks.jsonl`), JSON.stringify(result) + "\n", { mode: 0o600 });
  return { ...result, cached: false };
}
