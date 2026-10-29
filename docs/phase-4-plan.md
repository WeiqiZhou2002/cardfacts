# Phase 4 实施计划：部署维护 agent

状态：计划，未实现。读者是实现者（按里程碑逐个 PR 实现）和仓库所有者（第 2 节的决定，以及第 7 节的上线操作）。

路线图第 4 步（[proposal.zh.md](proposal.zh.md) §9）：部署维护 agent，先只读运行两周，只出报告不开 PR；确认误报率后再开启 PR。
流程、权限与合并策略的原始设计见 proposal §6；agent 的工作规则见
[card-catalog-maintainer skill](../.claude/skills/card-catalog-maintainer/SKILL.md)。

## 1. 现状

已经具备（Phase 1–3）：

- `pnpm fetch-source`：无头浏览器渲染、robots.txt、域名白名单、每个来源每个 UTC 日最多一次、同一机构间隔 10 秒、全局锁、外部状态目录，失败时保留上次成功的快照，并记录连续失败次数。
- `pnpm sources`、`pnpm stale`、`pnpm snapshot`、`pnpm validate --base-ref`：来源清单、过期版本、不可变快照、历史保护。
- skill 文档：daily / reverify / verify / triage 四种模式，提取与版本规则，PR 模板。
- `change-report` issue 模板会自动打上 `change-report` 标签；CI 和 Pages 部署已上线。

缺少的部分：

| 缺口                 | 说明                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------- |
| 运行计划             | skill §2 的优先级队列（change-report → daily → 轮换）目前要 LLM 自己拼，没有代码          |
| 批量检查与运行记录   | 没有一次跑完整个队列并汇总结果的命令                                                      |
| 已核实基线           | 只知道"和上次抓取比变没变"，不知道"和最近一次确认数据无误时比变没变"                      |
| 每周复核             | 更新 `last_verified` 要 LLM 手改 30 个 JSON，容易出错，也没有 CI 防止夹带数值改动         |
| 结构化提议与摘要     | report-only 模式要求列出"本来会提的修改"，但没有格式，无法统计误报率                      |
| 编排与 GitHub 操作   | 定时入口、调用 Claude Code、维护 `Maintenance log` / `Source unreachable` issue 都没有    |
| 部署包与运维文档     | 容器、定时器、环境变量、标签、分支保护、出网白名单                                        |
| **抓取许可（阻塞）** | `maintenance/issuer-domains.json` 中 7 家机构全部 `manual_only`，agent 目前不会抓任何页面 |

## 2. 需要所有者做的决定

实现可以与这些决定并行，代码对每个选项都可配置；但上线前需要定下来。

| #   | 问题                                       | 建议                                                                                                                                                                                                      |
| --- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | 哪些发卡机构允许自动抓取（proposal §10.5） | 由所有者逐家阅读网站使用条款，把结论写进 `automation_review`，再从 `manual_only` 移除。实现者**不得**改动这份名单。若全部保持人工，就实现 M6（人工导入），让 agent 仍能比对和提取，只是网页由人打开保存。 |
| D2  | 运行方式、模型、预算（§10.4）              | Claude Code headless（`claude -p`），因为 skill 已按它编写。只在有页面需要复核时调用 LLM；每次运行设最大轮数和超时，每日来源上限沿用 `CARDFACTS_MAX_SOURCES=25`。                                         |
| D3  | 复核 PR 是否自动合并（§10.3）              | 试运行期间关闭。切换到 `pr` 模式且 M2 的"只改核实日期"CI 守卫上线后，再考虑打开 `CARDFACTS_AUTOMERGE_REVERIFY`。                                                                                          |
| D4  | 运行在哪台机器                             | 任何能跑 Docker 和 systemd 的 Linux 主机。需要出网代理或防火墙，只放行发卡机构域名、GitHub 和 Anthropic API。                                                                                             |
| D5  | `leads.json` 新闻源                        | 本阶段不做，保持空列表。                                                                                                                                                                                  |

## 3. 总体设计

