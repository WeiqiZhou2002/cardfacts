# Drafts

`catalog.sample.json` predates the formal schema. It covers statement credits only, in the format described
in [docs/credit-progress.md](../docs/credit-progress.md) §1, for three cards checked against issuer pages on
2026-10-27. Fees and earn rates verified the same day are listed in the proposal §8.

Phase 1 migrates these drafts into `data/us/<issuer>/<product-id>.json` under the new schema and removes this
folder. Values marked `to_verify` stay unverified until an issuer source is cited.
