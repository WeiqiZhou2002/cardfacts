import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { loadCatalog } from "./catalog.js";
import { recordRevision } from "./revisions.js";
import {
  applyProductSubmission,
  describeProduct,
  describeReverify,
  inline,
  reverifySummary,
  validateSubmission,
} from "./submissions.js";
import type { ProductResult, ProductSubmission } from "./submissions.js";
import type { Catalog } from "./types.js";

export type Exec = (
  command: string,
  args: string[],
  options?: { allowFailure?: boolean },
) => Promise<{ code: number; stdout: string; stderr: string }>;
export class IntakeError extends Error {}
export interface IntakeReport {
  submission_id: string;
  pull_requests: { kind: "data-change" | "reverify"; branch: string; url: string; created: boolean }[];
  reverify_skipped: { product_id: string; reason: string }[];
  flags_issue: string | null;
}
interface PullRequest {
  number: number;
  headRefName: string;
  url: string;
}
const LABELS: [string, string, string][] = [
  ["bot", "5319e7", "Opened by the agent submission intake"],
  ["data-change", "d93f0b", "Changes card terms; needs human review"],
  ["reverify", "0e8a16", "Only moves verification dates forward"],
  ["automerge", "c5def5", "May be merged automatically once checks pass"],
];
const FLAGS_ISSUE = "Agent flags";
export const REJECTED_ISSUE = "Agent submission rejected";

function timestamp(date: Date) {
  return date.toISOString().slice(0, 19) + "Z";
}
// A new snapshot must be recorded after the product's latest one, even within the same second.
function recordedAfter(latest: string | undefined, now: Date) {
  const time = timestamp(now);
  return latest && time <= latest ? timestamp(new Date(Date.parse(latest) + 1000)) : time;
}

