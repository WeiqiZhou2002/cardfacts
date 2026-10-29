import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { browserTransport } from "../scripts/lib/fetch-source.js";

test(
  "real Chromium renders public text and blocks forbidden requests",
  { skip: process.env.CARDFACTS_BROWSER_TEST !== "1" },
  async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`);
      if (request.url === "/robots.txt") {
        response.end("User-agent: *\nAllow: /");
        return;
      }
      response.setHeader("Content-Type", "text/html");
      response.end(`<html><body><main>Loading</main><script>
      document.querySelector('main').textContent = 'Issuer terms rendered with JavaScript. Annual fee and earning rules are displayed here for a controlled browser test.';
      fetch('/mutate', {method: 'POST'}).catch(() => {});
      fetch('/forbidden').catch(() => {});
    </script></body></html>`);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      const robots = await browserTransport.robots(`${origin}/robots.txt`, "CardFacts-Test");
      assert.equal(robots.status, 200);
      const result = await browserTransport.render(
        `${origin}/terms`,
        "CardFacts-Test",
        async (url) => url.startsWith(origin + "/") && !url.endsWith("/forbidden"),
      );
      assert.equal(result.status, 200);
      assert.match(result.text, /rendered with JavaScript/);
      assert.ok(!requests.includes("POST /mutate"));
      assert.ok(!requests.includes("GET /forbidden"));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