原则：**能用代码确定的步骤全部用代码完成，LLM 只负责把网页文字读成结构化数值**，并且只在页面文字与已核实基线不同时才调用。这样多数日子不花 LLM 成本（proposal §6.5），行为可测试，模式限制靠工具权限保证，不只靠提示词。

```text
systemd timer ─> ops/maintainer/run.sh MODE（flock 防重入）
  └─ pnpm maintain MODE（TypeScript 编排，外部命令可注入，便于测试）
       1. 同步 main、确认工作区干净、pnpm install --frozen-lockfile、pnpm validate
          （失败：开或更新 issue "main fails validation"，停止）
       2. gh 读取打开的 change-report issue ─> parse-change-reports ─> 产品 id
       3. plan-run ─> runs/<id>.plan.json        （确定性）
       4. run-checks ─> runs/<id>.json            （确定性；逐个调用 fetchSource）
       5. 若有 needs_review 或无法解析的 change-report：
            claude -p（按模式限制工具）─> proposals/<id>.json，pr 模式下另开 PR
            对数据与页面一致的来源调用 confirm-source
       6. reverify 模式：reverify ─> 校验 ─> 复核 PR（pr 模式）
       7. run-summary ─> 评论 "Maintenance log" issue
          连续失败 ≥ 3 次的来源 ─> 开或更新 "Source unreachable: <id>"
```

### 3.1 已核实基线（核心概念）

`fetch-source` 的 `changed` 只表示和上一次成功抓取相比文字变了。如果某天 LLM 没跑完（预算、报错），第二天哈希不变，真实变化就被漏掉。因此新增"已核实基线"：某个来源的页面文字经 agent 或人确认与数据一致时，记录当时的哈希。

- `needs_review = 今天抓取成功 && last_success.hash !== confirmed.hash`（没有基线也算）。
- 第一次抓取没有基线，所以必然需要复核。前几天会因预算上限分批完成，这是预期行为。
- 机器人 PR 合并后，下一次运行仍是 `needs_review`。LLM 再次提取，发现数据已一致，就确认基线，状态自行恢复。
- 只有哈希等于基线的来源，才能由代码自动更新 `last_verified`（M2）。

### 3.2 状态目录新增内容

均在 `CARDFACTS_STATE_DIR` 内，永不进仓库：

```text
confirmed/<sha256(url)>.json   已核实基线
runs/<run-id>.plan.json        运行计划
runs/<run-id>.json             运行结果
proposals/<run-id>.json        LLM 写出的结构化提议
verdicts.json                  可选：所有者对试运行提议的判定
inbox/                         仅 M6：人工保存的网页文字
```

`run-id` 格式为 `YYYYMMDDTHHMMSSZ-<mode>`（UTC）。

## 4. 里程碑

每个里程碑一个 PR，基于最新的 `main`，前一个合并后再开下一个。每个 PR 必须包含测试、文档更新和 CHANGELOG 条目，并通过 `pnpm check`。

### M1 运行计划与批量检查

新增 `scripts/lib/maintenance/state.ts`、`queue.ts`、`checks.ts`，CLI 子命令写进 `scripts/cli.ts`（沿用 `parseArgs` + `permitted` 写法）。

**`pnpm plan-run --mode daily|reverify --as-of YYYY-MM-DD [--max N] [--change-report PRODUCT_ID ...] --json`**

```json
{
  "format_version": 1,
  "mode": "daily",
  "as_of": "2026-11-02",
  "max_sources": 25,
  "queue": [
    {
      "source_id": "chase-sapphire-reserve-page",
      "url": "https://…",
      "issuer": "chase",
      "products": ["us-chase-sapphire-reserve"],
      "reason": "daily",
      "last_checked": "2026-11-01"
    }
  ],
  "manual_due": [],
  "deferred": 0
}
```

