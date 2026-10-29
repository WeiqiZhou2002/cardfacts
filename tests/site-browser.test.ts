import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { buildSite } from "../scripts/lib/site.js";
import { siteServer } from "../scripts/lib/site-server.js";

test(
  "wiki works under a Pages subpath: filters, comparison, time travel, languages and responsive layouts",
  { skip: process.env.CARDFACTS_SITE_TEST !== "1", timeout: 90000 },
  async () => {
    const out = await mkdtemp(join(tmpdir(), "cardfacts-browser-site-"));
    await buildSite(resolve(import.meta.dirname, ".."), out, "/cardfacts/");
    const server = siteServer(out, "/cardfacts/");
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`,
      base = origin + "/cardfacts/";
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: "reduce",
      });
      const errors: string[] = [],
        networkErrors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().includes("404")) errors.push(message.text());
      });
      page.on("requestfailed", (request) => networkErrors.push(request.url()));
      await page.route("**/*", (route) =>
        route
          .request()
          .url()
          .startsWith(origin + "/")
          ? route.continue()
          : route.abort(),
      );
      async function go(path = "") {
        await page.goto(base + path);
        await page.waitForSelector("html[data-ready=true]");
      }
      async function count(n: number) {
        await page.waitForFunction((n) => document.querySelectorAll(".catalog-row").length === n, n);
      }
      async function noOverflow() {
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          `page overflow: ${page.url()}`,
        );
      }
      await go();
      await count(30);
      await page.locator('[name="audience"]').selectOption("business");
      await count(10);
      await page.locator("[data-reset]").first().click();
      await count(30);
      await page.locator('[name="q"]').fill("gold");
      await count(2);
      await page.locator('[name="earn"]').selectOption("groceries");
      await count(1);
      await page.locator('[name="min_rate"]').fill("4");
      await count(1);
      assert.match(await page.locator("#card-results").innerText(), /Gold Card/);
      await page.locator('[name="unit"]').selectOption("cash");
      await count(0);
      await page.locator("[data-reset]").first().click();
      await count(30);
      // Clear a pending search immediately: a detached form must not restore old filters.
      await page.locator('[name="q"]').fill("no-such-card");
      await page.locator("[data-reset]").first().click();
      await count(30);
      await page.waitForTimeout(180);
      await count(30);
      for (let i = 0; i < 4; i++) {
        const checkbox = page.locator("[data-compare]").nth(i);
        const id = await checkbox.getAttribute("data-compare");
        await checkbox.check();
        assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.compare), id);
      }
      assert.equal(await page.locator("[data-compare]:checked").count(), 4);
      assert.ok(await page.locator("[data-compare]").nth(4).isDisabled());
      await page.locator("#compare-tray a").click();
      await page.waitForSelector(".comparison-table");
      assert.equal(await page.locator("thead th").count(), 5);
      assert.match(await page.locator(".comparison-table").innerText(), /奖励单位|Reward unit/);
      await page.locator("[data-remove]").first().click();
      assert.equal(await page.locator("thead th").count(), 4);
      await noOverflow();
      await page.setViewportSize({ width: 390, height: 844 });
      await noOverflow();
      assert.ok(await page.locator(".comparison-scroll").evaluate((el) => el.scrollWidth > el.clientWidth));
      if (process.env.CARDFACTS_SCREENSHOTS)
        await page.screenshot({
          path: join(process.env.CARDFACTS_SCREENSHOTS, "cardfacts-phase3-compare.png"),
        });
      await go("cards/us-amex-business-platinum/?asof=2026-12-31");
      const hotel = page
        .locator(".credit-item")
        .filter({ has: page.getByRole("heading", { name: "Hotel Credit", exact: true }) });
      assert.ok(!(await hotel.innerText()).includes("至少入住 2 晚"));
      await page.locator("#time-form [name=asof]").fill("2027-01-01");
      await page.locator("#time-form button").click();
      assert.match(await hotel.innerText(), /至少入住 2 晚/);
      assert.match(page.url(), /asof=2027-01-01/);
      await page.goBack();
      assert.ok(!(await hotel.innerText()).includes("至少入住 2 晚"));
      await go("cards/us-capital-one-venture-x/?recorded_at=2026-10-28T22%3A00%3A00Z");
      const archivedSelection = await page.locator("[name=revision]").inputValue();
      assert.ok(archivedSelection);
      await page.locator("#time-form [name=asof]").fill("2027-01-01");
      await page.locator("#time-form button").click();
      assert.equal(await page.locator("[name=revision]").inputValue(), archivedSelection);
      assert.doesNotMatch(await page.locator("#earn").innerText(), /娱乐/);
      await go("cards/us-capital-one-venture-x/");
      assert.match(await page.locator("#earn").innerText(), /娱乐/);
      await page.locator("[data-revision]").last().click();
      assert.match(await page.locator(".archive-notice").innerText(), /正在查看存档/);
      assert.doesNotMatch(await page.locator("#earn").innerText(), /娱乐/);
      await page.reload();
      await page.waitForSelector("html[data-ready=true]");
      assert.doesNotMatch(await page.locator("#earn").innerText(), /娱乐/);
      await page.locator("[data-latest]").click();
      assert.match(await page.locator("#earn").innerText(), /娱乐/);
      assert.ok((await page.locator(".diff-change").count()) > 0);
      const latest = await page.locator("#diff-form [name=to]").inputValue();
      await page.locator("#diff-form [name=from]").selectOption(latest);
      await page.locator("#diff-form button").click();
      assert.match(await page.locator("#diff-results").innerText(), /内容一致/);
      await go("cards/us-capital-one-venture-x/?recorded_at=2000-01-01T00%3A00%3A00Z");
      assert.match(await page.locator("main").innerText(), /此时间点尚无记录/);
      assert.equal(await page.locator("#earn").count(), 0);
      await go("cards/us-capital-one-venture-x/?asof=2026-02-30");
      assert.match(await page.getByRole("alert").innerText(), /日期无效/);
      await go("review/?review_on=2026-10-28");
      assert.equal(await page.locator(".review-item").count(), 10);
      await page.locator("[name=review_on]").fill("2027-02-01");
      await page.locator("#review-filters button").click();
      assert.ok((await page.locator(".review-item").count()) > 100);
      await page.locator(".language").click();
      await page.waitForSelector("html[data-ready=true]");
      assert.match(page.url(), /\/en\/review\/\?review_on=2027-02-01/);
      assert.match(await page.locator("h1").innerText(), /Uncertainty/);
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const path of ["", "en/", "cards/us-capital-one-venture-x/", "review/", "about/"]) {
          await go(path);
          await noOverflow();
          if (width === 390 && path === "") {
            await page.locator("[data-filters]").click();
            assert.ok(await page.locator("[name=audience]").isVisible());
            await page.locator("[name=audience]").selectOption("business");
            await count(10);
            await page.locator("[data-filters]").click();
            assert.ok(!(await page.locator("[name=audience]").isVisible()));
            await count(10);
          }
        }
      }
      if (process.env.CARDFACTS_SCREENSHOTS) {
        const shots = process.env.CARDFACTS_SCREENSHOTS;
        await page.setViewportSize({ width: 1440, height: 1000 });
        await go();
        await page.screenshot({ path: join(shots, "cardfacts-phase3-index.png") });
        await go("cards/us-capital-one-venture-x/");
        await page.screenshot({ path: join(shots, "cardfacts-phase3-detail.png") });
        await page.locator("#history").scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(shots, "cardfacts-phase3-history.png") });
        await page.setViewportSize({ width: 390, height: 844 });
        await go();
        await page.screenshot({ path: join(shots, "cardfacts-phase3-mobile.png") });
        await page.locator("[data-filters]").click();
        assert.ok(await page.locator("[name=audience]").isVisible());
        await page.locator("[data-filters]").click();
        assert.ok(!(await page.locator("[name=audience]").isVisible()));
        await page.locator("#card-results").scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(shots, "cardfacts-phase3-mobile-list.png") });
        await go("cards/us-capital-one-venture-x/");
        await page.screenshot({ path: join(shots, "cardfacts-phase3-mobile-detail.png") });
      }
      const response = await page.goto(base + "missing-page/");
      assert.equal(response!.status(), 404);
      await page.waitForSelector("html[data-ready=true]");
      assert.match(await page.locator("h1").innerText(), /不在目录/);
      const noJS = await browser.newContext({ javaScriptEnabled: false });
      const staticPage = await noJS.newPage();
      await staticPage.goto(base);
      assert.equal(await staticPage.locator(".catalog-row").count(), 30);
      await staticPage.goto(base + "cards/us-amex-gold/");
      assert.ok((await staticPage.locator("#credits .credit-item").count()) > 0);
      assert.match(await staticPage.locator("noscript").innerText(), /预生成内容/);
      await noJS.close();
      const traversal = await fetch(origin + "/cardfacts/%2e%2e%2fpackage.json");
      assert.equal(traversal.status, 404);
      const missingAsset = await fetch(base + "assets/missing.js");
      assert.equal(missingAsset.status, 404);
      assert.match(missingAsset.headers.get("content-type")!, /text\/plain/);
      assert.deepEqual(errors, []);
      assert.deepEqual(networkErrors, []);
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));
      await rm(out, { recursive: true, force: true });
    }
  },
);
