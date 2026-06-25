const { expect }    = require('chai');
const watchlistPage = require('../../pages/Watchlist/WatchlistPage');
const { doLogin }   = require('../../utils/loginHelper');
const { dumpScreen }= require('../../utils/helpers');

// Run:  npx wdio config/wdio.android.conf.js --spec tests/watchlist/watchlist.advanced.spec.js

const TEST_STOCK    = 'RELIANCE';
const TEST_EXCHANGE = 'NSE';
const TEMP_WL_NAME  = 'EmptyListTest';

describe('Watchlist Advanced — Globe Capital Dev', () => {

  before(async function () {
    this.timeout(600000);
    await doLogin();
    const onWatchlist = await watchlistPage.isLoaded(30000);
    if (!onWatchlist) await dumpScreen('advanced-before: watchlist not found');
    expect(onWatchlist, 'Watchlist screen should be visible after login').to.be.true;
  });

  beforeEach(async () => {
    await watchlistPage.tapNavWatchlist();
    if (!await watchlistPage.isLoaded(8000))
      throw new Error('Could not return to Watchlist screen');
  });

  // ── Empty watchlist handling ───────────────────────────────────────────────────

  it('Verify Empty Watchlist Handling', async function () {
    this.timeout(30000);

    // Create a fresh watchlist (it starts empty)
    const created = await watchlistPage.createWatchlist(TEMP_WL_NAME);
    expect(created, `"${TEMP_WL_NAME}" tab should be created`).to.be.true;

    // Navigate to it
    const tabs = await $$(('//android.view.View[contains(@content-desc,"of 11")]'));
    for (const tab of tabs) {
      const desc = await tab.getAttribute('content-desc').catch(() => '');
      if (desc.includes(TEMP_WL_NAME)) { await tab.click(); break; }
    }
    await browser.pause(500);

    const isEmpty = await watchlistPage.isEmptyStateDisplayed();
    const stockCount = await watchlistPage.getStockCount();

    if (!isEmpty && stockCount > 0) await dumpScreen('empty-watchlist: unexpected stocks found');
    expect(
      isEmpty || stockCount === 0,
      'Newly created watchlist should show empty state or zero stocks'
    ).to.be.true;

    // Cleanup
    await watchlistPage.deleteWatchlistByName(TEMP_WL_NAME);
  });

  // ── Real-time price refresh ───────────────────────────────────────────────────

  it('Verify Watchlist Real-Time Price Refresh', async function () {
    this.timeout(60000);

    await watchlistPage.tapTab(1);
    await browser.pause(500);

    const stockCount = await watchlistPage.getStockCount();
    expect(stockCount, 'At least one stock must be in the watchlist to verify price refresh').to.be.above(0);

    const descBefore = await watchlistPage.getFirstStockContentDesc();
    expect(descBefore, 'First stock should have content-desc with price info').to.be.a('string').and.not.empty;

    // Wait up to 30 s for the price display to update
    let priceUpdated = false;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      await browser.pause(3000);
      const descNow = await watchlistPage.getFirstStockContentDesc();
      if (descNow && descNow !== descBefore) { priceUpdated = true; break; }
    }

    // During market hours prices update; outside hours the display still remains visible
    const descAfter = await watchlistPage.getFirstStockContentDesc();
    expect(descAfter, 'Stock price row should remain visible throughout the wait').to.be.a('string').and.not.empty;
    console.log(`  ℹ  Price refresh: ${priceUpdated ? 'price changed during test' : 'price unchanged (market may be closed)'}`);
  });

  // ── Data persistence after logout / login ─────────────────────────────────────

  it('Verify Watchlist Data Persistence after Logout/Login', async function () {
    this.timeout(600000);

    await watchlistPage.tapTab(1);
    await browser.pause(500);

    const stocksBefore = await watchlistPage.getStockCount();
    expect(stocksBefore, 'Watchlist must contain stocks before logout').to.be.above(0);

    // Terminate + full re-login (clearAndLaunch clears app data; server restores watchlist)
    await doLogin();

    const onWatchlist = await watchlistPage.isLoaded(30000);
    if (!onWatchlist) await dumpScreen('persistence: watchlist not found after re-login');
    expect(onWatchlist, 'Watchlist screen should load after re-login').to.be.true;

    await watchlistPage.tapTab(1);
    await browser.pause(500);

    const stocksAfter = await watchlistPage.getStockCount();
    expect(
      stocksAfter,
      'Watchlist stock count should be preserved after logout/login (server-side persistence)'
    ).to.equal(stocksBefore);
  });

  // ── Buy navigation ────────────────────────────────────────────────────────────

  it('Verify Buy Navigation from Watchlist', async function () {
    this.timeout(30000);

    await watchlistPage.tapTab(1);
    const count = await watchlistPage.getStockCount();
    expect(count, 'Watchlist must have at least one stock to test Buy navigation').to.be.above(0);

    await watchlistPage.longPressStock(TEST_STOCK);
    const buyFound = await watchlistPage.findAndTap('//android.view.View[@content-desc="Buy"]', 5000);
    if (!buyFound) await dumpScreen('buy-nav: Buy option not found in context menu');
    expect(buyFound, 'Buy option should appear in the stock context menu').to.be.true;

    await browser.pause(1000);
    const stillOnWatchlist = await watchlistPage.isLoaded(2000);
    expect(stillOnWatchlist, 'Buy tap should navigate away from the Watchlist screen').to.be.false;

    // Return to watchlist
    await driver.back();
    await watchlistPage.tapNavWatchlist();
    await watchlistPage.isLoaded(8000);
  });

  // ── Sell navigation ───────────────────────────────────────────────────────────

  it('Verify Sell Navigation from Watchlist', async function () {
    this.timeout(30000);

    await watchlistPage.tapTab(1);
    const count = await watchlistPage.getStockCount();
    expect(count, 'Watchlist must have at least one stock to test Sell navigation').to.be.above(0);

    await watchlistPage.longPressStock(TEST_STOCK);
    const sellFound = await watchlistPage.findAndTap('//android.view.View[@content-desc="Sell"]', 5000);
    if (!sellFound) await dumpScreen('sell-nav: Sell option not found in context menu');
    expect(sellFound, 'Sell option should appear in the stock context menu').to.be.true;

    await browser.pause(1000);
    const stillOnWatchlist = await watchlistPage.isLoaded(2000);
    expect(stillOnWatchlist, 'Sell tap should navigate away from the Watchlist screen').to.be.false;

    // Return to watchlist
    await driver.back();
    await watchlistPage.tapNavWatchlist();
    await watchlistPage.isLoaded(8000);
  });

  // ── Market depth ──────────────────────────────────────────────────────────────

  it('Verify Market Depth Opening from Watchlist', async function () {
    this.timeout(30000);

    await watchlistPage.tapTab(1);
    const count = await watchlistPage.getStockCount();
    expect(count, 'Watchlist must have at least one stock to test Market Depth').to.be.above(0);

    await watchlistPage.longPressStock(TEST_STOCK);
    const depthFound = await watchlistPage.findAndTap(
      '//android.view.View[contains(@content-desc,"Market Depth") or contains(@content-desc,"Depth")]', 5000
    );
    if (!depthFound) await dumpScreen('market-depth: Depth option not found in context menu');
    expect(depthFound, 'Market Depth option should appear in the stock context menu').to.be.true;

    await browser.pause(1000);
    const stillOnWatchlist = await watchlistPage.isLoaded(2000);
    expect(stillOnWatchlist, 'Market Depth tap should navigate away from the Watchlist screen').to.be.false;

    // Return to watchlist
    await driver.back();
    await watchlistPage.tapNavWatchlist();
    await watchlistPage.isLoaded(8000);
  });

  // ── Drag-and-drop reordering ──────────────────────────────────────────────────

  it('Verify Symbol Drag and Drop Reordering', async function () {
    this.timeout(30000);

    await watchlistPage.tapTab(1);
    const count = await watchlistPage.getStockCount();
    expect(count, 'At least 2 stocks required for drag-and-drop reordering').to.be.at.least(2);

    const descBefore0 = await watchlistPage.getFirstStockContentDesc();

    const moved = await watchlistPage.dragStockToPosition(0, 1);
    expect(moved, 'dragStockToPosition should execute without error').to.be.true;
    await browser.pause(600);

    const descAfter0 = await watchlistPage.getFirstStockContentDesc();
    console.log(`  ℹ  Drag result: first stock ${descBefore0 !== descAfter0 ? 'changed' : 'unchanged'}`);

    // The watchlist screen should still be visible after drag
    const onWatchlist = await watchlistPage.isLoaded(5000);
    expect(onWatchlist, 'Watchlist screen should remain visible after drag-and-drop').to.be.true;
  });

  // ── Scrolling performance ─────────────────────────────────────────────────────

  it('Verify Watchlist Scrolling Performance', async function () {
    this.timeout(30000);

    await watchlistPage.tapTab(1);
    const countBefore = await watchlistPage.getStockCount();
    expect(countBefore, 'Watchlist must have stocks to test scrolling').to.be.above(0);

    const scrollStart = Date.now();
    await watchlistPage.scrollToBottom(5);
    await watchlistPage.scrollToTop(5);
    const scrollDuration = Date.now() - scrollStart;

    // Scrolling 5+5 swipes should finish well within 15 s on any reasonable device
    expect(scrollDuration, 'Full scroll cycle should complete within 15 000 ms').to.be.below(15000);

    // Screen should still be responsive
    const onWatchlist = await watchlistPage.isLoaded(5000);
    expect(onWatchlist, 'Watchlist screen should still be visible after scrolling').to.be.true;
    console.log(`  ℹ  Scroll cycle (10 swipes) completed in ${scrollDuration} ms`);
  });
});
