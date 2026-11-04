import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { stampFromEnv } from "./lib/publication.js";
import { buildSite } from "./lib/site.js";
const out = resolve("dist/site");
await rm(out, { recursive: true, force: true });
// The Pages workflow sets CARDFACTS_CATALOG_VERSION and CARDFACTS_AS_OF; local builds leave them unset.
const result = await buildSite(process.cwd(), out, process.env.SITE_BASE_PATH ?? "/", stampFromEnv());
console.log(
  `Built ${result.pages.length} pages for ${result.cards} cards at ${out} (base ${result.base}, ${result.version}, terms as of ${result.asOf})`,
);
