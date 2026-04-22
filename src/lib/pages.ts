// SEO/GEO landing pages built from in-memory data.
// One page per festival, flower spot, and sakura prefecture — each crawlable
// HTML with schema.org JSON-LD, canonical, and Open Graph metadata so search
// engines and AI citation crawlers (ChatGPT, Claude, Perplexity, AI Overviews)
// can surface them.

const SITE = "https://seasons.kooexperience.com";

// ─── Prefecture canonical list ──────────────────────────────────────────────
// Slug = JMA prefecture name lowercased. Code matches PREF_CODES in
// sakura-forecast.ts. Region matches Japan's standard 8-region grouping.
export const PREFECTURES = [
  { slug: "hokkaido",  name: "Hokkaido",  region: "Hokkaido", code: "01" },
  { slug: "aomori",    name: "Aomori",    region: "Tohoku",   code: "02" },
  { slug: "iwate",     name: "Iwate",     region: "Tohoku",   code: "03" },
  { slug: "miyagi",    name: "Miyagi",    region: "Tohoku",   code: "04" },
  { slug: "akita",     name: "Akita",     region: "Tohoku",   code: "05" },
  { slug: "yamagata",  name: "Yamagata",  region: "Tohoku",   code: "06" },
  { slug: "fukushima", name: "Fukushima", region: "Tohoku",   code: "07" },
  { slug: "ibaraki",   name: "Ibaraki",   region: "Kanto",    code: "08" },
  { slug: "tochigi",   name: "Tochigi",   region: "Kanto",    code: "09" },
  { slug: "gunma",     name: "Gunma",     region: "Kanto",    code: "10" },
  { slug: "saitama",   name: "Saitama",   region: "Kanto",    code: "11" },
  { slug: "chiba",     name: "Chiba",     region: "Kanto",    code: "12" },
  { slug: "tokyo",     name: "Tokyo",     region: "Kanto",    code: "13" },
  { slug: "kanagawa",  name: "Kanagawa",  region: "Kanto",    code: "14" },
  { slug: "niigata",   name: "Niigata",   region: "Chubu",    code: "15" },
  { slug: "toyama",    name: "Toyama",    region: "Chubu",    code: "16" },
  { slug: "ishikawa",  name: "Ishikawa",  region: "Chubu",    code: "17" },
  { slug: "fukui",     name: "Fukui",     region: "Chubu",    code: "18" },
  { slug: "yamanashi", name: "Yamanashi", region: "Chubu",    code: "19" },
  { slug: "nagano",    name: "Nagano",    region: "Chubu",    code: "20" },
  { slug: "gifu",      name: "Gifu",      region: "Chubu",    code: "21" },
  { slug: "shizuoka",  name: "Shizuoka",  region: "Chubu",    code: "22" },
  { slug: "aichi",     name: "Aichi",     region: "Chubu",    code: "23" },
  { slug: "mie",       name: "Mie",       region: "Kansai",   code: "24" },
  { slug: "shiga",     name: "Shiga",     region: "Kansai",   code: "25" },
  { slug: "kyoto",     name: "Kyoto",     region: "Kansai",   code: "26" },
  { slug: "osaka",     name: "Osaka",     region: "Kansai",   code: "27" },
  { slug: "hyogo",     name: "Hyogo",     region: "Kansai",   code: "28" },
  { slug: "nara",      name: "Nara",      region: "Kansai",   code: "29" },
  { slug: "wakayama",  name: "Wakayama",  region: "Kansai",   code: "30" },
  { slug: "tottori",   name: "Tottori",   region: "Chugoku",  code: "31" },
  { slug: "shimane",   name: "Shimane",   region: "Chugoku",  code: "32" },
  { slug: "okayama",   name: "Okayama",   region: "Chugoku",  code: "33" },
  { slug: "hiroshima", name: "Hiroshima", region: "Chugoku",  code: "34" },
  { slug: "yamaguchi", name: "Yamaguchi", region: "Chugoku",  code: "35" },
  { slug: "tokushima", name: "Tokushima", region: "Shikoku",  code: "36" },
  { slug: "kagawa",    name: "Kagawa",    region: "Shikoku",  code: "37" },
  { slug: "ehime",     name: "Ehime",     region: "Shikoku",  code: "38" },
  { slug: "kochi",     name: "Kochi",     region: "Shikoku",  code: "39" },
  { slug: "fukuoka",   name: "Fukuoka",   region: "Kyushu",   code: "40" },
  { slug: "saga",      name: "Saga",      region: "Kyushu",   code: "41" },
  { slug: "nagasaki",  name: "Nagasaki",  region: "Kyushu",   code: "42" },
  { slug: "kumamoto",  name: "Kumamoto",  region: "Kyushu",   code: "43" },
  { slug: "oita",      name: "Oita",      region: "Kyushu",   code: "44" },
  { slug: "miyazaki",  name: "Miyazaki",  region: "Kyushu",   code: "45" },
  { slug: "kagoshima", name: "Kagoshima", region: "Kyushu",   code: "46" },
  { slug: "okinawa",   name: "Okinawa",   region: "Okinawa",  code: "47" },
] as const;

