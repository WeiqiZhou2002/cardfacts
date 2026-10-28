# 按时间查看返现与报销信息

CardFacts 保存两条时间线，避免把「今天查到了」误记为「今天才生效」。

- **条款时间**：`effective_from` / `effective_to` 描述费用、返现或报销规则的生效区间，结束日期包含当天。
- **修订时间**：`history/<product-id>/<revision-id>.json` 保存该卡在 `recorded_at` 时的完整记录，包括备注、出处、核实日期和所有条款版本。新修订追加文件，旧文件不可修改或删除。

原始发卡机构网页不是目录快照的一部分；仓库只保存结构化事实与自行撰写的摘要。

## 查看历史

```sh
# 列出该卡的修订时间、修订原因、版本 ID 和内容哈希
pnpm --silent history us-capital-one-venture-x --json

# 还原 Phase 2 扩充前已经收录的完整内容
pnpm --silent history us-capital-one-venture-x --recorded-at 2026-10-28T22:00:00Z --json

# 以最新收录内容查看某个条款日期
pnpm --silent history us-amex-business-platinum --as-of 2027-01-01 --json

# 两个条件可一起使用：当时的记录，对某一天的条款如何描述
pnpm --silent history us-capital-one-venture-x \
  --recorded-at 2026-10-28T22:00:00Z --as-of 2026-10-27 --json

# 使用列表返回的两个 ID 比较完整内容，差异位置是 JSON Pointer
pnpm --silent history PRODUCT_ID --from EARLIER_REVISION_ID --to LATER_REVISION_ID --json
```

查询时间早于第一条目录修订时，返回 `status: "not_recorded"`，不补造旧内容。
`--as-of` 的返回值中，每条匹配版本带有 `certainty`：

| 值               | 含义                                                                 |
| ---------------- | -------------------------------------------------------------------- |
| `stated`         | 来源明确写出的起始日期                                               |
| `detected_start` | 从发现日期开始记录，不代表官方生效日                                 |
| `unknown_start`  | 起始日期未知；即使查询日期落入开放区间，也不能据此证明当时已有此权益 |
| `to_verify`      | 仍待核实，不能当成确认的数据使用                                     |

没有匹配的条款版本会被省略（费用返回 `null`）。例如 Freedom Flex 尚未收录的后续季度，不会沿用上一季度的商户类别。未匹配不等于确认没有权益。

`--as-of` 筛选的是选中快照中的条款版本；卡名、关键词等非版本字段取自该快照。需要查看旧的完整说明时使用 `--recorded-at`，而不是把当前说明投射到历史日期。

## 记录一次修订

1. 编辑 `data/us/...json`。实际条款变化关闭旧区间、追加新版本；纯编辑性修订或核实日期更新保留原条款区间。
2. 为每张有改动的卡生成新快照。时间使用实际记录时间，UTC、精确到秒；同一卡必须晚于其上次修订。
3. 校验并将数据与快照一起放入 PR。

```sh
pnpm snapshot PRODUCT_ID --recorded-at YYYY-MM-DDTHH:mm:ssZ --reason '说明本次修订与证据'
pnpm validate --base-ref origin/main
pnpm check
```

`pnpm snapshot` 只允许尚未记录的内容变化；相同内容、重复时间或倒填时间会被拒绝。
普通校验要求最新快照与当前卡片完全一致；Git 基线检查额外阻止改写、删除旧快照及向旧时间线插入新修订。
纯备注修订也必须留新快照。已收录数值仍受条款历史保护；纠正旧数值需要另行审查数据迁移，不能伪装成编辑性改动或捏造生效日期。

## 供网站和应用读取

`pnpm build` 生成当前数据 `dist/cards.json`、压缩版 `cards.min.json`、完整历史 `history.json` 与三个文件的 `SHA256SUMS`。
历史文件结构为 `{ format_version: 1, revisions: [...] }`，按修订时间、ID 排序；构建不插入当前时间。
`content_sha256` 对递归排序键后的卡片 JSON 计算 SHA-256，数组顺序保留。修改内容后重算哈希不能绕过 Git 基线不可变检查。

这提供 wiki 历史页面需要的数据、时间查询与差异能力。网页端的时间选择器和历史页面属于 Phase 3；当前可通过 CLI 或导出的 JSON 查看。

## Website history viewer

Phase 3 exposes these same two time axes on each card page: select a terms date and a recorded revision,
then compare any two snapshots in the history section. Deep links also accept `recorded_at` cutoffs.
See [the site guide](site.md) for routes, query parameters and local preview instructions.
