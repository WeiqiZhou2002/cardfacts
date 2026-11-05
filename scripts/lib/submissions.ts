import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import addFormatsModule from "ajv-formats";
import { allowedUrl, readJson } from "./catalog.js";
import { compare, isDate, isTimestamp } from "./primitives.js";
import type { Card, Catalog, EarnVersion, Networks, SourceKind, Version } from "./types.js";

export type FlagKind = "new_entry" | "removal" | "conflict" | "unreadable" | "ambiguous" | "suspicious_page";
export interface SubmissionSource {
  source_id: string;
  url: string;
  fetched_at: string;
  text_sha256: string;
}
export interface SubmissionChange {
  target: string;
  source_id: string;
  set: Record<string, string>;
  effective_from: string | null;
  effective_from_basis: "stated" | "detected";
  notes: string;
  evidence: string;
}
export interface SubmissionFlag {
  kind: FlagKind;
  source_id: string;
  target: string | null;
  summary: string;
  evidence: string | null;
}
export interface ProductSubmission {
  product_id: string;
  sources: SubmissionSource[];
  verified: { target: string; source_id: string }[];
  changes: SubmissionChange[];
  flags: SubmissionFlag[];
  // Issuer documents not yet in the catalog; only `networks` may cite them.
  new_sources?: (SubmissionSource & { title: string; kind?: SourceKind })[];
  networks?: { source_id: string; values: Networks["values"]; notes: string; evidence: string };
}
export interface Submission {
  format_version: 1;
  submission_id: string;
  agent: { name: string; version: string; model: string | null };
  checked_at: string;
  products: ProductSubmission[];
}
export interface AppliedChange {
  target: string;
  label: string;
  source_id: string;
  field: string;
  before: string | null;
  after: string;
  effective_from: string;
  basis: "stated" | "detected";
  // For a detected change: the old value was last verified on this date.
  detected_after: string | null;
  evidence: string;
  // Networks are not effective-dated; their change replaces the recorded list.
  versioned: boolean;
}
export interface ProductResult {
  product_id: string;
  changes: AppliedChange[];
  verified: { target: string; source_id: string; last_verified: string }[];
  skipped: { target: string; reason: string }[];
  flags: SubmissionFlag[];
}
export class SubmissionError extends Error {}

type Kind = "fees" | "earn_rates" | "credits";
const settable: Record<Kind, string[]> = {
  fees: ["annual_fee", "first_year_annual_fee", "authorized_user_fee", "foreign_transaction_fee_percent"],
  earn_rates: ["rate", "cap_amount", "rate_after_cap"],
  credits: ["amount", "per_transaction_cap"],
};
// The field a pending version leaves null; a submission must supply it to verify the version.
const primary: Record<Kind, string> = { fees: "annual_fee", earn_rates: "rate", credits: "amount" };
const DAY = 86_400_000;
export const addDays = (date: string, days: number) =>
  new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);

export function resolveTarget(
  card: Card,
  target: string,
): { kind: Kind; versions: Version[]; label: string } | undefined {
  if (target === "/fees") return { kind: "fees", versions: card.fees, label: "fees" };
  const [, kind, id] = target.split("/");
  if (kind === "earn_rates") {
    const rule = card.earn_rates.find((r) => r.id === id);
    return rule && { kind, versions: rule.versions, label: `earn_rates.${id}` };
  }
  if (kind === "credits") {
    const credit = card.credits.find((c) => c.id === id);
    return credit && { kind, versions: credit.versions, label: `credits.${id}` };
  }
  return undefined;
}
function read(kind: Kind, version: Version, field: string): string | null | undefined {
  if (kind === "earn_rates" && (field === "cap_amount" || field === "rate_after_cap")) {
    const cap = (version as EarnVersion).cap;
    return cap ? (field === "cap_amount" ? cap.amount : cap.rate_after_cap) : undefined;
  }
  return (version as unknown as Record<string, string | null | undefined>)[field];
}
function write(kind: Kind, version: Version, field: string, value: string) {
  if (kind === "earn_rates" && (field === "cap_amount" || field === "rate_after_cap")) {
    const cap = (version as EarnVersion).cap!;
    if (field === "cap_amount") cap.amount = value;
    else cap.rate_after_cap = value;
  } else (version as unknown as Record<string, string>)[field] = value;
}
const versionAt = (versions: Version[], date: string) =>
  versions.find(
    (v) =>
      (v.effective_from === null || v.effective_from <= date) &&
      (v.effective_to === null || v.effective_to >= date),
  );