export type Prefecture = typeof PREFECTURES[number];

export function findPrefectureBySlug(slug: string): Prefecture | undefined {
  return PREFECTURES.find(p => p.slug === slug);
}

// ─── Data shapes for in-memory JSON ─────────────────────────────────────────
export interface FestivalSpot {
  id: string;
  type: string;
  name: string;
  nameJa?: string;
  lat?: number;
  lon?: number;
  prefecture?: string;
  region?: string;
  months?: number[];
  typicalDate?: string;
  url?: string;
  note?: string;
  attendance?: number;
}

export interface FlowerSpot {
  id: string;
  type: string;
  name: string;
  nameJa?: string;
  lat?: number;
  lon?: number;
  prefecture?: string;
  region?: string;
  peakStart?: string;
  peakEnd?: string;
  url?: string;
  note?: string;
}

export interface SakuraSpotForPage {
  name?: string;
  nameRomaji?: string;
  prefecture?: string;
  lat?: number;
  lon?: number;
  bloomForecast?: string | null;
  fullBloomForecast?: string | null;
  fullRate?: number | null;
  bloomRate?: number | null;
  status?: string | null;
  displayStatus?: string | null;
}

// ─── HTML escape ────────────────────────────────────────────────────────────
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, c => ESC[c] || c);
}

// ─── Shared base template ───────────────────────────────────────────────────
interface BasePageData {
  title: string;
  description: string;
  canonical: string;
  jsonLd: object[];
  breadcrumb: Array<{ name: string; url?: string }>;
  bodyHtml: string;
  ogType?: "website" | "article" | "event";
}

function renderBreadcrumbHtml(crumbs: Array<{ name: string; url?: string }>): string {
  return `<nav class="crumbs" aria-label="Breadcrumb">${crumbs
    .map((c, i) => {
      const last = i === crumbs.length - 1;
      const sep = i > 0 ? `<span class="crumb-sep">›</span>` : "";
      return c.url && !last
        ? `${sep}<a href="${esc(c.url)}">${esc(c.name)}</a>`
        : `${sep}<span aria-current="page">${esc(c.name)}</span>`;
    })
    .join("")}</nav>`;
}

function renderBreadcrumbJsonLd(crumbs: Array<{ name: string; url?: string }>): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      ...(c.url ? { item: c.url } : {}),
    })),
  };
}

function renderInstallSection(): string {
  return `
    <section class="cta">
      <h2>Use this in Claude or any AI assistant</h2>
      <p>This page is backed by a free Model Context Protocol server. Connect any MCP-aware AI assistant to query live Japan seasonal data.</p>
      <p><strong>Remote endpoint:</strong> <code>https://seasons.kooexperience.com/mcp</code></p>
      <p><strong>Or install locally:</strong> <code>npx japan-seasons-mcp</code></p>
      <p><a href="${SITE}/">View interactive map →</a> &middot; <a href="https://github.com/haomingkoo/japan-seasons-mcp" rel="noopener">GitHub</a></p>
    </section>`;
}

