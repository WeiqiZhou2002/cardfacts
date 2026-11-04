import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCatalog } from "./catalog.js";
import type { Exec } from "./intake.js";
import { isDate } from "./primitives.js";
import type { Catalog, Version } from "./types.js";

export const FRESHNESS_ISSUE = "Terms not re-verified";
export interface Overdue {
  product: string;
  target: string;
  last_verified: string;
  age_days: number;
}

// Verified values that are current or scheduled on `asOf` and were last checked more than `days`
// ago. Closed versions keep their final check date, and pending values are tracked as pending.
export function overdueTerms(catalog: Catalog, days: number, asOf: string): Overdue[] {
  if (!Number.isInteger(days) || days < 1 || !isDate(asOf))
    throw new Error("freshness requires a positive whole number of days and a YYYY-MM-DD date");
  const age = (date: string) => Math.round((Date.parse(asOf) - Date.parse(date)) / 86_400_000);
  return catalog.cards.flatMap((card) => {
    const groups: [string, Version[]][] = [
      ["fees", card.fees],
      ...card.earn_rates.map((r): [string, Version[]] => [`earn_rates/${r.id}`, r.versions]),
      ...card.credits.map((c): [string, Version[]] => [`credits/${c.id}`, c.versions]),
    ];
    const rows: Overdue[] = groups.flatMap(([target, versions]) =>
      versions
        .filter((v) => v.status === "verified" && (v.effective_to === null || v.effective_to >= asOf))
        .filter((v) => age(v.last_verified) > days)
        .map((v) => ({
          product: card.id,
          target: v.effective_from ? `${target}@${v.effective_from}` : target,
          last_verified: v.last_verified,
          age_days: age(v.last_verified),
        })),
    );
    const networks = card.networks;
    if (networks.status === "verified" && age(networks.last_verified) > days)
      rows.push({
        product: card.id,
        target: "networks",
        last_verified: networks.last_verified,
        age_days: age(networks.last_verified),
      });
    return rows;
  });
}

export function freshnessReport(rows: Overdue[], days: number, asOf: string): string {
  const products = [...new Set(rows.map((r) => r.product))];
  const table = products.map((id) => {
    const own = rows.filter((r) => r.product === id);
    const oldest = own.map((r) => r.last_verified).sort()[0]!;
    return `| \`${id}\` | ${own.length} | ${oldest} |`;
  });
  const list = rows.map((r) => `- \`${r.product}\` \`${r.target}\`: ${r.last_verified} (${r.age_days} days)`);
  return [
    `As of ${asOf}, ${rows.length} verified value(s) on ${products.length} card(s) were last checked more than ${days} days ago.`,
    "",
    "Either the collection agent has stopped submitting, or its re-verification pull requests are waiting to be merged.",
    "",
    "| Card | Values | Oldest check |",
    "| --- | --- | --- |",
    ...table,
    "",
    "<details><summary>All values</summary>",
    "",
    ...list,
    "",
    "</details>",
    "",
    "This issue is refreshed weekly and closed automatically once every verified value is current.",
    "",
  ].join("\n");
}

export async function runFreshness(options: {
  root: string;
  exec: Exec;
  days: number;
  asOf: string;
  catalog?: Catalog;
}): Promise<{ overdue: number; issue: string | null; action: "created" | "updated" | "closed" | "none" }> {
  const { exec, days, asOf } = options;
  const sh = async (command: string, args: string[]) => {
    const result = await exec(command, args);
    if (result.code !== 0) throw new Error(`${command} ${args[0]} failed: ${result.stderr.trim()}`);
    return result.stdout;
  };
  const rows = overdueTerms(options.catalog ?? (await loadCatalog(options.root)), days, asOf);
  const issues = JSON.parse(
    await sh("gh", ["issue", "list", "--state", "open", "--label", "bot", "--json", "number,title,url"]),
  ) as { number: number; title: string; url: string }[];
  const issue = issues.find((i) => i.title === FRESHNESS_ISSUE);
  if (!rows.length) {
    if (!issue) return { overdue: 0, issue: null, action: "none" };
    await sh("gh", [
      "issue",
      "close",
      String(issue.number),
      "--comment",
      `As of ${asOf}, every verified value was checked within the last ${days} days.`,
    ]);
    return { overdue: 0, issue: issue.url, action: "closed" };
  }
  const scratch = await mkdtemp(join(tmpdir(), "cardfacts-freshness-"));
  try {
    const file = join(scratch, "body.md");
    await writeFile(file, freshnessReport(rows, days, asOf));
    if (issue) {
      await sh("gh", ["issue", "edit", String(issue.number), "--body-file", file]);
      return { overdue: rows.length, issue: issue.url, action: "updated" };
    }
    await sh("gh", [
      "label",
      "create",
      "bot",
      "--color",
      "5319e7",
      "--description",
      "Opened by the agent submission intake",
      "--force",
    ]);
    const url = (
      await sh("gh", ["issue", "create", "--title", FRESHNESS_ISSUE, "--label", "bot", "--body-file", file])
    )
      .trim()
      .split("\n")
      .at(-1)!;
    return { overdue: rows.length, issue: url, action: "created" };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
