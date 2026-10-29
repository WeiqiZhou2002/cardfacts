import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { loadCatalog } from "../scripts/lib/catalog.js";
import { externalStateDirectory, fetchSource, type SourceTransport } from "../scripts/lib/fetch-source.js";

const catalog = await loadCatalog(resolve(import.meta.dirname, ".."));
const sourceId = "chase-csr-page";
const text = "Public issuer terms. ".repeat(20);
const goodTransport: SourceTransport = {
  robots: async () => ({ status: 200, text: "User-agent: *\nAllow: /" }),
  render: async (url, _ua, permitted) => {
    assert.equal(await permitted("https://evil.example/steal"), false);
    assert.equal(await permitted(url), true);
    return { status: 200, url, text };
  },
};
const automated = () => {
  const c = structuredClone(catalog);
  c.issuers.manual_only = [];
  return c;
};

test("manual_only refuses network and creates no state; unknown ids fail", async () => {
  const stateDir = join(catalog.root, "must-not-be-created");
  const transport: SourceTransport = {
    robots: async () => {
      throw new Error("should not fetch");
    },
    render: async () => {
      throw new Error("should not render");
    },
  };
  assert.equal((await fetchSource(catalog, sourceId, { stateDir, transport })).status, "manual_only");
  await assert.rejects(readdir(stateDir), /ENOENT/);
  await assert.rejects(fetchSource(catalog, "unknown", { stateDir, transport }), /Unknown source/);
});

test("external state rejects repository paths and symlink aliases", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cardfacts-path-"));
  try {
    await assert.rejects(externalStateDirectory(catalog.root, join(catalog.root, "state")), /outside/);
    await symlink(catalog.root, join(directory, "alias"));
    await assert.rejects(externalStateDirectory(catalog.root, join(directory, "alias", "state")), /outside/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fetch saves normalized text, deduplicates daily, keeps prior hash and success on failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cardfacts-fetch-"));
  let day = "2026-10-28";
  let body = text;
  let calls = 0;
  const transport: SourceTransport = {
    ...goodTransport,
    render: async (url) => {
      calls++;
      return { status: 200, url, text: body };
    },
  };
  const options = { stateDir: directory, now: () => new Date(`${day}T12:00:00Z`), transport };
  try {
    const first = await fetchSource(automated(), sourceId, options);
    assert.equal(first.status, "changed");
    assert.ok("last_success" in first && first.last_success);
    assert.equal(await readFile(join(directory, first.last_success.text_file), "utf8"), text.trim());
    const cached = await fetchSource(automated(), sourceId, options);
    assert.ok("cached" in cached && cached.cached);
    assert.equal(calls, 1);
    day = "2026-10-29";
    body = text.replaceAll(" ", "\n  ");
    const unchanged = await fetchSource(automated(), sourceId, options);
    assert.equal(unchanged.status, "unchanged");
    day = "2026-10-30";
    body = text + "Terms updated.";
    const changed = await fetchSource(automated(), sourceId, options);
    assert.ok("last_success" in changed && changed.last_success);
    assert.equal(changed.previous_hash, first.last_success.hash);
    assert.notEqual(changed.last_success.hash, first.last_success.hash);
    body = "Verify you are human CAPTCHA " + text;
    for (const date of ["2026-10-31", "2026-11-01", "2026-11-02"]) {
      day = date;
      const failed = await fetchSource(automated(), sourceId, options);
      assert.equal(failed.status, "failed");
      assert.ok("last_success" in failed);
      assert.equal(failed.last_success?.hash, changed.last_success.hash);
      if (date === "2026-11-02") assert.equal(failed.consecutive_failures, 3);
    }
    await fetchSource(automated(), sourceId, options);
    assert.equal(calls, 6);
    day = "2026-11-03";
    body = text;
    const recovered = await fetchSource(automated(), sourceId, options);
    assert.ok("consecutive_failures" in recovered && recovered.consecutive_failures === 0);
    assert.ok(!(await readdir(directory)).includes(".fetch-lock"));
    const log = (await readdir(directory)).find((name) => name.endsWith(".checks.jsonl"))!;
    assert.equal((await readFile(join(directory, log), "utf8")).trim().split("\n").length, 7);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("robots, HTTP, redirected domains and empty render fail without false success", async (t) => {
  const cases: [string, SourceTransport, RegExp][] = [
    [
      "robots deny",
      { ...goodTransport, robots: async () => ({ status: 200, text: "User-agent: *\nDisallow: /" }) },
      /disallows/,
    ],
    [
      "robots unavailable",
      { ...goodTransport, robots: async () => ({ status: 503, text: "" }) },
      /robots.txt unavailable/,
    ],
    ["HTTP error", { ...goodTransport, render: async (url) => ({ status: 403, url, text }) }, /HTTP 403/],
    [
      "empty body",
      { ...goodTransport, render: async (url) => ({ status: 200, url, text: "" }) },
      /too short/,
    ],
    [
      "redirect escape",
      { ...goodTransport, render: async () => ({ status: 200, url: "https://attacker.example", text }) },
      /Redirect target/,
    ],
    [
      "transport failure",
      {
        ...goodTransport,
        render: async () => {
          throw new Error("SECRET_TOKEN");
        },
      },
      /Transport or browser failed/,
    ],
  ];
  for (const [name, transport, message] of cases)
    await t.test(name, async () => {
      const directory = await mkdtemp(join(tmpdir(), "cardfacts-failure-"));
      try {
        const result = await fetchSource(automated(), sourceId, { stateDir: directory, transport });
        assert.equal(result.status, "failed");
        assert.ok("error" in result);
        assert.match(result.error!, message);
        assert.equal(result.last_success, null);
        assert.equal(result.consecutive_failures, 1);
        assert.ok(!(await readdir(directory)).some((p) => p.endsWith(".txt")));
        assert.ok(!JSON.stringify(result).includes("SECRET_TOKEN"));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
});

test("issuer throttle applies across different sources", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cardfacts-throttle-"));
  const c = automated();
  const card = c.cards.find((c) => c.id === "us-chase-sapphire-reserve")!;
  card.sources.push({ ...card.sources[0]!, id: "chase-second", url: "https://creditcards.chase.com/second" });
  const waits: number[] = [];
  const options = {
    stateDir: directory,
    transport: goodTransport,
    now: () => new Date("2026-10-28T12:00:00Z"),
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
  try {
    await fetchSource(c, sourceId, options);
    await fetchSource(c, "chase-second", options);
    assert.deepEqual(waits, [10_000]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("longer robots crawl-delay is honored between source checks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cardfacts-delay-"));
  const c = automated();
  const card = c.cards.find((c) => c.id === "us-chase-sapphire-reserve")!;
  card.sources.push({ ...card.sources[0]!, id: "chase-second", url: "https://creditcards.chase.com/second" });
  const waits: number[] = [];
  const transport = {
    ...goodTransport,
    robots: async () => ({ status: 200, text: "User-agent: *\nAllow: /\nCrawl-delay: 30" }),
  };
  const options = {
    stateDir: directory,
    transport,
    now: () => new Date("2026-10-28T12:00:00Z"),
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
  try {
    await fetchSource(c, sourceId, options);
    await fetchSource(c, "chase-second", options);
    assert.deepEqual(waits, [10_000, 20_000]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
