import type { Card, Version } from "../scripts/lib/types.js";
import type { Revision } from "../scripts/lib/revisions.js";
import { isDate, isTimestamp } from "../scripts/lib/primitives.js";
import { revisionAt, termsAt } from "../scripts/lib/temporal.js";

export type Lang = "zh" | "en";
export type Page = "catalog" | "card" | "compare" | "review" | "about" | "404";
export interface Category {
  id: string;
  name: Record<Lang, string>;
}
export interface SiteData {
  cards: Card[];
  revisions: Revision[];
  earnCategories: Category[];
  creditCategories: Category[];
  version: string;
  asOf: string;
  base: string;
  repository: string;
}
export interface Context {
  data: SiteData;
  lang: Lang;
  page: Page;
  productId?: string;
  params: URLSearchParams;
  asOf: string;
  reviewOn: string;
  selected: string[];
  error?: string;
}
export const t = (ctx: Pick<Context, "lang">, zh: string, en: string) => (ctx.lang === "zh" ? zh : en);
export const h = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
export const scriptJson = (value: unknown) =>
  JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
export function normalizeBase(base: string) {
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base))
    throw new Error("SITE_BASE_PATH must be / or /path/ with a trailing slash");
  return base;
}
export function href(ctx: Context, path = "", params?: Record<string, string | undefined>, lang = ctx.lang) {
  const query = new URLSearchParams();
  if (ctx.params.has("asof")) query.set("asof", ctx.asOf);
  if (ctx.selected.length) query.set("cards", ctx.selected.join(","));
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value) query.set(key, value);
    else query.delete(key);
  }
  return `${ctx.data.base}${lang === "en" ? "en/" : ""}${path}${query.size ? `?${query}` : ""}`;
}
export function context(
  data: SiteData,
  page: Page,
  lang: Lang,
  params = new URLSearchParams(),
  productId?: string,
  today = data.asOf,
): Context {
  let error: string | undefined;
  const asOf = params.get("asof") ?? today;
  const reviewOn = params.get("review_on") ?? today;
  if (!isDate(asOf) || !isDate(reviewOn))
    error = lang === "zh" ? "日期无效，请选择有效的日期。" : "Invalid date. Choose a valid calendar date.";
  const selected = [...new Set((params.get("cards") ?? "").split(","))]
    .filter((id) => data.cards.some((c) => c.id === id))
    .slice(0, 4);
  const recorded = params.get("recorded_at");
  if (recorded !== null && !isTimestamp(recorded))
    error =
      lang === "zh" ? "收录时间无效，必须使用 UTC 时间。" : "Invalid recorded time; use a UTC timestamp.";
  if (params.has("revision") && params.has("recorded_at"))
    error =
      lang === "zh"
        ? "请只选择收录版本或收录时间中的一项。"
        : "Choose either a revision or a recorded timestamp.";
  const rate = params.get("min_rate");
  if (rate && (!/^\d+(?:\.\d+)?$/.test(rate) || !Number.isFinite(Number(rate))))
    error = lang === "zh" ? "最低返现数值无效。" : "Invalid minimum earn rate.";
  return {
    data,
    page,
    lang,
    params,
    productId,
    asOf: isDate(asOf) ? asOf : today,
    reviewOn: isDate(reviewOn) ? reviewOn : today,
    selected,
    error,
  };
}
export function selectedRevision(ctx: Context): Revision | null {
  if (!ctx.productId) return null;
  const id = ctx.params.get("revision");
  if (id) return ctx.data.revisions.find((r) => r.product_id === ctx.productId && r.id === id) ?? null;
  if (ctx.error) return null;
  return revisionAt(ctx.data.revisions, ctx.productId, ctx.params.get("recorded_at") ?? undefined);
}
export const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en-US").trim();
export function filterCards(ctx: Context): Card[] {
  const p = ctx.params;
  const query = normalize(p.get("q") ?? "");
  return ctx.data.cards
    .filter((card) => {
      if (query && !normalize([card.name, card.issuer, card.id, ...card.aliases].join(" ")).includes(query))
        return false;
      if (p.get("audience") && card.audience !== p.get("audience")) return false;
      if (p.get("issuer") && card.issuer !== p.get("issuer")) return false;
      if (p.get("unit") && card.rewards.unit !== p.get("unit")) return false;
      const terms = termsAt(card, ctx.asOf);
      const fee = terms.fees?.version.status === "verified" ? terms.fees.version.annual_fee : null;
      if (p.get("fee")) {
        if (p.get("fee") === "unknown") {
          if (fee !== null) return false;
        } else if (fee === null) return false;
        else {
          const value = Number(fee);
          if (p.get("fee") === "free" && value !== 0) return false;
          if (p.get("fee") === "low" && !(value > 0 && value < 100)) return false;
          if (p.get("fee") === "mid" && !(value >= 100 && value < 400)) return false;
          if (p.get("fee") === "high" && value < 400) return false;
        }
      }
      if (
        p.get("credit") &&
        !terms.credits.some((c) => c.category === p.get("credit") && c.version.status === "verified")
      )
        return false;
      if (p.get("earn") || p.get("min_rate")) {
        if (
          !terms.earn_rates.some(
            (r) =>
              (!p.get("earn") ||
                r.category === p.get("earn") ||
                r.version.conditions.selection?.categories.includes(p.get("earn")!)) &&
              r.version.status === "verified" &&
              Number(r.version.rate) >= Number(p.get("min_rate") || 0),
          )
        )
          return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (p.get("sort") === "fee") {
        const fee = (c: Card) => {
          const v = termsAt(c, ctx.asOf).fees?.version;
          return v?.status === "verified" ? Number(v.annual_fee) : Infinity;
        };
        const difference = fee(a) - fee(b);
        if (difference && Number.isFinite(difference)) return difference;
        if (fee(a) !== fee(b)) return fee(a) < fee(b) ? -1 : 1;
      }
      return a.issuer.localeCompare(b.issuer, "en") || a.name.localeCompare(b.name, "en");
    });
}
export interface ReviewItem {
  card: Card;
  section: "fees" | "earn" | "credits";
  name: string;
  version: Version;
  age: number;
  pending: boolean;
  stale: boolean;
}
export function reviewItems(cards: Card[], date: string): ReviewItem[] {
  if (!isDate(date)) throw new Error("Invalid review date");
  return cards
    .flatMap((card) =>
      [
        ...card.fees.map((version) => ({ section: "fees" as const, name: "Annual fee", version })),
        ...card.earn_rates.flatMap((r) =>
          r.versions.map((version) => ({ section: "earn" as const, name: r.id, version })),
        ),
        ...card.credits.flatMap((c) =>
          c.versions.map((version) => ({ section: "credits" as const, name: c.name, version })),
        ),
      ].flatMap((item) => {
        const age = Math.floor((Date.parse(date) - Date.parse(item.version.last_verified)) / 86400000);
        const pending = item.version.status === "to_verify";
        return pending || age > 90 ? [{ ...item, card, age, pending, stale: age > 90 }] : [];
      }),
    )
    .sort(
      (a, b) =>
        Number(b.pending) - Number(a.pending) ||
        b.age - a.age ||
        a.card.name.localeCompare(b.card.name, "en"),
    );
}
export const dollars = (amount: string | null | undefined) =>
  amount == null ? "—" : `$${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
export const rate = (card: Card, value: string | null) =>
  value === null ? "—" : `${value}${card.rewards.unit === "cash" ? "%" : "×"}`;
export function category(ctx: Context, kind: "earn" | "credit", id: string) {
  return (
    (kind === "earn" ? ctx.data.earnCategories : ctx.data.creditCategories).find((c) => c.id === id)?.name[
      ctx.lang
    ] ?? id
  );
}
export function reportLink(ctx: Context, card?: Card) {
  return `${ctx.data.repository}/issues/new?${new URLSearchParams({ template: "change-report.yml", title: `[Change] ${card?.name ?? "Card terms"}` })}`;
}
