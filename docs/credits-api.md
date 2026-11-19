# Credits API for reimbursement trackers

Read-only JSON for applications that track card statement credits (reimbursements): which credits a
card has, their caps and periods over time, and the keywords that identify them on a statement. It is
the data side of the [credit progress contract](credit-progress.md); the application keeps the
transactions and does the matching and progress itself.

Asset Ledger is the first intended consumer, so this page ends with how it plugs in (§6). The general
envelope, errors, caching and the self-hosted server are described in the [API overview](api.md).

## 1. Design

- **Transactions never leave the application.** CardFacts publishes terms; matching and progress run where
  the ledger lives. No endpoint takes a transaction.
- **Every version, not only today's.** A tracker shows past benefit years and credits that post weeks
  after a period ends, so it needs each version with its `effective_from` and `effective_to`. The
  feed therefore has no `as_of`: for one `catalog_version` it is the same bytes on the static site, the
  server and the release download.
- **The contract's shape, unchanged.** Each credit is the record from `data/us/`, exactly as
  [credit-progress.md §1](credit-progress.md#1-credit-fields) describes it. The feed adds one field per
  version, `tracking`, and nothing else is renamed or reshaped.
- **The application decides.** `tracking` says whether the contract's rules can compute a version. It
  never hides a credit. The application chooses how to show what it cannot compute.

## 2. Endpoints

| Path                      | Content                                                      | Server-only parameters |
| ------------------------- | ------------------------------------------------------------ | ---------------------- |
| `credits.json`            | Every card that has at least one credit, with its credits    | `ids`, `issuer`        |
| `cards/{id}/credits.json` | One card, with an empty `credits` list when it has none      |                        |
| `credits/vectors.json`    | The contract's test vectors (`vectors/credit-progress.json`) |                        |

Base URLs are those of the [API overview](api.md): `https://weiqizhou2002.github.io/cardfacts/api/v1/` for
the static files, or `http://HOST:8787/api/v1/` for a self-hosted server.

- `ids`: comma-separated card ids, for example `ids=us-amex-gold,us-chase-sapphire-reserve`. An unknown id
  returns 404 `not_found`; an empty or malformed list returns 400 `invalid_ids`. Listed cards without
  credits are left out of `credits.json`.
- `issuer`: exact issuer name, as in `issuers.json`.

Filters only choose cards. A listed card always carries all of its credits and all of their versions.

```sh
curl https://weiqizhou2002.github.io/cardfacts/api/v1/credits.json
curl https://weiqizhou2002.github.io/cardfacts/api/v1/cards/us-amex-platinum/credits.json
curl "http://localhost:8787/api/v1/credits.json?ids=us-amex-gold,us-chase-sapphire-reserve"
```

## 3. Response

`credits.json`:

```json
{
  "api_version": 1,
  "catalog_version": "2026.11.19-draft",
  "license": "CC0-1.0",
  "data": {
    "contract": {
      "name": "credit-progress",
      "format_version": 1,
      "spec": "https://github.com/WeiqiZhou2002/cardfacts/blob/main/docs/credit-progress.md",
      "vectors": "credits/vectors.json"
    },
    "count": 56,
    "credits": 133,
    "cards": [
      {
        "id": "us-amex-gold",
        "name": "American Express Gold Card",
        "issuer": "American Express",
        "country": "US",
        "currency": "USD",
        "audience": "personal",
        "availability": "open",
        "aliases": [],
        "coverage": "reviewed",
        "sources": [
          { "id": "us-amex-gold-benefits", "url": "https://...", "title": "...", "accessed": "2026-10-28" }
        ],
        "credits": [
          {
            "id": "dining",
            "name": "Dining Credit",
            "category": "dining",
            "delivery": "statement_credit",
            "enrollment": "required",
            "match": { "keywords": ["DINING CREDIT"] },
            "versions": [
              {
                "effective_from": null,
                "effective_from_basis": "unknown",
                "effective_to": null,
                "status": "verified",
                "amount": "10.00",
                "period": "monthly",
                "reset_basis": "calendar",
                "period_boundaries": "stated",
                "max_posting_lag_days": null,
                "source": "us-amex-gold-benefits",
                "last_verified": "2026-10-28",
                "notes": "Participating Grubhub/Seamless, ...",
                "tracking": { "supported": true, "reasons": [] }
              }
            ]
          }
        ],
        "links": { "card": "cards/us-amex-gold.json", "credits": "cards/us-amex-gold/credits.json" }
      }
    ]
  }
}
```

`count` is the number of cards listed and `credits` the number of credits among them. The sample is
shortened. Values come from the live catalog.

`cards/{id}/credits.json` returns `{ "contract": {...}, "card": {...} }` with one card in the same form.
`credits/vectors.json` returns the vectors file as its `data`.

### 3.1 Card fields

| Field            | Meaning                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| `id`             | Stable product id. Store it on the owner's account once they pick the product.                         |
| `name`, `issuer` | Official names.                                                                                        |
| `currency`       | Currency of every `amount`. Entries in another currency are unmatched (`currency_mismatch`).           |
| `aliases`        | Uppercase phrases to suggest a product for an account; often empty. Never assign without confirmation. |
| `availability`   | `open`, `closed_to_new` or `discontinued`. Closed cards still have holders; keep them selectable.      |
| `coverage`       | `reviewed` when every credit on the product page is recorded, `partial` otherwise, or `null`.          |
| `sources`        | The sources the credit versions cite, so a tracker can link "see the issuer's terms".                  |
| `credits`        | In the order the UI should list them.                                                                  |

### 3.2 Credit and version fields

As in [credit-progress.md §1](credit-progress.md#1-credit-fields). The fields a tracker reads most:

| Field                              | Use                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `match.keywords`, `exclude`        | Normalize and match exactly as §2.4 of the contract; no regular expressions.                                          |
| `family`                           | Optional hint matching Asset Ledger's `BenefitFamily`, for the family fallback (§2.3 step 5).                         |
| `delivery`                         | Only `statement_credit` appears on a statement.                                                                       |
| `amount`, `period`, `period_years` | Cap per period. `amount` is `null` exactly when `status` is `to_verify`.                                              |
| `reset_basis`                      | How periods are cut; `anniversary` needs the account-open date, `anniversary_statement` also the statement close day. |
| `max_posting_lag_days`             | How late a credit may post and still belong to the previous period.                                                   |
| `cap_excludes_tax`                 | Enables the tax tolerance (§3.4).                                                                                     |
| `conditions`                       | Eligibility such as a minimum spend or stay; see §4.                                                                  |

### 3.3 `tracking`

Each version has `tracking: { supported, reasons }`. `supported` is `true` when `reasons` is empty.

| Reason                         | Meaning                                                                                                      | Suggested display                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `not_statement_credit`         | `issuer_wallet` (Uber Cash) or `in_app`; the value never appears as a statement credit                       | List the benefit without progress          |
| `reset_basis_outside_contract` | `month_after_annual_fee` or `qualifying_activity`; format_version 1 has no rule                              | Show the cap and terms, no progress        |
| `eligibility_conditions`       | The credit applies only after a condition the ledger may not see (minimum spend, nights, consecutive months) | Compute progress, label "conditions apply" |

A pending version (`status: "to_verify"`) is still `supported`: the contract already says what to do
with it (map entries, count nothing, show "awaiting verification").

## 4. Conditions

`conditions` comes from the [phase 2 catalog](data-model.md). The contract's progress rules do not
evaluate it. A tracker should not refuse to count a credit the issuer did post, so the suggested
behaviour is: compute progress from the cap and the posted credits as usual, and show the condition next
to the credit (for example "after $250 in purchases in the benefit year"). A credit that posted proves the
condition was met for that period.

| Condition            | Example                                              |
| -------------------- | ---------------------------------------------------- |
| `minimum_spend`      | `{ "amount": "250.00", "period": "benefit_period" }` |
| `minimum_nights`     | `2`                                                  |
| `consecutive_months` | `11`                                                 |

## 5. Versions, updates and pinning

- **Latest.** The static `credits.json` is rebuilt every day and follows the latest `catalog_version`. A
  server or client can poll it with `If-None-Match`; the self-hosted server answers 304.
- **Pinned.** Every catalog release also carries `credits.json`, byte for byte the static file of that
  version, listed in the release's `SHA256SUMS`:

  ```sh
  curl -LO https://github.com/WeiqiZhou2002/cardfacts/releases/download/catalog-<version>/credits.json
  curl -LO https://github.com/WeiqiZhou2002/cardfacts/releases/download/catalog-<version>/SHA256SUMS
  shasum -a 256 -c SHA256SUMS --ignore-missing
  ```

- **Compatibility.** Check `api_version` (1) and `data.contract.format_version` (1). A change to the
  matching or progress rules bumps `format_version` and lands in the vectors first. New fields may appear
  in `api_version` 1; existing ones keep their meaning.
- **Product ids** are never reused. A credit id is stable within its product, so owner choices keyed on
  `product id + credit id` survive catalog updates.

The data is a draft. A tracker should say so and link the cited source next to each figure.

## 6. Asset Ledger integration

Asset Ledger already detects benefit credits (`detectBenefit`) and lists them per card by a short name
(`benefitOverview` in `apps/web/lib/benefits/queries.ts`). The catalog adds caps, periods and progress on
top of that, without changing detection.

1. **Load the feed.** Vendor a pinned `credits.json` (and `credits/vectors.json` for tests) into the
   repository, or fetch the latest daily on the server and cache it by `catalog_version`. Asset Ledger is
   self-hosted, so either works; pinning keeps every install on the same numbers.
2. **Pick a product per card.** On a `liability_credit_card` account, suggest products whose `aliases`
   hit the institution plus account name (normalized as §2.4), and save `product_id` only after the owner
   confirms. Store the account-open date and statement close day when a credit needs them.
3. **Map at read time.** For the entries `benefitRecords` returns, run the contract's matching order
   (§2.3), including the family fallback with `family`. Store only owner choices: an assignment, an
   explicit none, a pinned period, an amount override, a disabled credit, a tracking start.
4. **Compute progress** per §3 of the contract for versions with `tracking.supported`, and show the others
   by their reason (§3.3 above). Unmatched entries stay in today's `byName` groups.
5. **Test with the vectors.** Run `credits/vectors.json` in Vitest; an implementation is correct when it
   reproduces all of them.

Minimal TypeScript types for the feed:

```ts
type Decimal = string;
type IsoDate = string;

export interface CreditFeed {
  api_version: 1;
  catalog_version: string;
  license: "CC0-1.0";
  data: {
    contract: { name: "credit-progress"; format_version: 1; spec: string; vectors: string };
    count: number;
    credits: number;
    cards: FeedCard[];
  };
}
export interface FeedCard {
  id: string;
  name: string;
  issuer: string;
  country: "US";
  currency: "USD";
  audience: "personal" | "business";
  availability: "open" | "closed_to_new" | "discontinued";
  aliases: string[];
  coverage: "partial" | "reviewed" | null;
  sources: { id: string; url: string; title: string; kind?: string; accessed: IsoDate }[];
  credits: FeedCredit[];
  links: { card: string; credits: string };
}
export interface FeedCredit {
  id: string;
  name: string;
  category: string;
  family?: string;
  delivery: "statement_credit" | "issuer_wallet" | "in_app";
  enrollment: "required" | "activation" | "none" | "unknown";
  match: { keywords: string[]; exclude?: string[] };
  versions: FeedVersion[];
}
export interface FeedVersion {
  effective_from: IsoDate | null;
  effective_from_basis: "unknown" | "stated" | "detected";
  effective_to: IsoDate | null;
  status: "verified" | "to_verify";
  amount: Decimal | null;
  period: "monthly" | "quarterly" | "semiannual" | "annual" | "multi_year";
  period_years?: number;
  reset_basis:
    | "calendar"
    | "anniversary"
    | "anniversary_statement"
    | "since_last_credit"
    | "month_after_annual_fee"
    | "qualifying_activity";
  period_boundaries: "stated" | "inferred";
  cap_excludes_tax?: boolean;
  per_transaction_cap?: Decimal;
  max_posting_lag_days: number | null;
  conditions?: {
    minimum_spend?: { amount: Decimal; period: "transaction" | "benefit_period" | "previous_calendar_year" };
    minimum_nights?: number;
    consecutive_months?: number;
  };
  source: string;
  last_verified: IsoDate;
  notes: string;
  tracking: {
    supported: boolean;
    reasons: ("not_statement_credit" | "reset_basis_outside_contract" | "eligibility_conditions")[];
  };
}
```
