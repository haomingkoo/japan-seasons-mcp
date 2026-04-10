const { chromium } = require('playwright');

async function runTests() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];

  function pass(test, detail) { results.push({ test, status: 'PASS', detail }); }
  function fail(test, detail) { results.push({ test, status: 'FAIL', detail }); }

  try {
    // ----------------------------------------------------------------
    // TEST 1 — Filter pills multi-select (Cherry Blossom tab)
    // ----------------------------------------------------------------
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });

    // Ensure Cherry Blossom is already active (default) or click it
    const cherrybtn = await page.$('#btn-sakura');
    if (cherrybtn) await cherrybtn.click();
    await page.waitForTimeout(500);

    // Verify pill order
    const pillTexts = await page.$$eval('.filter-pill', pills =>
      pills.map(p => p.textContent.trim())
    );
    const expectedOrder = ['All', '🌷 Budding', '🌸 Blooming', '🌺 Full Bloom', '🍃 Past Peak'];
    const orderOk = JSON.stringify(pillTexts) === JSON.stringify(expectedOrder);
    if (!orderOk) {
      fail('Test 1a — Pill order', `Expected ${JSON.stringify(expectedOrder)}, got ${JSON.stringify(pillTexts)}`);
    } else {
      pass('Test 1a — Pill order', `Pills in correct order: ${pillTexts.join(', ')}`);
    }

    // Click "🌺 Full Bloom"
    const fullBloomPill = await page.$('.filter-pill[data-filter="peak"]');
    await fullBloomPill.click();
    await page.waitForTimeout(300);

    const afterFullBloom = await page.$$eval('.filter-pill', pills =>
      pills.map(p => ({ text: p.textContent.trim(), active: p.classList.contains('active') }))
    );
    const allPill = afterFullBloom.find(p => p.text === 'All');
    const fullBloomActive = afterFullBloom.find(p => p.text === '🌺 Full Bloom');
    const allDeactivated = !allPill.active;
    const fullBloomIsActive = fullBloomActive.active;

    if (allDeactivated && fullBloomIsActive) {
      pass('Test 1b — Full Bloom active, All deactivated', 'All deactivated, Full Bloom active');
    } else {
      fail('Test 1b — Full Bloom active, All deactivated', `All active=${allPill.active}, FullBloom active=${fullBloomActive.active}`);
    }

    // Click "🌸 Blooming" too
    const bloomingPill = await page.$('.filter-pill[data-filter="blooming"]');
    await bloomingPill.click();
    await page.waitForTimeout(300);

    const afterBothSelected = await page.$$eval('.filter-pill', pills =>
      pills.map(p => ({ text: p.textContent.trim(), active: p.classList.contains('active') }))
    );
    const bloomingActive = afterBothSelected.find(p => p.text === '🌸 Blooming')?.active;
    const fullBloomStillActive = afterBothSelected.find(p => p.text === '🌺 Full Bloom')?.active;

    if (bloomingActive && fullBloomStillActive) {
      pass('Test 1c — Multi-select: both Blooming and Full Bloom active', 'Blooming=active, Full Bloom=active simultaneously');
    } else {
      fail('Test 1c — Multi-select', `Blooming active=${bloomingActive}, FullBloom active=${fullBloomStillActive}`);
    }

    // Click "All" — verify others deactivate
    const allPillBtn = await page.$('.filter-pill[data-filter="all"]');
    await allPillBtn.click();
    await page.waitForTimeout(300);

    const afterAll = await page.$$eval('.filter-pill', pills =>
      pills.map(p => ({ text: p.textContent.trim(), active: p.classList.contains('active') }))
    );
    const allActive = afterAll.find(p => p.text === 'All')?.active;
    const othersInactive = afterAll.filter(p => p.text !== 'All').every(p => !p.active);

    if (allActive && othersInactive) {
      pass('Test 1d — Click All resets others', 'All=active, others deactivated');
    } else {
      fail('Test 1d — Click All resets others', `All active=${allActive}, others all inactive=${othersInactive}`);
    }

    // ----------------------------------------------------------------
    // TEST 2 — Month picker (Fruit Picking tab)
    // ----------------------------------------------------------------
    const fruitBtn = await page.$('#btn-fruit');
    await fruitBtn.click();
    await page.waitForTimeout(800);

    // Check if all 12 months visible without horizontal scroll
    // Month grid is a CSS grid with repeat(6, 1fr) so 2 rows of 6 = 12 months total
    const monthGridInfo = await page.evaluate(() => {
      // Find month pills — they're in the fruit section
      const allBtns = Array.from(document.querySelectorAll('button'));
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const monthBtns = allBtns.filter(b => monthNames.includes(b.textContent.trim()));

      if (monthBtns.length === 0) return { count: 0, overflowing: null };

      const container = monthBtns[0]?.closest('[style*="grid"]') || monthBtns[0]?.parentElement;
      if (!container) return { count: monthBtns.length, overflowing: null };

      const style = window.getComputedStyle(container);
      const overflowX = style.overflowX;
      const scrollWidth = container.scrollWidth;
      const clientWidth = container.clientWidth;
      return {
        count: monthBtns.length,
        overflowX,
        scrollWidth,
        clientWidth,
        isOverflowing: scrollWidth > clientWidth
      };
    });

    if (monthGridInfo.count === 12) {
      pass('Test 2a — All 12 month pills visible', `Found ${monthGridInfo.count} month pills`);
    } else {
      fail('Test 2a — All 12 month pills visible', `Found ${monthGridInfo.count} month pills (expected 12)`);
    }

    const hasNoScrollOverflow = !monthGridInfo.isOverflowing || monthGridInfo.overflowX !== 'auto';
    if (hasNoScrollOverflow) {
      pass('Test 2b — No horizontal scroll overflow', `overflowX=${monthGridInfo.overflowX}, scrollWidth=${monthGridInfo.scrollWidth}, clientWidth=${monthGridInfo.clientWidth}`);
    } else {
      fail('Test 2b — No horizontal scroll overflow', `overflowX=${monthGridInfo.overflowX}, container is overflowing`);
    }

    // Click "Dec" and verify it becomes active
    const allBtns = await page.$$('button');
    let decBtn = null;
    for (const btn of allBtns) {
      const txt = await btn.evaluate(el => el.textContent.trim());
      if (txt === 'Dec') { decBtn = btn; break; }
    }

    if (decBtn) {
      const scrollPosBefore = await page.evaluate(() => window.scrollY);
      await decBtn.click();
      await page.waitForTimeout(400);
      const scrollPosAfter = await page.evaluate(() => window.scrollY);

      const decActive = await decBtn.evaluate(el => el.classList.contains('active'));
      if (decActive) {
        pass('Test 2c — Clicking Dec makes it active', 'Dec pill is active after click');
      } else {
        fail('Test 2c — Clicking Dec makes it active', 'Dec pill did not become active');
      }

      // No scroll jump (since no overflow-x scroll, page scroll should be stable)
      if (Math.abs(scrollPosAfter - scrollPosBefore) < 50) {
        pass('Test 2d — No scroll jump on month click', `Scroll position stable: before=${scrollPosBefore}, after=${scrollPosAfter}`);
      } else {
        fail('Test 2d — No scroll jump on month click', `Scroll jumped: before=${scrollPosBefore}, after=${scrollPosAfter}`);
      }
    } else {
      fail('Test 2c+2d — Dec button', 'Could not find Dec month button');
    }

    // ----------------------------------------------------------------
    // TEST 3 — Fruit filter
    // ----------------------------------------------------------------
    // Ensure we're on Fruit tab (already there)
    // Click current month first to reset
    const nowMonth = new Date().toLocaleString('en', { month: 'short' });
    const monthBtns = await page.$$('button');
    for (const btn of monthBtns) {
      const txt = await btn.evaluate(el => el.textContent.trim());
      if (txt === nowMonth) { await btn.click(); break; }
    }
    await page.waitForTimeout(500);

    // Find strawberry card
    const strawberryCard = await page.evaluate(() => {
      const divs = Array.from(document.querySelectorAll('div'));
      return divs.some(d => d.textContent.includes('Strawberry') && d.onclick != null);
    });

    // Try clicking the strawberry element
    const fruitCardsInfo = await page.evaluate(() => {
      // Look for clickable fruit elements
      const allEls = Array.from(document.querySelectorAll('[onclick]'));
      return allEls.filter(el => el.textContent.includes('Strawberry')).map(el => ({
        tag: el.tagName,
        text: el.textContent.trim().substring(0, 50),
        onclick: el.getAttribute('onclick')
      }));
    });

    if (fruitCardsInfo.length > 0) {
      // Click strawberry via JS
      await page.evaluate(() => {
        const allEls = Array.from(document.querySelectorAll('[onclick]'));
        const strawEl = allEls.find(el => el.textContent.includes('Strawberry'));
        if (strawEl) strawEl.click();
      });
      await page.waitForTimeout(500);

      // Check for "Filtered" badge
      const hasFilteredBadge = await page.evaluate(() => {
        return document.body.innerHTML.includes('Filtered') || document.body.innerHTML.includes('filtered');
      });

      // Check fruitFilter is set
      const fruitFilterVal = await page.evaluate(() => window.fruitFilter);

      if (fruitFilterVal === 'Strawberry' || hasFilteredBadge) {
        pass('Test 3a — Fruit filter set on click', `fruitFilter="${fruitFilterVal}", badge visible=${hasFilteredBadge}`);
      } else {
        fail('Test 3a — Fruit filter set on click', `fruitFilter="${fruitFilterVal}", badge visible=${hasFilteredBadge}`);
      }

      // Click again to clear
      await page.evaluate(() => {
        const allEls = Array.from(document.querySelectorAll('[onclick]'));
        const strawEl = allEls.find(el => el.textContent.includes('Strawberry'));
        if (strawEl) strawEl.click();
      });
      await page.waitForTimeout(400);

      const fruitFilterCleared = await page.evaluate(() => window.fruitFilter);
      if (fruitFilterCleared === null) {
        pass('Test 3b — Fruit filter cleared on second click', 'fruitFilter=null');
      } else {
        fail('Test 3b — Fruit filter cleared on second click', `fruitFilter="${fruitFilterCleared}" (expected null)`);
      }
    } else {
      fail('Test 3 — Strawberry card', `Could not find strawberry element. fruitsInfo=${JSON.stringify(fruitCardsInfo)}`);
    }

    // ----------------------------------------------------------------
    // TEST 4 — sakuraColor / bloomCategory JS functions
    // ----------------------------------------------------------------
    // Test sakuraColor(0, 100, '2026-03-25') — today is 2026-04-10, 16 days ago → should return '#4ade80'
    const color1 = await page.evaluate(() => window.sakuraColor(0, 100, '2026-03-25'));
    if (color1 === '#4ade80') {
      pass('Test 4a — sakuraColor(0,100,"2026-03-25") = green', `Returned: ${color1}`);
    } else {
      fail('Test 4a — sakuraColor(0,100,"2026-03-25") = green', `Expected '#4ade80', got '${color1}'`);
    }

    // Test sakuraColor(0, 100, '2026-04-15') — future date → should NOT be green
    const color2 = await page.evaluate(() => window.sakuraColor(0, 100, '2026-04-15'));
    if (color2 !== '#4ade80' && color2 !== '#86efac') {
      pass('Test 4b — sakuraColor(0,100,"2026-04-15") is NOT green (future date)', `Returned: ${color2} (not green)`);
    } else {
      fail('Test 4b — sakuraColor(0,100,"2026-04-15") should NOT be green', `Got ${color2} (expected pink #be185d, not green)`);
    }

    // Test bloomCategory(0, 100, '2026-03-25') → should return 'ended'
    const cat1 = await page.evaluate(() => window.bloomCategory(0, 100, '2026-03-25'));
    if (cat1 === 'ended') {
      pass('Test 4c — bloomCategory(0,100,"2026-03-25") = "ended"', `Returned: ${cat1}`);
    } else {
      fail('Test 4c — bloomCategory(0,100,"2026-03-25") = "ended"', `Expected 'ended', got '${cat1}'`);
    }

    // Also verify expected value for color2
    const color2Expected = '#be185d';
    if (color2 === color2Expected) {
      pass('Test 4d — sakuraColor future date = deep pink (#be185d)', `Returned: ${color2}`);
    } else {
      fail('Test 4d — sakuraColor future date = deep pink (#be185d)', `Expected '${color2Expected}', got '${color2}'`);
    }

  } catch (err) {
    fail('UNCAUGHT ERROR', err.message);
  }

  await browser.close();

  // Print results
  console.log('\n=== PLAYWRIGHT VERIFICATION RESULTS ===\n');
  let passCount = 0, failCount = 0;
  for (const r of results) {
    const icon = r.status === 'PASS' ? 'PASS' : 'FAIL';
    console.log(`[${icon}] ${r.test}`);
    console.log(`       ${r.detail}`);
    if (r.status === 'PASS') passCount++; else failCount++;
  }
  console.log(`\n--- ${passCount} passed, ${failCount} failed ---\n`);
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
