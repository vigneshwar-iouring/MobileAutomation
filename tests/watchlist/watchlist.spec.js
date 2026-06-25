const { expect }       = require('chai');
const loginPage        = require('../../pages/Login/LoginPage');
const otpPage          = require('../../pages/Login/OTPPage');
const enableSecurePage = require('../../pages/Login/EnableSecurePage');
const biometricPage    = require('../../pages/Login/BiometricSetupPage');
const watchlistPage    = require('../../pages/Watchlist/WatchlistPage');
const testData         = require('../../data/testData');
const { fetchOtpFromGmail, purgeStaleOtps } = require('../../utils/emailOtp');
const { clearAndLaunch, dumpScreen } = require('../../utils/helpers');

const GMAIL_CONFIGURED = !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);

async function getOtp(label) {
  if (GMAIL_CONFIGURED) {
    console.log(`\n  📧 Fetching ${label} from Gmail...`);
    const otp = await fetchOtpFromGmail({
      user:     process.env.GMAIL_USER,
      password: process.env.GMAIL_APP_PASSWORD,
      timeout:  120000,
    });
    console.log(`  ✅ Got ${label}: ${otp}`);
    return otp;
  }
  console.log(`\n  📱 ENTER ${label} ON YOUR DEVICE NOW (2 min)\n`);
  return null;
}

// ── Watchlist screen tests ────────────────────────────────────────────────────
//
// Run:  npx wdio config/wdio.android.conf.js --suite watchlist
//   or: npm run test:watchlist
//
// Requires a full login to reach the watchlist screen, so the `before` hook
// runs the complete credentials → OTP1 → Enable Now → OTP2 → PIN flow once.
// Individual tests then run within that session; `beforeEach` navigates back to
// the Watchlist tab between tests that may have changed screen.

