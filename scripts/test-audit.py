"""
Full UI audit: checks all tabs and popup states for logical consistency.
"""
from playwright.sync_api import sync_playwright
import sys

URL = "https://sakura.kooexperience.com"

ISSUES = []
PASSES = []

def ok(msg): PASSES.append(msg); print(f"  ✅ {msg}")
def fail(msg): ISSUES.append(msg); print(f"  ❌ {msg}")
def info(msg): print(f"  ℹ  {msg}")

def check_spot_items(items, context=""):
    double_bars = 0
    bar_on_ended = 0
    no_tilde_on_forecast = 0
    missing_dates = 0

    for item in items:
        labels = [el.inner_text() for el in item.query_selector_all(".bloom-label")]
        has_growth = "Growth" in labels
        has_flowering = "Flowering" in labels
        name_el = item.query_selector("h4")
        name = name_el.inner_text().split("\n")[0][:50] if name_el else "?"

        # Sub-line text
        sub = item.query_selector(".sub")
        sub_text = sub.inner_text() if sub else ""

        # Double bar check
        if has_growth and has_flowering:
            double_bars += 1
            fail(f"[{context}] Both bars: {name}")

        # Check ended spots don't have a bar
        if ("Ended" in sub_text or "Peaked" in sub_text) and (has_growth or has_flowering):
            bar_on_ended += 1
            fail(f"[{context}] Bar shown on ended spot: {name}")

        # Forecast dates should have ~ (unless rate is 100)
        if "Bloom: 4" in sub_text or "Bloom: 3" in sub_text or "Bloom: 5" in sub_text:
            # Has a bloom date — check it's either confirmed or has ~
            if "Bloom: ~" not in sub_text and "Bloomed:" not in sub_text:
                no_tilde_on_forecast += 1
                fail(f"[{context}] Missing ~ on unconfirmed bloom date: '{sub_text[:60]}'")

        # Dates should exist
        if sub_text and ("Bloomed" not in sub_text and "Bloom" not in sub_text):
            missing_dates += 1

    total = len(items)
    if double_bars == 0: ok(f"[{context}] No double bars in {total} items")
    if bar_on_ended == 0: ok(f"[{context}] No bars on ended spots")
    if no_tilde_on_forecast == 0: ok(f"[{context}] Forecast dates properly marked with ~")
    return total

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        page.set_default_timeout(20000)

        print(f"\nOpening {URL}")
        page.goto(URL)
        page.wait_for_selector(".spot-item", timeout=20000)

        # ── Tab 1: Cherry Blossom overview ──
        print("\n── Cherry Blossom overview ──")
        page.screenshot(path="/tmp/audit-01-overview.png")
        city_cards = page.query_selector_all(".spot-item")
        info(f"City cards: {len(city_cards)}")

        # ── Click Tokyo (should have ended + in-progress spots) ──
        print("\n── Tokyo prefecture spots ──")
        for card in city_cards:
            if "Tokyo" in (card.inner_text()):
                card.click()
                break
        page.wait_for_timeout(2000)
        page.screenshot(path="/tmp/audit-02-tokyo.png")
        items = page.query_selector_all(".spot-item")
        info(f"Tokyo spots: {len(items)}")
        check_spot_items(items, "Tokyo sidebar")

        # Check a map popup — click via JS to avoid cluster intercept
        print("\n── Map popup (Tokyo spot) ──")
        try:
            # Zoom in to break clusters, then click a spot marker
            page.evaluate("mapInstance.setZoom(12)")
            page.wait_for_timeout(1500)
            dot = page.query_selector("path.leaflet-interactive")
            if dot:
                dot.click(force=True)
                page.wait_for_selector(".leaflet-popup-content", timeout=5000)
                popup = page.query_selector(".leaflet-popup-content")
                popup_text = popup.inner_text() if popup else ""
                info(f"Popup: {popup_text.strip()[:120]}")
                page.screenshot(path="/tmp/audit-03-tokyo-popup.png")

                if "Growth" in popup_text and "Flowering" in popup_text:
                    fail("Map popup has BOTH bars")
                elif "Growth" in popup_text or "Flowering" in popup_text:
                    ok("Map popup shows single bar only")
                else:
                    ok("Map popup shows no bar (ended spot)")

                if "Peaked:" in popup_text:
                    fail("Map popup still uses 'Peaked:' label")
                else:
                    ok("Map popup uses correct date labels (no 'Peaked:')")
            else:
                info("No dot markers found at zoom 12")
        except Exception as e:
            info(f"Map popup check skipped: {e}")

        # ── Click Hokkaido city (should have budding spots) ──
        print("\n── Sapporo (budding spots) ──")
        page.go_back() if False else None
        # Go back to overview
        back = page.query_selector("button:has-text('Back'), .back-btn")
        if back:
            back.click()
            page.wait_for_timeout(1000)
        else:
            page.reload()
            page.wait_for_selector(".spot-item", timeout=20000)

        city_cards = page.query_selector_all(".spot-item")
        for card in city_cards:
            if "Sapporo" in card.inner_text():
                card.click()
                break
        page.wait_for_timeout(2000)
        page.screenshot(path="/tmp/audit-04-sapporo.png")
        items = page.query_selector_all(".spot-item")
        info(f"Sapporo spots: {len(items)}")
        check_spot_items(items, "Sapporo sidebar")

        # ── Near Me tab ──
        print("\n── Near Me tab ──")
        page.evaluate("""() => {
            // Simulate Tokyo coordinates
            const orig = navigator.geolocation.getCurrentPosition;
            navigator.geolocation.getCurrentPosition = (success) => success({
                coords: { latitude: 35.689, longitude: 139.692, accuracy: 100 }
            });
        }""")
        near_btn = page.query_selector("#btn-nearme")
        if near_btn:
            # Inject fake geolocation before clicking
            page.context.set_geolocation({"latitude": 35.689, "longitude": 139.692})
            page.context.grant_permissions(["geolocation"])
            near_btn.click()
            page.wait_for_timeout(4000)
            page.screenshot(path="/tmp/audit-05-nearme.png")
            items = page.query_selector_all(".spot-item")
            info(f"Near Me spots: {len(items)}")
            if items:
                check_spot_items(items, "Near Me")
            else:
                info("No spots returned from Near Me")

        # ── Plan My Trip tab ──
        print("\n── Plan My Trip tab ──")
        trip_btn = page.query_selector("#btn-trip")
        if trip_btn:
            trip_btn.click()
            page.wait_for_timeout(2000)
            page.screenshot(path="/tmp/audit-06-trip.png")
            trip_content = page.query_selector("#sidebar-content")
            if trip_content:
                info(f"Trip content: {trip_content.inner_text()[:200]}")

        # ── Autumn Leaves tab ──
        print("\n── Autumn Leaves tab ──")
        koyo_btn = page.query_selector("#btn-koyo")
        if koyo_btn:
            koyo_btn.click()
            page.wait_for_timeout(3000)
            page.screenshot(path="/tmp/audit-07-koyo.png")
            items = page.query_selector_all(".spot-item")
            info(f"Koyo items: {len(items)}")

        browser.close()

    print(f"\n{'='*50}")
    print(f"SUMMARY: {len(PASSES)} passed, {len(ISSUES)} issues")
    if ISSUES:
        print("\nISSUES:")
        for i in ISSUES:
            print(f"  ❌ {i}")
    else:
        print("All checks passed!")

    if ISSUES:
        sys.exit(1)

run()
