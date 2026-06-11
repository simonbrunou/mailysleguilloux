// server.js
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
