import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { apiContext } from "./lib/api.js";
import { apiServer } from "./lib/api-server.js";

// Usage: pnpm api:serve  (HOST, default 127.0.0.1; PORT, default 8787). SIGHUP reloads the data.
const root = resolve(process.env.CARDFACTS_ROOT ?? fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be 1–65535");
let context = await apiContext(root);
process.on("SIGHUP", () => {
  apiContext(root).then(
    (next) => {
      context = next;
      console.log(`Reloaded catalog ${next.catalog.metadata.catalog_version}`);
    },
    (error: unknown) =>
      console.error(`Reload failed; still serving the previous data: ${(error as Error).message}`),
  );
});
const host = process.env.HOST ?? "127.0.0.1";
apiServer(() => context).listen(port, host, () =>
  console.log(`CardFacts API ${context.catalog.metadata.catalog_version}: http://${host}:${port}/api/v1/`),
);