- `reason` 的优先级：`change_report` > `daily`（`maintenance/schedule.json`）> `rotation`。同一来源只出现一次，保留最高优先级。
- 轮换到期的条件：从未检查，或 `last_checked` 早于 `as_of - rotation_days`。从未检查的排最前，其余按最早检查时间排序。
- `last_checked` 取自现有状态文件 `<sha256(url)>.json` 的 `checked_at`，失败的尝试也算。
- `reverify` 模式的队列：`staleVersions(catalog, 7, as_of)` 涉及的、状态为 `verified` 的版本所引用的来源。
- `manual_only` 机构的来源不进入队列、不占预算；若到期，放入 `manual_due`。
- 超过 `--max` 的部分计入 `deferred`。
- 纯函数，以 catalog、状态读取器和日期作为输入。

**`pnpm run-checks --plan FILE --json`**：按队列顺序调用现有的 `fetchSource`（锁和限速保持原样），写入并打印 `runs/<run-id>.json`。

```json
{
  "format_version": 1,
  "run_id": "20261102T061500Z-daily",
  "mode": "daily",
  "cardfacts_mode": "report-only",
  "started_at": "…",
  "finished_at": "…",
  "results": [
    {
      "source_id": "…",
      "products": ["…"],
      "status": "changed",
      "cached": false,
      "hash": "…",
      "previous_hash": "…",
      "confirmed_hash": null,
      "needs_review": true,
      "consecutive_failures": 0,
      "error": null
    }
  ],
  "needs_review": ["…"],
  "unreachable": [{ "source_id": "…", "consecutive_failures": 3 }],
  "manual_due": [],
  "deferred": 0
}
```

- 抓取失败属于数据，不是命令错误：退出码 0。只有工具本身出错（状态损坏、锁冲突等）才非零。
- 当天已有缓存结果的来源照样列出，`cached: true`。

测试（`tests/maintenance-queue.test.ts`、`tests/maintenance-checks.test.ts`）：使用临时状态目录和假的 `SourceTransport`（参照 `tests/fetch-source.test.ts` 的 `automated()` 写法，不修改真实的 `manual_only` 配置），覆盖优先级、去重、轮换边界、预算截断、manual_due、reverify 队列、needs_review 计算、失败计数和缓存。

### M2 已核实基线与每周复核

**`pnpm confirm-source SOURCE_ID --hash HASH --by agent|human [--fields all|PTR,PTR] [--run RUN_ID]`**

- `HASH` 必须等于该来源状态里的 `last_success.hash`，不能确认从未抓到过的内容。
- `--fields` 必须是 `pnpm sources` 中引用该来源的字段指针的子集，默认 `all`。
- 写入 `confirmed/<key>.json`：`{ source_id, url, hash, confirmed_at, by, run_id, fields }`。

**`pnpm reverify --run FILE --as-of DATE --recorded-at TIME --json`**：直接修改工作区数据。

- 只处理本次运行成功、且 `hash === confirmed.hash` 的来源。
- 只更新基线 `fields` 覆盖到的版本，且版本须为 `status: "verified"`，并满足 `effective_to` 为 `null` 或 ≥ `as_of`。把 `last_verified` 设为该来源这次抓取的 UTC 日期（只增不减）；该来源的 `accessed` 同样更新。
- `to_verify` 版本和已结束的版本不动。其他任何字段都不动。
- 每张有改动的卡调用 `recordRevision` 追加快照，reason 写明版本数量和来源 id。
- 写回 JSON 后用 prettier API 格式化，保证 `pnpm format:check` 通过。
- 没有可更新的内容时不修改任何文件，输出 `{ "changed": false }`。

**`pnpm check-reverify-diff --base-ref REV`**：对比基线修订与工作区。只允许以下差异，否则报错：版本的 `last_verified` 变大、来源的 `accessed` 变大、`history/` 下新增文件。

**CI**：新增 `.github/workflows/reverify-guard.yml`，监听 `pull_request` 的 `opened`、`synchronize`、`reopened`、`labeled`、`unlabeled` 事件。PR 带 `reverify` 标签时运行 `pnpm check-reverify-diff --base-ref "$BASE_SHA"`。

