"""
Jalan.net fruit-picking farms → public/fruit-farms.json
One keyword search per picking term (coordinates are only on search pages, as
data-lat/data-lng), deduped by spot id and kept only when Jalan files the spot
under a fruit-picking genre. Exits non-zero, without writing, on an incomplete scrape.
Run from the repository root: python3 scripts/scrape-jalan.py
Weekly refresh: .github/workflows/scrape-fruit-farms.yml
"""
from __future__ import annotations

import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from playwright.sync_api import Page, sync_playwright

BASE = "https://www.jalan.net"
PARAMS = "?rootCd=7741&screenId=OUW1121&exLrgGenreCd=01&ifWordFlg=2"
OUT = Path("public/fruit-farms.json")
PER_PAGE = 30
MIN_FARMS = 1500           # 2,121 on 2026-10-25
MIN_RATIO_VS_PREVIOUS = 0.8
MIN_COORD_RATIO = 0.9
MIN_QUERY_COMPLETENESS = 0.95

# Search keyword → fruit credited to "other fruit/veg picking" spots that match it.
QUERIES = {
    "いちご狩り": "Strawberry", "さくらんぼ狩り": "Cherry", "ぶどう狩り": "Grape",
    "ブルーベリー狩り": "Blueberry", "みかん狩り": "Mandarin Orange", "りんご狩り": "Apple",
    "桃狩り": "Peach", "梨狩り": "Japanese Pear", "メロン狩り": "Melon", "柿狩り": "Persimmon",
    "栗拾い": "Chestnut", "果物狩り": None, "フルーツ狩り": None,
}
OTHER_PICKING = "その他果物・野菜狩り"

# Jalan genre → fruit. "Other fruit/veg picking" has no fruit of its own.
PICKING_GENRES = {
    "いちご狩り": "Strawberry", "さくらんぼ狩り": "Cherry", "ぶどう狩り": "Grape",
    "プラム狩り": "Plum", "ブルーベリー狩り": "Blueberry", "みかん狩り": "Mandarin Orange",
    "りんご狩り": "Apple", "桃狩り": "Peach", "梨狩り": "Japanese Pear",
    OTHER_PICKING: None,
}

# Matched against the spot name and genre list only; short hiragana like くり/かき/なし are too ambiguous.
FRUIT_KEYWORDS = {
    "Strawberry": ["いちご", "イチゴ", "苺"],
    "Cherry": ["さくらんぼ", "サクランボ"],
    "Blueberry": ["ブルーベリー"],
    "Peach": ["桃"],
    "Melon": ["メロン"],
    "Watermelon": ["スイカ", "すいか", "西瓜"],
    "Grape": ["ぶどう", "ブドウ", "葡萄", "マスカット"],
    "Japanese Pear": ["梨"],
    "Apple": ["りんご", "リンゴ", "林檎"],
    "Mandarin Orange": ["みかん", "ミカン", "蜜柑", "柑橘"],
    "Chestnut": ["栗"],
    "Persimmon": ["柿"],
    "Kiwi": ["キウイ"],
    "Fig": ["いちじく", "イチジク", "無花果"],
    "Loquat": ["びわ", "ビワ", "枇杷"],
    "Plum": ["プラム"],
    "Yuzu": ["ゆず", "柚子"],
}


class IncompleteScrape(RuntimeError):
    pass


def query_url(keyword: str, page_no: int) -> str:
    kw = quote(keyword.encode("cp932"))
    suffix = f"page_{page_no}/" if page_no > 1 else ""
    return f"{BASE}/kankou/kw_{kw}/{suffix}{PARAMS}"


EXTRACT_ITEMS_JS = """() => [...document.querySelectorAll('li.item[data-lat]')].map(li => {
    const a = li.querySelector('.item-name a');
    return {
        href: a ? a.getAttribute('href') : null,
        name: a ? a.textContent.trim() : '',
        cats: li.querySelector('.item-categories')?.textContent.trim() || '',
        address: li.querySelector('[class*="address"]')?.textContent.trim() || '',
        lat: li.dataset.lat, lng: li.dataset.lng,
    };
})"""