let compiled: ValidateFunction | undefined;
export async function validateSubmission(catalog: Catalog, value: unknown, now: Date): Promise<Submission> {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    (addFormatsModule.default ?? addFormatsModule)(ajv);
    compiled = ajv.compile((await readJson(join(catalog.root, "schema/submission.schema.json"))) as object);
  }
  if (!compiled(value))
    throw new SubmissionError(
      (compiled.errors ?? []).map((e) => `submission${e.instancePath || "/"}: ${e.message}`).join("\n"),
    );
  const submission = value as Submission;
  const errors: string[] = [];
  const checked = Date.parse(submission.checked_at);
  if (!isTimestamp(submission.checked_at)) errors.push("checked_at: invalid UTC time");
  else if (checked > now.getTime() + 10 * 60_000) errors.push("checked_at: in the future");
  else if (checked < now.getTime() - 14 * DAY) errors.push("checked_at: more than 14 days old");
  const products = new Set<string>();
  submission.products.forEach((product, i) => {
    const path = `products/${i}`;
    if (products.has(product.product_id)) errors.push(`${path}: duplicate product ${product.product_id}`);
    products.add(product.product_id);
    const card = catalog.cards.find((c) => c.id === product.product_id);
    if (!card) {
      errors.push(`${path}: unknown product ${product.product_id}`);
      return;
    }
    const sources = new Set<string>();
    for (const source of product.sources) {
      const known = card.sources.find((s) => s.id === source.source_id);
      if (sources.has(source.source_id)) errors.push(`${path}: duplicate source ${source.source_id}`);
      sources.add(source.source_id);
      if (!known) errors.push(`${path}: ${source.source_id} is not a source of ${card.id}`);
      else if (known.url !== source.url)
        errors.push(`${path}: ${source.source_id} URL does not match the catalog`);
      const fetched = Date.parse(source.fetched_at);
      if (!isTimestamp(source.fetched_at) || fetched > checked || fetched < checked - 7 * DAY)
        errors.push(`${path}: ${source.source_id} fetched_at must be within 7 days before checked_at`);
    }
    const issuer = catalog.issuers.issuers.find((i) => i.name === card.issuer)!;
    const added = new Set<string>();
    (product.new_sources ?? []).forEach((source, j) => {
      const where = `${path}/new_sources/${j}`;
      if (sources.has(source.source_id) || added.has(source.source_id))
        errors.push(`${where}: duplicate source ${source.source_id}`);
      added.add(source.source_id);
      // Source ids are unique across the whole catalog.
      if (catalog.cards.some((c) => c.sources.some((s) => s.id === source.source_id)))
        errors.push(`${where}: source id ${source.source_id} already exists`);
      if (!allowedUrl(source.url, issuer))
        errors.push(`${where}: URL must be HTTPS on a ${card.issuer} domain`);
      if (card.sources.some((s) => s.url === source.url))
        errors.push(`${where}: URL is already cited as another source`);
      const fetched = Date.parse(source.fetched_at);
      if (!isTimestamp(source.fetched_at) || fetched > checked || fetched < checked - 7 * DAY)
        errors.push(`${where}: fetched_at must be within 7 days before checked_at`);
    });
    if (product.networks) {
      const where = `${path}/networks`;
      if (!sources.has(product.networks.source_id) && !added.has(product.networks.source_id))
        errors.push(`${where}: source ${product.networks.source_id} is not listed in sources or new_sources`);
      if (product.networks.values.join() !== [...product.networks.values].sort(compare).join())
        errors.push(`${where}: list networks in alphabetical order`);
    }
    const targets = new Set<string>();
    const entry = (target: string, sourceId: string, where: string) => {
      if (!sources.has(sourceId)) errors.push(`${where}: source ${sourceId} is not listed in sources`);
      const group = resolveTarget(card, target);
      if (!group) errors.push(`${where}: unknown target ${target}`);
      if (targets.has(target)) errors.push(`${where}: ${target} appears more than once`);
      targets.add(target);
      return group;
    };
    product.verified.forEach((v, j) => entry(v.target, v.source_id, `${path}/verified/${j}`));
    product.changes.forEach((c, j) => {
      const where = `${path}/changes/${j}`;
      const group = entry(c.target, c.source_id, where);
      for (const field of Object.keys(c.set))
        if (group && !settable[group.kind].includes(field))
          errors.push(`${where}: ${field} cannot be set on ${group.kind}`);
      if (c.effective_from_basis === "stated" && !isDate(c.effective_from ?? ""))
        errors.push(`${where}: a stated change needs a valid effective_from`);
    });
    product.flags.forEach((f, j) => {
      const where = `${path}/flags/${j}`;
      // A flag may concern a source this run could not fetch (for example one that keeps failing).
      if (!card.sources.some((s) => s.id === f.source_id))
        errors.push(`${where}: ${f.source_id} is not a source of ${card.id}`);
      if (f.target !== null && !resolveTarget(card, f.target))
        errors.push(`${where}: unknown target ${f.target}`);
    });
  });
  if (errors.length) throw new SubmissionError(errors.join("\n"));
  return submission;
}