测试：基线写入与拒绝（哈希不符、字段越界）；reverify 只改允许的字段、跳过 `to_verify`、已结束版本和哈希不符的来源、追加快照、结果幂等；diff 守卫能拒绝数值、备注、版本区间的改动。

### M3 结构化提议、change-report 解析与运行摘要

- **`schema/proposals.schema.json`** 与 **`pnpm validate-proposals FILE`**（ajv）：

  ```json
  {
    "format_version": 1,
    "run_id": "…",
    "proposals": [
      {
        "id": "20261102T061500Z-daily-1",
        "product_id": "us-amex-gold",
        "source_id": "…",
        "kind": "value_change",
        "path": "/credits/1/versions/0/amount",
        "before": "50.00",
        "after": "60.00",
        "effective_from": "2027-01-01",
        "effective_from_basis": "stated",
        "evidence": "Benefits section, Resy credit row"
      }
    ],
    "confirmed_sources": ["…"],
    "suspicious_pages": [],
    "pull_requests": []
  }
  ```

  `kind` 取值：`value_change`、`new_entry`、`removal`、`conflict`、`unreadable`、`mismatch`，对应 skill §4 的表格。`evidence` 只写位置描述，最多几个词，不复制页面原文。

- **`pnpm parse-change-reports --issues FILE --json`**：输入 `gh issue list --json number,title,body,url` 的输出。解析 issue 表单中 `### Card or product ID` 一节；能精确匹配产品 id，或经 `normalizeKeyword` 后与卡名或别名匹配的，归入 `matched`，其余归入 `unmatched`（交给 LLM 做 triage）。issue 正文一律当作线索，不当作来源。
- **`pnpm run-summary --run FILE [--proposals FILE] --json|--markdown`**：按 skill §7 的格式生成英文 Markdown。report-only 模式下逐条列出提议，每条带 `id`，方便所有者判定。
- **`pnpm trial-stats --since DATE --json`**：汇总运行次数、检查数、changed / failed / needs_review 数量、各类提议数、每个来源连续出现"变化"的天数（用于识别页面噪声），并读取可选的 `verdicts.json`（`{ "<proposal-id>": "correct" | "incorrect" | "unsure" }`）计算误报率。

测试：schema 的正反例；表单解析（id、卡名、别名、无法识别）；摘要快照测试；统计口径。

### M4 编排与 LLM 调用

- **`scripts/lib/maintenance/orchestrate.ts`** 与 **`pnpm maintain daily|reverify [--dry-run]`**：实现第 3 节流程。所有外部命令（`git`、`gh`、`claude`）通过可注入的 `exec` 调用。`--dry-run` 只打印将要执行的写操作（push、`gh pr create`、`gh issue comment` 等），不真正执行。
- **工作区**：要求在 agent 专用的 checkout 中运行，工作区不干净就停止；只做 fast-forward，不 `reset --hard`、不 `clean`。
- **Issue 维护**：按精确标题查找打开的 issue（`Maintenance log`、`main fails validation`、`Source unreachable: <id>`），存在则评论，否则新建。机器人创建的 issue 打 `bot` 标签。
- **LLM 调用**：提示词放在 `ops/maintainer/prompts/daily.md`、`triage.md`。提示词内容：加载 skill，给出运行文件路径、`needs_review` 来源与未匹配的 change-report，要求写出 `proposals/<run-id>.json`，并对与数据一致的来源调用 `confirm-source`。
  - **工具权限按模式区分**，在 `ops/maintainer/claude-settings.<mode>.json` 中配置：
    - `report-only`：只读工具，加上 `pnpm --silent sources|history|stale` 和 `pnpm confirm-source`；只允许写 `proposals/` 目录。
    - `pr`：在此基础上允许编辑 `data/`、执行 `pnpm snapshot|validate|build`、`git` 的分支、提交与推送（仅限 `bot/*`）、`gh pr create|edit|view`。
  - 不允许合并、批准、关闭 PR 或 issue，也不允许推送 `main`。
  - CLI 参数（`--max-turns`、`--allowedTools`、settings 文件路径、输出格式等）**以服务器上实际安装的 `claude --help` 为准**，不要凭记忆写。限制通过 `CARDFACTS_LLM_MAX_TURNS` 和 `CARDFACTS_LLM_TIMEOUT_SECONDS` 配置。
  - 运行结束后用 `validate-proposals` 校验提议文件；校验失败要写进摘要，不得静默忽略。
