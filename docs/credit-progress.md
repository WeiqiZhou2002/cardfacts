# Credit mapping and progress rules

How an application maps the statement credits it sees on a card to CardFacts credits, and how it computes
per-period progress. The [test vectors](../vectors/credit-progress.json) are the contract: an implementation
is correct when it reproduces every vector. Asset Ledger (TypeScript) and Sure (Ruby) are the first intended
implementations; neither shares code with the other or with this repository.

Product-level fields (fees, earn rates, audience) are described in the [proposal](proposal.zh.md) §4. Production
records live in [data/us/](../data/us/); the authoritative additions are documented in [data-model.md](data-model.md).

## 1. Credit fields

Product:

| Field      | Type       | Meaning                                                                           |
| ---------- | ---------- | --------------------------------------------------------------------------------- |
| `id`       | string     | Stable slug, `<country>-<issuer>-<product>`. Never reused for another product.    |
| `issuer`   | string     | Official issuer name.                                                             |
| `name`     | string     | Official product name, without trademark symbols.                                 |
| `country`  | ISO 3166-1 | Market whose terms are catalogued.                                                |
| `currency` | ISO 4217   | Currency of every `amount` in the product.                                        |
| `aliases`  | string[]   | Uppercase phrases used only to suggest a product for an account, never to assign. |
| `sources`  | object[]   | `{ id, url, title, accessed }`, referenced by versions.                           |
| `notes`    | string     | Free text for reviewers.                                                          |
| `credits`  | object[]   | Ordered as the UI should list them.                                               |

Credit:

| Field        | Type     | Meaning                                                                                                    |
| ------------ | -------- | ---------------------------------------------------------------------------------------------------------- |
| `id`         | string   | Stable slug, unique within the product. Owner choices reference `product id + credit id`.                  |
| `name`       | string   | Official credit name in the issuer's language.                                                             |
| `category`   | string   | Credit vocabulary ID; does not replace a curated family fallback.                                          |
| `family`     | string?  | Optional hint matching Asset Ledger's `BenefitFamily`; used only by the fallback in §2.3. Sure ignores it. |
| `delivery`   | enum     | `statement_credit` (trackable), `issuer_wallet` (e.g. Uber Cash) or `in_app` (merchant-side promos).       |
| `enrollment` | enum     | `required`, `activation`, `none` or `unknown`. Informational in v1.                                        |
| `match`      | object   | `{ keywords: string[], exclude?: string[] }`, see §2.4.                                                    |
| `versions`   | object[] | Terms over time, non-overlapping, ordered by `effective_from`.                                             |

Version:

| Field                  | Type            | Meaning                                                                                                                          |
| ---------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `effective_from`       | date \| null    | First day these terms apply. `null` means not stated by a cited source; see §3.3.                                                |
| `effective_from_basis` | enum            | `unknown` with null start; otherwise `stated` or `detected`. Production provenance metadata.                                     |
| `effective_to`         | date \| null    | Last day these terms apply (inclusive); `null` means open-ended.                                                                 |
| `status`               | enum            | `verified` (amount cited), `to_verify` (no progress computed), `synthetic` (compact test fixtures only, rejected in production). |
| `amount`               | decimal string  | Cap per period in the product currency. `null` exactly when `status` is `to_verify`.                                             |
| `period`               | enum            | `monthly`, `quarterly`, `semiannual`, `annual` or `multi_year`.                                                                  |
| `period_years`         | integer         | Only with `multi_year`, e.g. `4`.                                                                                                |
| `reset_basis`          | enum            | `calendar`, `anniversary`, `anniversary_statement` (annual only) or `since_last_credit` (multi-year only).                       |
| `period_boundaries`    | enum            | `stated` when the source names the boundaries, `inferred` when only the cadence is stated.                                       |
| `cap_excludes_tax`     | boolean         | Default `false`. `true` when terms say "plus applicable taxes"; enables the tolerance in §3.4.                                   |
| `per_transaction_cap`  | decimal string? | Informational (e.g. $250 per stay). Progress uses `amount` only.                                                                 |
| `max_posting_lag_days` | integer \| null | Longest delay the issuer states between purchase and credit; `null` when not stated (treated as 0).                              |
| `source`               | string          | A product `sources[].id`.                                                                                                        |
| `last_verified`        | date            | When a person or agent last checked the source; pending records retain their attempted-check date.                               |
| `notes`                | string          | Paraphrase of the relevant terms. Never paste issuer text at length.                                                             |

