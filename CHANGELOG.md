# Changelog

## Unreleased — credits API for reimbursement trackers

- Add `credits.json`, `cards/{id}/credits.json` and `credits/vectors.json` to the API. The feed lists every card with credits, each credit in the credit progress contract's shape with all of its versions, and a `tracking` verdict per version that says whether the contract's rules can compute it. The self-hosted server filters it by `ids` and `issuer`.
- Catalog releases also carry `credits.json`, byte for byte the static file, listed in `SHA256SUMS`.
- Card summaries link to the card's credits. Documented in `docs/credits-api.md`.

## Unreleased — pending values resolved

- Resolve 9 pending annual fees and 19 pending networks from issuer terms pages and product pages, checked 2026-11-17.
  - Fees: five Citi AAdvantage cards, the Costco Anywhere card, Delta SkyMiles Gold and two U.S. Bank business cards.
  - Networks: Citi / AAdvantage Business, seven Bank of America cards, seven Barclays cards and four U.S. Bank business cards.
- Fees use the intake's method: the pending version ends the day before the check, and a verified version starts on the check date with basis `detected`.
- Add the earning rates for the Atmos Rewards Visa Signature Business Card.

## Unreleased — Synchrony cards

- Add five cards issued by Synchrony Bank: Synchrony Premier World Mastercard, PayPal Cashback Mastercard, Venmo Visa, Verizon Visa and Sam's Club Mastercard, for 149 in total. Synchrony is registered with its own domain and the partner domains that host the product pages (paypal.com, venmo.com, verizon.com, samsclub.com), and is manual-only.

## Unreleased — First Electronic Bank cards, Bilt network

- Add four cards issued by First Electronic Bank and serviced by Cardless: Qatar Airways Privilege Club Signature and Infinite, and avianca lifemiles American Express and Elite. The issuer is registered with the partner domains that host the product pages (qatarairways.com, lifemiles.com) and cardless.com, and is manual-only.
- Bilt cards: cite the Mastercard network and note that Column N.A. issues and Cardless services them. Their IDs and issuer entry are unchanged.

## Unreleased — catalog expansion, second batch

- Add 18 products (7 personal, 11 business), for 140 in total: Amex Delta SkyMiles business cards, Capital One Venture and VentureOne Business, four Bank of America business cards, the Costco Anywhere Visa Business Card, Robinhood Gold and Platinum, three PenFed cards, Fidelity Rewards and two FNBO Evergreen cards. Values come from the issuer's product pages, checked 2026-11-17.
- New issuers, all manual-only: Robinhood, PenFed, Elan Financial Services (Fidelity Rewards) and FNBO.

## Unreleased — catalog expansion

- Add 92 products (72 personal, 20 business), including airline, hotel and retail co-brand cards, for 122 in total. Each value is cited to the issuer's own product page, checked 2026-11-15 or 2026-11-16.
- New issuers: Barclays, Bank of America, Bilt and Apple. All four are manual-only pending a review of their website terms.
- New entries are marked `partial` in `coverage`. Values that could not be read from the page are left `to_verify` or described in notes, never guessed. Free night awards, companion certificates and elite status are not recorded as credits.

## Unreleased — benefit guides

- Sources may carry an optional `kind`: `product_page`, `pricing_terms`, `benefit_guide`, `cardmember_agreement` or `other`. Agent submissions may set it on `new_sources`, and the intake keeps it.
- Card pages show a **Benefit guide** row linking to the issuer's own document, and the source list marks benefit guides and PDFs. CardFacts links to issuer documents and does not host copies.
- API: card summaries include `benefit_guides` (source id, title, issuer URL, accessed date).

## Unreleased — publishing, releases and freshness

- The site and static API show the terms in effect on the day they are published: the Pages workflow now also runs daily and passes the terms date to the build, instead of using the date in `catalog_version`. The API server defaults `as_of` to the current UTC date. Local builds are unchanged and reproducible.
- A publish that changes the data gets a new `catalog_version` (`YYYY.MM.DD-draft`, with `.2` for a second change that day) and a `catalog-<version>` GitHub release with `cards.json`, `cards.min.json`, `history.json` and `SHA256SUMS`, so applications can pin a version. `pnpm release-plan` shows what a publish would ship.
- A weekly **Data freshness** workflow keeps one issue listing verified values unchecked for more than 21 days (`CARDFACTS_STALE_DAYS`), and closes it once they are current.
- API: credits in card summaries and category lists include `delivery` (`statement_credit`, `issuer_wallet` or `in_app`), already present in full records. Docs explain the three kinds.
- Docs: README status and maintenance, API examples.

