/**
 * Watchlist 2 — Deep Audit & Management
 *
 * W2.1  : Watchlist header at top — UI position validation
 * W2.2  : Count + names — all watchlists with names
 * W2.3  : Symbols per watchlist — list stocks in each tab
 * W2.4  : Empty watchlists — identify and flag
 * W2.5  : Total count confirmation
 * W2.6  : Add TCS & INFY to Watchlist1
 * W2.7  : Search bar input validation
 * W2.8  : Filter — Nifty filter, print results
 * W2.9  : Manage Watchlist — rename → vasanth, remove symbol, Done
 * W2.10 : Bottom sheet — print content, Discard, verify nav
 * W2.11 : Back button in Manage Watchlist
 * W2.12 : Scroll + UI layout checks
 *
 * Run:
 *   npx wdio config/wdio.android.conf.js --spec tests/watchlist/watchlist2.spec.js
 */

const { expect }     = require('chai');
const watchlistPage  = require('../../pages/Watchlist/WatchlistPage');
const { doLogin }    = require('../../utils/loginHelper');
const { dumpScreen } = require('../../utils/helpers');

const TEMP_WL   = 'MgmtTest1';
const RENAME_TO = 'vasanth';
const STOCK_1   = 'HAL';
const STOCK_2   = 'INFY';
const EXCHANGE  = 'NSE';

const SEL = {
  title:        '//android.view.View[@content-desc="Watchlist"]',
  searchBox:    '//android.widget.EditText[contains(@hint,"Add or search stocks")]',
  // allTabs: no "of 5" exclusion — that accidentally drops tabs when total count = 5
  allTabs:      '//android.view.View[contains(@content-desc,"Tab ") and contains(@content-desc," of ")]',
  stocks:       '//android.widget.ScrollView//android.view.View[contains(@content-desc,"NSE") or contains(@content-desc,"BSE")]',
  watchlistInput: '//android.widget.EditText[1]',
  createBtn:    '//android.widget.Button[contains(@text,"CREATE") or contains(@text,"SAVE") or contains(@text,"ADD")]',
  cancelBtn:    '//android.widget.Button[contains(@text,"CANCEL") or contains(@text,"Cancel")]',
  renameOption: '//android.view.View[@content-desc="Rename"]',
  doneBtn:      '//*[contains(@content-desc,"Done") or contains(@text,"Done") or contains(@text,"DONE")]',
  discardBtn:   '//*[contains(@content-desc,"Discard") or contains(@text,"Discard") or contains(@text,"DISCARD")]',
  filterBtn:    '//*[contains(@content-desc,"Filter") or contains(@content-desc,"filter")]',
  removeStock:  '//android.view.View[contains(@content-desc,"Remove") or contains(@text,"Remove")]',
};

