"""
Playwright smoke test for sakura map popup UI
Tests:
  1. Only Flowering bar shown when fullRate > 0 (not both Growth + Flowering)
  2. Only Growth bar shown when fullRate == 0
  3. Forecast dates prefixed with ~ when rate < 100
"""

from playwright.sync_api import sync_playwright
import sys

URL = "https://sakura.kooexperience.com"

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_default_timeout(20000)

        print(f"Opening {URL}")
        page.goto(URL)

        # Wait for sidebar spot items
        try:
            page.wait_for_selector(".spot-item", timeout=20000)
            print("Spot items loaded")
        except Exception:
            print("❌ FAIL: Spot items never appeared — page may not have loaded")
            page.screenshot(path="/tmp/sakura-test-fail.png")
            browser.close()
            sys.exit(1)

        overview_items = page.query_selector_all(".spot-item")
        print(f"Overview: {len(overview_items)} city cards")

        # Click a city likely to have flowering (prefer southern cities)
        target = None
        for item in overview_items:
            text = item.inner_text()
            if any(city in text for city in ["Tokyo", "Osaka", "Kyoto", "Hiroshima", "Fukuoka", "Nagoya"]):
                target = item
                break
        if target is None and overview_items:
            target = overview_items[0]
        if target:
            city_name = target.query_selector("h3, h4").inner_text() if target.query_selector("h3, h4") else "city"
            print(f"Clicking into: {city_name.split(chr(10))[0]}")
            target.click()
            page.wait_for_timeout(2000)  # wait for spots to load

        # Now check spot items (should be individual spots with bloom bars)
        items = page.query_selector_all(".spot-item")
        print(f"Spot detail view: {len(items)} items")

        tested_flowering = False
        tested_growth_only = False
        tested_tilde = False
        double_bar_failures = []

        for item in items:
            labels = [el.inner_text() for el in item.query_selector_all(".bloom-label")]
            has_growth = "Growth" in labels
            has_flowering = "Flowering" in labels
            name_el = item.query_selector("h4")
            name = name_el.inner_text() if name_el else "?"

            # Check for double-bar bug
            if has_growth and has_flowering:
                double_bar_failures.append(name)

            if not tested_flowering and has_flowering and not has_growth:
                print(f"✅ PASS: Only Flowering bar for: {name.split(chr(10))[0][:50]}")
                tested_flowering = True

            if not tested_growth_only and has_growth and not has_flowering:
                print(f"✅ PASS: Only Growth bar for: {name.split(chr(10))[0][:50]}")
                tested_growth_only = True

            # Check date labels
            sub = item.query_selector(".sub")
            if sub:
                sub_text = sub.inner_text()
                if "~" in sub_text and not tested_tilde:
                    print(f"✅ PASS: Forecast ~ prefix: \"{sub_text.strip()[:70]}\"")
                    tested_tilde = True
                if ("Bloomed:" in sub_text or "Peaked:" in sub_text):
                    print(f"✅ PASS: Confirmed label: \"{sub_text.strip()[:70]}\"")

        if double_bar_failures:
            print(f"\n❌ FAIL: {len(double_bar_failures)} spot(s) show BOTH bars:")
            for name in double_bar_failures[:5]:
                print(f"   - {name.split(chr(10))[0][:60]}")
        else:
            print("✅ PASS: No spots show both Growth and Flowering bars")

        if not tested_flowering:
            print("⚠️  No Flowering-only bar found (may all be budding or ended)")
        if not tested_growth_only:
            print("⚠️  No Growth-only bar found (may all be flowering)")
        if not tested_tilde:
            print("⚠️  No ~ prefixed date found (all rates may be 100%)")

        # Screenshot
        page.screenshot(path="/tmp/sakura-test.png")
        print("\nScreenshot saved to /tmp/sakura-test.png")

        browser.close()

        if double_bar_failures:
            sys.exit(1)

run()
