# CardFacts API

Read-only JSON for software and websites. There are two ways to reach the same URLs:

| Deployment                                  | Base URL                                            | Query parameters |
| ------------------------------------------- | --------------------------------------------------- | ---------------- |
| Static files on GitHub Pages (always there) | `https://weiqizhou2002.github.io/cardfacts/api/v1/` | Not supported    |
| Self-hosted server (`pnpm api:serve`)       | `http://HOST:8787/api/v1/`                          | Supported        |

Without query parameters the server returns byte-for-byte what the static file contains, so a client can
start on the static files and switch to a server when it needs filtering, arbitrary dates or diffs. Both
send `Access-Control-Allow-Origin: *`. The full description is `openapi.json` (OpenAPI 3.1), and the card
and revision formats are published as JSON Schema under `schema/`.

## Responses

Every successful response is an envelope:

```json
{ "api_version": 1, "catalog_version": "2026.10.28-phase2-draft", "license": "CC0-1.0", "data": { ... } }
```

Errors use HTTP status codes and a JSON body such as
`{ "api_version": 1, "error": { "status": 400, "code": "unknown_parameter", "message": "..." } }`.
Unknown or repeated query parameters are rejected rather than ignored. Links inside responses are relative
to the API root.

## Endpoints

| Path                                      | Content                                                                    | Server-only parameters                                                                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.json`                              | Endpoint list and catalog version                                          |                                                                                                                                                           |
| `cards.json`                              | Card summaries: fee, earn rates and credits in force, pending count, links | `as_of`, `q`, `issuer`, `audience`, `network`, `availability`, `unit`, `annual_fee_min`, `annual_fee_max`, `earn_category`, `min_rate`, `credit_category` |
| `cards/{id}.json`                         | The full card record with every terms version and its source               |                                                                                                                                                           |
| `cards/{id}/terms.json`                   | Terms in force on a date, each with a `certainty`                          | `as_of`, `recorded_at`                                                                                                                                    |
| `cards/{id}/history.json`                 | Recorded revisions                                                         |                                                                                                                                                           |
| `cards/{id}/revisions/{revision_id}.json` | One complete recorded revision                                             |                                                                                                                                                           |
| `cards/{id}/diff.json`                    | Differences between two revisions (server only)                            | `from`, `to` (required)                                                                                                                                   |
| `issuers.json`                            | Issuers, their domains and cards                                           |                                                                                                                                                           |
| `categories.json`                         | Earn and credit categories with card counts                                |                                                                                                                                                           |
| `categories/earn/{category_id}.json`      | Cards with a current earn rule in the category                             | `as_of`                                                                                                                                                   |
| `categories/credits/{category_id}.json`   | Cards with a current credit in the category                                | `as_of`                                                                                                                                                   |

Static files describe terms as of the catalog version date (`as_of` in each response). Use the server's
`as_of` for another date. Fee filters and rate filters consider verified values only; a missing value is
unknown, not zero.

```sh
curl https://weiqizhou2002.github.io/cardfacts/api/v1/cards/us-amex-gold/terms.json
curl "http://localhost:8787/api/v1/cards.json?audience=business&annual_fee_max=100"
curl "http://localhost:8787/api/v1/cards/us-amex-business-platinum/terms.json?as_of=2027-01-01"
curl "http://localhost:8787/api/v1/categories/earn/groceries.json?as_of=2027-01-01"
```

## Payment networks

Every card record and summary has `networks` (see the [data model](data-model.md#payment-networks-schema-3)):

```json
"networks": {
  "values": ["visa"],
  "status": "verified",
  "source": "chase-csr-page",
  "last_verified": "2026-10-28",
  "notes": "..."
}
```

`values` can hold more than one network; a pending entry (`"status": "to_verify"`) has an empty list and
means the network is not yet confirmed, not that there is none. The `network` query parameter matches
verified values only. This field replaced the earlier single `network` value on 2026-11-03, and its shape
is stable from here on in `api_version` 1. Revisions recorded before that date are returned as recorded and
still contain `network`.

## Certainty

Each term returned by `terms.json` and the category endpoints carries a `certainty`:

| Value            | Meaning                                                               |
| ---------------- | --------------------------------------------------------------------- |
| `stated`         | The issuer states when it starts                                      |
| `detected_start` | Recorded from the date the change was observed, not an official start |
| `unknown_start`  | Start unknown; does not prove the term applied on an earlier date     |
| `to_verify`      | Pending; the value is null and must not be used as confirmed          |

## Running the server

```sh
pnpm install --frozen-lockfile
HOST=0.0.0.0 PORT=8787 pnpm api:serve
```

or with Docker: `docker build -f deploy/api.Dockerfile -t cardfacts-api . && docker run -p 8787:8787 cardfacts-api`.
The server reads the catalog from its checkout at start; `kill -HUP` reloads it after a `git pull`. It is
read-only (GET, HEAD and OPTIONS), caches responses for five minutes and answers `If-None-Match` with 304.
Put it behind your own TLS proxy or platform for public use.

## Stability

`api_version` 1 is additive: new fields and endpoints may appear, existing ones keep their meaning. The
data is still a draft; applications should pin a `catalog_version` they have checked.
