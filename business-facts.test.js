// business-facts.test.js
// Business facts (phone, address, geo, price, FAQ, testimonials, site URL, image sizes) are
// copied across the visible page, meta tags, 5 JSON-LD blocks, sitemap.xml and robots.txt.
// index.html stays hand-edited with no build step, so this test is the guard: it fails
// when two copies of a fact disagree.
import { test, expect } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";

const SITE = join(import.meta.dir, "site");
const page = await parsePage(await Bun.file(join(SITE, "index.html")).text());
const sitemap = await Bun.file(join(SITE, "sitemap.xml")).text();
const robots = await Bun.file(join(SITE, "robots.txt")).text();

const blocksByType = Object.fromEntries(page.jsonld.map((block) => [block["@type"], block]));
const {
  WebSite: website,
  Person: person,
  BreadcrumbList: breadcrumbs,
  FAQPage: faqPage,
  HealthAndBeautyBusiness: business,
} = blocksByType;
const canonical = page.links.find((l) => l.rel === "canonical")?.href;
const offers = business.hasOfferCatalog.itemListElement;

// Facts that only the JSON-LD states: nothing on the visible page backs them. They predate
// this test and wait for the owner to confirm them (#26). Google expects structured data to
// describe what the page shows, so don't grow this list: put a new fact on the page instead.
// Once the page shows one, delete its entry (for opening hours, compare them to the page).
const JSON_LD_ONLY = {
  // The page shows no opening hours.
  openingHoursSpecification: [
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      opens: "09:00",
      closes: "18:00",
    },
    { "@type": "OpeningHoursSpecification", dayOfWeek: "Saturday", opens: "10:00", closes: "16:00" },
  ],
  // areaServed beyond what the page names (Vannes, Saint-Avé, Morbihan). Bretagne is the
  // region that contains Morbihan.
  areaServed: ["Arradon", "Séné", "Theix-Noyalo", "Ploeren", "Plescop", "Auray", "Questembert", "Elven", "Bretagne"],
  // A directory listing the page doesn't link to.
  sameAs: ["https://www.annuaire-therapeutes.com/therapeute/179878-mailys-le-guilloux-vannes"],
  // Offers the page doesn't name: it shows two priced cards (kinésiologie, communication
  // animale) and only mentions EFT and the Bach flowers in passing.
  offers: ["Séance EFT - Technique de Libération Émotionnelle", "Consultation Fleurs de Bach"],
};

// ── JSON-LD ───────────────────────────────────────────────────────────────────

test("JSON-LD: the 5 blocks parse and every @id reference resolves", () => {
  expect(page.jsonld.map((b) => b["@type"]).sort()).toEqual(
    ["BreadcrumbList", "FAQPage", "HealthAndBeautyBusiness", "Person", "WebSite"],
  );
  for (const block of page.jsonld) expect(block["@context"]).toBe("https://schema.org");
  const defined = page.jsonld.map((b) => b["@id"]).filter(Boolean);
  const dangling = allValues(page.jsonld, "@id").filter((id) => !defined.includes(id));
  expect(dangling).toEqual([]);
  for (const id of defined) expect(id).toStartWith(canonical + "#");
});

// ── Contact facts ─────────────────────────────────────────────────────────────

test("phone: one number in tel: links, visible text, meta description and JSON-LD", () => {
  const e164 = (s) => s.replace(/^tel:/, "").replace(/[\s.]/g, "").replace(/^0/, "+33");
  const displayed = /0\d(?:[ .]?\d\d){4}/g;
  const telLinks = page.hrefs.filter((h) => h.startsWith("tel:"));
  expect(telLinks.length).toBeGreaterThan(0);
  const numbers = [
    ...telLinks,
    ...(page.visible.match(displayed) ?? []),
    ...(page.meta.description.match(displayed) ?? []),
    ...allValues(page.jsonld, "telephone"),
  ].map(e164);
  expect([...new Set(numbers)]).toEqual([business.telephone]);
});

test("email: one address in mailto: links, visible text and JSON-LD", () => {
  const emails = [
    ...page.hrefs.filter((h) => h.startsWith("mailto:")).map((h) => h.slice("mailto:".length)),
    ...(page.visible.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []),
    ...allValues(page.jsonld, "email"),
  ];
  expect([...new Set(emails)]).toEqual([business.email]);
});

