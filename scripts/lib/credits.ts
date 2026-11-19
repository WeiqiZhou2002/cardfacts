import type { Card, Catalog, CreditVersion } from "./types.js";

// The credit feed for reimbursement trackers. Each credit keeps the exact shape of the credit progress
// contract (docs/credit-progress.md §1) and every version, so a tracker can map statement credits and
// compute past benefit years on its own device. The feed does not depend on a terms date, so the static
// file, the server response and the release download are the same bytes for one catalog version.
export const CONTRACT = {
  name: "credit-progress",
  format_version: 1,
  spec: "https://github.com/WeiqiZhou2002/cardfacts/blob/main/docs/credit-progress.md",
  vectors: "credits/vectors.json",
};
// Reset bases the format_version 1 rules compute. The others need rules a tracker must add itself.
const CONTRACT_RESETS = ["calendar", "anniversary", "anniversary_statement", "since_last_credit"];
export type TrackingReason =
  "not_statement_credit" | "reset_basis_outside_contract" | "eligibility_conditions";

export function tracking(
  delivery: Card["credits"][number]["delivery"],
  version: CreditVersion,
): { supported: boolean; reasons: TrackingReason[] } {
  const reasons: TrackingReason[] = [];
  if (delivery !== "statement_credit") reasons.push("not_statement_credit");
  if (!CONTRACT_RESETS.includes(version.reset_basis)) reasons.push("reset_basis_outside_contract");
  if (version.conditions && Object.keys(version.conditions).length) reasons.push("eligibility_conditions");
  return { supported: reasons.length === 0, reasons };
}

export function creditCard(card: Card) {
  const used = new Set(card.credits.flatMap((c) => c.versions.map((v) => v.source)));
  return {
    id: card.id,
    name: card.name,
    issuer: card.issuer,
    country: card.country,
    currency: card.currency,
    audience: card.audience,
    availability: card.availability,
    aliases: card.aliases,
    coverage: card.coverage?.credits ?? null,
    sources: card.sources.filter((s) => used.has(s.id)),
    credits: card.credits.map((credit) => ({
      ...credit,
      versions: credit.versions.map((v) => ({ ...v, tracking: tracking(credit.delivery, v) })),
    })),
    links: { card: `cards/${card.id}.json`, credits: `cards/${card.id}/credits.json` },
  };
}

// Every card with at least one credit, in catalog order.
export function creditFeed(catalog: Catalog, cards: Card[] = catalog.cards) {
  const listed = cards.filter((c) => c.credits.length > 0);
  return {
    contract: CONTRACT,
    count: listed.length,
    credits: listed.reduce((n, c) => n + c.credits.length, 0),
    cards: listed.map(creditCard),
  };
}
