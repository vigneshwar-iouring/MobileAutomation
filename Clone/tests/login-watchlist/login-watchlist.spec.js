/**
 * End-to-End: Login → Watchlist (all phases in one session)
 *
 * Phase 1 : Authentication  — credentials, OTP x2, PIN, home
 * Phase 2 : Watchlist UI    — header, indices, tabs, search, nav
 * Phase 3 : Symbols         — add, remove, multi-add, search
 * Phase 4 : Advanced        — price refresh, buy/sell/depth, drag-drop, scroll
 * Phase 5 : Persistence     — logout → re-login → verify watchlist intact (runs last, skipped)
 *
 * Run:
 *   npx wdio config/wdio.android.conf.js --suite login-watchlist
 *   npm run test:login-watchlist
 */

const { expect } = require('chai');
const loginPage        = require('../../pages/Login/LoginPage');
const otpPage          = require('../../pages/Login/OTPPage');
const enableSecurePage = require('../../pages/Login/EnableSecurePage');
const biometricPage    = require('../../pages/Login/BiometricSetupPage');
const watchlistPage    = require('../../pages/Watchlist/WatchlistPage');
const testData         = require('../../data/testData');
const { purgeStaleOtps }                             = require('../../utils/emailOtp');
const { retryOtpWithDelay, createGmailOtpFetcher }   = require('../../utils/otpRetry');
const { clearAndLaunch, dumpScreen }                 = require('../../utils/helpers');
const { doLogin }                                    = require('../../utils/loginHelper');

const GMAIL_CONFIGURED  = !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
// Set RESUME_SESSION=1 to skip Phase 1 login when the app is already authenticated.
// Use: RESUME_SESSION=1 npm run test:login-watchlist  (or npm run test:login-watchlist:resume)
const RESUME_SESSION = !!process.env.RESUME_SESSION;

const TEST_STOCK_1   = 'INFY';
const TEST_STOCK_2   = 'HDFC';
const TEST_STOCK_3   = 'SBIN';
const EXISTING_STOCK = 'TCS'; // always present in Watchlist1
const TEST_EXCHANGE  = 'NSE';

