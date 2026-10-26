#!/usr/bin/env node
// Reads each farm's opening period from its Jalan page and writes public/fruit-farm-seasons.json.
// Incremental: farms checked within REFRESH_DAYS are kept as they are.
// Usage: node scripts/scrape-farm-seasons.mjs [--limit N] [--force] [--reparse]
// --reparse re-reads the stored period text with the current parser and fetches nothing.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseSeasonWindows } from '../almanac/farm-season.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FARMS = join(root, 'public', 'fruit-farms.json');
const OUT = join(root, 'public', 'fruit-farm-seasons.json');
const REFRESH_DAYS = 45;
const CONCURRENCY = 2;
const PAUSE_MS = 600;
const UA = 'Mozilla/5.0 (compatible; JapanInSeasons/1.0; +https://seasons.kooexperience.com)';

const args = process.argv.slice(2);
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const force = args.includes('--force');

const farms = JSON.parse(readFileSync(FARMS, 'utf8')).spots;
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { farms: {} };
const out = { ...prev.farms };
const cutoff = Date.now() - REFRESH_DAYS * 86400000;
const todo = farms.filter((f) => force || !out[f.id] || Date.parse(out[f.id].checked) < cutoff).slice(0, limit);
const sjis = new TextDecoder('shift_jis');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function periodText(html) {
  const m = /<th>\s*営業期間\s*<\/th>\s*<td>([\s\S]*?)<\/td>/.exec(html);
  if (!m) return '';
  return m[1].replace(/<br\s*\/?>/gi, ' / ').replace(/<[^>]+>/g, ' ').replace(/&#12316;/g, '～').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').replace(/( \/ )+/g, ' / ').replace(/^ \/ | \/ $/g, '').trim();
}

let done = 0;
let failed = 0;
async function worker(queue) {
  while (queue.length) {
    const farm = queue.shift();
    try {
      const res = await fetch(farm.url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja' } });
      if (res.status === 404 || res.status === 410) {
        out[farm.id] = { checked: new Date().toISOString(), period: '', windows: [] };
      } else if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      } else {
        const period = periodText(sjis.decode(await res.arrayBuffer())).slice(0, 400);
        out[farm.id] = { checked: new Date().toISOString(), period, windows: parseSeasonWindows(period) };
      }
    } catch (e) {
      failed++;
      if (res403(e)) { console.error('Blocked by Jalan, stopping early.'); queue.length = 0; }
    }
    done++;
    if (done % 100 === 0) { console.log(`${done}/${todo.length}`); save(); }
    await sleep(PAUSE_MS);
  }
}
const res403 = (e) => /HTTP (403|429)/.test(String(e?.message));

function save(updated = new Date().toISOString()) {
  const ids = new Set(farms.map((f) => f.id));
  const kept = Object.fromEntries(Object.entries(out).filter(([id]) => ids.has(id)).sort());
  const withWindows = Object.values(kept).filter((r) => r.windows.length).length;
  writeFileSync(OUT, JSON.stringify({
    source: 'Jalan farm pages, 営業期間 (opening period)',
    updated,
    checked: Object.keys(kept).length,
    with_windows: withWindows,
    farms: kept,
  }, null, 0) + '\n');
}

if (args.includes('--reparse')) {
  for (const r of Object.values(out)) r.windows = parseSeasonWindows(r.period);
  save(prev.updated);
  console.log('Re-parsed stored periods');
  process.exit(0);
}

console.log(`Checking ${todo.length} of ${farms.length} farms`);
const queue = todo.slice();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
save();
console.log(`Done: ${done} checked, ${failed} failed`);
if (todo.length && failed / todo.length > 0.2) process.exit(1);
