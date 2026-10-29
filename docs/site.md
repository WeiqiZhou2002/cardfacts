# Phase 3 — CardFacts wiki

The site is a static, data-generated reference library. It includes the 30 current cards in Chinese and
English, conditional earn/credit filters, comparison of up to four cards, a review queue, sources and a
complete revision viewer. Catalog data and immutable history are unchanged by this phase.

## Run and build

```sh
pnpm install --frozen-lockfile
pnpm site:dev
# Open http://127.0.0.1:4173/
```

`pnpm site:build` validates the catalog and writes 70 pre-rendered HTML pages, a bundled browser script,
CSS, and downloadable data to `dist/site/`. `pnpm site:preview` serves the last build on loopback; set
`PORT` to change its port. Build and preview a project subpath with:

```sh
SITE_BASE_PATH=/cardfacts/ pnpm site:build
pnpm site:preview
# Open http://127.0.0.1:4173/cardfacts/
```

Only `/` and slash-delimited path segments with a trailing slash are accepted. There are no external
scripts, fonts, trackers or runtime data services. Generated HTML contains the catalog; detail pages
add only that product's snapshots. The browser bundle uses the same pure temporal queries as the CLI.

## Routes and queries

Chinese is the default; prefix any route with `en/` for English. Issuer names, product names, source
names and original factual notes remain in English in both interfaces.

| Route                | Contents                                                  |
| -------------------- | --------------------------------------------------------- |
| `/`                  | Search and filter catalog                                 |
| `/cards/PRODUCT_ID/` | Fees, earn rules, credits, sources and revision history   |
| `/compare/`          | Side-by-side comparison, up to four cards                 |
| `/review/`           | Pending and strictly more than 90 days old terms versions |
| `/about/`            | Data conventions and JSON downloads                       |
| `/404.html`          | Missing-page fallback                                     |

Query parameters are bookmarkable and survive language changes:

- Catalog: `q`, `audience`, `issuer`, `fee` (`free`, `low`, `mid`, `high`, `unknown`), `credit`, `earn`,
  `unit`, `min_rate`, `sort=fee`. Selectors use catalog vocabulary IDs. Fee ranges are 0, 1–99, 100–399,
  and 400+ USD. Category/rate/fee filters use verified applicable versions; category selectors include
  eligible rotating and top-spend categories, without assuming their other conditions are met.
- `asof=YYYY-MM-DD`: effective terms date for the catalog, detail or comparison page.
- `cards=ID,ID`: selected products for comparison; invalid IDs and duplicates are discarded, maximum four.
- Detail: `revision=REVISION_ID` **or** `recorded_at=YYYY-MM-DDTHH:mm:ssZ`; `from` and `to` select the
  snapshots compared in the revision section. Snapshot IDs are listed in the page and CLI.
- Review: `review_on=YYYY-MM-DD`, `issuer`, `q`, `status=pending` or `status=stale`. Includes ended and
  announced future versions, consistent with the CLI's maintenance queue.

For example, under `/cardfacts/`, visit
`cards/us-capital-one-venture-x/?recorded_at=2026-10-28T22:00:00Z` to see the preserved Phase 1 content.
Visit `cards/us-amex-business-platinum/?asof=2027-01-01` to view the announced hotel eligibility change.

The two time axes stay separate: the terms date selects applicable rules **inside** a recorded snapshot.
A cutoff before the first snapshot displays “no record,” not the latest data. Invalid dates display an
error. An unknown effective start remains explicitly marked; it does not establish past eligibility.
Sources link to the issuer's current page, not an archived website copy. Full snapshots are downloadable
at `data/history/PRODUCT_ID.json`; the complete history and catalog have aggregate SHA-256 manifests.

The pre-rendered date comes from `catalog_version`, making builds reproducible. With JavaScript enabled,
the default terms/review date is today's UTC date; explicit query dates always take precedence. Without
JavaScript, pages remain readable at the catalog's build reference date, with a visible explanation.
Interactive filters, historical selection and comparison require JavaScript.

Unknown amounts are not zero, absent categories are not proof of absent benefits, and no annual credit
total or point-to-cash valuation is computed. The comparison includes conditions, caps, status and links
back to full citations. Change-report links prefill a GitHub issue template; the site never submits an
issue on the visitor's behalf.

## Verification

`pnpm check` includes static-site tests and the website build. Tests verify deterministic output, all
internal links, bilingual routes, filtered categories, review-age boundaries, invalid dates, safe HTML
serialization and archived content. The ordinary test suite skips tests that require Chromium.

```sh
pnpm exec playwright install chromium
pnpm test:site
```

Browser tests use only a local fixture server under `/cardfacts/`. They exercise filtering, comparison
limits, keyboard focus, history/revision selection, back navigation, reloads, language changes, no-JS
content, 404s and page overflow at 320, 390, 768 and 1440 pixels. Set `CARDFACTS_SCREENSHOTS` to an
existing directory to save desktop and mobile screenshots. No issuer pages are fetched.

## GitHub Pages

The Pages workflow builds and deploys only from `main`, with a separate `github-pages` deployment job.
PR CI validates and browser-tests the website but does not publish it. To enable hosting after review:

1. In repository **Settings → Pages**, select **GitHub Actions** as the build source.
2. Merge the data and website PRs in dependency order into `main`.
3. Let the Pages workflow run, or dispatch it from `main` if settings were enabled after the merge.

The expected project URL is `https://weiqizhou2002.github.io/cardfacts/` once deployment succeeds. This
PR prepares the workflow; it does not enable Pages settings or establish a live deployment. Custom
hosting at `/` should build with `SITE_BASE_PATH=/`; custom domains require their own Pages configuration.
The maintenance agent remains Phase 4 work.