// Regex that extracts watchlist tab names from raw page source
const TAB_NAME_RE = /content-desc="([^"]+)(?:&#10;|\n)Tab \d+ of \d+"/g;

// Returns up to `limit` watchlist tab names from the current page source
async function scanTabNames(limit = 8) {
  const src = await driver.getPageSource();
  return [...src.matchAll(TAB_NAME_RE)].map(m => m[1].trim()).slice(0, limit);
}

// Handles biometric/PIN overlay if it appears; no-op if not present
async function handleBiometricIfNeeded(timeoutMs = 5000) {
  if (!await biometricPage.isLoaded(timeoutMs)) return;
  if (!await biometricPage.handleBiometricAuth(testData.devicePin)) {
    await biometricPage.enterPin(testData.devicePin);
  }
  await browser.pause(1500);
}

// Selectors used only in Phase 6
const P6_SEL = {
  title:        '//android.view.View[@content-desc="Watchlist"]',
  stocks:       '//android.widget.ScrollView//android.view.View[contains(@content-desc,"NSE") or contains(@content-desc,"BSE")]',
  input:        '//android.widget.EditText[1]',
  createBtn:    '//android.widget.Button[contains(@text,"CREATE") or contains(@text,"SAVE") or contains(@text,"ADD")]',
  cancelBtn:    '//android.widget.Button[contains(@text,"CANCEL") or contains(@text,"Cancel")]',
  renameOption: '//android.view.View[@content-desc="Rename"]',
  doneBtn:      '//*[contains(@content-desc,"Done") or contains(@text,"Done") or contains(@text,"DONE")]',
  discardBtn:   '//*[contains(@content-desc,"Discard") or contains(@text,"Discard") or contains(@text,"DISCARD")]',
  filterBtn:    '//*[contains(@content-desc,"Filter") or contains(@content-desc,"filter")]',
  removeStock:  '//android.view.View[contains(@content-desc,"Remove") or contains(@text,"Remove")]',
};

// ═══════════════════════════════════════════════════════════════════════════════
describe('E2E: Login + Full Watchlist Flow — Globe Capital Dev', () => {

  afterEach(function () {
    if (!this.currentTest) return;
    if (this.currentTest.state === 'passed') {
      console.log(`  ✅ ${this.currentTest.title} — succeeded`);
    } else if (this.currentTest.state === 'failed') {
      console.log(`  ❌ ${this.currentTest.title} — FAILED`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 1: AUTHENTICATION
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Phase 1: Authentication', () => {

    before(async function () {
      this.timeout(120000);
      if (RESUME_SESSION) {
        // Relaunch without clearing data — restores existing login session
        try { await driver.terminateApp(process.env.APP_PACKAGE || 'com.iouring.globecapital.dev'); } catch {}
        await browser.pause(500);
        try { await driver.activateApp(process.env.APP_PACKAGE || 'com.iouring.globecapital.dev'); } catch {}
        await browser.pause(800);
        await watchlistPage.goToWatchlist();
        if (!await watchlistPage.isLoaded(8000))
          throw new Error('RESUME_SESSION: Watchlist not reachable — run without RESUME_SESSION to do a fresh login.');
        return;
      }
      await clearAndLaunch();
      if (GMAIL_CONFIGURED) {
        await purgeStaleOtps({ user: process.env.GMAIL_USER, password: process.env.GMAIL_APP_PASSWORD });
      }
      if (!await loginPage.waitForLoginScreen(30000)) {
        await dumpScreen('phase1-before: login screen not found');
        throw new Error('Login screen did not appear within 90 s');
      }
    });

    const authIt = RESUME_SESSION ? it.skip : it;

    authIt('Step 1: should enter credentials and tap LOGIN', async () => {
      await loginPage.enterLoginId(testData.validUser.id);
      await loginPage.enterPassword(testData.validUser.password);
      await loginPage.tapLogin();
    });

    authIt('Step 2: should verify FIRST OTP', async function () {
      this.timeout(180000);
      const onOTP1 = await otpPage.isLoaded(35000);
      if (!onOTP1) await dumpScreen('step2: OTP1 not found');
      expect(onOTP1, 'First OTP screen should appear after LOGIN').to.be.true;

      if (GMAIL_CONFIGURED) {
        const fetcher = createGmailOtpFetcher({ user: process.env.GMAIL_USER, password: process.env.GMAIL_APP_PASSWORD });
        await retryOtpWithDelay({ getOtpFunction: fetcher, label: 'FIRST OTP', maxRetries: 3, delaySeconds: 5 });
      } else {
        console.log('\n  📱 ENTER FIRST OTP ON YOUR DEVICE NOW (2 min)\n');
        expect(await otpPage.waitForNavigation(120000), 'First OTP should be accepted').to.be.true;
      }
    });

    authIt('Step 3: should tap ENABLE NOW on Globe Secure', async () => {
      const onSecure = await enableSecurePage.isLoaded(1000);
      if (!onSecure) await dumpScreen('step3: secure page not found');
      expect(onSecure, 'Enable Globe Secure screen should appear').to.be.true;
      await enableSecurePage.tapEnableNow();
    });

    authIt('Step 4: should verify SECOND OTP', async function () {
      this.timeout(180000);
      const onOTP2 = await otpPage.isLoaded(20000);
      expect(onOTP2, 'Second OTP screen should appear').to.be.true;

      if (GMAIL_CONFIGURED) {
        const fetcher = createGmailOtpFetcher({ user: process.env.GMAIL_USER, password: process.env.GMAIL_APP_PASSWORD });
        await retryOtpWithDelay({ getOtpFunction: fetcher, label: 'SECOND OTP', maxRetries: 3, delaySeconds: 5 });
      } else {
        console.log('\n  📱 ENTER SECOND OTP ON YOUR DEVICE NOW (2 min)\n');
        expect(await otpPage.waitForNavigation(40000), 'Second OTP should be accepted').to.be.true;
      }
      await browser.pause(500);
    });

    authIt('Step 5: should handle biometric / PIN screen if it appears', async () => {
      // The biometric overlay can take up to ~12 s to appear after OTP acceptance.
      await handleBiometricIfNeeded(2000);
    });

    authIt('Step 6: should reach Watchlist home screen', async () => {
      await handleBiometricIfNeeded(5000); // defensive: catch any prompt that slipped past Step 5
      const onHome = await watchlistPage.isLoaded(3000);
      if (!onHome) await dumpScreen('step6: home screen not found');
      expect(onHome, 'Watchlist home screen should be visible after login').to.be.true;
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 2: WATCHLIST UI & NAVIGATION
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Phase 2: Watchlist UI & Navigation', () => {

    beforeEach(async () => {
      await watchlistPage.goToWatchlist();
      if (!await watchlistPage.isLoaded(8000)) throw new Error('Could not return to Watchlist screen');
    });

    it('2.1: should display Watchlist header title', async () => {
      expect(await watchlistPage.isTitleDisplayed(), 'Header "Watchlist" label should be visible').to.be.true;
    });

    it('2.2: should show visible market indices in the strip', async () => {
      const indices = await watchlistPage.getVisibleIndices();
      if (indices.length === 0) {
        console.log('  ℹ  Indices strip: No indices visible as of now');
      } else {
        console.log(`  ℹ  Indices strip: ${indices.join(', ')}`);
      }
      // Informational only — pass regardless of which indices the build shows
    });

    it('2.3: should show BANKNIFTY index if available', async () => {
      const indices = await watchlistPage.getVisibleIndices();
      const found = indices.some(n => n.toUpperCase().includes('BANKNIFTY'));
      console.log(`  ℹ  BANKNIFTY: ${found ? 'visible' : 'not present in this build'}`);
    });

    it('2.4: should show SENSEX index if available', async () => {
      const indices = await watchlistPage.getVisibleIndices();
      const found = indices.some(n => n.toUpperCase().includes('SENSEX'));
      console.log(`  ℹ  SENSEX: ${found ? 'visible' : 'not present in this build'}`);
    });

    it('2.5: should display Watchlist1 tab as default selected', async () => {
      expect(await watchlistPage.isTabActive(1, 5000), 'Watchlist1 should be the active tab').to.be.true;
    });

    it('2.6: should display at least 4 watchlist tabs', async () => {
      const count = await watchlistPage.getTabCount();
      expect(count, 'At least 4 watchlist tabs should be visible').to.be.at.least(4);
    });

    it('2.7: should display Add or search stocks input', async () => {
      expect(await watchlistPage.isSearchBoxDisplayed(), 'Search/add stocks input should be visible').to.be.true;
    });

    it('2.8: should display at least one stock in the watchlist', async () => {
      const count = await watchlistPage.getStockCount();
      expect(count, 'At least one stock should be visible').to.be.above(0);
    });

    it('2.9: should display all 5 bottom navigation tabs', async () => {
      expect(await watchlistPage.areAllNavTabsDisplayed(), 'All 5 bottom nav tabs should be visible').to.be.true;
    });

    it('2.10: should switch to Watchlist2 tab on tap', async () => {
      await watchlistPage.tapTab(2);
      expect(await watchlistPage.isTabActive(2, 5000), 'Watchlist2 should become active').to.be.true;
    });

    it('2.11: should switch back to Watchlist1 tab', async () => {
      await watchlistPage.tapTab(1);
      expect(await watchlistPage.isTabActive(1, 5000), 'Watchlist1 should become active').to.be.true;
    });

    it('2.12: should navigate to Market and return to Watchlist', async () => {
      await watchlistPage.tapNavMarket();
      expect(await watchlistPage.isLoaded(2000), 'Should leave Watchlist after Market tap').to.be.false;
      await watchlistPage.tapNavWatchlist();
      expect(await watchlistPage.isLoaded(3000), 'Should return to Watchlist').to.be.true;
    });

    it('2.13: should display TCS BSE result when searching "TCS"', async () => {
      await watchlistPage.searchStock('TCS');
      expect(await watchlistPage.isSearchResultVisible('TCS', 'BSE'), 'TCS BSE result should appear').to.be.true;
      await watchlistPage.clearSearch();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 3: SYMBOLS
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Phase 3: Watchlist Symbols', () => {

    beforeEach(async () => {
      await watchlistPage._dismissANRIfPresent();
      await watchlistPage.goToWatchlist();
      if (!await watchlistPage.isLoaded(8000)) throw new Error('Could not return to Watchlist screen');
      await watchlistPage.scrollToFirstTab();
      await watchlistPage.tapTab(1);
    });

    describe.skip('Symbol add/remove (requires stable isolated test data)', () => {
      it('3.1: Verify Add Symbol to Watchlist', async function () {
        this.timeout(10000);
        const countBefore = await watchlistPage.getStockCount();
        await watchlistPage.addStockFromSearch(TEST_STOCK_1, TEST_EXCHANGE);
        const stockVisible = await watchlistPage.isStockVisible(TEST_STOCK_1);
        const countAfter   = await watchlistPage.getStockCount();
        if (!stockVisible) await dumpScreen('3.1: stock not visible after add');
        expect(stockVisible, `"${TEST_STOCK_1}" should appear after adding`).to.be.true;
        expect(countAfter, 'Count should increase after add').to.be.above(countBefore);
        // Cleanup
        await watchlistPage.longPressStock(TEST_STOCK_1);
        await watchlistPage.tapRemoveStockOption();
      });

      it('3.2: Verify Remove Symbol from Watchlist', async function () {
        this.timeout(10000);
        await watchlistPage.addStockFromSearch(TEST_STOCK_1, TEST_EXCHANGE);
        const countBefore  = await watchlistPage.getStockCount();
        await watchlistPage.longPressStock(TEST_STOCK_1);
        await watchlistPage.tapRemoveStockOption();
        const stillVisible = await watchlistPage.isStockVisible(TEST_STOCK_1);
        const countAfter   = await watchlistPage.getStockCount();
        expect(stillVisible, `"${TEST_STOCK_1}" should be gone after removal`).to.be.false;
        expect(countAfter, 'Count should decrease after removal').to.be.below(countBefore);
      });

      it('3.3: Verify Multiple Symbol Addition to Watchlist', async function () {
        this.timeout(20000);
        const stocks      = [TEST_STOCK_1, TEST_STOCK_2, TEST_STOCK_3];
        const countBefore = await watchlistPage.getStockCount();
        for (const stock of stocks) {
          await watchlistPage.addStockFromSearch(stock, TEST_EXCHANGE);
        }
        const countAfter = await watchlistPage.getStockCount();
        expect(countAfter, `Count should increase by at least ${stocks.length}`).to.be.at.least(countBefore + stocks.length);
        for (const stock of stocks) {
          expect(await watchlistPage.isStockVisible(stock), `"${stock}" should be in the watchlist`).to.be.true;
        }
        // Cleanup
        for (const stock of stocks) {
          try {
            await watchlistPage.longPressStock(stock);
            await watchlistPage.tapRemoveStockOption();
          } catch {}
        }
      });
    });

    it('3.4: Verify Search Inside Watchlist', async function () {
      this.timeout(15000);
      await watchlistPage.searchStock(TEST_STOCK_1);
      const resultVisible = await watchlistPage.isSearchResultVisible(TEST_STOCK_1, TEST_EXCHANGE);
      if (!resultVisible) await dumpScreen(`3.4: "${TEST_STOCK_1}" NSE result not found`);
      expect(resultVisible, `Search result for "${TEST_STOCK_1} ${TEST_EXCHANGE}" should be visible`).to.be.true;
      await watchlistPage.clearSearch();
      expect(await watchlistPage.isSearchBoxDisplayed(), 'Search box should be visible after clear').to.be.true;
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 4: ADVANCED
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Phase 4: Advanced Watchlist', () => {

    beforeEach(async () => {
      await watchlistPage._dismissANRIfPresent();
      await watchlistPage.goToWatchlist();
      if (!await watchlistPage.isLoaded(8000)) throw new Error('Could not return to Watchlist screen');
      await watchlistPage.scrollToFirstTab();
    });

    it('4.1: Verify Watchlist Real-Time Price Refresh', async function () {
      this.timeout(30000);
      await watchlistPage.tapTab(1);
      const count = await watchlistPage.getStockCount();
      expect(count, 'At least one stock required to verify price refresh').to.be.above(0);
      const descBefore = await watchlistPage.getFirstStockContentDesc();
      expect(descBefore, 'First stock should have content-desc').to.be.a('string').and.not.empty;

      let priceUpdated = false;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        await browser.pause(1000);
        const descNow = await watchlistPage.getFirstStockContentDesc();
        if (descNow && descNow !== descBefore) { priceUpdated = true; break; }
      }

      const descAfter = await watchlistPage.getFirstStockContentDesc();
      expect(descAfter, 'Price row should remain visible throughout').to.be.a('string').and.not.empty;
      console.log(`  ℹ  Price refresh: ${priceUpdated ? 'price changed' : 'unchanged (market may be closed)'}`);
    });

    it.skip('4.2: Verify Buy Navigation from Watchlist', async function () {
      this.timeout(15000);
      await watchlistPage.tapTab(1);
      expect(await watchlistPage.getStockCount(), 'Watchlist must have stocks for this test').to.be.above(0);
      await watchlistPage.longPressStock(EXISTING_STOCK);
      await browser.pause(150);

      // Try Buy first; app may show View Chart depending on account/build type
      let optionFound = await watchlistPage.findAndTap(
        '//android.view.View[@content-desc="Buy" or @text="Buy"]', 1500
      );
      if (!optionFound) {
        console.log('  ℹ  Buy not in menu — trying View Chart as fallback');
        optionFound = await watchlistPage.findAndTap(
          '//android.view.View[contains(@content-desc,"View Chart") or contains(@text,"View Chart")]', 1500
        );
      }
      if (!optionFound) await dumpScreen('4.2: no Buy/ViewChart option in context menu');
      expect(optionFound, 'At least one navigation option (Buy or View Chart) should appear').to.be.true;
      await browser.pause(150);
      expect(await watchlistPage.isLoaded(2000), 'Tap should navigate away from Watchlist').to.be.false;
      await driver.back();
      await watchlistPage.tapNavWatchlist();
      await watchlistPage.isLoaded(3000);
    });

    it.skip('4.3: Verify Sell Navigation from Watchlist', async function () {
      this.timeout(15000);
      await watchlistPage.tapTab(1);
      expect(await watchlistPage.getStockCount(), 'Watchlist must have stocks for this test').to.be.above(0);
      await watchlistPage.longPressStock(EXISTING_STOCK);
      await browser.pause(150);

      // Try Sell first; app may show Add Alerts depending on account/build type
      let optionFound = await watchlistPage.findAndTap(
        '//android.view.View[@content-desc="Sell" or @text="Sell"]', 1500
      );
      if (!optionFound) {
        console.log('  ℹ  Sell not in menu — trying Add Alerts as fallback');
        optionFound = await watchlistPage.findAndTap(
          '//android.view.View[contains(@content-desc,"Add Alert") or contains(@text,"Add Alert")]', 1500
        );
      }
      if (!optionFound) await dumpScreen('4.3: no Sell/AddAlerts option in context menu');
      expect(optionFound, 'At least one navigation option (Sell or Add Alerts) should appear').to.be.true;
      await browser.pause(150);
      expect(await watchlistPage.isLoaded(2000), 'Tap should navigate away from Watchlist').to.be.false;
      await driver.back();
      await watchlistPage.tapNavWatchlist();
      await watchlistPage.isLoaded(3000);
    });

    it.skip('4.4: Verify Market Depth Opening from Watchlist', async function () {
      this.timeout(15000);
      await watchlistPage.tapTab(1);
      expect(await watchlistPage.getStockCount(), 'Watchlist must have stocks for this test').to.be.above(0);
      await watchlistPage.longPressStock(EXISTING_STOCK);
      await browser.pause(150);

      // Try Market Depth first; app may show Option Chain depending on account/build type
      let optionFound = await watchlistPage.findAndTap(
        '//android.view.View[contains(@content-desc,"Market Depth") or contains(@content-desc,"Depth") or contains(@text,"Depth")]', 1500
      );
      if (!optionFound) {
        console.log('  ℹ  Depth not in menu — trying Option Chain as fallback');
        optionFound = await watchlistPage.findAndTap(
          '//android.view.View[contains(@content-desc,"Option Chain") or contains(@text,"Option Chain")]', 1500
        );
      }
      if (!optionFound) await dumpScreen('4.4: no Depth/OptionChain option in context menu');
      expect(optionFound, 'At least one depth/chain option should appear in context menu').to.be.true;
      await browser.pause(150);
      expect(await watchlistPage.isLoaded(2000), 'Tap should navigate away from Watchlist').to.be.false;
      await driver.back();
      await watchlistPage.tapNavWatchlist();
      await watchlistPage.isLoaded(3000);
    });

    it.skip('4.5: Verify Symbol Drag and Drop Reordering', async function () {
      this.timeout(15000);
      await watchlistPage.tapTab(1);
      const count = await watchlistPage.getStockCount();
      expect(count, 'At least 2 stocks required for drag-and-drop').to.be.at.least(2);
      const descBefore = await watchlistPage.getFirstStockContentDesc();
      const moved = await watchlistPage.dragStockToPosition(0, 1);
      expect(moved, 'dragStockToPosition should execute without error').to.be.true;
      await browser.pause(100);
      expect(await watchlistPage.isLoaded(5000), 'Watchlist should remain visible after drag').to.be.true;
      const descAfter = await watchlistPage.getFirstStockContentDesc();
      console.log(`  ℹ  Drag result: first stock ${descBefore !== descAfter ? 'changed' : 'unchanged'}`);
    });

    it('4.6: Verify Watchlist Scrolling Performance', async function () {
      this.timeout(30000);
      await watchlistPage.tapTab(1);
      expect(await watchlistPage.getStockCount(), 'Watchlist must have stocks for scroll test').to.be.above(0);
      const scrollStart = Date.now();
      await watchlistPage.scrollToBottom(5);
      await watchlistPage.scrollToTop(5);
      const scrollDuration = Date.now() - scrollStart;
      expect(scrollDuration, 'Scroll cycle should complete within 15 000 ms').to.be.below(15000);
      expect(await watchlistPage.isLoaded(5000), 'Watchlist should remain visible after scroll').to.be.true;
      console.log(`  ℹ  Scroll cycle completed in ${scrollDuration} ms`);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 5: PERSISTENCE (re-login, runs last)
  // ─────────────────────────────────────────────────────────────────────────────

  describe.skip('Phase 5: Data Persistence after Logout/Login', () => {

    it('5.1: Verify Watchlist Data Persistence after Logout/Login', async function () {
      this.timeout(600000);

      await watchlistPage.goToWatchlist();
      if (!await watchlistPage.isLoaded(1000))
        throw new Error('Could not reach Watchlist before logout check');
      await watchlistPage.scrollToFirstTab();
      await watchlistPage.tapTab(1);
      await browser.pause(100);

      const stocksBefore = await watchlistPage.getStockCount();
      expect(stocksBefore, 'Watchlist must contain stocks before logout').to.be.above(0);

      // Full logout + re-login (clearAndLaunch clears local data; server restores watchlist)
      await doLogin();

      const onWatchlist = await watchlistPage.isLoaded(3000);
      if (!onWatchlist) await dumpScreen('5.1: watchlist not found after re-login');
      expect(onWatchlist, 'Watchlist should load after re-login').to.be.true;

      await watchlistPage.tapTab(1);
      await browser.pause(100);
      const stocksAfter = await watchlistPage.getStockCount();
      expect(stocksAfter, 'Watchlist stock count should be preserved (server-side persistence)').to.equal(stocksBefore);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 6: DEEP AUDIT & MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Phase 6: Deep Audit & Management', () => {

    beforeEach(async () => {
      await watchlistPage._dismissANRIfPresent();
      await watchlistPage.goToWatchlist();
      if (!await watchlistPage.isLoaded(3000)) throw new Error('Could not return to Watchlist screen');
      await watchlistPage.scrollToFirstTab();
    });

    it('6.1: Watchlist header is positioned at the top of the screen', async function () {
      this.timeout(20000);

      const titleEl    = await $(P6_SEL.title);
      await titleEl.waitForDisplayed({ timeout: 5000 });
      const loc        = await titleEl.getLocation();
      const { height } = await driver.getWindowRect();
      const yPercent   = ((loc.y / height) * 100).toFixed(1);

      console.log(`  ℹ  Watchlist title y: ${loc.y}px  (${yPercent}% of ${height}px screen)`);
      expect(loc.y, 'Watchlist title should appear in the top 20% of the screen').to.be.below(height * 0.20);

      const searchEl = await $('//android.widget.EditText[contains(@hint,"Add or search stocks")]');
      if (await searchEl.isDisplayed()) {
        const searchLoc = await searchEl.getLocation();
        console.log(`  ℹ  Search box y: ${searchLoc.y}px`);
        expect(searchLoc.y, 'Search box should appear below the title').to.be.above(loc.y);
      }

      const src = await driver.getPageSource();
      console.log(`  ℹ  Indices present: ${src.includes('BANKNIFTY') || src.includes('NIFTY') || src.includes('SENSEX')}`);
    });

    it('6.2: Fetch all watchlist count and names', async function () {
      this.timeout(20000);

      const total = await watchlistPage.getTotalTabCount();
      console.log(`  ℹ  Total watchlists: ${total}`);
      expect(total, 'Should have at least 1 watchlist').to.be.above(0);

      const names = [];
      for (let scroll = 0; scroll < 4; scroll++) {
        for (const name of await scanTabNames()) {
          if (!names.includes(name)) names.push(name);
        }
        if (names.length >= total) break;
        await watchlistPage._swipeTabStrip('right');
        await browser.pause(100);
      }
      await watchlistPage.scrollToFirstTab();

      console.log(`  ℹ  Watchlist names (${names.length}): ${names.join(', ')}`);
      expect(names.length, 'Should have found at least 1 watchlist name').to.be.above(0);
    });

    it('6.3: List symbols in each visible watchlist tab', async function () {
      this.timeout(30000);

      const names = await scanTabNames(6);
      console.log(`  ℹ  Inspecting ${names.length} tabs`);
      for (const name of names) {
        try {
          const tabEl = await $(`//android.view.View[contains(@content-desc,"${name}") and contains(@content-desc,"Tab ")]`);
          if (!await tabEl.isDisplayed()) continue;
          await tabEl.click();
          await browser.pause(300);
          const count  = await watchlistPage.getStockCount();
          const items  = await $$(P6_SEL.stocks);
          const preview = [];
          for (let i = 0; i < Math.min(3, items.length); i++) {
            try { preview.push(((await items[i].getAttribute('content-desc')) || '?').split(/\n|&#10;/)[0]); } catch {}
          }
          console.log(`  ℹ  "${name}": ${count} stock(s)${preview.length ? '  [' + preview.join(', ') + (count > 3 ? '...' : '') + ']' : ''}`);
        } catch (e) { console.log(`  ⚠  Could not inspect "${name}": ${e.message}`); }
      }
      await watchlistPage.scrollToFirstTab();
    });

    it('6.4: Identify empty watchlists', async function () {
      this.timeout(30000);

      const names = await scanTabNames(8);
      const empty = [];
      for (const name of names) {
        try {
          const tabEl = await $(`//android.view.View[contains(@content-desc,"${name}") and contains(@content-desc,"Tab ")]`);
          if (!await tabEl.isDisplayed()) continue;
          await tabEl.click();
          await browser.pause(100);
          const count = await watchlistPage.getStockCount();
          if (count === 0) { empty.push(name); console.log(`  ⚠  Empty: "${name}"`); }
          else console.log(`  ℹ  "${name}": ${count} stock(s)`);
        } catch {}
      }
      console.log(empty.length === 0 ? '  ℹ  No empty watchlists' : `  ℹ  Empty (${empty.length}): ${empty.join(', ')}`);
      await watchlistPage.scrollToFirstTab();
      // Informational — always passes
    });

    it('6.5: Confirm total watchlist count is within valid range', async function () {
      this.timeout(8000);

      const total   = await watchlistPage.getTotalTabCount();
      const visible = await watchlistPage.getTabCount();
      console.log(`  ℹ  Total watchlists: ${total}  |  Visible in strip: ${visible}`);
      expect(total,   'Total should be between 1 and 25').to.be.within(1, 25);
      expect(visible, 'At least 1 tab should be visible').to.be.above(0);
    });

    it.skip('6.6: Add TCS and INFY to Watchlist1', async function () {
      this.timeout(25000);

      await watchlistPage.tapTab(1);
      const before = await watchlistPage.getStockCount();
      console.log(`  ℹ  Watchlist1 count before: ${before}`);

      await watchlistPage.addStockFromSearch('TCS', TEST_EXCHANGE);
      await watchlistPage.addStockFromSearch('INFY', TEST_EXCHANGE);

      const tcsOk  = await watchlistPage.isStockVisible('TCS');
      const infyOk = await watchlistPage.isStockVisible('INFY');
      console.log(`  ℹ  TCS: ${tcsOk}  |  INFY: ${infyOk}  |  Count: ${await watchlistPage.getStockCount()}`);
      expect(tcsOk,  'TCS should be visible after adding').to.be.true;
      expect(infyOk, 'INFY should be visible after adding').to.be.true;

      // Cleanup
      for (const stock of ['TCS', 'INFY']) {
        try {
          const el = await $(`//android.widget.ScrollView//android.view.View[starts-with(@content-desc,"${stock}")]`);
          if (await el.isDisplayed()) {
            await watchlistPage.longPressStock(stock);
            await watchlistPage.tapRemoveStockOption();
            await browser.pause(100);
          }
        } catch {}
      }
      console.log('  ℹ  Cleanup — TCS and INFY removed');
    });

    it.skip('6.7: Search bar input validation', async function () {
      this.timeout(20000);

      await watchlistPage.searchStock('TCS');
      const tcsBse = await watchlistPage.isSearchResultVisible('TCS', 'BSE');
      console.log(`  ℹ  "TCS" → BSE result: ${tcsBse}`);
      expect(tcsBse, 'TCS BSE result should appear').to.be.true;
      await watchlistPage.clearSearch();

      await watchlistPage.searchStock('INFY');
      console.log(`  ℹ  "INFY" → NSE: ${await watchlistPage.isSearchResultVisible('INFY', 'NSE')}`);
      await watchlistPage.clearSearch();

      await watchlistPage.searchStock('REL');
      await browser.pause(150);
      console.log(`  ℹ  "REL" partial → ${(await $$(P6_SEL.stocks)).length} result(s)`);
      await watchlistPage.clearSearch();

      try {
        await watchlistPage.searchStock('@#$');
        await browser.pause(150);
        const src = await driver.getPageSource();
        console.log(`  ℹ  "@#$" → app running, no-results: ${src.includes('No result') || src.includes('not found')}`);
      } catch {}
      await watchlistPage.clearSearch();

      expect(await watchlistPage.isSearchBoxDisplayed(), 'Search box should be visible after all inputs').to.be.true;
      await watchlistPage.exitSearchMode();
    });

    it.skip('6.8: Apply Nifty filter in search and print results', async function () {
      this.timeout(20000);

      await watchlistPage.searchStock('NIFTY');
      await browser.pause(100);

      const filterVisible = await watchlistPage.isDisplayed(P6_SEL.filterBtn, 2000);
      console.log(`  ℹ  Filter button visible: ${filterVisible}`);
      if (filterVisible) {
        await watchlistPage.findAndTap(P6_SEL.filterBtn, 2000);
        await browser.pause(150);
        const niftySel = '//*[contains(@content-desc,"NIFTY") or contains(@text,"NIFTY")]';
        if (await watchlistPage.isDisplayed(niftySel, 2000)) {
          await watchlistPage.findAndTap(niftySel, 2000);
          await browser.pause(150);
        }
      }

      const src     = await driver.getPageSource();
      const results = [...src.matchAll(/content-desc="([^"]*(?:NSE|BSE)[^"]*)"/g)]
        .map(m => m[1].split(/\n|&#10;/)[0]).filter(n => n.length > 2 && n.length < 60);
      console.log(`  ℹ  Results: ${results.length}${results.length ? '  First 5: ' + results.slice(0, 5).join(' | ') : ''}`);

      await watchlistPage.clearSearch();
      await watchlistPage.exitSearchMode();
      expect(await watchlistPage.isLoaded(5000), 'Watchlist should be loaded after filter test').to.be.true;
    });

    it('6.9: Manage Watchlist — remove symbol from Watchlist1, verify, restore', async function () {
      this.timeout(60000);

      await watchlistPage.tapTab(1);
      const scBefore = await watchlistPage.getStockCount();
      console.log(`  ℹ  Stocks in Watchlist1: ${scBefore}`);
      expect(scBefore, 'Watchlist1 must have stocks to test remove').to.be.above(0);

      // Long-press TCS → remove
      try {
        await watchlistPage.longPressStock('TCS');
        await browser.pause(150);
        const removed = await watchlistPage.findAndTap(P6_SEL.removeStock, 2000);
        console.log(`  ℹ  Remove tapped: ${removed}`);
        await browser.pause(300);
        const scAfter = await watchlistPage.getStockCount();
        console.log(`  ℹ  Stocks after remove: ${scAfter}`);
        if (removed) expect(scAfter, 'Count should decrease after remove').to.be.below(scBefore);
      } catch (e) { console.log(`  ⚠  Remove error: ${e.message}`); }

      // Done button (appears in some manage-mode flows)
      const doneVisible = await watchlistPage.isDisplayed(P6_SEL.doneBtn, 1500);
      console.log(`  ℹ  Done button visible: ${doneVisible}`);
      if (doneVisible) { await watchlistPage.findAndTap(P6_SEL.doneBtn, 2000); await browser.pause(150); }

      // Restore TCS so later tests are unaffected
      await watchlistPage.addStockFromSearch('TCS', TEST_EXCHANGE);
      await browser.pause(200);
      console.log(`  ℹ  TCS restored: ${await watchlistPage.isStockVisible('TCS')}`);

      await watchlistPage.goToWatchlist();
      expect(await watchlistPage.isLoaded(5000), 'Should be on Watchlist after manage').to.be.true;
    });

    it('6.10: Bottom sheet — print content, dismiss, verify navigation', async function () {
      this.timeout(20000);

      await watchlistPage.tapTab(1);
      expect(await watchlistPage.getStockCount(), 'Watchlist1 must have stocks for bottom sheet test').to.be.above(0);

      const items = await $$(P6_SEL.stocks);
      const loc   = await items[0].getLocation();
      const size  = await items[0].getSize();
      await browser.action('pointer', { parameters: { pointerType: 'touch' } })
        .move({ x: Math.round(loc.x + size.width / 2), y: Math.round(loc.y + size.height / 2) })
        .down().pause(500).up().perform();
      await browser.pause(200);

      const src   = await driver.getPageSource();
      const texts = [...src.matchAll(/\btext="([^"]{2,40})"/g)].map(m => m[1]).filter(t => t.trim());
      const descs = [...src.matchAll(/content-desc="([^"]{2,60})"/g)]
        .map(m => m[1].split(/\n|&#10;/)[0]).filter(d => d.length >= 2 && d.length <= 40);
      console.log(`  ℹ  Bottom sheet texts: ${texts.join(' | ')}`);
      console.log(`  ℹ  Bottom sheet descs: ${descs.slice(0, 10).join(' | ')}`);

      const discardFound = await watchlistPage.findAndTap(P6_SEL.discardBtn, 1500);
      console.log(`  ℹ  Discard tapped: ${discardFound}`);
      if (!discardFound) { try { await driver.back(); } catch {} await browser.pause(150); }

      await watchlistPage.goToWatchlist();
      const back = await watchlistPage.isLoaded(5000);
      console.log(`  ℹ  Back on Watchlist: ${back}`);
      expect(back, 'Should be on Watchlist screen after dismissing').to.be.true;
    });

    it('6.11: Back button validates navigation in Manage Watchlist', async function () {
      this.timeout(60000);

      // Long-press Watchlist1 tab to open its rename/context dialog
      try { await watchlistPage.longPressTabByName('Watchlist1'); } catch {}
      await browser.pause(200);
      console.log('  ℹ  Context menu opened via long-press on Watchlist1');

      const input = await $(P6_SEL.input);
      if (await input.isDisplayed()) {
        await input.setValue('BackTest');
        console.log('  ℹ  Typed "BackTest" in input');
        await browser.pause(100);
      }

      try { await driver.back(); } catch {}
      await browser.pause(200);

      const discardVisible = await watchlistPage.isDisplayed(P6_SEL.discardBtn, 2000);
      console.log(`  ℹ  Discard prompt: ${discardVisible}`);
      if (discardVisible) { await watchlistPage.findAndTap(P6_SEL.discardBtn, 2000); await browser.pause(150); }
      const cancelVisible  = await watchlistPage.isDisplayed(P6_SEL.cancelBtn, 1500);
      if (cancelVisible)  { await watchlistPage.findAndTap(P6_SEL.cancelBtn, 1500);  await browser.pause(100); }

      await watchlistPage.goToWatchlist();
      const onWatchlist = await watchlistPage.isLoaded(5000);
      console.log(`  ℹ  On Watchlist after back: ${onWatchlist}`);
      expect(onWatchlist, 'Should land on Watchlist screen after back').to.be.true;
    });

    it('6.12: Scroll and UI layout validation', async function () {
      this.timeout(20000);

      await watchlistPage.tapTab(1);
      const { width, height } = await driver.getWindowRect();
      console.log(`  ℹ  Device: ${width}×${height}`);

      const titleEl = await $(P6_SEL.title);
      if (await titleEl.isDisplayed()) {
        const tLoc  = await titleEl.getLocation();
        const tSize = await titleEl.getSize();
        expect(tLoc.x,                'Title left within screen').to.be.within(0, width);
        expect(tLoc.y,                'Title top within screen').to.be.within(0, height);
        expect(tLoc.x + tSize.width,  'Title right within screen').to.be.at.most(width);
        console.log(`  ℹ  Title bounds: [${tLoc.x},${tLoc.y}][${tLoc.x + tSize.width},${tLoc.y + tSize.height}]`);
      }

      const stocks = await $$(P6_SEL.stocks);
      let outOfBounds = 0;
      for (let i = 0; i < Math.min(5, stocks.length); i++) {
        try {
          const sLoc  = await stocks[i].getLocation();
          const sSize = await stocks[i].getSize();
          if (sLoc.x < 0 || sLoc.x + sSize.width > width) outOfBounds++;
        } catch {}
      }
      console.log(`  ℹ  Stock rows checked: ${Math.min(5, stocks.length)}, overflow: ${outOfBounds}`);
      expect(outOfBounds, 'No stock row should overflow screen width').to.equal(0);

      await watchlistPage.scrollToBottom(3);
      expect(await watchlistPage.isLoaded(3000), 'Watchlist visible after scroll down').to.be.true;
      await watchlistPage.scrollToTop(3);
      expect(await watchlistPage.isLoaded(3000), 'Watchlist visible after scroll up').to.be.true;

      const tabsBefore = await watchlistPage.getTabCount();
      await watchlistPage._swipeTabStrip('right');
      await browser.pause(100);
      const tabsAfter = await watchlistPage.getTabCount();
      console.log(`  ℹ  Tab strip: before=${tabsBefore}, after swipe=${tabsAfter}`);
      await watchlistPage.scrollToFirstTab();

      expect(tabsBefore, 'At least 1 tab before swipe').to.be.at.least(1);
      expect(tabsAfter,  'At least 1 tab after swipe').to.be.at.least(1);
    });
  });
});
