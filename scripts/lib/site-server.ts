import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { normalizeBase } from "../../site/model.js";
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};
export function siteServer(root: string, base = "/") {
  normalizeBase(base);
  const directory = resolve(root);
  return createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    try {
      const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      if (base !== "/" && path === base.slice(0, -1)) {
        response.writeHead(302, { Location: base }).end();
        return;
      }
      let file = resolve(directory, path.slice(base.length));
      if (
        !path.startsWith(base) ||
        !(file === directory || file.startsWith(directory + sep)) ||
        path.includes("\0")
      )
        throw new Error("Not found");
      const info = await stat(file);
      if (info.isDirectory()) {
        if (!path.endsWith("/")) {
          response
            .writeHead(302, { Location: path + "/" + new URL(request.url!, "http://localhost").search })
            .end();
          return;
        }
        file = resolve(file, "index.html");
      }
      response.setHeader("Content-Type", types[extname(file)] ?? "text/plain; charset=utf-8");
      const body = await readFile(file);
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.statusCode = 404;
      if (extname((request.url ?? "").split("?")[0]!) && !request.url?.includes(".html")) {
        response.setHeader("Content-Type", "text/plain");
        response.end("Not found");
        return;
      }
      response.setHeader("Content-Type", types[".html"]!);
      const english = request.url?.startsWith(base + "en/");
      const body = await readFile(resolve(directory, english ? "en/404.html" : "404.html")).catch(
        () => "Not found",
      );
      response.end(request.method === "HEAD" ? undefined : body);
    }
  });
}
