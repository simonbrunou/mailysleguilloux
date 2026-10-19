// server.js
//
// Header policy: turns a request into a response and gives every response the
// security headers and the CSP, whatever produced its body: a file from site/, a
// contact intake reply, or a 400/404/405. Cache-Control and the homepage's preload
// Link are keyed on the file actually served. This is the only place the header
// policy lives; server.test.js checks the CSP against what site/index.html loads.
import { join } from "path";
import { contactIntakeFromEnv } from "./contact-intake.js";
const SITE_DIR = join(import.meta.dir, "site");

const IMMUTABLE = new Set(["css","js","woff","woff2","webp","jpg","jpeg","png","svg","ico","avif"]);

// 'unsafe-inline' is required by the static page's inline <style>, inline <script>,
// and inline event handlers (onerror on <img>). External origins are limited to
// Google Fonts, the Cloudflare Insights beacon (its script in script-src, its
// reports in connect-src), and Cloudflare Turnstile (challenges.cloudflare.com) for
// the contact-form anti-bot widget (its api.js in script-src, its widget iframe in
// frame-src).
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "img-src 'self' data:",
  "font-src 'self' https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com https://challenges.cloudflare.com",
  "connect-src 'self' https://cloudflareinsights.com https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
].join("; ");

const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": CSP,
};

// Sent with index.html whichever URL served it: "/", "/index.html" or "/index".
const HOME_LINK =
  "</images/mailys.webp>; rel=preload; as=image; type=image/webp, " +
  "<https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Raleway:wght@300;400;500&display=swap>; rel=preload; as=style";

// Cache-Control (and the homepage's preload Link) for a file served from site/,
// named by its path inside site/.
function fileHeaders(file) {
  if (file === "index.html") return { "Cache-Control": "public, max-age=3600, must-revalidate", "Link": HOME_LINK };
  if (file === "sitemap.xml" || file === "robots.txt") return { "Cache-Control": "public, max-age=86400, must-revalidate" };
  if (IMMUTABLE.has(file.split(".").pop().toLowerCase())) return { "Cache-Control": "public, max-age=31536000, immutable" };
  return {};
}

const TEXT_HEADERS = { "Content-Type": "text/plain; charset=utf-8" };

function notFound() {
  return {
    status: 404,
    body: Bun.file(join(SITE_DIR, "404.html")),
    headers: { "Content-Type": "text/html; charset=utf-8" },
  };
}

async function serveStatic(pathname) {
  if (pathname.endsWith("/")) pathname += "index.html";
  // join() resolves "..", so a decoded "%2f.." can climb out of site/: refuse it
  const filePath = join(SITE_DIR, pathname);
  if (!filePath.startsWith(SITE_DIR + "/")) return notFound();

  // "/about" also finds about.html, as Cloudflare's auto-trailing-slash did
  for (const candidate of [filePath, filePath + ".html"]) {
    const file = Bun.file(candidate);
    if (!(await file.exists())) continue;
    const served = candidate.slice(SITE_DIR.length + 1);
    if (served === "404.html") return notFound(); // no soft 404 at /404
    return { status: 200, body: file, headers: fileHeaders(served) };
  }
  return notFound();
}

// Returns the decoded path, or null when the URL can't name a file: a malformed
// percent-encoding, or a NUL byte (Bun.file throws on one).
function pathOf(request) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return null;
  }
  return pathname.includes("\0") ? null : pathname;
}

// Every branch returns plain { status, body, headers }; fetchHandler alone builds
// the Response, so no reply can leave without the security headers.
async function route(request, contactIntake) {
  const pathname = pathOf(request);
  if (pathname === null) return { status: 400, body: "Bad Request", headers: TEXT_HEADERS };
  if (pathname === "/contact") {
    if (request.method !== "POST") {
      return { status: 405, body: "Method Not Allowed", headers: { ...TEXT_HEADERS, "Allow": "POST" } };
    }
    const { status, body } = await contactIntake.submit(request);
    return { status, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } };
  }
  return serveStatic(pathname);
}

// contactIntake: built once at startup by contactIntakeFromEnv (see contact-intake.js);
// its plain { status, body } replies become JSON responses in route().
export function createFetchHandler({ contactIntake }) {
  return async function fetchHandler(request) {
    const { status, body, headers } = await route(request, contactIntake);
    return new Response(body, { status, headers: { ...headers, ...SECURITY } });
  };
}

if (import.meta.main) {
  const port = Number(process.env.PORT) || 3000;
  const contactIntake = contactIntakeFromEnv(process.env);
  Bun.serve({ port, fetch: createFetchHandler({ contactIntake }) });
  console.log(`mailysleguilloux listening on :${port}`);
}
