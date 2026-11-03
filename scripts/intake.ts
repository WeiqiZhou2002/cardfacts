import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { IntakeError, REJECTED_ISSUE, runIntake } from "./lib/intake.js";
import type { Exec } from "./lib/intake.js";
import { SubmissionError } from "./lib/submissions.js";

// Entry point for .github/workflows/agent-submission.yml: node --import tsx scripts/intake.ts FILE
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const exec: Exec = (command, args) =>
  new Promise((done) =>
    execFile(command, args, { cwd: root, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) =>
      done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr }),
    ),
  );
const file = process.argv[2];
let submission: unknown;
try {
  if (!file) throw new IntakeError("Usage: scripts/intake.ts SUBMISSION_FILE");
  submission = JSON.parse(await readFile(file, "utf8"));
  const report = await runIntake({
    root,
    submission,
    exec,
    dispatchCi: process.env.CARDFACTS_DISPATCH_CI === "true",
    automergeReverify: process.env.CARDFACTS_AUTOMERGE_REVERIFY === "true",
    log: (line) => console.log(line),
  });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  // Validation and command errors are safe to show; anything else is summarized.
  const message =
    error instanceof SubmissionError || error instanceof IntakeError || error instanceof SyntaxError
      ? error.message
      : "Unexpected intake failure; see the workflow log.";
  console.error(message);
  if (!(error instanceof SubmissionError || error instanceof IntakeError || error instanceof SyntaxError))
    console.error(error);
  const id =
    submission && typeof submission === "object" && "submission_id" in submission
      ? String((submission as { submission_id: unknown }).submission_id).slice(0, 120)
      : "unknown";
  const run = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : "local run";
  const body = `Submission \`${id.replace(/`/g, "")}\` was rejected (${run}):\n\n\`\`\`text\n${message.replace(/```/g, "'''").slice(0, 6000)}\n\`\`\`\n`;
  const list = await exec("gh", [
    "issue",
    "list",
    "--state",
    "open",
    "--label",
    "bot",
    "--json",
    "number,title",
  ]);
  const issue =
    list.code === 0
      ? (JSON.parse(list.stdout) as { number: number; title: string }[]).find(
          (i) => i.title === REJECTED_ISSUE,
        )
      : undefined;
  await exec(
    "gh",
    issue
      ? ["issue", "comment", String(issue.number), "--body", body]
      : ["issue", "create", "--title", REJECTED_ISSUE, "--label", "bot", "--body", body],
  );
  process.exitCode = 1;
}
