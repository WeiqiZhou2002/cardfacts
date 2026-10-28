import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { siteServer } from "./lib/site-server.js";
const root = resolve("dist/site");
const { base } = JSON.parse(await readFile(resolve(root, "site-config.json"), "utf8")) as { base: string };
const port = Number(process.env.PORT ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be 1–65535");
const server = siteServer(root, base);
server.listen(port, "127.0.0.1", () => console.log(`CardFacts preview: http://127.0.0.1:${port}${base}`));
