import assert from "node:assert/strict";
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { runIntake } from "../scripts/lib/intake.js";
import type { Exec } from "../scripts/lib/intake.js";
import { SubmissionError } from "../scripts/lib/submissions.js";
import type { ProductSubmission, Submission } from "../scripts/lib/submissions.js";

const root = resolve(import.meta.dirname, "..");
const hash = "b".repeat(64);
const goldSources = [
  {
    source_id: "us-amex-gold-benefits",
    url: "https://www.americanexpress.com/en-us/account/get-started/gold/explore-benefits",
    fetched_at: "2026-11-01T06:05:00Z",
    text_sha256: hash,
  },
  {
    source_id: "us-amex-gold-page",
    url: "https://www.americanexpress.com/us/credit-cards/card/gold-card/",
    fetched_at: "2026-11-01T06:06:00Z",
    text_sha256: hash,
  },
];
const platinum: ProductSubmission = {
  product_id: "us-amex-platinum",
  sources: [
    {
      source_id: "amex-platinum-page",
      url: "https://www.americanexpress.com/us/credit-cards/card/platinum/",
      fetched_at: "2026-11-01T06:07:00Z",
      text_sha256: hash,
    },
  ],
  verified: [{ target: "/fees", source_id: "amex-platinum-page" }],
  changes: [],
  flags: [],
};
const submission = (...products: ProductSubmission[]): Submission => ({
  format_version: 1,
  submission_id: "20261101T060000Z-test",
  agent: { name: "cardfacts-agent", version: "0.1.0", model: null },
  checked_at: "2026-11-01T06:10:00Z",
  products,
});

// A copy of the repository plus a fake git/gh: checkout restores main's files, commits are recorded.
async function sandbox(
  run: (ctx: {
    dir: string;
    exec: Exec;
    calls: string[][];
    commits: { branch: string; files: Record<string, string> }[];
    openPrs: { number: number; headRefName: string; url: string }[];
    bodies: string[];
  }) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), "cardfacts-intake-test-"));
  const pristine = join(dir, ".pristine");
  try {
    for (const path of ["catalog.json", "data", "history", "maintenance", "schema", "vectors", "vocab"]) {
      await cp(join(root, path), join(dir, path), { recursive: true });
      await cp(join(root, path), join(pristine, path), { recursive: true });
    }
    const calls: string[][] = [];
    const commits: { branch: string; files: Record<string, string> }[] = [];
    const openPrs: { number: number; headRefName: string; url: string }[] = [];
    const bodies: string[] = [];
    let branch = "main";
    let next = 100;
    const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
    const exec: Exec = async (command, args) => {
      calls.push([command, ...args]);
      const line = args.join(" ");
      if (args.includes("--body-file"))
        bodies.push(await readFile(args[args.indexOf("--body-file") + 1]!, "utf8"));
      if (command === "git" && args[0] === "checkout") {
        for (const path of ["data", "history"]) {
          await rm(join(dir, path), { recursive: true, force: true });
          await cp(join(pristine, path), join(dir, path), { recursive: true });
        }
        branch = args.includes("-B") ? args[args.indexOf("-B") + 1]! : "main";
        return ok();
      }
      if (command === "git" && args[0] === "commit") {
        const files: Record<string, string> = {};
        for (const top of ["data", "history"])
          for (const entry of await readdir(join(dir, top), { recursive: true, withFileTypes: true }))
            if (entry.isFile()) {
              const path = join(entry.parentPath, entry.name);
              const before = await readFile(join(pristine, path.slice(dir.length + 1)), "utf8").catch(
                () => null,
              );
              const after = await readFile(path, "utf8");
              if (before !== after) files[path.slice(dir.length + 1)] = after;
            }
        commits.push({ branch, files });
        return ok();
      }
      if (command === "git" && args[0] === "ls-remote") return ok("");
      if (command === "gh" && line.startsWith("pr list")) {
        const head = args.includes("--head") ? args[args.indexOf("--head") + 1] : undefined;
        return ok(JSON.stringify(openPrs.filter((p) => !head || p.headRefName === head)));
      }
      if (command === "gh" && line.startsWith("pr create")) {
        const head = args[args.indexOf("--head") + 1]!;
        const url = `https://github.com/WeiqiZhou2002/cardfacts/pull/${next}`;
        openPrs.push({ number: next++, headRefName: head, url });
        return ok(`${url}\n`);
      }
      if (command === "gh" && line.startsWith("issue list")) return ok("[]");
      if (command === "gh" && line.startsWith("issue create"))
        return ok("https://github.com/WeiqiZhou2002/cardfacts/issues/7\n");
      return ok();
    };
    await run({ dir, exec, calls, commits, openPrs, bodies });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const now = () => new Date("2026-11-01T07:00:00Z");

test("a term change opens one data-change pull request with evidence, flags and a new snapshot", () =>
  sandbox(async ({ dir, exec, calls, commits, bodies }) => {
    const gold: ProductSubmission = {
      product_id: "us-amex-gold",
      sources: goldSources,
      verified: [{ target: "/fees", source_id: "us-amex-gold-page" }],
      changes: [
        {
          target: "/credits/resy",
          source_id: "us-amex-gold-benefits",
          set: { amount: "60.00" },
          effective_from: "2027-01-01",
          effective_from_basis: "stated",
          notes: "Up to $60 each half-year at US Resy restaurants from 2027.",
          evidence: "Benefits page | Resy credit",
        },
      ],
      flags: [
        {
          kind: "new_entry",
          source_id: "us-amex-gold-benefits",
          target: null,
          summary: "A hotel credit for @someone is listed but not recorded.",
          evidence: null,
        },
      ],
    };
    const report = await runIntake({ root: dir, submission: submission(gold), exec, now, dispatchCi: true });
    assert.deepEqual(
      report.pull_requests.map((p) => [p.kind, p.branch, p.created]),
      [["data-change", "bot/us-amex-gold/2026-11-01", true]],
    );
    assert.equal(report.flags_issue, null);
    const commit = commits[0]!;
    const card = JSON.parse(commit.files["data/us/amex/us-amex-gold.json"]!);
    const resy = card.credits.find((c: { id: string }) => c.id === "resy").versions;
    assert.deepEqual(
      resy.map((v: { amount: string; effective_to: string | null }) => [v.amount, v.effective_to]),
      [
        ["50.00", "2026-12-31"],
        ["60.00", null],
      ],
    );
    const snapshots = Object.keys(commit.files).filter((f) => f.startsWith("history/us-amex-gold/"));
    assert.equal(snapshots.length, 1);
    assert.match(snapshots[0]!, /20261101T070000Z-/);
    const create = calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "create")!;
    assert.match(
      create[create.indexOf("--title") + 1]!,
      /American Express Gold Card: credits\.resy amount 50\.00 → 60\.00/,
    );
    assert.deepEqual(
      create.filter((_, i) => create[i - 1] === "--label"),
      ["bot", "data-change"],
    );
    const body = bodies[0]!;
    assert.match(body, /\| credits\.resy\.amount \| 50\.00 \| 60\.00 \| 2027-01-01 \(stated\) \|/);
    assert.match(body, /us-amex-gold-benefits.*fetched 2026-11-01 06:05:00 UTC/);
    assert.ok(body.includes("Benefits page \\| Resy credit"));
    assert.ok(body.includes("**new_entry**: A hotel credit for @\u200bsomeone"));
    assert.match(body, /Also re-verified 1 unchanged version/);
    for (const step of [
      ["pnpm", "--silent", "validate", "--base-ref", "origin/main"],
      ["pnpm", "--silent", "build"],
      ["gh", "workflow", "run", "ci.yml", "--ref", "bot/us-amex-gold/2026-11-01"],
    ])
      assert.ok(
        calls.some((c) => c.join(" ") === step.join(" ")),
        step.join(" "),
      );
    assert.ok(!calls.some((c) => c.includes("check-reverify-diff")));
    assert.ok(!calls.some((c) => c.join(" ").includes("bot/reverify")));
  }));