test("address: visible <address>, street mentions, geo meta, hasMap and sitemap agree with JSON-LD", () => {
  const { streetAddress, postalCode, addressLocality, addressRegion, addressCountry } = business.address;
  for (const address of allValues(page.jsonld, "address")) expect(address).toEqual(business.address);
  expect(addressCountry).toBe("FR");
  expect(page.address).toEqual([`${streetAddress} ${postalCode} ${addressLocality}, France`]);

  const texts = [page.visible, ...page.imgs.map((i) => i.alt), sitemap];
  const streets = texts.flatMap((s) => s.match(/\d+ rue de [\p{L}-]+/gu) ?? []);
  expect([...new Set(streets)]).toEqual([streetAddress]);

  expect(page.meta["geo.placename"]).toBe(addressLocality);
  expect(page.meta["geo.region"]).toBe(`FR-${postalCode.slice(0, 2)}`);
  const mapQuery = new URL(business.hasMap).searchParams.get("query");
  expect(mapQuery).toBe(`${streetAddress} ${postalCode} ${addressLocality} France`);
  const geoLocations = tagValues(sitemap, "image:geo_location");
  expect([...new Set(geoLocations)]).toEqual([`${addressLocality}, ${addressRegion}, France`]);
});

test("geo: geo.position and ICBM meta match the JSON-LD coordinates", () => {
  const { latitude, longitude } = business.geo;
  expect(page.meta["geo.position"].split(";").map(Number)).toEqual([latitude, longitude]);
  expect(page.meta.ICBM.split(",").map(Number)).toEqual([latitude, longitude]);
});

test("price: JSON-LD offers and priceRange match the visible price tags", () => {
  const visible = new Set(page.prices.map((p) => Number(p.match(/(\d+)\s*€/)?.[1])));
  const priced = offers.filter((o) => "price" in o);
  expect(new Set(priced.map((o) => Number(o.price)))).toEqual(visible);
  for (const offer of priced) expect(offer.priceCurrency).toBe("EUR");
  expect(new Set((business.priceRange.match(/\d+/g) ?? []).map(Number))).toEqual(visible);
});

// ── Page content mirrored in JSON-LD ──────────────────────────────────────────

test("FAQ: FAQPage mirrors the visible questions and answers, in order", () => {
  const visible = page.questions.map((question, i) => ({ question, answer: page.answers[i] }));
  const structured = faqPage.mainEntity.map((q) => ({ question: q.name, answer: q.acceptedAnswer.text }));
  expect(structured).toEqual(visible);
});

test("testimonials: review[], aggregateRating and slide labels mirror the visible slides", () => {
  const slides = page.slides.map((s) => ({
    author: s.cite.replace(/^— /, ""),
    body: s.quote,
    rating: Number(s.starsLabel?.match(/^(\d) étoiles sur 5$/)?.[1]),
  }));
  const reviews = business.review.map((r) => ({
    author: r.author.name,
    body: r.reviewBody,
    rating: Number(r.reviewRating.ratingValue),
  }));
  expect(reviews).toEqual(slides);

  const { ratingCount, ratingValue, bestRating } = business.aggregateRating;
  expect(Number(ratingCount)).toBe(slides.length);
  expect(Number(ratingValue)).toBe(slides.reduce((sum, s) => sum + s.rating, 0) / slides.length);
  expect(bestRating).toBe("5");
  const labels = slides.map((_, i) => `Témoignage ${i + 1} sur ${slides.length}`);
  expect(page.slides.map((s) => s.label)).toEqual(labels);
  expect(page.slides.map((s) => [...s.stars].length)).toEqual(slides.map((s) => s.rating));
});

test("JSON-LD-only facts are exactly the allowlisted ones", () => {
  const unbacked = (values, backed) => [...new Set(values.filter((v) => !backed(v)))].sort();
  const visible = page.visible.toLowerCase();

  const areas = [
    ...business.areaServed.map((a) => a.name),
    ...offers.flatMap((o) => o.itemOffered.areaServed.split(", ")),
  ];
  expect(unbacked(areas, (a) => page.visible.includes(a))).toEqual([...JSON_LD_ONLY.areaServed].sort());
  const sameAs = allValues(page.jsonld, "sameAs").flat();
  expect(unbacked(sameAs, (url) => page.hrefs.includes(url))).toEqual([...JSON_LD_ONLY.sameAs].sort());
  const offerNames = offers.map((o) => o.itemOffered.name);
  expect(unbacked(offerNames, (name) => visible.includes(name.toLowerCase()))).toEqual([...JSON_LD_ONLY.offers].sort());
  expect(business.openingHoursSpecification).toEqual(JSON_LD_ONLY.openingHoursSpecification);
});

// ── Site URL ──────────────────────────────────────────────────────────────────

