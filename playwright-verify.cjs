// playwright-verify.cjs — run against production: node playwright-verify.cjs [url]
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'https://seasons.kooexperience.com';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];
  let passed = 0, failed = 0;

  function pass(name, detail = '') { results.push({ status: 'PASS', name, detail }); passed++; }
  function fail(name, detail = '') { results.push({ status: 'FAIL', name, detail }); failed++; }

  try {
    // ── 1. Page loads ──
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
    const title = await page.title();
    if (title.includes('Japan')) pass('Page loads', title);
    else fail('Page loads', `Unexpected title: ${title}`);

    // ── 2. All tabs present ──
    for (const [id, label] of [
      ['btn-sakura', 'Cherry Blossom'],
      ['btn-koyo', 'Autumn Leaves'],
      ['btn-fruit', 'Fruit Picking'],
      ['btn-flowers', 'Flowers'],
      ['btn-whatson', "What's On"],
      ['btn-trip', 'Plan My Trip'],
    ]) {
      const el = await page.$(`#${id}`);
      if (el) pass(`Tab exists: ${label}`);
      else fail(`Tab exists: ${label}`, `#${id} not found`);
    }

    // ── 3. Filter pills — order + emoji (wait for sakura data to load) ──
    await page.waitForSelector('.spot-item', { timeout: 20000 });
    // bloom-filters is display:none until sakura tab active — make it visible to read
    await page.evaluate(() => {
      const bf = document.getElementById('bloom-filters');
      if (bf) bf.style.display = 'flex';
    });
    const pills = await page.$$eval('.filter-pill', ps => ps.map(p => p.textContent.trim()));
    const expectedPills = ['All', '🌰 Budding', '🌸 Blooming', '🌺 Full Bloom', '🍃 Past Peak'];
    if (JSON.stringify(pills) === JSON.stringify(expectedPills))
      pass('Filter pills order + emoji', pills.join(' | '));
    else
      fail('Filter pills order + emoji', `Got: [${pills.join(', ')}] | Exp: [${expectedPills.join(', ')}]`);

    // ── 4. Sakura sidebar has city cards ──
    const spotCount = await page.$$eval('.spot-item', els => els.length);
    if (spotCount > 10) pass('Sakura sidebar cities', `${spotCount} items`);
    else fail('Sakura sidebar cities', `Only ${spotCount} items`);

    // ── 5. Flowers tab — all 8 types present ──
    await page.click('#btn-flowers');
    await page.waitForTimeout(3000);
    const flowersText = await page.$eval('#sidebar-content', el => el.textContent).catch(() => '');
    const hasPlum = flowersText.includes('Plum');
    const hasNanohana = flowersText.includes('Rapeseed');
    const hasWisteria = flowersText.includes('Wisteria');
    const hasIris = flowersText.includes('Iris');
    const hasHydrangea = flowersText.includes('Hydrangea');
    const hasLavender = flowersText.includes('Lavender');
    const hasSunflower = flowersText.includes('Sunflower');
    const hasCosmos = flowersText.includes('Cosmos');
    const allTypes = hasPlum && hasNanohana && hasWisteria && hasIris && hasHydrangea && hasLavender && hasSunflower && hasCosmos;
    if (allTypes) pass('Flowers: all 8 types', 'Plum+Rapeseed+Wisteria+Iris+Hydrangea+Lavender+Sunflower+Cosmos');
    else fail('Flowers: all 8 types', `Plum:${hasPlum} Rape:${hasNanohana} Wist:${hasWisteria} Iris:${hasIris} Hydra:${hasHydrangea} Lav:${hasLavender} Sun:${hasSunflower} Cos:${hasCosmos}`);

    // ── 6. Flowers tab has 80 spots ──
    const flowerHeader = await page.$eval('#sidebar-header', el => el.textContent).catch(() => '');
    if (flowerHeader.includes('80')) pass('Flowers: 80 spots', flowerHeader.slice(0, 80).trim());
    else fail('Flowers: spot count', `Header: ${flowerHeader.slice(0, 80).trim()}`);

    // ── 7. What's On tab loads ──
    await page.click('#btn-whatson');
    await page.waitForTimeout(3000);
    const whatsonHeader = await page.$eval('#sidebar-header', el => el.textContent).catch(() => '');
    if (whatsonHeader.includes("What's On")) pass("What's On tab loads");
    else fail("What's On tab loads", whatsonHeader.slice(0, 80));

    // ── 8. What's On has 12 month pills ──
    const woMonthPills = await page.$$eval('#sidebar-header button', bs => bs.length);
    if (woMonthPills === 12) pass("What's On: 12 month pills");
    else fail("What's On: 12 month pills", `Got ${woMonthPills}`);

    // ── 9. Fruit tab: 12 month pills (2×6 grid) ──
    await page.click('#btn-fruit');
    await page.waitForTimeout(2000);
    const fruitPills = await page.$$eval('#sidebar-header button', bs => bs.length);
    if (fruitPills === 12) pass('Fruit: 12 month pills (2×6 grid)');
    else fail('Fruit: 12 month pills', `Got ${fruitPills}`);

    // ── 10. Fruit sidebar has content ──
    const fruitContent = await page.$eval('#sidebar-content', el => el.textContent).catch(() => '');
    if (fruitContent.length > 100) pass('Fruit sidebar content', fruitContent.slice(0, 60).trim());
    else fail('Fruit sidebar content', 'Too short or empty');

    // ── 11. Weather in popup (sidebar spot click) ──
    await page.click('#btn-sakura');
    await page.waitForSelector('.spot-item', { timeout: 15000 });
    const firstCity = await page.$('.spot-item');
    if (firstCity) {
      await firstCity.click();
      // Wait for spot items with onclick (skip JMA station card which has no onclick)
      await page.waitForSelector('.spot-item[onclick*="flyToSpot"]', { timeout: 12000 });
      const firstSpot = await page.$('.spot-item[onclick*="flyToSpot"]');
      if (firstSpot) {
        await firstSpot.click();
        await page.waitForTimeout(2500);
        const weatherDiv = await page.$('.popup-weather');
        if (weatherDiv) pass('Weather in popup', '.popup-weather div present');
        else fail('Weather in popup', '.popup-weather missing from flyToSpot popup');
      } else fail('Weather in popup', 'No spot items with flyToSpot found');
    } else fail('Weather in popup', 'No city items found');

    // ── 12. API endpoints respond with expected shape ──
    for (const [path, key, minItems] of [
      ['/api/sakura/forecast', 'regions', 1],
      ['/api/flowers', 'spots', 40],
      ['/api/festivals', 'spots', 45],
      ['/api/fruit/farms', 'spots', 1],
    ]) {
      try {
        const res = await page.request.get(`${BASE}${path}`);
        const json = await res.json();
        const count = Array.isArray(json[key]) ? json[key].length : -1;
        if (count >= minItems) pass(`API ${path}`, `${count} ${key}`);
        else fail(`API ${path}`, `Expected ≥${minItems} ${key}, got ${count}`);
      } catch (e) {
        fail(`API ${path}`, e.message);
      }
    }

  } catch (e) {
    fail('Unexpected crash', e.message);
  }

  await browser.close();

  console.log(`\n${'─'.repeat(62)}`);
  console.log(`Playwright · ${BASE}`);
  console.log('─'.repeat(62));
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : '❌';
    console.log(`${icon}  ${r.name}${r.detail ? `\n    ${r.detail}` : ''}`);
  }
  console.log('─'.repeat(62));
  console.log(`${passed} passed · ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