// Applies one product's findings to a copy of the card. Value changes close the current version and
// append a new one; unchanged values only move last_verified forward. Anything that would need a
// judgement call (a later version already recorded, a start date the data contradicts) is not applied
// and comes back as a conflict flag for a human.
export function applyProductSubmission(
  card: Card,
  submission: ProductSubmission,
  options: { changes?: boolean } = {},
): { card: Card; result: ProductResult } {
  const next = structuredClone(card);
  const result: ProductResult = {
    product_id: card.id,
    changes: [],
    verified: [],
    skipped: [],
    flags: [...submission.flags],
  };
  const fetched = new Map(
    [...submission.sources, ...(submission.new_sources ?? [])].map((s) => [
      s.source_id,
      s.fetched_at.slice(0, 10),
    ]),
  );
  const used = new Set<string>();
  const verify = (target: string, sourceId: string) => {
    const day = fetched.get(sourceId)!;
    const current = versionAt(resolveTarget(next, target)!.versions, day);
    if (!current) result.skipped.push({ target, reason: `no recorded version applies on ${day}` });
    else if (current.status !== "verified")
      result.skipped.push({ target, reason: "a pending version has no value to re-verify" });
    else if (current.source !== sourceId)
      result.skipped.push({ target, reason: `the current version cites ${current.source}` });
    else {
      if (day > current.last_verified) current.last_verified = day;
      result.verified.push({ target, source_id: sourceId, last_verified: current.last_verified });
      used.add(sourceId);
    }
  };
  if (options.changes !== false)
    for (const change of submission.changes) {
      const group = resolveTarget(next, change.target)!;
      const day = fetched.get(change.source_id)!;
      const reject = (reason: string) =>
        result.flags.push({
          kind: "conflict",
          source_id: change.source_id,
          target: change.target,
          summary: `Change not applied: ${reason}.`,
          evidence: change.evidence,
        });
      const current = versionAt(group.versions, day);
      if (!current) {
        reject(`no recorded version applies on ${day}`);
        continue;
      }
      if (group.versions.indexOf(current) !== group.versions.length - 1) {
        reject("a later version is already recorded");
        continue;
      }
      const fields = Object.entries(change.set);
      if (
        group.kind === "earn_rates" &&
        ("cap_amount" in change.set || "rate_after_cap" in change.set) &&
        !(current as EarnVersion).cap
      ) {
        reject("the current version has no structured cap to update");
        continue;
      }
      const differs = fields.filter(([field, value]) => read(group.kind, current, field) !== value);
      if (!differs.length && current.status === "verified") {
        verify(change.target, change.source_id);
        continue;
      }
      if (current.status === "to_verify" && !(primary[group.kind] in change.set)) {
        reject(`the pending version needs ${primary[group.kind]} before it can be verified`);
        continue;
      }
      const start = change.effective_from_basis === "stated" ? change.effective_from! : day;
      if (current.effective_from !== null && start <= current.effective_from) {
        reject(`start ${start} is not after the current version's start ${current.effective_from}`);
        continue;
      }
      // Shortening a recorded end date would rewrite history; a human decides how to split it.
      if (current.effective_to !== null) {
        reject(`the current version already ends on ${current.effective_to}`);
        continue;
      }
      if (current.status === "verified" && start <= current.last_verified) {
        reject(
          `start ${start} is not after ${current.last_verified}, when the current value was last verified`,
        );
        continue;
      }
      const added = structuredClone(current);
      for (const [field, value] of fields) write(group.kind, added, field, value);
      Object.assign(added, {
        effective_to: null,
        effective_from: start,
        effective_from_basis: change.effective_from_basis,
        status: "verified",
        source: change.source_id,
        last_verified: day,
        notes: change.notes,
      });
      for (const [field, value] of differs)
        result.changes.push({
          target: change.target,
          label: group.label,
          source_id: change.source_id,
          field,
          before: read(group.kind, current, field) ?? null,
          after: value,
          effective_from: start,
          basis: change.effective_from_basis,
          detected_after: change.effective_from_basis === "detected" ? current.last_verified : null,
          evidence: change.evidence,
          versioned: true,
        });
      current.effective_to = addDays(start, -1);
      group.versions.push(added);
      used.add(change.source_id);
    }
  for (const v of submission.verified) verify(v.target, v.source_id);
  if (submission.networks) {
    const found = submission.networks;
    const day = fetched.get(found.source_id)!;
    const current = next.networks;
    const same = current.status === "verified" && current.values.join() === found.values.join();
    if (same && current.source === found.source_id) {
      if (day > current.last_verified) current.last_verified = day;
      result.verified.push({
        target: "/networks",
        source_id: found.source_id,
        last_verified: current.last_verified,
      });
      used.add(found.source_id);
    } else if (same)
      result.skipped.push({ target: "/networks", reason: `the recorded networks cite ${current.source}` });
    else if (options.changes !== false) {
      result.changes.push({
        target: "/networks",
        label: "networks",
        source_id: found.source_id,
        field: "values",
        before: current.status === "verified" ? current.values.join(", ") : null,
        after: found.values.join(", "),
        effective_from: day,
        basis: "detected",
        detected_after: null,
        evidence: found.evidence,
        versioned: false,
      });
      next.networks = {
        values: found.values,
        status: "verified",
        source: found.source_id,
        last_verified: day,
        notes: found.notes,
      };
      used.add(found.source_id);
    }
  }
  for (const id of used) {
    let source = next.sources.find((s) => s.id === id);
    if (!source) {
      // A new issuer document enters the catalog only when an applied finding cites it.
      const added = submission.new_sources!.find((s) => s.source_id === id)!;
      source = {
        id,
        url: added.url,
        title: added.title,
        ...(added.kind ? { kind: added.kind } : {}),
        accessed: fetched.get(id)!,
      };
      next.sources.push(source);
    }
    if (fetched.get(id)! > source.accessed) source.accessed = fetched.get(id)!;
  }
  return { card: next, result };
}

