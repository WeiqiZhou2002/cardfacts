import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { handle, serialize } from "./api.js";
import type { ApiContext } from "./api.js";

const PREFIX = "/api/v1/";
// Read-only JSON over the same paths as the static files, plus query parameters. With `today`, a
// request without as_of reads the terms in effect on that date instead of the context's fixed date.
export function apiServer(context: () => ApiContext, options: { today?: () => string } = {}) {
  return createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const send = (status: number, body: unknown) => {
      const text = serialize(body);
      const etag = `"${createHash("sha256").update(text).digest("hex").slice(0, 32)}"`;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", status === 200 ? "public, max-age=300" : "no-store");
      response.setHeader("ETag", etag);
      if (status === 200 && request.headers["if-none-match"] === etag)
        return void response.writeHead(304).end();
      response.writeHead(status).end(request.method === "HEAD" ? undefined : text);
    };
    const error = (status: number, code: string, message: string) =>
      send(status, { api_version: 1, error: { status, code, message } });
    if (request.method === "OPTIONS") return void response.writeHead(204).end();
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD, OPTIONS");
      return error(405, "method_not_allowed", "The API is read-only.");
    }
    if ((request.url ?? "").length > 2048) return error(414, "uri_too_long", "Request URI is too long.");
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/" || url.pathname === "/api/v1") {
      response.setHeader("Location", PREFIX);
      return void response.writeHead(302).end();
    }
    if (!url.pathname.startsWith(PREFIX)) return error(404, "not_found", `The API lives under ${PREFIX}.`);
    // Paths are matched literally (no decoding), so encoded separators cannot reach other resources.
    const ctx = context();
    const result = handle(
      options.today ? { ...ctx, asOf: options.today() } : ctx,
      url.pathname.slice(PREFIX.length),
      url.searchParams,
    );
    send(result.status, result.body);
  });
}
