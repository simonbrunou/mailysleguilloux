// server.js
import { join, normalize } from "path";
import { contactIntakeFromEnv } from "./contact-intake.js";
const SITE_DIR = join(import.meta.dir, "site");

const IMMUTABLE = new Set(["css","js","woff","woff2","webp","jpg","jpeg","png","svg","ico","avif"]);

// 'unsafe-inline' is required by the static page's inline <style>, inline <script>,
// and inline event handlers (onerror on <img>). External origins are limited to
// Google Fonts, the optional Cloudflare Insights beacon (currently commented out
// in index.html, pre-allowed so enabling it needs no CSP change), and Cloudflare
// Turnstile (challenges.cloudflare.com) for the contact-form anti-bot widget
// (its api.js in script-src, its widget iframe in frame-src).
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

// Note: applying HOME_LINK preloads to both "/" and "/index.html" is an intentional,
// harmless divergence from the static _headers file (which only set them on "/").
const HOME_LINK =
  "</images/mailys.webp>; rel=preload; as=image; type=image/webp, " +
  "<https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Raleway:wght@300;400;500&display=swap>; rel=preload; as=style";

export function headersFor(pathname) {
  const h = { ...SECURITY };
  const ext = pathname.split(".").pop().toLowerCase();

  if (pathname === "/" || pathname === "/index.html") {
    h["Cache-Control"] = "public, max-age=3600, must-revalidate";
    h["Link"] = HOME_LINK;
  } else if (pathname === "/sitemap.xml" || pathname === "/robots.txt") {
    h["Cache-Control"] = "public, max-age=86400, must-revalidate";
  } else if (IMMUTABLE.has(ext)) {
    h["Cache-Control"] = "public, max-age=31536000, immutable";
  }
  return h;
}

function notFound() {
  return new Response(Bun.file(join(SITE_DIR, "404.html")), {
    status: 404,
    headers: { ...SECURITY, "Content-Type": "text/html; charset=utf-8" },
  });
}

async function serveStatic(pathname) {
  if (pathname.endsWith("/")) pathname += "index.html";
  // strip leading slashes, normalize, block traversal
  const rel = normalize(pathname).replace(/^([/\\]|\.\.([/\\]|$))+/, "");
  const filePath = join(SITE_DIR, rel);
  if (!filePath.startsWith(SITE_DIR + "/") && filePath !== SITE_DIR) return notFound();

  let file = Bun.file(filePath);
  if (!(await file.exists())) {
    const html = Bun.file(filePath + ".html"); // html_handling: auto-trailing-slash
    if (await html.exists()) file = html;
    else return notFound();
  }
  return new Response(file, { headers: headersFor("/" + rel) });
}

const ALLOW_ORIGIN = "https://mailysleguilloux.bzh";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOW_ORIGIN },
  });
}

function preflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": ALLOW_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

// contactIntake: built once at startup by contactIntakeFromEnv (see contact-intake.js);
// it returns plain { status, body } replies that are turned into JSON responses here.
export function createFetchHandler({ contactIntake }) {
  return async function fetchHandler(req) {
    const url = new URL(req.url);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === "/contact") {
      if (req.method === "OPTIONS") return preflight();
      if (req.method === "POST") {
        const { status, body } = await contactIntake.submit(req);
        return json(body, status);
      }
      return new Response("Method Not Allowed", {
        status: 405,
        headers: {
          "Allow": "POST, OPTIONS",
          "Access-Control-Allow-Origin": ALLOW_ORIGIN,
        },
      });
    }
    return serveStatic(pathname);
  };
}

if (import.meta.main) {
  const port = Number(process.env.PORT) || 3000;
  const contactIntake = contactIntakeFromEnv(process.env);
  Bun.serve({ port, fetch: createFetchHandler({ contactIntake }) });
  console.log(`mailysleguilloux listening on :${port}`);
}