test("site URL: canonical, social meta, hreflang, JSON-LD url, breadcrumbs, sitemap and robots agree", () => {
  expect(page.links.filter((l) => l.rel === "canonical")).toHaveLength(1);
  expect(canonical).toEndWith("/");
  expect(page.meta["og:url"]).toBe(canonical);
  expect(page.meta["twitter:url"]).toBe(canonical);
  for (const alt of page.links.filter((l) => l.rel === "alternate")) expect(alt.href).toBe(canonical);
  expect([website.url, person.url, business.url]).toEqual([canonical, canonical, canonical]);

  const [home, ...sections] = breadcrumbs.itemListElement.map((i) => i.item);
  expect(home).toBe(canonical);
  for (const item of sections) {
    expect(item).toStartWith(canonical + "#");
    expect(page.ids).toContain(item.slice(canonical.length + 1));
  }

  expect(tagValues(sitemap, "loc")).toEqual([canonical]);
  expect(robots.match(/^Sitemap: (.*)$/m)?.[1]).toBe(canonical + "sitemap.xml");
});

test("sitemap lastmod is not older than the last commit that changed index.html", () => {
  const git = (...args) => {
    const run = Bun.spawnSync(["git", ...args], { cwd: import.meta.dir });
    if (!run.success) throw new Error(`git ${args.join(" ")} failed: ${run.stderr}`);
    return run.stdout.toString().trim();
  };
  // A shallow clone reports HEAD as the last change to every file; CI checks out with fetch-depth: 0.
  expect(git("rev-parse", "--is-shallow-repository"), "shallow clone: fetch full history").toBe("false");
  // Author date, so a rebase keeps it. A merge commit that combines index.html edits from both
  // sides counts as a new change, dated the day of the merge.
  const lastChange = git("log", "-1", "--format=%as", "--", "site/index.html");
  const [lastmod] = tagValues(sitemap, "lastmod");
  expect(lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(lastmod >= lastChange, `sitemap lastmod ${lastmod} predates the index.html commit of ${lastChange}`).toBe(true);
});

// ── Images ────────────────────────────────────────────────────────────────────

test("images: width/height attributes, srcset widths and JSON-LD sizes match the files", async () => {
  const declared = {};
  const actual = {};
  const record = async (label, path, value, pick = (size) => size) => {
    declared[label] = value;
    actual[label] = pick(imageSize(new Uint8Array(await Bun.file(join(SITE, path)).arrayBuffer()), path));
  };
  for (const { img, sources } of page.pictures) {
    const attrs = [Number(img.width), Number(img.height)];
    await record(`<img> ${img.src}`, img.src, attrs);
    // A <source> serves the same photo in another format, so the <img> attributes must fit it too.
    for (const source of sources) {
      for (const [url] of srcset(source.srcset)) await record(`<source> ${url}`, url, attrs);
    }
    for (const [url, descriptor] of [img, ...sources].flatMap((el) => srcset(el.srcset ?? ""))) {
      if (descriptor?.endsWith("w")) {
        await record(`srcset ${url} ${descriptor}`, url, parseInt(descriptor), ([width]) => width);
      }
    }
  }
  const { image } = person;
  await record("JSON-LD Person.image", sitePath(image.url), [image.width, image.height]);
  const og = [Number(page.meta["og:image:width"]), Number(page.meta["og:image:height"])];
  await record("og:image", sitePath(page.meta["og:image"]), og);
  expect(declared).toEqual(actual);
});

test("images: every image URL in the page, JSON-LD and sitemap exists", () => {
  const urls = [
    ...page.imgs.map((i) => i.src),
    ...page.pictures.flatMap((p) => p.sources).flatMap((s) => srcset(s.srcset).map(([url]) => url)),
    ...allValues(page.jsonld, "image").flat().map((image) => image.url ?? image),
    page.meta["og:image"],
    page.meta["twitter:image"],
    ...tagValues(sitemap, "image:loc"),
  ];
  const paths = urls.map((url) => (url.startsWith("http") ? sitePath(url) : url));
  expect(paths.filter((path) => !existsSync(join(SITE, path)))).toEqual([]);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// Read the facts out of index.html with Bun's streaming HTMLRewriter. Text is
// entity-decoded and whitespace-collapsed.
async function parsePage(source) {
  const page = {
    meta: {}, links: [], hrefs: [], ids: [], imgs: [], pictures: [], jsonld: [],
    address: [], prices: [], questions: [], answers: [], slides: [], visible: "",
  };
  const last = (list) => list[list.length - 1];
  const attributes = (el) => Object.fromEntries(el.attributes);
  const textOf = (list) => ({
    element() { list.push(""); },
    text(t) { list[list.length - 1] += t.text; },
  });
  let inScript = false;
  await new HTMLRewriter()
    .on("meta", {
      element(el) {
        const key = el.getAttribute("name") ?? el.getAttribute("property");
        if (key) page.meta[key] = el.getAttribute("content");
      },
    })
    .on("link", { element(el) { page.links.push({ rel: el.getAttribute("rel"), href: el.getAttribute("href") }); } })
    .on("a[href]", { element(el) { page.hrefs.push(el.getAttribute("href")); } })
    .on("[id]", { element(el) { page.ids.push(el.getAttribute("id")); } })
    .on("img", { element(el) { page.imgs.push(attributes(el)); } })
    .on("picture", { element() { page.pictures.push({ sources: [] }); } })
    .on("picture source", { element(el) { last(page.pictures).sources.push(attributes(el)); } })
    .on("picture img", { element(el) { last(page.pictures).img = attributes(el); } })
    .on('script[type="application/ld+json"]', textOf(page.jsonld))
    // The JSON-LD sits in <body>, so script text must not count as visible text.
    .on("script", { element(el) { inScript = true; el.onEndTag(() => { inScript = false; }); } })
    .on("body", { text(t) { if (!inScript) page.visible += t.text; } })
    .on("address", textOf(page.address))
    .on(".price-tag", textOf(page.prices))
    .on(".faq-question", textOf(page.questions))
    .on(".faq-answer", textOf(page.answers))
    .on(".testimonial-slide", {
      element(el) {
        page.slides.push({ label: el.getAttribute("aria-label"), quote: "", cite: "", stars: "", starsLabel: "" });
      },
    })
    .on(".testimonial-slide blockquote", { text(t) { last(page.slides).quote += t.text; } })
    .on(".testimonial-slide cite", { text(t) { last(page.slides).cite += t.text; } })
    .on(".testimonial-slide .stars", {
      element(el) { last(page.slides).starsLabel = el.getAttribute("aria-label"); },
      text(t) { last(page.slides).stars += t.text; },
    })
    .transform(new Response(source))
    .text();

  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };
  const clean = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => entities[e]).replace(/\s+/g, " ").trim();
  for (const key of ["address", "prices", "questions", "answers"]) page[key] = page[key].map(clean);
  for (const s of page.slides) for (const key of ["quote", "cite", "stars"]) s[key] = clean(s[key]);
  page.visible = clean(page.visible);
  page.jsonld = page.jsonld.map((text) => JSON.parse(text));
  return page;
}

// Every value stored under `key`, at any depth.
function allValues(node, key, out = []) {
  if (Array.isArray(node)) for (const n of node) allValues(n, key, out);
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === key) out.push(v);
      allValues(v, key, out);
    }
  }
  return out;
}

