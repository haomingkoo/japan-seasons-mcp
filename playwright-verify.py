#!/usr/bin/env python3
"""Playwright verification tests for sakura map at http://localhost:3000"""

import sys
import time
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:3457"
results = []

def passed(test, detail):
    results.append(("PASS", test, detail))
    print(f"  [PASS] {test}")
    print(f"         {detail}")

def failed(test, detail):
    results.append(("FAIL", test, detail))
    print(f"  [FAIL] {test}")
    print(f"         {detail}")

def run_tests():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30000)
            # Wait for tab buttons to be available
            page.wait_for_selector("#btn-sakura", timeout=20000)
            time.sleep(1.5)

            # ============================================================
            # TEST 1 — Filter pills multi-select (Cherry Blossom tab)
            # ============================================================
            print("\n=== TEST 1: Filter pills multi-select (Cherry Blossom tab) ===")

            # Click Cherry Blossom tab (may already be active)
            page.click("#btn-sakura", timeout=5000)
            time.sleep(0.5)

            # Verify pill order
            pills = page.query_selector_all(".filter-pill")
            pill_texts = [p.text_content().strip() for p in pills]
            expected = ["All", "🌷 Budding", "🌸 Blooming", "🌺 Full Bloom", "🍃 Past Peak"]
            if pill_texts == expected:
                passed("Test 1a — Pill order", f"Pills: {pill_texts}")
            else:
                failed("Test 1a — Pill order", f"Expected {expected}, got {pill_texts}")

            # Click Full Bloom
            full_bloom_pill = page.query_selector('.filter-pill[data-filter="peak"]')
            full_bloom_pill.click()
            time.sleep(0.3)

            pills_state = page.query_selector_all(".filter-pill")
            states = [{"text": p.text_content().strip(), "active": "active" in p.get_attribute("class")} for p in pills_state]
            all_state = next((s for s in states if s["text"] == "All"), None)
            fb_state = next((s for s in states if s["text"] == "🌺 Full Bloom"), None)

            if fb_state and fb_state["active"] and all_state and not all_state["active"]:
                passed("Test 1b — Full Bloom active, All deactivated", f"Full Bloom active=True, All active=False")
            else:
                failed("Test 1b — Full Bloom active, All deactivated",
                       f"Full Bloom active={fb_state['active'] if fb_state else 'N/A'}, All active={all_state['active'] if all_state else 'N/A'}")

            # Click Blooming too (multi-select)
            blooming_pill = page.query_selector('.filter-pill[data-filter="blooming"]')
            blooming_pill.click()
            time.sleep(0.3)

            pills_state2 = page.query_selector_all(".filter-pill")
            states2 = [{"text": p.text_content().strip(), "active": "active" in p.get_attribute("class")} for p in pills_state2]
            blooming_state = next((s for s in states2 if s["text"] == "🌸 Blooming"), None)
            fb_state2 = next((s for s in states2 if s["text"] == "🌺 Full Bloom"), None)

            if blooming_state and blooming_state["active"] and fb_state2 and fb_state2["active"]:
                passed("Test 1c — Multi-select: both Blooming and Full Bloom active", "Blooming=active, Full Bloom=active simultaneously")
            else:
                failed("Test 1c — Multi-select",
                       f"Blooming active={blooming_state['active'] if blooming_state else 'N/A'}, "
                       f"Full Bloom active={fb_state2['active'] if fb_state2 else 'N/A'}")

            # Click All — verify others deactivate
            all_btn = page.query_selector('.filter-pill[data-filter="all"]')
            all_btn.click()
            time.sleep(0.3)

            pills_state3 = page.query_selector_all(".filter-pill")
            states3 = [{"text": p.text_content().strip(), "active": "active" in p.get_attribute("class")} for p in pills_state3]
            all_active = next((s["active"] for s in states3 if s["text"] == "All"), False)
            others_inactive = all(not s["active"] for s in states3 if s["text"] != "All")

            if all_active and others_inactive:
                passed("Test 1d — Click All resets others", "All=active, all others deactivated")
            else:
                failed("Test 1d — Click All resets others",
                       f"All active={all_active}, others all inactive={others_inactive}; states={states3}")

            # ============================================================
            # TEST 2 — Month picker (Fruit Picking tab)
            # ============================================================
            print("\n=== TEST 2: Month picker (Fruit Picking tab) ===")

            page.click("#btn-fruit")
            time.sleep(0.8)

            # Find all month pills
            month_names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
            all_buttons = page.query_selector_all("button")
            month_btns = [b for b in all_buttons if b.text_content().strip() in month_names]

            if len(month_btns) == 12:
                passed("Test 2a — All 12 month pills visible", f"Found {len(month_btns)} month buttons")
            else:
                failed("Test 2a — All 12 month pills visible", f"Found {len(month_btns)} month buttons (expected 12)")

            # Check no overflow-x:auto on the month grid container specifically.
            # The month grid is the DIRECT parent of month buttons (display:grid).
            # The sidebar itself has overflow-x:auto (expected for scrollability),
            # but the month grid should NOT overflow (scrollWidth <= clientWidth).
            overflow_info = page.evaluate("""() => {
                const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                const allBtns = Array.from(document.querySelectorAll('button'));
                const monthBtns = allBtns.filter(b => monthNames.includes(b.textContent.trim()));
                if (monthBtns.length === 0) return { found: false };

                // The grid container is the direct parent of month buttons
                const gridContainer = monthBtns[0].parentElement;
                if (!gridContainer) return { found: true, gridNotFound: true };
                const gridStyle = gridContainer.getAttribute('style') || '';
                const gridSW = gridContainer.scrollWidth;
                const gridCW = gridContainer.clientWidth;

                // Also check if the grid container itself has overflow-x:auto
                const computedStyle = window.getComputedStyle(gridContainer);
                return {
                    found: true,
                    gridStyle: gridStyle.substring(0, 120),
                    gridOverflowX: computedStyle.overflowX,
                    gridScrollWidth: gridSW,
                    gridClientWidth: gridCW,
                    gridIsOverflowing: gridSW > gridCW
                };
            }""")

            if overflow_info.get("found"):
                # The grid container should not overflow (all 12 months fit without scroll)
                grid_overflowing = overflow_info.get("gridIsOverflowing", True)
                grid_overflow_x = overflow_info.get("gridOverflowX", "")
                if not grid_overflowing:
                    passed("Test 2b — Month grid has no horizontal overflow",
                           f"Grid overflowX={grid_overflow_x}, scrollWidth={overflow_info.get('gridScrollWidth')}, clientWidth={overflow_info.get('gridClientWidth')} — no overflow")
                else:
                    failed("Test 2b — Month grid should not overflow horizontally",
                           f"Grid scrollWidth={overflow_info.get('gridScrollWidth')} > clientWidth={overflow_info.get('gridClientWidth')} — OVERFLOWING")
            else:
                failed("Test 2b — No horizontal scroll/overflow", "Could not find month buttons container")

            # Click Dec — verify it becomes active.
            # Month buttons use INLINE STYLES (not CSS classes) to indicate active state:
            # active: background:#16a34a, border: 1px solid #16a34a
            # After click, renderFruitMonth re-renders all buttons, so we must re-query.
            dec_btn = next((b for b in page.query_selector_all("button") if b.text_content().strip() == "Dec"), None)
            if dec_btn:
                scroll_before = page.evaluate("() => window.scrollY")
                dec_btn.click()
                time.sleep(0.5)
                scroll_after = page.evaluate("() => window.scrollY")

                # Re-query after DOM re-render (renderFruitMonth rebuilds the month buttons)
                dec_active_info = page.evaluate("""() => {
                    const allBtns = Array.from(document.querySelectorAll('button'));
                    const decBtn = allBtns.find(b => b.textContent.trim() === 'Dec');
                    if (!decBtn) return { found: false };
                    const style = decBtn.getAttribute('style') || '';
                    const bg = window.getComputedStyle(decBtn).backgroundColor;
                    // Active = green background (#16a34a = rgb(22, 163, 74))
                    const isActiveStyle = style.includes('#16a34a') || bg === 'rgb(22, 163, 74)';
                    return { found: true, style: style.substring(0, 120), bg, isActiveStyle };
                }""")

                if dec_active_info.get("found") and dec_active_info.get("isActiveStyle"):
                    passed("Test 2c — Clicking Dec makes it active (green style)",
                           f"Dec background=green (#16a34a), bg={dec_active_info.get('bg')}")
                else:
                    failed("Test 2c — Clicking Dec makes it active",
                           f"found={dec_active_info.get('found')}, isActiveStyle={dec_active_info.get('isActiveStyle')}, bg={dec_active_info.get('bg')}, style={dec_active_info.get('style', '')[:80]}")

                if abs(scroll_after - scroll_before) < 50:
                    passed("Test 2d — No scroll jump on month click", f"scroll before={scroll_before}, after={scroll_after}")
                else:
                    failed("Test 2d — No scroll jump on month click", f"Scroll jumped: before={scroll_before}, after={scroll_after}")
            else:
                failed("Test 2c+2d — Dec button not found", "Could not find Dec month button")

            # ============================================================
            # TEST 3 — Fruit filter
            # ============================================================
            print("\n=== TEST 3: Fruit filter ===")

            # Click current month (April)
            apr_btn = next((b for b in page.query_selector_all("button") if b.text_content().strip() == "Apr"), None)
            if apr_btn:
                apr_btn.click()
                time.sleep(0.5)

            # Find strawberry card (clickable element with onclick)
            strawberry_found = page.evaluate("""() => {
                const allEls = Array.from(document.querySelectorAll('[onclick]'));
                const el = allEls.find(e => e.textContent.includes('Strawberry'));
                if (!el) {
                    // fallback: any div with onclick containing strawberry
                    const divs = Array.from(document.querySelectorAll('div[style]'));
                    const d = divs.find(e => e.textContent.includes('Strawberry') && e.getAttribute('onclick'));
                    return d ? { tag: d.tagName, text: d.textContent.trim().substring(0,60), onclick: d.getAttribute('onclick') } : null;
                }
                return { tag: el.tagName, text: el.textContent.trim().substring(0,60), onclick: el.getAttribute('onclick') };
            }""")

            if strawberry_found:
                # Click strawberry
                page.evaluate("""() => {
                    let el = Array.from(document.querySelectorAll('[onclick]')).find(e => e.textContent.includes('Strawberry'));
                    if (!el) {
                        el = Array.from(document.querySelectorAll('div[style]')).find(e => e.textContent.includes('Strawberry') && e.getAttribute('onclick'));
                    }
                    if (el) el.click();
                }""")
                time.sleep(0.5)

                fruit_filter = page.evaluate("() => window.fruitFilter")
                has_badge = page.evaluate("() => document.body.innerHTML.includes('Filtered')")

                if fruit_filter == "Strawberry" or has_badge:
                    passed("Test 3a — Fruit filter set on click",
                           f"fruitFilter='{fruit_filter}', 'Filtered' badge visible={has_badge}")
                else:
                    failed("Test 3a — Fruit filter set on click",
                           f"fruitFilter='{fruit_filter}', badge visible={has_badge}")

                # Click again to clear
                page.evaluate("""() => {
                    let el = Array.from(document.querySelectorAll('[onclick]')).find(e => e.textContent.includes('Strawberry'));
                    if (!el) {
                        el = Array.from(document.querySelectorAll('div[style]')).find(e => e.textContent.includes('Strawberry') && e.getAttribute('onclick'));
                    }
                    if (el) el.click();
                }""")
                time.sleep(0.4)

                fruit_filter2 = page.evaluate("() => window.fruitFilter")
                if fruit_filter2 is None:
                    passed("Test 3b — Fruit filter cleared on second click", "fruitFilter=null")
                else:
                    failed("Test 3b — Fruit filter cleared on second click", f"fruitFilter='{fruit_filter2}' (expected null)")
            else:
                # Try to find strawberry via text search in visible content
                visible_strawberry = page.locator("text=Strawberry").first
                try:
                    visible_strawberry.click(timeout=3000)
                    time.sleep(0.5)
                    fruit_filter = page.evaluate("() => window.fruitFilter")
                    if fruit_filter == "Strawberry":
                        passed("Test 3a — Fruit filter set on click (via locator)", f"fruitFilter='{fruit_filter}'")
                    else:
                        failed("Test 3a — Fruit filter set on click", f"fruitFilter='{fruit_filter}'")
                except Exception as e:
                    failed("Test 3 — Strawberry not visible in current month (April)",
                           "Strawberry may not be in season in April — checking if any fruit cards exist")
                    any_fruits = page.evaluate("() => Array.from(document.querySelectorAll('[onclick]')).filter(e=>e.textContent.match(/🍓|🍊|🍋|🍇|🍎/)).map(e=>e.textContent.trim().substring(0,40))")
                    print(f"         Fruits found in April: {any_fruits[:5]}")

            # ============================================================
            # TEST 4 — sakuraColor / bloomCategory JS functions
            # ============================================================
            print("\n=== TEST 4: Green dots / sakuraColor functions ===")

            # Go back to sakura tab to ensure functions are accessible
            page.click("#btn-sakura")
            time.sleep(0.3)

            # Test 4a: sakuraColor(0, 100, '2026-03-25') — 16 days ago → green '#4ade80'
            color1 = page.evaluate("() => window.sakuraColor(0, 100, '2026-03-25')")
            if color1 == "#4ade80":
                passed("Test 4a — sakuraColor(0,100,'2026-03-25') = '#4ade80' (green)", f"Returned: {color1}")
            else:
                failed("Test 4a — sakuraColor(0,100,'2026-03-25') should be '#4ade80'", f"Got: {color1}")

            # Test 4b: sakuraColor(0, 100, '2026-04-15') — future → NOT green (should be '#be185d')
            color2 = page.evaluate("() => window.sakuraColor(0, 100, '2026-04-15')")
            if color2 not in ("#4ade80", "#86efac"):
                passed("Test 4b — sakuraColor(0,100,'2026-04-15') is NOT green (future date)", f"Returned: {color2}")
            else:
                failed("Test 4b — sakuraColor future date should NOT be green", f"Got: {color2} (green!)")

            if color2 == "#be185d":
                passed("Test 4b-detail — sakuraColor future date = '#be185d' (deep pink)", f"Returned: {color2}")
            else:
                failed("Test 4b-detail — sakuraColor future date = '#be185d' (deep pink)", f"Got: {color2} (expected #be185d)")

            # Test 4c: bloomCategory(0, 100, '2026-03-25') → 'ended'
            cat1 = page.evaluate("() => window.bloomCategory(0, 100, '2026-03-25')")
            if cat1 == "ended":
                passed("Test 4c — bloomCategory(0,100,'2026-03-25') = 'ended'", f"Returned: {cat1}")
            else:
                failed("Test 4c — bloomCategory(0,100,'2026-03-25') should be 'ended'", f"Got: {cat1}")

            # Bonus: verify days calculation is correct
            days_check = page.evaluate("() => window.daysSince('2026-03-25')")
            print(f"\n  [INFO] daysSince('2026-03-25') = {days_check} (today is 2026-04-10, expect 16)")

        except Exception as e:
            failed("UNCAUGHT ERROR", str(e))
            import traceback
            traceback.print_exc()

        browser.close()

    # ============================================================
    # Print summary
    # ============================================================
    print("\n" + "="*60)
    print("PLAYWRIGHT VERIFICATION RESULTS SUMMARY")
    print("="*60)
    pass_count = sum(1 for r in results if r[0] == "PASS")
    fail_count = sum(1 for r in results if r[0] == "FAIL")
    for status, test, detail in results:
        print(f"[{status}] {test}")
    print(f"\n--- {pass_count} passed, {fail_count} failed out of {len(results)} tests ---")
    if fail_count > 0:
        sys.exit(1)

if __name__ == "__main__":
    run_tests()