- **reverify 模式**：
  - `pr` 模式：在 `bot/reverify/<YYYY-MM-DD>` 上依次运行 `reverify`、`validate --base-ref origin/main`、`build`、`check-reverify-diff`，然后提交、推送，执行 `gh pr create --label bot --label reverify`；`CARDFACTS_AUTOMERGE_REVERIFY=true` 时再加 `--label automerge`。
  - `report-only` 模式：只在摘要里写"本来会复核 N 个版本"，并丢弃工作区改动。
- **`ops/maintainer/run.sh MODE`**：`set -euo pipefail`，用 `flock` 防止重入，检查必需的环境变量（缺少时报出变量名，不打印变量值），然后调用 `pnpm maintain`。
- **不得出现在日志、PR 或 issue 中**：任何 token 与环境变量的值；抓取到的页面原文。

测试：用假的 `exec` 覆盖以下场景，断言命令序列和写操作：

- 无需复核时不调用 LLM；
- `main` 校验失败时开 issue 并停止；
- report-only 模式下不出现任何 push 或 PR 命令；
- 连续失败 3 次时开 issue，已有同名 issue 时改为评论；
- `--dry-run` 不执行任何写操作。

### M5 部署包与文档

- `ops/maintainer/Dockerfile`：Node 24、corepack 固定的 pnpm、Playwright Chromium 及其系统依赖、`gh`、Claude Code CLI；以非 root 用户运行；状态目录挂载为卷。
- `ops/maintainer/systemd/`：`cardfacts-maintainer@.service`，以及两个定时器：每日运行 `daily`，每周一运行 `reverify`。时间用 UTC，并设置 `RandomizedDelaySec`。
- `ops/maintainer/env.example`：只放占位值，包括 `CARDFACTS_*`、`GH_TOKEN`、`ANTHROPIC_API_KEY`、LLM 限制等变量。
- `ops/maintainer/setup-labels.sh`：幂等地创建 `bot`、`data-change`、`reverify`、`automerge` 标签。
- `pnpm egress-allowlist`：输出出网白名单，即 `issuer-domains.json` 中的域名加上 GitHub 与 Anthropic API 所需域名，供代理或防火墙使用。
- `docs/maintainer-ops.md`（运维手册）：
  - 安装步骤；
  - token 权限：细粒度 token，只授权本仓库的 Contents、Pull requests、Issues 读写；
  - `main` 分支保护：必须走 PR，必须通过 `check`；
  - 试运行与切换流程（第 7 节）；
  - 常见故障处理；
  - 如何暂停 agent。
- 更新 skill 与相关文档：
  - SKILL.md 改为调用上述命令：队列来自运行文件；提取结果写成提议文件；数据一致时确认基线。
  - 删除 `references/extraction.md` 中"轮换类别和最高消费类别在 Phase 1 暂缓"的过时说明（schema v2 已支持）。
  - 更新 `pnpm build` 一行的过时描述。
  - 更新 `docs/tooling.md`、proposal §9、CHANGELOG。

### M6（取决于 D1）人工导入

- **`pnpm ingest-source SOURCE_ID --file PATH --observed-at TIME`**：
  - 读入人用浏览器打开页面后保存的纯文本，用 `normalizePage` 规范化。
  - 沿用 `fetch-source` 的检查：长度、验证码字样。
  - 以 `origin: "manual"` 写入同一份来源状态，和自动抓取的结果没有区别。
- **`CARDFACTS_INBOX_DIR`**：每日运行前自动导入 `inbox/<source-id>.txt`，处理后移入 `inbox/done/`。
- **效果**：即使所有机构都保持 `manual_only`，人只需打开 `manual_due` 中列出的网址并保存文字，比对、提取、提议和 PR 仍由 agent 完成。

