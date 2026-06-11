// server.js
import { join, normalize } from "path";
const SITE_DIR = join(import.meta.dir, "site");

const IMMUTABLE = new Set(["css","js","woff","woff2","webp","jpg","jpeg","png","svg","ico","avif"]);

const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

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

export async function fetchHandler(req) {
  const url = new URL(req.url);
  const pathname = decodeURIComponent(url.pathname);
  // /contact wired in Task 4
  return serveStatic(pathname);
}
