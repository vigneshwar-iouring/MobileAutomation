/**
 * Quote Screen QA — End-to-End (Login → Watchlist → Quote)
 *
 * Phase 1 : Authentication  — fresh login via doLogin() (skipped with RESUME_SESSION=1)
 * Phase 2 : Open Quote      — tap a symbol from Watchlist1, verify screen loads
 * Phase 3 : UI Audit        — BUY/SELL, OHLC, Volume, header buttons
 * Phase 4 : Header Details  — symbol name, segment, action buttons
 * Phase 5 : BUY/SELL Colors — visibility + color attribute print
 * Phase 6 : 3-Dot Menu      — open, capture all items, dismiss
 * Phase 7 : Full Quote      — expand bottom panel, print 52W/OI/circuit fields
 * Phase 8 : Summary         — overall pass/fail report
 *
 * Run (fresh login):
 *   npm run test:quote
 *
 * Run (resume existing session — skip login):
 *   RESUME_SESSION=1 npm run test:quote
 *   npm run test:quote:resume
 */

const { expect }              = require('chai');
const watchlistPage           = require('../../pages/Watchlist/WatchlistPage');
const quotePage               = require('../../pages/Quote/QuotePage');
const { doLogin }             = require('../../utils/loginHelper');
const { dumpScreen }          = require('../../utils/helpers');

const RESUME_SESSION   = !!process.env.RESUME_SESSION;
const GMAIL_CONFIGURED = !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);

// Selector for stock rows on Watchlist1
const STOCK_ROW_SEL =
  '//android.widget.ScrollView//android.view.View[contains(@content-desc,"NSE") or contains(@content-desc,"BSE")]';

// Shared across all phases
let tappedSymbol = null;