Invariants checked in CI: unique ids; `source` resolves; `amount` is `null` exactly for `to_verify`;
`multi_year` pairs with `since_last_credit` and nothing else does; `anniversary_statement` only with
`annual`; versions of a credit do not overlap; keywords are non-empty after normalization (§2.4) for
`statement_credit` credits.

## 2. Mapping detected credits to catalog credits

### 2.1 Inputs

Each project first decides which entries are benefit credits; the catalog only maps them.

- Asset Ledger: confirmed `refund` entries on `liability_credit_card` with `benefit_credit = true`,
  excluding Offers, exactly the rows `benefitRecords` in [queries.ts](https://github.com/WeiqiZhou2002/AssetLedger/blob/main/apps/web/lib/benefits/queries.ts)
  already loads. Detection stays in `detectBenefit` and its rescans.
- Sure: inflow entries (negative `amount`) of `kind = standard`, not part of a transfer, on a `CreditCard`
  account that has a catalog product, whose text matches a keyword of that product.

A credit entry, for mapping and progress, is `{ id, date, amount, currency, description, merchant, family? }`
where `amount` is a positive decimal string (Sure negates its entry amount) and `date` is the entry's
booking date: Asset Ledger `posted_date ?? event_date`, as `benefitOverview` uses today; Sure
`entries.date`.

### 2.2 Card product

An account is tracked only after the owner selects a catalog product for it. `aliases`, matched with the
§2.4 rules against institution plus account name, may pre-select a suggestion in the form; the suggestion
is never saved without the owner's confirmation.

### 2.3 Matching order

For one entry on an account with product `P`:

1. No product → unmatched, reason `no_product`.
2. Entry currency differs from `P.currency` → unmatched, `currency_mismatch` (no FX conversion).
3. Owner assignment exists:
   - explicit none → unmatched, `owner_none`;
   - a credit id → that credit, provided some version is effective at the entry date (or at the assigned
     period start), otherwise `no_effective_version`.
4. Keywords, over `P`'s `statement_credit` credits:
   - skip a credit whose `exclude` keywords hit;
   - a credit is a candidate when a keyword hits and some version is effective at the entry date, where
     "effective" extends `effective_to` by `max_posting_lag_days` so a late credit for an ended benefit
     still maps;
   - the candidate with the longest hitting keyword (Unicode code points) wins; a tie at the top length
     → unmatched, `ambiguous`;
   - keywords that hit only out-of-effect credits → `no_effective_version`.
5. Family fallback (Asset Ledger only): when the entry's `benefit_family` equals the `family` of exactly
   one effective credit, choose it; more than one → `ambiguous`.
6. Otherwise unmatched, `no_match`.
7. If the chosen credit is disabled by the owner for this account → unmatched, `credit_disabled`.

Unmatched entries stay in the application's existing display (Asset Ledger, for example, groups them by a
short credit name). The reason is for diagnostics and tests.

Implementations should compute matching at read time and store only owner choices, so a catalog update
applies immediately without rescanning transactions.

### 2.4 Keyword normalization

Both implementations must normalize identically; no regular-expression dialect is involved in matching:

1. `text = (description ?? "") + " " + (merchant ?? "")`.
2. Unicode NFKC, then Unicode default uppercase (`toUpperCase` / `String#upcase`).
3. Replace each run of characters that are not letters (`\p{L}`), digits (`\p{N}`), `+` or `&` with one
   space; trim.
4. Wrap in single spaces. A keyword, normalized by steps 2–3, hits when `" " + keyword + " "` occurs in
   the wrapped text.

