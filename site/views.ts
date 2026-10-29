import type { Card, CreditVersion, EarnVersion, Version } from "../scripts/lib/types.js";
import { revisionDiff, termsAt } from "../scripts/lib/temporal.js";
import {
  category,
  dollars,
  filterCards,
  h,
  href,
  rate,
  reportLink,
  reviewItems,
  selectedRevision,
  t,
} from "./model.js";
import type { Context, Page } from "./model.js";

// Only links that leave the site get a marker.
const external = '<span class="ext" aria-hidden="true">↗</span>';
const tag = (text: string, type = "") => `<span class="tag${type ? ` ${type}` : ""}">${h(text)}</span>`;
const label = (ctx: Context, zh: string, en: string) => h(t(ctx, zh, en));
const audience = (ctx: Context, card: Card) =>
  label(
    ctx,
    card.audience === "personal" ? "个人卡" : "商业卡",
    card.audience === "personal" ? "Personal" : "Business",
  );
export function pagePath(ctx: Context) {
  return ctx.page === "catalog"
    ? ""
    : ctx.page === "404"
      ? "404.html"
      : ctx.page === "card"
        ? `cards/${ctx.productId}/`
        : `${ctx.page}/`;
}
function langUrl(ctx: Context) {
  const query = ctx.params.toString();
  return `${ctx.data.base}${ctx.lang === "zh" ? "en/" : ""}${pagePath(ctx)}${query ? `?${query}` : ""}`;
}
export function header(ctx: Context) {
  return `<a class="skip-link" href="#main">${label(ctx, "跳到正文", "Skip to content")}</a>
  <header class="site-header"><div class="header-inner"><a class="brand" href="${h(href(ctx))}">CardFacts</a>
  <nav aria-label="${label(ctx, "主导航", "Main navigation")}">${(
    [
      ["catalog", "卡片目录", "Catalog", ""],
      ["compare", "对比", "Compare", "compare/"],
      ["review", "待复核", "Review queue", "review/"],
      ["about", "关于", "About", "about/"],
    ] as const
  )
    .map(
      ([page, zh, en, path]) =>
        `<a href="${h(href(ctx, path))}" ${ctx.page === page ? 'aria-current="page"' : ""}>${label(ctx, zh, en)}${page === "compare" && ctx.selected.length ? ` <span class="nav-count">(${ctx.selected.length})</span>` : ""}</a>`,
    )
    .join("")}</nav>
  <div class="header-tools"><a class="language" href="${h(langUrl(ctx))}" lang="${ctx.lang === "zh" ? "en" : "zh-CN"}">${ctx.lang === "zh" ? "English" : "中文"}</a><a href="${h(ctx.data.repository)}" target="_blank" rel="noopener noreferrer">GitHub${external}</a></div></div></header>`;
}
export function footer(ctx: Context) {
  return `<footer class="site-footer"><p>${label(ctx, "资料仍为草稿，请以发卡机构公布的条款为准。CardFacts 与任何发卡机构无关联。", "Draft data: confirm terms with the issuer. CardFacts is not affiliated with any card issuer.")}</p><p><a href="${h(href(ctx, "about/"))}">${label(ctx, "关于数据", "About the data")}</a> · <a href="${h(ctx.data.base)}data/cards.json" download>${label(ctx, "下载 cards.json", "Download cards.json")}</a> · <a href="${h(reportLink(ctx))}" target="_blank" rel="noopener noreferrer">${label(ctx, "报告变化", "Report a change")}${external}</a> · ${label(ctx, "数据 CC0，代码 MIT", "Data CC0, code MIT")} · <span class="mono">${h(ctx.data.version)}</span></p></footer>`;
}
function option(value: string, text: string, selected: string) {
  return `<option value="${h(value)}"${value === selected ? " selected" : ""}>${h(text)}</option>`;
}
function select(ctx: Context, name: string, title: string, options: [string, string][], first?: string) {
  return `<label class="field"><span>${h(title)}</span><select name="${name}">${option("", first ?? t(ctx, "全部", "All"), ctx.params.get(name) ?? "")}${options.map(([v, n]) => option(v, n, ctx.params.get(name) ?? "")).join("")}</select></label>`;
}
const issuerOptions = (ctx: Context): [string, string][] =>
  [...new Set(ctx.data.cards.map((c) => c.issuer))].sort().map((x) => [x, x]);