// The text of every <tag>…</tag> in an XML string.
function tagValues(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}>(.*?)</${tag}>`, "g"))].map((m) => m[1]);
}

// "a.webp 760w, b.webp 2x" → [["a.webp", "760w"], ["b.webp", "2x"]]
function srcset(value) {
  return value.split(",").map((candidate) => candidate.trim().split(/\s+/)).filter(([url]) => url);
}

// "https://mailysleguilloux.bzh/images/x.jpg" → "images/x.jpg"
function sitePath(url) {
  expect(url).toStartWith(canonical);
  return url.slice(canonical.length);
}

// Pixel size [width, height] of a JPEG (SOF marker) or WebP (VP8 / VP8L / VP8X chunk). VP8X is
// what a WebP becomes when it carries metadata such as an ICC profile.
function imageSize(bytes, path) {
  const u16be = (i) => (bytes[i] << 8) | bytes[i + 1];
  const u16le = (i) => bytes[i] | (bytes[i + 1] << 8);
  const u24le = (i) => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = 2; i < bytes.length; i += 2 + u16be(i + 2)) {
      const marker = bytes[i + 1];
      const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrameHeader) return [u16be(i + 7), u16be(i + 5)];
    }
    throw new Error(`${path}: JPEG without a frame header`);
  }
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8 ") return [u16le(26) & 0x3fff, u16le(28) & 0x3fff];
  if (chunk === "VP8L") return [1 + (u16le(21) & 0x3fff), 1 + ((u24le(22) >> 6) & 0x3fff)];
  if (chunk === "VP8X") return [1 + u24le(24), 1 + u24le(27)];
  throw new Error(`${path}: unsupported image format (chunk "${chunk}")`);
}