export async function runIntake(options: {
  root: string;
  submission: unknown;
  exec: Exec;
  now?: () => Date;
  dispatchCi?: boolean;
  automergeReverify?: boolean;
  log?: (line: string) => void;
}): Promise<IntakeReport> {
  const { root, exec } = options;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => undefined);
  const sh = async (command: string, args: string[], allowFailure = false) => {
    const result = await exec(command, args, { allowFailure });
    if (result.code !== 0 && !allowFailure)
      throw new IntakeError(
        `${command} ${args.slice(0, 2).join(" ")} failed: ${result.stderr.trim().split("\n").slice(-3).join(" ")}`,
      );
    return result;
  };
  const json = async <T>(command: string, args: string[]) =>
    JSON.parse((await sh(command, args)).stdout) as T;
  const submission = await validateSubmission(await loadCatalog(root), options.submission, now());
  const report: IntakeReport = {
    submission_id: submission.submission_id,
    pull_requests: [],
    reverify_skipped: [],
    flags_issue: null,
  };
  const scratch = await mkdtemp(join(tmpdir(), "cardfacts-intake-"));
  const bodyFile = async (text: string) => {
    const file = join(scratch, `body-${Math.random().toString(36).slice(2)}.md`);
    await writeFile(file, text);
    return file;
  };
  try {
    await sh("git", ["config", "user.name", "cardfacts-intake[bot]"]);
    await sh("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
    for (const [name, color, description] of LABELS)
      await sh("gh", ["label", "create", name, "--color", color, "--description", description, "--force"]);
    await sh("git", ["fetch", "origin", "main"]);
    const open = await json<PullRequest[]>("gh", [
      "pr",
      "list",
      "--state",
      "open",
      "--label",
      "bot",
      "--json",
      "number,headRefName,url",
      "--limit",
      "200",
    ]);
    // Classify against main: products whose findings change terms get their own pull request.
    const main = await loadCatalog(root);
    const planned = submission.products.map((product) => ({
      product,
      result: applyProductSubmission(
        main.cards.find((c) => c.id === product.product_id)!,
        product,
      ).result,
    }));
    const flagged: { product: ProductSubmission; result: ProductResult }[] = [];
    const reverify: ProductSubmission[] = [];
    for (const item of planned) {
      if (item.result.changes.length) {
        await dataChange(item.product);
        continue;
      }
      if (item.result.flags.length || item.result.skipped.length) flagged.push(item);
      const pending = open.find((pr) => pr.headRefName.startsWith(`bot/${item.product.product_id}/`));
      if (pending)
        report.reverify_skipped.push({
          product_id: item.product.product_id,
          reason: `open data pull request ${pending.url}`,
        });
      else if (item.result.verified.length) reverify.push(item.product);
    }
    if (reverify.length) await reverifyBatch(reverify, main);
    if (flagged.length) await reportFlags(flagged);
    return report;
  } finally {
    await sh("git", ["checkout", "--force", "--detach", "origin/main"], true);
    await rm(scratch, { recursive: true, force: true });
  }

  // Writes changed cards and their snapshots on the checked-out branch; returns changed product ids.
  async function apply(products: ProductSubmission[], changes: boolean) {
    const catalog = await loadCatalog(root);
    const results: ProductResult[] = [];
    const changed: string[] = [];
    for (const product of products) {
      const card = catalog.cards.find((c) => c.id === product.product_id)!;
      const { card: next, result } = applyProductSubmission(card, product, { changes });
      results.push(result);
      if (isDeepStrictEqual(card, next)) continue;
      const issuer = catalog.issuers.issuers.find((i) => i.name === card.issuer)!;
      await writeFile(
        join(root, "data/us", issuer.id, `${card.id}.json`),
        JSON.stringify(next, null, 2) + "\n",
      );
      changed.push(card.id);
    }
    const files = changed.map((id) => {
      const issuer = catalog.issuers.issuers.find(
        (i) => i.name === catalog.cards.find((c) => c.id === id)!.issuer,
      )!;
      return join("data/us", issuer.id, `${id}.json`);
    });
    if (changed.length) {
      const updated = await loadCatalog(root, { allowUnrecorded: true });
      for (const id of changed) {
        const result = results.find((r) => r.product_id === id)!;
        const reason = result.changes.length
          ? `Agent submission ${submission.submission_id}: ${result.changes.length} term change(s) from issuer sources.`
          : `Agent submission ${submission.submission_id}: re-verified ${result.verified.length} version(s).`;
        const latest = updated.revisions.filter((r) => r.product_id === id).at(-1)?.recorded_at;
        const revision = await recordRevision(updated, id, recordedAfter(latest, now()), reason);
        files.push(relative(root, join(root, "history", id, `${revision.id}.json`)));
      }
      await sh("pnpm", ["exec", "prettier", "--write", ...files]);
    }
    return { results, changed };
  }
  async function publish(
    branch: string,
    kind: "data-change" | "reverify",
    title: string,
    body: string,
    lease?: string,
  ) {
    await sh("pnpm", ["--silent", "validate", "--base-ref", "origin/main"]);
    if (kind === "reverify")
      await sh("pnpm", ["--silent", "check-reverify-diff", "--base-ref", "origin/main"]);
    await sh("pnpm", ["--silent", "build"]);
    await sh("git", ["add", "data", "history"]);
    await sh("git", ["commit", "--quiet", "-m", title]);
    const pushed = await sh(
      "git",
      [
        "push",
        lease === undefined ? "--force" : `--force-with-lease=${branch}:${lease}`,
        "origin",
        `HEAD:refs/heads/${branch}`,
      ],
      lease !== undefined,
    );
    if (pushed.code !== 0) return false;
    const existing = await json<PullRequest[]>("gh", [
      "pr",
      "list",
      "--state",
      "open",
      "--head",
      branch,
      "--json",
      "number,headRefName,url",
    ]);
    const file = await bodyFile(body);
    const labels =
      kind === "reverify" && options.automergeReverify ? ["bot", kind, "automerge"] : ["bot", kind];
    let url: string;
    if (existing[0]) {
      await sh("gh", ["pr", "edit", String(existing[0].number), "--title", title, "--body-file", file]);
      url = existing[0].url;
    } else {
      const created = await sh("gh", [
        "pr",
        "create",
        "--base",
        "main",
        "--head",
        branch,
        "--title",
        title,
        "--body-file",
        file,
        ...labels.flatMap((l) => ["--label", l]),
      ]);
      url = created.stdout.trim().split("\n").at(-1)!;
    }
    // Pushes made with the workflow token start no CI run; a workflow_dispatch does.
    if (options.dispatchCi) await sh("gh", ["workflow", "run", "ci.yml", "--ref", branch]);
    report.pull_requests.push({ kind, branch, url, created: !existing[0] });
    log(`${existing[0] ? "Updated" : "Opened"} ${url}`);
    return true;
  }
  async function dataChange(product: ProductSubmission) {
    const branch = `bot/${product.product_id}/${submission.checked_at.slice(0, 10)}`;
    await sh("git", ["checkout", "--force", "-B", branch, "origin/main"]);
    const { results, changed } = await apply([product], true);
    if (!changed.length) return;
    const card = (await loadCatalog(root)).cards.find((c) => c.id === product.product_id)!;
    const { title, body } = describeProduct(card, submission, product, results[0]!);
    await publish(branch, "data-change", title, body);
    const url = report.pull_requests.at(-1)?.url;
    const older = await json<PullRequest[]>("gh", [
      "pr",
      "list",
      "--state",
      "open",
      "--label",
      "bot",
      "--json",
      "number,headRefName,url",
      "--limit",
      "200",
    ]);
    for (const pr of older.filter(
      (p) => p.headRefName.startsWith(`bot/${product.product_id}/`) && p.headRefName !== branch,
    ))
      await sh("gh", [
        "pr",
        "comment",
        String(pr.number),
        "--body-file",
        await bodyFile(
          `A newer agent submission for \`${product.product_id}\` opened ${url}. Close this one if it is superseded.`,
        ),
      ]);
  }
  async function reverifyBatch(products: ProductSubmission[], main: Catalog) {
    const branch = "bot/reverify";
    // Several intake runs may race on the shared branch; the lease makes a loser start over.
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await sh("git", ["ls-remote", "--heads", "origin", branch]);
      const head = remote.stdout.trim().split(/\s+/)[0] || "";
      const open = head
        ? (
            await json<PullRequest[]>("gh", [
              "pr",
              "list",
              "--state",
              "open",
              "--head",
              branch,
              "--json",
              "number,headRefName,url",
            ])
          ).length > 0
        : false;
      let rebuilt = true;
      if (open) {
        await sh("git", ["fetch", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
        await sh("git", ["checkout", "--force", "-B", branch, `origin/${branch}`]);
        const merged = await sh("git", ["merge", "--no-edit", "origin/main"], true);
        rebuilt = merged.code !== 0;
        if (rebuilt) await sh("git", ["merge", "--abort"], true);
      }
      if (rebuilt) await sh("git", ["checkout", "--force", "-B", branch, "origin/main"]);
      const { changed } = await apply(products, false);
      if (!changed.length) {
        log("Re-verification found nothing newer than the recorded dates.");
        return;
      }
      const catalog = await loadCatalog(root);
      const entries = reverifySummary(main.cards, catalog.cards);
      const { title, body } = describeReverify(entries, submission.submission_id);
      if (await publish(branch, "reverify", title, body, head)) return;
      log("bot/reverify moved during this run; retrying.");
    }
    throw new IntakeError("bot/reverify kept moving; try the submission again later");
  }
  async function reportFlags(items: { product: ProductSubmission; result: ProductResult }[]) {
    const lines = items.flatMap(({ product, result }) => [
      `### \`${product.product_id}\``,
      ...result.flags.map(
        (f) =>
          `- **${f.kind}**${f.target ? ` \`${f.target}\`` : ""} (\`${f.source_id}\`): ${inline(f.summary)}${f.evidence ? ` — ${inline(f.evidence)}` : ""}`,
      ),
      ...result.skipped.map((s) => `- Not re-verified \`${s.target}\`: ${s.reason}.`),
    ]);
    const body = `Submission \`${submission.submission_id}\` (checked ${submission.checked_at}) reported findings that need a human:\n\n${lines.join("\n")}\n`;
    const issues = await json<{ number: number; title: string; url: string }[]>("gh", [
      "issue",
      "list",
      "--state",
      "open",
      "--label",
      "bot",
      "--json",
      "number,title,url",
      "--limit",
      "200",
    ]);
    const issue = issues.find((i) => i.title === FLAGS_ISSUE);
    const file = await bodyFile(body);
    if (issue) {
      await sh("gh", ["issue", "comment", String(issue.number), "--body-file", file]);
      report.flags_issue = issue.url;
    } else
      report.flags_issue = (
        await sh("gh", ["issue", "create", "--title", FLAGS_ISSUE, "--label", "bot", "--body-file", file])
      ).stdout
        .trim()
        .split("\n")
        .at(-1)!;
  }
}