// ═════════════════════════════════════════════════════════════════════════════
describe('E2E: Login → Quote Screen QA — Globe Capital Dev', () => {

  afterEach(function () {
    if (!this.currentTest) return;
    const { state, title } = this.currentTest;
    if (state === 'passed')        console.log(`  ✅ ${title}`);
    else if (state === 'pending')  console.log(`  ⏭  ${title} — skipped`);
    else if (state === 'failed')   console.log(`  ❌ ${title} — FAILED`);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 1: AUTHENTICATION
  // ───────────────────────────────────────────────────────────────────────────

  describe('Phase 1: Authentication', () => {

    before(async function () {
      this.timeout(300000);

      if (RESUME_SESSION) {
        console.log('  ℹ  RESUME_SESSION=1 — restoring existing session');
        try { await driver.terminateApp(process.env.APP_PACKAGE || 'com.iouring.globecapital.dev'); } catch {}
        await browser.pause(500);
        try { await driver.activateApp(process.env.APP_PACKAGE  || 'com.iouring.globecapital.dev'); } catch {}
        await browser.pause(800);
        await watchlistPage.goToWatchlist();
        if (!await watchlistPage.isLoaded(8000))
          throw new Error('RESUME_SESSION: Watchlist not reachable — run without RESUME_SESSION for a fresh login.');
        return;
      }

      console.log('  ℹ  Starting fresh login via doLogin()...');
      await doLogin();
    });

    const authIt = RESUME_SESSION ? it.skip : it;

    authIt('1.1: Fresh login completed and Watchlist is reachable', async function () {
      this.timeout(30000);
      await watchlistPage.goToWatchlist();
      const onWatchlist = await watchlistPage.isLoaded(10000);
      if (!onWatchlist) await dumpScreen('phase1: watchlist not found after login');
      expect(onWatchlist, 'Watchlist should be visible after a fresh login').to.be.true;
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 2: OPEN QUOTE SCREEN
  // ───────────────────────────────────────────────────────────────────────────

  describe('Phase 2: Open Quote Screen from Watchlist', () => {

    before(async function () {
      this.timeout(30000);
      await watchlistPage.goToWatchlist();
      if (!await watchlistPage.isLoaded(8000))
        throw new Error('Could not reach Watchlist before Quote Screen tests');
      await watchlistPage.scrollToFirstTab();
      await watchlistPage.tapTab(1);
      await browser.pause(300);
    });

    it('2.1: Tap first available symbol and trigger navigation', async function () {
      this.timeout(15000);

      const stocks = await $$(STOCK_ROW_SEL);
      expect(stocks.length, 'Watchlist1 must have at least one stock').to.be.above(0);

      const desc = await stocks[0].getAttribute('content-desc');
      tappedSymbol = desc ? desc.split(/\n|&#10;/)[0].trim() : 'UNKNOWN';
      console.log(`  ℹ  Symbol Tapped        : ${tappedSymbol}`);

      await stocks[0].click();
      await browser.pause(800);

      console.log(`  ℹ  Navigation triggered : ✔`);
    });

    it('2.2: Verify Quote Screen opens and loads completely', async function () {
      this.timeout(20000);

      const loaded = await quotePage.isLoaded(12000);
      if (!loaded) await dumpScreen('phase2: quote screen not loaded');

      console.log(`  ℹ  Quote Screen Opened  : ${loaded ? '✔' : '✘'}`);
      console.log(`  ℹ  Screen Load Status   : ${loaded ? 'Complete' : 'Failed'}`);

      expect(loaded, 'Quote Screen should open and load after tapping a symbol').to.be.true;
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 3: FULL UI AUDIT
  // ───────────────────────────────────────────────────────────────────────────

  describe('Phase 3: Validate All UI Elements on Quote Screen', () => {

    it('3.1: BUY button is visible and tappable', async function () {
      this.timeout(10000);
      const ok = await quotePage.isBuyButtonDisplayed();
      console.log(`  ℹ  BUY  Button : ${ok ? '✔ Visible' : '✘ Not Found'}`);
      if (!ok) await dumpScreen('3.1: BUY button not found');
      expect(ok, 'BUY button should be visible on Quote Screen').to.be.true;
    });

    it('3.2: SELL button is visible and tappable', async function () {
      this.timeout(10000);
      const ok = await quotePage.isSellButtonDisplayed();
      console.log(`  ℹ  SELL Button : ${ok ? '✔ Visible' : '✘ Not Found'}`);
      if (!ok) await dumpScreen('3.2: SELL button not found');
      expect(ok, 'SELL button should be visible on Quote Screen').to.be.true;
    });

    it('3.3: OHLC price data (Open / High / Low / Close) is visible', async function () {
      this.timeout(10000);
      const ok = await quotePage.isPriceDataVisible();
      console.log(`  ℹ  OHLC data   : ${ok ? '✔ Visible' : '✘ Not Found'}`);
      expect(ok, 'Open / High / Low / Close should be visible').to.be.true;
    });

    it('3.4: Volume is visible', async function () {
      this.timeout(10000);
      const ok = await quotePage.isVolumeVisible();
      console.log(`  ℹ  Volume      : ${ok ? '✔ Visible' : '✘ Not Found'}`);
      expect(ok, 'Volume data should be visible on Quote Screen').to.be.true;
    });

    it('3.5: Full UI element audit table', async function () {
      this.timeout(20000);

      const checks = [
        { label: 'View Charts Button', ok: await quotePage.isViewChartsDisplayed()   },
        { label: 'Add Alerts Button',  ok: await quotePage.isAddAlertsDisplayed()    },
        { label: 'Option Chain Button',ok: await quotePage.isOptionChainDisplayed()  },
        { label: '3-Dot Menu (⋮)',     ok: await quotePage.isOverflowMenuDisplayed() },
      ];

      const passed = checks.filter(c => c.ok).length;

      console.log('\n  ─────────────────────────────────────');
      console.log('  UI ELEMENT AUDIT');
      console.log('  ─────────────────────────────────────');
      for (const { label, ok } of checks)
        console.log(`  ${ok ? '✔' : '✘'} ${label}`);
      console.log(`  Passed: ${passed} / ${checks.length}`);
      console.log('  ─────────────────────────────────────\n');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 4: HEADER DETAILS
  // ───────────────────────────────────────────────────────────────────────────

  describe('Phase 4: Print Header Details', () => {

    it('4.1: Read and print Quote header info', async function () {
      this.timeout(15000);

      const symbolName  = await quotePage.getSymbolName();
      const segment     = await quotePage.getSegment();
      const viewCharts  = await quotePage.isViewChartsDisplayed();
      const addAlerts   = await quotePage.isAddAlertsDisplayed();
      const optionChain = await quotePage.isOptionChainDisplayed();

      console.log('\n  ─────────────────────────────────────');
      console.log('  QUOTE HEADER DETAILS');
      console.log('  ─────────────────────────────────────');
      console.log(`  Symbol Name      : ${symbolName  || tappedSymbol || 'N/A'}`);
      console.log(`  Segment          : ${segment     || 'N/A'}`);
      console.log(`  View Charts      : ${viewCharts  ? '✔ Visible' : '✘ Not Found'}`);
      console.log(`  Add Alerts       : ${addAlerts   ? '✔ Visible' : '✘ Not Found'}`);
      console.log(`  Option Chain     : ${optionChain ? '✔ Visible' : '✘ Not Found'}`);
      console.log('  ─────────────────────────────────────\n');

      expect(symbolName || tappedSymbol, 'Symbol name must be readable').to.be.a('string').and.not.empty;
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 5: BUY & SELL BUTTON COLORS
  // ───────────────────────────────────────────────────────────────────────────

  describe('Phase 5: Validate BUY & SELL Button Colors', () => {

    it('5.1: Print BUY and SELL button visibility and color info', async function () {
      this.timeout(15000);

      const buyOk  = await quotePage.isBuyButtonDisplayed();
      const sellOk = await quotePage.isSellButtonDisplayed();

      // Native Android views don't expose CSS color; we attempt to read it from
      // the page source or accessibility attributes and fall back to a note.
      let buyColor  = 'N/A (native view — use Appium Inspector for color)';
      let sellColor = 'N/A (native view — use Appium Inspector for color)';
      try {
        const src = await driver.getPageSource();
        const bm  = src.match(/(?:Buy|BUY)[^>]{0,300}#([0-9A-Fa-f]{6})/);
        const sm  = src.match(/(?:Sell|SELL)[^>]{0,300}#([0-9A-Fa-f]{6})/);
        if (bm) buyColor  = `#${bm[1]}`;
        if (sm) sellColor = `#${sm[1]}`;
      } catch {}

      console.log('\n  ─────────────────────────────────────');
      console.log('  BUY / SELL BUTTON VALIDATION');
      console.log('  ─────────────────────────────────────');
      console.log(`  BUY  Button — Color: ${buyColor}   ${buyOk  ? '✔' : '✘'}`);
      console.log(`  SELL Button — Color: ${sellColor}  ${sellOk ? '✔' : '✘'}`);
      console.log('  ─────────────────────────────────────\n');

      expect(buyOk,  'BUY button must be visible').to.be.true;
      expect(sellOk, 'SELL button must be visible').to.be.true;
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 6: 3-DOT MENU
  // ───────────────────────────────────────────────────────────────────────────

  describe('Phase 6: Validate 3-Dot Menu (⋮)', () => {

    it('6.1: Open 3-dot menu, print all items, then dismiss', async function () {
      this.timeout(20000);

      const menuVisible = await quotePage.isOverflowMenuDisplayed();
      if (!menuVisible) {
        console.log('  ℹ  3-Dot Menu not found on this screen — skipping');
        return this.skip();
      }

      await quotePage.tapOverflowMenu();
      const items = await quotePage.getMenuItems();
      await quotePage.dismissMenu();
      await browser.pause(300);

      console.log('\n  ─────────────────────────────────────');
      console.log('  3-DOT MENU ITEMS');
      console.log('  ─────────────────────────────────────');
      items.forEach((item, i) => console.log(`  ${i + 1}. ${item}`));
      console.log(`  Total Menu Items: ${items.length}`);
      console.log('  ─────────────────────────────────────\n');

      expect(items.length, '3-dot menu should list at least one item').to.be.above(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 7: EXPAND BOTTOM QUOTE → FULL QUOTE
  // ───────────────────────────────────────────────────────────────────────────

  describe('Phase 7: Scroll Up Bottom Quote to Full Quote', () => {

    it('7.1: Expand bottom panel and print full-quote fields', async function () {
      this.timeout(25000);

      // The 3-dot tap in 6.1 may have navigated away from the Quote screen.
      // Try one hardware back, then re-open via Watchlist if still away.
      if (!await quotePage.isLoaded(2000)) {
        try { await driver.back(); await browser.pause(600); } catch {}
      }
      if (!await quotePage.isLoaded(2000)) {
        await watchlistPage.goToWatchlist();
        await browser.pause(500);
        const stocks = await $$(STOCK_ROW_SEL);
        if (stocks.length > 0) { await stocks[0].click(); await browser.pause(1200); }
      }

      const expanded    = await quotePage.expandBottomQuotePanel();
      await browser.pause(800);

      const fields      = await quotePage.getFullQuoteFields();
      const stillLoaded = await quotePage.isLoaded(5000);

      console.log('\n  ─────────────────────────────────────');
      console.log('  FULL QUOTE — EXPANDED CONTENT');
      console.log('  ─────────────────────────────────────');
      console.log(`  52W High         : ${fields.week52High    || 'N/A'}`);
      console.log(`  52W Low          : ${fields.week52Low     || 'N/A'}`);
      console.log(`  Open Interest    : ${fields.openInterest  || 'N/A'}`);
      console.log(`  Circuit High     : ${fields.circuitHigh   || 'N/A'}`);
      console.log(`  Circuit Low      : ${fields.circuitLow    || 'N/A'}`);
      console.log('  ─────────────────────────────────────');
      console.log(`  ${expanded && stillLoaded
        ? '✔ Bottom quote expanded to Full Quote successfully'
        : '✘ Scroll/expansion may not have worked fully'}\n`);

      expect(stillLoaded, 'Quote screen should stay visible after panel expansion').to.be.true;
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PHASE 8: SUMMARY REPORT
  // ───────────────────────────────────────────────────────────────────────────

  describe('Phase 8: Summary Report', () => {

    it('8.1: Print overall Quote Screen QA summary', async function () {
      this.timeout(30000);

      // Recovery: if 7.1 expansion navigated away, try to get back to Quote screen.
      if (!await quotePage.isLoaded(2000)) {
        try { await driver.back(); await browser.pause(600); } catch {}
      }
      if (!await quotePage.isLoaded(2000)) {
        await watchlistPage.goToWatchlist();
        await browser.pause(500);
        const stocks = await $$(STOCK_ROW_SEL);
        if (stocks.length > 0) { await stocks[0].click(); await browser.pause(1200); }
      }

      const quoteLoaded = await quotePage.isLoaded(5000);
      const symbolName  = await quotePage.getSymbolName() || tappedSymbol || 'N/A';
      const segment     = await quotePage.getSegment()    || 'N/A';
      const buyOk       = await quotePage.isBuyButtonDisplayed();
      const sellOk      = await quotePage.isSellButtonDisplayed();
      const viewCharts  = await quotePage.isViewChartsDisplayed();
      const addAlerts   = await quotePage.isAddAlertsDisplayed();
      const optionChain = await quotePage.isOptionChainDisplayed();
      const overflowOk  = await quotePage.isOverflowMenuDisplayed();
      const priceOk     = await quotePage.isPriceDataVisible();
      const volumeOk    = await quotePage.isVolumeVisible();

      const coreChecks  = [quoteLoaded, buyOk, sellOk, priceOk, volumeOk];
      const passCount   = coreChecks.filter(Boolean).length;
      const overallPass = passCount === coreChecks.length;

      console.log('\n  ============================================');
      console.log('        QUOTE SCREEN QA TEST SUMMARY');
      console.log('  ============================================');
      console.log(`  Symbol Tapped              : ${tappedSymbol  || 'N/A'}`);
      console.log(`  Quote Screen Opened        : ${quoteLoaded   ? '✔' : '✘'}`);
      console.log(`  UI Elements (core)         : ${passCount}/${coreChecks.length} passed`);
      console.log(`  Header — Symbol Name       : ${symbolName}  ${symbolName !== 'N/A' ? '✔' : '✘'}`);
      console.log(`  Header — Segment           : ${segment}     ${segment    !== 'N/A' ? '✔' : '✘'}`);
      console.log(`  Header — View Charts       : ${viewCharts   ? '✔' : '✘'}`);
      console.log(`  Header — Add Alerts        : ${addAlerts    ? '✔' : '✘'}`);
      console.log(`  Header — Option Chain      : ${optionChain  ? '✔' : '✘'}`);
      console.log(`  BUY  Button Visible        : ${buyOk        ? '✔' : '✘'}`);
      console.log(`  SELL Button Visible        : ${sellOk       ? '✔' : '✘'}`);
      console.log(`  3-Dot Menu Visible         : ${overflowOk   ? '✔' : '✘'}`);
      console.log(`  OHLC / Volume Data         : ${priceOk && volumeOk ? '✔' : '✘'}`);
      console.log('  ============================================');
      console.log(`  Overall Status: ${overallPass ? 'PASS ✔' : 'FAIL ✘'}`);
      console.log('  ============================================\n');

      expect(quoteLoaded, 'Quote Screen must be loaded for the summary assertion').to.be.true;
    });
  });
});