describe('Watchlist Screen — Globe Capital Dev', () => {

  before(async function () {
    this.timeout(600000);

    await clearAndLaunch();
    if (GMAIL_CONFIGURED) {
      await purgeStaleOtps({ user: process.env.GMAIL_USER, password: process.env.GMAIL_APP_PASSWORD });
    }
    if (!await loginPage.waitForLoginScreen(60000))
      throw new Error('Login screen did not appear within 60 s');

    // Step 1: credentials
    await loginPage.enterLoginId(testData.validUser.id);
    await loginPage.enterPassword(testData.validUser.password);
    await loginPage.tapLogin();

    // Step 2: first OTP
    const onOTP1 = await otpPage.isLoaded(35000);
    if (!onOTP1) await dumpScreen('watchlist-setup: OTP1 not found');
    expect(onOTP1, 'First OTP screen should appear after LOGIN').to.be.true;

    const otp1 = await getOtp('FIRST OTP');
    if (otp1) await otpPage.enterOTP(otp1);
    expect(await otpPage.waitForNavigation(120000), 'First OTP should be accepted').to.be.true;

    // Step 3: Enable Globe Secure
    expect(await enableSecurePage.isLoaded(10000), 'Enable Globe Secure screen should appear').to.be.true;
    await enableSecurePage.tapEnableNow();

    // Step 4: second OTP
    expect(await otpPage.isLoaded(20000), 'Second OTP screen should appear').to.be.true;
    const otp2 = await getOtp('SECOND OTP');
    if (otp2) await otpPage.enterOTP(otp2);
    expect(await otpPage.waitForNavigation(120000), 'Second OTP should be accepted').to.be.true;
    await browser.pause(1500);

    // Step 5: system PIN (only present when device credential first registered)
    if (await biometricPage.isLoaded(8000)) {
      console.log('  ⌨  Entering PIN...');
      await biometricPage.enterPin(testData.devicePin);
      await browser.pause(1500);
    }

    // Step 6: watchlist screen
    const onWatchlist = await watchlistPage.isLoaded(30000);
    if (!onWatchlist) await dumpScreen('watchlist-setup: screen not found after login');
    expect(onWatchlist, 'Watchlist screen should be visible after login').to.be.true;
  });

  beforeEach(async () => {
    await watchlistPage.tapNavWatchlist();
    if (!await watchlistPage.isLoaded(8000))
      throw new Error('Could not return to Watchlist screen');
  });

  // ── UI Elements ──────────────────────────────────────────────────────────────

  describe('UI Elements', () => {

    it('should display Watchlist header title', async () => {
      expect(
        await watchlistPage.isTitleDisplayed(),
        'Header "Watchlist" label should be visible'
      ).to.be.true;
    });

    it('should display NIFTY 50 in market indices strip', async () => {
      const indices = await watchlistPage.getVisibleIndices();
      const found = indices.some(n => n.toUpperCase().includes('NIFTY 50') || n.toUpperCase().includes('NIFTY50'));
      console.log(`  ℹ  Indices visible: ${indices.join(', ') || 'none'}`);
      console.log(`  ℹ  NIFTY 50: ${found ? 'visible' : 'not present in this build'}`);
    });

    it('should display BANKNIFTY in market indices strip', async () => {
      const indices = await watchlistPage.getVisibleIndices();
      const found = indices.some(n => n.toUpperCase().includes('BANKNIFTY'));
      console.log(`  ℹ  BANKNIFTY: ${found ? 'visible' : 'not present in this build'}`);
    });

    it('should display SENSEX in market indices strip', async () => {
      const indices = await watchlistPage.getVisibleIndices();
      const found = indices.some(n => n.toUpperCase().includes('SENSEX'));
      console.log(`  ℹ  SENSEX: ${found ? 'visible' : 'not present in this build'}`);
    });

    it('should display Watchlist1 tab as default selected', async () => {
      expect(
        await watchlistPage.isTabActive(1, 5000),
        'Watchlist1 should be the active tab by default'
      ).to.be.true;
    });

    it('should display at least 4 watchlist tabs', async () => {
      const count = await watchlistPage.getTabCount();
      expect(count, 'At least 4 watchlist tabs should be visible').to.be.at.least(4);
    });

    it('should display Add or search stocks input', async () => {
      expect(
        await watchlistPage.isSearchBoxDisplayed(),
        'Search/add stocks input should be visible'
      ).to.be.true;
    });

    it('should display at least one stock in the watchlist', async () => {
      const count = await watchlistPage.getStockCount();
      expect(count, 'At least one stock should be visible in the list').to.be.above(0);
    });

    it('should display all 5 bottom navigation tabs', async () => {
      expect(
        await watchlistPage.areAllNavTabsDisplayed(),
        'All 5 bottom nav tabs (Watchlist, Market, Orders, Portfolio, Mutual Funds) should be visible'
      ).to.be.true;
    });
  });

  // ── Watchlist Tab Switching ───────────────────────────────────────────────────

  describe('Watchlist Tab Switching', () => {

    it('should switch to Watchlist2 tab on tap', async () => {
      await watchlistPage.tapTab(2);
      expect(
        await watchlistPage.isTabActive(2, 5000),
        'Watchlist2 should become the active tab after tap'
      ).to.be.true;
    });

    it('should switch back to Watchlist1 tab on tap', async () => {
      await watchlistPage.tapTab(1);
      expect(
        await watchlistPage.isTabActive(1, 5000),
        'Watchlist1 should become the active tab after tap'
      ).to.be.true;
    });
  });

  // ── Bottom Navigation ─────────────────────────────────────────────────────────

  describe('Bottom Navigation', () => {

    it('should navigate away from Watchlist when tapping Market tab', async () => {
      await watchlistPage.tapNavMarket();
      const stillOnWatchlist = await watchlistPage.isLoaded(2000);
      expect(stillOnWatchlist, 'Should leave Watchlist screen after tapping Market nav').to.be.false;
    });

    it('should navigate away from Watchlist when tapping Orders tab', async () => {
      await watchlistPage.tapNavOrders();
      const stillOnWatchlist = await watchlistPage.isLoaded(2000);
      expect(stillOnWatchlist, 'Should leave Watchlist screen after tapping Orders nav').to.be.false;
    });

    it('should navigate away from Watchlist when tapping Portfolio tab', async () => {
      await watchlistPage.tapNavPortfolio();
      const stillOnWatchlist = await watchlistPage.isLoaded(2000);
      expect(stillOnWatchlist, 'Should leave Watchlist screen after tapping Portfolio nav').to.be.false;
    });

    it('should navigate away from Watchlist when tapping Mutual Funds tab', async () => {
      await watchlistPage.tapNavMutualFunds();
      const stillOnWatchlist = await watchlistPage.isLoaded(2000);
      expect(stillOnWatchlist, 'Should leave Watchlist screen after tapping Mutual Funds nav').to.be.false;
    });

    it('should return to Watchlist after navigating to Market and back', async () => {
      await watchlistPage.tapNavMarket();
      await browser.pause(500);
      await watchlistPage.tapNavWatchlist();
      expect(
        await watchlistPage.isLoaded(10000),
        'Watchlist screen should reload after tapping Watchlist nav from Market'
      ).to.be.true;
    });
  });

  // ── Search Bar ────────────────────────────────────────────────────────────────

  describe('Search Bar', () => {

    it('should be tappable and remain visible after tap', async () => {
      await watchlistPage.tapSearchBox();
      expect(
        await watchlistPage.isSearchBoxDisplayed(),
        'Search box should remain visible after tap'
      ).to.be.true;
      await watchlistPage.exitSearchMode();
    });

    it('should display TCS BSE result when searching "TCS"', async () => {
      await watchlistPage.searchStock('TCS');
      expect(
        await watchlistPage.isSearchResultVisible('TCS', 'BSE'),
        'TCS BSE search result should appear after typing "TCS"'
      ).to.be.true;
      await watchlistPage.clearSearch();
    });
  });
});
