import type { Card, CreditVersion, EarnVersion, Version } from "../scripts/lib/types.js";
import { revisionDiff, termsAt } from "../scripts/lib/temporal.js";
import {
  category,
  dollars,
  filterCards,
  h,
  href,
  issuerClass,
  rate,
  reportLink,
  reviewItems,
  selectedRevision,
  t,
} from "./model.js";
import type { Context, Page } from "./model.js";

const arrow = '<span aria-hidden="true">↗</span>';
const chevron = '<span aria-hidden="true">→</span>';
const mark =
  '<svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><rect x="3" y="7" width="19" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 4h16a2 2 0 0 1 2 2v11M7 12h6m-6 4h10" stroke="currentColor" stroke-width="1.5"/></svg>';
const badge = (text: string, type = "neutral") => `<span class="badge ${type}">${h(text)}</span>`;
const label = (ctx: Context, zh: string, en: string) => h(t(ctx, zh, en));
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
  <header class="site-header"><div class="header-inner"><a class="brand" href="${h(href(ctx))}" aria-label="CardFacts">${mark}<span>CardFacts<span class="brand-dot">.</span></span></a>
  <nav aria-label="${label(ctx, "主导航", "Main navigation")}">${(
    [
      ["catalog", "卡片目录", "Catalog", ""],
      ["compare", "横向对比", "Compare", "compare/"],
      ["review", "待复核", "Review queue", "review/"],
    ] as const
  )
    .map(
      ([page, zh, en, path]) =>
        `<a href="${h(href(ctx, path))}" ${ctx.page === page ? 'aria-current="page"' : ""}>${label(ctx, zh, en)}${page === "compare" && ctx.selected.length ? `<span class="nav-count">${ctx.selected.length}</span>` : ""}</a>`,
    )
    .join("")}</nav>
  <div class="header-tools"><a class="language" href="${h(langUrl(ctx))}" lang="${ctx.lang === "zh" ? "en" : "zh-CN"}" aria-label="${ctx.lang === "zh" ? "Switch to English" : "切换为中文"}">${ctx.lang === "zh" ? "<b>中</b><span>/</span>EN" : "中<span>/</span><b>EN</b>"}</a><a class="repo-link" href="${h(ctx.data.repository)}" target="_blank" rel="noopener noreferrer">GitHub ${arrow}</a></div></div></header>`;
}
export function footer(ctx: Context) {
  return `<footer class="site-footer"><div><a class="brand small" href="${h(href(ctx))}">${mark}<span>CardFacts.</span></a><p>${label(ctx, "开放的事实，可追溯的变化。", "Open facts. A traceable history.")}</p></div><div class="footer-links"><a href="${h(href(ctx, "about/"))}">${label(ctx, "关于数据", "About the data")}</a><a href="${h(ctx.data.base)}data/cards.json" download>${label(ctx, "下载目录", "Download catalog")} ${arrow}</a><a href="${h(reportLink(ctx))}" target="_blank" rel="noopener noreferrer">${label(ctx, "报告变化", "Report a change")} ${arrow}</a><span>CC0 · ${label(ctx, "数据开放共享", "Open data")}</span></div><p class="footer-note">${label(ctx, "资料仍为草稿；请以发卡机构条款为准。CardFacts 与发卡机构无关联。", "Draft data; confirm terms with the issuer. CardFacts is not affiliated with card issuers.")}<br><span class="mono">${h(ctx.data.version)}</span></p></footer>`;
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
  return `<label class="search-field"><span class="sr-only">${label(ctx, "搜索卡片", "Search cards")}</span><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="m13 13 4 4" stroke="currentColor" stroke-width="1.5"/></svg><input type="search" name="q" value="${h(ctx.params.get("q") ?? "")}" placeholder="${label(ctx, "搜索卡名、发卡机构…", "Search cards or issuers…")}" autocomplete="off"></label>`;
}
export function cardArt(card: Card, large = false) {
  return `<div class="card-art ${issuerClass(card)}${large ? " large" : ""}" aria-hidden="true"><span class="art-issuer">${h(card.issuer === "American Express" ? "AMERICAN EXPRESS" : card.issuer.toUpperCase())}</span><span class="art-chip"><i></i><i></i><i></i></span><span class="art-name">${h(card.name.replace(/American Express |Chase |Wells Fargo |U.S. Bank /g, ""))}</span><span class="art-network">${h(card.network?.toUpperCase() ?? "CARDFacts")}</span></div>`;
}
function dateField(ctx: Context, name = "asof") {
  return `<label class="field date-field"><span>${label(ctx, name === "asof" ? "条款日期" : "复核参考日", name === "asof" ? "Terms on" : "Review as of")}</span><input type="date" name="${name}" value="${h(name === "asof" ? ctx.asOf : ctx.reviewOn)}" required min="0001-01-01" max="9999-12-31"></label>`;
}
function intro(ctx: Context, number: string, eyebrow: string, title: string, description: string, side = "") {
  return `<section class="page-intro"><div class="intro-copy"><p class="eyebrow"><span class="section-number">${number}</span>${h(eyebrow)}</p><h1>${title}</h1><p class="intro-description">${h(description)}</p></div>${side}</section>`;
}
export function catalogPage(ctx: Context) {
  const stats = `<div class="catalog-stamp"><span class="stamp-label">THE OPEN CARD INDEX</span><div class="stamp-number">${ctx.data.cards.length}<span>${label(ctx, "张卡", "cards")}</span></div><div class="stamp-bottom"><span>${new Set(ctx.data.cards.map((c) => c.issuer)).size} ${label(ctx, "家机构", "issuers")}</span><span>US · USD</span></div></div>`;
  return `${intro(ctx, "01", t(ctx, "独立 · 开放 · 可追溯", "INDEPENDENT · OPEN · TRACEABLE"), t(ctx, "每项权益，<br><em>有据可查。</em>", "Every benefit.<br><em>Backed by a source.</em>"), t(ctx, "查阅美国信用卡的年费、返现与报销。每个数字都有出处，每次修改都留有记录。", "Explore US card fees, rewards and credits. Every figure has a source; every edit has a history."), stats)}
  <div class="catalog-layout"><aside class="filter-panel"><form id="catalog-filters" action="${h(href(ctx))}" method="get"><div class="filter-title"><h2>${label(ctx, "筛选目录", "Refine the index")}</h2><button type="button" class="text-button" data-reset>${label(ctx, "重置", "Reset")}</button></div>${search(ctx)}<button type="button" class="mobile-filter-toggle text-button" data-filters aria-expanded="false">${label(ctx, "展开筛选条件 +", "Show filters +")}</button>
  ${select(ctx, "audience", t(ctx, "卡片类型", "Card type"), [
    ["personal", t(ctx, "个人卡", "Personal")],
    ["business", t(ctx, "商业卡", "Business")],
  ])}
  ${select(ctx, "issuer", t(ctx, "发卡机构", "Issuer"), issuerOptions(ctx))}
  ${select(ctx, "fee", t(ctx, "年费范围 · USD", "Annual fee · USD"), [
    ["free", t(ctx, "无年费 · $0", "No annual fee · $0")],
    ["low", "$1–99"],
    ["mid", "$100–399"],
    ["high", "$400+"],
    ["unknown", t(ctx, "尚未确认", "Unconfirmed")],
  ])}
  <div class="filter-divider"></div>${select(
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
  ])}<label class="field"><span>${label(ctx, "最低数值", "Minimum rate")}</span><input type="number" min="0" step="0.5" name="min_rate" value="${h(ctx.params.get("min_rate") ?? "")}" placeholder="0"></label></div>
  <p class="field-help">${label(ctx, "积分、里程与返现不做价值换算。筛选只采用已核实数值，仍须满足适用条件。", "Points, miles and cash are not converted. Filters use verified values; eligibility conditions still apply.")}</p>
  ${dateField(ctx)}<button class="button filter-submit" type="submit">${label(ctx, "应用筛选", "Apply filters")} ${chevron}</button></form>
  <a class="sidebar-note" href="${h(href(ctx, "about/"))}"><span class="small-cross">+</span><strong>${label(ctx, "先看条件，再看数字", "Context before numbers")}</strong><span>${label(ctx, "了解来源、核实状态与历史日期。", "Understand sources, verification and historical dates.")}</span>${arrow}</a></aside>
  <section class="catalog-results" aria-label="${label(ctx, "卡片列表", "Card list")}"><div class="results-toolbar"><p id="result-count" role="status" aria-live="polite">${resultCount(ctx)}</p><label class="sort-control">${label(ctx, "排序", "Sort")}<select name="sort" form="catalog-filters">${option("", t(ctx, "机构 / 卡名", "Issuer / name"), ctx.params.get("sort") ?? "")}${option("fee", t(ctx, "年费从低到高", "Annual fee: low to high"), ctx.params.get("sort") ?? "")}</select></label></div>
  <div class="catalog-column-head"><span>${label(ctx, "卡片 / 发卡机构", "CARD / ISSUER")}</span><span>${label(ctx, "年费", "ANNUAL FEE")}</span><span>${label(ctx, "已收录权益", "RECORDED BENEFITS")}</span><span>${label(ctx, "对比", "COMPARE")}</span></div><div id="card-results">${catalogResults(ctx)}</div><p class="results-footnote">${label(ctx, "年费与规则按所选日期筛选。未知起始日期不构成历史适用证明。", "Fees and rules follow the selected date. An unknown start is not evidence of historical eligibility.")}</p></section></div><div id="compare-tray">${compareTray(ctx)}</div>`;
}
export function resultCount(ctx: Context) {
  return `${label(ctx, "显示", "Showing")} <strong>${filterCards(ctx).length}</strong> / ${ctx.data.cards.length} ${label(ctx, "张卡", "cards")}`;
}
export function catalogResults(ctx: Context) {
  const cards = filterCards(ctx);
  if (!cards.length)
    return `<div class="empty-state"><span class="empty-symbol">∅</span><h2>${label(ctx, "没有符合条件的卡片", "No matching cards")}</h2><p>${label(ctx, "试试减少筛选条件，或更换条款日期。", "Try fewer filters or a different terms date.")}</p><button class="button secondary" type="button" data-reset>${label(ctx, "清除筛选", "Clear filters")}</button></div>`;
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
      return `<article class="catalog-row" data-card="${h(card.id)}"><div class="product-cell">${cardArt(card)}<div class="product-copy"><p class="product-overline">${h(card.issuer)}<span> / ${label(ctx, card.audience === "personal" ? "个人卡" : "商业卡", card.audience === "personal" ? "Personal" : "Business")}</span></p><h2><a href="${h(href(ctx, `cards/${card.id}/`))}">${h(card.name)}</a></h2><div class="row-badges">${pending ? badge(t(ctx, "部分待核实", "Some terms pending"), "amber") : ""}${card.availability !== "open" ? badge(t(ctx, "已停止申请", "Closed to applications")) : ""}<span class="source-count">${card.sources.length} ${label(ctx, "项来源", "sources")}</span></div></div></div>
    <div class="fee-cell"><span class="mobile-label">${label(ctx, "年费", "Annual fee")}</span><strong>${dollars(terms.fees?.version.annual_fee)}</strong><small>${label(ctx, terms.fees?.version.annual_fee == null ? "待确认" : "每年 · USD", terms.fees?.version.annual_fee == null ? "Unconfirmed" : "per year · USD")}</small></div>
    <div class="benefit-cell">${previews.map((r) => `<span>${h(category(ctx, "earn", r.category))} <b>${h(rate(card, r.version.rate))}</b></span>`).join("")}${!previews.length ? `<span>${label(ctx, "基础奖励", "Base rewards")} <b>${h(rate(card, terms.earn_rates.find((r) => r.category === "everything_else")?.version.rate ?? null))}</b></span>` : ""}<small>${terms.credits.length ? `${terms.credits.length} ${label(ctx, "项报销 / 额度", "credits / allowances")}` : label(ctx, "未收录周期报销", "No recurring credit recorded")}</small></div>
    <label class="compare-toggle"><input type="checkbox" data-compare="${h(card.id)}"${ctx.selected.includes(card.id) ? " checked" : ""} ${ctx.selected.length >= 4 && !ctx.selected.includes(card.id) ? "disabled" : ""}><span class="sr-only">${label(ctx, "对比", "Compare")} ${h(card.name)}</span></label></article>`;
    })
    .join("");
}
export function compareTray(ctx: Context) {
  return ctx.selected.length
    ? `<aside class="compare-tray"><div><span class="tray-count">${ctx.selected.length}<small>/ 4</small></span><div><strong>${label(ctx, "已选择对比", "Selected for comparison")}</strong><p>${h(ctx.selected.map((id) => ctx.data.cards.find((c) => c.id === id)!.name).join(" · "))}</p></div></div><div class="tray-actions"><button type="button" data-clear-compare class="text-button">${label(ctx, "清空", "Clear")}</button><a class="button" href="${h(href(ctx, "compare/"))}">${label(ctx, "查看对比", "Compare cards")} ${chevron}</a></div></aside>`
    : "";
}
function emptyTerms(ctx: Context) {
  return `<p class="empty-inline">${label(ctx, "此日期没有已收录的适用版本，不代表权益不存在。", "No recorded version applies on this date. This does not establish that the benefit did not exist.")}</p>`;
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
function certainty(ctx: Context, v: Version) {
  return v.status === "to_verify"
    ? badge(t(ctx, "待核实", "Pending verification"), "amber")
    : v.effective_from === null
      ? badge(t(ctx, "起始日未知", "Start date unknown"))
      : v.effective_from_basis === "detected"
        ? badge(t(ctx, "按发现日记录", "Observed start"))
        : badge(t(ctx, "生效日已明确", "Stated effective date"), "green");
}
function interval(ctx: Context, v: Version) {
  return `${v.effective_from ?? t(ctx, "起始日未知", "Unknown start")} → ${v.effective_to ?? t(ctx, "未记录终止日", "No recorded end")}`;
}
function provenance(ctx: Context, card: Card, v: Version) {
  const src = card.sources.find((s) => s.id === v.source);
  return `<div class="provenance">${certainty(ctx, v)}<span>${h(interval(ctx, v))}</span><a href="#source-${h(v.source)}">${label(ctx, v.status === "to_verify" ? "尝试核实于" : "核实于", v.status === "to_verify" ? "Last attempted" : "Checked")} ${h(v.last_verified)} ${arrow}</a>${src ? `<a class="issuer-source" href="${h(src.url)}" target="_blank" rel="noopener noreferrer">${label(ctx, "官方来源", "Issuer source")} ${arrow}</a>` : ""}</div>`;
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
  return `${dollars(c.amount)} / ${reset(ctx, c.reset_basis)} · ${periods[c.period]![ctx.lang === "zh" ? 0 : 1]}${c.shared_with ? t(ctx, "（共用）", " (shared)") : ""}; ${t(ctx, "超出后", "then")} ${rate(card, c.rate_after_cap)}${c.shared_with ? ` · ${t(ctx, "共享规则", "Shared with")}: ${c.shared_with.join(", ")}` : ""}`;
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
function sectionHead(ctx: Context, n: string, title: string, detail = "") {
  return `<div class="section-heading"><h2><span>${n}</span>${h(title)}</h2>${detail ? `<p>${h(detail)}</p>` : ""}</div>`;
}
function feeBlock(ctx: Context, card: Card) {
  const v = termsAt(card, ctx.asOf).fees?.version;
  if (!v) return emptyTerms(ctx);
  return `<div class="fee-grid">${[
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
        `<div><span>${h(k)}</span><strong>${h(val)}</strong>${val === "—" ? `<small>${label(ctx, "尚未确认 / 未收录", "Unconfirmed / not recorded")}</small>` : ""}</div>`,
    )
    .join("")}</div><p class="term-note" lang="en">${h(v.notes)}</p>${provenance(ctx, card, v)}`;
}
function earnBlock(ctx: Context, card: Card) {
  const rules = termsAt(card, ctx.asOf).earn_rates;
  if (!rules.length) return emptyTerms(ctx);
  return `<div class="earn-list">${rules.map((rule) => `<article class="earn-item"><div class="earn-title"><h3>${h(category(ctx, "earn", rule.category))}</h3><strong class="rate-number">${h(rate(card, rule.version.rate))}</strong></div><div class="earn-content"><p class="condition">${h(earnConditions(ctx, rule.version))}</p><p class="term-note" lang="en">${h(rule.version.notes)}</p><p class="cap-note">${h(capText(ctx, card, rule.version))}</p>${provenance(ctx, card, rule.version)}</div></article>`).join("")}</div>`;
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
  return `<div class="credit-list">${credits.map((c) => `<article class="credit-item"><div class="credit-heading"><div><span class="overline">${h(category(ctx, "credit", c.category))}</span><h3>${h(c.name)}</h3></div><div class="credit-amount"><strong>${dollars(c.version.amount)}</strong><span>/ ${h(period(ctx, c.version))}</span></div></div><div class="credit-badges">${badge(delivery[c.delivery]![ctx.lang === "zh" ? 0 : 1]!)}${badge(enrollment[c.enrollment]![ctx.lang === "zh" ? 0 : 1]!, c.enrollment === "unknown" ? "amber" : "neutral")}<span>${h(reset(ctx, c.version.reset_basis))}${c.version.period_boundaries === "inferred" ? ` · ${label(ctx, "边界推定", "inferred boundaries")}` : ""}</span></div><p class="term-note" lang="en">${h(c.version.notes)}</p>${creditConditions(ctx, c.version) ? `<p class="condition">${h(creditConditions(ctx, c.version))}</p>` : ""}${provenance(ctx, card, c.version)}</article>`).join("")}</div>`;
}
function sourceBlock(ctx: Context, card: Card) {
  return `<ol class="source-list">${card.sources.map((s) => `<li id="source-${h(s.id)}"><div><a href="${h(s.url)}" target="_blank" rel="noopener noreferrer">${h(s.title)} ${arrow}</a><p>${h(new URL(s.url).hostname)}</p></div><span>${label(ctx, "访问于", "Accessed")} <time>${h(s.accessed)}</time></span></li>`).join("")}</ol><p class="section-note">${label(ctx, "链接指向发卡机构当前页面。历史版本保留的是当时记录的事实与说明，不是网页副本。", "Links open the issuer’s current page. Historical revisions preserve recorded facts and notes, not copies of the source page.")}</p>`;
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
    difference = `<div class="diff-panel"><form id="diff-form" class="diff-controls"><label class="field"><span>${label(ctx, "旧版本", "Earlier version")}</span><select name="from">${revisions.map((r) => option(r.id, r.recorded_at, beforeId ?? "")).join("")}</select></label><span class="diff-arrow" aria-hidden="true">→</span><label class="field"><span>${label(ctx, "新版本", "Later version")}</span><select name="to">${revisions.map((r) => option(r.id, r.recorded_at, afterId ?? "")).join("")}</select></label><button class="button secondary" type="submit">${label(ctx, "比较版本", "Compare revisions")}</button></form><div id="diff-results">${changes === null ? `<p class="notice error">${label(ctx, "版本不存在，请重新选择。", "Revision not found. Choose another version.")}</p>` : changes.length ? `<p class="diff-summary">${changes.length} ${label(ctx, "处内容变化", "content changes")}</p>${changes.map((change) => `<details class="diff-change" open><summary><code>${h(change.path)}</code></summary><div class="diff-values"><div class="diff-before"><span>${label(ctx, "旧内容", "Before")}</span><pre>${h(JSON.stringify(change.before, null, 2))}</pre></div><div class="diff-after"><span>${label(ctx, "新内容", "After")}</span><pre>${h(JSON.stringify(change.after, null, 2))}</pre></div></div></details>`).join("")}` : `<p class="empty-inline">${label(ctx, "这两个版本内容一致。", "These revisions have identical content.")}</p>`}</div></div>`;
  }
  return `<p class="section-note">${label(ctx, "收录时间不等于条款生效时间。选择一个修订，可还原当时保存的完整内容。时间均为 UTC。", "Recorded time is not the effective date. Select a revision to restore its complete recorded content. All times are UTC.")}</p><ol class="timeline">${[
    ...revisions,
  ]
    .reverse()
    .map(
      (r) =>
        `<li class="${active?.id === r.id ? "active" : ""}"><span class="timeline-dot"></span><div><a href="${h(href(ctx, `cards/${ctx.productId}/`, { revision: r.id }))}" data-revision="${h(r.id)}"><time>${h(r.recorded_at.replace("T", " ").replace("Z", " UTC"))}</time>${active?.id === r.id ? badge(t(ctx, "正在查看", "Viewing"), "green") : chevron}</a><p lang="en">${h(r.reason)}</p><details class="revision-meta"><summary>${label(ctx, "修订标识与内容校验值", "Revision ID and content checksum")}</summary><code>${h(r.id)}</code><code>${h(r.content_sha256)}</code></details></div></li>`,
    )
    .join(
      "",
    )}</ol>${difference}<a class="text-link" href="${h(ctx.data.base)}data/history/${h(ctx.productId)}.json" download>${label(ctx, "下载这张卡的完整历史", "Download this card’s full history")} ${arrow}</a>`;
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
  return `<div class="breadcrumb"><a href="${h(href(ctx))}">${label(ctx, "卡片目录", "Catalog")}</a><span>/</span>${h(current.issuer)}</div><section class="card-intro"><div><p class="eyebrow">${h(card.issuer)}<span>·</span>${label(ctx, card.audience === "personal" ? "个人卡" : "商业卡", card.audience === "personal" ? "PERSONAL" : "BUSINESS")}</p><h1>${h(card.name)}</h1><p class="card-subtitle">${h(card.rewards.program)} · ${label(ctx, card.rewards.unit === "cash" ? "返现" : card.rewards.unit === "miles" ? "里程" : "积分", card.rewards.unit)}</p><div class="card-intro-actions">${badge(t(ctx, "草稿资料", "Draft data"), "amber")}<a class="text-link" href="${h(reportLink(ctx, card))}" target="_blank" rel="noopener noreferrer">${label(ctx, "报告变化", "Report a change")} ${arrow}</a></div></div>${cardArt(card, true)}</section>
  <section class="time-panel" aria-label="${label(ctx, "历史查询", "Historical lookup")}"><div class="time-panel-label"><span class="section-number">↶</span><div><strong>${label(ctx, "选择你要查看的时间", "Choose a point in time")}</strong><p>${label(ctx, "条款何时适用 · 目录当时写了什么", "When terms apply · What the catalog recorded")}</p></div></div><form id="time-form">${dateField(ctx)}<label class="field revision-field"><span>${label(ctx, "收录版本 · UTC", "Recorded revision · UTC")}</span><select name="revision">${option("", t(ctx, "最新收录版本", "Latest recorded version"), revisionSelection)}${revisions.map((r) => option(r.id, r.recorded_at.replace("T", " ").replace("Z", ""), revisionSelection)).join("")}</select></label><button type="submit" class="button secondary">${label(ctx, "查看", "View")} ${chevron}</button></form></section>
  ${ctx.params.has("recorded_at") ? `<p class="notice">${label(ctx, "收录时间截止", "Recorded by")} ${h(ctx.params.get("recorded_at"))}</p>` : ""}
  ${archived ? `<p class="notice archive-notice"><strong>${label(ctx, "正在查看存档。", "Viewing an archived revision.")}</strong> ${h(revision!.recorded_at)} <a href="${h(href(ctx, `cards/${ctx.productId}/`, { revision: undefined, recorded_at: undefined }))}" data-latest>${label(ctx, "回到最新记录", "Return to latest")}</a></p>` : ""}
  ${
    !revision
      ? `<section class="empty-state"><span class="empty-symbol">↶</span><h2>${label(ctx, "此时间点尚无记录", "No record at this time")}</h2><p>${label(ctx, "第一条快照之前的内容无法还原，或指定版本不存在。请选择已有版本。", "The requested revision is missing or predates the first snapshot. Select an available revision.")}</p><a class="button secondary" href="${h(href(ctx, `cards/${ctx.productId}/`))}">${label(ctx, "查看最新记录", "View latest record")}</a></section>`
      : `
  <nav class="section-nav" aria-label="${label(ctx, "卡片章节", "Card sections")}">${[
    ["fees", "年费与费用", "Fees"],
    ["earn", "返现与积分", "Earn rates"],
    ["credits", "报销权益", "Credits"],
    ["sources", "官方来源", "Sources"],
    ["history", "修订历史", "History"],
  ]
    .map(([id, zh, en]) => `<a href="#${id}">${label(ctx, zh!, en!)}</a>`)
    .join("")}</nav>
  <div class="card-body"><aside class="reading-note"><span class="small-cross">+</span><strong>${label(ctx, "阅读这份记录", "Reading this record")}</strong><p>${label(ctx, "金额已核实，不代表适用条件完整。起始日未知的条款，不能用来证明过去某日已有此权益。", "A verified amount does not imply complete eligibility. An unknown start cannot establish that a benefit existed on a past date.")}</p><dl><dt>${label(ctx, "条款日期", "Terms date")}</dt><dd>${h(ctx.asOf)}</dd><dt>${label(ctx, "收录时间 · UTC", "Recorded · UTC")}</dt><dd>${h(revision.recorded_at.replace("T", " ").replace("Z", ""))}</dd><dt>${label(ctx, "卡组织", "Network")}</dt><dd>${h(card.network?.toUpperCase() ?? t(ctx, "未确认", "Unconfirmed"))}</dd><dt>${label(ctx, "开放申请", "Availability")}</dt><dd>${label(ctx, card.availability === "open" ? "开放" : card.availability === "closed_to_new" ? "停止新申请" : "已停用", card.availability === "open" ? "Open" : card.availability === "closed_to_new" ? "Closed to new applicants" : "Discontinued")}</dd></dl><details><summary>${label(ctx, "收录范围与备注", "Coverage and notes")}</summary><p lang="en">${h(card.coverage?.notes ?? "")}</p><p lang="en">${h(card.notes)}</p></details></aside><div class="card-sections"><section id="fees">${sectionHead(ctx, "01", t(ctx, "年费与费用", "Fees"), t(ctx, "未确认的费用保留为空，不视为免费。", "Unconfirmed fees are not treated as free."))}${feeBlock(ctx, card)}</section><section id="earn">${sectionHead(ctx, "02", t(ctx, "返现与积分", "Earn rates"), t(ctx, "倍率不自动叠加，须结合渠道、商户与上限。", "Rates do not automatically stack; channels, merchants and caps apply."))}${earnBlock(ctx, card)}</section><section id="credits">${sectionHead(ctx, "03", t(ctx, "报销权益", "Credits"), t(ctx, "按单个周期显示，不估算全年总价值。", "Amounts are per period; no annual value is estimated."))}${creditBlock(ctx, card)}</section><section id="sources">${sectionHead(ctx, "04", t(ctx, "官方来源", "Issuer sources"))}${sourceBlock(ctx, card)}</section><section id="history">${sectionHead(ctx, "05", t(ctx, "修订历史", "Revision history"))}${historyBlock(ctx)}</section></div></div>`
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
    table = `<div class="comparison-scroll" tabindex="0" role="region" aria-label="${label(ctx, "卡片对比表，可横向滚动", "Card comparison table, scroll horizontally")}"><table class="comparison-table"><caption class="sr-only">${label(ctx, "年费、返现规则与报销权益对比", "Fees, earn rates and credits comparison")}</caption><thead><tr><th scope="col">${label(ctx, "对照项目", "Compare by")}<small>${h(ctx.asOf)}</small></th>${cards.map((c) => `<th scope="col">${cardArt(c)}<a href="${h(href(ctx, `cards/${c.id}/`))}">${h(c.name)} ${arrow}</a><span>${h(c.issuer)}</span><button type="button" class="text-button" data-remove="${h(c.id)}">${label(ctx, "移除", "Remove")}</button></th>`).join("")}</tr></thead><tbody><tr><th scope="row">${label(ctx, "年费 · USD", "Annual fee · USD")}</th>${terms.map((x) => `<td class="comparison-fee">${dollars(x.fees?.version.annual_fee)}${x.fees ? certainty(ctx, x.fees.version) : ""}</td>`).join("")}</tr><tr><th scope="row">${label(ctx, "奖励单位", "Reward unit")}</th>${cards.map((c) => `<td>${label(ctx, c.rewards.unit === "cash" ? "返现（%）" : c.rewards.unit === "miles" ? "里程（每美元）" : "积分（每美元）", c.rewards.unit === "cash" ? "Cash (%)" : c.rewards.unit === "miles" ? "Miles / dollar" : "Points / dollar")}<small>${h(c.rewards.program)}</small></td>`).join("")}</tr>
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
                        `<div class="comparison-term"><strong>${h(rate(cards[i]!, r.version.rate))}</strong>${certainty(ctx, r.version)}<p>${h(earnConditions(ctx, r.version))}</p><small>${h(capText(ctx, cards[i]!, r.version))}</small><p class="term-note" lang="en">${h(r.version.notes)}</p><a href="${h(href(ctx, `cards/${cards[i]!.id}/`))}#earn">${label(ctx, "查看出处与条件", "Sources and terms")} ${arrow}</a></div>`,
                    )
                    .join("") || `<span class="muted">${label(ctx, "未收录", "Not recorded")}</span>`
                }</td>`,
            )
            .join("")}</tr>`,
      )
      .join("")}
    <tr class="table-section"><th colspan="${cards.length + 1}">${label(ctx, "报销权益", "Credits")}</th></tr>${creditCategories
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
                        `<div class="comparison-term"><strong>${dollars(c.version.amount)} <small>/ ${h(period(ctx, c.version))}</small></strong><p>${h(c.name)}</p>${certainty(ctx, c.version)}<small>${h(reset(ctx, c.version.reset_basis))} · ${label(ctx, c.delivery === "statement_credit" ? "账单报销" : c.delivery === "issuer_wallet" ? "钱包额度" : "平台内抵扣", c.delivery === "statement_credit" ? "Statement credit" : c.delivery === "issuer_wallet" ? "Wallet allowance" : "In-app credit")}</small><p class="term-note" lang="en">${h(c.version.notes)}</p><p>${h(creditConditions(ctx, c.version))}</p><a href="${h(href(ctx, `cards/${cards[i]!.id}/`))}#credits">${label(ctx, "查看登记要求与出处", "Enrollment and sources")} ${arrow}</a></div>`,
                    )
                    .join("") || `<span class="muted">${label(ctx, "未收录", "Not recorded")}</span>`
                }</td>`,
            )
            .join("")}</tr>`,
      )
      .join("")}</tbody></table></div>`;
  } else
    table = `<div class="empty-state"><span class="empty-symbol">⇄</span><h2>${label(ctx, "选择你想了解的卡片", "Choose cards to explore")}</h2><p>${label(ctx, "最多选择 4 张，逐项对照费用、规则和适用条件。", "Select up to four cards to compare fees, rules and eligibility.")}</p><a class="button" href="${h(href(ctx))}">${label(ctx, "前往卡片目录", "Explore the catalog")} ${chevron}</a></div>`;
  return `${intro(ctx, "02", t(ctx, "横向对比", "SIDE BY SIDE"), t(ctx, "把条款，<em>放在一起看。</em>", "The details,<br><em>side by side.</em>"), t(ctx, "对照规则与条件，不排名、不估算积分价值。不同单位的奖励不直接换算。", "Compare rules and conditions without rankings or point valuations. Different reward units are not converted."))}<div class="compare-controls"><form id="compare-date">${dateField(ctx)}<button class="button secondary" type="submit">${label(ctx, "更新日期", "Update date")}</button></form><a class="text-link" href="${h(href(ctx))}">${label(ctx, "选择 / 添加卡片", "Choose / add cards")} ${chevron}</a></div>${table}`;
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
  return `${intro(ctx, "03", t(ctx, "公开的复核清单", "THE REVIEW QUEUE"), t(ctx, "不确定的，<em>也写清楚。</em>", "Uncertainty,<br><em>in plain sight.</em>"), t(ctx, "这里列出尚待核实的条款，以及超过 90 天未复核的记录。欢迎提供发卡机构的新证据。", "Terms awaiting verification and records not checked in over 90 days. New issuer evidence is welcome."))}<div class="review-stats"><div><strong>${all.filter((x) => x.pending).length}</strong><span>${label(ctx, "待核实版本", "Pending versions")}</span></div><div><strong>${all.filter((x) => x.stale).length}</strong><span>${label(ctx, "超过 90 天", "Over 90 days old")}</span></div><p>${label(ctx, "包括已结束及已公布的未来版本。待核实不代表权益不存在。", "Includes ended and announced future versions. Pending does not mean a benefit is absent.")}</p></div><form class="review-filters" id="review-filters">${search(ctx)}${select(ctx, "issuer", t(ctx, "发卡机构", "Issuer"), issuerOptions(ctx))}${select(
    ctx,
    "status",
    t(ctx, "复核原因", "Review reason"),
    [
      ["pending", t(ctx, "待核实", "Pending")],
      ["stale", t(ctx, "超过 90 天", "Over 90 days")],
    ],
  )}${dateField(ctx, "review_on")}<button class="button secondary" type="submit">${label(ctx, "筛选", "Filter")}</button></form><p class="review-count" role="status">${items.length} ${label(ctx, "个条款版本", "terms versions")}</p><div class="review-list">${items.length ? items.map((x) => `<article class="review-item"><div class="review-item-title"><p class="overline">${h(x.card.issuer)} · ${label(ctx, x.section === "fees" ? "费用" : x.section === "earn" ? "返现与积分" : "报销权益", x.section === "fees" ? "Fees" : x.section === "earn" ? "Earn rates" : "Credits")}</p><h2><a href="${h(href(ctx, `cards/${x.card.id}/`, { asof: x.version.effective_from ?? x.version.effective_to ?? ctx.asOf }))}#${x.section}">${h(x.card.name)} ${arrow}</a></h2><h3>${h(x.name)}</h3><p class="term-note" lang="en">${h(x.version.notes)}</p><span class="interval">${h(interval(ctx, x.version))}</span></div><div class="review-item-meta">${x.pending ? badge(t(ctx, "待核实", "Pending"), "amber") : ""}${x.stale ? badge(t(ctx, `${x.age} 天未复核`, `${x.age} days since check`), "amber") : ""}<small>${label(ctx, x.pending ? "最近尝试" : "最近核实", x.pending ? "Last attempted" : "Last checked")} ${h(x.version.last_verified)}</small><a class="text-link" href="${h(reportLink(ctx, x.card))}" target="_blank" rel="noopener noreferrer">${label(ctx, "补充证据", "Contribute evidence")} ${arrow}</a></div></article>`).join("") : `<div class="empty-state"><span class="empty-symbol">✓</span><h2>${label(ctx, "没有符合条件的待复核记录", "No matching review items")}</h2><p>${label(ctx, "可调整筛选，或查看其他日期。", "Adjust the filters or review date.")}</p></div>`}</div>`;
}
export function aboutPage(ctx: Context) {
  return `${intro(ctx, "04", t(ctx, "关于这份资料", "ABOUT THE INDEX"), t(ctx, "事实开放，<em>来源清楚。</em>", "Open facts.<br><em>Clear provenance.</em>"), t(ctx, "CardFacts 是独立、开放的美国信用卡资料目录。数据可自由使用，修改保留记录。", "CardFacts is an independent, open index of US credit cards. The data is free to use, and edits leave a record."))}<div class="about-grid">${[
    [
      t(ctx, "01 / 只引用发卡机构", "01 / Issuer sources"),
      t(
        ctx,
        "金额和条款引用发卡机构的公开页面。每条版本标有来源和核实日期；未知值留空，不能当作 0 或无限额。",
        "Amounts and terms cite public issuer pages. Each version carries a source and verification date. Missing values mean unknown, not zero or unlimited.",
      ),
    ],
    [
      t(ctx, "02 / 两条时间线", "02 / Two timelines"),
      t(
        ctx,
        "条款日期描述规则何时适用；收录版本保存目录在当时写了什么。起始日未知的记录，不能证明过去某日已有这项权益。",
        "The terms date describes when a rule applies. A recorded revision preserves what the catalog said at that time. An unknown start cannot prove that a benefit existed on a historical date.",
      ),
    ],
    [
      t(ctx, "03 / 规则需要上下文", "03 / Conditions matter"),
      t(
        ctx,
        "消费上限、登记、渠道、商户和周期决定资格。目录不计算收益排名，不把积分换算成现金，也不简单累加全年报销金额。原始英文说明保留在双语界面中。",
        "Caps, enrollment, channels, merchants and reset periods determine eligibility. We do not rank returns, convert points to cash or add credits into a yearly value. Original English notes remain unchanged in both interface languages.",
      ),
    ],
    [
      t(ctx, "04 / 共同维护", "04 / Maintained in public"),
      t(
        ctx,
        "每页都可以报告变化。提供官方来源链接，修改通过公开 PR 审阅。数据仍为草稿，部分条款与商户限制有待复核。",
        "Every page links to a change report. Provide an issuer source; edits are reviewed in public pull requests. The catalog remains a draft with some terms and merchant restrictions awaiting review.",
      ),
    ],
  ]
    .map(([title, body]) => `<section><h2>${h(title)}</h2><p>${h(body)}</p></section>`)
    .join(
      "",
    )}</div><section class="downloads"><div><h2>${label(ctx, "把数据带走", "Take the data with you")}</h2><p>${label(ctx, "数据采用 CC0 许可，代码采用 MIT 许可。应用应固定使用经审核的数据版本。", "Data is CC0; code is MIT. Applications should pin an audited data version.")}</p><span class="mono">${h(ctx.data.version)}</span></div><div><a class="button" href="${h(ctx.data.base)}data/cards.json" download>${label(ctx, "下载当前目录", "Download current catalog")} ${arrow}</a><a class="button secondary" href="${h(ctx.data.base)}data/history.json" download>${label(ctx, "下载全部历史", "Download all history")} ${arrow}</a><a class="text-link" href="${h(ctx.data.base)}data/SHA256SUMS" download>${label(ctx, "下载校验值", "Download checksums")} ${arrow}</a></div></section>`;
}
export function notFound(ctx: Context) {
  return `<section class="empty-state not-found"><span class="eyebrow">404 / NOT FOUND</span><h1>${label(ctx, "这页还不在目录里。", "This page is not in the index.")}</h1><p>${label(ctx, "链接可能有误，返回目录继续查找。", "The link may be incorrect. Return to the catalog to continue.")}</p><a class="button" href="${h(href(ctx))}">${label(ctx, "返回目录", "Back to catalog")} ${chevron}</a></section>`;
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
  return `${ctx.page === "card" ? (ctx.data.cards.find((c) => c.id === ctx.productId)?.name ?? "Card") : t(ctx, { catalog: "信用卡公开资料库", compare: "横向对比", review: "待复核记录", about: "关于数据", "404": "页面不存在" }[ctx.page], { catalog: "The open card index", compare: "Compare cards", review: "Review queue", about: "About the data", "404": "Page not found" }[ctx.page])} · CardFacts`;
}
