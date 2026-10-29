# CardFacts

Open, cited, versioned data on US credit cards, personal and business: **annual fees, earn rates and
statement credits**. Every number links to the issuer's own public terms and carries the date it was last
checked.

> **Status: Phase 3 implemented; draft data.** 30 cards (20 personal, 10 business), effective-dated terms,
> full revision snapshots, and a bilingual wiki with filters, comparison and a review queue. The site build
> and Pages workflow are ready; hosting requires merging and enabling Pages. No stable data release yet.

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

The planned scheduled agent will re-check issuer pages and open evidence-backed pull requests. It is not
deployed yet. All seven catalog issuer brands are manual-only until their automation terms are reviewed. The agent
cannot push to `main` or merge; a human reviews every data change. Its rules are in
the [skill](.claude/skills/card-catalog-maintainer/SKILL.md).

## Using the data

Applications should copy a pinned release into their own repository instead of fetching at runtime.
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
发卡机构的公开条款并记录核实日期；条款改版保留历史版本；未核实的数值不填写。Phase 3 已提供 30 张卡的中英双语网站、筛选对比、待复核队列，以及按生效日期／收录版本查看旧内容的历史页面。网站可本地预览，合并并开启 GitHub Pages 后部署；数据尚未发布稳定版本。设计文档见
[docs/proposal.zh.md](docs/proposal.zh.md)。
