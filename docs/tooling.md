# Development and maintenance commands

Use Node.js 24 LTS and the pnpm version pinned in `package.json`. Install pnpm with your preferred tool
manager, then run:

```sh
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` runs formatting, type checking, offline validation, tests, the data build and the static website build. Tests use
controlled source responses and temporary directories; they do not contact issuers. The shared progress
vectors are intentionally excluded from automatic formatting so their original bytes are preserved.

## Command contracts

| Command                                                                                            | Result                                                                                                                                |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm validate [--base-ref REV]`                                                                   | Validate production data, vocabularies, maintenance settings and fixture structure; optionally protect history against a Git revision |
| `pnpm build`                                                                                       | Validate and write `dist/cards.json`, `dist/cards.min.json`, `dist/history.json` and `dist/SHA256SUMS`                                |
| `pnpm sources --json`                                                                              | Source IDs, URLs, issuer IDs, manual-only flags, products and citing field JSON pointers                                              |
| `pnpm stale --days 90 --as-of 2026-10-28 --json`                                                   | Versions strictly more than 90 calendar days old, including pending and historical versions                                           |
| `pnpm fetch-source SOURCE_ID [--json]`                                                             | Render a permitted public source, persist local state, and print its normalized-text SHA-256 or structured outcome                    |
| `pnpm plan-run --mode daily\|reverify --as-of DATE [--max N] [--change-report PRODUCT ...] --json` | Deterministic source queue, manual-only due list and deferred count; no fetching                                                      |
| `pnpm run-checks --plan FILE --json`                                                               | Check queued sources sequentially, persist an external run report, and print JSON                                                     |

For JSON-only stdout when invoking through pnpm, use `pnpm --silent sources --json` (similarly for other
commands), or invoke `node --import tsx scripts/cli.ts sources --json` directly.

`stale` defaults to 90 days and the machine's local calendar date; scheduled jobs should pass `--as-of`
explicitly. It reports versions, also exposed in the website review queue. Staleness is not a
validation failure. `sources` includes attempted citations of null fields, so pending data remains
discoverable. Resolve a returned field pointer against the product named in that record.

Build and validation require no browser and no network. `pnpm site:dev` previews the static wiki;
`pnpm site:build` prepares `dist/site/` for GitHub Pages. See [the site guide](site.md). These commands do not
publish a release, open issues or PRs, or run an unattended maintenance agent.

## Source fetcher

Install the browser before using automated sources:

```sh
pnpm exec playwright install chromium
```

Configure `CARDFACTS_STATE_DIR` to a directory outside the repository (default
`~/.local/state/cardfacts`). Symlink aliases into the repository are rejected. The fetcher never stores
page text under version control and never modifies data or verification dates.

Issuer policy is in `maintenance/issuer-domains.json`. Domains cover the named domain and its subdomains,
with hostname-boundary matching. All seven catalog issuer brands remain `manual_only` pending website terms
review. Record the review in `automation_review` before removing an issuer from that list. This setting
does not make a claim about whether the issuer permits or prohibits automation.

Automated checks use the configured identifiable User-Agent and robots.txt rules. A missing robots.txt
(HTTP 404) allows access; other unsuccessful responses fail the check. Cross-issuer redirects and resource
requests are blocked. Browser requests use GET/HEAD only; images, media, fonts, service workers and
WebSockets are blocked. The browser does not sign in, submit forms, or solve challenges. Blocked,
unreadable, too-short or unsuccessful pages are failures, never evidence that a benefit disappeared.

State is keyed by exact source URL. At most one attempt per URL per UTC date is made, including failures;
repeated calls return that day's cached result. Separate source checks for an issuer are spaced by at least
10 seconds (or a longer robots crawl-delay). Resource loading within one rendered page is part of that check. A global state-directory
lock prevents concurrent checks from racing. After a crashed process, remove `.fetch-lock` only after
confirming no fetch is running.

Normalized text uses Unicode NFKC and collapsed whitespace. Content-addressed text files retain both old
and new successful content. Each source state records its latest attempt, previous hash, last successful
hash/text filename and consecutive failure count. A per-source append-only check log preserves earlier observations. Failures preserve the last successful snapshot. The
future agent can use a count of three to report a source problem; this command never sends messages.

Exit codes: `0` success (including cached success), `1` validation/fetch failure, `2` manual-only. JSON
fetch output adds `cached` so an old result is not mistaken for a new check. A changed page hash only means
the text changed; a reviewer or maintenance agent must still verify the relevant amounts and terms.

## Browser verification

CI additionally installs Chromium and exercises JavaScript rendering and blocked requests against a local
HTTP fixture. Run the same check locally with:

```sh
CARDFACTS_BROWSER_TEST=1 node --import tsx --test tests/browser.test.ts
pnpm test:site
```

`maintenance/schedule.json` declares daily products and the rotation interval. `maintenance/leads.json`
contains issuer news/feed leads, initially empty. M1 supplies queue planning, a source budget and batch
check reports. LLM extraction, GitHub writes and scheduled deployment remain later milestones.

## Catalog revision commands

- `pnpm snapshot PRODUCT --recorded-at TIME --reason TEXT`: append a complete structured product
  revision. Requires an explicit UTC timestamp and reason; never overwrites old files.
- `pnpm history PRODUCT --json`: list revision metadata.
- `pnpm history PRODUCT --recorded-at TIME --json`: retrieve the latest full snapshot at/before that time.
- `pnpm history PRODUCT --as-of DATE --json`: select effective terms from the latest snapshot. The two
  date filters may be combined.
- `pnpm history PRODUCT --from REVISION_ID --to REVISION_ID --json`: compare snapshot contents.

History/snapshot commands always emit JSON. Invalid dates and unknown products/revision IDs fail; times
before the first snapshot return `not_recorded`. A date is `YYYY-MM-DD`; a recorded time is UTC
`YYYY-MM-DDTHH:mm:ssZ`. Every current edit, including notes-only changes, requires a new snapshot before
ordinary validation/build. See [the history guide](history.md) for the complete maintenance sequence.

## Maintenance M1: planning and batch checks

M1 adds `plan-run` and `run-checks`. It does not confirm baselines, edit card data or verification dates,
call an LLM, invoke GitHub, or install a schedule. The CLI injects the existing `fetchSource` into the batch
checker; the new maintenance libraries introduce no network client or external process commands.
The queue accepts the catalog, schedule, explicit date and an injected state reader; it does not read the
clock, environment or filesystem itself. All new tests use temporary state and fake transports.

Set `CARDFACTS_STATE_DIR` to an external directory, as for `fetch-source`. For example (replace placeholders):

```sh
export CARDFACTS_STATE_DIR=/path/to/external-state
pnpm --silent plan-run --mode daily --as-of YYYY-MM-DD --max 25 \
  --change-report PRODUCT_ID ANOTHER_PRODUCT_ID --json > /path/to/run.plan.json
