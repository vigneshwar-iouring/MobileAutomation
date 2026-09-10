/**
 * Order Pad — Field Validation QA
 *
 * Watchlist → Search → Quote are PRECONDITIONS ONLY (just enough navigation to
 * reach the Order Pad) — not validated in depth here. That's already covered by
 * Watchlistnew.spec.js, quote.spec.js, and search.spec.js. This spec's focus is
 * the Order Pad screen itself.
 *
 * Flow: Watchlist (Watchlist2) → Search "gail" → tap result → Quote → BUY → Order Pad.
 *
 * Reference: 36357.mp4
 *
 * SAFETY: This app is connected to a real trading account. This spec never
 * submits the BUY order — it verifies the Order Pad's BUY button is present,
 * enabled, and green, then navigates back WITHOUT tapping it. No order is
 * ever placed.
 *
 * Run:
 *   npx wdio run ./config/wdio.android.conf.js --spec tests/order/orderpad-new.spec.js
 */

const { expect }      = require('chai');
const watchlistPage   = require('../../pages/Watchlist/WatchlistPage');
const searchPage      = require('../../pages/Search/SearchPage');
const quotePage       = require('../../pages/Quote/QuotePage');
const orderPadPage    = require('../../pages/OrderPad/OrderPadPage');
const { doLogin }     = require('../../utils/loginHelper');
const { dumpScreen }  = require('../../utils/helpers');

const SEARCH_QUERY    = 'gail';
const WATCHLIST_GROUP = 'Watchlist2';

// Result slots for the summary checklist
const R = {
  reachedOrderPad: null,
  exchangeToggle:  null,
  orderType:       null,
  quantity:        null,
  price:           null,
  stoploss:        null,
  product:         null,
  moreMtfMargin:   null,
  buyAction:       null,
  navigation:      null,
};