So `FLIX` matches `flix credit` and `ＦＬＩＸ ＣＲＥＤＩＴ` (full-width) but not `FLIXPREMIUM`, and `FLIX PREMIUM`
matches `FLIX-PREMIUM*CREDIT`.

## 3. Periods and progress

### 3.1 Dates and arithmetic

- All dates are owner-local calendar dates (ISO `YYYY-MM-DD`), no times or time zones.
- `add_months(anchor, n)`: same day-of-month in the target month, clamped to its last day, always
  computed from the original anchor, never iteratively. `add_years(a, n) = add_months(a, 12n)`; a
  29 February anchor gives 28 February in common years. Ruby's `Date#>>` behaves this way; TypeScript
  needs a small helper.
- Money is decimal throughout (`decimal.js` via `lib/money`, `BigDecimal` in Ruby). Tolerances round half
  up to cents. Vector money values compare as decimals, not strings.

### 3.2 Reset bases and period boundaries

| `reset_basis`           | Needs                           | Periods                                                                                                                                                                       |
| ----------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calendar`              | —                               | Calendar months; quarters starting January, April, July, October; halves January–June and July–December; calendar years.                                                      |
| `anniversary`           | account anniversary `A`         | Period `m` starts at `add_months(A, m × step)` (step 1, 3, 6 or 12) and ends the day before the next start. The benefit year is `[add_years(A, k), add_years(A, k + 1) − 1]`. |
| `anniversary_statement` | `A` and statement close day `d` | Annual only. `S_k` = first date on or after `add_years(A, k)` whose day is `min(d, days in month)`. Year 1 is `[A, S_1]`; year `k` is `[S_(k−1) + 1, S_k]`.                   |
| `since_last_credit`     | —                               | Multi-year only; see §3.6.                                                                                                                                                    |

The anniversary is the account-open date. When a basis needs it and it is missing, the credit's status is
`needs_anniversary`; when the statement close day is missing, `needs_statement_day`. Matched entries are
still listed, but no periods are computed and nothing is guessed. Other credits on the card still compute
(vector bt-012).

Periods ending before the account-open date or the owner's tracking start (§3.3) are dropped; a period
straddling either date is kept whole, never prorated.

### 3.3 Versions, effective dates and tracking start

- Each version generates its own periods, intersected with `[effective_from, effective_to]`; a period cut
  by a version boundary keeps the full cap. Issuer changes almost always fall on period boundaries.
- Versions with `status: "to_verify"` generate no periods. Their entries still map (so the UI can say the
  credit is awaiting verification) but count nowhere.
- `effective_from: null` means the cited sources do not say when the terms began. Implementations treat
  it as open-ended in the past; to avoid applying today's terms to old years, each tracked account has an
  optional tracking start (default: none), and the UI labels such terms as of `last_verified`.

### 3.4 Caps, overrides and tax tolerance

- A period's cap is the version `amount`, unless the owner has an amount override for this account and
  credit whose `effective_from` (or `null` = always) is on or before the period start; the latest such
  override wins. Overrides never edit the catalog.
- A disabled credit is hidden and its entries become unmatched with `credit_disabled`.
- When `cap_excludes_tax` is true, tolerance = `round_half_up(cap × 0.15, 2)`; otherwise 0. The 0.15 is an
  engineering constant shared by the vectors, not an issuer figure. A period is over cap only above
  `cap + tolerance`.

### 3.5 Allocation and credits that post in the next period

Issuers assign a credit to the period of the purchase, but the credit can post days or weeks later, so a
credit dated early in a period may belong to the previous one. Neither project links credits to purchases,
so the default is the credit's own date, corrected only when that date produces an impossible result:

1. Place owner-pinned entries in the period whose start equals the pinned date. A pin to a date that is
   not a period start leaves the entry unplaced.
2. Place every other entry, ordered by `(date, id)`, in the period containing its date. An entry after the
   last period (a late credit past `effective_to`) becomes an orphan.
3. For each period `k` in chronological order, while `used(k) > cap(k) + tolerance(k)`: take the earliest
   unpinned entry `e` in `k`, in `(date, id)` order, for which some earlier period `j` satisfies
   `date(e) ≤ end(j) + max_posting_lag_days` and `cap(j) + tolerance(j) − used(j) ≥ amount(e)`; move `e`
   to the latest such `j`. Stop when the period is within cap or no entry can move.
4. Place each orphan the same way; an orphan that fits nowhere is reported as unplaced.

Properties: periods never become over cap because of a move; nothing moves unless a period is over cap;
an entry moves at most once; the result is deterministic. Documented limitation (vector bt-004): a
January credit for a December purchase stays in January when January has room. The owner fixes it with a
pin; a period still over cap after allocation reports `excess`, which usually means a mis-mapped credit.

### 3.6 Multi-year credits

For `multi_year` with `since_last_credit` (trusted-traveler fees), the first mapped credit opens a window
`[date, add_years(date, period_years) − 1]`. Later credits inside the window join it; the next credit
after it opens a new window. Issuers grant one credit per window, so while a window covers the reference
date the credit is `eligible: false` and reports `next_eligible_on = window end + 1`; otherwise it is
`eligible: true`. No allocation or tolerance applies.

### 3.7 Output

Per tracked credit for the selected benefit year:

```json
{
  "credit": "dining",
  "status": "ok",
  "year": {
    "start": "2026-01-01",
    "end": "2026-12-31",
    "cap": "200.00",
    "used": "90.00",
    "expired_unused": "10.00",
    "available": "0.00",
    "upcoming": "100.00",
    "excess": "0.00"
  },
  "periods": [
    {
      "start": "2026-01-01",
      "end": "2026-03-31",
      "cap": "50.00",
      "used": "40.00",
      "remaining": "10.00",
      "state": "partial",
      "entries": ["e1"]
    }
  ],
  "unplaced": []
}
```

- `state`: `upcoming` (starts after as-of), else `unused` (used 0), `partial` (below cap), `full` (up to
  cap + tolerance) or `over`.
- `remaining = max(0, cap − used)`; `excess = max(0, used − cap − tolerance)`.
- Year: `cap` and `used` sum the listed periods; `expired_unused` sums `remaining` of periods that ended
  before as-of; `available` is the current period's `remaining`; `upcoming` sums caps of future periods.
- `status` is `ok`, `needs_anniversary`, `needs_statement_day` or `to_verify`; the last three carry only
  `entries`. Credits with non-statement delivery or no period in the year are not listed.

### 3.8 Which benefit year is shown

When an application lets the user pick a calendar year `Y`, the reference date is the as-of date when `Y` is the
current year, otherwise `Y-12-31`; each credit shows the benefit year, under the basis of the version in
effect at the reference date, that contains it. Calendar credits therefore show `Y`; anniversary credits
show their card year (labelled with its dates, e.g. 2026-03-15 至 2027-03-14). Listed periods are those
starting inside that benefit year.

## 4. Test vectors

### 4.1 Format

[credit-progress.json](../vectors/credit-progress.json) holds
`{ format, format_version, constants: { tax_tolerance_rate }, vectors: [...] }`. Each vector:

| Field       | Meaning                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`        | `bt-NNN`, stable.                                                                                                                                                                    |
| `catalog`   | A compact fictional product with synthetic/pending versions; metadata and provenance are intentionally omitted (see below).                                                          |
| `account`   | `{ currency, product_id, anniversary, statement_close_day, tracking_start }`; `product_id: null` means no product selected.                                                          |
| `overrides` | `[{ credit, effective_from, amount, disabled }]`.                                                                                                                                    |
| `entries`   | Benefit credits: `{ id, date, amount, currency, description, merchant?, family?, assigned_credit?, assigned_period_start? }`. A present `assigned_credit: null` is an explicit none. |
| `as_of`     | Owner-local today.                                                                                                                                                                   |
| `view_year` | Selected calendar year (§3.8).                                                                                                                                                       |
| `expect`    | `{ matches: { entryId: creditId \| null }, unmatched: [{ entry, reason }], instances: [...] }`, instances as in §3.7 or the multi-year form.                                         |

