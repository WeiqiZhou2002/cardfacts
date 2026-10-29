# Phase 1 migration record

Baseline: the initial repository commit `db34aca` and its `drafts/catalog.sample.json`.

- Three product IDs and all 22 credit IDs were preserved.
- All 23 credit versions were preserved, including five `to_verify` versions and the closed historical
  The Edit placeholder. No pending amount was filled during migration.
- Credit additions are category and effective-date basis metadata. Null starts use `unknown`; the
  existing stated start uses `stated`. Original amounts, dates, matching and notes were compared against
  the draft before removing it.
- The 23 progress vectors remain byte-for-byte identical to the original file.
- New product metadata, three fee versions and 13 earn rules use the schema in `data-model.md`.

## Evidence for added fee and earn records

Chase and Capital One product pages were checked on 2026-10-28. The added records cite those pages and
carry that date. Existing credit verification dates remain 2026-10-27 because migration is not a new
credit-by-credit verification.

- [Chase Sapphire Reserve](https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve): annual
  and authorized-user fees near the application controls; earning categories under “Reward your lifestyle”.
- [Capital One Venture X](https://www.capitalone.com/credit-cards/venture-x/): annual fee, travel earning
  categories, base earning and foreign transaction fee information on the product page.
- [Amex Platinum](https://www.americanexpress.com/us/credit-cards/card/platinum/): fee and earning facts
  are migrated from the proposal's issuer research dated 2026-10-27, retaining that verification date.
  A fresh direct page read exceeded the reader's size limit; the benefit detail page returned HTTP 403.
  Search-indexed official content corroborated the figures but was not treated as a fresh direct check.

The [Amex 2025 refresh fact sheet](https://www.americanexpress.com/content/dam/amex/en-us/company/press-kits/platinum-refresh/U-S-Consumer-Platinum-Card-Fact-Sheet.pdf)
was readable and also corroborated the annual fee and some earning facts, but is an older announcement.
It was not used to refresh all current benefits or infer missing terms. Optional unconfirmed fee fields
remain null. In particular, the seed data is a reviewed subset, not a claim that every current benefit or
earning promotion has been modeled.

All three issuers remain manual-only until their automation terms have been reviewed. The local fetcher
is tested with controlled fixtures and a real browser; enabling live scheduled checks is a later phase.