function search(ctx: Context) {
  return `<label class="field search-field"><span class="sr-only">${label(ctx, "搜索卡片", "Search cards")}</span><input type="search" name="q" value="${h(ctx.params.get("q") ?? "")}" placeholder="${label(ctx, "搜索卡名或发卡机构", "Search cards or issuers")}" autocomplete="off"></label>`;
}
function dateField(ctx: Context, name = "asof") {
  return `<label class="field date-field"><span>${label(ctx, name === "asof" ? "条款日期" : "复核参考日", name === "asof" ? "Terms on" : "Review as of")}</span><input type="date" name="${name}" value="${h(name === "asof" ? ctx.asOf : ctx.reviewOn)}" required min="0001-01-01" max="9999-12-31"></label>`;
}
function pageHead(title: string, description: string, extra = "") {
  return `<header class="page-head"><h1>${h(title)}</h1><p>${h(description)}</p>${extra}</header>`;
}
export function catalogPage(ctx: Context) {
  const issuers = new Set(ctx.data.cards.map((c) => c.issuer)).size;
  return `${pageHead(
    t(ctx, "美国信用卡资料库", "US credit card index"),
    t(
      ctx,
      "年费、返现和报销条款，每一项都注明发卡机构来源和核实日期，每次修改都保留在修订历史里。",
      "Annual fees, earn rates and statement credits. Every value cites an issuer source and a verification date, and every edit stays in the revision history.",
    ),
    `<p class="page-meta">${ctx.data.cards.length} ${label(ctx, "张卡", "cards")} · ${issuers} ${label(ctx, "家发卡机构", "issuers")} · ${label(ctx, "数据版本", "Data version")} <span class="mono">${h(ctx.data.version)}</span></p>`,
  )}
  <div class="catalog-layout"><aside class="filter-panel"><form id="catalog-filters" action="${h(href(ctx))}" method="get"><div class="filter-title"><h2>${label(ctx, "筛选", "Filters")}</h2><button type="button" class="link-button" data-reset>${label(ctx, "重置", "Reset")}</button></div>${search(ctx)}<button type="button" class="mobile-filter-toggle" data-filters aria-expanded="false">${label(ctx, "显示筛选条件", "Show filters")}</button>
  <div class="filter-fields">${select(ctx, "audience", t(ctx, "卡片类型", "Card type"), [
    ["personal", t(ctx, "个人卡", "Personal")],
    ["business", t(ctx, "商业卡", "Business")],
  ])}
  ${select(ctx, "issuer", t(ctx, "发卡机构", "Issuer"), issuerOptions(ctx))}
  ${select(ctx, "fee", t(ctx, "年费（美元）", "Annual fee (USD)"), [
    ["free", t(ctx, "无年费", "No annual fee")],
    ["low", "$1–99"],
    ["mid", "$100–399"],
    ["high", "$400+"],
    ["unknown", t(ctx, "尚未确认", "Unconfirmed")],
  ])}
  ${select(
    ctx,
    "credit",
    t(ctx, "报销种类", "Credit category"),
    ctx.data.creditCategories.map((c) => [c.id, c.name[ctx.lang]]),
  )}
  ${select(
    ctx,
    "earn",
    t(ctx, "返现 / 积分类别", "Earn category"),
    ctx.data.earnCategories.map((c) => [c.id, c.name[ctx.lang]]),
  )}
  <div class="field-pair">${select(ctx, "unit", t(ctx, "奖励单位", "Reward unit"), [
    ["cash", t(ctx, "返现 %", "Cash %")],
    ["points", t(ctx, "积分 ×", "Points ×")],
    ["miles", t(ctx, "里程 ×", "Miles ×")],
  ])}<label class="field"><span>${label(ctx, "最低倍率", "Minimum rate")}</span><input type="number" min="0" step="0.5" name="min_rate" value="${h(ctx.params.get("min_rate") ?? "")}" placeholder="0"></label></div>
  <p class="field-help">${label(ctx, "积分、里程和返现之间不做换算。筛选只看已核实的数值，实际是否适用仍取决于条件。", "Points, miles and cash are not converted. Filters use verified values only; eligibility conditions still apply.")}</p>
  ${dateField(ctx)}<button class="button" type="submit">${label(ctx, "应用筛选", "Apply filters")}</button></div></form></aside>
  <section class="catalog-results" aria-label="${label(ctx, "卡片列表", "Card list")}"><div class="results-toolbar"><p id="result-count" role="status" aria-live="polite">${resultCount(ctx)}</p><label class="sort-control">${label(ctx, "排序", "Sort")} <select name="sort" form="catalog-filters">${option("", t(ctx, "发卡机构、卡名", "Issuer, name"), ctx.params.get("sort") ?? "")}${option("fee", t(ctx, "年费从低到高", "Annual fee, low to high"), ctx.params.get("sort") ?? "")}</select></label></div>
  <div class="catalog-head" aria-hidden="true"><span>${label(ctx, "卡片", "Card")}</span><span>${label(ctx, "年费", "Annual fee")}</span><span>${label(ctx, "主要返现", "Top earn rates")}</span><span>${label(ctx, "周期报销", "Credits")}</span><span>${label(ctx, "对比", "Compare")}</span></div><div id="card-results">${catalogResults(ctx)}</div><p class="footnote">${label(ctx, "年费和返现按所选条款日期显示。起始日期未知的条款，不能证明它在更早的日期已经适用。", "Fees and earn rates follow the selected terms date. A term with an unknown start date is not evidence that it applied earlier.")}</p></section></div><div id="compare-tray">${compareTray(ctx)}</div>`;
}
export function resultCount(ctx: Context) {
  return `${label(ctx, "显示", "Showing")} ${filterCards(ctx).length} / ${ctx.data.cards.length} ${label(ctx, "张卡", "cards")}`;
}
export function catalogResults(ctx: Context) {
  const cards = filterCards(ctx);
  if (!cards.length)
    return `<div class="empty-state"><p><strong>${label(ctx, "没有符合条件的卡片。", "No matching cards.")}</strong> ${label(ctx, "可以减少筛选条件，或换一个条款日期。", "Try fewer filters or a different terms date.")}</p><button class="button secondary" type="button" data-reset>${label(ctx, "清除筛选", "Clear filters")}</button></div>`;
  return cards
    .map((card) => {
      const terms = termsAt(card, ctx.asOf);
      const pending = [...(terms.fees ? [terms.fees] : []), ...terms.earn_rates, ...terms.credits].some(
        (v) => v.version.status === "to_verify",
      );
      const previews = terms.earn_rates
        .filter(
          (r) => r.version.status === "verified" && !["everything_else", "rotating"].includes(r.category),
        )
        .slice(0, 2);
      const fee = terms.fees?.version.annual_fee;
      const earn = previews.length
        ? previews
            .map(
              (r) =>
                `<span class="preview">${h(category(ctx, "earn", r.category))} <b>${h(rate(card, r.version.rate))}</b></span>`,
            )
            .join("")
        : `<span class="preview">${label(ctx, "基础", "Base")} <b>${h(rate(card, terms.earn_rates.find((r) => r.category === "everything_else")?.version.rate ?? null))}</b></span>`;
      return `<article class="catalog-row" data-card="${h(card.id)}"><div class="row-card"><h2><a href="${h(href(ctx, `cards/${card.id}/`))}">${h(card.name)}</a></h2><p class="row-meta">${h(card.issuer)} · ${audience(ctx, card)}${pending ? ` ${tag(t(ctx, "部分待核实", "Some terms pending"), "warn")}` : ""}${card.availability !== "open" ? ` ${tag(t(ctx, "已停止申请", "Closed to applications"))}` : ""}</p></div>
    <div class="row-fee"><span class="mobile-label">${label(ctx, "年费", "Annual fee")}</span>${fee == null ? `<span class="muted">${label(ctx, "待确认", "Unconfirmed")}</span>` : dollars(fee)}</div>
    <div class="row-earn"><span class="mobile-label">${label(ctx, "返现", "Earn")}</span>${earn}</div>
    <div class="row-credits"><span class="mobile-label">${label(ctx, "报销", "Credits")}</span>${terms.credits.length ? label(ctx, `${terms.credits.length} 项`, `${terms.credits.length}`) : '<span class="muted">—</span>'}</div>
    <label class="row-compare"><input type="checkbox" data-compare="${h(card.id)}"${ctx.selected.includes(card.id) ? " checked" : ""} ${ctx.selected.length >= 4 && !ctx.selected.includes(card.id) ? "disabled" : ""}><span class="sr-only">${label(ctx, "对比", "Compare")} ${h(card.name)}</span></label></article>`;
    })
    .join("");
}
export function compareTray(ctx: Context) {
  return ctx.selected.length
    ? `<aside class="compare-tray"><p>${label(ctx, "已选", "Selected")} ${ctx.selected.length}/4${label(ctx, "：", ": ")}${h(ctx.selected.map((id) => ctx.data.cards.find((c) => c.id === id)!.name).join(t(ctx, "、", ", ")))}</p><div class="tray-actions"><button type="button" data-clear-compare class="link-button">${label(ctx, "清空", "Clear")}</button><a class="button" href="${h(href(ctx, "compare/"))}">${label(ctx, "对比", "Compare")}</a></div></aside>`
    : "";
}
function emptyTerms(ctx: Context) {
  return `<p class="muted">${label(ctx, "这个日期没有已收录的适用版本。这不代表该权益当时不存在。", "No recorded version applies on this date. This does not establish that the benefit did not exist.")}</p>`;
}
function period(ctx: Context, v: CreditVersion) {
  const names = {
    monthly: ["每月", "month"],
    quarterly: ["每季度", "quarter"],
    semiannual: ["每半年", "half-year"],
    annual: ["每年", "year"],
    multi_year: [`每 ${v.period_years} 年`, `${v.period_years} years`],
  };
  return names[v.period][ctx.lang === "zh" ? 0 : 1]!;
}
function reset(ctx: Context, basis: string) {
  const map: Record<string, [string, string]> = {
    calendar: ["自然周期", "Calendar period"],
    anniversary: ["卡周年", "Account anniversary"],
    anniversary_statement: ["周年账单周期", "Anniversary statement"],
    since_last_credit: ["自上次报销起", "Since last credit"],
    month_after_annual_fee: ["年费收取后的次月起", "Month after annual fee"],
    qualifying_activity: ["按连续合资格活动", "Qualifying activity"],
  };
  return map[basis]?.[ctx.lang === "zh" ? 0 : 1] ?? basis;
}
// Most terms have an unknown start date, so a known start is what gets shown.
function certainty(ctx: Context, v: Version) {
  if (v.status === "to_verify") return tag(t(ctx, "待核实", "Pending verification"), "warn");
  if (v.effective_from === null) return "";
  return tag(
    v.effective_from_basis === "detected"
      ? t(ctx, `${v.effective_from} 发现`, `observed ${v.effective_from}`)
      : t(ctx, `${v.effective_from} 起`, `from ${v.effective_from}`),
  );
}
function interval(ctx: Context, v: Version) {
  return `${v.effective_from ?? t(ctx, "起始日未知", "Unknown start")} → ${v.effective_to ?? t(ctx, "未记录终止日", "No recorded end")}`;
}
function provenance(ctx: Context, card: Card, v: Version) {
  const src = card.sources.find((s) => s.id === v.source);
  // The interval already shows the dates; only flag what it cannot say.
  const marker =
    v.status === "to_verify"
      ? tag(t(ctx, "待核实", "Pending verification"), "warn")
      : v.effective_from_basis === "detected" && v.effective_from
        ? tag(t(ctx, "起始日按发现日记录", "Start date as observed"))
        : "";
  return `<p class="provenance">${marker ? `${marker} ` : ""}${label(ctx, "生效", "Effective")} ${h(interval(ctx, v))} · <a href="#source-${h(v.source)}">${label(ctx, v.status === "to_verify" ? "尝试核实于" : "核实于", v.status === "to_verify" ? "Last attempted" : "Checked")} ${h(v.last_verified)}</a>${src ? ` · <a href="${h(src.url)}" target="_blank" rel="noopener noreferrer">${label(ctx, "官方来源", "Issuer source")}${external}</a>` : ""}</p>`;
}
export function earnConditions(ctx: Context, v: EarnVersion) {
  const c = v.conditions;
  const parts: string[] = [];
  const channels = c.channels
    .filter((x) => x !== "any")
    .map((x) =>
      x === "direct" ? t(ctx, "直接购买", "Direct purchase") : t(ctx, "发卡机构门户", "Issuer portal"),
    );
  if (channels.length) parts.push(channels.join(t(ctx, "或", " or ")));
  if (c.region) parts.push(c.region === "US" ? t(ctx, "美国消费", "US purchases") : c.region);
  if (c.merchants) parts.push(c.merchants.join(", "));
  if (c.requires_activation) parts.push(t(ctx, "需要激活", "Activation required"));
  if (c.prepaid) parts.push(t(ctx, "预付", "Prepaid"));
  if (c.online_only) parts.push(t(ctx, "仅线上", "Online only"));
  if (c.requires_payment) parts.push(t(ctx, "完整奖励需还款", "Payment required for full rate"));
  if (c.minimum_transaction_amount)
    parts.push(`${t(ctx, "单笔至少", "Per purchase ≥")} ${dollars(c.minimum_transaction_amount)}`);
  if (c.selection?.type === "top_spend")
    parts.push(
      t(
        ctx,
        `每账单周期从以下类别选消费最高的 ${c.selection.count} 类：`,
        `Top ${c.selection.count} spend categories per billing cycle, from: `,
      ) + c.selection.categories.map((x) => category(ctx, "earn", x)).join(", "),
    );
  if (c.selection?.type === "rotating")
    parts.push(
      [...c.selection.categories.map((x) => category(ctx, "earn", x)), ...c.selection.merchants].join(" / "),
    );
  if (c.time_window) {
    const w = c.time_window;
    const days: Record<string, string> = {
      monday: "周一",
      tuesday: "周二",
      wednesday: "周三",
      thursday: "周四",
      friday: "周五",
      saturday: "周六",
      sunday: "周日",
    };
    parts.push(
      `${w.start_days.map((x) => (ctx.lang === "zh" ? days[x] : x)).join(" / ")} ${w.start}–${w.end} ${w.timezone}${w.end <= w.start ? t(ctx, "（结束于次日）", " (ends next day)") : ""}`,
    );
  }
  return parts.length ? parts.join(" · ") : t(ctx, "符合条款的消费", "Eligible purchases");
}
function capText(ctx: Context, card: Card, v: EarnVersion) {
  if (!v.cap) return t(ctx, "未记录结构化上限；请查看说明。", "No structured cap recorded; see notes.");
  const c = v.cap;
  const periods: Record<string, [string, string]> = {
    monthly: ["月", "month"],
    quarterly: ["季度", "quarter"],
    semiannual: ["半年", "half-year"],
    annual: ["年", "year"],
  };
  return `${t(ctx, "上限", "Cap")} ${dollars(c.amount)} / ${reset(ctx, c.reset_basis)} · ${periods[c.period]![ctx.lang === "zh" ? 0 : 1]}${c.shared_with ? t(ctx, "（共用）", " (shared)") : ""}; ${t(ctx, "超出后", "then")} ${rate(card, c.rate_after_cap)}${c.shared_with ? ` · ${t(ctx, "共享规则", "Shared with")}: ${c.shared_with.join(", ")}` : ""}`;
}
function creditConditions(ctx: Context, v: CreditVersion) {
  const c = v.conditions,
    parts = [];
  if (c?.minimum_spend) {
    const p = c.minimum_spend.period;
    parts.push(
      `${t(ctx, p === "transaction" ? "单笔消费至少" : p === "previous_calendar_year" ? "上一自然年消费至少" : "权益周期内消费至少", p === "transaction" ? "Minimum purchase" : p === "previous_calendar_year" ? "Prior calendar-year spend" : "Benefit-period spend")} ${dollars(c.minimum_spend.amount)}`,
    );
  }
  if (c?.minimum_nights)
    parts.push(t(ctx, `至少入住 ${c.minimum_nights} 晚`, `${c.minimum_nights}-night minimum`));
  if (c?.consecutive_months)
    parts.push(
      t(
        ctx,
        `连续 ${c.consecutive_months} 个自然月符合条件`,
        `${c.consecutive_months} consecutive qualifying calendar months`,
      ),
    );
  if (v.per_transaction_cap)
    parts.push(`${t(ctx, "单笔报销上限", "Per-transaction credit cap")} ${dollars(v.per_transaction_cap)}`);
  if (v.cap_excludes_tax)
    parts.push(
      t(ctx, "标示金额不含税；税费处理见说明", "Stated amount excludes tax; see notes for tax treatment"),
    );
  if (v.max_posting_lag_days !== null)
    parts.push(
      t(
        ctx,
        `最长入账等待 ${v.max_posting_lag_days} 天`,
        `Posting may take up to ${v.max_posting_lag_days} days`,
      ),
    );
  return parts.join(" · ");
}
function sectionHead(title: string, detail = "") {
  return `<h2>${h(title)}</h2>${detail ? `<p class="section-note">${h(detail)}</p>` : ""}`;
}
function feeBlock(ctx: Context, card: Card) {
  const v = termsAt(card, ctx.asOf).fees?.version;
  if (!v) return emptyTerms(ctx);
  return `<dl class="fee-grid">${[
    [t(ctx, "年费", "Annual fee"), dollars(v.annual_fee)],
    [t(ctx, "首年年费", "First-year annual fee"), dollars(v.first_year_annual_fee)],
    [
      t(
        ctx,
        card.audience === "business" ? "员工卡费" : "附属卡费",
        card.audience === "business" ? "Employee card fee" : "Additional card fee",
      ),
      dollars(v.authorized_user_fee),
    ],
    [
      t(ctx, "外币交易手续费", "Foreign transaction fee"),
      v.foreign_transaction_fee_percent === null ? "—" : `${v.foreign_transaction_fee_percent}%`,
    ],
  ]
    .map(
      ([k, val]) =>
        `<div><dt>${h(k)}</dt><dd>${val === "—" ? `<span class="muted">${label(ctx, "未确认", "Unconfirmed")}</span>` : h(val)}</dd></div>`,
    )
    .join("")}</dl><p class="term-note" lang="en">${h(v.notes)}</p>${provenance(ctx, card, v)}`;
}
function earnBlock(ctx: Context, card: Card) {
  const rules = termsAt(card, ctx.asOf).earn_rates;
  if (!rules.length) return emptyTerms(ctx);
  return `<div class="term-list">${rules.map((rule) => `<article class="term-item earn-item"><div class="term-value">${h(rate(card, rule.version.rate))}</div><div class="term-body"><h3>${h(category(ctx, "earn", rule.category))}</h3><p>${h(earnConditions(ctx, rule.version))}</p><p class="term-note" lang="en">${h(rule.version.notes)}</p><p class="cap-note">${h(capText(ctx, card, rule.version))}</p>${provenance(ctx, card, rule.version)}</div></article>`).join("")}</div>`;
}
function creditBlock(ctx: Context, card: Card) {
  const credits = termsAt(card, ctx.asOf).credits;
  if (!credits.length) return emptyTerms(ctx);
  const delivery: Record<string, [string, string]> = {
    statement_credit: ["账单报销", "Statement credit"],
    issuer_wallet: ["钱包额度", "Wallet allowance"],
    in_app: ["平台内抵扣", "In-app credit"],
  };
  const enrollment: Record<string, [string, string]> = {
    required: ["需登记", "Enrollment required"],
    activation: ["需激活", "Activation required"],
    none: ["无需登记", "No enrollment"],
    unknown: ["登记要求待核实", "Enrollment unconfirmed"],
  };
  const pick = (pair: [string, string]) => pair[ctx.lang === "zh" ? 0 : 1];
  return `<div class="term-list">${credits
    .map((c) => {
      const conditions = creditConditions(ctx, c.version);
      return `<article class="term-item credit-item"><div class="term-value">${dollars(c.version.amount)}<small>/ ${h(period(ctx, c.version))}</small></div><div class="term-body"><h3>${h(c.name)}</h3><p class="credit-meta">${h(category(ctx, "credit", c.category))} · ${h(pick(delivery[c.delivery]!))} · ${c.enrollment === "unknown" ? tag(pick(enrollment.unknown!), "warn") : h(pick(enrollment[c.enrollment]!))} · ${h(reset(ctx, c.version.reset_basis))}${c.version.period_boundaries === "inferred" ? ` · ${label(ctx, "周期边界为推定", "inferred boundaries")}` : ""}</p><p class="term-note" lang="en">${h(c.version.notes)}</p>${conditions ? `<p>${h(conditions)}</p>` : ""}${provenance(ctx, card, c.version)}</div></article>`;
    })
    .join("")}</div>`;
}
function sourceBlock(ctx: Context, card: Card) {
  return `<ol class="source-list">${card.sources.map((s) => `<li id="source-${h(s.id)}"><a href="${h(s.url)}" target="_blank" rel="noopener noreferrer">${h(s.title)}${external}</a> <span class="muted">${h(new URL(s.url).hostname)} · ${label(ctx, "访问于", "accessed")} <time>${h(s.accessed)}</time></span></li>`).join("")}</ol><p class="section-note">${label(ctx, "链接指向发卡机构的当前页面。修订历史保存的是当时记录的事实和说明，不是网页副本。", "Links open the issuer’s current page. Revisions preserve the facts and notes recorded at the time, not copies of the page.")}</p>`;
}
function historyBlock(ctx: Context) {
  const revisions = ctx.data.revisions.filter((r) => r.product_id === ctx.productId);
  const active = selectedRevision(ctx);
  const beforeId = ctx.params.get("from") ?? revisions.at(-2)?.id ?? revisions[0]?.id;
  const afterId = ctx.params.get("to") ?? revisions.at(-1)?.id;
  const before = revisions.find((r) => r.id === beforeId),
    after = revisions.find((r) => r.id === afterId);
  let difference = "";
  if (revisions.length > 1) {
    const changes = before && after ? revisionDiff(before, after).changes : null;
    difference = `<div class="diff-panel"><h3>${label(ctx, "比较两个修订", "Compare two revisions")}</h3><form id="diff-form" class="inline-form"><label class="field"><span>${label(ctx, "旧版本", "Earlier")}</span><select name="from">${revisions.map((r) => option(r.id, r.recorded_at, beforeId ?? "")).join("")}</select></label><label class="field"><span>${label(ctx, "新版本", "Later")}</span><select name="to">${revisions.map((r) => option(r.id, r.recorded_at, afterId ?? "")).join("")}</select></label><button class="button secondary" type="submit">${label(ctx, "比较", "Compare")}</button></form><div id="diff-results">${changes === null ? `<p class="notice error">${label(ctx, "版本不存在，请重新选择。", "Revision not found. Choose another version.")}</p>` : changes.length ? `<p class="diff-summary">${changes.length} ${label(ctx, "处内容变化", "content changes")}</p>${changes.map((change) => `<details class="diff-change" open><summary><code>${h(change.path)}</code></summary><div class="diff-values"><pre class="diff-before" aria-label="${label(ctx, "旧内容", "Before")}">${h(JSON.stringify(change.before, null, 2))}</pre><pre class="diff-after" aria-label="${label(ctx, "新内容", "After")}">${h(JSON.stringify(change.after, null, 2))}</pre></div></details>`).join("")}` : `<p class="muted">${label(ctx, "这两个版本内容一致。", "These revisions have identical content.")}</p>`}</div></div>`;
  }
  return `<p class="section-note">${label(ctx, "收录时间不等于条款生效时间。点开一个修订，可以看到当时保存的完整内容。时间均为 UTC。", "Recorded time is not the effective date. Open a revision to see the complete content recorded at that time. All times are UTC.")}</p><ol class="revision-list">${[
    ...revisions,
  ]
    .reverse()
    .map(
      (r) =>
        `<li${active?.id === r.id ? ' class="active"' : ""}><a href="${h(href(ctx, `cards/${ctx.productId}/`, { revision: r.id }))}" data-revision="${h(r.id)}"><time>${h(r.recorded_at.replace("T", " ").replace("Z", " UTC"))}</time></a>${active?.id === r.id ? ` ${tag(t(ctx, "正在查看", "Viewing"))}` : ""}<p lang="en">${h(r.reason)}</p><details class="revision-meta"><summary>${label(ctx, "修订标识与校验值", "Revision ID and checksum")}</summary><code>${h(r.id)}</code><br><code>${h(r.content_sha256)}</code></details></li>`,
    )
    .join(
      "",
    )}</ol>${difference}<p><a href="${h(ctx.data.base)}data/history/${h(ctx.productId)}.json" download>${label(ctx, "下载这张卡的完整历史（JSON）", "Download this card’s full history (JSON)")}</a></p>`;
}
export function cardPage(ctx: Context) {
  const current = ctx.data.cards.find((c) => c.id === ctx.productId);
  if (!current) return notFound(ctx);
  const revisions = ctx.data.revisions.filter((r) => r.product_id === ctx.productId),
    revision = selectedRevision(ctx),
    card = revision?.product ?? current;
  const archived = !!revision && revision.id !== revisions.at(-1)?.id;
  const revisionSelection =
    ctx.params.get("revision") ?? (ctx.params.has("recorded_at") ? revision?.id : "") ?? "";
  const unit = label(
    ctx,
    card.rewards.unit === "cash" ? "返现" : card.rewards.unit === "miles" ? "里程" : "积分",
    card.rewards.unit,
  );
  const fee = termsAt(card, ctx.asOf).fees?.version.annual_fee;
  return `<p class="breadcrumb"><a href="${h(href(ctx))}">${label(ctx, "卡片目录", "Catalog")}</a> / ${h(current.issuer)}</p><header class="page-head card-head"><h1>${h(card.name)}</h1><p>${h(card.issuer)} · ${audience(ctx, card)} · ${h(card.rewards.program)}${label(ctx, "（", " (")}${unit}${label(ctx, "）", ")")} ${tag(t(ctx, "草稿", "Draft"), "warn")} · <a href="${h(reportLink(ctx, card))}" target="_blank" rel="noopener noreferrer">${label(ctx, "报告变化", "Report a change")}${external}</a></p></header>
  <section class="time-panel" aria-label="${label(ctx, "历史查询", "Historical lookup")}"><form id="time-form" class="inline-form">${dateField(ctx)}<label class="field revision-field"><span>${label(ctx, "收录版本（UTC）", "Recorded revision (UTC)")}</span><select name="revision">${option("", t(ctx, "最新", "Latest"), revisionSelection)}${revisions.map((r) => option(r.id, r.recorded_at.replace("T", " ").replace("Z", ""), revisionSelection)).join("")}</select></label><button type="submit" class="button secondary">${label(ctx, "查看", "View")}</button></form><p class="field-help">${label(ctx, "条款日期决定显示哪个时间点适用的条款；收录版本决定显示目录在哪次修订时记录的内容。", "The terms date picks which terms applied; the recorded revision picks what the catalog said at the time.")}</p></section>
  ${ctx.params.has("recorded_at") ? `<p class="notice">${label(ctx, "收录时间截止", "Recorded by")} ${h(ctx.params.get("recorded_at"))}</p>` : ""}
  ${archived ? `<p class="notice archive-notice"><strong>${label(ctx, "正在查看存档。", "Viewing an archived revision.")}</strong> ${label(ctx, "收录于", "Recorded")} ${h(revision!.recorded_at)}${label(ctx, "。", ".")} <a href="${h(href(ctx, `cards/${ctx.productId}/`, { revision: undefined, recorded_at: undefined }))}" data-latest>${label(ctx, "回到最新记录", "Return to latest")}</a></p>` : ""}
  ${
    !revision
      ? `<section class="empty-state"><h2>${label(ctx, "此时间点尚无记录", "No record at this time")}</h2><p>${label(ctx, "第一条快照之前的内容无法还原，或者指定的版本不存在。", "The requested revision is missing or predates the first snapshot.")}</p><a class="button secondary" href="${h(href(ctx, `cards/${ctx.productId}/`))}">${label(ctx, "查看最新记录", "View latest record")}</a></section>`
      : `
  <div class="card-layout"><aside class="infobox"><dl><dt>${label(ctx, "年费", "Annual fee")}</dt><dd>${fee == null ? label(ctx, "未确认", "Unconfirmed") : dollars(fee)}</dd><dt>${label(ctx, "卡组织", "Network")}</dt><dd>${h(card.network?.toUpperCase() ?? t(ctx, "未确认", "Unconfirmed"))}</dd><dt>${label(ctx, "奖励", "Rewards")}</dt><dd>${unit}</dd><dt>${label(ctx, "申请状态", "Availability")}</dt><dd>${label(ctx, card.availability === "open" ? "开放申请" : card.availability === "closed_to_new" ? "停止新申请" : "已停用", card.availability === "open" ? "Open" : card.availability === "closed_to_new" ? "Closed to new applicants" : "Discontinued")}</dd><dt>${label(ctx, "条款日期", "Terms date")}</dt><dd>${h(ctx.asOf)}</dd><dt>${label(ctx, "收录时间", "Recorded")}</dt><dd>${h(revision.recorded_at.replace("T", " ").replace("Z", " UTC"))}</dd></dl><p>${label(ctx, "金额已核实，不代表适用条件已完整收录。", "A verified amount does not mean every eligibility condition is recorded.")}</p><details><summary>${label(ctx, "收录范围与备注", "Coverage and notes")}</summary><p lang="en">${h(card.coverage?.notes ?? "")}</p><p lang="en">${h(card.notes)}</p></details></aside>
  <div class="card-sections"><nav class="section-nav" aria-label="${label(ctx, "本页目录", "On this page")}">${[
    ["fees", "费用", "Fees"],
    ["earn", "返现与积分", "Earn rates"],
    ["credits", "报销", "Credits"],
    ["sources", "来源", "Sources"],
    ["history", "修订历史", "History"],
  ]
    .map(([id, zh, en]) => `<a href="#${id}">${label(ctx, zh!, en!)}</a>`)
    .join(
      "",
    )}</nav><section id="fees">${sectionHead(t(ctx, "费用", "Fees"), t(ctx, "未确认的费用留空，不当作免费。", "Unconfirmed fees are left blank, not treated as free."))}${feeBlock(ctx, card)}</section><section id="earn">${sectionHead(t(ctx, "返现与积分", "Earn rates"), t(ctx, "倍率不会自动叠加，渠道、商户和上限都会影响是否适用。", "Rates do not stack automatically; channels, merchants and caps apply."))}${earnBlock(ctx, card)}</section><section id="credits">${sectionHead(t(ctx, "报销", "Credits"), t(ctx, "金额按单个周期列出，不折算全年价值。", "Amounts are per period; no yearly value is estimated."))}${creditBlock(ctx, card)}</section><section id="sources">${sectionHead(t(ctx, "来源", "Issuer sources"))}${sourceBlock(ctx, card)}</section><section id="history">${sectionHead(t(ctx, "修订历史", "Revision history"))}${historyBlock(ctx)}</section></div></div>`
  }`;
}
export function comparePage(ctx: Context) {
  const cards = ctx.selected.map((id) => ctx.data.cards.find((c) => c.id === id)!);
  let table = "";
  if (cards.length) {
    const terms = cards.map((c) => termsAt(c, ctx.asOf));
    const earnCategories = ctx.data.earnCategories.filter((cat) =>
      terms.some((x) => x.earn_rates.some((r) => r.category === cat.id)),
    );
    const creditCategories = ctx.data.creditCategories.filter((cat) =>
      terms.some((x) => x.credits.some((c) => c.category === cat.id)),
    );
    const notRecorded = `<span class="muted">—</span>`;
    table = `<div class="comparison-scroll" tabindex="0" role="region" aria-label="${label(ctx, "卡片对比表，可横向滚动", "Card comparison table, scroll horizontally")}"><table class="comparison-table"><caption class="sr-only">${label(ctx, "年费、返现规则与报销权益对比", "Fees, earn rates and credits comparison")}</caption><thead><tr><th scope="col">${label(ctx, "条款日期", "Terms on")} <span class="mono">${h(ctx.asOf)}</span></th>${cards.map((c) => `<th scope="col"><a href="${h(href(ctx, `cards/${c.id}/`))}">${h(c.name)}</a><span class="muted">${h(c.issuer)}</span><button type="button" class="link-button" data-remove="${h(c.id)}">${label(ctx, "移除", "Remove")}</button></th>`).join("")}</tr></thead><tbody><tr><th scope="row">${label(ctx, "年费", "Annual fee")}</th>${terms.map((x) => `<td><strong>${dollars(x.fees?.version.annual_fee)}</strong>${x.fees ? ` ${certainty(ctx, x.fees.version)}` : ""}</td>`).join("")}</tr><tr><th scope="row">${label(ctx, "奖励单位", "Reward unit")}</th>${cards.map((c) => `<td>${label(ctx, c.rewards.unit === "cash" ? "返现（%）" : c.rewards.unit === "miles" ? "里程（每美元）" : "积分（每美元）", c.rewards.unit === "cash" ? "Cash (%)" : c.rewards.unit === "miles" ? "Miles / dollar" : "Points / dollar")}<br><small class="muted">${h(c.rewards.program)}</small></td>`).join("")}</tr>
    <tr class="table-section"><th colspan="${cards.length + 1}">${label(ctx, "返现与积分", "Earn rates")}</th></tr>${earnCategories
      .map(
        (cat) =>
          `<tr><th scope="row">${h(cat.name[ctx.lang])}</th>${terms
            .map(
              (x, i) =>
                `<td>${
                  x.earn_rates
                    .filter((r) => r.category === cat.id)
                    .map(
                      (r) =>
                        `<div class="comparison-term"><strong>${h(rate(cards[i]!, r.version.rate))}</strong> ${certainty(ctx, r.version)}<p>${h(earnConditions(ctx, r.version))}</p><p class="muted">${h(capText(ctx, cards[i]!, r.version))}</p><p class="term-note" lang="en">${h(r.version.notes)}</p></div>`,
                    )
                    .join("") || notRecorded
                }</td>`,
            )
            .join("")}</tr>`,
      )
      .join("")}
    <tr class="table-section"><th colspan="${cards.length + 1}">${label(ctx, "报销", "Credits")}</th></tr>${creditCategories
      .map(
        (cat) =>
          `<tr><th scope="row">${h(cat.name[ctx.lang])}</th>${terms
            .map(
              (x, i) =>
                `<td>${
                  x.credits
                    .filter((c) => c.category === cat.id)
                    .map(
                      (c) =>
                        `<div class="comparison-term"><strong>${dollars(c.version.amount)}</strong> <span class="muted">/ ${h(period(ctx, c.version))}</span> ${certainty(ctx, c.version)}<p>${h(c.name)}</p><p class="muted">${h(reset(ctx, c.version.reset_basis))} · ${label(ctx, c.delivery === "statement_credit" ? "账单报销" : c.delivery === "issuer_wallet" ? "钱包额度" : "平台内抵扣", c.delivery === "statement_credit" ? "Statement credit" : c.delivery === "issuer_wallet" ? "Wallet allowance" : "In-app credit")}</p><p class="term-note" lang="en">${h(c.version.notes)}</p>${creditConditions(ctx, c.version) ? `<p>${h(creditConditions(ctx, c.version))}</p>` : ""}<a href="${h(href(ctx, `cards/${cards[i]!.id}/`))}#credits">${label(ctx, "登记要求与来源", "Enrollment and sources")}</a></div>`,
                    )
                    .join("") || notRecorded
                }</td>`,
            )
            .join("")}</tr>`,
      )
      .join(
        "",
      )}</tbody></table></div><p class="footnote">${label(ctx, "“—”表示没有收录，不代表这张卡一定没有该权益。未注明日期的条款，起始生效日未知。", "“—” means nothing is recorded, not that the card lacks the benefit. Terms without a date have an unknown start date.")}</p>`;
  } else
    table = `<div class="empty-state"><p><strong>${label(ctx, "还没有选择卡片。", "No cards selected yet.")}</strong> ${label(ctx, "在卡片目录里勾选最多 4 张卡，再回到这里对比。", "Tick up to four cards in the catalog, then come back here.")}</p><a class="button" href="${h(href(ctx))}">${label(ctx, "前往卡片目录", "Go to the catalog")}</a></div>`;
  return `${pageHead(
    t(ctx, "对比卡片", "Compare cards"),
    t(
      ctx,
      "最多 4 张卡并排对照费用、返现和报销条件。这里不排名，也不把积分或里程换算成现金。",
      "Up to four cards side by side: fees, earn rates and credits. No rankings, and points or miles are not converted to cash.",
    ),
  )}<div class="toolbar"><form id="compare-date" class="inline-form">${dateField(ctx)}<button class="button secondary" type="submit">${label(ctx, "更新日期", "Update date")}</button></form><a href="${h(href(ctx))}">${label(ctx, "添加或更换卡片", "Add or change cards")}</a></div>${table}`;
}
export function reviewPage(ctx: Context) {
  const all = reviewItems(ctx.data.cards, ctx.reviewOn),
    p = ctx.params;
  const items = all.filter(
    (x) =>
      (!p.get("issuer") || x.card.issuer === p.get("issuer")) &&
      (!p.get("q") || `${x.card.name} ${x.name}`.toLowerCase().includes(p.get("q")!.toLowerCase())) &&
      (!p.get("status") || (p.get("status") === "pending" ? x.pending : x.stale)),
  );
  return `${pageHead(
    t(ctx, "待复核条款", "Review queue"),
    t(
      ctx,
      "尚待核实的条款版本，以及超过 90 天没有重新核实的记录。如果你有发卡机构的新证据，欢迎提交。",
      "Terms versions awaiting verification, and records not re-checked in over 90 days. Issuer evidence is welcome.",
    ),
    `<p class="page-meta">${all.filter((x) => x.pending).length} ${label(ctx, "个待核实", "pending")} · ${all.filter((x) => x.stale).length} ${label(ctx, "个超过 90 天", "over 90 days old")} · ${label(ctx, "包括已结束和已公布的未来版本。待核实不代表权益不存在。", "Includes ended and announced future versions. Pending does not mean a benefit is absent.")}</p>`,
  )}<form class="inline-form review-filters" id="review-filters">${search(ctx)}${select(ctx, "issuer", t(ctx, "发卡机构", "Issuer"), issuerOptions(ctx))}${select(
    ctx,
    "status",
    t(ctx, "复核原因", "Reason"),
    [
      ["pending", t(ctx, "待核实", "Pending")],
      ["stale", t(ctx, "超过 90 天", "Over 90 days")],
    ],
  )}${dateField(ctx, "review_on")}<button class="button secondary" type="submit">${label(ctx, "筛选", "Filter")}</button></form><p class="results-count" role="status">${items.length} ${label(ctx, "个条款版本", "terms versions")}</p><div class="review-list">${items.length ? items.map((x) => `<article class="review-item"><div><h2><a href="${h(href(ctx, `cards/${x.card.id}/`, { asof: x.version.effective_from ?? x.version.effective_to ?? ctx.asOf }))}#${x.section}">${h(x.card.name)}</a> <span class="muted">· ${h(x.card.issuer)} · ${label(ctx, x.section === "fees" ? "费用" : x.section === "earn" ? "返现与积分" : "报销", x.section === "fees" ? "Fees" : x.section === "earn" ? "Earn rates" : "Credits")}</span></h2><h3>${h(x.section === "earn" ? category(ctx, "earn", x.name) : x.name)}</h3><p class="term-note" lang="en">${h(x.version.notes)}</p><p class="provenance">${label(ctx, "生效", "Effective")} ${h(interval(ctx, x.version))}</p></div><div class="review-meta">${x.pending ? tag(t(ctx, "待核实", "Pending"), "warn") : ""}${x.stale ? tag(t(ctx, `${x.age} 天未复核`, `${x.age} days since check`), "warn") : ""}<span class="muted">${label(ctx, x.pending ? "最近尝试" : "最近核实", x.pending ? "Last attempted" : "Last checked")} ${h(x.version.last_verified)}</span><a href="${h(reportLink(ctx, x.card))}" target="_blank" rel="noopener noreferrer">${label(ctx, "补充证据", "Contribute evidence")}${external}</a></div></article>`).join("") : `<div class="empty-state"><p>${label(ctx, "没有符合条件的待复核记录。可以调整筛选条件或参考日期。", "No matching review items. Adjust the filters or review date.")}</p></div>`}</div>`;
}
export function aboutPage(ctx: Context) {
  return `${pageHead(
    t(ctx, "关于数据", "About the data"),
    t(
      ctx,
      "CardFacts 是一个独立、开放的美国信用卡资料目录。数据可以自由使用，每次修改都有记录。",
      "CardFacts is an independent, open index of US credit cards. The data is free to use, and every edit is recorded.",
    ),
  )}<div class="prose">${[
    [
      t(ctx, "只引用发卡机构", "Issuer sources only"),
      t(
        ctx,
        "金额和条款引用发卡机构的公开页面。每个版本都标有来源和核实日期；未知的值留空，不当作 0 或无上限。",
        "Amounts and terms cite public issuer pages. Each version carries a source and verification date. Missing values mean unknown, not zero or unlimited.",
      ),
    ],
    [
      t(ctx, "两条时间线", "Two timelines"),
      t(
        ctx,
        "条款日期描述规则何时适用；收录版本保存目录当时写了什么。起始日未知的记录，不能证明过去某天已经有这项权益。",
        "The terms date describes when a rule applies. A recorded revision preserves what the catalog said at that time. An unknown start cannot prove that a benefit existed on a historical date.",
      ),
    ],
    [
      t(ctx, "条件比数字重要", "Conditions matter"),
      t(
        ctx,
        "消费上限、登记、渠道、商户和周期决定是否适用。目录不做收益排名，不把积分换算成现金，也不把全年报销金额简单相加。原始英文说明在两种语言界面中都保持原样。",
        "Caps, enrollment, channels, merchants and reset periods determine eligibility. We do not rank returns, convert points to cash or add credits into a yearly value. Original English notes stay unchanged in both interface languages.",
      ),
    ],
    [
      t(ctx, "公开维护", "Maintained in public"),
      t(
        ctx,
        "每一页都可以报告变化。请附上发卡机构的来源链接，修改会通过公开的 PR 审阅。数据目前仍是草稿，部分条款和商户限制还在复核。",
        "Every page links to a change report. Include an issuer source; edits are reviewed in public pull requests. The catalog is still a draft, and some terms and merchant restrictions await review.",
      ),
    ],
  ]
    .map(([title, body]) => `<h2>${h(title)}</h2><p>${h(body)}</p>`)
    .join(
      "",
    )}<h2>${label(ctx, "下载数据", "Download the data")}</h2><p>${label(ctx, "数据采用 CC0，代码采用 MIT。应用应固定使用某个经过审核的数据版本。当前版本：", "Data is CC0; code is MIT. Applications should pin an audited data version. Current version: ")}<span class="mono">${h(ctx.data.version)}</span></p><ul><li><a href="${h(ctx.data.base)}data/cards.json" download>cards.json</a> — ${label(ctx, "当前目录", "current catalog")}</li><li><a href="${h(ctx.data.base)}data/history.json" download>history.json</a> — ${label(ctx, "全部修订历史", "all revisions")}</li><li><a href="${h(ctx.data.base)}data/SHA256SUMS" download>SHA256SUMS</a> — ${label(ctx, "校验值", "checksums")}</li></ul></div>`;
}
export function notFound(ctx: Context) {
  return `${pageHead(t(ctx, "页面不存在", "Page not found"), t(ctx, "链接可能有误。", "The link may be incorrect."))}<p><a href="${h(href(ctx))}">${label(ctx, "返回卡片目录", "Back to the catalog")}</a></p>`;
}
export function renderPage(ctx: Context) {
  const render: Record<Page, (c: Context) => string> = {
    catalog: catalogPage,
    card: cardPage,
    compare: comparePage,
    review: reviewPage,
    about: aboutPage,
    "404": notFound,
  };
  return `${ctx.error ? `<p class="notice error" role="alert">${h(ctx.error)} <a href="${h(href({ ...ctx, params: new URLSearchParams(), selected: [] } as Context, pagePath(ctx)))}">${label(ctx, "重置查询", "Reset query")}</a></p>` : ""}${ctx.error ? "" : render[ctx.page](ctx)}`;
}
export function title(ctx: Context) {
  return `${ctx.page === "card" ? (ctx.data.cards.find((c) => c.id === ctx.productId)?.name ?? "Card") : t(ctx, { catalog: "美国信用卡资料库", compare: "对比卡片", review: "待复核条款", about: "关于数据", "404": "页面不存在" }[ctx.page], { catalog: "US credit card index", compare: "Compare cards", review: "Review queue", about: "About the data", "404": "Page not found" }[ctx.page])} · CardFacts`;
}
