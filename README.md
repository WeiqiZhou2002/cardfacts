# CardFacts

Open, cited, versioned data on US credit cards, personal and business: **annual fees, earn rates and
statement credits**. Every number links to the issuer's own public terms and carries the date it was last
checked.

> **Status: design stage.** There is no stable data release yet. The schema, scripts and site are being
> built; the files below are the design and the first drafts.

## Why

Card terms change often, and the information people rely on lives in blogs, forums and spreadsheets that
are copyrighted, unstructured or unmaintained. Apps that want to show "how much of this quarter's dining
credit is left" or "which card earns most on groceries" each end up hard-coding their own table. CardFacts
aims to be the shared, machine-readable source with a clear trail back to the issuer.

## Principles

- **Issuer sources only.** A value is cited to the issuer's product page, terms, Guide to Benefits or
  cardmember agreement. Blogs and forums can point to a change; they are never the citation.
- **Never guess.** Unknown or unreadable values stay `null` and are marked `to_verify`.
- **History is kept.** A benefit refresh closes the old version and adds a new one with its effective date.
- **Facts, not prose.** Notes are short paraphrases; no copying of issuer or third-party text.

## What's here

| Path                                                                               | Contents                                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [docs/proposal.zh.md](docs/proposal.zh.md)                                         | Project proposal (Chinese): scope, data model, site, maintenance, roadmap |
| [docs/credit-progress.md](docs/credit-progress.md)                                 | How apps map statement credits to this data and compute period progress   |
| [vectors/credit-progress.json](vectors/credit-progress.json)                       | 23 synthetic test vectors for those rules                                 |
| [drafts/catalog.sample.json](drafts/catalog.sample.json)                           | Draft credits for three cards, cited and checked on 2026-10-27            |
| [.claude/skills/card-catalog-maintainer/](.claude/skills/card-catalog-maintainer/) | Skill for the maintenance agent                                           |

Planned layout once the schema lands: one JSON file per card under `data/us/<issuer>/`, vocabularies for
earn and credit categories, a JSON Schema, validation and build scripts, and a static bilingual site
generated from the data. See the proposal's roadmap (§9).

## Maintenance

A scheduled agent re-checks issuer pages, and when something changes it opens a pull request with the
evidence. It cannot push to `main` or merge; a human reviews every data change. The agent's rules are in
the [skill](.claude/skills/card-catalog-maintainer/SKILL.md).

## Using the data

Applications should copy a pinned release into their own repository instead of fetching at runtime.
[Asset Ledger](https://github.com/WeiqiZhou2002/AssetLedger) is the first planned consumer.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The quickest help is reporting a change: open an issue with the
card name and a link to the issuer page that shows it.

## Licence

- Data (all JSON under `data/`, `drafts/`, `vocab/` and `vectors/`): [CC0 1.0](DATA_LICENSE), no rights reserved.
- Code, documentation and site: [MIT](LICENSE).

CardFacts is not affiliated with any card issuer or network; names and trademarks belong to their owners.
Nothing here is financial advice. Always confirm terms with the issuer before relying on them.

## 中文简介

CardFacts 是一个开源的美国信用卡数据项目，覆盖个人卡和商业卡的年费、返现/积分倍数和报销类权益。每个数字都引用
发卡机构的公开条款并记录核实日期；条款改版保留历史版本；未核实的数值不填写。目前处于设计阶段，设计文档见
[docs/proposal.zh.md](docs/proposal.zh.md)。
