"""
Jalan.net fruit picking spots → public/jalan-farms.json
608 spots, coordinates from data-lat/data-lng on listing pages.
Pagination: /page_N/ appended to base URL (30/page → ~21 pages)
Run: python3 scrape-jalan.py
"""
import json, time, re
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright

BASE = "https://www.jalan.net"
SEARCH = f"{BASE}/kankou/kw_%89%CA%8E%F7/"
PARAMS = "?rootCd=7741&screenId=OUW1121&exLrgGenreCd=01&ifWordFlg=2"

FRUIT_KEYWORDS = {
    "Strawberry":       ["strawberry", "いちご", "苺"],
    "Cherry":           ["cherry", "さくらんぼ", "サクランボ"],
    "Blueberry":        ["blueberry", "ブルーベリー"],
    "Peach":            ["peach", "もも", "桃"],
    "Melon":            ["melon", "メロン"],
    "Watermelon":       ["watermelon", "すいか", "スイカ", "西瓜"],
    "Grape":            ["grape", "ぶどう", "葡萄", "マスカット"],
    "Japanese Pear":    ["pear", "なし", "梨"],
    "Apple":            ["apple", "りんご", "リンゴ", "林檎"],
    "Mandarin Orange":  ["mandarin", "mikan", "みかん", "蜜柑", "orange", "柑橘"],
    "Chestnut":         ["chestnut", "くり", "栗"],
    "Persimmon":        ["persimmon", "かき", "柿"],
    "Kiwi":             ["kiwi", "キウイ"],
    "Fig":              ["fig", "いちじく", "無花果"],
    "Loquat":           ["loquat", "びわ", "枇杷"],
    "Plum":             ["plum", "うめ", "梅"],
    "Yuzu":             ["yuzu", "ゆず", "柚子"],
}

def detect_fruits(text):
    return [f for f, kws in FRUIT_KEYWORDS.items() if any(k in text for k in kws)]

def scrape_page(page):
    spots = []
    items = page.query_selector_all("li.item")
    for item in items:
        try:
            lat_str = item.get_attribute("data-lat") or ""
            lng_str = item.get_attribute("data-lng") or ""

            # Find name link — skip photo/review links (empty text or kuchikomi)
            link = None
            href = ""
            name = ""
            for lnk in item.query_selector_all("a[href*='spt_guide']"):
                txt = lnk.inner_text().strip()
                h = lnk.get_attribute("href") or ""
                if txt and "口コミ" not in txt and "kuchikomi" not in h:
                    link = lnk
                    href = h
                    name = txt
                    break
            if not name:
                continue

            spot_url = href if href.startswith("http") else BASE + href
            m = re.search(r"spt_guide(\d+)", href)
            spot_id = m.group(1) if m else None

            addr_el = item.query_selector(".item-address, [class*='address']")
            address = addr_el.inner_text().strip() if addr_el else ""

            text = item.inner_text()
            fruits = detect_fruits(text)

            spots.append({
                "id": f"jalan_{spot_id}" if spot_id else None,
                "name": name,
                "address": address,
                "fruits": fruits,
                "url": spot_url,
                "lat": round(float(lat_str), 6) if lat_str else None,
                "lon": round(float(lng_str), 6) if lng_str else None,
                "source": "jalan",
            })
        except Exception:
            continue
    return spots

def run():
    all_spots = []
    scraped_at = datetime.now(timezone.utc).isoformat()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        )
        page = ctx.new_page()
        page.set_default_timeout(20000)

        # Get page 1 and total count
        page.goto(SEARCH + PARAMS, timeout=20000)
        page.wait_for_timeout(2000)

        body_text = page.inner_text("body")
        total_m = re.search(r"全(\d+)件", body_text)
        total = int(total_m.group(1)) if total_m else 608
        last_page = (total + 29) // 30
        print(f"Total: {total} spots, {last_page} pages")

        spots = scrape_page(page)
        all_spots.extend(spots)
        print(f"  Page 1/{last_page}: {len(spots)} spots (total: {len(all_spots)})", flush=True)

        for pg in range(2, last_page + 1):
            url = f"{SEARCH}page_{pg}/{PARAMS}"
            try:
                page.goto(url, timeout=15000)
                page.wait_for_timeout(1000)
                spots = scrape_page(page)
                all_spots.extend(spots)
                print(f"  Page {pg}/{last_page}: {len(spots)} spots (total: {len(all_spots)})", flush=True)
            except Exception as e:
                print(f"  Page {pg}: ERROR — {e}", flush=True)
            time.sleep(0.5)

        browser.close()

    with_coords = sum(1 for s in all_spots if s["lat"])
    print(f"\nDone: {len(all_spots)} spots, {with_coords} with coordinates")

    # Merge with existing Navitime data (keep all, tag source)
    existing = []
    try:
        with open("public/fruit-farms.json", encoding="utf-8") as f:
            old = json.load(f)
            existing = [s for s in old.get("spots", []) if s.get("source") != "jalan"]
            print(f"Keeping {len(existing)} existing non-Jalan spots")
    except FileNotFoundError:
        pass

    merged = existing + all_spots
    total_coords = sum(1 for s in merged if s.get("lat"))

    output = {
        "scraped_at": scraped_at,
        "sources": ["Jalan.net", "Japan Travel by NAVITIME"],
        "source_url": SEARCH,
        "total": len(merged),
        "with_coords": total_coords,
        "spots": merged,
    }
    out = "public/fruit-farms.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"Saved {len(merged)} total spots to {out}")

if __name__ == "__main__":
    run()
