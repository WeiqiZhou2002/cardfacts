import { canonical, compare, isDate, isTimestamp } from "./primitives.js";
import type { Card, Version } from "./types.js";
import type { Revision } from "./revisions.js";

export function revisionAt(revisions: Revision[], productId: string, recordedAt?: string): Revision | null {
  if (recordedAt !== undefined && !isTimestamp(recordedAt))
    throw new Error("--recorded-at must be a UTC timestamp YYYY-MM-DDTHH:mm:ssZ");
  return (
    revisions
      .filter((r) => r.product_id === productId && (!recordedAt || r.recorded_at <= recordedAt))
      .sort((a, b) => compare(a.recorded_at, b.recorded_at))
      .at(-1) ?? null
  );
}
export function termsAt(card: Card, date: string) {
  if (!isDate(date)) throw new Error("--as-of must be a valid YYYY-MM-DD date");
  function select<T extends Version>(versions: T[]) {
    const version = versions.find(
      (v) =>
        (v.effective_from === null || v.effective_from <= date) &&
        (v.effective_to === null || v.effective_to >= date),
    );
    if (!version) return null;
    return {
      certainty:
        version.status === "to_verify"
          ? "to_verify"
          : version.effective_from === null
            ? "unknown_start"
            : version.effective_from_basis === "detected"
              ? "detected_start"
              : "stated",
      version,
    };
  }
  return {
    product_id: card.id,
    as_of: date,
    fees: select(card.fees),
    earn_rates: card.earn_rates.flatMap(({ versions, ...rule }) => {
      const match = select(versions);
      return match ? [{ ...rule, ...match }] : [];
    }),
    credits: card.credits.flatMap(({ versions, ...credit }) => {
      const match = select(versions);
      return match ? [{ ...credit, ...match }] : [];
    }),
  };
}
export function revisionDiff(before: Revision, after: Revision) {
  if (before.product_id !== after.product_id)
    throw new Error("Can only compare revisions of the same product");
  const changes: { path: string; before: unknown; after: unknown }[] = [];
  function walk(a: unknown, b: unknown, path: string) {
    if (canonical(a) === canonical(b)) return;
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      a.forEach((value, i) => walk(value, b[i], `${path}/${i}`));
    } else if (
      a &&
      b &&
      typeof a === "object" &&
      typeof b === "object" &&
      !Array.isArray(a) &&
      !Array.isArray(b)
    ) {
      const left = a as Record<string, unknown>;
      const right = b as Record<string, unknown>;
      for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort(compare))
        walk(left[key], right[key], `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`);
    } else changes.push({ path, before: a ?? null, after: b ?? null });
  }
  walk(before.product, after.product, "");
  return { product_id: before.product_id, from: before.id, to: after.id, changes };
}
