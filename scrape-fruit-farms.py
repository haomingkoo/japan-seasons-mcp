"""
Full scraper: Navitime fruit-picking spots → public/fruit-farms.json
Paginates via ?page=N (48 pages × 30 = 1,440 spots).
Then visits each spot page for lat/lon from JSON-LD or meta tags.
Run: python3 scrape-fruit-farms.py
Output: public/fruit-farms.json
Weekly refresh: .github/workflows/scrape-fruit-farms.yml
"""
import json, time, re, sys
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright

BASE = "https://japantravel.navitime.com"
LIST_BASE = f"{BASE}/en/area/jp/feature/fruit-picking/all"

FRUIT_KEYWORDS = {
    "Strawberry": ["strawberry", "ichigo"],
    "Cherry": ["cherry", "sakuranbo"],
    "Blueberry": ["blueberry"],
    "Peach": ["peach", "momo"],
    "Melon": ["melon"],
    "Watermelon": ["watermelon", "suika"],
    "Grape": ["grape", "budo"],
    "Japanese Pear": ["pear", "nashi", "japanese pear"],
    "Apple": ["apple", "ringo"],
    "Mandarin Orange": ["mandarin", "mikan", "orange"],
    "Chestnut": ["chestnut", "kuri"],
    "Persimmon": ["persimmon", "kaki"],
    "Kiwi": ["kiwi"],
    "Fig": ["fig", "ichijiku"],
}

PREFECTURES = [
    "Tokyo","Osaka","Kyoto","Aichi","Hokkaido","Fukuoka","Kanagawa",
    "Saitama","Chiba","Ibaraki","Tochigi","Gunma","Shizuoka","Nagano",
    "Niigata","Toyama","Ishikawa","Fukui","Yamanashi","Shiga","Hyogo",
    "Nara","Wakayama","Tottori","Shimane","Okayama","Hiroshima",
    "Yamaguchi","Tokushima","Kagawa","Ehime","Kochi","Saga","Nagasaki",
    "Kumamoto","Oita","Miyazaki","Kagoshima","Okinawa","Aomori","Iwate",
    "Miyagi","Akita","Yamagata","Fukushima","Mie","Gifu",
]

def detect_fruits(text):
    text_lower = text.lower()
    return [f for f, kws in FRUIT_KEYWORDS.items() if any(k in text_lower for k in kws)]

def extract_address(lines):
    for line in lines[:5]:
        if any(p in line for p in PREFECTURES):
            return line
    return ""

def scrape_listing_page(page):
    spots = []
    for article in page.query_selector_all("article"):
        try:
            text = article.inner_text()
            lines = [l.strip() for l in text.split('\n') if l.strip()]
            name = lines[0] if lines else ""
            if not name or name in ("Details", "View on Map", "Filters"):
                continue
            address = extract_address(lines[1:])
            fruits = detect_fruits(text)
            link = article.query_selector("a[href*='/spot/']")
            if link:
                href = link.get_attribute("href") or ""
                spot_url = href if href.startswith("http") else BASE + href
            else:
                spot_url = None
            spot_id_m = re.search(r'/spot/([^/]+)/', spot_url) if spot_url else None
            spots.append({
                "id": spot_id_m.group(1) if spot_id_m else None,
                "name": name,
                "address": address,
                "fruits": fruits,
                "url": spot_url,
                "lat": None,
                "lon": None,
            })
        except Exception:
            continue
    return spots