pnpm --silent run-checks --plan /path/to/run.plan.json --json
```

Both commands always emit JSON on success, even without `--json`. Use `pnpm --silent` for clean stdout
when redirecting the plan. `plan-run` prints a plan; the caller chooses where to save it.

### Plan contract

- Require `--mode daily|reverify` and a valid `--as-of YYYY-MM-DD`. No implicit date is used.
- `--max` overrides `CARDFACTS_MAX_SOURCES`, which defaults to 25. Accept non-negative safe integers;
  `--max 0` puts all otherwise eligible automatic sources in `deferred`, leaving `manual_due` intact.
- Daily priority: `change_report` before `daily` before `rotation`. Each source ID appears once at its
  highest priority, even if several reasons apply. Repeating `--change-report PRODUCT_ID` and listing
  several IDs after one flag are both supported. Unknown IDs are errors. No issues or leads are fetched.
- Daily products come from `maintenance/schedule.json`. Rotation is due when never checked or when the
  last attempt's UTC date is **strictly earlier** than `as_of - rotation_days`; exactly on the boundary
  is not due. Failed attempts count. Within each priority, never-checked sources come first, followed by
  oldest UTC check timestamp and source ID as the deterministic tie-breaker. `last_checked` is that UTC date,
  or `null`. Daily and change-report sources are eligible regardless of rotation age; an already checked
  source is later served from the fetcher's same-day cache.
- Reverify takes only sources cited by `verified` versions returned by `staleVersions(catalog, 7, as_of)`;
  it includes ended and announced future versions. Entries have `reason: "reverify"`. Pending versions
  do not qualify; `--change-report` is rejected in this mode. This command only plans the checks.
- Eligible manual-only sources go to `manual_due`, never `queue`, and do not consume the budget or count
  toward `deferred`. With the current seven manual-only issuers, the automatic queue is empty.
- Plans have `format_version: 1`. Execution validates their shape, source identity, catalog URLs, issuer,
  products and uniqueness before any checks. It rechecks current manual-only policy; newly restricted
  entries move to `manual_due` without calling the fetcher. Regenerate plans after catalog changes.

### Run report and failures

`run-checks` preserves queue order and the existing fetcher's `.fetch-lock`, robots rules, issuer spacing
and per-UTC-day success/failure cache. The plan's `as_of` is a scheduling reference, not a simulated fetch
date: the fetcher uses actual UTC time. `CARDFACTS_MODE` is recorded as `report-only` (default) or `pr`;
**neither value enables GitHub writes in M1**.

Reports use `format_version: 1` and are atomically saved to
`CARDFACTS_STATE_DIR/runs/YYYYMMDDTHHMMSSZ-<mode>.json`, using the actual start time in UTC. A batch lock
`.run-checks-lock` prevents overlapping runs in the same state directory. An existing run ID is never
overwritten; retry in a later UTC second. Remove a stale lock only after confirming no batch is running.
State remains outside the repository, including symlink aliases.

Each result includes products, status, cache flag, latest successful hash, previous hash, confirmed hash,
review flag, failure count and error. A failed result can retain a previous successful `hash`; its
`needs_review` is still false. Successful results, including cached ones, need review when their hash
differs from the confirmed baseline or no baseline exists. In particular, an `unchanged` page remains
pending until confirmed. `unreachable` lists failed sources with at least three consecutive failures; a
cached failure does not increment the counter. No issue is opened.

M1 only **reads** `confirmed/<sha256(url)>.json`: the identity fields `format_version: 1`, `source_id`,
`url` and a SHA-256 `hash` are validated; additional M2 metadata can be present. It neither creates nor
updates baselines. Confirmation and per-field verification are M2 work.

A completed batch exits **0 even when a source failed**. Invalid arguments/plans, corrupt source, issuer
or baseline state, lock conflicts and local persistence errors exit **1**. Tool errors abort the batch
without a completed run report; any already completed source checks remain in the existing source logs.
This differs from the single-source `fetch-source` exit codes. Reports contain hashes and safe failure
messages, never fetched page text.