## Unreleased — agent network findings

- Submissions may carry `networks` and up to three `new_sources` (issuer documents such as pricing and terms). The intake fills pending networks or replaces different ones in a data-change PR, adds the cited new source to the product, and re-verifies unchanged networks.
- Re-verification PRs may move `networks.last_verified` forward; nothing else about networks.

## 2026.11.03-draft — schema 3: cited payment networks

- Replace the single nullable `network` with `networks`: a sorted list of networks plus `status`, `source`, `last_verified` and `notes`, so a product issued on more than one network can say so and every network value is cited.
- Migrate the 15 known networks with their product-page sources; mark the other 15 cards (Capital One, Chase, Citi) `to_verify` until issuer terms are cited.
- API: summaries and records expose `networks`; the `network` filter matches verified values only and rejects unknown networks. The shape is stable from this version on.
- Revisions recorded earlier keep `network`; the schema accepts it there only. 30 new snapshots record the migration.

## Unreleased — structured API

- Publish a static JSON API under `/api/v1/` with the website: card summaries, full records, terms in force, revision history and snapshots, issuers and categories, OpenAPI 3.1 and JSON Schemas.
- Add `pnpm api:serve`, a read-only server for the same paths that also accepts filters, terms dates, recorded times and revision diffs; Docker file in `deploy/api.Dockerfile`.
- Link the API from the website footer.

## Unreleased — Phase 4 agent submission intake

- Add `schema/submission.schema.json` and a `repository_dispatch` intake workflow for the private collection agent.
- Apply findings under the versioning rules: unchanged values move `last_verified` forward; changed values close the current version and append a verified one; contradictions become conflict flags.
- Open one data-change PR per product and one rolling re-verification PR; report flags and rejected submissions on issues.
- Add `pnpm submission-check` and `pnpm check-reverify-diff`; CI rejects re-verification PRs that change anything but verification dates.
- Fix the M1 rotation and weekly re-verification boundaries (due after exactly 7 days).

## Unreleased — Phase 4 M1

- Add deterministic daily/reverify run plans with priority deduplication, UTC rotation boundaries, source budgets and separate manual-only due lists.
- Execute queued checks through the injected existing fetcher; atomically retain run reports, cache flags, confirmed-hash review status and repeated failures outside the repository.
- Validate plans and persisted state, preserve fetch locking/rate limits, and distinguish local tool errors from source failures.
- Add offline queue/batch/CLI tests. Keep all catalog data, snapshots, vocabularies and manual-only policy unchanged; later milestones remain unimplemented.

## Unreleased — Phase 3 website

- Generate a Chinese/English static wiki with 30 card pages per language, sources and effective-dated terms.
- Add conditional filters, up to four-card comparison and the pending/stale review queue.
- Browse immutable snapshots, select effective dates and compare complete historical content.
- Add project-path-safe builds, responsive browser tests and a main-only GitHub Pages workflow.
- Preserve catalog version, all source data and all existing history snapshots.
- Restyle the wiki as a plain reference site: system fonts, table-style lists, no card art or slogans, dark mode.

## 2026.10.28-phase2-draft

- Expand to 30 products: 20 personal and 10 business, with explicit coverage limits and issuer citations.
- Add schema v2 selectors, spend/payment/time conditions, nullable networks and special reset bases.
- Preserve complete append-only product snapshots; query by recorded time or effective date and compare revisions.
- Export deterministic `history.json`, validate checksums, and prevent edits/deletions/backdating of recorded revisions.
- Keep unconfirmed terms pending and all issuer automation manual-only; preserve the 23 progress fixtures.

## 2026.10.28-draft

- Establish the schema, bilingual category vocabularies, validation and reproducible data builds.
- Migrate three seed products without changing their 22 credits or 23 credit versions.
- Add structured fees and earn rates with issuer citations and verification dates.
- Add source listing, stale reporting, controlled browser fetching and local state.
- Add CI, history protection and contributor tooling; preserve the 23 consumer progress vectors.
- Keep pending data unverified and issuer automation manual-only pending policy review.

No stable release has been published.