def extract_coords(page):
    """Try JSON-LD, then meta geo, then Google Maps link in page."""
    # JSON-LD
    try:
        result = page.evaluate("""() => {
            for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
                try {
                    const d = JSON.parse(s.textContent);
                    const nodes = d['@graph'] ? d['@graph'] : [d];
                    for (const n of nodes) {
                        if (n.geo?.latitude) return [n.geo.latitude, n.geo.longitude];
                    }
                } catch {}
            }
            return null;
        }""")
        if result:
            return float(result[0]), float(result[1])
    except Exception:
        pass

    # Meta geo.position
    try:
        content = page.get_attribute('meta[name="geo.position"]', 'content')
        if content and ';' in content:
            lat, lon = content.split(';')
            return float(lat.strip()), float(lon.strip())
    except Exception:
        pass

    # Google Maps link
    try:
        for sel in ["a[href*='maps.google']", "a[href*='google.com/maps']"]:
            el = page.query_selector(sel)
            if el:
                href = el.get_attribute("href") or ""
                for pattern in [r'll=(-?\d+\.\d+),(-?\d+\.\d+)', r'q=(-?\d+\.\d+),(-?\d+\.\d+)', r'@(-?\d+\.\d+),(-?\d+\.\d+)']:
                    m = re.search(pattern, href)
                    if m:
                        return float(m.group(1)), float(m.group(2))
    except Exception:
        pass

    # Embedded map iframe
    try:
        iframe = page.query_selector("iframe[src*='maps']")
        if iframe:
            src = iframe.get_attribute("src") or ""
            m = re.search(r'(-?\d+\.\d+),(-?\d+\.\d+)', src)
            if m:
                return float(m.group(1)), float(m.group(2))
    except Exception:
        pass

    return None, None

def run():
    all_spots = []
    scraped_at = datetime.now(timezone.utc).isoformat()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900},
                                   user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        page = ctx.new_page()
        page.set_default_timeout(20000)

        # ── Step 1: Determine total pages ──
        page.goto(LIST_BASE)
        page.wait_for_selector("article", timeout=15000)
        page.wait_for_timeout(1500)

        # Find last page number
        last_page_link = page.query_selector(".pagination__link:last-of-type, a.pagination__link[href*='page=']:last-of-type")
        last_page = 48  # fallback from exploration
        if last_page_link:
            href = last_page_link.get_attribute("href") or ""
            m = re.search(r'page=(\d+)', href)
            if m:
                last_page = int(m.group(1))
        print(f"Total pages: {last_page}")

        # ── Step 2: Scrape all listing pages via URL ──
        for pg in range(1, last_page + 1):
            url = LIST_BASE if pg == 1 else f"{LIST_BASE}?page={pg}"
            try:
                if pg > 1:
                    page.goto(url, timeout=15000)
                    page.wait_for_selector("article", timeout=10000)
                    page.wait_for_timeout(800)
                spots = scrape_listing_page(page)
                all_spots.extend(spots)
                print(f"  Page {pg}/{last_page}: {len(spots)} spots (total: {len(all_spots)})", flush=True)
            except Exception as e:
                print(f"  Page {pg}: ERROR — {e}", flush=True)
            time.sleep(0.5)

        print(f"\nListing scrape done. Total: {len(all_spots)} spots")

        # ── Step 3: Get coordinates from spot detail pages ──
        print("\nFetching coordinates...")
        found = 0
        for i, spot in enumerate(all_spots):
            if not spot["url"]:
                continue
            try:
                page.goto(spot["url"], timeout=15000)
                page.wait_for_timeout(600)
                lat, lon = extract_coords(page)
                if lat and lon:
                    spot["lat"] = round(lat, 6)
                    spot["lon"] = round(lon, 6)
                    found += 1
                if (i + 1) % 100 == 0:
                    pct = round(found / (i + 1) * 100)
                    print(f"  [{i+1}/{len(all_spots)}] coords: {found} ({pct}%)", flush=True)
            except Exception:
                pass
            time.sleep(0.2)

        browser.close()

    print(f"\nCoords found: {found}/{len(all_spots)}")

    output = {
        "scraped_at": scraped_at,
        "source": "Japan Travel by NAVITIME",
        "source_url": LIST_BASE + "/",
        "total": len(all_spots),
        "with_coords": found,
        "spots": all_spots,
    }

    out = "public/fruit-farms.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"Saved to {out}")
    print(f"Scraped at: {scraped_at}")

if __name__ == "__main__":
    run()