function renderBaseHtml(d: BasePageData): string {
  const allJsonLd = [renderBreadcrumbJsonLd(d.breadcrumb), ...d.jsonLd];
  const ogType = d.ogType ?? "article";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#e8466b">
  <title>${esc(d.title)}</title>
  <meta name="description" content="${esc(d.description)}">
  <meta name="author" content="Haoming Koo">
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
  <link rel="canonical" href="${esc(d.canonical)}">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌸</text></svg>">
  <meta property="og:type" content="${ogType}">
  <meta property="og:url" content="${esc(d.canonical)}">
  <meta property="og:title" content="${esc(d.title)}">
  <meta property="og:description" content="${esc(d.description)}">
  <meta property="og:image" content="${SITE}/og-image.png">
  <meta property="og:site_name" content="Japan in Seasons">
  <meta property="og:locale" content="en_US">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(d.title)}">
  <meta name="twitter:description" content="${esc(d.description)}">
  <meta name="twitter:image" content="${SITE}/og-image.png">
${allJsonLd.map(j => `  <script type="application/ld+json">${JSON.stringify(j)}</script>`).join("\n")}
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#262626;background:#fafafa;line-height:1.6}
    .top{background:#fff;border-bottom:1px solid #e5e5e5;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
    .top a.brand{color:#262626;text-decoration:none;font-weight:700;font-size:1.1rem}
    .top a.brand .by{font-size:0.7rem;color:#a3a3a3;font-weight:400;margin-left:8px}
    .top a.use-ai{color:#be185d;font-weight:600;text-decoration:none;font-size:0.9rem}
    .top a.use-ai:hover{text-decoration:underline}
    .wrap{max-width:780px;margin:0 auto;padding:32px 20px 60px}
    .crumbs{font-size:0.85rem;color:#525252;margin-bottom:20px}
    .crumbs a{color:#be185d;text-decoration:none}
    .crumbs a:hover{text-decoration:underline}
    .crumb-sep{margin:0 8px;color:#a3a3a3}
    h1{font-size:1.85rem;line-height:1.25;margin-bottom:6px;color:#262626}
    .subtitle{font-size:1rem;color:#525252;margin-bottom:24px}
    section{margin-bottom:32px}
    section h2{font-size:1.25rem;margin-bottom:10px;color:#262626}
    section h3{font-size:1rem;margin:18px 0 6px;color:#262626}
    section p{font-size:0.95rem;color:#525252;margin-bottom:10px}
    section ul{font-size:0.95rem;color:#525252;padding-left:22px;margin-bottom:10px}
    section li{margin-bottom:4px}
    section a{color:#be185d;text-decoration:none}
    section a:hover{text-decoration:underline}
    code{background:#f5f5f5;padding:2px 6px;border-radius:4px;font-size:0.88em}
    .meta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:14px 0;background:#fff;padding:16px;border:1px solid #e5e5e5;border-radius:10px}
    .meta-grid .label{font-size:0.72rem;color:#a3a3a3;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:2px}
    .meta-grid .value{font-size:0.95rem;color:#262626;font-weight:500}
    .cta{background:#fdf2f8;border:1px solid #fbcfe8;border-radius:10px;padding:18px 20px}
    .cta h2{color:#9d174d;margin-bottom:8px}
    .cta code{background:#fff}
    .spot-card{background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:14px 16px;margin-bottom:10px}
    .spot-card h3{margin-bottom:4px}
    .spot-card .sub{font-size:0.82rem;color:#a3a3a3}
    footer{max-width:780px;margin:0 auto;padding:24px 20px 40px;font-size:0.78rem;color:#a3a3a3}
    footer a{color:#525252}
    @media(max-width:600px){h1{font-size:1.5rem}.wrap{padding:24px 16px 48px}}
  </style>
</head>
<body>
  <header class="top">
    <a class="brand" href="${SITE}/">🌸 Japan in Seasons<span class="by">by Haoming Koo</span></a>
    <a class="use-ai" href="${SITE}/#install">🤖 Use in AI</a>
  </header>
  <main class="wrap">
    ${renderBreadcrumbHtml(d.breadcrumb)}
    ${d.bodyHtml}
    ${renderInstallSection()}
  </main>
  <footer>
    Live data sourced from <a href="https://n-kishou.com/" rel="noopener">Japan Meteorological Corporation</a>, <a href="https://www.jma.go.jp/" rel="noopener">Japan Meteorological Agency</a>, <a href="https://open-meteo.com/" rel="noopener">Open-Meteo</a>, and official tourism boards. Built by <a href="https://kooexperience.com" rel="noopener">Haoming Koo</a>. MIT licensed. <a href="https://github.com/haomingkoo/japan-seasons-mcp" rel="noopener">Source</a>.
  </footer>
</body>
</html>
`;
}

// ─── Festival page ──────────────────────────────────────────────────────────
const FESTIVAL_TYPE_LABEL: Record<string, string> = {
  fireworks: "Fireworks (Hanabi)",
  matsuri: "Matsuri (Festival)",
  winter: "Winter Event",
  illumination: "Illumination",
  snow: "Snow Festival",
};

const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function monthsToText(months?: number[]): string {
  if (!months || months.length === 0) return "Year-round";
  return months.map(m => MONTH_NAMES[m] ?? `Month ${m}`).join(", ");
}

export function renderFestivalPage(f: FestivalSpot): string {
  const typeLabel = FESTIVAL_TYPE_LABEL[f.type] ?? f.type;
  const months = monthsToText(f.months);
  const canonical = `${SITE}/festivals/${f.id}`;
  const title = `${f.name}${f.nameJa ? ` (${f.nameJa})` : ""} — ${typeLabel} in ${f.prefecture ?? "Japan"} | Japan in Seasons`;
  const description = `${f.name}: ${typeLabel.toLowerCase()} in ${f.prefecture ?? "Japan"}, ${f.region ?? ""}. Typically held ${f.typicalDate ?? months}. ${f.note ? f.note.slice(0, 120) : ""}`.trim().slice(0, 280);

  const eventLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: f.name,
    alternateName: f.nameJa,
    description: f.note ?? `${typeLabel} in ${f.prefecture ?? "Japan"}.`,
    eventSchedule: {
      "@type": "Schedule",
      repeatFrequency: "P1Y",
      byMonth: f.months,
    },
    location: {
      "@type": "Place",
      name: `${f.prefecture ?? "Japan"}${f.region ? `, ${f.region}` : ""}`,
      ...(f.lat && f.lon ? { geo: { "@type": "GeoCoordinates", latitude: f.lat, longitude: f.lon } } : {}),
    },
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    eventStatus: "https://schema.org/EventScheduled",
    organizer: { "@type": "Person", name: "Various", url: f.url },
    url: f.url ?? canonical,
    ...(f.attendance ? { maximumAttendeeCapacity: f.attendance } : {}),
  };

  const mapsUrl = f.lat && f.lon ? `https://www.google.com/maps/search/?api=1&query=${f.lat},${f.lon}` : null;

  const body = `
    <h1>${esc(f.name)}${f.nameJa ? ` <span style="font-weight:400;color:#525252">(${esc(f.nameJa)})</span>` : ""}</h1>
    <p class="subtitle">${esc(typeLabel)} · ${esc(f.prefecture ?? "Japan")}${f.region ? ` · ${esc(f.region)}` : ""}</p>

    <div class="meta-grid">
      <div><div class="label">When</div><div class="value">${esc(f.typicalDate ?? months)}</div></div>
      ${f.attendance ? `<div><div class="label">Typical attendance</div><div class="value">${esc(f.attendance.toLocaleString())} visitors</div></div>` : ""}
      ${mapsUrl ? `<div><div class="label">Location</div><div class="value"><a href="${mapsUrl}" rel="noopener">${esc(f.lat)}, ${esc(f.lon)} (Google Maps)</a></div></div>` : ""}
      ${f.url ? `<div><div class="label">Official site</div><div class="value"><a href="${esc(f.url)}" rel="noopener">Visit official page</a></div></div>` : ""}
    </div>

    ${f.note ? `<section><h2>About this event</h2><p>${esc(f.note)}</p></section>` : ""}

    <section>
      <h2>When to go</h2>
      <p>${esc(f.name)} typically takes place in <strong>${esc(months)}</strong>${f.typicalDate && !months.includes(f.typicalDate) ? ` (${esc(f.typicalDate)})` : ""}. Plan accommodation several months ahead for major festivals — popular events sell out quickly.</p>
    </section>

    <section>
      <h2>How to find it</h2>
      <ul>
        ${f.prefecture ? `<li><strong>Prefecture:</strong> ${esc(f.prefecture)}</li>` : ""}
        ${f.region ? `<li><strong>Region:</strong> ${esc(f.region)}</li>` : ""}
        ${mapsUrl ? `<li><strong>Coordinates:</strong> ${esc(f.lat)}, ${esc(f.lon)} — <a href="${mapsUrl}" rel="noopener">open in Google Maps</a></li>` : ""}
        ${f.url ? `<li><strong>Official site:</strong> <a href="${esc(f.url)}" rel="noopener">${esc(f.url)}</a></li>` : ""}
      </ul>
    </section>
  `;

  return renderBaseHtml({
    title,
    description,
    canonical,
    jsonLd: [eventLd],
    breadcrumb: [
      { name: "Home", url: `${SITE}/` },
      { name: "Festivals", url: `${SITE}/#festivals` },
      { name: f.name },
    ],
    bodyHtml: body,
    ogType: "event",
  });
}

// ─── Flower spot page ───────────────────────────────────────────────────────
const FLOWER_TYPE_LABEL: Record<string, string> = {
  plum: "Plum (Ume) Garden",
  wisteria: "Wisteria (Fuji)",
  hydrangea: "Hydrangea (Ajisai)",
  lavender: "Lavender",
  sunflower: "Sunflower",
  cosmos: "Cosmos",
  tulip: "Tulip",
  rose: "Rose",
};

function formatPeakDate(monthDay?: string): string {
  if (!monthDay) return "—";
  const [m, d] = monthDay.split("-").map(Number);
  if (!m || !d) return monthDay;
  return `${MONTH_NAMES[m]} ${d}`;
}

export function renderFlowerPage(f: FlowerSpot): string {
  const typeLabel = FLOWER_TYPE_LABEL[f.type] ?? f.type;
  const peakWindow = `${formatPeakDate(f.peakStart)} – ${formatPeakDate(f.peakEnd)}`;
  const canonical = `${SITE}/flowers/${f.id}`;
  const title = `${f.name}${f.nameJa ? ` (${f.nameJa})` : ""} — ${typeLabel} in ${f.prefecture ?? "Japan"} | Japan in Seasons`;
  const description = `${f.name}: ${typeLabel.toLowerCase()} in ${f.prefecture ?? "Japan"}. Peak viewing typically ${peakWindow}. ${f.note ? f.note.slice(0, 140) : ""}`.trim().slice(0, 280);

  const attractionLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "TouristAttraction",
    name: f.name,
    alternateName: f.nameJa,
    description: f.note ?? `${typeLabel} viewing spot in ${f.prefecture ?? "Japan"}.`,
    address: { "@type": "PostalAddress", addressCountry: "JP", addressRegion: f.prefecture },
    ...(f.lat && f.lon ? { geo: { "@type": "GeoCoordinates", latitude: f.lat, longitude: f.lon } } : {}),
    touristType: typeLabel,
    url: f.url ?? canonical,
  };

  const mapsUrl = f.lat && f.lon ? `https://www.google.com/maps/search/?api=1&query=${f.lat},${f.lon}` : null;

  const body = `
    <h1>${esc(f.name)}${f.nameJa ? ` <span style="font-weight:400;color:#525252">(${esc(f.nameJa)})</span>` : ""}</h1>
    <p class="subtitle">${esc(typeLabel)} · ${esc(f.prefecture ?? "Japan")}${f.region ? ` · ${esc(f.region)}` : ""}</p>

    <div class="meta-grid">
      <div><div class="label">Peak window</div><div class="value">${esc(peakWindow)}</div></div>
      ${mapsUrl ? `<div><div class="label">Location</div><div class="value"><a href="${mapsUrl}" rel="noopener">${esc(f.lat)}, ${esc(f.lon)}</a></div></div>` : ""}
      ${f.url ? `<div><div class="label">Official site</div><div class="value"><a href="${esc(f.url)}" rel="noopener">Visit official page</a></div></div>` : ""}
    </div>

    ${f.note ? `<section><h2>About this spot</h2><p>${esc(f.note)}</p></section>` : ""}

    <section>
      <h2>When to visit</h2>
      <p>The peak viewing window for ${esc(f.name)} typically runs from <strong>${esc(formatPeakDate(f.peakStart))}</strong> to <strong>${esc(formatPeakDate(f.peakEnd))}</strong> each year. Exact peak shifts a few days year-to-year with temperature; check the live map before booking.</p>
    </section>

    <section>
      <h2>How to find it</h2>
      <ul>
        ${f.prefecture ? `<li><strong>Prefecture:</strong> ${esc(f.prefecture)}</li>` : ""}
        ${f.region ? `<li><strong>Region:</strong> ${esc(f.region)}</li>` : ""}
        ${mapsUrl ? `<li><strong>Coordinates:</strong> ${esc(f.lat)}, ${esc(f.lon)} — <a href="${mapsUrl}" rel="noopener">open in Google Maps</a></li>` : ""}
        ${f.url ? `<li><strong>Official site:</strong> <a href="${esc(f.url)}" rel="noopener">${esc(f.url)}</a></li>` : ""}
      </ul>
    </section>
  `;

  return renderBaseHtml({
    title,
    description,
    canonical,
    jsonLd: [attractionLd],
    breadcrumb: [
      { name: "Home", url: `${SITE}/` },
      { name: "Flowers", url: `${SITE}/#flowers` },
      { name: f.name },
    ],
    bodyHtml: body,
    ogType: "article",
  });
}

// ─── Sakura prefecture page ─────────────────────────────────────────────────
export function renderSakuraPrefecturePage(pref: Prefecture, spots: SakuraSpotForPage[]): string {
  const canonical = `${SITE}/sakura/${pref.slug}`;
  const title = `Cherry Blossoms in ${pref.name}, Japan — Live Sakura Forecast & ${spots.length}+ Viewing Spots | Japan in Seasons`;
  const description = `Live cherry blossom (sakura) forecast and ${spots.length}+ viewing spots in ${pref.name} prefecture, ${pref.region}, Japan. Sourced from Japan Meteorological Corporation. Updated daily.`.slice(0, 280);

  // Sort spots: peak first, then by name
  const sortedSpots = [...spots].sort((a, b) => {
    const aRate = a.fullRate ?? 0;
    const bRate = b.fullRate ?? 0;
    if (aRate !== bRate) return bRate - aRate;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
  const topSpots = sortedSpots.slice(0, 30);

  const itemListLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Cherry Blossom Viewing Spots in ${pref.name}, Japan`,
    description,
    numberOfItems: spots.length,
    itemListElement: topSpots.map((s, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "TouristAttraction",
        name: s.name ?? s.nameRomaji ?? "Sakura spot",
        ...(s.lat && s.lon ? { geo: { "@type": "GeoCoordinates", latitude: s.lat, longitude: s.lon } } : {}),
        address: { "@type": "PostalAddress", addressCountry: "JP", addressRegion: pref.name },
      },
    })),
  };

  const spotCardsHtml = topSpots
    .map(s => {
      const rateLine = s.fullRate != null && s.fullRate > 0
        ? `Full bloom: ${s.fullRate}%`
        : s.bloomRate != null && s.bloomRate > 0
          ? `Bloom: ${s.bloomRate}%`
          : "";
      const status = s.displayStatus ?? s.status ?? "";
      const mapsUrl = s.lat && s.lon ? `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}` : null;
      return `<div class="spot-card">
        <h3>${esc(s.name ?? s.nameRomaji ?? "Sakura spot")}</h3>
        <div class="sub">${esc(rateLine)}${status ? ` · ${esc(status)}` : ""}</div>
        ${mapsUrl ? `<div class="sub"><a href="${mapsUrl}" rel="noopener">📍 ${esc(s.lat)}, ${esc(s.lon)}</a></div>` : ""}
      </div>`;
    })
    .join("");

  const peakCount = spots.filter(s => (s.fullRate ?? 0) >= 90).length;
  const bloomingCount = spots.filter(s => (s.bloomRate ?? 0) > 0 && (s.fullRate ?? 0) < 90).length;

  const body = `
    <h1>Cherry Blossoms in ${esc(pref.name)}, Japan</h1>
    <p class="subtitle">Live sakura forecast for ${esc(pref.name)} prefecture · ${esc(pref.region)} region · ${spots.length} tracked viewing spots</p>

    <div class="meta-grid">
      <div><div class="label">Total viewing spots</div><div class="value">${spots.length}</div></div>
      <div><div class="label">At full bloom now</div><div class="value">${peakCount}</div></div>
      <div><div class="label">Currently blooming</div><div class="value">${bloomingCount}</div></div>
      <div><div class="label">Region</div><div class="value">${esc(pref.region)}</div></div>
    </div>

    <section>
      <h2>About cherry blossoms in ${esc(pref.name)}</h2>
      <p>${esc(pref.name)} prefecture is part of Japan's <strong>${esc(pref.region)}</strong> region. Cherry blossom timing across Japan progresses with latitude — Kyushu and Okinawa bloom first in mid-to-late March, the Kanto and Kansai regions (including Tokyo and Kyoto) around late March to early April, and Tohoku and Hokkaido in late April to early May. Full bloom (mankai) typically follows first bloom by 5 to 7 days, and the peak viewing window lasts roughly 5 to 10 days before petals fall.</p>
      <p>This page lists ${spots.length} sakura viewing spots in ${esc(pref.name)} tracked by Japan in Seasons, sourced from <a href="https://n-kishou.com/" rel="noopener">Japan Meteorological Corporation</a>. Bloom and full-bloom rates use the official JMC scale (0–100%), where 90–100% indicates mankai (peak bloom).</p>
    </section>

    <section>
      <h2>Top sakura viewing spots in ${esc(pref.name)}</h2>
      <p>Showing the top ${topSpots.length} of ${spots.length} tracked spots, sorted by current bloom progress.</p>
      ${spotCardsHtml || `<p>Spot data is loading. Try the <a href="${SITE}/">interactive map</a> for the latest list.</p>`}
    </section>

    <section>
      <h2>Frequently asked questions</h2>
      <h3>When do cherry blossoms bloom in ${esc(pref.name)}?</h3>
      <p>Bloom timing depends on the prefecture's latitude. ${pref.region === "Okinawa" ? "Okinawa blooms earliest, typically mid-to-late January (with Kanhi-zakura, a different variety than mainland Somei Yoshino)." : pref.region === "Kyushu" ? "Kyushu prefectures bloom in mid-to-late March." : pref.region === "Hokkaido" ? "Hokkaido blooms latest, typically late April to early May." : pref.region === "Tohoku" ? "Tohoku blooms in mid-to-late April." : "Most spots bloom in late March to early April."}</p>
      <h3>What is full bloom (mankai)?</h3>
      <p>Mankai is the peak viewing window when 80%+ of flowers on a tree have opened. The JMC full-bloom rate scale measures this — a value of 90–100% indicates mankai. Best viewing is the 3 to 7 days around mankai before petals start to fall.</p>
      <h3>How accurate is this forecast?</h3>
      <p>Forecasts are sourced from Japan Meteorological Corporation, updated weekly from January through May, and are typically accurate to within 1 to 3 days of actual bloom.</p>
    </section>

    <section>
      <h2>Plan your trip</h2>
      <ul>
        <li><a href="${SITE}/">Open the live interactive map</a> to see real-time bloom status across all prefectures</li>
        <li>Combine with <a href="${SITE}/#install">our free MCP server</a> to ask Claude or ChatGPT for trip recommendations</li>
        <li>Source: <a href="https://n-kishou.com/" rel="noopener">Japan Meteorological Corporation</a></li>
      </ul>
    </section>
  `;

  return renderBaseHtml({
    title,
    description,
    canonical,
    jsonLd: [itemListLd],
    breadcrumb: [
      { name: "Home", url: `${SITE}/` },
      { name: "Sakura forecast", url: `${SITE}/#sakura` },
      { name: pref.name },
    ],
    bodyHtml: body,
    ogType: "website",
  });
}

// ─── Sitemap entries ────────────────────────────────────────────────────────
export interface SitemapEntry {
  loc: string;
  lastmod: string;
  changefreq?: "daily" | "weekly" | "monthly" | "yearly";
  priority?: number;
}

export function getProgrammaticSitemapEntries(
  festivals: FestivalSpot[],
  flowers: FlowerSpot[],
  today: string,
): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  for (const p of PREFECTURES) {
    entries.push({ loc: `${SITE}/sakura/${p.slug}`, lastmod: today, changefreq: "daily", priority: 0.8 });
  }
  for (const f of festivals) {
    entries.push({ loc: `${SITE}/festivals/${f.id}`, lastmod: today, changefreq: "monthly", priority: 0.7 });
  }
  for (const f of flowers) {
    entries.push({ loc: `${SITE}/flowers/${f.id}`, lastmod: today, changefreq: "monthly", priority: 0.7 });
  }
  return entries;
}
