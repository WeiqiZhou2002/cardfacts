# Contributing

Thanks for helping keep card data accurate. The project is in its design stage, so the most useful
contributions right now are change reports and review of the proposal.

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