Fixtures use [schema/vectors.schema.json](../schema/vectors.schema.json), not the production schema.
Omitted delivery means `statement_credit`; fixture versions omit source, verification date and date basis.
The test runner supplies no additional production metadata. These omissions do not relax production rules.

Comparison rules: money as decimals; `unmatched` as a set; `entries` lists in `(date, id)` order;
`instances` in catalog order.

### 4.2 Coverage

| Vector | Behaviour                                                                   |
| ------ | --------------------------------------------------------------------------- |
| bt-001 | Calendar monthly: full, partial, current, upcoming; year summary            |
| bt-002 | Over-cap quarter moves its earliest credit within the lag back              |
| bt-003 | Credits beyond the lag stay; `over` and `excess`                            |
| bt-004 | No overflow, no move (documented limitation)                                |
| bt-005 | Owner-pinned period                                                         |
| bt-006 | Semiannual calendar with year summary                                       |
| bt-007 | Anniversary year with a late credit moved to the previous card year         |
| bt-008 | Anniversary quarters clamped to month end from a 31st anchor                |
| bt-009 | 29 February anniversary                                                     |
| bt-010 | Statement-anniversary year                                                  |
| bt-011 | Missing anniversary → `needs_anniversary`                                   |
| bt-012 | Missing statement day → `needs_statement_day`; other credits still compute  |
| bt-013 | Benefit refresh across versions, late credit moved into the old version     |
| bt-014 | `effective_to` plus lag: orphan placed, later credit `no_effective_version` |
| bt-015 | Dated amount override; disabled credit                                      |
| bt-016 | Normalization, whole words, specificity, tie, exclusion, merchant field     |
| bt-017 | Owner assignment and explicit none                                          |
| bt-018 | Family fallback: unique, ambiguous, keyword precedence                      |
| bt-019 | Currency mismatch                                                           |
| bt-020 | No product selected                                                         |
| bt-021 | Cap plus tax: tolerance and a move that needs it                            |
| bt-022 | Multi-year window                                                           |
| bt-023 | To-verify version maps entries but computes nothing                         |

