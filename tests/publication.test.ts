import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { loadCatalog } from "../scripts/lib/catalog.js";
import { planPublication, stampCatalog, stampFromEnv } from "../scripts/lib/publication.js";

const catalog = await loadCatalog(resolve(import.meta.dirname, ".."));
const plan = (input: Partial<Parameters<typeof planPublication>[0]>) =>
  planPublication({
    label: "2026.11.03-draft",
    today: "2026-11-05",
    latest: null,
    changed: false,
    published: [],
    ...input,
  });

test("a publish reuses the last version until the data changes, then dates a new one", () => {
  assert.deepEqual(plan({}), { catalog_version: "2026.11.05-draft", created: true });
  assert.deepEqual(plan({ latest: "2026.11.04-draft", published: ["2026.11.04-draft"] }), {
    catalog_version: "2026.11.04-draft",
    created: false,
  });
  assert.deepEqual(plan({ latest: "2026.11.04-draft", changed: true, published: ["2026.11.04-draft"] }), {
    catalog_version: "2026.11.05-draft",
    created: true,
  });
  // A second data change on the same day gets a counter; a label without a suffix uses a hyphen.
  assert.equal(
    plan({ latest: "2026.11.05-draft", changed: true, published: ["2026.11.05-draft", "2026.11.05-draft.2"] })
      .catalog_version,
    "2026.11.05-draft.3",
  );
  assert.equal(
    plan({ label: "2026.11.03", latest: "2026.11.05", changed: true, published: ["2026.11.05"] })
      .catalog_version,
    "2026.11.05-2",
  );
  assert.throws(() => plan({ today: "2026-02-30" }), /publish date/);
  assert.throws(() => plan({ label: "draft" }), /catalog.json version/);
});

test("a stamp replaces the catalog version and terms date; without one the catalog date applies", () => {
  const plain = stampCatalog(catalog);
  assert.equal(plain.catalog.metadata.catalog_version, catalog.metadata.catalog_version);
  assert.equal(plain.asOf, catalog.metadata.catalog_version.slice(0, 10).replaceAll(".", "-"));
  const stamped = stampCatalog(catalog, { catalog_version: "2026.12.01-draft", as_of: "2026-12-15" });
  assert.equal(stamped.catalog.metadata.catalog_version, "2026.12.01-draft");
  assert.equal(stamped.asOf, "2026-12-15");
  assert.equal(catalog.metadata.catalog_version, plain.catalog.metadata.catalog_version, "input unchanged");
  assert.equal(stampCatalog(catalog, { catalog_version: "2026.12.01-draft" }).asOf, "2026-12-01");
  assert.throws(() => stampCatalog(catalog, { catalog_version: "latest" }), /catalog version/);
  assert.throws(() => stampCatalog(catalog, { as_of: "2026-13-01" }), /terms date/);
  assert.deepEqual(stampFromEnv({ CARDFACTS_CATALOG_VERSION: "", CARDFACTS_AS_OF: "2026-12-15" }), {
    as_of: "2026-12-15",
  });
});
