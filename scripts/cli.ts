import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildCatalog, listSources, loadCatalog, staleVersions } from "./lib/catalog.js";
import { fetchSource } from "./lib/fetch-source.js";
import { historyErrors, readBaseCards } from "./lib/history.js";

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
      help: { type: "boolean" },
    },
  });
  const commands = ["validate", "build", "sources", "stale", "fetch-source"];
  if (values.help) {
    console.log(
      "pnpm validate [--base-ref REV]\npnpm build\npnpm sources --json\npnpm stale [--days 90] [--as-of YYYY-MM-DD] --json\npnpm fetch-source SOURCE_ID [--json]",
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
  };
  for (const key of Object.keys(values))
    if (!permitted[command]!.includes(key)) throw new Error(`--${key} is not supported by ${command}`);
  if (positionals.length !== (command === "fetch-source" ? 1 : 0))
    throw new Error(`${command}: unexpected or missing positional argument`);
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const catalog = await loadCatalog(root);
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
  if (command === "validate") {
    if (values["base-ref"]) {
      const errors = historyErrors(readBaseCards(root, values["base-ref"]), catalog.cards);
      if (errors.length) throw new Error(errors.join("\n"));
    }
    console.log(
      `Validated ${catalog.cards.length} cards, vocabularies, maintenance configuration, and progress fixtures.`,
    );
  } else if (command === "build") {
    await buildCatalog(catalog);
    console.log(`Built ${catalog.cards.length} cards in dist/ (cards.json, cards.min.json, SHA256SUMS).`);
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
