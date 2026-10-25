#!/usr/bin/env node
// Builds explore/season-history.json from public records. Run by hand once a season:
//   node scripts/build-season-history.mjs
// Sources (all fetched here, never by the browser):
// - JMA phenological observation tables (生物季節観測累年値, CSV), Government of Japan
//   Standard Terms of Use: cherry first bloom (004), full bloom (005), maple colouring (015).
// - JMA current-season cherry pages (sakura_kaika.html, sakura_mankai.html), for this year.
// - Kyoto full-bloom series since 812 (Aono and Kazui 2008, Aono and Saito 2010, Aono 2012,
//   Katata 2026), CC BY 4.0, via Our World in Data.
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "explore", "season-history.json");
const JMA = "https://www.data.jma.go.jp/sakura/data";
const OWID = "https://ourworldindata.org/grapher/date-of-the-peak-cherry-tree-blossom-in-kyoto.csv?v=1&csvType=full&useColumnShortNames=true";

// JMA station (last 3 digits of the WMO number) -> English name used by the app, with coordinates.
const STATIONS = {
  401: ["Wakkanai", 45.415, 141.679], 407: ["Asahikawa", 43.757, 142.372], 409: ["Abashiri", 44.017, 144.28],
  412: ["Sapporo", 43.06, 141.329], 417: ["Obihiro", 42.922, 143.212], 418: ["Kushiro", 42.985, 144.377],
  423: ["Muroran", 42.31, 140.974], 430: ["Hakodate", 41.817, 140.753], 575: ["Aomori", 40.822, 140.769],
  582: ["Akita", 39.717, 140.1], 584: ["Morioka", 39.698, 141.165], 588: ["Yamagata", 38.255, 140.345],
  590: ["Sendai", 38.262, 140.897], 595: ["Fukushima", 37.758, 140.47], 604: ["Niigata", 37.893, 139.018],
  605: ["Kanazawa", 36.588, 136.633], 607: ["Toyama", 36.708, 137.202], 610: ["Nagano", 36.662, 138.192],
  615: ["Utsunomiya", 36.548, 139.868], 616: ["Fukui", 36.055, 136.222], 624: ["Maebashi", 36.405, 139.06],
  626: ["Kumagaya", 36.15, 139.38], 629: ["Mito", 36.38, 140.467], 632: ["Gifu", 35.4, 136.762],
  636: ["Nagoya", 35.167, 136.965], 638: ["Kofu", 35.667, 138.553], 648: ["Choshi", 35.738, 140.857],
  651: ["Tsu", 34.733, 136.518], 656: ["Shizuoka", 34.975, 138.403], 662: ["Tokyo", 35.692, 139.75],
  670: ["Yokohama", 35.438, 139.652], 741: ["Matsue", 35.457, 133.067], 746: ["Tottori", 35.487, 134.238],
  759: ["Kyoto", 35.013, 135.732], 761: ["Hikone", 35.275, 136.243], 762: ["Shimonoseki", 33.948, 130.925],
  765: ["Hiroshima", 34.398, 132.462], 768: ["Okayama", 34.66, 133.917], 770: ["Kobe", 34.697, 135.212],
  772: ["Osaka", 34.682, 135.518], 777: ["Wakayama", 34.228, 135.163], 780: ["Nara", 34.693, 135.827],
  807: ["Fukuoka", 33.582, 130.375], 813: ["Saga", 33.265, 130.305], 815: ["Oita", 33.235, 131.618],
  817: ["Nagasaki", 32.733, 129.867], 819: ["Kumamoto", 32.813, 130.707], 827: ["Kagoshima", 31.553, 130.548],
  830: ["Miyazaki", 31.938, 131.413], 887: ["Matsuyama", 33.843, 132.777], 891: ["Takamatsu", 34.317, 134.053],
  893: ["Kochi", 33.567, 133.548], 895: ["Tokushima", 34.067, 134.573], 909: ["Naze", 28.378, 129.495],
  918: ["Ishigaki", 24.337, 124.163], 927: ["Miyakojima", 24.79, 125.278], 936: ["Naha", 26.207, 127.688],
  945: ["Minamidaito", 25.828, 131.23],
};
const BY_JA = {};

async function text(url, encoding = "utf-8") {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return new TextDecoder(encoding).decode(await res.arrayBuffer());
}

// Day of year (Jan 1 = 1). A December date before a spring event counts as the previous year,
// so it comes out as zero or negative.
function doy(year, month, day, springEvent) {
  const y = springEvent && month >= 10 ? year - 1 : year;
  return Math.round((Date.UTC(y, month - 1, day) - Date.UTC(year, 0, 1)) / 86400000) + 1;
}

