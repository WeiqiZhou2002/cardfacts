import { context, t } from "./model.js";
import type { Context, Lang, Page, SiteData } from "./model.js";
import { catalogResults, compareTray, footer, header, renderPage, resultCount, title } from "./views.js";

const payload = document.querySelector<HTMLScriptElement>("#site-data");
if (!payload) throw new Error("Missing site data");
const seed = JSON.parse(payload.textContent!) as {
  data: SiteData;
  page: Page;
  lang: Lang;
  productId?: string;
};
const today = new Date().toISOString().slice(0, 10);
let ctx: Context;
let filtersOpen = false;
function showFilters() {
  const button = document.querySelector<HTMLButtonElement>("[data-filters]");
  document.querySelector(".filter-panel")?.classList.toggle("filters-open", filtersOpen);
  if (button) {
    button.setAttribute("aria-expanded", String(filtersOpen));
    button.textContent = filtersOpen
      ? t(ctx, "收起筛选条件 −", "Hide filters −")
      : t(ctx, "展开筛选条件 +", "Show filters +");
  }
}
const main = document.querySelector<HTMLElement>("#main")!;
const live = document.querySelector<HTMLElement>("#live-status")!;
function current() {
  return context(
    seed.data,
    seed.page,
    seed.lang,
    new URLSearchParams(location.search),
    seed.productId,
    today,
  );
}
function draw() {
  ctx = current();
  document.querySelector("#header")!.innerHTML = header(ctx);
  main.innerHTML = renderPage(ctx);
  showFilters();
  document.querySelector("#footer")!.innerHTML = footer(ctx);
  document.title = title(ctx);
  document.body.classList.toggle("has-tray", ctx.page === "catalog" && ctx.selected.length > 0);
  if (ctx.error) live.textContent = ctx.error;
}
function update(params: URLSearchParams, full = true, push = false) {
  clearTimeout(searchTimer);
  const url = `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`;
  history[push ? "pushState" : "replaceState"](null, "", url);
  if (full) draw();
  else {
    ctx = current();
    document.querySelector("#card-results")!.innerHTML = catalogResults(ctx);
    document.querySelector("#result-count")!.innerHTML = resultCount(ctx);
    document.querySelector("#compare-tray")!.innerHTML = compareTray(ctx);
    document.querySelector("#header")!.innerHTML = header(ctx);
    document.body.classList.toggle("has-tray", ctx.selected.length > 0);
  }
}
function formParams(form: HTMLFormElement) {
  const params = new URLSearchParams(location.search);
  for (const [key, value] of new FormData(form)) {
    const text = String(value).trim();
    if (text) params.set(key, text);
    else params.delete(key);
  }
  return params;
}
function resetFilters() {
  const params = new URLSearchParams();
  if (ctx.selected.length) params.set("cards", ctx.selected.join(","));
  update(params, true, true);
  document.querySelector<HTMLInputElement>("[name=q]")?.focus();
}
function changeSelection(id: string, checked: boolean, input?: HTMLInputElement) {
  const selected = new Set(ctx.selected);
  if (checked && selected.size >= 4 && !selected.has(id)) {
    if (input) input.checked = false;
    live.textContent = t(ctx, "最多选择 4 张卡片。", "Select up to four cards.");
    return;
  }
  if (checked) selected.add(id);
  else selected.delete(id);
  const params = new URLSearchParams(location.search);
  if (selected.size) params.set("cards", [...selected].join(","));
  else params.delete("cards");
  // Restore keyboard focus after replacing filtered results.
  if (ctx.page === "catalog") {
    update(params, false);
    document
      .querySelector<HTMLInputElement>(`[data-compare="${CSS.escape(id)}"]`)
      ?.focus({ preventScroll: true });
  } else update(params);
  live.textContent = t(ctx, `已选择 ${selected.size} 张卡片。`, `${selected.size} cards selected.`);
}
function guarded(action: () => void) {
  try {
    action();
  } catch (error) {
    live.textContent = t(
      ctx,
      "页面更新失败，请刷新后重试。",
      "The page could not update. Refresh and try again.",
    );
    console.error(error);
  }
}
document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (!["catalog-filters", "review-filters", "time-form", "compare-date", "diff-form"].includes(form.id))
    return;
  event.preventDefault();
  guarded(() => {
    const params = formParams(form);
    if (form.id === "time-form") params.delete("recorded_at");
    update(params, true, true);
    if (form.id === "diff-form") document.querySelector("#history")?.scrollIntoView({ block: "start" });
  });
});
let searchTimer: ReturnType<typeof setTimeout> | undefined;
document.addEventListener("input", (event) => {
  const input = event.target;
  if (
    !(input instanceof HTMLInputElement) ||
    !input.form ||
    input.form.id !== "catalog-filters" ||
    !["q", "min_rate"].includes(input.name)
  )
    return;
  clearTimeout(searchTimer);
  const form = input.form;
  searchTimer = setTimeout(
    () =>
      guarded(() => {
        if (input.validity.valid) update(formParams(form), false);
      }),
    120,
  );
});
document.addEventListener("change", (event) => {
  const input = event.target;
  if (input instanceof HTMLInputElement && input.dataset.compare) {
    guarded(() => changeSelection(input.dataset.compare!, input.checked, input));
    return;
  }
  if (
    (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) &&
    input.form?.id === "catalog-filters"
  ) {
    guarded(() => {
      if (input.form!.checkValidity()) update(formParams(input.form!), false);
    });
  }
});
document.addEventListener("click", (event) => {
  const element =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>(
          "[data-filters],[data-reset],[data-clear-compare],[data-remove],[data-revision],[data-latest]",
        )
      : null;
  if (!element) return;
  // Preserve normal new-tab/copy-link behavior on revision links.
  if (
    element instanceof HTMLAnchorElement &&
    (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
  )
    return;
  event.preventDefault();
  guarded(() => {
    if (element.hasAttribute("data-filters")) {
      filtersOpen = !filtersOpen;
      showFilters();
      return;
    }
    if (element.hasAttribute("data-reset")) {
      resetFilters();
      return;
    }
    if (element.dataset.remove) {
      changeSelection(element.dataset.remove, false);
      return;
    }
    const params = new URLSearchParams(location.search);
    if (element.hasAttribute("data-clear-compare")) params.delete("cards");
    if (element.dataset.revision) {
      params.set("revision", element.dataset.revision);
      params.delete("recorded_at");
    }
    if (element.hasAttribute("data-latest")) {
      params.delete("revision");
      params.delete("recorded_at");
    }
    update(params, true, true);
    if (element.dataset.revision) document.querySelector(".time-panel")?.scrollIntoView({ block: "start" });
  });
});
window.addEventListener("popstate", () => guarded(draw));
try {
  draw();
  document.documentElement.dataset.ready = "true";
  if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
} catch (error) {
  live.textContent =
    seed.lang === "zh"
      ? "交互功能暂时不可用；仍可阅读下方预生成内容。"
      : "Interactive features are unavailable; the pre-rendered content remains readable.";
  console.error(error);
}
