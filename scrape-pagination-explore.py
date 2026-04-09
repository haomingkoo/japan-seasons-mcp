"""Quick exploration: find how Navitime pagination works."""
from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.set_default_timeout(20000)

        page.goto("https://japantravel.navitime.com/en/area/jp/feature/fruit-picking/all/")
        page.wait_for_selector("article", timeout=15000)
        page.wait_for_timeout(2000)

        # Dump all pagination-related HTML
        print("=== PAGINATION HTML ===")
        try:
            pag = page.query_selector("[class*='paginat'], [class*='Paginat'], nav[aria-label*='page'], [role='navigation']")
            if pag:
                print(pag.inner_html()[:2000])
            else:
                print("No pagination element found by those selectors")
        except Exception as e:
            print(f"Error: {e}")

        # Try to find page number links
        print("\n=== ALL LINKS WITH PAGE OR OFFSET IN URL ===")
        links = page.query_selector_all("a")
        for link in links:
            href = link.get_attribute("href") or ""
            if "page" in href.lower() or "offset" in href.lower() or "p=" in href:
                print(f"  {href} → {link.inner_text()[:30]}")

        # Check what changes in URL when we click page 2
        print("\n=== LOOKING FOR PAGE 2 LINK ===")
        page2_btns = page.query_selector_all("a:has-text('2'), button:has-text('2')")
        print(f"Found {len(page2_btns)} '2' buttons/links")
        for btn in page2_btns[:5]:
            href = btn.get_attribute("href") or ""
            print(f"  href='{href}' text='{btn.inner_text()[:20]}'")

        # Try clicking '2' and see what URL we end up at
        for btn in page2_btns:
            if btn.inner_text().strip() == '2':
                print(f"\nClicking '2' button...")
                btn.click(force=True)
                page.wait_for_timeout(2000)
                print(f"New URL: {page.url}")
                articles = page.query_selector_all("article")
                print(f"Articles on page 2: {len(articles)}")
                if articles:
                    print(f"First: {articles[0].inner_text()[:80]}")
                break

        browser.close()

run()
