# Contributing

Thanks for helping keep card data accurate. The draft provides 30 cards, full product history and offline tooling.
Useful contributions include issuer-confirmed change reports, schema review and additional cited cards.

## Reporting a change

Open an issue with:

- the card name (and whether it is a personal or business card);
- what changed: fee, earn rate or credit, old and new values if you know them;
- a link to the **issuer's** page showing the new terms, and the date you saw it.

Links to blogs or forums are welcome as context, but the change is recorded only once an issuer page
confirms it.

## Data rules

1. **Cite the issuer.** Every non-null amount, rate or date has a `source` on the issuer's own domain and a
   `last_verified` date.
2. **Never guess.** If a value is not on the cited page, leave it `null` and set `status: "to_verify"`.
3. **Keep history.** To change a value, close the current version with `effective_to` and add a new
   version. Never edit numbers of a closed version.
4. **Paraphrase.** `notes` are your own short summary. Do not paste issuer or third-party text.
5. **No personal data.** Keywords are brand or program names. Never copy text from a real statement, and
   never include account details, screenshots or anything from your own records.
6. **One card per pull request**, with the source links in the description.

## Pull requests from the maintenance agent

Pull requests labelled `bot` are opened by the scheduled agent. Review them like any other: check the
evidence links before merging.

## Local checks

Use Node.js 24 LTS and the pnpm version in `package.json`. Run `pnpm install --frozen-lockfile`, then
`pnpm check`. Before a data PR, also run `pnpm validate --base-ref origin/main` against an up-to-date base.
CI repeats the history check against the PR base revision. Use `pnpm format` for formatting.

Read [the data contract](docs/data-model.md) before adding fields. Unknown initial effective dates stay
`null` with basis `unknown`; use `detected` only for an observed change. Earn conditions and caps belong
inside versions. Keep source IDs globally unique and use a new source ID when a URL changes.

A term or eligibility change closes the old version and appends a replacement. Editorial notes changes
and re-verification timestamps can update the current card without a new effective interval; they must not conceal a term change. Every edit requires a new immutable snapshot via `pnpm snapshot PRODUCT_ID --recorded-at UTC_TIME --reason TEXT` before validation. See [history](docs/history.md). Historical
numeric values, source URLs and closed effective intervals are protected by CI.

Do not update `last_verified` merely because you migrated or reformatted a record. Existing pending
records stay pending unless the cited issuer evidence resolves them. For unknown optional fee fields,
keep null and explain the gap in notes. Preserve progress-vector expectations unless deliberately
changing the consumer contract and its format version.

New cards also need an issuer entry, allowed domains, and vocabulary categories. Follow the
[tooling guide](docs/tooling.md) for manual-only issuer policy and source checks. Fetched issuer page snapshots belong
outside the repository; structured product revisions belong in `history/`. A release version is explicit in `catalog.json`; do not derive it from build time.

## Website changes

Run `pnpm site:dev` to preview the bilingual wiki. Keep all monetary facts in the validated catalog;
website changes must not rewrite history or introduce uncited benefit values. Follow [the site guide](docs/site.md)
and run `pnpm check` plus `pnpm test:site` for interaction or layout changes.
