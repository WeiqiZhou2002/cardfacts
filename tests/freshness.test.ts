import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { loadCatalog } from "../scripts/lib/catalog.js";
import { FRESHNESS_ISSUE, overdueTerms, runFreshness } from "../scripts/lib/freshness.js";
import type { Exec } from "../scripts/lib/intake.js";
import type { Card, Catalog } from "../scripts/lib/types.js";

const root = resolve(import.meta.dirname, "..");
const catalog = await loadCatalog(root);
const latest = catalog.cards
  .flatMap((c) => [c.networks.last_verified, ...c.fees.map((v) => v.last_verified)])
  .sort()
  .at(-1)!;

function withCard(id: string, edit: (card: Card) => void): Catalog {
  const cards = structuredClone(catalog.cards);
  edit(cards.find((c) => c.id === id)!);
  return { ...catalog, cards };
}

test("only verified values in effect or scheduled count, and only past the window", () => {
  assert.deepEqual(overdueTerms(catalog, 21, latest), []);
  const late = overdueTerms(catalog, 21, "2027-01-31");
  assert.ok(late.length > 100);
  assert.ok(late.every((r) => r.age_days > 21));
  assert.ok(late.some((r) => r.product === "us-amex-gold" && r.target === "fees"));
  assert.ok(late.some((r) => r.target === "networks"));

  const edited = withCard("us-amex-gold", (card) => {
    const fee = card.fees.at(-1)!;
    // A closed version keeps its final check date; a pending value is tracked as pending.
    card.fees = [
      { ...fee, effective_from: null, effective_to: "2026-09-30", last_verified: "2026-01-01" },
      {
        ...fee,
        effective_from: "2026-10-01",
        effective_to: null,
        status: "to_verify",
        last_verified: "2026-01-01",
      },
    ];
    card.networks = { ...card.networks, status: "verified", last_verified: "2026-01-01" };
  });
  assert.deepEqual(
    overdueTerms(edited, 21, latest).map((r) => [r.product, r.target, r.last_verified]),
    [["us-amex-gold", "networks", "2026-01-01"]],
  );
  assert.throws(() => overdueTerms(catalog, 0, latest), /positive/);
});

function fakeGh(openIssues: { number: number; title: string; url: string }[]) {
  const calls: string[][] = [];
  const bodies: string[] = [];
  const exec: Exec = async (command, args) => {
    calls.push([command, ...args]);
    const file = args.indexOf("--body-file");
    if (file > 0) bodies.push(await readFile(args[file + 1]!, "utf8"));
    if (args[0] === "issue" && args[1] === "list")
      return { code: 0, stdout: JSON.stringify(openIssues), stderr: "" };
    if (args[0] === "issue" && args[1] === "create")
      return { code: 0, stdout: "https://github.com/o/r/issues/9\n", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  return { exec, calls, bodies };
}
const open = [{ number: 7, title: FRESHNESS_ISSUE, url: "https://github.com/o/r/issues/7" }];

test("the weekly check opens one issue, refreshes it, and closes it once current", async () => {
  const created = fakeGh([]);
  assert.deepEqual(await runFreshness({ root, catalog, exec: created.exec, days: 21, asOf: "2027-01-31" }), {
    overdue: overdueTerms(catalog, 21, "2027-01-31").length,
    issue: "https://github.com/o/r/issues/9",
    action: "created",
  });
  assert.ok(created.calls.some((c) => c.slice(1, 4).join(" ") === "label create bot"));
  assert.ok(created.bodies[0]!.includes("| `us-amex-gold` |"));
  assert.match(created.bodies[0]!, /more than 21 days ago/);

  const updated = fakeGh(open);
  const result = await runFreshness({ root, catalog, exec: updated.exec, days: 21, asOf: "2027-01-31" });
  assert.equal(result.action, "updated");
  assert.ok(updated.calls.some((c) => c.slice(1, 4).join(" ") === "issue edit 7"));
  assert.ok(!updated.calls.some((c) => c[2] === "create"));

  const closed = fakeGh(open);
  assert.equal(
    (await runFreshness({ root, catalog, exec: closed.exec, days: 21, asOf: latest })).action,
    "closed",
  );
  assert.ok(closed.calls.some((c) => c.slice(1, 4).join(" ") === "issue close 7"));

  const quiet = fakeGh([]);
  assert.equal(
    (await runFreshness({ root, catalog, exec: quiet.exec, days: 21, asOf: latest })).action,
    "none",
  );
  assert.equal(quiet.calls.length, 1);
});
