"""
Exploratory scrape of Navitime fruit picking page.
Goal: understand HTML structure before building the full scraper.
"""
from playwright.sync_api import sync_playwright
import json, time

URL = "https://japantravel.navitime.com/en/area/jp/feature/fruit-picking/all/"

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.set_default_timeout(30000)

        print(f"Loading {URL}")
        page.goto(URL)

        # Wait for spot cards to load
        try:
            page.wait_for_selector("article, .spot-card, [class*='spot'], [class*='card'], li[class*='item']", timeout=15000)
        except Exception:
            pass

        page.wait_for_timeout(3000)

        # Screenshot to see what loaded
        page.screenshot(path="/tmp/navitime-explore.png", full_page=False)

        # Dump all text content to understand structure
        body_text = page.inner_text("body")
        print("\n=== BODY TEXT (first 3000 chars) ===")
        print(body_text[:3000])

        # Try to find spot items
        print("\n=== LOOKING FOR SPOT ELEMENTS ===")
        selectors_to_try = [
            "article",
            ".spot-card",
            "li[class*='spot']",
            "div[class*='spot']",
            "li[class*='item']",
            ".result-item",
            "[data-spot]",
            "a[href*='/spot/']",
        ]
        for sel in selectors_to_try:
            els = page.query_selector_all(sel)
            if els:
                print(f"  {sel}: {len(els)} elements")
                if len(els) > 0:
                    print(f"    First: {els[0].inner_text()[:100]}")

        # Get all links that look like spot pages
        print("\n=== SPOT LINKS ===")
        links = page.query_selector_all("a[href*='/spot/']")
        print(f"Found {len(links)} /spot/ links")
        for link in links[:10]:
            print(f"  {link.get_attribute('href')} → {link.inner_text()[:60]}")

        # Check pagination
        print("\n=== PAGINATION ===")
        pag = page.query_selector_all("[class*='page'], [class*='pag'], nav a")
        print(f"Found {len(pag)} pagination elements")
        for el in pag[:10]:
            print(f"  {el.inner_text()[:40]}")

        # Check network requests for API calls
        print("\n=== CHECKING FOR API ENDPOINTS ===")
        # Intercept requests
        api_calls = []
        def on_request(req):
            if 'api' in req.url.lower() or 'json' in req.url.lower() or 'spot' in req.url.lower():
                api_calls.append(req.url)
        page.on("request", on_request)
        page.reload()
        page.wait_for_timeout(4000)
        print(f"API-like requests captured: {len(api_calls)}")
        for url in api_calls[:20]:
            print(f"  {url}")

        browser.close()

if __name__ == "__main__":
    run()