// Re-verification may only move verification and access dates forward.
export function reverifyDiffErrors(before: Card[], after: Card[]): string[] {
  const errors: string[] = [];
  const strip = (card: Card) => {
    const copy = structuredClone(card) as unknown as {
      sources: Record<string, unknown>[];
      networks?: Record<string, unknown>;
      fees: Record<string, unknown>[];
      earn_rates: { versions: Record<string, unknown>[] }[];
      credits: { versions: Record<string, unknown>[] }[];
    };
    for (const s of copy.sources) delete s.accessed;
    if (copy.networks) delete copy.networks.last_verified;
    for (const v of [
      ...copy.fees,
      ...copy.earn_rates.flatMap((r) => r.versions),
      ...copy.credits.flatMap((c) => c.versions),
    ])
      delete v.last_verified;
    return copy;
  };
  const dates = (card: Card) => [
    ...card.sources.map((s) => s.accessed),
    card.networks?.last_verified ?? "",
    ...[card.fees, ...card.earn_rates.map((r) => r.versions), ...card.credits.map((c) => c.versions)].flatMap(
      (g) => g.map((v) => v.last_verified),
    ),
  ];
  for (const card of after) {
    const base = before.find((c) => c.id === card.id);
    if (!base) errors.push(`${card.id}: new products are not allowed in a re-verification`);
    else if (!isDeepStrictEqual(strip(base), strip(card)))
      errors.push(`${card.id}: only last_verified and source accessed dates may change in a re-verification`);
    else if (dates(card).some((d, i) => d < dates(base)[i]!))
      errors.push(`${card.id}: verification or access dates moved backwards`);
  }
  for (const card of before)
    if (!after.some((c) => c.id === card.id)) errors.push(`${card.id}: product removed`);
  return errors;
}
export function reverifySummary(before: Card[], after: Card[]) {
  return after.flatMap((card) => {
    const base = before.find((c) => c.id === card.id);
    if (!base) return [];
    const groups = (c: Card) => [
      { label: "fees", versions: c.fees },
      ...c.earn_rates.map((r) => ({ label: `earn_rates.${r.id}`, versions: r.versions })),
      ...c.credits.map((x) => ({ label: `credits.${x.id}`, versions: x.versions })),
    ];
    const old = groups(base);
    const networks =
      base.networks && card.networks && base.networks.last_verified !== card.networks.last_verified
        ? [
            {
              product_id: card.id,
              label: "networks",
              source: card.networks.source,
              from: base.networks.last_verified,
              to: card.networks.last_verified,
            },
          ]
        : [];
    return networks.concat(
      groups(card).flatMap((g, i) =>
        g.versions.flatMap((v, j) => {
          const from = old[i]?.versions[j]?.last_verified;
          return from && from !== v.last_verified
            ? [{ product_id: card.id, label: g.label, source: v.source, from, to: v.last_verified }]
            : [];
        }),
      ),
    );
  });
}

