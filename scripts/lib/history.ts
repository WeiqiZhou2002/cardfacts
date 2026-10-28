import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import type { Card, Version } from "./types.js";

function groups(card: Card) {
  return new Map<string, Version[]>([
    ["fees", card.fees],
    ...card.earn_rates.map((r) => [`earn_rates/${r.id}`, r.versions] as [string, Version[]]),
    ...card.credits.map((c) => [`credits/${c.id}`, c.versions] as [string, Version[]]),
  ]);
}
export function historyErrors(before: Card[], after: Card[]): string[] {
  const errors: string[] = [];
  for (const old of before) {
    const next = after.find((c) => c.id === old.id);
    if (!next) {
      errors.push(`${old.id}: historical product removed; use availability instead`);
      continue;
    }
    for (const [key, versions] of groups(old)) {
      const newer = groups(next).get(key) ?? [];
      for (const previous of versions) {
        const current = newer.find((v) => v.effective_from === previous.effective_from);
        if (!current) {
          errors.push(`${old.id}/${key}: historical version removed or start date changed`);
          continue;
        }
        const protectedTerms = (v: Version) => {
          const { last_verified: _verified, notes: _notes, ...terms } = v;
          if (previous.effective_to === null) terms.effective_to = null;
          return terms;
        };
        if (!isDeepStrictEqual(protectedTerms(previous), protectedTerms(current)))
          errors.push(`${old.id}/${key}: historical terms changed; close and append a version`);
        if (current.last_verified < previous.last_verified)
          errors.push(`${old.id}/${key}: verification date moved backwards`);
        const original = old.sources.find((s) => s.id === previous.source);
        const replacement = next.sources.find((s) => s.id === previous.source);
        if (!replacement || original?.url !== replacement.url)
          errors.push(`${old.id}/${key}: historical source URL changed; add a new source id`);
      }
    }
  }
  return errors;
}
export function readBaseCards(root: string, revision: string): Card[] {
  // Resolve user input to an object id before passing it to any git path/revision expression.
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  const commit = git(["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`]).trim();
  const paths = git(["ls-tree", "-r", "--name-only", commit, "--", "data/"])
    .trim()
    .split("\n")
    .filter((p) => p.endsWith(".json"));
  return paths.map((path) => JSON.parse(git(["show", `${commit}:${path}`])) as Card);
}