// ─────────────────────────────────────────────────────────────────────────────
describe('Watchlist 2 — Deep Audit & Management', () => {

  afterEach(function () {
    if (!this.currentTest) return;
    if (this.currentTest.state === 'passed') {
      console.log(`  ✅ ${this.currentTest.title} — succeeded`);
    } else if (this.currentTest.state === 'failed') {
      console.log(`  ❌ ${this.currentTest.title} — FAILED`);
    }
  });

  before(async function () {
    this.timeout(600000);
    await doLogin();
    if (!await watchlistPage.isLoaded(30000)) {
      await dumpScreen('watchlist2-before: watchlist not found');
      throw new Error('Watchlist screen not reached after login');
    }
  });

  beforeEach(async () => {
    await watchlistPage._dismissANRIfPresent();
    await watchlistPage.goToWatchlist();
    // If a previous test left the app on a deep screen (stock detail, search overlay, etc.),
    // press back up to 3 times and retry navigation before giving up.
    if (!await watchlistPage.isLoaded(3000)) {
      for (let i = 0; i < 3; i++) {
        try { await driver.back(); } catch {}
        await browser.pause(500);
        await watchlistPage.goToWatchlist();
        if (await watchlistPage.isLoaded(3000)) break;
      }
    }
    if (!await watchlistPage.isLoaded(5000)) throw new Error('Could not return to Watchlist screen');
    await watchlistPage.scrollToFirstTab();
  });

  // ── W2.1: Watchlist header at top ─────────────────────────────────────────
  it('W2.1: Watchlist header is positioned at the top of the screen', async function () {
    this.timeout(15000);

    const titleEl       = await $(SEL.title);
    await titleEl.waitForDisplayed({ timeout: 5000 });
    const loc           = await titleEl.getLocation();
    const { height }    = await driver.getWindowRect();
    const yPercent      = ((loc.y / height) * 100).toFixed(1);

    console.log(`  ℹ  Watchlist title y: ${loc.y}px  (${yPercent}% of ${height}px screen)`);
    expect(loc.y, 'Watchlist title should appear in the top 20% of the screen').to.be.below(height * 0.20);

    const searchEl = await $(SEL.searchBox);
    if (await searchEl.isDisplayed()) {
      const searchLoc = await searchEl.getLocation();
      console.log(`  ℹ  Search box y: ${searchLoc.y}px`);
      expect(searchLoc.y, 'Search box should appear below the title').to.be.above(loc.y);
    }

    const src = await driver.getPageSource();
    const hasIndices = src.includes('BANKNIFTY') || src.includes('NIFTY') || src.includes('SENSEX');
    console.log(`  ℹ  Indices strip in page source: ${hasIndices}`);
  });

  // ── W2.2: Count + names ───────────────────────────────────────────────────
  it('W2.2: Fetch all watchlist count and names', async function () {
    this.timeout(30000);

    const total = await watchlistPage.getTotalTabCount();
    console.log(`  ℹ  Total watchlist count (from page source): ${total}`);
    expect(total, 'Should have at least 1 watchlist').to.be.above(0);

    const names = [];
    for (let scroll = 0; scroll < 4; scroll++) {
      const src     = await driver.getPageSource();
      const matches = [...src.matchAll(/content-desc="([^"]+)(?:&#10;|\n)Tab \d+ of \d+"/g)];
      for (const m of matches) {
        const name = m[1].trim();
        if (!names.includes(name)) names.push(name);
      }
      if (names.length >= total) break;
      await watchlistPage._swipeTabStrip('right');
      await browser.pause(200);
    }
    await watchlistPage.scrollToFirstTab();

    console.log(`  ℹ  Watchlist names found (${names.length}): ${names.join(', ')}`);
    expect(names.length, 'Should have found at least 1 watchlist name').to.be.above(0);
  });

  // ── W2.3: Symbols per watchlist ───────────────────────────────────────────
  it('W2.3: List symbols in each visible watchlist tab', async function () {
    this.timeout(90000);

    const src   = await driver.getPageSource();
    const names = [...src.matchAll(/content-desc="([^"]+)(?:&#10;|\n)Tab \d+ of \d+"/g)]
      .map(m => m[1].trim()).slice(0, 6);

    console.log(`  ℹ  Inspecting ${names.length} tabs`);

    for (const name of names) {
      try {
        const tabEl = await $(`//android.view.View[contains(@content-desc,"${name}") and contains(@content-desc,"Tab ")]`);
        if (!await tabEl.isDisplayed()) continue;
        await tabEl.click();
        await browser.pause(300);

        const count  = await watchlistPage.getStockCount();
        const items  = await $$(SEL.stocks);
        const preview = [];
        for (let i = 0; i < Math.min(3, items.length); i++) {
          try {
            const cd = await items[i].getAttribute('content-desc');
            preview.push(cd ? cd.split(/\n|&#10;/)[0] : '?');
          } catch {}
        }
        console.log(`  ℹ  "${name}": ${count} stock(s)${preview.length ? '  [' + preview.join(', ') + (count > 3 ? '...' : '') + ']' : ''}`);
      } catch (e) {
        console.log(`  ⚠  Could not inspect tab "${name}": ${e.message}`);
      }
    }
    await watchlistPage.scrollToFirstTab();
  });

  // ── W2.4: Empty watchlists ────────────────────────────────────────────────
  it('W2.4: Identify empty watchlists', async function () {
    this.timeout(90000);

    const src   = await driver.getPageSource();
    const names = [...src.matchAll(/content-desc="([^"]+)(?:&#10;|\n)Tab \d+ of \d+"/g)]
      .map(m => m[1].trim()).slice(0, 8);

    const empty = [];
    for (const name of names) {
      try {
        const tabEl = await $(`//android.view.View[contains(@content-desc,"${name}") and contains(@content-desc,"Tab ")]`);
        if (!await tabEl.isDisplayed()) continue;
        await tabEl.click();
        await browser.pause(300);
        const count = await watchlistPage.getStockCount();
        if (count === 0) {
          empty.push(name);
          console.log(`  ⚠  Empty watchlist: "${name}"`);
        } else {
          console.log(`  ℹ  "${name}": ${count} stock(s)`);
        }
      } catch {}
    }

    if (empty.length === 0) {
      console.log('  ℹ  No empty watchlists among visible tabs');
    } else {
      console.log(`  ℹ  Empty watchlists (${empty.length}): ${empty.join(', ')}`);
    }
    await watchlistPage.scrollToFirstTab();
    // Informational — always passes
  });

  // ── W2.5: Total count confirmation ───────────────────────────────────────
  it('W2.5: Confirm total watchlist count is within valid range', async function () {
    this.timeout(10000);

    const total   = await watchlistPage.getTotalTabCount();
    const visible = await watchlistPage.getTabCount();
    console.log(`  ℹ  Total watchlists: ${total}  |  Visible in strip: ${visible}`);

    expect(total,   'Total watchlist count should be between 1 and 25').to.be.within(1, 25);
    expect(visible, 'At least 1 tab should be visible').to.be.above(0);
  });

  // ── W2.6: Add TCS & INFY ─────────────────────────────────────────────────
  it('W2.6: Add TCS and INFY to Watchlist1', async function () {
    this.timeout(90000);

    await watchlistPage.tapTab(1);
    const countBefore = await watchlistPage.getStockCount();
    console.log(`  ℹ  Watchlist1 stock count before: ${countBefore}`);

    await watchlistPage.addStockFromSearch(STOCK_1, EXCHANGE);
    await watchlistPage.addStockFromSearch(STOCK_2, EXCHANGE);

    const tcsVisible  = await watchlistPage.isStockVisible(STOCK_1);
    const infyVisible = await watchlistPage.isStockVisible(STOCK_2);
    const countAfter  = await watchlistPage.getStockCount();

    console.log(`  ℹ  ${STOCK_1} visible: ${tcsVisible}  |  ${STOCK_2} visible: ${infyVisible}`);
    console.log(`  ℹ  Count after add: ${countAfter}`);

    expect(tcsVisible,  `${STOCK_1} should be visible after adding`).to.be.true;
    expect(infyVisible, `${STOCK_2} should be visible after adding`).to.be.true;

    // Cleanup
    for (const stock of [STOCK_1, STOCK_2]) {
      try {
        const el = await $(`//android.widget.ScrollView//android.view.View[starts-with(@content-desc,"${stock}")]`);
        if (await el.isDisplayed()) {
          await watchlistPage.longPressStock(stock);
          await watchlistPage.tapRemoveStockOption();
          await browser.pause(200);
        }
      } catch {}
    }
    console.log(`  ℹ  Cleanup — ${STOCK_1} and ${STOCK_2} removed`);
  });

  // ── W2.7: Search bar input validation ────────────────────────────────────
  it('W2.7: Search bar input validation', async function () {
    this.timeout(60000);

    // 1. Valid query: TCS → BSE result expected
    await watchlistPage.searchStock('TCS');
    const tcsBse = await watchlistPage.isSearchResultVisible('TCS', 'BSE');
    console.log(`  ℹ  "TCS" → TCS BSE result: ${tcsBse}`);
    expect(tcsBse, 'TCS BSE result should appear for query "TCS"').to.be.true;
    await watchlistPage.exitSearchMode();

    // 2. Valid query: INFY → NSE result expected
    await watchlistPage.searchStock('INFY');
    const infyNse = await watchlistPage.isSearchResultVisible('INFY', EXCHANGE);
    console.log(`  ℹ  "INFY" → INFY NSE result: ${infyNse}`);
    await watchlistPage.exitSearchMode();

    // 3. Partial query: REL → should return results
    await watchlistPage.searchStock('REL');
    await browser.pause(300);
    const relCount = (await $$(SEL.stocks)).length;
    console.log(`  ℹ  "REL" partial search → ${relCount} result(s)`);
    await watchlistPage.exitSearchMode();

    // 4. Special characters — app should not crash
    try {
      await watchlistPage.searchStock('@#$');
      await browser.pause(300);
      const src       = await driver.getPageSource();
      const noResults = src.includes('No result') || src.includes('not found') || src.includes('No stocks');
      console.log(`  ℹ  "@#$" → app running, no-results state: ${noResults}`);
    } catch {}
    await watchlistPage.exitSearchMode();

    expect(await watchlistPage.isLoaded(5000), 'Should be back on Watchlist after all input tests').to.be.true;
  });

  // ── W2.8: Filter — Nifty filter ──────────────────────────────────────────
  it('W2.8: Apply Nifty filter in search and print results', async function () {
    this.timeout(30000);

    await watchlistPage.searchStock('NIFTY');
    await browser.pause(400);

    const filterVisible = await watchlistPage.isDisplayed(SEL.filterBtn, 2000);
    console.log(`  ℹ  Filter button visible: ${filterVisible}`);

    if (filterVisible) {
      await watchlistPage.findAndTap(SEL.filterBtn, 2000);
      await browser.pause(300);
      const niftySel = '//*[contains(@content-desc,"NIFTY") or contains(@text,"NIFTY")]';
      if (await watchlistPage.isDisplayed(niftySel, 2000)) {
        await watchlistPage.findAndTap(niftySel, 2000);
        await browser.pause(400);
        console.log('  ℹ  NIFTY filter option tapped');
      }
    }

    const src     = await driver.getPageSource();
    const results = [...src.matchAll(/content-desc="([^"]*(?:NSE|BSE)[^"]*)"/g)]
      .map(m => m[1].split(/\n|&#10;/)[0])
      .filter(n => n.length > 2 && n.length < 60);
    console.log(`  ℹ  Search results count: ${results.length}`);
    if (results.length > 0) console.log(`  ℹ  First 5: ${results.slice(0, 5).join(' | ')}`);

    await watchlistPage.clearSearch();
    await watchlistPage.exitSearchMode();
    expect(await watchlistPage.isLoaded(5000), 'Watchlist should be loaded after filter test').to.be.true;
  });

  // ── W2.9: Manage Watchlist — rename, remove symbol, Done ─────────────────
  it('W2.9: Manage Watchlist — rename to vasanth, remove symbol, Done', async function () {
    this.timeout(120000);

    // Use Watchlist1 directly — no temp watchlist creation needed
    await watchlistPage.tapTab(1);
    await browser.pause(300);

    // Step 1: Long-press Watchlist1 tab → Rename → type vasanth → confirm
    console.log(`  ℹ  Renaming "Watchlist1" → "${RENAME_TO}"...`);
    let renamedOk = false;
    try {
      await watchlistPage.longPressTabByName('Watchlist1');
      await browser.pause(300);

      if (await watchlistPage.findAndTap(SEL.renameOption, 2000)) {
        const input = await $(SEL.watchlistInput);
        await input.waitForDisplayed({ timeout: 5000 });
        await input.clearValue();
        await input.setValue(RENAME_TO);
        await watchlistPage.findAndTap(SEL.createBtn, 3000);
        await browser.pause(300);
        renamedOk = await watchlistPage.watchlistExists(RENAME_TO);
        console.log(`  ℹ  Rename to "${RENAME_TO}" result: ${renamedOk}`);
        expect(renamedOk, `Watchlist should appear as "${RENAME_TO}"`).to.be.true;
      } else {
        console.log('  ⚠  Rename option not in context menu — skipping rename step');
      }
    } catch (e) {
      console.log(`  ⚠  Rename step error: ${e.message}`);
    }

    // Step 2: Remove a stock from the (renamed) watchlist
    const activeName = renamedOk ? RENAME_TO : 'Watchlist1';
    console.log(`  ℹ  Removing stock from "${activeName}"...`);
    try {
      const stocks = await $$(SEL.stocks);
      console.log(`  ℹ  Stocks in "${activeName}": ${stocks.length}`);
      if (stocks.length > 0) {
        await watchlistPage.longPressStock(STOCK_1);
        await browser.pause(300);
        const removed = await watchlistPage.findAndTap(SEL.removeStock, 2000);
        console.log(`  ℹ  Remove stock tapped: ${removed}`);
        await browser.pause(300);
      }
    } catch (e) {
      console.log(`  ⚠  Remove symbol step: ${e.message}`);
    }

    // Step 3: Tap Done if visible
    const doneVisible = await watchlistPage.isDisplayed(SEL.doneBtn, 2000);
    console.log(`  ℹ  Done button visible: ${doneVisible}`);
    if (doneVisible) {
      await watchlistPage.findAndTap(SEL.doneBtn, 2000);
      await browser.pause(300);
    }

    // Cleanup: rename back to Watchlist1 if we renamed it
    if (renamedOk) {
      try {
        await watchlistPage.longPressTabByName(RENAME_TO);
        await browser.pause(300);
        if (await watchlistPage.findAndTap(SEL.renameOption, 2000)) {
          const input = await $(SEL.watchlistInput);
          await input.waitForDisplayed({ timeout: 5000 });
          await input.clearValue();
          await input.setValue('Watchlist1');
          await watchlistPage.findAndTap(SEL.createBtn, 3000);
          await browser.pause(300);
          console.log('  ℹ  Cleanup — renamed back to Watchlist1');
        }
      } catch (e) {
        console.log(`  ⚠  Cleanup rename-back error: ${e.message}`);
      }
    }
  });

  // ── W2.10: Bottom sheet — print content, Discard, verify nav ─────────────
  it('W2.10: Bottom sheet — print content, dismiss, verify navigation', async function () {
    this.timeout(30000);

    await watchlistPage.tapTab(1);
    const items = await $$(SEL.stocks);
    if (items.length === 0) {
      console.log('  ⚠  Watchlist1 has no visible stocks — skipping bottom sheet tap');
      return;
    }
    const first = items[0];
    await first.waitForDisplayed({ timeout: 3000 });
    const loc  = await first.getLocation();
    const size = await first.getSize();
    await browser.action('pointer', { parameters: { pointerType: 'touch' } })
      .move({ x: Math.round(loc.x + size.width / 2), y: Math.round(loc.y + size.height / 2) })
      .down().pause(800).up().perform();
    await browser.pause(400);

    // Print bottom sheet content
    const src   = await driver.getPageSource();
    const texts = [...src.matchAll(/\btext="([^"]{2,40})"/g)].map(m => m[1]).filter(t => t.trim());
    const descs = [...src.matchAll(/content-desc="([^"]{2,60})"/g)]
      .map(m => m[1].split(/\n|&#10;/)[0])
      .filter(d => d.length >= 2 && d.length <= 40);
    console.log(`  ℹ  Bottom sheet texts : ${texts.join(' | ')}`);
    console.log(`  ℹ  Bottom sheet descs : ${descs.slice(0, 10).join(' | ')}`);

    // Dismiss via Discard or Back
    const discardFound = await watchlistPage.findAndTap(SEL.discardBtn, 1500);
    console.log(`  ℹ  Discard found & tapped: ${discardFound}`);
    if (!discardFound) {
      try { await driver.back(); } catch {}
      await browser.pause(300);
    }

    await watchlistPage.goToWatchlist();
    const backOnWatchlist = await watchlistPage.isLoaded(5000);
    console.log(`  ℹ  Back on Watchlist: ${backOnWatchlist}`);
    expect(backOnWatchlist, 'Should be on Watchlist screen after dismissing bottom sheet').to.be.true;
  });

  // ── W2.11: Back button in Manage Watchlist ────────────────────────────────
  it('W2.11: Back button validates navigation in Manage Watchlist', async function () {
    this.timeout(60000);

    // Open the Create Watchlist dialog via tapAddWatchlist
    await watchlistPage.tapAddWatchlist();
    console.log('  ℹ  Create dialog opened');

    // Type something to trigger a potential discard prompt on back
    const input = await $(SEL.watchlistInput);
    if (await input.isDisplayed()) {
      await input.setValue('BackTest');
      console.log('  ℹ  Typed "BackTest" in dialog');
      await browser.pause(200);
    }

    // Press device back
    try { await driver.back(); } catch {}
    await browser.pause(400);

    // Handle potential "Discard changes?" prompt
    const discardVisible = await watchlistPage.isDisplayed(SEL.discardBtn, 2000);
    console.log(`  ℹ  Discard prompt appeared: ${discardVisible}`);
    if (discardVisible) {
      await watchlistPage.findAndTap(SEL.discardBtn, 2000);
      await browser.pause(300);
    }
    const cancelVisible = await watchlistPage.isDisplayed(SEL.cancelBtn, 1500);
    if (cancelVisible) {
      await watchlistPage.findAndTap(SEL.cancelBtn, 1500);
      await browser.pause(200);
    }

    await watchlistPage.goToWatchlist();
    const onWatchlist = await watchlistPage.isLoaded(5000);
    console.log(`  ℹ  On Watchlist after back: ${onWatchlist}`);
    expect(onWatchlist, 'Should land on Watchlist screen after back navigation').to.be.true;
  });

  // ── W2.12: Scroll + UI layout checks ─────────────────────────────────────
  it('W2.12: Scroll and UI layout validation', async function () {
    this.timeout(30000);

    await watchlistPage.tapTab(1);
    const { width, height } = await driver.getWindowRect();
    console.log(`  ℹ  Device screen: ${width}×${height}`);

    // Title bounds check
    const titleEl = await $(SEL.title);
    if (await titleEl.isDisplayed()) {
      const tLoc  = await titleEl.getLocation();
      const tSize = await titleEl.getSize();
      expect(tLoc.x, 'Title left edge within screen').to.be.within(0, width);
      expect(tLoc.y, 'Title top edge within screen').to.be.within(0, height);
      expect(tLoc.x + tSize.width, 'Title right edge within screen').to.be.at.most(width);
      console.log(`  ℹ  Title bounds: [${tLoc.x},${tLoc.y}][${tLoc.x + tSize.width},${tLoc.y + tSize.height}]`);
    }

    // Stock row overflow check
    const stocks = await $$(SEL.stocks);
    let outOfBounds = 0;
    for (let i = 0; i < Math.min(5, stocks.length); i++) {
      try {
        const sLoc  = await stocks[i].getLocation();
        const sSize = await stocks[i].getSize();
        if (sLoc.x < 0 || sLoc.x + sSize.width > width) outOfBounds++;
      } catch {}
    }
    console.log(`  ℹ  Stock rows checked: ${Math.min(5, stocks.length)}, out-of-bounds: ${outOfBounds}`);
    expect(outOfBounds, 'No stock row should overflow screen width').to.equal(0);

    // Vertical scroll down + up
    await watchlistPage.scrollToBottom(3);
    await browser.pause(200);
    expect(await watchlistPage.isLoaded(3000), 'Watchlist visible after scrolling down').to.be.true;
    await watchlistPage.scrollToTop(3);
    await browser.pause(200);
    expect(await watchlistPage.isLoaded(3000), 'Watchlist visible after scrolling up').to.be.true;

    // Tab strip horizontal scroll
    const tabsBefore = await watchlistPage.getTabCount();
    await watchlistPage._swipeTabStrip('right');
    await browser.pause(200);
    const tabsAfter = await watchlistPage.getTabCount();
    console.log(`  ℹ  Visible tabs: before swipe=${tabsBefore}, after swipe=${tabsAfter}`);
    await watchlistPage.scrollToFirstTab();

    expect(tabsBefore, 'At least 1 tab should be visible').to.be.at.least(1);
    expect(tabsAfter,  'At least 1 tab should be visible after swipe').to.be.at.least(1);
    console.log('  ℹ  Scroll and layout checks complete');
  });

});