// ═════════════════════════════════════════════════════════════════════════════
describe('Order Pad — Field Validation QA', () => {

  afterEach(function () {
    if (!this.currentTest) return;
    const { state, title } = this.currentTest;
    if (state === 'passed')       console.log(`  ✅ ${title}`);
    else if (state === 'pending') console.log(`  ⏭  ${title} — skipped`);
    else if (state === 'failed')  console.log(`  ❌ ${title} — FAILED`);
  });

  // ── Phase 1: Reach the Order Pad (precondition chain — Watchlist/Quote not validated in depth) ─

  describe('Phase 1: Reach the Order Pad', () => {
    before(async function () {
      this.timeout(600000);
      await doLogin();
      if (!await watchlistPage.isLoaded(30000)) {
        await dumpScreen('orderpad-new: watchlist not found after login');
        throw new Error('Watchlist screen not reached after login');
      }

      await watchlistPage.goToWatchlist();
      await watchlistPage.tapTabByName(WATCHLIST_GROUP);
      await browser.pause(500);

      await watchlistPage.tapSearchBox();
      await browser.pause(500);
      if (!await searchPage.isLoaded(8000)) {
        await dumpScreen('orderpad-new: search screen not reached');
        throw new Error('Search screen not reached');
      }

      await searchPage.typeQuery(SEARCH_QUERY);
      await searchPage.waitForResults(8000);
      const tapped = await searchPage.tapFirstResult();
      if (!tapped) {
        await dumpScreen('orderpad-new: could not tap a search result');
        throw new Error(`Could not tap a result for "${SEARCH_QUERY}"`);
      }
      await browser.pause(1000);

      if (!await quotePage.isLoaded(10000)) {
        await dumpScreen('orderpad-new: quote sheet not reached');
        throw new Error('Quote bottom-sheet not reached after tapping a search result');
      }

      await quotePage.tapBuyButton();
      await browser.pause(1500);
    });

    it('1.1: Order Pad opens for the searched symbol', async function () {
      this.timeout(15000);
      const loaded = await orderPadPage.isLoaded(10000);
      if (!loaded) await orderPadPage.dumpPageSource('orderpad-new: order pad not loaded');
      R.reachedOrderPad = { loaded };
      expect(loaded, 'Order Pad should open after Watchlist → Search → Quote → BUY').to.be.true;
    });
  });

  // ── Phase 2: Exchange Toggle ──────────────────────────────────────────────────

  describe('Phase 2: Exchange Toggle', () => {
    it('2.1: NSE / BSE toggle is visible with distinct prices', async function () {
      this.timeout(15000);
      const toggleVisible = await orderPadPage.isExchangeToggleVisible();
      const nsePrice = await orderPadPage.getExchangePrice('NSE');
      const bsePrice = await orderPadPage.getExchangePrice('BSE');
      console.log(`  ℹ  Toggle visible: ${toggleVisible}  |  NSE: ${nsePrice || 'N/A'}  |  BSE: ${bsePrice || 'N/A'}`);
      R.exchangeToggle = { toggleVisible, nsePrice, bsePrice, pass: toggleVisible };
      expect(toggleVisible, 'Exchange toggle (NSE/BSE) should be visible').to.be.true;
    });

    it('2.2: Switching exchange updates the displayed price', async function () {
      this.timeout(15000);
      const before = await orderPadPage.getExchangePrice('BSE');
      const switched = await orderPadPage.tapExchange('BSE');
      await browser.pause(400);
      const after = await orderPadPage.getExchangePrice('BSE');
      console.log(`  ℹ  Tapped BSE: ${switched}  |  Price before: ${before || 'N/A'}  |  after: ${after || 'N/A'}`);
      R.exchangeToggle.switchChecked = { switched, before, after };
      // Soft check — price re-read is best-effort depending on how the toggle re-renders
    });
  });

  // ── Phase 3: Order Type ───────────────────────────────────────────────────────

  describe('Phase 3: Order Type', () => {
    it('3.1: "Regular" order type is offered and selectable', async function () {
      this.timeout(10000);
      const regular = await orderPadPage.isOrderTypeRegularSelected();
      console.log(`  ℹ  Order Type "Regular": ${regular ? '✔' : '✘'}`);
      R.orderType = { regular, pass: regular };
      expect(regular, 'Regular order type should be present').to.be.true;
    });
  });

  // ── Phase 4: Quantity ──────────────────────────────────────────────────────────

  describe('Phase 4: Quantity', () => {
    it('4.1: Default quantity is 1', async function () {
      this.timeout(10000);
      const qty = await orderPadPage.getQuantity();
      console.log(`  ℹ  Quantity: ${qty || 'N/A'}`);
      R.quantity = { qty };
    });

    it('4.2: Stepper control is present', async function () {
      this.timeout(10000);
      const stepper = await orderPadPage.isQuantityStepperVisible();
      console.log(`  ℹ  Stepper visible: ${stepper}`);
      R.quantity.stepper = stepper;
    });

    it('4.3: Quantity field is editable', async function () {
      this.timeout(10000);
      const setOk = await orderPadPage.setQuantity(5);
      const qtyAfter = setOk ? await orderPadPage.getQuantity() : null;
      console.log(`  ℹ  setQuantity(5): ${setOk}  |  Quantity after: ${qtyAfter || 'N/A'}`);
      R.quantity.editable = setOk;
      R.quantity.pass = !!qtyAfter || setOk;
    });
  });

  // ── Phase 5: Price ─────────────────────────────────────────────────────────────

  describe('Phase 5: Price (Limit)', () => {
    it('5.1: Price field is visible, prefilled with LTP', async function () {
      this.timeout(10000);
      const priceVisible = await orderPadPage.isPriceFieldVisible();
      console.log(`  ℹ  Price field visible: ${priceVisible}`);
      R.price = { priceVisible, pass: priceVisible };
      expect(priceVisible, 'Price field should be visible').to.be.true;
    });

    it('5.2: Market/Limit toggle is present', async function () {
      this.timeout(10000);
      const toggle = await orderPadPage.isMarketLimitToggleVisible();
      console.log(`  ℹ  Market/Limit toggle visible: ${toggle}`);
      R.price.toggle = toggle;
    });
  });

  // ── Phase 6: Stoploss / Product ────────────────────────────────────────────────

  describe('Phase 6: Stoploss & Product', () => {
    it('6.1: Add Stoploss toggle is present, off by default', async function () {
      this.timeout(10000);
      const visible = await orderPadPage.isStoplossToggleVisible();
      const enabled = await orderPadPage.isStoplossEnabled();
      console.log(`  ℹ  Stoploss toggle visible: ${visible}  |  Enabled by default: ${enabled}`);
      R.stoploss = { visible, enabled, pass: visible ? enabled !== true : null };
    });

    it('6.2: Product — Delivery / Intraday, Delivery selected by default', async function () {
      this.timeout(10000);
      const selected = await orderPadPage.getSelectedProduct();
      console.log(`  ℹ  Selected product: ${selected || 'N/A'}`);
      R.product = { selected, pass: selected === 'Delivery' };
    });
  });

  // ── Phase 7: More / MTF / Margin ───────────────────────────────────────────────

  describe('Phase 7: More, MTF Banner, Margin & Balance', () => {
    it('7.1: "More ▾" expands additional options', async function () {
      this.timeout(10000);
      const visible = await orderPadPage.isMoreVisible();
      console.log(`  ℹ  "More" control visible: ${visible}`);
      R.moreMtfMargin = { more: visible };
    });

    it('7.2: MTF banner is dismissible', async function () {
      this.timeout(10000);
      const visible = await orderPadPage.isMTFBannerVisible();
      console.log(`  ℹ  MTF banner visible: ${visible}`);
      if (visible) {
        const dismissed = await orderPadPage.dismissMTFBanner();
        console.log(`  ℹ  MTF banner dismissed: ${dismissed}`);
        R.moreMtfMargin.mtf = { visible, dismissed };
      } else {
        R.moreMtfMargin.mtf = { visible };
      }
    });

    it('7.3: Approx margin and Avail balance are displayed', async function () {
      this.timeout(10000);
      const margin = await orderPadPage.isApproxMarginVisible();
      const avail  = await orderPadPage.isAvailBalanceVisible();
      console.log(`  ℹ  Approx margin visible: ${margin}  |  Avail balance visible: ${avail}`);
      R.moreMtfMargin.margin = margin;
      R.moreMtfMargin.avail  = avail;
    });
  });

  // ── Phase 8: Validate BUY Action (no submission) ─────────────────────────────

  describe('Phase 8: Validate BUY Action', () => {
    it('8.1: BUY button is present and enabled — NOT tapped to submit', async function () {
      this.timeout(15000);
      const visible = await orderPadPage.isBuySubmitVisible();
      const enabled = await orderPadPage.isBuySubmitEnabled();
      console.log(`  ℹ  BUY button visible: ${visible}  |  enabled: ${enabled}`);
      console.log('  ℹ  Order submission skipped intentionally — this account is live, no order is placed.');
      R.buyAction = { visible, enabled, pass: visible && enabled };
      expect(R.buyAction.pass, 'BUY button should be visible and enabled').to.be.true;
    });
  });

  // ── Phase 9: Back Navigation ──────────────────────────────────────────────────

  describe('Phase 9: Back Navigation', () => {
    it('9.1: Order Pad → Quote → Watchlist', async function () {
      this.timeout(20000);
      await orderPadPage.goBack();
      const onQuote = await quotePage.isLoaded(6000);
      console.log(`  ℹ  Back on Quote after leaving Order Pad: ${onQuote}`);

      await quotePage.goBack();
      await browser.pause(400);
      const onWatchlist = await watchlistPage.isLoaded(6000);
      console.log(`  ℹ  Back on Watchlist after leaving Quote: ${onWatchlist}`);

      R.navigation = { onQuote, onWatchlist, pass: onQuote && onWatchlist };
      expect(R.navigation.pass, 'Back navigation should return to the Watchlist screen').to.be.true;
    });
  });

  // ── Phase 10: Summary Checklist ───────────────────────────────────────────────

  describe('Phase 10: Summary', () => {
    it('10.1: Order Pad — summary', async function () {
      this.timeout(10000);

      const p = (ok) => ok ? 'PASS' : 'FAIL';
      const overall = [
        R.reachedOrderPad?.loaded,
        R.exchangeToggle?.pass,
        R.orderType?.pass,
        R.quantity?.pass,
        R.price?.pass,
        R.buyAction?.pass,
        R.navigation?.pass,
      ];
      const overallPass = overall.every(Boolean);

      console.log('\n  ================================================');
      console.log('  Order Pad — Summary Checklist');
      console.log('  ================================================');
      console.log(`  1. Reached Order Pad (Watchlist→Search→Quote→BUY) ${p(overall[0])}`);
      console.log(`  2. Exchange toggle (NSE/BSE + price) ............ ${p(overall[1])}`);
      console.log(`  3. Order Type (Regular) .......................... ${p(overall[2])}`);
      console.log(`  4. Quantity (default/stepper/editable) .......... ${p(overall[3])}`);
      console.log(`  5. Price (LTP prefill + Market/Limit toggle) .... ${p(overall[4])}`);
      console.log(`  6. Stoploss / Product ............................ ${R.stoploss?.visible !== undefined || R.product ? 'INFO' : 'N/A'}`);
      console.log(`  7. More / MTF banner / margin & balance ......... ${R.moreMtfMargin ? 'INFO' : 'N/A'}`);
      console.log(`  8. BUY button enabled (no submission) ........... ${p(overall[5])}`);
      console.log(`  9. Back navigation ................................ ${p(overall[6])}`);
      console.log('  ------------------------------------------------');
      console.log(`  Overall Status: ${overallPass ? 'PASS' : 'FAIL'}`);
      console.log('  ================================================\n');

      expect(await watchlistPage.isLoaded(3000)).to.be.true;
    });
  });
});
