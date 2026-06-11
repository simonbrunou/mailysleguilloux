// server.test.js
import { test, expect } from "bun:test";
import { headersFor } from "./server.js";

test("global security headers on every path", () => {
  const h = headersFor("/anything.txt");
  expect(h["X-Content-Type-Options"]).toBe("nosniff");
  expect(h["X-Frame-Options"]).toBe("SAMEORIGIN");
  expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=()");
});

test("homepage gets short cache + preload Links", () => {
  const h = headersFor("/index.html");
  expect(h["Cache-Control"]).toBe("public, max-age=3600, must-revalidate");
  expect(h["Link"]).toContain("</images/mailys.webp>; rel=preload; as=image");
});

test("static assets get immutable 1y cache", () => {
  for (const p of ["/a.css", "/b.js", "/c.webp", "/d.jpg", "/e.woff2", "/f.svg", "/g.avif"]) {
    expect(headersFor(p)["Cache-Control"]).toBe("public, max-age=31536000, immutable");
  }
});

test("sitemap/robots get day cache", () => {
  expect(headersFor("/sitemap.xml")["Cache-Control"]).toBe("public, max-age=86400, must-revalidate");
  expect(headersFor("/robots.txt")["Cache-Control"]).toBe("public, max-age=86400, must-revalidate");
});

// append to server.test.js
import { fetchHandler } from "./server.js";

test("serves index.html at /", async () => {
  const res = await fetchHandler(new Request("http://x/"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
});

test("serves a known static asset with immutable cache", async () => {
  const res = await fetchHandler(new Request("http://x/robots.txt"));
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("public, max-age=86400, must-revalidate");
});

test("unknown path returns 404 page", async () => {
  const res = await fetchHandler(new Request("http://x/no-such-page"));
  expect(res.status).toBe(404);
  expect(res.headers.get("content-type")).toContain("text/html");
});

test("path traversal is rejected", async () => {
  const res = await fetchHandler(new Request("http://x/../package.json"));
  expect(res.status).toBe(404);
});
