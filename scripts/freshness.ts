import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runFreshness } from "./lib/freshness.js";
import type { Exec } from "./lib/intake.js";

// Entry point for .github/workflows/freshness.yml. CARDFACTS_STALE_DAYS sets the threshold (default 21).
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const exec: Exec = (command, args) =>
  new Promise((done) =>
    execFile(command, args, { cwd: root, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) =>
      done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr }),
    ),
  );
const report = await runFreshness({
  root,
  exec,
  days: Number(process.env.CARDFACTS_STALE_DAYS || "21"),
  asOf: new Date().toISOString().slice(0, 10),
});
console.log(JSON.stringify(report, null, 2));