// One JMA table: { [english]: { years: { [year]: doy }, substitute: [years using a stand-in species], normal } }
async function table(no, springEvent) {
  const rows = (await text(`${JMA}/ruinenchi/${String(no).padStart(3, "0")}.csv`, "shift_jis"))
    .trim().split(/\r?\n/).map((l) => l.split(","));
  const head = rows[1];
  const normalAt = head.indexOf("平年値");
  const result = {};
  for (const r of rows.slice(2)) {
    const st = STATIONS[Number(r[0])];
    if (!st) continue;
    BY_JA[r[1].replace(/[\s　]/g, "")] = Number(r[0]);
    const years = {};
    const substitute = [];
    for (let i = 2; i < normalAt; i += 2) {
      const year = Number(head[i]);
      const v = Number(r[i]);
      const rm = Number(r[i + 1]);
      // 0 means missing; remarks 3 and 4 are excluded from JMA's own statistics.
      if (!year || !v || rm === 3 || rm === 4) continue;
      years[year] = doy(year, Math.floor(v / 100), v % 100, springEvent);
      if (rm === 6 || rm === 7) substitute.push(year);
    }
    const nv = Number(r[normalAt]);
    result[st[0]] = { years, substitute, normal: nv ? doy(2021, Math.floor(nv / 100), nv % 100, springEvent) : null };
  }
  return result;
}

// This season's JMA cherry observations, published Dec to Jun.
async function currentSeason(page) {
  const html = await text(`${JMA}/${page}`);
  const year = Number((/(\d{4})年のさくら/.exec(html) || [])[1]);
  const rows = {};
  const re = /<th scope='row'>([^<]+)<\/th>\s*<td[^>]*>\s*(\d+)月\s*(\d+)日<\/td>[\s\S]*?<td>([^<]*)<\/td>\s*<\/tr>/g;
  for (let m; (m = re.exec(html));) {
    const no = BY_JA[m[1].replace(/[\s　]/g, "")];
    if (!no) continue;
    rows[STATIONS[no][0]] = { doy: doy(year, Number(m[2]), Number(m[3]), true), species: m[4].trim() || "somei-yoshino" };
  }
  return { year, rows };
}

const SPECIES_EN = { "ひかんざくら": "Taiwan cherry (hikanzakura)", "えぞやまざくら": "Sargent cherry (ezo-yamazakura)", "somei-yoshino": "Yoshino cherry (somei-yoshino)" };

const bloom = await table(4, true);
const full = await table(5, true);
const maple = await table(15, false);
const now = await currentSeason("sakura_kaika.html");
const nowFull = await currentSeason("sakura_mankai.html");
for (const [name, r] of Object.entries(now.rows)) {
  bloom[name].years[now.year] = r.doy;
  if (r.species !== "somei-yoshino") bloom[name].substitute.push(now.year);
  bloom[name].species = SPECIES_EN[r.species] || r.species;
}
for (const [name, r] of Object.entries(nowFull.rows)) full[name].years[nowFull.year] = r.doy;

const kyoto = (await text(OWID)).trim().split(/\r?\n/).slice(1).map((l) => l.split(","))
  .map(([, , year, d, avg]) => [Number(year), Number(d), avg ? Math.round(Number(avg) * 10) / 10 : null])
  .filter(([y, d]) => y && d);

// Compact form: one array per station, index 0 = FIRST_YEAR, null where JMA has no value.
const FIRST_YEAR = 1953;
function compact(t) {
  return Object.fromEntries(Object.entries(t).map(([name, v]) => {
    const values = [];
    for (let y = FIRST_YEAR; y <= now.year; y++) values.push(v.years[y] ?? null);
    while (values.length && values[values.length - 1] == null) values.pop();
    return [name, { values, substitute: v.substitute, normal: v.normal, ...(v.species ? { species: v.species } : {}) }];
  }));
}

const stations = Object.fromEntries(Object.values(STATIONS).map(([n, lat, lon]) => [n, [lat, lon]]));
writeFileSync(out, JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  currentYear: now.year,
  firstYear: FIRST_YEAR,
  sources: {
    jma: "Japan Meteorological Agency, phenological observation tables (https://www.data.jma.go.jp/sakura/data/), Government of Japan Standard Terms of Use",
    kyoto: "Aono and Kazui (2008), Aono and Saito (2010), Aono (2012), Katata (2026), via Our World in Data, CC BY 4.0",
  },
  stations,
  sakuraBloom: compact(bloom),
  sakuraFull: compact(full),
  mapleColour: compact(maple),
  kyotoFullBloom: kyoto,
}));
console.log(`Wrote ${out}: ${Object.keys(bloom).length} cherry stations, ${Object.keys(now.rows).length} this season, ${kyoto.length} Kyoto years`);
