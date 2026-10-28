# Data contract, schema version 2

`schema/card.schema.json` is the production shape. `pnpm validate` additionally checks references,
issuer domains, categories, dates, intervals, keywords and configuration. Validation is offline: source
availability is checked by maintenance, never by ordinary CI.

## Files and identifiers

- One product per `data/us/<issuer-id>/<product-id>.json`; product IDs start with `us-<issuer-id>-`.
- Product IDs are globally unique; credit and earn-rule IDs are unique within a product.
- Source IDs are globally unique, including across products, so `fetch-source ID` is unambiguous.
  Two products may cite the same URL with different IDs. The fetch cache deduplicates by exact URL.
- Product `country` and `currency` are explicitly `US` and `USD`.
- Both personal and business products use the same schema. Reward program IDs are stable catalog
  identifiers, not a separate program vocabulary yet.

## Versioned terms

Fees, earn rules and credits have ordered, non-overlapping versions. End dates are inclusive; a version
ending January 1 overlaps one starting January 1. Gaps are allowed. Only the first version may have a
null start; only the last may have a null end.

| Start and basis   | Meaning                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `null`, `unknown` | Initial terms whose historical start has not been established      |
| date, `stated`    | The source states the effective date                               |
| date, `detected`  | A change was observed, but the source did not state its start date |

Do not turn an unknown start into the migration or verification date. An observation date is not an
issuer-announced effective date. Future announced terms may be added before they start.

Production statuses are `verified` and `to_verify`. The primary value (`annual_fee`, `rate`, or `amount`)
is null exactly when the version is `to_verify`. Optional fee fields may remain null on a verified fee
version; explain unknown versus inapplicable fields in notes. Zero is a known value, never a substitute
for null. Money has two decimal places; rates are non-negative decimal strings. Cash rates are
percentages, points/miles rates are units per dollar.

Every version has a source ID, verification date and short paraphrased notes. Its source must resolve
within the product and use an HTTPS domain belonging to that issuer, not merely any issuer. The source's
`accessed` date cannot precede a referencing version's `last_verified`. For pending records, the date
records the last attempted verification; status still prevents use as confirmed terms.

Earn `conditions` and `cap` live inside each version. Conditions support channel, merchants, region,
activation and prepaid bookings. `cap: null` means no structured cap is recorded; it does not prove
unlimited earning. Shared caps reference existing sibling rule IDs; all participating rules must be
reviewed together. Validation checks symmetric membership, amounts, periods and reset bases for overlapping versions.

Credit category, matching and delivery retain the consumer contract in `credit-progress.md`. A category's
suggested family does not replace a credit's explicitly curated `family`. Wallet and in-app credits may
have empty keyword lists and never participate in statement-credit progress. Nonuniform wallet benefits,
such as a December bonus, remain described in notes; consumers must not derive their full annual value
by simply multiplying the regular amount.

## History

Close a current version and append its replacement when financial terms or eligibility change. A genuine
eligibility change belongs in a new version even if only notes express it. Editorial notes corrections
and re-verification dates can be updated without a new effective terms version, but always require a new full catalog snapshot.

`pnpm validate --base-ref REV` compares against a Git revision. It rejects removed products/rules/versions,
rewritten version terms, changed start dates, changed already-closed end dates, backward verification
dates, and rewritten historical source URLs. Closing an open version is permitted. Add a new source ID
when an issuer moves a URL; retain the previous citation. Credit-level matching and display metadata are
curated separately and preserved in full snapshots. CI cannot determine whether a notes edit is editorial; reviewers must check it.

## Progress fixtures and builds

`vectors/credit-progress.json` keeps its original compact fixture format, including `synthetic` versions.
`schema/vectors.schema.json` validates that format separately. Fixtures intentionally omit product
metadata and provenance. Their implicit delivery is `statement_credit`, with no enrollment requirement
used in calculations. No production-schema relaxation is made for them.

The 23 existing expected results are unchanged. Consumers implement the calculation and run behavioral
conformance against these vectors; CardFacts checks fixture structure and term invariants, not a second
progress implementation.

`catalog.json` pins `schema_version`, `catalog_version` and license. Build output is
`{ schema_version, catalog_version, license, products }`. Products are sorted by ID; arrays within each
product preserve their curated order. There are no build timestamps. Update the catalog version when
preparing a release; build never chooses a date from the machine clock.

## Phase 2 conditions and snapshots

`network: null` means not confirmed. Optional `coverage` describes review scope for fees, earn rates and
credits (`reviewed` or `partial`); omitted coverage is unknown, not complete.

Earn conditions additionally support `online_only`, `requires_payment`, `minimum_transaction_amount`,
and `time_window` (start weekdays, local start/end times and IANA timezone). When end precedes start,
the window ends on the following day; weekdays identify the starting day. These are eligibility
conditions, not a request to add overlapping rates together. Rates are issuer-advertised total rates.

`selection` has two forms:

- `top_spend`: `count` of categories chosen automatically from `categories` each `billing_cycle`. A rule
  earns its bonus only when its category is selected. Each participant references the same annual shared
  cap. Ranking/tie behavior still follows issuer terms.
- `rotating`: explicit `categories` and `merchants` form a union of eligible spending, narrowed by other
  conditions and notes. The version must have a start and end date. An unpublished quarter has no version.

Credit version `conditions` can state `minimum_spend` (a transaction, benefit period, or prior calendar
year), `minimum_nights`, or `consecutive_months`. Merchant and program restrictions in notes must also
be honored. A known maximum amount is not a guarantee of eligibility.

Special annual reset bases are `month_after_annual_fee` (first period at opening, renewal on the first day
of the month after annual-fee assessment) and `qualifying_activity` (requires consecutive eligible
calendar months; the consumer needs activity history and issuer timing rules). Neither may be treated
as an ordinary opening anniversary. The original progress fixtures do not cover these additions.

Each changed product must have a new `history/<product-id>/<revision-id>.json`. A revision records
`format_version`, ID, product ID, UTC `recorded_at`, reason, canonical content SHA-256 and a complete
`product`. The latest snapshot must equal current data. Against a Git base, old snapshots are immutable
and additions must follow existing recorded times. Historical snapshots are also schema/semantically
validated; future schema migrations must preserve readers for old immutable records.

Build adds `{ format_version: 1, revisions }` in `history.json`. See [history.md](history.md) for queries,
certainty labels and examples, [Phase 2 coverage](phase-2-catalog.md) for evidence limits, and
[the decision](adr/0001-effective-terms-and-catalog-revisions.md) for the two time axes.