def parse_item(raw: dict, query_fruit: str | None) -> dict | None:
    href = raw["href"]
    if href is None:
        raise IncompleteScrape("listing item without .item-name link: page layout changed")
    m = re.search(r"/kankou/spt_(?:guide)?([0-9a-zA-Z]+)/", href)
    if not m:
        return None  # theme/feature pages mixed into results, not spots
    genres = [g.strip() for g in raw["cats"].split("／", 1)[-1].split("、")]
    picking = [g for g in genres if g in PICKING_GENRES]
    if not picking:
        return None
    text = raw["name"] + " " + " ".join(genres)
    fruits = {PICKING_GENRES[g] for g in picking if PICKING_GENRES[g]}
    fruits |= {f for f, kws in FRUIT_KEYWORDS.items() if any(k in text for k in kws)}
    if query_fruit and OTHER_PICKING in picking:
        fruits.add(query_fruit)
    return {
        "id": f"jalan_{m.group(1)}",
        "name": raw["name"],
        "address": raw["address"],
        "fruits": sorted(fruits, key=list(FRUIT_KEYWORDS).index),
        "url": f"{BASE}/kankou/spt_{href.split('/kankou/spt_', 1)[1]}",
        "lat": round(float(raw["lat"]), 6) if raw["lat"] else None,
        "lon": round(float(raw["lng"]), 6) if raw["lng"] else None,
        "source": "jalan",
    }


def scrape_query(page: Page, keyword: str, farms: dict[str, dict]) -> None:
    query_fruit = QUERIES[keyword]
    page.goto(query_url(keyword, 1), wait_until="domcontentloaded")
    m = re.search(r"全([\d,]+)件", page.inner_text("body"))
    if not m:
        raise IncompleteScrape(f"{keyword}: no result count on page 1 (blocked or layout changed)")
    expected = int(m.group(1).replace(",", ""))
    last_page = (expected + PER_PAGE - 1) // PER_PAGE
    seen = 0
    for pg in range(1, last_page + 1):
        if pg > 1:
            time.sleep(0.5)
            page.goto(query_url(keyword, pg), wait_until="domcontentloaded")
        items = page.evaluate(EXTRACT_ITEMS_JS)
        seen += len(items)
        for item in items:
            spot = parse_item(item, query_fruit)
            if spot and spot["id"] in farms:
                known = farms[spot["id"]]
                known["fruits"] = sorted(set(known["fruits"]) | set(spot["fruits"]), key=list(FRUIT_KEYWORDS).index)
            elif spot:
                farms[spot["id"]] = spot
    print(f"  {keyword}: {seen}/{expected} listings over {last_page} pages, {len(farms)} farms so far", flush=True)
    if seen < expected * MIN_QUERY_COMPLETENESS:
        raise IncompleteScrape(f"{keyword}: parsed {seen} of {expected} listings")


def validate(spots: list[dict]) -> None:
    previous = json.loads(OUT.read_text(encoding="utf-8")).get("total", 0) if OUT.exists() else 0
    with_coords = sum(1 for s in spots if s["lat"])
    floor = max(MIN_FARMS, int(previous * MIN_RATIO_VS_PREVIOUS))
    if len(spots) < floor:
        raise IncompleteScrape(f"{len(spots)} farms, below floor {floor} (previous file had {previous})")
    if with_coords < len(spots) * MIN_COORD_RATIO:
        raise IncompleteScrape(f"only {with_coords}/{len(spots)} farms have coordinates")


def run() -> None:
    scraped_at = datetime.now(timezone.utc).isoformat()
    farms: dict[str, dict] = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        page.set_default_timeout(30000)
        for keyword in QUERIES:
            scrape_query(page, keyword, farms)
        browser.close()

    spots = sorted(farms.values(), key=lambda s: s["id"])
    validate(spots)
    output = {
        "scraped_at": scraped_at,
        "sources": ["Jalan.net"],
        "source_url": f"{BASE}/kankou/",
        "total": len(spots),
        "with_coords": sum(1 for s in spots if s["lat"]),
        "spots": spots,
    }
    OUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved {output['total']} farms ({output['with_coords']} with coordinates) to {OUT}")


if __name__ == "__main__":
    try:
        run()
    except IncompleteScrape as e:
        sys.exit(f"ERROR: incomplete scrape, {OUT} left unchanged: {e}")
