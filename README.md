# CardFacts

Open, cited, versioned data on US credit cards, personal and business: **annual fees, earn rates and
statement credits**. Every number links to the issuer's own public terms and carries the date it was last
checked.

> **Status: Phase 4 in progress; draft data.** 30 cards (20 personal, 10 business), effective-dated terms,
> full revision snapshots, a bilingual [wiki](https://weiqizhou2002.github.io/cardfacts/) with filters,
> comparison and a review queue, a [JSON API](docs/api.md), and an intake for agent submissions. The
> collection agent is not deployed yet. Each data change is published as a `catalog-*` release; all are
> drafts so far.

## Why

Card terms change often, and the information people rely on lives in blogs, forums and spreadsheets that
are copyrighted, unstructured or unmaintained. Apps that want to show "how much of this quarter's dining
credit is left" or "which card earns most on groceries" each end up hard-coding their own table. CardFacts
aims to be the shared, machine-readable source with a clear trail back to the issuer.

## Principles

- **Issuer sources only.** A value is cited to the issuer's product page, terms, Guide to Benefits or
  cardmember agreement. Blogs and forums can point to a change; they are never the citation.
- **Never guess.** Unknown or unreadable values stay `null` and are marked `to_verify`.
- **History is kept.** A benefit refresh closes the old terms version; every catalog edit also appends a
  complete snapshot, including notes and citations. See [history queries](docs/history.md).
- **Facts, not prose.** Notes are short paraphrases; no copying of issuer or third-party text.

## What's here

| Path                                                                               | Contents                                            |
| ---------------------------------------------------------------------------------- | --------------------------------------------------- |
| [data/us/](data/us/)                                                               | 30 cited products: fees, earn rates and credits     |
| [site/](site/)                                                                     | Bilingual static wiki and browser interactions      |
| [docs/site.md](docs/site.md)                                                       | Website preview, history links and Pages deployment |
| [docs/api.md](docs/api.md)                                                         | JSON API for software: static files and a server    |
| [history/](history/)                                                               | Immutable complete product revisions                |
| [docs/history.md](docs/history.md)                                                 | Query and compare historical content                |
| [docs/phase-2-catalog.md](docs/phase-2-catalog.md)                                 | Phase 2 coverage and evidence limitations           |
| [schema/card.schema.json](schema/card.schema.json)                                 | Production JSON Schema 2020-12                      |
| [vocab/](vocab/)                                                                   | Bilingual earn and credit category vocabularies     |
| [docs/data-model.md](docs/data-model.md)                                           | Data contract and versioning decisions              |
| [docs/tooling.md](docs/tooling.md)                                                 | Setup, commands, fetching and local state           |
| [docs/phase-1-migration.md](docs/phase-1-migration.md)                             | Migration checks and evidence limitations           |
| [docs/proposal.zh.md](docs/proposal.zh.md)                                         | Original proposal and roadmap (Chinese)             |
| [docs/credit-progress.md](docs/credit-progress.md)                                 | Consumer matching and progress contract             |
| [vectors/credit-progress.json](vectors/credit-progress.json)                       | 23 unchanged synthetic conformance vectors          |
| [.claude/skills/card-catalog-maintainer/](.claude/skills/card-catalog-maintainer/) | Future maintenance-agent workflow                   |

## Development

Use Node.js 24 LTS and the pnpm version pinned in `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm check
```

`pnpm build` produces `dist/cards.json`, `dist/cards.min.json`, `dist/history.json`, and `dist/SHA256SUMS` deterministically.
Use `pnpm site:dev` to preview the wiki at `http://127.0.0.1:4173/`; `pnpm site:build` creates `dist/site/`.
See [the site guide](docs/site.md) for routes, history queries and Pages setup, and [tooling](docs/tooling.md)
for source listing, stale reporting, browser setup and history checks.

## Maintenance

A collection agent, kept in a separate private repository, re-checks issuer pages and sends structured
findings to the [submission intake](docs/agent-submissions.md). The intake opens pull requests: re-verifications
that only move dates forward, and data changes, which a human reviews before they merge. Neither can push
to `main`. The agent is not deployed yet. The fetch tooling in this repository treats all seven issuer
brands as manual-only until their website terms are reviewed. A weekly
[freshness check](docs/tooling.md#publishing-and-freshness) opens an issue when verified values go
unchecked for 21 days. Maintenance rules are in the [skill](.claude/skills/card-catalog-maintainer/SKILL.md).

## Using the data

Applications should copy a pinned [release](https://github.com/WeiqiZhou2002/cardfacts/releases) into
their own repository instead of fetching at runtime; see [API stability](docs/api.md#stability).
[Asset Ledger](https://github.com/WeiqiZhou2002/AssetLedger) is the first planned consumer.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The quickest help is reporting a change: open an issue with the
card name and a link to the issuer page that shows it.

## Licence

- Data (all JSON under `data/`, `history/`, `vocab/` and `vectors/`): [CC0 1.0](DATA_LICENSE), no rights reserved.
- Code, documentation and site: [MIT](LICENSE).

CardFacts is not affiliated with any card issuer or network; names and trademarks belong to their owners.
Nothing here is financial advice. Always confirm terms with the issuer before relying on them.

## 中文简介

CardFacts 是一个开源的美国信用卡数据项目，覆盖个人卡和商业卡的年费、返现/积分倍数和报销类权益。每个数字都引用
发卡机构的公开条款并记录核实日期；条款改版保留历史版本；未核实的数值不填写。目前有 30 张卡的中英双语网站（已部署在 GitHub Pages）、筛选对比、待复核队列，以及按生效日期／收录版本查看旧内容的历史页面，并提供 JSON API。每次数据变更都会发布一个 `catalog-*` release，目前均为草稿版本；自动收集 agent 尚未部署。设计文档见
[docs/proposal.zh.md](docs/proposal.zh.md)。