test("unchanged findings form one re-verification pull request, skipping products with an open data PR", () =>
  sandbox(async ({ dir, exec, calls, commits, openPrs }) => {
    openPrs.push({
      number: 9,
      headRefName: "bot/us-amex-gold/2026-10-31",
      url: "https://github.com/WeiqiZhou2002/cardfacts/pull/9",
    });
    const gold: ProductSubmission = {
      product_id: "us-amex-gold",
      sources: goldSources,
      verified: [{ target: "/fees", source_id: "us-amex-gold-page" }],
      changes: [],
      flags: [],
    };
    const report = await runIntake({
      root: dir,
      submission: submission(gold, platinum),
      exec,
      now,
      automergeReverify: true,
    });
    assert.deepEqual(report.reverify_skipped, [
      {
        product_id: "us-amex-gold",
        reason: "open data pull request https://github.com/WeiqiZhou2002/cardfacts/pull/9",
      },
    ]);
    assert.deepEqual(
      report.pull_requests.map((p) => [p.kind, p.branch]),
      [["reverify", "bot/reverify"]],
    );
    const files = Object.keys(commits[0]!.files);
    assert.ok(files.includes("data/us/amex/us-amex-platinum.json"));
    assert.ok(!files.some((f) => f.includes("us-amex-gold")));
    assert.ok(calls.some((c) => c.join(" ") === "pnpm --silent check-reverify-diff --base-ref origin/main"));
    assert.ok(calls.some((c) => c.join(" ").startsWith("git push --force-with-lease=bot/reverify: origin")));
    const create = calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "create")!;
    assert.match(create[create.indexOf("--title") + 1]!, /^Re-verify 1 version \(checked 2026-11-01\)$/);
    assert.ok(create.includes("automerge"));
    assert.ok(!calls.some((c) => c[1] === "workflow"));
  }));

test("findings with nothing to apply are reported on the Agent flags issue", () =>
  sandbox(async ({ dir, exec, calls, commits }) => {
    const flagged: ProductSubmission = {
      ...platinum,
      verified: [],
      flags: [
        {
          kind: "unreadable",
          source_id: "amex-platinum-page",
          target: "/credits/equinox",
          summary: "Amount is rendered as an image.",
          evidence: "Equinox section",
        },
      ],
    };
    const report = await runIntake({ root: dir, submission: submission(flagged), exec, now });
    assert.equal(report.pull_requests.length, 0);
    assert.equal(commits.length, 0);
    assert.equal(report.flags_issue, "https://github.com/WeiqiZhou2002/cardfacts/issues/7");
    assert.ok(
      calls.some((c) => c.slice(0, 4).join(" ") === "gh issue create --title" && c[4] === "Agent flags"),
    );
  }));

test("invalid submissions stop before any branch, push or pull request", () =>
  sandbox(async ({ dir, exec, calls }) => {
    const bad = submission({ ...platinum, product_id: "us-nope" });
    await assert.rejects(runIntake({ root: dir, submission: bad, exec, now }), SubmissionError);
    assert.ok(!calls.some((c) => ["push", "commit"].includes(c[1]!) || c[2] === "create"));
  }));