### 4.3 Example: bt-002

Quarterly credit, cap 50.00, lag 56 days. Credits on 2026-04-06 (40.00) and 2026-05-20 (50.00); as-of
2026-06-15. Q2 holds 90.00 > 50.00. The earliest Q2 credit, 2026-04-06, is within 56 days of Q1's end
(2026-03-31 + 56 = 2026-05-26) and fits Q1's room of 50.00, so it moves.

| Period                  | Cap   | Used  | State    | Entries |
| ----------------------- | ----- | ----- | -------- | ------- |
| 2026-01-01 – 2026-03-31 | 50.00 | 40.00 | partial  | e1      |
| 2026-04-01 – 2026-06-30 | 50.00 | 50.00 | full     | e2      |
| 2026-07-01 – 2026-09-30 | 50.00 | 0.00  | upcoming |         |
| 2026-10-01 – 2026-12-31 | 50.00 | 0.00  | upcoming |         |

Year: cap 200.00, used 90.00, expired unused 10.00, available 0.00, upcoming 100.00.

### 4.4 Provenance and use

The expectations were computed by a throwaway reference script written from this spec and spot-checked by
hand (bt-001, 002, 003, 007, 008, 013, 014, 015, 021). The script is not committed; the vectors are the
contract. Asset Ledger runs them in Vitest, Sure in Minitest, both reading the same vendored file. A
behaviour change bumps `format_version` and lands in this repository first.

## Phase 2 catalog compatibility

The schema v2 catalog additionally contains `month_after_annual_fee` and `qualifying_activity` annual
reset bases plus spend/stay/activity eligibility conditions. These are outside the original progress
contract and its 23 vectors. Consumers must explicitly implement them, or report such benefits as
unsupported/needs review; never silently substitute calendar or anniversary periods. See
[data-model.md](data-model.md) and [phase-2-catalog.md](phase-2-catalog.md).
