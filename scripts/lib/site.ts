import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build, transform } from "esbuild";
import { buildCatalog, loadCatalog, readJson } from "./catalog.js";
import { context, h, normalizeBase, scriptJson, t } from "../../site/model.js";
import type { Category, Lang, Page, SiteData } from "../../site/model.js";
import { footer, header, renderPage, title } from "../../site/views.js";

// The caller supplies a fresh output directory; never remove arbitrary paths here.
export async function buildSite(root: string, out: string, base = "/") {
  normalizeBase(base);
  const catalog = await loadCatalog(root);
  const data: SiteData = {
    cards: catalog.cards,
    revisions: [],
    earnCategories: (await readJson(join(root, "vocab/earn-categories.json"))) as Category[],
    creditCategories: (await readJson(join(root, "vocab/credit-categories.json"))) as Category[],
    version: catalog.metadata.catalog_version,
    asOf: catalog.metadata.catalog_version.slice(0, 10).replaceAll(".", "-"),
    base,
    repository: "https://github.com/WeiqiZhou2002/cardfacts",
  };
  await mkdir(join(out, "assets"), { recursive: true });
  await build({
    entryPoints: [join(root, "site/app.ts")],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    minify: true,
    outfile: join(out, "assets/app.js"),
    logLevel: "silent",
  });
  const css = await transform(await readFile(join(root, "site/styles.css"), "utf8"), {
    loader: "css",
    minify: true,
  });
  await writeFile(join(out, "assets/styles.css"), css.code);
  await writeFile(
    join(out, "assets/favicon.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#214d3d"/><g fill="none" stroke="#f6f5ef" stroke-width="1.5"><rect x="6" y="10" width="18" height="13" rx="2"/><path d="M10 6h15a2 2 0 0 1 2 2v11M10 15h6m-6 4h10"/></g></svg>',
  );
  const pages: string[] = [];
  async function page(lang: Lang, kind: Page, path: string, productId?: string) {
    const pageData = {
      ...data,
      revisions: productId ? catalog.revisions.filter((r) => r.product_id === productId) : [],
    };
    const ctx = context(pageData, kind, lang, new URLSearchParams(), productId);
    const description = t(
      ctx,
      "有出处、有历史的美国信用卡资料：查阅年费、返现、积分与报销条款。",
      "An open, cited index of US credit card fees, rewards and credits, with a complete revision history.",
    );
    const html = `<!doctype html>
<html lang="${lang === "zh" ? "zh-CN" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'"><title>${h(title(ctx))}</title><meta name="description" content="${h(description)}"><meta name="theme-color" content="#214d3d"><link rel="icon" href="${base}assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="${base}assets/styles.css"></head><body><div id="header">${header(ctx)}</div><noscript><p class="noscript-notice">${h(t(ctx, `当前显示 ${data.asOf} 的预生成内容。筛选、时间查询与对比需要启用 JavaScript；完整历史也可下载。`, `Showing pre-rendered content for ${data.asOf}. Enable JavaScript for filters, time queries and comparison, or download the full history.`))}</p></noscript><main id="main" class="page-shell" tabindex="-1">${renderPage(ctx)}</main><div id="footer">${footer(ctx)}</div><div id="live-status" class="sr-only" role="status" aria-live="polite"></div><script id="site-data" type="application/json">${scriptJson({ data: pageData, page: kind, lang, productId })}</script><script type="module" src="${base}assets/app.js"></script></body></html>\n`;
    const file = join(out, path);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, html);
    pages.push(path);
  }
  for (const lang of ["zh", "en"] as const) {
    const prefix = lang === "en" ? "en/" : "";
    for (const kind of ["catalog", "compare", "review", "about"] as const)
      await page(lang, kind, `${prefix}${kind === "catalog" ? "" : kind + "/"}index.html`);
    for (const card of catalog.cards)
      await page(lang, "card", `${prefix}cards/${card.id}/index.html`, card.id);
    await page(lang, "404", `${prefix}404.html`);
  }
  await buildCatalog(catalog, join(out, "data"));
  await mkdir(join(out, "data/history"), { recursive: true });
  for (const card of catalog.cards)
    await writeFile(
      join(out, "data/history", `${card.id}.json`),
      JSON.stringify(
        { format_version: 1, revisions: catalog.revisions.filter((r) => r.product_id === card.id) },
        null,
        2,
      ) + "\n",
    );
  await writeFile(join(out, ".nojekyll"), "");
  await writeFile(
    join(out, "site-config.json"),
    JSON.stringify({ base, version: data.version, asOf: data.asOf }) + "\n",
  );
  return { pages, cards: catalog.cards.length, base };
}
