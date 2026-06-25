const { expect }    = require('chai');
const watchlistPage = require('../../pages/Watchlist/WatchlistPage');
const { doLogin }   = require('../../utils/loginHelper');
const { dumpScreen }= require('../../utils/helpers');

// Run:  npx wdio config/wdio.android.conf.js --spec tests/watchlist/watchlist.symbols.spec.js

const TEST_STOCK    = 'INFY';
const TEST_STOCK_2  = 'HDFC';
const TEST_STOCK_3  = 'SBIN';
const TEST_EXCHANGE = 'NSE';

describe('Watchlist Symbols — Globe Capital Dev', () => {

  before(async function () {
    this.timeout(600000);
    await doLogin();
    const onWatchlist = await watchlistPage.isLoaded(30000);
    if (!onWatchlist) await dumpScreen('symbols-before: watchlist not found');
    expect(onWatchlist, 'Watchlist screen should be visible after login').to.be.true;
  });

  beforeEach(async () => {
    await watchlistPage.tapNavWatchlist();
    if (!await watchlistPage.isLoaded(8000))
      throw new Error('Could not return to Watchlist screen');
    // Always work on Watchlist1
    await watchlistPage.tapTab(1);
    await browser.pause(400);
  });

  // ── Add ───────────────────────────────────────────────────────────────────────

  it('Verify Add Symbol to Watchlist', async function () {
    this.timeout(30000);

    const countBefore = await watchlistPage.getStockCount();
    await watchlistPage.addStockFromSearch(TEST_STOCK, TEST_EXCHANGE);

    const countAfter = await watchlistPage.getStockCount();
    const stockVisible = await watchlistPage.isStockVisible(TEST_STOCK);

    if (!stockVisible) await dumpScreen('add-symbol: stock not visible after add');
    expect(stockVisible, `"${TEST_STOCK}" should appear in the watchlist after adding`).to.be.true;
    expect(countAfter, 'Stock count should increase after add').to.be.above(countBefore);

    // Cleanup
    await watchlistPage.longPressStock(TEST_STOCK);
    await watchlistPage.tapRemoveStockOption();
    await browser.pause(500);
  });

  // ── Remove ────────────────────────────────────────────────────────────────────

  it('Verify Remove Symbol from Watchlist', async function () {
    this.timeout(30000);

    // First add the stock so we have something to remove
    await watchlistPage.addStockFromSearch(TEST_STOCK, TEST_EXCHANGE);
    await browser.pause(500);

    const countBefore = await watchlistPage.getStockCount();
    await watchlistPage.longPressStock(TEST_STOCK);
    await watchlistPage.tapRemoveStockOption();
    await browser.pause(500);

    const countAfter  = await watchlistPage.getStockCount();
    const stillVisible = await watchlistPage.isStockVisible(TEST_STOCK);

    expect(stillVisible, `"${TEST_STOCK}" should be gone after removal`).to.be.false;
    expect(countAfter, 'Stock count should decrease after removal').to.be.below(countBefore);
  });

  // ── Multiple addition ─────────────────────────────────────────────────────────

  it('Verify Multiple Symbol Addition to Watchlist', async function () {
    this.timeout(60000);

    const stocks = [TEST_STOCK, TEST_STOCK_2, TEST_STOCK_3];
    const countBefore = await watchlistPage.getStockCount();

    for (const stock of stocks) {
      await watchlistPage.addStockFromSearch(stock, TEST_EXCHANGE);
      await browser.pause(400);
    }

    const countAfter = await watchlistPage.getStockCount();
    expect(countAfter, `Stock count should increase by ${stocks.length}`).to.be.at.least(countBefore + stocks.length);

    for (const stock of stocks) {
      const visible = await watchlistPage.isStockVisible(stock);
      expect(visible, `"${stock}" should be present in the watchlist`).to.be.true;
    }

    // Cleanup — remove the three added stocks
    for (const stock of stocks) {
      try {
        await watchlistPage.longPressStock(stock);
        await watchlistPage.tapRemoveStockOption();
        await browser.pause(400);
      } catch {}
    }
  });

  // ── Search inside watchlist ───────────────────────────────────────────────────

  it('Verify Search Inside Watchlist', async function () {
    this.timeout(30000);

    // Verify the search box is accessible and returns results
    await watchlistPage.searchStock(TEST_STOCK);

    const resultVisible = await watchlistPage.isSearchResultVisible(TEST_STOCK, TEST_EXCHANGE);
    if (!resultVisible) await dumpScreen(`search-inside: "${TEST_STOCK}" NSE result not found`);
    expect(resultVisible, `Search result for "${TEST_STOCK} ${TEST_EXCHANGE}" should be visible`).to.be.true;

    // Clear and confirm the search box resets
    await watchlistPage.clearSearch();
    const searchBoxVisible = await watchlistPage.isSearchBoxDisplayed();
    expect(searchBoxVisible, 'Search box should be visible after clearing search').to.be.true;
  });
});
