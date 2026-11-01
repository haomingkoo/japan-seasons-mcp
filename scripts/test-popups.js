/**
 * Playwright smoke test for sakura map popup UI
 * Tests:
 *   1. Only Flowering bar shown when fullRate > 0
 *   2. Only Growth bar shown when fullRate == 0
 *   3. Forecast dates prefixed with ~ when rate < 100
 */

import { chromium } from 'playwright';

const URL = 'https://sakura.kooexperience.com';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);

  console.log('Opening', URL);
  await page.goto(URL);

  // Wait for map markers to load
  await page.waitForFunction(() => {
    return window.sakuraData != null || document.querySelectorAll('.spot-item').length > 0;
  }, { timeout: 15000 }).catch(() => {
    console.log('(waiting for sidebar items instead)');
  });

  await page.waitForSelector('.spot-item', { timeout: 15000 });
  console.log('Spot items loaded');

  // ── Test 1: Check spot items in sidebar ──
  const items = await page.$$('.spot-item');
  console.log(`Found ${items.length} spot items`);

  let testedFlowering = false;
  let testedGrowthOnly = false;
  let testedTilde = false;

  for (const item of items.slice(0, 30)) {
    const growthBars = await item.$$('.bloom-label');
    const labels = await Promise.all(growthBars.map(el => el.innerText()));

    if (!testedFlowering && labels.includes('Flowering') && !labels.includes('Growth')) {
      console.log('✅ PASS: Spot with flowering shows only Flowering bar (no Growth bar)');
      testedFlowering = true;
    }
    if (!testedGrowthOnly && labels.includes('Growth') && !labels.includes('Flowering')) {
      console.log('✅ PASS: Spot with no flowering shows only Growth bar (no Flowering bar)');
      testedGrowthOnly = true;
    }
    if (labels.includes('Flowering') && labels.includes('Growth')) {
      const name = await item.$eval('h4', el => el.innerText).catch(() => '?');
      console.log(`❌ FAIL: Both bars visible in: ${name}`);
    }

    // Check for ~ in date text
    const subText = await item.$eval('.sub', el => el.innerText).catch(() => '');
    if (!testedTilde && subText.includes('~')) {
      console.log(`✅ PASS: Forecast date has ~ prefix: "${subText.trim()}"`);
      testedTilde = true;
    }
  }

  if (!testedFlowering) console.log('⚠️  Could not find a spot with only Flowering bar (may need more spots loaded)');
  if (!testedGrowthOnly) console.log('⚠️  Could not find a spot with only Growth bar');
  if (!testedTilde) console.log('⚠️  Could not find a ~ prefixed date (all rates may be 100%)');

  // ── Test 2: Click a dot and check the map popup ──
  const dots = await page.$$('path.leaflet-interactive, circle.leaflet-interactive');
  if (dots.length > 0) {
    await dots[0].click();
    await page.waitForSelector('.leaflet-popup-content', { timeout: 5000 }).catch(() => {});
    const popup = await page.$('.leaflet-popup-content');
    if (popup) {
      const popupText = await popup.innerText();
      console.log('\nMap popup content:');
      console.log(popupText.trim().split('\n').map(l => '  ' + l).join('\n'));

      const hasGrowthAndFlowering = popupText.includes('Growth') && popupText.includes('Flowering');
      if (hasGrowthAndFlowering) {
        console.log('❌ FAIL: Map popup shows both Growth and Flowering bars');
      } else {
        console.log('✅ PASS: Map popup shows only one bar');
      }
    }
  }

  // Screenshot for visual check
  await page.screenshot({ path: '/tmp/sakura-test.png', fullPage: false });
  console.log('\nScreenshot saved to /tmp/sakura-test.png');

  await browser.close();
  console.log('\nDone.');
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
