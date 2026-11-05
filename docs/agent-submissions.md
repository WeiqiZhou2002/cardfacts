# Agent submissions

The collection agent runs outside this repository (a private deployment). It fetches issuer pages,
extracts terms and sends its findings here. This repository decides what those findings mean for the
data: the intake workflow validates them, applies the catalog's versioning rules, appends snapshots and
opens pull requests. Nothing reaches `main` without a human merge.

```text
agent (private) ──repository_dispatch──> .github/workflows/agent-submission.yml
                                          └─ scripts/intake.ts
                                               validate ─> apply ─> snapshot ─> validate --base-ref ─> build
                                               ├─ term changes:        PR per product   bot/<product>/<date>   labels bot, data-change
                                               ├─ unchanged values:    one rolling PR   bot/reverify           labels bot, reverify
                                               └─ nothing to apply:    comment on the "Agent flags" issue
```

## Sending a submission

```sh
curl -X POST https://api.github.com/repos/WeiqiZhou2002/cardfacts/dispatches \
  -H "Authorization: Bearer $CARDFACTS_DISPATCH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d '{"event_type":"cardfacts-submission","client_payload":{"submission":{...}}}'
```

- The token needs **Contents: read and write** on this repository only (a fine-grained personal access
  token). Protect `main` so that token cannot push to it.
- GitHub limits the dispatch payload to about 64 KB. Submissions carry findings and short locators, never
  page text, so one run fits comfortably; split very large runs into several submissions.
- For a manual test, run the workflow from the Actions tab and paste the JSON into the `submission` input.
- `pnpm submission-check FILE --json` validates a file locally and prints what the intake would apply.

## Format

[`schema/submission.schema.json`](../schema/submission.schema.json) is authoritative. A submission has
`format_version: 1`, a `submission_id`, the agent's name, version and model, `checked_at` (UTC, within
the last 14 days), and up to 60 `products`. Each product lists:

| Field      | Meaning                                                                                                                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sources`  | Catalog sources fetched for this product: id, the exact catalog URL, `fetched_at` and the text SHA-256. Verified entries and changes must cite one of these; a flag may name any source of the product, such as one that could not be fetched. |
| `verified` | Targets whose current values were found unchanged on the cited source.                                                                                                                                                                         |
| `changes`  | Targets whose values differ: `set` fields, `effective_from` and its basis, a paraphrased `notes`, locator.                                                                                                                                     |
| `flags`    | Findings that need a human: `new_entry`, `removal`, `conflict`, `unreadable`, `ambiguous`, `suspicious_page`.                                                                                                                                  |

A target is `/fees`, `/earn_rates/<rule-id>` or `/credits/<credit-id>`, and appears at most once per
product. Changes may set these fields only:

| Target        | Settable fields                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `/fees`       | `annual_fee`, `first_year_annual_fee`, `authorized_user_fee`, `foreign_transaction_fee_percent` |
| `/earn_rates` | `rate`, `cap_amount`, `rate_after_cap` (only when the rule already has a structured cap)        |
| `/credits`    | `amount`, `per_transaction_cap`                                                                 |

Two optional product fields cover payment networks:

| Field         | Meaning                                                                                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `networks`    | `source_id`, `values` (alphabetical: `amex`, `discover`, `mastercard`, `visa`), a paraphrased `notes` and a locator. Only what the page names.                                                 |
| `new_sources` | Up to three issuer documents not yet in the catalog (id, URL, title, optional `kind`, fetch time, text hash), such as pricing and terms or a Guide to Benefits. Only `networks` may cite them. |

A new source must be HTTPS on the product issuer's domains, use an id no catalog source has, and not repeat
a URL the product already cites. It is added to the product only when the applied network finding cites it.

Periods, reset rules, conditions, new benefits and removals are flags, not changes. Money uses two
decimals (`"60.00"`), rates and percentages are decimal strings.

## How the intake applies findings

The version that applies on the source's fetch date is the current version.

- **Unchanged value** (a `verified` entry, or a change whose values already match): moves
  `last_verified` forward to the fetch date. Pending versions and versions citing another source are
  skipped and reported.
- **Changed value**: closes the current version the day before the new start and appends a verified
  version with the new values, the submission's source, notes and `last_verified`. A `stated` start uses
  the issuer's date; `detected` uses the fetch date and the PR shows the window since the old value was
  last verified. A pending version is resolved the same way once its main value (`annual_fee`, `rate` or
  `amount`) is supplied.
- **Networks**: the same values from the source already cited move the networks' `last_verified` forward;
  the same values from a different source are left as recorded and reported. A pending entry, or different
  values, are replaced by the finding (status `verified`) in a data-change PR. Networks are not effective-dated;
  the snapshot keeps the earlier list.
- The source's `accessed` date moves forward for every source used.

A change is **not applied**, and is reported as a `conflict` flag instead, when a later version is
already recorded, the current version already has an end date, the start is not after the current
version's start, a stated start is on or before the date the old value was last verified, or a cap field
is set on a rule without a structured cap.

Every changed product gets a new snapshot. The intake then runs `pnpm validate --base-ref origin/main`,
`pnpm check-reverify-diff` for re-verification, and `pnpm build` before pushing. Invalid submissions and
failed checks are reported on the `Agent submission rejected` issue.

## Pull requests

- **Term changes**: one PR per product on `bot/<product-id>/<checked date>`, with a before/after table,
  evidence locators, the source fetch times and everything flagged. A same-day resubmission replaces the
  branch; an older open PR for the product gets a comment pointing to the new one.
- **Re-verification**: one rolling PR on `bot/reverify`. Products with an open data-change PR are left
  out so the two cannot conflict. CI fails the PR if anything other than `last_verified` or a source's
  `accessed` date changes. The `automerge` label is added only when the repository variable
  `CARDFACTS_AUTOMERGE_REVERIFY` is `true`.

## Repository setup

1. **Settings → Actions → General → Workflow permissions**: allow GitHub Actions to create and approve
   pull requests. Alternatively add a `CARDFACTS_BOT_TOKEN` secret (contents, pull requests and issues
   write); PRs opened with it start CI on their own.
2. Without that secret, the intake starts CI on each bot branch through `workflow_dispatch`, because
   pushes made with the workflow token do not trigger workflows.
3. Protect `main`: require pull requests and the `check` status.
4. Give the agent a fine-grained token with Contents read/write on this repository to send dispatches.
