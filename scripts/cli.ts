import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildCatalog, isDate, listSources, loadCatalog, staleVersions } from "./lib/catalog.js";
import { fetchSource } from "./lib/fetch-source.js";
import { historyErrors, readBaseCards, readBaseRevisions } from "./lib/history.js";
import { recordRevision, revisionAt, revisionDiff, revisionErrors, termsAt } from "./lib/revisions.js";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: "boolean" },
      days: { type: "string" },
      "as-of": { type: "string" },
      "base-ref": { type: "string" },
      "recorded-at": { type: "string" },
      reason: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      help: { type: "boolean" },
    },
  });
  const commands = ["validate", "build", "sources", "stale", "fetch-source", "snapshot", "history"];
  if (values.help) {
    console.log(
      "pnpm validate [--base-ref REV]\npnpm build\npnpm sources --json\npnpm stale [--days 90] [--as-of YYYY-MM-DD] --json\npnpm fetch-source SOURCE_ID [--json]\npnpm snapshot PRODUCT --recorded-at TIME --reason TEXT\npnpm history PRODUCT [--as-of DATE] [--recorded-at TIME] [--from REV --to REV] --json",
    );
    return;
  }
  if (!command || !commands.includes(command)) throw new Error("Unknown command; use --help");
  const permitted: Record<string, string[]> = {
    validate: ["base-ref"],
    build: [],
    sources: ["json"],
    stale: ["json", "days", "as-of"],
    "fetch-source": ["json"],
    snapshot: ["recorded-at", "reason", "json"],
    history: ["as-of", "recorded-at", "from", "to", "json"],
  };
  for (const key of Object.keys(values))
    if (!permitted[command]!.includes(key)) throw new Error(`--${key} is not supported by ${command}`);
  for (const [key, value] of Object.entries(values))
    if (typeof value === "string" && !value.trim()) throw new Error(`--${key} cannot be empty`);
  if (positionals.length !== (["fetch-source", "snapshot", "history"].includes(command) ? 1 : 0))
    throw new Error(`${command}: unexpected or missing positional argument`);
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const catalog = await loadCatalog(root, { allowUnrecorded: command === "snapshot" });
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
  if (command === "validate") {
    if (values["base-ref"]) {
      const errors = [
        ...historyErrors(readBaseCards(root, values["base-ref"]), catalog.cards),
        ...revisionErrors(readBaseRevisions(root, values["base-ref"]), catalog.revisions),
      ];
      if (errors.length) throw new Error(errors.join("\n"));
    }
    console.log(
      `Validated ${catalog.cards.length} cards, vocabularies, maintenance configuration, and progress fixtures.`,
    );
  } else if (command === "build") {
    await buildCatalog(catalog);
    console.log(`Built ${catalog.cards.length} cards and ${catalog.revisions.length} revisions in dist/.`);
  } else if (command === "snapshot") {
    print(await recordRevision(catalog, positionals[0]!, values["recorded-at"] ?? "", values.reason ?? ""));
  } else if (command === "history") {
    if (values["as-of"] && !isDate(values["as-of"]))
      throw new Error("--as-of must be a valid YYYY-MM-DD date");
    const productId = positionals[0]!;
    if (!catalog.cards.some((c) => c.id === productId)) throw new Error(`Unknown product: ${productId}`);
    const revisions = catalog.revisions.filter((r) => r.product_id === productId);
    if (values.from || values.to) {
      if (!values.from || !values.to || values["as-of"] || values["recorded-at"])
        throw new Error("Diff requires --from and --to, without date filters");
      const before = revisions.find((r) => r.id === values.from);
      const after = revisions.find((r) => r.id === values.to);
      if (!before || !after) throw new Error("Unknown revision id");
      print(revisionDiff(before, after));
    } else if (values["as-of"] || values["recorded-at"]) {
      const revision = revisionAt(revisions, productId, values["recorded-at"]);
      print(
        revision
          ? {
              revision_id: revision.id,
              recorded_at: revision.recorded_at,
              ...(values["as-of"]
                ? { terms: termsAt(revision.product, values["as-of"]) }
                : { product: revision.product }),
            }
          : { product_id: productId, status: "not_recorded" },
      );
    } else print(revisions.map(({ product: _product, ...revision }) => revision));
  } else if (command === "sources") {
    const records = listSources(catalog);
    if (values.json) print(records);
    else
      console.log(
        records.map((s) => `${s.id}\t${s.url}\t${s.manual_only ? "manual_only" : "automated"}`).join("\n"),
      );
  } else if (command === "stale") {
    const records = staleVersions(
      catalog,
      Number(values.days ?? "90"),
      values["as-of"] ?? new Date().toLocaleDateString("en-CA"),
    );
    if (values.json) print(records);
    else console.log(records.map((v) => `${v.product}${v.path}\t${v.age_days} days\t${v.source}`).join("\n"));
  } else {
    const result = await fetchSource(catalog, positionals[0]!, {
      stateDir: process.env.CARDFACTS_STATE_DIR ?? join(homedir(), ".local/state/cardfacts"),
    });
    if (values.json || result.status === "manual_only" || result.status === "failed") print(result);
    else console.log(result.last_success!.hash);
    if (result.status === "failed") process.exitCode = 1;
    else if (result.status === "manual_only") process.exitCode = 2;
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Command failed");
  process.exitCode = 1;
});
