import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { apiContext, handle, serialize, staticPaths, writeStaticApi } from "../scripts/lib/api.js";
import { apiServer } from "../scripts/lib/api-server.js";

const ctx = await apiContext(resolve(import.meta.dirname, ".."));
type Body = { data: Record<string, unknown> & { cards: { id: string }[]; count: number } };
const get = (path: string, query = "") => handle(ctx, path, new URLSearchParams(query));
const ids = (path: string, query = "") => (get(path, query).body as Body).data.cards.map((c) => c.id);

test("static files cover every parameter-free resource and their links resolve", async () => {
  const out = await mkdtemp(join(tmpdir(), "cardfacts-api-"));
  try {
    const paths = await writeStaticApi(ctx, out);
    assert.equal(paths.length, staticPaths(ctx).length);
    assert.ok(paths.length > 150);
    const cards = JSON.parse(await readFile(join(out, "cards.json"), "utf8"));
    assert.equal(cards.api_version, 1);
    assert.equal(cards.license, "CC0-1.0");
    assert.equal(cards.data.count, 30);
    for (const card of cards.data.cards)
      for (const link of [card.links.self, card.links.terms, card.links.history])
        await assert.doesNotReject(readFile(join(out, link)), link);
    const history = JSON.parse(
      await readFile(join(out, "cards/us-capital-one-venture-x/history.json"), "utf8"),
    );
    for (const r of history.data.revisions) await assert.doesNotReject(readFile(join(out, r.links.self)));
    const categories = JSON.parse(await readFile(join(out, "categories.json"), "utf8"));
    for (const c of [...categories.data.earn, ...categories.data.credits])
      await assert.doesNotReject(readFile(join(out, c.links.self)));
    const openapi = JSON.parse(await readFile(join(out, "openapi.json"), "utf8"));
    assert.equal(openapi.openapi, "3.1.0");
    assert.ok(openapi.paths["/cards/{id}/terms.json"]);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("server-only filters select cards by audience, fees, earn and credit categories", () => {
  assert.equal(ids("cards.json").length, 30);
  assert.equal(ids("cards.json", "audience=business").length, 10);
  assert.ok(ids("cards.json", "issuer=Chase").every((id) => id.startsWith("us-chase-")));
  assert.ok(ids("cards.json", "earn_category=groceries&min_rate=4").includes("us-amex-gold"));
  assert.ok(!ids("cards.json", "earn_category=groceries&min_rate=4&unit=cash").includes("us-amex-gold"));
  assert.ok(
    ids("cards.json", "annual_fee_max=0").every((id) => !["us-amex-platinum", "us-amex-gold"].includes(id)),
  );
  assert.ok(ids("cards.json", "annual_fee_min=500").includes("us-amex-platinum"));
  assert.ok(ids("cards.json", "credit_category=dining").includes("us-amex-gold"));
  assert.deepEqual(ids("cards.json", "q=venture x"), [
    "us-capital-one-venture-x",
    "us-capital-one-venture-x-business",
  ]);
  const flex = (get("categories/earn/rotating.json").body as Body).data.cards.map((c) => c.id);
  assert.ok(flex.includes("us-chase-freedom-flex"));
});

test("terms follow effective dates and recorded revisions; diffs compare revisions", () => {
  const hotel = (asOf: string) =>
    (
      get("cards/us-amex-business-platinum/terms.json", `as_of=${asOf}`).body as {
        data: { credits: { id: string; version: { conditions?: { minimum_nights?: number } } }[] };
      }
    ).data.credits.find((c) => c.id.includes("hotel"))!.version.conditions?.minimum_nights;
  assert.equal(hotel("2026-12-31"), undefined);
  assert.equal(hotel("2027-01-01"), 2);
  const history = (
    get("cards/us-capital-one-venture-x/history.json").body as {
      data: { revisions: { id: string; recorded_at: string }[] };
    }
  ).data.revisions;
  const old = get("cards/us-capital-one-venture-x/terms.json", `recorded_at=${history[0]!.recorded_at}`)
    .body as {
    data: { revision: { id: string }; earn_rates: { category: string }[] };
  };
  assert.equal(old.data.revision.id, history[0]!.id);
  assert.ok(!old.data.earn_rates.some((r) => r.category === "entertainment"));
  assert.equal(
    get("cards/us-capital-one-venture-x/terms.json", "recorded_at=2000-01-01T00:00:00Z").status,
    404,
  );
  const diff = get(
    "cards/us-capital-one-venture-x/diff.json",
    `from=${history[0]!.id}&to=${history.at(-1)!.id}`,
  );
  assert.equal(diff.status, 200);
  assert.ok((diff.body as { data: { changes: unknown[] } }).data.changes.length > 0);
});

test("bad requests get JSON errors with specific codes", () => {
  const code = (path: string, query = "") => {
    const r = get(path, query);
    return [r.status, (r.body as { error?: { code: string } }).error?.code];
  };
  assert.deepEqual(code("cards.json", "colour=red"), [400, "unknown_parameter"]);
  assert.deepEqual(code("cards.json", "as_of=2026-02-30"), [400, "invalid_date"]);
  assert.deepEqual(code("cards.json", "issuer=Chase&issuer=Citi"), [400, "repeated_parameter"]);
  assert.deepEqual(code("cards.json", "annual_fee_max=cheap"), [400, "invalid_number"]);
  assert.deepEqual(code("cards/us-amex-gold/terms.json", "recorded_at=yesterday"), [400, "invalid_time"]);
  assert.deepEqual(code("cards/us-amex-gold/diff.json"), [400, "invalid_revision"]);
  assert.deepEqual(code("cards/us-nope.json"), [404, "not_found"]);
  assert.deepEqual(code("cards/us-amex-gold/revisions/20260101T000000Z-000000000000.json"), [
    404,
    "not_found",
  ]);
  assert.deepEqual(code("categories/earn/nope.json"), [404, "not_found"]);
  assert.deepEqual(code("../package.json"), [404, "not_found"]);
  assert.deepEqual(code("cards.json/extra"), [404, "not_found"]);
});

test("the server serves the static bytes, query parameters, CORS, ETags and read-only errors", async () => {
  const server = apiServer(() => ctx).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const cards = await fetch(`${base}/api/v1/cards.json`);
    assert.equal(cards.status, 200);
    assert.equal(cards.headers.get("access-control-allow-origin"), "*");
    assert.equal(await cards.text(), serialize(handle(ctx, "cards.json").body));
    const etag = cards.headers.get("etag")!;
    assert.equal(
      (await fetch(`${base}/api/v1/cards.json`, { headers: { "If-None-Match": etag } })).status,
      304,
    );
    const business = await (await fetch(`${base}/api/v1/cards.json?audience=business`)).json();
    assert.equal(business.data.count, 10);
    assert.equal((await fetch(`${base}/api/v1/cards.json?nope=1`)).status, 400);
    assert.equal((await fetch(`${base}/api/v1/cards%2F..%2F..%2Fpackage.json`)).status, 404);
    assert.equal((await fetch(`${base}/elsewhere`)).status, 404);
    assert.equal((await fetch(`${base}/`, { redirect: "manual" })).headers.get("location"), "/api/v1/");
    assert.equal((await fetch(`${base}/api/v1/index.json`, { method: "OPTIONS" })).status, 204);
    const post = await fetch(`${base}/api/v1/cards.json`, { method: "POST", body: "{}" });
    assert.equal(post.status, 405);
    assert.equal((await post.json()).error.code, "method_not_allowed");
    const head = await fetch(`${base}/api/v1/index.json`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