// Agent text goes into PR bodies: keep it on one line, inert in tables, and unable to mention anyone.
export const inline = (text: string) =>
  text.replace(/\s+/g, " ").replaceAll("|", "\\|").replaceAll("@", "@​").replaceAll("<", "&lt;").trim();
export function describeProduct(
  card: Card,
  submission: Submission,
  product: ProductSubmission,
  result: ProductResult,
) {
  const checked = submission.checked_at.slice(0, 10);
  const first = result.changes[0];
  const summary =
    result.changes.length === 1 && first
      ? `${first.label} ${first.field} ${first.before ?? "pending"} → ${first.after}`
      : `${result.changes.length} term changes`;
  const title = `${card.issuer} ${card.name}: ${summary} (checked ${checked})`.slice(0, 240);
  const rows = result.changes.map(
    (c) =>
      `| ${c.label}.${c.field} | ${c.before ?? "— (pending)"} | ${c.after} | ${
        !c.versioned
          ? "not effective-dated"
          : c.basis === "stated"
            ? `${c.effective_from} (stated)`
            : `between ${c.detected_after} and ${c.effective_from} (detected)`
      } |`,
  );
  const cited: (SubmissionSource & { title?: string })[] = [
    ...product.sources,
    ...(product.new_sources ?? []).filter((s) => result.changes.some((c) => c.source_id === s.source_id)),
  ];
  const evidence = cited.map((s) => {
    const notes = result.changes
      .filter((c) => c.source_id === s.source_id)
      .map((c) => `  - ${c.label}.${c.field}: ${inline(c.evidence)}`);
    return [
      `- ${s.title ? `New source "${inline(s.title)}"` : "Source"}: ${s.url} (\`${s.source_id}\`), fetched ${s.fetched_at.replace("T", " ").replace("Z", " UTC")}.`,
      ...new Set(notes),
    ].join("\n");
  });
  const human = [
    ...result.flags.map(
      (f) =>
        `- **${f.kind}**${f.target ? ` \`${f.target}\`` : ""}: ${inline(f.summary)}${f.evidence ? ` (${inline(f.evidence)})` : ""}`,
    ),
    ...result.skipped.map((s) => `- Not re-verified \`${s.target}\`: ${s.reason}.`),
  ];
  const body = `## What changed

| Field | Before | After | Effective from |
| --- | --- | --- | --- |
${rows.join("\n")}

## Evidence

${evidence.join("\n")}

${result.verified.length ? `Also re-verified ${result.verified.length} unchanged version(s) against the same sources.\n\n` : ""}## Needs a human

${human.length ? human.join("\n") : "- Nothing flagged."}

## Checks

- [x] \`pnpm validate --base-ref origin/main\`
- [x] \`pnpm build\`

Submitted by ${inline(submission.agent.name)} ${inline(submission.agent.version)}${submission.agent.model ? ` (model ${inline(submission.agent.model)})` : ""}, submission \`${submission.submission_id}\`. Values come only from the issuer sources above; please verify before merging.
`;
  return { title, body };
}
export function describeReverify(entries: ReturnType<typeof reverifySummary>, submissionId: string) {
  const latest =
    entries
      .map((e) => e.to)
      .sort()
      .at(-1) ?? "";
  const products = [...new Set(entries.map((e) => e.product_id))];
  const title = `Re-verify ${entries.length} version${entries.length === 1 ? "" : "s"} (checked ${latest})`;
  const body = `Re-verification only: each listed version's values were found unchanged on its issuer source, so only
\`last_verified\` and the source \`accessed\` date move forward. No values, dates or notes change; CI enforces this
with \`pnpm check-reverify-diff\`.

| Product | Versions | Checked |
| --- | --- | --- |
${products
  .map((id) => {
    const list = entries.filter((e) => e.product_id === id);
    return `| \`${id}\` | ${list.length} | ${[...new Set(list.map((e) => e.to))].sort().join(", ")} |`;
  })
  .join("\n")}

Latest submission: \`${submissionId}\`.
`;
  return { title, body };
}
