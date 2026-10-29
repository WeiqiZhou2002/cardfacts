import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { buildSite } from "./lib/site.js";
const out = resolve("dist/site");
await rm(out, { recursive: true, force: true });
const result = await buildSite(process.cwd(), out, process.env.SITE_BASE_PATH ?? "/");
console.log(`Built ${result.pages.length} pages for ${result.cards} cards at ${out} (base ${result.base})`);