## 5. 给实现者的全局约束

1. 不修改 `data/`、`history/`、`vectors/` 和 `maintenance/issuer-domains.json` 的 `manual_only` 名单。不新增卡片，也不改词表。
2. 库代码（`scripts/lib/**`）不访问网络、不调用 GitHub。外部副作用只能出现在 M4 的编排层，并通过可注入的 `exec` 执行。
3. 测试全部离线：使用临时目录和假的 transport / exec。`pnpm check` 必须通过，CI 也必须通过。
4. 新增 CLI 子命令遵循 `scripts/cli.ts` 的现有写法：参数白名单、空值拒绝、JSON 输出。在 `docs/tooling.md` 的命令表中补上新命令的说明。
5. 代码风格与现有代码一致：紧凑的 TypeScript、少量注释、命名风格相同。
6. 状态文件写入沿用 `atomicJson` 的原子写法；新增的 JSON 格式都带 `format_version`。
7. 仓库里不出现真实的 token、主机名或个人信息；示例一律用占位值。
8. 每个 PR 只做一个里程碑。PR 描述写明完成了哪些验收项，以及哪些内容需要所有者在 GitHub 或服务器上操作。

## 6. 不在本阶段

- 新闻源 / leads 抓取、开卡奖励、新增卡片。
- 发布 GitHub Release 或 npm 包（路线图第 5 步）。
- 为特定来源编写正文选择器、裁剪动态内容。先用 M3 的 `trial-stats` 判断是否需要，再另做。
- 绕过任何登录、验证码或机器人检测。

## 7. 上线步骤（所有者）

1. 合并 M1–M5（如果 D1 决定全部人工，再加上 M6）。
2. 完成 D1：至少有一家机构经审阅后移出 `manual_only`，否则只能依靠 M6 的人工导入。
3. GitHub 设置：
   - 运行 `setup-labels.sh` 创建标签；
   - 为 `main` 开启分支保护（必须走 PR，必须通过 `check`）；
   - 创建细粒度 token。
4. 服务器：按 `docs/maintainer-ops.md` 构建镜像，配置 `env`（`CARDFACTS_MODE=report-only`）、出网白名单和 systemd 定时器。先手动运行一次 `pnpm maintain daily --dry-run`。
5. **试运行两周**：所有者每天查看 `Maintenance log`，并在 `verdicts.json` 中判定每条提议。
6. **切换到 `pr` 模式的条件**（参考 `trial-stats`）：
   - 连续至少 14 次每日运行，工具错误都已查明原因；
   - 最近 7 次运行中没有错误的数值提议，全部提议的误报率不超过 5%，且每条误报都查明了原因；
   - 没有来源因页面噪声连续 3 天以上被判定为"变化"，或者已有应对办法；
   - 平均每次运行的 LLM 花费在 D2 的预算之内。
7. 改为 `CARDFACTS_MODE=pr`。复核 PR 先人工合并；稳定后再按 D3 决定是否开启自动合并。

## 8. 风险

| 风险                       | 应对                                                                       |
| -------------------------- | -------------------------------------------------------------------------- |
| 页面含动态内容，哈希天天变 | 用 `trial-stats` 找出噪声来源；必要时另做正文裁剪                          |
| 发卡机构有机器人检测       | 记为失败，不绕过；连续失败后开 issue；改为人工检查或使用 M6                |
| LLM 提取错误               | 先只读试运行；`validate --base-ref` 保护历史数据；所有数值改动都由人工合并 |
| 页面内容里的提示词注入     | 页面一律视为数据；工具权限按模式收紧；agent 不能合并 PR，也不能推送 `main` |
| 使用条款                   | 由 D1 决定，以 `manual_only` 名单为准；M6 让人工检查也能接入流程           |
| 成本失控                   | 只对 `needs_review` 的来源调用 LLM；限制来源数量、最大轮数和超时           |
