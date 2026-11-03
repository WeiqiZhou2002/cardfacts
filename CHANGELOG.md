# Changelog

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
