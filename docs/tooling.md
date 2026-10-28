# Development and maintenance commands

Use Node.js 24 LTS and the pnpm version pinned in `package.json`. Install pnpm with your preferred tool
manager, then run:

```sh
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` runs formatting, type checking, offline validation, tests and the data build. Tests use
controlled source responses and temporary directories; they do not contact issuers. The shared progress
vectors are intentionally excluded from automatic formatting so their original bytes are preserved.

## Command contracts

| Command                                          | Result                                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm validate [--base-ref REV]`                 | Validate production data, vocabularies, maintenance settings and fixture structure; optionally protect history against a Git revision |
| `pnpm build`                                     | Validate and write `dist/cards.json`, `dist/cards.min.json` and `dist/SHA256SUMS`                                                     |
| `pnpm sources --json`                            | Source IDs, URLs, issuer IDs, manual-only flags, products and citing field JSON pointers                                              |
| `pnpm stale --days 90 --as-of 2026-10-28 --json` | Versions strictly more than 90 calendar days old, including pending and historical versions                                           |
| `pnpm fetch-source SOURCE_ID [--json]`           | Render a permitted public source, persist local state, and print its normalized-text SHA-256 or structured outcome                    |

For JSON-only stdout when invoking through pnpm, use `pnpm --silent sources --json` (similarly for other
commands), or invoke `node --import tsx scripts/cli.ts sources --json` directly.

`stale` defaults to 90 days and the machine's local calendar date; scheduled jobs should pass `--as-of`
explicitly. It reports versions, allowing a later site to group them by product. Staleness is not a
validation failure. `sources` includes attempted citations of null fields, so pending data remains
discoverable. Resolve a returned field pointer against the product named in that record.

Build and validation require no browser and no network. Phase 1 does not build or deploy a website,
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
with hostname-boundary matching. All three seed issuers are initially `manual_only` pending website terms
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
```

`maintenance/schedule.json` declares daily products and the rotation interval. `maintenance/leads.json`
contains issuer news/feed leads, initially empty. Queue orchestration, the source budget, GitHub writes,
and scheduled deployment belong to the later maintenance-agent phase.
