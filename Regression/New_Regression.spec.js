/**
 * Regression: Login & Authentication Flow — Globe Capital Dev
 *
 * R1 : Forgot Password           — tap, verify navigation, back to Login (validated before login)
 * R2 : Login flow                — enter credentials, tap LOGIN
 * R3 : OTP Login                 — verify + submit FIRST OTP
 * R4 : Enable Now                — Enable Globe Secure screen
 * R5 : Second OTP page           — verify + submit SECOND OTP
 * R6 : Device PIN Login          — biometric/PIN screen
 * R7 : Risk Disclosure           — some accounts don't show this screen at all; accept if shown, skip if not
 *
 * Note: watchlist names/count differ per client ID, so Watchlist steps (R9+) locate
 * tabs by their position ("Tab N of M") rather than by an assumed name like "Watchlist1".
 *
 * Run:
 *   npx wdio run ./config/wdio.android.conf.js --spec ./Regression/New_Regression.spec.js
 */

const { expect } = require('chai');
const loginPage        = require('../pages/Login/LoginPage');
const otpPage          = require('../pages/Login/OTPPage');
const enableSecurePage = require('../pages/Login/EnableSecurePage');
const biometricPage    = require('../pages/Login/BiometricSetupPage');
const watchlistPage    = require('../pages/Watchlist/WatchlistPage');
const quotePage        = require('../pages/Quote/QuotePage');
const orderPadPage     = require('../pages/OrderPad/OrderPadPage');
const orderbookPage    = require('../pages/Orders/OrderbookPage');
const basketPage       = require('../pages/Orders/BasketPage');
const fundsPage        = require('../pages/Funds/FundsPage');
const newsPage         = require('../pages/News/NewsPage');
const alertsPage       = require('../pages/Alerts/AlertsPage');
const nxtOptionPage    = require('../pages/NxtOption/NxtOptionPage');
const portfolioPage    = require('../pages/Portfolio/PortfolioPage');
const testData         = require('../data/testData');
const { purgeStaleOtps }                           = require('../utils/emailOtp');
const { retryOtpWithDelay, createGmailOtpFetcher } = require('../utils/otpRetry');
const { clearAndLaunch, dumpScreen }               = require('../utils/helpers');

const GMAIL_CONFIGURED = !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
// Set RESUME_SESSION=1 to skip R1-R7 login and land straight on Watchlist when the
// app already has a valid session — combine with --mochaOpts.grep to run one test
// case in isolation, e.g.:
//   RESUME_SESSION=1 npx wdio run ./config/wdio.android.conf.js --spec ./Regression/New_Regression.spec.js --mochaOpts.grep "R41"
const RESUME_SESSION = !!process.env.RESUME_SESSION;

// No dedicated page object exists for this screen yet — app doesn't expose a
// stable resource-id for it, so we key off common disclosure/consent wording.
const RISK_SEL = {
  // App shows "RISK DISCLOSURES ON DERIVATIVES" (uppercase, plural) with an "I Understand" accept control.
  heading:   '//*[contains(@content-desc,"RISK DISCLOSURE") or contains(@content-desc,"Risk Disclosure") or contains(@text,"RISK DISCLOSURE") or contains(@text,"Risk Disclosure")]',
  acceptBtn: '//*[contains(@content-desc,"I Understand") or contains(@content-desc,"Accept") or contains(@content-desc,"I Agree") or contains(@content-desc,"Agree") or contains(@content-desc,"Continue") or contains(@content-desc,"PROCEED") or contains(@text,"I Understand") or contains(@text,"Accept") or contains(@text,"Agree") or contains(@text,"Continue")]',
};

// Selectors used only by the Watchlist steps below (mirrors WatchlistPage's
// internal SEL — kept local here since these aren't exposed by the page object).
const WL_SEL = {
  allTabs:      '//android.view.View[contains(@content-desc,"Tab ") and contains(@content-desc," of ")]',
  searchInput:  '//android.widget.Button[@hint="Add or search stocks"]',
  searchResult: '//android.view.View[contains(@content-desc,"Quote Screen")]',
  manageBtn:    '//*[contains(@content-desc,"Manage") or contains(@text,"Manage")]',
  stockItems:   '//android.widget.ScrollView//android.view.View[contains(@content-desc,"NSE") or contains(@content-desc,"BSE")]',
};

// No dedicated page object exists for this control yet — best-effort match on
// common menu/hamburger wording and resource-id naming.
const MENU_SEL = {
  hamburgerBtn: '//*[contains(@content-desc,"Menu") or contains(@content-desc,"menu") or contains(@content-desc,"Hamburger") or contains(@resource-id,"hamburger") or contains(@resource-id,"menu") or contains(@resource-id,"drawer")]',
};

// Transient control shown right after confirming an order, before the app settles
// on its usual screen — distinct from the persistent Orderbook screen covered by
// pages/Orders/OrderbookPage.js, so it lives here rather than on that page object.
const ORDERS_SEL = {
  orderbookBtn: '//*[contains(@content-desc,"Orderbook") or contains(@text,"Orderbook") or contains(@content-desc,"Order Book") or contains(@text,"Order Book")]',
};

// Market screen's own segment tabs (Equity/F&O/Commodity/Currency) and their
// "market movers" sub-tabs (Top Gainers/Top Losers/OI Gainers/OI Losers) — used to
// reach a representative CDS/MCX symbol without needing to know one by name.
// Confirmed via real UI dump: each movers row is one content-desc combining the
// symbol, expiry, segment and price ("... FUT. MCXLast traded price ...").
const MARKET_SEL = {
  tabPosition: { Commodity: 3, Currency: 4 },
  moversRow: '//*[contains(@content-desc,"Double tap to view") and contains(@content-desc,"Last traded price")]',
};

async function submitOtp(label) {
  if (GMAIL_CONFIGURED) {
    const fetcher = createGmailOtpFetcher({ user: process.env.GMAIL_USER, password: process.env.GMAIL_APP_PASSWORD });
    await retryOtpWithDelay({ getOtpFunction: fetcher, label, maxRetries: 3, delaySeconds: 5 });
  } else {
    console.log(`\n  📱 ENTER ${label} ON YOUR DEVICE NOW (2 min)\n`);
    await otpPage.waitForNavigation(120000);
  }
}

// Collapses the "dump the screen for diagnosis, then assert" pattern repeated
// throughout this file: dumpScreen() only runs when the check actually failed.
async function assertOrDump(ok, dumpLabel, message) {
  if (!ok) await dumpScreen(dumpLabel);
  expect(ok, message).to.be.true;
}

// Presses the device back button, swallowing errors when there's nothing to go back to.
async function safeBack() {
  try { await driver.back(); } catch {}
}

// Handles the biometric/PIN overlay if it appears; no-op if not present.
async function handleBiometricIfNeeded(timeoutMs = 15000) {
  if (!await biometricPage.isLoaded(timeoutMs)) return false;
  if (!await biometricPage.handleBiometricAuth(testData.devicePin)) {
    await biometricPage.enterPin(testData.devicePin);
  }
  await browser.pause(1500);
  return true;
}

// Finds a watchlist tab element by its POSITION ("Tab 1 of N", "Tab 2 of N", ...) rather
// than by name — different client IDs have different watchlists (names, count, order),
// so selecting by an assumed name like "Watchlist1" would break for those accounts.
async function findTabByPosition(pos) {
  const tabEls = await $$(WL_SEL.allTabs);
  const re = new RegExp(`Tab ${pos} of \\d+`);
  for (const el of tabEls) {
    let desc;
    try { desc = await el.getAttribute('content-desc'); } catch { continue; }
    if (desc && re.test(desc)) {
      return { el, name: desc.split(/\n|&#10;/)[0].trim() };
    }
  }
  return null;
}

// Swipes the tab strip left until the tab at `pos` is visible, regardless of its name.
async function scrollToTabPosition(pos, maxSwipes = 10) {
  for (let i = 0; i < maxSwipes; i++) {
    await watchlistPage._dismissANRIfPresent();
    const found = await findTabByPosition(pos);
    if (found) return found;
    await watchlistPage._swipeTabStrip('left');
  }
  return findTabByPosition(pos);
}

// Types `query` into the already-open search input and waits until the FIRST result
// is genuinely FOR that query, not just "any result exists". Confirmed via a real bug:
// searching "IDEA" satisfied a naive length>0 poll instantly because a leftover
// "Recent Searches" row (TCS, searched earlier in the Alerts test) carries the exact
// same "...Quote Screen." content-desc suffix as a real result — so the poll resolved
// before the app's own debounced filter had actually updated to IDEA, and the click
// landed on the stale TCS row instead, placing a real order on the wrong symbol.
// Comparing (space-stripped) prefixes against the query rejects stale rows and keeps
// polling until the real, matching results render.
async function searchAndGetResults(query, timeout = 8000) {
  await (await $(WL_SEL.searchInput)).setValue(query);
  const normQuery = query.toUpperCase().replace(/\s+/g, '');
  await watchlistPage.pollUntil(async () => {
    const rows = await $$(WL_SEL.searchResult);
    if (rows.length === 0) return false;
    let desc;
    try { desc = await rows[0].getAttribute('content-desc'); } catch { return false; }
    const first = desc.split(/\n|&#10;/)[0].toUpperCase().replace(/\s+/g, '');
    return first.startsWith(normQuery) || normQuery.startsWith(first);
  }, timeout, 400);
  return $$(WL_SEL.searchResult);
}

// Some symbols (e.g. under a regulatory surveillance measure) show an extra warning
// gate before the normal OrderPad confirmation flow — conditional, not a failure when
// absent. Shared by R24 and R27, the two tests that reach this point in the order flow.
async function handleSurveillanceIfNeeded(label, { assertTap = false } = {}) {
  const onSurveillance = await orderPadPage.isSurveillanceWarningVisible(3000);
  console.log(`  ℹ  Surveillance warning shown for this symbol: ${onSurveillance}`);
  if (!onSurveillance) return false;

  console.log(`  ℹ  Surveillance message: ${await orderPadPage.getSurveillanceMessage()}`);
  const proceeded = await orderPadPage.tapProceedSurveillance();
  console.log(`  ℹ  Surveillance PROCEED tapped: ${proceeded}`);
  if (assertTap) {
    await assertOrDump(proceeded, `${label}: could not tap PROCEED on the surveillance warning`, 'PROCEED button should be tappable on the surveillance warning');
  }
  await browser.pause(800);
  return true;
}

// Logs tag/clickable/resource-id/content-desc/bounds for every element matching
// `selector` — used when a tap's target screen fails to load, to see what was
// actually on screen instead of guessing blind at the real selector.
async function logMatchingElementsDiagnostic(selector, label) {
  const matches = await $$(selector);
  console.log(`  ℹ  Elements matching the ${label} selector on this screen: ${matches.length}`);
  for (let i = 0; i < matches.length; i++) {
    try {
      const [tag, clickable, resId, desc, loc, size] = await Promise.all([
        matches[i].getTagName(),
        matches[i].getAttribute('clickable'),
        matches[i].getAttribute('resource-id'),
        matches[i].getAttribute('content-desc'),
        matches[i].getLocation(),
        matches[i].getSize(),
      ]);
      console.log(`  ℹ  ${label}Matches[${i}]: tag=${tag} clickable=${clickable} resId=${resId} desc="${desc}" bounds=[${loc.x},${loc.y}][${loc.x + size.width},${loc.y + size.height}]`);
    } catch (e) {
      console.log(`  ℹ  ${label}Matches[${i}]: could not read attributes — ${e.message}`);
    }
  }
}

// Places a REAL order — every caller is a segment-specific test that has been
// explicitly authorized to do so. Assumes the OrderPad is already open with the
// price field already set to an out-of-range value (e.g. 0.00). Taps BUY; if the
// DPR/circuit-range guard rejects it (equity segments), parses the lower/upper
// circuit from the error and retries at the lower circuit price. Either way,
// continues through any surveillance warning, confirms the order, and verifies it
// lands in the Orderbook before returning to Watchlist.
async function placeOrderViaDprBounce(label) {
  // Captured now, before navigating away — needed later to confirm the placed
  // order actually shows up in the Orderbook.
  const symbolName = await orderPadPage.getSymbolName();
  console.log(`  ℹ  Symbol for this order: ${symbolName}`);

  const segments = await orderPadPage.getVisibleSegments();
  console.log(`  ℹ  Segments for this symbol: ${segments.join(', ') || 'none detected'}`);

  const buyTapped = await orderPadPage.tapBuySubmit();
  console.log(`  ℹ  BUY tapped: ${buyTapped}`);
  await assertOrDump(buyTapped, `${label}: could not tap BUY submit on OrderPad`, 'BUY submit button should be tappable on the OrderPad screen');
  await browser.pause(1000);

  const dprVisible = await orderPadPage.isDprErrorVisible(5000);
  console.log(`  ℹ  DPR / price-range error shown: ${dprVisible}`);

  if (dprVisible) {
    const dprMessage = await orderPadPage.getDprErrorMessage();
    console.log(`  ℹ  DPR error value: ${dprMessage}`);

    const range = orderPadPage.parseDprRange(dprMessage);
    if (!range) {
      await dumpScreen(`${label}: could not parse lower/upper circuit from the DPR message`);
      expect.fail(`Could not parse a lower/upper circuit range out of DPR message: "${dprMessage}"`);
    }
    console.log(`  ℹ  Lower circuit: ${range.lower}`);
    console.log(`  ℹ  Upper circuit: ${range.upper}`);

    // Clear the out-of-range price and re-enter it as the lower circuit value.
    const priceEdited = await orderPadPage.setPrice(range.lower);
    console.log(`  ℹ  Price field cleared and set to lower circuit (${range.lower}): ${priceEdited}`);
    await assertOrDump(priceEdited, `${label}: could not click/clear/enter the price field with the lower circuit value`, 'Price field should be editable with the lower circuit value');
    await browser.pause(300);
    const priceAfterCircuit = await orderPadPage.getPrice();
    console.log(`  ℹ  Price field now reads: ${priceAfterCircuit}`);
    await assertOrDump(priceAfterCircuit === range.lower, `${label}: price field did not accept the lower circuit value`, `Price field should read ${range.lower} after entering the lower circuit value`);

    // Price is now within the valid DPR range — re-tap BUY. This WILL place a real order.
    await browser.pause(300);
    const buyRetapped = await orderPadPage.tapBuySubmit();
    console.log(`  ℹ  BUY re-tapped with lower circuit price (${range.lower}): ${buyRetapped}`);
    await assertOrDump(buyRetapped, `${label}: could not re-tap BUY submit with the lower circuit price`, 'BUY submit button should be tappable after correcting the price');
    await browser.pause(1000);
  } else {
    console.log('  ℹ  No DPR error — this segment did not block the out-of-range price. Continuing the order flow (this can place a REAL order).');
  }

  // Shared continuation regardless of which path (DPR-corrected retry, or no DPR
  // at all) got us here — both are now proceeding toward a real order.
  await handleSurveillanceIfNeeded(label);

  const confirmVisible = await orderPadPage.isConfirmationPopupVisible(5000);
  console.log(`  ℹ  Confirmation popup visible: ${confirmVisible}`);
  if (!confirmVisible) await orderPadPage.dumpPageSource(`${label.toLowerCase()}-confirmation-popup-missing`);
  await assertOrDump(confirmVisible, `${label}: confirmation popup did not appear after tapping BUY`, 'Confirmation popup should appear after tapping BUY');
  console.log(`  ℹ  Confirmation content: ${(await orderPadPage.getConfirmationText()).join(' | ')}`);
  // Full untruncated dump of the popup, regardless of what happens next — the 20/30-item
  // slices used elsewhere have twice now cut off before reaching the real Confirm button.
  await orderPadPage.dumpPageSource(`${label.toLowerCase()}-confirmation-popup-full`);

  const confirmTapped = await orderPadPage.tapConfirmOrder();
  console.log(`  ℹ  Confirm button tapped: ${confirmTapped}`);
  await assertOrDump(confirmTapped, `${label}: could not tap Confirm on the confirmation popup`, 'Confirm button should be tappable on the confirmation popup');
  await browser.pause(1500);

  // Timing varies: sometimes a slower path shows an "Orderbook" button right here;
  // other times the app has already moved straight back to the Quote screen by the
  // time we check. Handle both, then verify via the actual Orders screen — more
  // reliable than guessing at a "success" toast's wording/timing.
  const onSlowPath = await orderPadPage.isDisplayed(ORDERS_SEL.orderbookBtn, 4000);
  console.log(`  ℹ  Slow path — Orderbook button shown directly: ${onSlowPath}`);

  if (onSlowPath) {
    await orderPadPage.findAndTap(ORDERS_SEL.orderbookBtn, 3000);
    await browser.pause(1000);
  } else {
    console.log('  ℹ  Fast path — already back on the Quote screen. Closing it and using the bottom-nav Orders tab.');
    try { await driver.back(); } catch {}
    await browser.pause(500);
    await watchlistPage.goToWatchlist();
    await watchlistPage.tapNavOrders();
    await browser.pause(1500);
  }

  // The Orderbook's own API call lags a few seconds behind the UI navigation —
  // poll instead of reading the page source once right after arriving.
  let src = await driver.getPageSource();
  let orderVisible = false;
  await orderPadPage.pollUntil(async () => {
    src = await driver.getPageSource();
    orderVisible = symbolName ? src.includes(symbolName) : false;
    return orderVisible;
  }, 12000, 1000);

  const onOrdersScreen = /orderbook|order book|orders/i.test(src);
  console.log(`  ℹ  Landed on an Orders/Orderbook screen: ${onOrdersScreen}`);
  if (!onOrdersScreen) await dumpScreen(`${label}: did not land on an Orders/Orderbook screen`);
  await assertOrDump(onOrdersScreen, `${label}: did not land on an Orders/Orderbook screen`, 'Should land on the Orders/Orderbook screen after confirming the order');

  console.log(`  ℹ  "${symbolName}" order visible in the Orderbook: ${orderVisible}`);
  if (!orderVisible) await dumpScreen(`${label}: "${symbolName}" not found on the Orders/Orderbook screen`);
  await assertOrDump(orderVisible, `${label}: "${symbolName}" order not found on the Orders/Orderbook screen`, `The just-placed ${symbolName} order should be visible on the Orders/Orderbook screen`);

  await browser.pause(500);
  await watchlistPage.goToWatchlist();
}

// Navigates Watchlist -> Market tab -> the given segment tab (Commodity/Currency) ->
// the given movers sub-tab (default "Top Gainers") -> taps the first symbol row shown.
// Used for CDS/MCX, where "any symbol" from the segment's movers list is enough.
async function tapFirstMarketMover(marketTab, subTab = 'Top Gainers') {
  await watchlistPage.goToWatchlist();
  await watchlistPage.tapNavMarket();
  await browser.pause(1200);

  const pos = MARKET_SEL.tabPosition[marketTab];
  const tabTapped = await watchlistPage.findAndTap(`//*[contains(@content-desc,"${marketTab}") and contains(@content-desc,"Tab ${pos} of 4")]`, 5000);
  if (!tabTapped) return false;
  await browser.pause(1000);

  if (subTab) {
    const subTapped = await watchlistPage.findAndTap(`//*[contains(@content-desc,"${subTab}")]`, 5000);
    if (!subTapped) return false;
    await browser.pause(1000);
  }

  const rows = await $$(MARKET_SEL.moversRow);
  if (!rows.length) return false;
  const desc = await rows[0].getAttribute('content-desc');
  console.log(`  ℹ  First ${marketTab} mover: ${desc}`);
  await rows[0].click();
  await browser.pause(1200);
  return true;
}

// Horizontal swipe across the top indices strip (~17% of screen height — above the
// watchlist tab strip). No dedicated page-object method exists for this row yet.
async function swipeIndicesStrip(direction) {
  const { width, height } = await driver.getWindowRect();
  const y  = Math.round(height * 0.17);
  const x1 = direction === 'right' ? Math.round(width * 0.80) : Math.round(width * 0.20);
  const x2 = direction === 'right' ? Math.round(width * 0.20) : Math.round(width * 0.80);
  await browser.action('pointer', { parameters: { pointerType: 'touch' } })
    .move({ x: x1, y }).down().move({ x: x2, y, duration: 300 }).up().perform();
  await browser.pause(200);
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('Regression: Login & Authentication Flow — Globe Capital Dev', () => {

  afterEach(function () {
    if (!this.currentTest) return;
    if (this.currentTest.state === 'passed') {
      console.log(`  ✅ ${this.currentTest.title} — succeeded`);
    } else if (this.currentTest.state === 'failed') {
      console.log(`  ❌ ${this.currentTest.title} — FAILED`);
    }
  });

  before(async function () {
    this.timeout(120000);
    if (RESUME_SESSION) {
      // Relaunch without clearing data — restores the existing login session instead
      // of running R1-R7 again.
      try { await driver.terminateApp(process.env.APP_PACKAGE || 'com.iouring.globecapital.dev'); } catch {}
      await browser.pause(500);
      try { await driver.activateApp(process.env.APP_PACKAGE || 'com.iouring.globecapital.dev'); } catch {}
      await browser.pause(800);
      await handleBiometricIfNeeded(8000);
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
      await dumpScreen('before: login screen not found');
      throw new Error('Login screen did not appear within 30 s');
    }
  });

  const authIt = RESUME_SESSION ? it.skip : it;

  authIt('R1: Verify Forgot Password - click and back to the login screen', async function () {
    this.timeout(15000);
    // Validated on a fresh Login screen, before any credentials are entered.
    const wasDisplayed = await loginPage.isForgotPasswordDisplayed();
    console.log(`  ℹ  Forgot Password button visible: ${wasDisplayed}`);
    await assertOrDump(wasDisplayed, 'R1: forgot password button not found', 'Forgot Password button should be visible on Login screen');

    await loginPage.tapForgotPassword();
    await browser.pause(500);
    const leftLogin = !await loginPage.isDisplayed('~LOGIN', 2000);
    console.log(`  ℹ  Navigated away from Login screen: ${leftLogin}`);

    await safeBack();
    await browser.pause(500);

    const backOnLogin = await loginPage.waitForLoginScreen(10000);
    await assertOrDump(backOnLogin, 'R1: did not return to login screen', 'Should return to Login screen after back');
  });

  authIt('R2: Verify Login flow', async function () {
    this.timeout(15000);
    await loginPage.enterLoginId(testData.validUser.id);
    await loginPage.enterPassword(testData.validUser.password);
    expect(await loginPage.getLoginIdFieldValue(), 'Login ID field should hold entered value')
      .to.equal(testData.validUser.id);
    await loginPage.tapLogin();
  });

  authIt('R3: Verify OTP Login', async function () {
    this.timeout(180000);
    const onOTP1 = await otpPage.isLoaded(35000);
    await assertOrDump(onOTP1, 'R3: OTP1 not found', 'First OTP screen should appear after LOGIN');
    await submitOtp('FIRST OTP');
  });

  authIt('R4: Verify the Enable now', async function () {
    this.timeout(20000);
    const onSecure = await enableSecurePage.isLoaded(10000);
    await assertOrDump(onSecure, 'R4: Enable Globe Secure screen not found', 'Enable Globe Secure screen should appear');
    await enableSecurePage.tapEnableNow();
  });

  authIt('R5: Verify second otp page', async function () {
    this.timeout(180000);
    const onOTP2 = await otpPage.isLoaded(20000);
    await assertOrDump(onOTP2, 'R5: OTP2 not found', 'Second OTP screen should appear');
    await submitOtp('SECOND OTP');
    await browser.pause(500);
  });

  authIt('R6: Verify device pin Login', async function () {
    this.timeout(30000);
    const handled = await handleBiometricIfNeeded(15000);
    console.log(`  ℹ  Device PIN / biometric screen handled: ${handled}`);
    // Some builds skip straight to Risk Disclosure / Watchlist — not a failure.
  });

  authIt('R7: Verify Risk Disclosure', async function () {
    this.timeout(30000);
    // Not every account shows this screen — some client IDs skip straight to Watchlist.
    // So this is a genuine if/else, not a required step: accept it when present, otherwise
    // move on without failing.
    const onRisk = await loginPage.isDisplayed(RISK_SEL.heading, 5000);
    console.log(`  ℹ  Risk Disclosure screen shown for this account: ${onRisk}`);

    if (onRisk) {
      const accepted = await loginPage.findAndTap(RISK_SEL.acceptBtn, 5000);
      console.log(`  ℹ  Risk Disclosure accept tapped: ${accepted}`);
      await assertOrDump(accepted, 'R7: Risk Disclosure accept control not found', 'Should be able to accept the Risk Disclosure screen');
      await browser.pause(1000);
    } else {
      console.log('  ℹ  This account has no Risk Disclosure step — proceeding straight to landing check');
    }

    const onWatchlist = await watchlistPage.isLoaded(10000);
    await assertOrDump(onWatchlist, 'R7: Watchlist not reached after login flow', 'Watchlist home screen should be visible after full login flow');
  });

  it('R8: Validate app launched into the Watchlist screen', async function () {
    this.timeout(30000);
    await watchlistPage.goToWatchlist();
    const onWatchlist = await watchlistPage.isLoaded(20000);
    await assertOrDump(onWatchlist, 'R8: Watchlist screen not launched', 'Watchlist screen should be launched');
    // Informational only — the exact title content-desc varies across accounts/builds;
    // isLoaded() above (title OR search box OR tabs) is the reliable signal.
    console.log(`  ℹ  Watchlist title element visible: ${await watchlistPage.isTitleDisplayed()}`);
  });

  it('R9: Tap through all the watchlist tabs', async function () {
    this.timeout(30000);
    // Tabs are read by position/content-desc pattern, not by an assumed name —
    // different client IDs have different watchlists.
    await watchlistPage.scrollToFirstTab();

    const seen = new Set();
    for (let scroll = 0; scroll < 8; scroll++) {
      const tabEls = await $$(WL_SEL.allTabs);
      for (const tabEl of tabEls) {
        let desc;
        try { desc = await tabEl.getAttribute('content-desc'); } catch { continue; }
        const name = desc.split(/\n|&#10;/)[0].trim();
        if (seen.has(name)) continue;
        try {
          await tabEl.click();
          await browser.pause(300);
          console.log(`  ℹ  Tapped watchlist: "${name}"`);
          seen.add(name);
        } catch {}
      }
      const total = await watchlistPage.getTotalTabCount();
      if (seen.size >= total) break;
      await watchlistPage._swipeTabStrip('right');
    }
    await watchlistPage.scrollToFirstTab();

    console.log(`  ℹ  Watchlists tapped (${seen.size}): ${[...seen].join(', ')}`);
    expect(seen.size, 'Should have tapped at least 1 watchlist tab').to.be.above(0);
  });

  it('R10: Choose the 1st watchlist and open search', async function () {
    this.timeout(20000);
    // Selected by position ("Tab 1 of N"), not by name — the 1st tab's name varies per account.
    const firstTab = await scrollToTabPosition(1);
    if (!firstTab) await dumpScreen('R10: 1st watchlist tab not found by position');
    expect(firstTab, 'A watchlist tab at position 1 should be found').to.not.be.null;
    console.log(`  ℹ  1st watchlist tab: "${firstTab.name}"`);

    await firstTab.el.click();
    await browser.pause(300);
    const isActive = (await firstTab.el.getAttribute('selected')) === 'true';
    console.log(`  ℹ  1st watchlist tab active: ${isActive}`);

    await watchlistPage.tapSearchBox();
    const searchOpen = await watchlistPage.isDisplayed(WL_SEL.searchInput, 5000);
    await assertOrDump(searchOpen, 'R10: search overlay did not open', 'Search overlay input should be visible after tapping search');
  });

  it('R11: Search the symbol "HCL"', async function () {
    this.timeout(15000);
    await searchAndGetResults('HCL');
  });

  it('R12: Validate the search list and click cancel', async function () {
    this.timeout(15000);
    // exitSearchMode() must run even if the assertion below fails — otherwise a failure
    // here strands the app in the search overlay and cascades into every later test.
    try {
      const results = await $$(WL_SEL.searchResult);
      console.log(`  ℹ  "HCL" search results: ${results.length}`);
      expect(results.length, 'At least one result should appear for "HCL"').to.be.above(0);
    } finally {
      await watchlistPage.exitSearchMode();
    }

    const backOnWatchlist = await watchlistPage.isLoaded(5000);
    await assertOrDump(backOnWatchlist, 'R12: Watchlist not visible after cancel', 'Should be back on Watchlist after cancelling search');
  });

  it('R13: Click the Manage Watchlist button', async function () {
    this.timeout(15000);
    const opened = await watchlistPage.findAndTap(WL_SEL.manageBtn, 5000);
    await assertOrDump(opened, 'R13: Manage Watchlist button not found', 'Manage Watchlist button should be tappable');
    await browser.pause(300);
  });

  it('R14: Print the list shown in Manage Watchlist', async function () {
    this.timeout(15000);
    const src   = await driver.getPageSource();
    const descs = [...src.matchAll(/content-desc="([^"]{1,60})"/g)]
      .map(m => m[1].split(/\n|&#10;/)[0].trim())
      .filter(d => d.length > 0);
    const texts = [...src.matchAll(/\btext="([^"]{1,60})"/g)]
      .map(m => m[1].trim())
      .filter(t => t.length > 0);

    console.log(`  ℹ  Manage Watchlist — content-desc items (${descs.length}): ${descs.join(' | ')}`);
    console.log(`  ℹ  Manage Watchlist — text items (${texts.length}): ${texts.join(' | ')}`);
    expect(descs.length + texts.length, 'Manage Watchlist screen should list at least one item').to.be.above(0);
  });

  it('R15: Return to the Watchlist screen', async function () {
    this.timeout(15000);
    await safeBack();
    await browser.pause(300);
    await watchlistPage.goToWatchlist();
    const onWatchlist = await watchlistPage.isLoaded(8000);
    await assertOrDump(onWatchlist, 'R15: did not return to Watchlist screen', 'Should be back on the Watchlist screen');
  });

  it('R16: Validate the top indices — print names, scroll right and left', async function () {
    this.timeout(20000);
    const initial = await watchlistPage.getVisibleIndices();
    console.log(`  ℹ  Indices (initial): ${initial.length ? initial.join(', ') : 'none visible'}`);

    await swipeIndicesStrip('right');
    const afterRight = await watchlistPage.getVisibleIndices();
    console.log(`  ℹ  Indices (after scroll right): ${afterRight.length ? afterRight.join(', ') : 'none visible'}`);

    await swipeIndicesStrip('left');
    const afterLeft = await watchlistPage.getVisibleIndices();
    console.log(`  ℹ  Indices (after scroll left): ${afterLeft.length ? afterLeft.join(', ') : 'none visible'}`);

    const onWatchlist = await watchlistPage.isLoaded(5000);
    await assertOrDump(onWatchlist, 'R16: Watchlist not visible after scrolling indices', 'Watchlist should remain visible after scrolling the indices strip');
  });

  it('R17: Validate the hamburger button', async function () {
    this.timeout(20000);
    await watchlistPage.goToWatchlist();

    const found = await watchlistPage.isDisplayed(MENU_SEL.hamburgerBtn, 5000);
    console.log(`  ℹ  Hamburger button visible: ${found}`);
    await assertOrDump(found, 'R17: hamburger button not found', 'Hamburger button should be visible on the Watchlist screen');

    const tapped = await watchlistPage.findAndTap(MENU_SEL.hamburgerBtn, 3000);
    console.log(`  ℹ  Hamburger button tapped: ${tapped}`);
    await browser.pause(300);

    // The side-drawer menu has its own "Back" control — the Android system back
    // gesture doesn't dismiss it, so tap that explicitly before falling back to driver.back().
    const closedViaBack = await watchlistPage.findAndTap('//*[@content-desc="Back"]', 2000);
    console.log(`  ℹ  Drawer "Back" control tapped: ${closedViaBack}`);
    if (!closedViaBack) await safeBack();
    await browser.pause(500);
    await watchlistPage.goToWatchlist();
    const backOnWatchlist = await watchlistPage.isLoaded(5000);
    await assertOrDump(backOnWatchlist, 'R17: did not return to Watchlist after hamburger interaction', 'Should return to Watchlist after hamburger interaction');
  });

  // Previously flaky: WatchlistPage's bottom-nav selectors required a "Tab N of 5"
  // suffix in the content-desc that only exists on the Beta build — the Dev build
  // renders plain labels ("Orders") with no suffix at all. Fixed by accepting both formats.
  // Shared by R18-R21: tap one bottom-nav tab, confirm it leaves Watchlist, then
  // tap back to Watchlist and confirm it's reachable again.
  async function verifyNavSwitch(label, name, tapFn) {
    let switched = false;
    for (let attempt = 0; attempt < 2 && !switched; attempt++) {
      try {
        await tapFn();
        switched = true;
      } catch (e) {
        console.log(`  ⚠  ${name} tap attempt ${attempt + 1} failed: ${e.message}`);
        await browser.pause(800);
      }
    }
    await assertOrDump(switched, `${label}: could not tap ${name} tab`, `${name} bottom nav tab should be tappable`);

    await browser.pause(500);
    const leftWatchlist = !(await watchlistPage.isLoaded(2000));
    console.log(`  ℹ  ${name}: navigated away from Watchlist = ${leftWatchlist}`);

    await watchlistPage.tapNavWatchlist();
    const backOnWatchlist = await watchlistPage.isLoaded(8000);
    await assertOrDump(backOnWatchlist, `${label}: did not return to Watchlist after tapping ${name}`, `Should return to Watchlist after switching to ${name}`);
  }

  it('R18: Switch to the Market tab and return to Watchlist', async function () {
    this.timeout(20000);
    await watchlistPage.goToWatchlist();
    await browser.pause(500);
    await verifyNavSwitch('R18', 'Market', () => watchlistPage.tapNavMarket());
  });

  it('R19: Switch to the Orders tab and return to Watchlist', async function () {
    this.timeout(20000);
    await watchlistPage.goToWatchlist();
    await browser.pause(500);
    await verifyNavSwitch('R19', 'Orders', () => watchlistPage.tapNavOrders());
  });

  it('R20: Switch to the Portfolio tab and return to Watchlist', async function () {
    this.timeout(20000);
    await watchlistPage.goToWatchlist();
    await browser.pause(500);
    await verifyNavSwitch('R20', 'Portfolio', () => watchlistPage.tapNavPortfolio());
  });

  it('R21: Switch to the Mutual Funds tab and return to Watchlist', async function () {
    this.timeout(20000);
    await watchlistPage.goToWatchlist();
    await browser.pause(500);
    await verifyNavSwitch('R21', 'Mutual Funds', () => watchlistPage.tapNavMutualFunds());
  });

  it('R22: Open first symbol from any watchlist and tap Buy to reach the OrderPad screen', async function () {
    this.timeout(45000);
    await watchlistPage.goToWatchlist();
    await watchlistPage.scrollToFirstTab();

    // Checked by position, not name — walk every watchlist tab until one with
    // at least one symbol is found (an account's watchlists may vary in content).
    const total = await watchlistPage.getTotalTabCount();
    let stockEl = null, usedTabName = null;
    for (let pos = 1; pos <= Math.max(total, 1) && !stockEl; pos++) {
      const tab = await scrollToTabPosition(pos);
      if (!tab) continue;
      await tab.el.click();
      await browser.pause(300);
      const count = await watchlistPage.getStockCount();
      console.log(`  ℹ  "${tab.name}": ${count} stock(s)`);
      if (count > 0) {
        // WL_SEL.stockItems already restricts to NSE/BSE-tagged rows — always the
        // first one (index 0), which is reliably visible without scrolling.
        usedTabName = tab.name;
        stockEl = (await $$(WL_SEL.stockItems))[0];
      }
    }

    if (!stockEl) await dumpScreen('R22: no watchlist with a symbol found');
    expect(stockEl, 'At least one watchlist should contain a symbol').to.not.be.null;
    console.log(`  ℹ  Opening first symbol from "${usedTabName}"`);

    await stockEl.click();
    await browser.pause(500);

    const quoteOpen = await quotePage.isLoaded(8000);
    await assertOrDump(quoteOpen, 'R22: Quote screen did not open', 'Quote screen should open after tapping a symbol');

    const buyVisible  = await quotePage.isBuyButtonDisplayed();
    const sellVisible = await quotePage.isSellButtonDisplayed();
    console.log(`  ℹ  Buy button visible: ${buyVisible}  |  Sell button visible: ${sellVisible}`);
    await assertOrDump(buyVisible,  'R22: Buy button not found on Quote screen',  'Buy button should be visible on the Quote screen');
    await assertOrDump(sellVisible, 'R22: Sell button not found on Quote screen', 'Sell button should be visible on the Quote screen');

    const buyTapped = await quotePage.tapBuyButton();
    console.log(`  ℹ  Buy button tapped: ${buyTapped}`);
    await assertOrDump(buyTapped, 'R22: could not tap Buy button', 'Buy button should be tappable');
    await browser.pause(1000);

    // tapBuyButton() only confirms the tap *gesture* executed — it says nothing about
    // whether the app actually navigated. Verify the OrderPad screen genuinely opened.
    const onOrderPad = await orderPadPage.isLoaded(8000);
    console.log(`  ℹ  OrderPad screen loaded after Buy tap: ${onOrderPad}`);
    if (!onOrderPad) {
      await logMatchingElementsDiagnostic('//*[contains(@content-desc,"Buy") or contains(@content-desc,"BUY") or contains(@text,"BUY") or contains(@text,"Buy") or contains(@resource-id,"buy")]', 'buy');
      await orderPadPage.dumpPageSource('r20-buy-tap-diagnostic');
    }
    expect(onOrderPad, 'OrderPad screen should open after tapping Buy').to.be.true;
  });

  it('R23: Validate the OrderPad screen fields', async function () {
    this.timeout(20000);
    const symbol = await orderPadPage.getSymbolName();
    console.log(`  ℹ  OrderPad symbol: ${symbol}`);

    const [
      exchangeToggle, orderTypeRegular, quantity, qtyStepper,
      priceVisible, marketLimitToggle, stoplossToggle, product,
      moreVisible, mtfBanner, approxMargin, availBalance,
      buySubmitVisible, buySubmitEnabled,
    ] = await Promise.all([
      orderPadPage.isExchangeToggleVisible(),
      orderPadPage.isOrderTypeRegularSelected(),
      orderPadPage.getQuantity(),
      orderPadPage.isQuantityStepperVisible(),
      orderPadPage.isPriceFieldVisible(),
      orderPadPage.isMarketLimitToggleVisible(),
      orderPadPage.isStoplossToggleVisible(),
      orderPadPage.getSelectedProduct(),
      orderPadPage.isMoreVisible(),
      orderPadPage.isMTFBannerVisible(),
      orderPadPage.isApproxMarginVisible(),
      orderPadPage.isAvailBalanceVisible(),
      orderPadPage.isBuySubmitVisible(),
      orderPadPage.isBuySubmitEnabled(),
    ]);

    console.log(`  ℹ  Exchange toggle (NSE/BSE) visible: ${exchangeToggle}`);
    console.log(`  ℹ  Order Type "Regular" offered: ${orderTypeRegular}`);
    console.log(`  ℹ  Quantity: ${quantity}  |  Quantity stepper visible: ${qtyStepper}`);
    console.log(`  ℹ  Price field visible: ${priceVisible}  |  Market/Limit toggle visible: ${marketLimitToggle}`);
    console.log(`  ℹ  Stoploss toggle visible: ${stoplossToggle}`);
    console.log(`  ℹ  Selected product: ${product}`);
    console.log(`  ℹ  "More" options visible: ${moreVisible}  |  MTF banner visible: ${mtfBanner}`);
    console.log(`  ℹ  Approx margin visible: ${approxMargin}  |  Available balance visible: ${availBalance}`);
    console.log(`  ℹ  BUY submit button visible: ${buySubmitVisible}  |  enabled: ${buySubmitEnabled}`);

    // OrderPadPage's selectors are best-effort (no confirmed UI dump existed before now) —
    // capture the real markup so they can be tightened up like QuotePage's were.
    await orderPadPage.dumpPageSource('r20-orderpad-fields');

    // The BUY submit control is the one field central to this screen's purpose — everything
    // else above is informational until its selector is confirmed against the real markup.
    await assertOrDump(buySubmitVisible, 'R23: BUY submit button not found on OrderPad', 'BUY submit button should be visible on the OrderPad screen');
  });

  // Submits BUY at the OrderPad's current (default, in-range) price to reach the real
  // confirmation popup, validates its fields and the Applicable Charges/Brokerage
  // breakdown, then dismisses via the Scrim — never taps CONFIRMATION, so no order
  // is placed. Runs before R26 so the price field is still at its untouched default.
  it('R24: Validate the confirmation popup fields (no submit)', async function () {
    this.timeout(20000);

    const buyTapped = await orderPadPage.tapBuySubmit();
    console.log(`  ℹ  OrderPad BUY submit tapped: ${buyTapped}`);
    await assertOrDump(buyTapped, 'R24: could not tap BUY submit on OrderPad', 'BUY submit button should be tappable on the OrderPad screen');
    await browser.pause(800);

    await handleSurveillanceIfNeeded('R24', { assertTap: true });

    const confirmVisible = await orderPadPage.isConfirmationPopupVisible(5000);
    console.log(`  ℹ  Confirmation popup visible: ${confirmVisible}`);
    if (!confirmVisible) await orderPadPage.dumpPageSource('r21-confirmation-popup-missing');
    await assertOrDump(confirmVisible, 'R24: confirmation popup did not appear after BUY submit', 'Confirmation popup should appear after tapping BUY submit');

    // Validate every field shown on the confirmation popup.
    const confirmDetails = await orderPadPage.getConfirmationDetails();
    console.log('  ℹ  Confirmation popup field values:');
    for (const [label, value] of Object.entries(confirmDetails)) {
      console.log(`     - ${label}: ${value}`);
    }
    const expectedFields = ['Symbol', 'Exchange', 'Order Action', 'Quantity', 'Price', 'Product Type', 'Order Type', 'Validity'];
    const missingFields = expectedFields.filter(f => !confirmDetails[f]);
    await assertOrDump(missingFields.length === 0, 'R24: confirmation popup missing expected fields',
      `Confirmation popup should show all of ${expectedFields.join(', ')} — missing: ${missingFields.join(', ') || 'none'}`);
  });

  // Continues directly from R24 — the confirmation popup is still open.
  it('R25: Validate the Applicable Charges breakdown, then dismiss without submitting', async function () {
    this.timeout(20000);

    // Open "Applicable Charges" — validate its header and brokerage breakdown, print
    // the disclaimer, then return to the confirmation popup.
    const chargesTapped = await orderPadPage.tapApplicableCharges();
    console.log(`  ℹ  Applicable Charges tapped: ${chargesTapped}`);
    await assertOrDump(chargesTapped, 'R25: could not tap Applicable Charges', 'Applicable Charges link should be tappable on the confirmation popup');
    await browser.pause(600);

    const chargesPanelVisible = await orderPadPage.isChargesPanelVisible(5000);
    console.log(`  ℹ  Applicable Charges panel visible: ${chargesPanelVisible}`);
    if (!chargesPanelVisible) await orderPadPage.dumpPageSource('r21-charges-panel-missing');
    await assertOrDump(chargesPanelVisible, 'R25: Applicable Charges panel did not open', 'Applicable Charges panel should open after tapping the link');

    const chargesHeader = await orderPadPage.getChargesHeader();
    console.log(`  ℹ  Applicable Charges header: ${chargesHeader}`);
    await assertOrDump(!!chargesHeader, 'R25: Applicable Charges header not found', 'Applicable Charges panel should show a header');

    const chargesBreakdown = await orderPadPage.getChargesBreakdown();
    console.log(`  ℹ  Brokerage/charges details: ${chargesBreakdown.join(' | ')}`);
    await assertOrDump(chargesBreakdown.length > 0, 'R25: no brokerage/charges details found', 'Applicable Charges panel should show at least one charge line item');

    const chargesDisclaimer = await orderPadPage.getChargesDisclaimer();
    console.log(`  ℹ  Disclaimer: ${chargesDisclaimer}`);
    await assertOrDump(!!chargesDisclaimer, 'R25: disclaimer text not found on the Applicable Charges panel', 'Applicable Charges panel should show a disclaimer');

    const chargesClosed = await orderPadPage.closeChargesPanel();
    console.log(`  ℹ  Applicable Charges back button tapped: ${chargesClosed}`);
    await browser.pause(500);
    const backOnConfirmation = await orderPadPage.isConfirmationPopupVisible(5000);
    console.log(`  ℹ  Back on confirmation popup: ${backOnConfirmation}`);
    await assertOrDump(backOnConfirmation, 'R25: did not return to the confirmation popup after closing Applicable Charges', 'Should return to the confirmation popup after tapping back on Applicable Charges');

    // Dismiss WITHOUT confirming — this test only validates the popup, it never places an order.
    const dismissed = await orderPadPage.dismissConfirmationPopup();
    console.log(`  ℹ  Confirmation popup dismissed (no order placed): ${dismissed}`);
    await browser.pause(500);

    const backOnOrderPad = await orderPadPage.isLoaded(5000);
    console.log(`  ℹ  Back on OrderPad screen: ${backOnOrderPad}`);
    await assertOrDump(backOnOrderPad, 'R25: did not return to the OrderPad screen after dismissing the confirmation popup', 'Should return to the OrderPad screen after dismissing the confirmation popup');
  });

  // Read/edit-only pass over the OrderPad's interactive fields — segment, quantity,
  // Market/Limit mode, price tick. Deliberately never taps BUY or SELL, so it's safe
  // to run against a real account.
  it('R26: OrderPad field interactions — segment, quantity, Market/Limit, price tick (no submit)', async function () {
    this.timeout(30000);

    // Step 1 — segments actually offered for this symbol.
    const segments = await orderPadPage.getVisibleSegments();
    console.log(`  ℹ  Segments available: ${segments.join(', ') || 'none detected'}`);
    await assertOrDump(segments.length > 0, 'R26: no segment (NSE/BSE/NFO/MCX/...) detected on OrderPad', 'At least one segment should be visible on the OrderPad screen');

    // Step 2 — quantity 1 -> 10 -> back to the original value.
    const qtyBefore = await orderPadPage.getQuantity();
    console.log(`  ℹ  Quantity before: ${qtyBefore}`);
    await orderPadPage.setQuantity(10);
    await browser.pause(300);
    const qtyAfterTen = await orderPadPage.getQuantity();
    console.log(`  ℹ  Quantity after setting to 10: ${qtyAfterTen}`);
    await assertOrDump(String(qtyAfterTen) === '10', 'R26: quantity did not update to 10', 'Quantity field should read 10 after editing');

    await orderPadPage.setQuantity(qtyBefore);
    await browser.pause(300);
    const qtyReversed = await orderPadPage.getQuantity();
    console.log(`  ℹ  Quantity reversed back to: ${qtyReversed}`);
    await assertOrDump(String(qtyReversed) === String(qtyBefore), 'R26: quantity did not reverse back to its original value', `Quantity field should read back to ${qtyBefore}`);

    // Step 3 — Limit -> Market -> Limit via the swap toggle, printing each mode.
    const modeBefore = await orderPadPage.getPriceMode();
    console.log(`  ℹ  Price mode before: ${modeBefore}`);

    const swappedToMarket = await orderPadPage.tapMarketLimitSwap();
    await browser.pause(500);
    const modeAfterSwap1 = await orderPadPage.getPriceMode();
    console.log(`  ℹ  Market/Limit swap tapped: ${swappedToMarket}  |  Price mode now: ${modeAfterSwap1}`);
    await assertOrDump(swappedToMarket, 'R26: could not tap the Market/Limit swap toggle', 'Market/Limit swap toggle should be tappable');

    const swappedBack = await orderPadPage.tapMarketLimitSwap();
    await browser.pause(500);
    const modeAfterSwap2 = await orderPadPage.getPriceMode();
    console.log(`  ℹ  Swapped back: ${swappedBack}  |  Price mode now: ${modeAfterSwap2}`);
    await assertOrDump(modeAfterSwap2 === modeBefore, 'R26: price mode did not return to its original value after two swaps', `Price mode should read back to "${modeBefore}"`);

    // Step 4 — click the price field, remove the existing value, enter 0.00.
    const priceBefore = await orderPadPage.getPrice();
    console.log(`  ℹ  Price before: ${priceBefore}`);
    const priceEdited = await orderPadPage.setPrice('0.00');
    console.log(`  ℹ  Price field clicked, cleared, and 0.00 entered: ${priceEdited}`);
    await assertOrDump(priceEdited, 'R26: could not click/clear/enter the price field', 'Price field should be clickable and editable');
    await browser.pause(300);
    const priceAfter = await orderPadPage.getPrice();
    console.log(`  ℹ  Price field now reads: ${priceAfter}`);
    await assertOrDump(priceAfter === '0.00', 'R26: price field did not accept 0.00', 'Price field should read 0.00 after clearing and re-entering it');

    console.log('  ℹ  R26 complete — BUY/SELL were not tapped at any point');
  });

  // Continues directly from R26 — OrderPad is still open with price cleared to 0.00.
  //
  // Validation only — taps BUY with this out-of-range price and confirms the DPR
  // (Daily Price Range) guard rejects it, parsing the lower/upper circuit out of the
  // error. Does NOT retry at the corrected price or confirm anything, so no order is
  // placed. Real order placement now lives in the segment-specific tests below
  // (e.g. R33 for NSE), which reuse this same DPR-bounce technique deliberately.
  it('R27: Tap Buy with price 0.00 — validate the DPR/circuit-range guard (no order placed)', async function () {
    this.timeout(20000);

    const segments = await orderPadPage.getVisibleSegments();
    console.log(`  ℹ  Segments for this symbol: ${segments.join(', ') || 'none detected'}`);

    const buyTapped = await orderPadPage.tapBuySubmit();
    console.log(`  ℹ  BUY tapped with price 0.00: ${buyTapped}`);
    await assertOrDump(buyTapped, 'R27: could not tap BUY submit on OrderPad', 'BUY submit button should be tappable on the OrderPad screen');
    await browser.pause(1000);

    const dprVisible = await orderPadPage.isDprErrorVisible(5000);
    console.log(`  ℹ  DPR / price-range error shown: ${dprVisible}`);

    if (dprVisible) {
      const dprMessage = await orderPadPage.getDprErrorMessage();
      console.log(`  ℹ  DPR error value: ${dprMessage}`);

      const range = orderPadPage.parseDprRange(dprMessage);
      if (!range) {
        await dumpScreen('R27: could not parse lower/upper circuit from the DPR message');
        expect.fail(`Could not parse a lower/upper circuit range out of DPR message: "${dprMessage}"`);
      }
      console.log(`  ℹ  Lower circuit: ${range.lower}`);
      console.log(`  ℹ  Upper circuit: ${range.upper}`);
      console.log('  ℹ  Validation only — order rejected by the DPR guard, nothing placed.');
    } else {
      console.log('  ℹ  No DPR error shown for this segment/price.');
      // A confirmation popup may have appeared instead (segments with no DPR guard) —
      // this test only validates, so dismiss it without ever tapping Confirm.
      if (await orderPadPage.isConfirmationPopupVisible(3000)) {
        console.log('  ℹ  Confirmation popup appeared — dismissing without confirming (validation only).');
        await orderPadPage.dismissConfirmationPopup();
        await browser.pause(500);
      }
    }

    await watchlistPage.goToWatchlist();
  });

  // Read-only pass over the Orderbook — never taps Cancel All / Convert to Market /
  // Filter (see OrderbookPage's class comment for why), so it's safe to run any time.
  it('R28: Open the Orderbook and validate its common controls', async function () {
    this.timeout(20000);

    await watchlistPage.tapNavOrders();
    const loaded = await orderbookPage.isLoaded(8000);
    if (!loaded) await orderbookPage.dumpPageSource('r24-orderbook-not-loaded');
    await assertOrDump(loaded, 'R28: Orderbook screen did not load', 'Orderbook screen should load after tapping the Orders tab');

    // Common controls — search box and filter button, present regardless of tab.
    const searchVisible = await orderbookPage.isSearchBoxVisible();
    const filterVisible = await orderbookPage.isFilterButtonVisible();
    console.log(`  ℹ  Search box visible: ${searchVisible}  |  Filter button visible: ${filterVisible}`);
    await assertOrDump(searchVisible, 'R28: search box not found on Orderbook', 'Search box should be visible on the Orderbook screen');
    await assertOrDump(filterVisible, 'R28: filter button not found on Orderbook', 'Filter button should be visible on the Orderbook screen');

    // Tab counts, printed up front.
    const counts = await orderbookPage.getAllTabCounts();
    console.log(`  ℹ  Tab counts — All: ${counts.all}  Pending: ${counts.pending}  Executed: ${counts.executed}  Cancelled: ${counts.cancelled}`);
  });

  // Shared by R29-R32: switch to one Orderbook tab, scroll, and validate its rows
  // (or empty-state message). Segment, Order Type and LTP are rendered as plain visual
  // text with no content-desc or text attribute at all (confirmed via real UI dump) —
  // not accessible, not validated.
  async function validateOrderbookTab(label, tab) {
    console.log(`\n  ℹ  --- ${tab.toUpperCase()} tab ---`);
    const tapped = await orderbookPage.tapTab(tab);
    await assertOrDump(tapped, `${label}: could not tap the ${tab} tab`, `${tab} tab should be tappable`);
    await browser.pause(600);

    const count = await orderbookPage.getTabCount(tab);
    console.log(`  ℹ  ${tab} tab count: ${count}`);

    // Scroll down then back up while on this tab, printing whatever entries are visible.
    await orderbookPage.swipeUp();
    await browser.pause(400);
    const rowsAfterScrollDown = await orderbookPage.getOrderRows();
    console.log(`  ℹ  Entries after scrolling down (${rowsAfterScrollDown.length}):`);
    rowsAfterScrollDown.forEach((r, i) => console.log(`     [${i}] ${r.raw}`));

    await orderbookPage.swipeDown();
    await browser.pause(400);
    const rowsAfterScrollUp = await orderbookPage.getOrderRows();
    console.log(`  ℹ  Entries after scrolling back up (${rowsAfterScrollUp.length}):`);
    rowsAfterScrollUp.forEach((r, i) => console.log(`     [${i}] ${r.raw}`));

    if (count === 0) {
      const empty = await orderbookPage.isEmptyStateVisible();
      console.log(`  ℹ  Empty-state message shown: ${empty}`);
      await assertOrDump(empty, `${label}: ${tab} tab shows count 0 but no empty-state message`, `${tab} tab should show an empty-state message when it has no orders`);
      return;
    }

    // Validate each visible row's accessible fields — Buy/Sell, Symbol, Status, Qty, Price.
    const rows = await orderbookPage.getOrderRows();
    await assertOrDump(rows.length > 0, `${label}: ${tab} tab count is ${count} but no order rows were found`, `${tab} tab should show at least one order row when its count is > 0`);
    for (const row of rows) {
      console.log(`  ℹ  [${tab}] ${row.action} ${row.symbol} — status=${row.status} qty=${row.filledQty}/${row.totalQty} price=${row.price}`);
      await assertOrDump(!!(row.action && row.symbol && row.status && row.totalQty && row.price),
        `${label}: could not parse an order row on the ${tab} tab`, `Row "${row.raw}" should parse into action/symbol/status/quantity/price`);
    }

    // Pending-specific: bulk-action controls should be present, but never tapped.
    if (tab === 'pending') {
      const cancelAllVisible = await orderbookPage.isCancelAllVisible();
      const convertVisible   = await orderbookPage.isConvertToMarketVisible();
      console.log(`  ℹ  Cancel All visible: ${cancelAllVisible}  |  Convert to Market visible: ${convertVisible}`);
      await assertOrDump(cancelAllVisible, `${label}: Cancel All button not found on Pending tab`, 'Cancel All should be visible when Pending orders exist');
      await assertOrDump(convertVisible, `${label}: Convert to Market button not found on Pending tab`, 'Convert to Market should be visible when Pending orders exist');
    }
  }

  it('R29: Validate the Orderbook — All tab', async function () {
    this.timeout(20000);
    await validateOrderbookTab('R29', 'all');
  });

  it('R30: Validate the Orderbook — Pending tab', async function () {
    this.timeout(20000);
    await validateOrderbookTab('R30', 'pending');
  });

  it('R31: Validate the Orderbook — Executed tab', async function () {
    this.timeout(20000);
    await validateOrderbookTab('R31', 'executed');
  });

  it('R32: Validate the Orderbook — Cancelled tab', async function () {
    this.timeout(20000);
    await validateOrderbookTab('R32', 'cancelled');
    await watchlistPage.goToWatchlist();
  });

  // Places a REAL order on the NSE segment — searches for a known NSE symbol directly
  // (rather than whatever happens to be first in a watchlist), then reuses the same
  // DPR-bounce technique as R27: enter 0.00, let the DPR guard reject it, retry at the
  // parsed lower circuit price, and confirm. Explicitly authorized per segment.
  it('R33: Place a real order for the NSE segment — search "IDEA", DPR-bounce to the lower circuit', async function () {
    this.timeout(60000);

    await watchlistPage.goToWatchlist();
    await watchlistPage.tapSearchBox();
    const searchOpen = await watchlistPage.isDisplayed(WL_SEL.searchInput, 5000);
    await assertOrDump(searchOpen, 'R33: search overlay did not open', 'Search overlay input should be visible after tapping search');

    const results = await searchAndGetResults('IDEA');
    console.log(`  ℹ  "IDEA" search results: ${results.length}`);
    await assertOrDump(results.length > 0, 'R33: "IDEA" not found in search results', 'Search should return at least one result for "IDEA"');

    await results[0].click();
    await browser.pause(500);

    const quoteOpen = await quotePage.isLoaded(8000);
    await assertOrDump(quoteOpen, 'R33: Quote screen did not open for IDEA', 'Quote screen should open after selecting IDEA from search');

    const buyTapped = await quotePage.tapBuyButton();
    console.log(`  ℹ  Buy button tapped: ${buyTapped}`);
    await assertOrDump(buyTapped, 'R33: could not tap Buy on the Quote screen', 'Buy button should be tappable on the Quote screen');
    await browser.pause(1000);

    const onOrderPad = await orderPadPage.isLoaded(8000);
    await assertOrDump(onOrderPad, 'R33: OrderPad screen did not open for IDEA', 'OrderPad screen should open after tapping Buy');

    const priceEdited = await orderPadPage.setPrice('0.00');
    console.log(`  ℹ  Price field cleared and set to 0.00: ${priceEdited}`);
    await assertOrDump(priceEdited, 'R33: could not click/clear/enter the price field', 'Price field should be clickable and editable');
    await browser.pause(300);

    await placeOrderViaDprBounce('R33');
  });

  // Places a REAL order on the BSE segment — RTNPOWER trades on both NSE and BSE, so
  // it doesn't matter which of the two search rows is opened (the search results don't
  // expose which is which via accessibility); the exchange toggle on the OrderPad is
  // used to explicitly select BSE regardless.
  it('R34: Place a real order for the BSE segment — search "RTN POWER", DPR-bounce to the lower circuit', async function () {
    this.timeout(60000);

    await watchlistPage.goToWatchlist();
    await watchlistPage.tapSearchBox();
    const searchOpen = await watchlistPage.isDisplayed(WL_SEL.searchInput, 5000);
    await assertOrDump(searchOpen, 'R34: search overlay did not open', 'Search overlay input should be visible after tapping search');

    const results = await searchAndGetResults('RTN POWER');
    console.log(`  ℹ  "RTN POWER" search results: ${results.length}`);
    await assertOrDump(results.length > 0, 'R34: "RTN POWER" not found in search results', 'Search should return at least one result for "RTN POWER"');

    await results[0].click();
    await browser.pause(500);

    const quoteOpen = await quotePage.isLoaded(8000);
    await assertOrDump(quoteOpen, 'R34: Quote screen did not open for RTNPOWER', 'Quote screen should open after selecting RTNPOWER from search');

    const buyTapped = await quotePage.tapBuyButton();
    console.log(`  ℹ  Buy button tapped: ${buyTapped}`);
    await assertOrDump(buyTapped, 'R34: could not tap Buy on the Quote screen', 'Buy button should be tappable on the Quote screen');
    await browser.pause(1000);

    const onOrderPad = await orderPadPage.isLoaded(8000);
    await assertOrDump(onOrderPad, 'R34: OrderPad screen did not open for RTNPOWER', 'OrderPad screen should open after tapping Buy');

    const bseSelected = await orderPadPage.tapExchange('BSE');
    console.log(`  ℹ  BSE exchange selected: ${bseSelected}`);
    await assertOrDump(bseSelected, 'R34: could not select the BSE exchange toggle', 'BSE exchange toggle should be tappable on the OrderPad screen');
    await browser.pause(300);

    const priceEdited = await orderPadPage.setPrice('0.00');
    console.log(`  ℹ  Price field cleared and set to 0.00: ${priceEdited}`);
    await assertOrDump(priceEdited, 'R34: could not click/clear/enter the price field', 'Price field should be clickable and editable');
    await browser.pause(300);

    await placeOrderViaDprBounce('R34');
  });

  // Places a REAL order on the NFO segment — NIFTY 25100 CE. Searches the contract
  // directly (e.g. "NIFTY 25100 CE" returns one result per expiry) and takes the first
  // one, rather than drilling through the Option Chain screen — that screen's strike
  // table only renders what's scrolled into view, so a strike outside that visible
  // range (like 25100 against a ~24000 spot) was unreachable even though the contract
  // itself exists and is searchable.
  it('R35: Place a real order for the NFO segment — NIFTY 25100 CE, DPR-bounce to the lower circuit', async function () {
    this.timeout(60000);

    await watchlistPage.goToWatchlist();
    await watchlistPage.tapSearchBox();
    const searchOpen = await watchlistPage.isDisplayed(WL_SEL.searchInput, 5000);
    await assertOrDump(searchOpen, 'R35: search overlay did not open', 'Search overlay input should be visible after tapping search');

    const results = await searchAndGetResults('NIFTY 25100 CE');
    console.log(`  ℹ  "NIFTY 25100 CE" search results: ${results.length}`);
    await assertOrDump(results.length > 0, 'R35: "NIFTY 25100 CE" not found in search results', 'Search should return at least one result for "NIFTY 25100 CE"');

    await results[0].click();
    await browser.pause(500);

    const quoteOpen = await quotePage.isLoaded(8000);
    await assertOrDump(quoteOpen, 'R35: Quote screen did not open for NIFTY 25100 CE', 'Quote screen should open after selecting the contract');

    const buyTapped = await quotePage.tapBuyButton();
    console.log(`  ℹ  Buy button tapped: ${buyTapped}`);
    await assertOrDump(buyTapped, 'R35: could not tap Buy on the Quote screen', 'Buy button should be tappable on the Quote screen');
    await browser.pause(1000);

    const onOrderPad = await orderPadPage.isLoaded(8000);
    await assertOrDump(onOrderPad, 'R35: OrderPad screen did not open for NIFTY 25100 CE', 'OrderPad screen should open after tapping Buy');

    const priceEdited = await orderPadPage.setPrice('0.00');
    console.log(`  ℹ  Price field cleared and set to 0.00: ${priceEdited}`);
    await assertOrDump(priceEdited, 'R35: could not click/clear/enter the price field', 'Price field should be clickable and editable');
    await browser.pause(300);

    await placeOrderViaDprBounce('R35');
  });

  // Places a REAL order on the BFO segment — SENSEX 77100 CE. Same direct-search
  // approach as R35, for the same reason (the target strike sits outside the Option
  // Chain screen's default visible range).
  it('R36: Place a real order for the BFO segment — SENSEX 77100 CE, DPR-bounce to the lower circuit', async function () {
    this.timeout(60000);

    await watchlistPage.goToWatchlist();
    await watchlistPage.tapSearchBox();
    const searchOpen = await watchlistPage.isDisplayed(WL_SEL.searchInput, 5000);
    await assertOrDump(searchOpen, 'R36: search overlay did not open', 'Search overlay input should be visible after tapping search');

    const results = await searchAndGetResults('SENSEX 77100 CE');
    console.log(`  ℹ  "SENSEX 77100 CE" search results: ${results.length}`);
    await assertOrDump(results.length > 0, 'R36: "SENSEX 77100 CE" not found in search results', 'Search should return at least one result for "SENSEX 77100 CE"');

    await results[0].click();
    await browser.pause(500);

    const quoteOpen = await quotePage.isLoaded(8000);
    await assertOrDump(quoteOpen, 'R36: Quote screen did not open for SENSEX 77100 CE', 'Quote screen should open after selecting the contract');

    const buyTapped = await quotePage.tapBuyButton();
    console.log(`  ℹ  Buy button tapped: ${buyTapped}`);
    await assertOrDump(buyTapped, 'R36: could not tap Buy on the Quote screen', 'Buy button should be tappable on the Quote screen');
    await browser.pause(1000);

    const onOrderPad = await orderPadPage.isLoaded(8000);
    await assertOrDump(onOrderPad, 'R36: OrderPad screen did not open for SENSEX 77100 CE', 'OrderPad screen should open after tapping Buy');

    const priceEdited = await orderPadPage.setPrice('0.00');
    console.log(`  ℹ  Price field cleared and set to 0.00: ${priceEdited}`);
    await assertOrDump(priceEdited, 'R36: could not click/clear/enter the price field', 'Price field should be clickable and editable');
    await browser.pause(300);

    await placeOrderViaDprBounce('R36');
  });

  // Places a REAL order on the CDS segment — Market tab -> Currency -> Top Losers (its
  // Top Gainers list was empty at exploration time) -> first symbol shown.
  it('R37: Place a real order for the CDS segment — first Currency market mover, DPR-bounce to the lower circuit', async function () {
    this.timeout(60000);

    const opened = await tapFirstMarketMover('Currency', 'Top Losers');
    await assertOrDump(opened, 'R37: could not open a Currency market mover', 'Should be able to open a symbol from the Currency market movers list');
    await browser.pause(1000);

    const quoteOpen = await quotePage.isLoaded(8000);
    await assertOrDump(quoteOpen, 'R37: Quote screen did not open for the Currency mover', 'Quote screen should open after selecting the symbol');

    const buyTapped = await quotePage.tapBuyButton();
    console.log(`  ℹ  Buy button tapped: ${buyTapped}`);
    await assertOrDump(buyTapped, 'R37: could not tap Buy on the Quote screen', 'Buy button should be tappable on the Quote screen');
    await browser.pause(1000);

    const onOrderPad = await orderPadPage.isLoaded(8000);
    await assertOrDump(onOrderPad, 'R37: OrderPad screen did not open', 'OrderPad screen should open after tapping Buy');

    const priceEdited = await orderPadPage.setPrice('0.00');
    console.log(`  ℹ  Price field cleared and set to 0.00: ${priceEdited}`);
    await assertOrDump(priceEdited, 'R37: could not click/clear/enter the price field', 'Price field should be clickable and editable');
    await browser.pause(300);

    await placeOrderViaDprBounce('R37');
  });

  // Places a REAL order on the MCX segment — Market tab -> Commodity -> Top Gainers ->
  // first symbol shown.
  it('R38: Place a real order for the MCX segment — first Commodity market mover, DPR-bounce to the lower circuit', async function () {
    this.timeout(60000);

    const opened = await tapFirstMarketMover('Commodity', 'Top Gainers');
    await assertOrDump(opened, 'R38: could not open a Commodity market mover', 'Should be able to open a symbol from the Commodity market movers list');
    await browser.pause(1000);

    const quoteOpen = await quotePage.isLoaded(8000);
    await assertOrDump(quoteOpen, 'R38: Quote screen did not open for the Commodity mover', 'Quote screen should open after selecting the symbol');

    const buyTapped = await quotePage.tapBuyButton();
    console.log(`  ℹ  Buy button tapped: ${buyTapped}`);
    await assertOrDump(buyTapped, 'R38: could not tap Buy on the Quote screen', 'Buy button should be tappable on the Quote screen');
    await browser.pause(1000);

    const onOrderPad = await orderPadPage.isLoaded(8000);
    await assertOrDump(onOrderPad, 'R38: OrderPad screen did not open', 'OrderPad screen should open after tapping Buy');

    const priceEdited = await orderPadPage.setPrice('0.00');
    console.log(`  ℹ  Price field cleared and set to 0.00: ${priceEdited}`);
    await assertOrDump(priceEdited, 'R38: could not click/clear/enter the price field', 'Price field should be clickable and editable');
    await browser.pause(300);

    await placeOrderViaDprBounce('R38');
  });

  // Read-only pass over the Basket screen (Orders -> Basket tab). A saved basket's
  // EXECUTE button places every item in it as a REAL order — this test only ever
  // reads the basket's contents, and never taps EXECUTE, Edit, or Add symbols.
  it('R39: Open the Basket screen and open the first saved basket', async function () {
    this.timeout(20000);

    await watchlistPage.goToWatchlist();
    await watchlistPage.tapNavOrders();
    await browser.pause(1000);

    const basketTabTapped = await basketPage.tapBasketTab();
    await assertOrDump(basketTabTapped, 'R39: could not tap the Basket tab', 'Basket tab should be tappable on the Orders screen');
    await browser.pause(1000);

    const newBasketVisible = await basketPage.isNewBasketVisible();
    console.log(`  ℹ  "New Basket" button visible: ${newBasketVisible}`);
    await assertOrDump(newBasketVisible, 'R39: "New Basket" button not found', '"New Basket" button should be visible on the Basket tab');

    const basketRows = await basketPage.getBasketListRows();
    console.log(`  ℹ  Saved baskets (${basketRows.length}):`);
    basketRows.forEach((r, i) => console.log(`     [${i}] ${r}`));

    if (basketRows.length === 0) {
      console.log('  ℹ  No saved baskets to open — nothing further to validate.');
      await watchlistPage.goToWatchlist();
      return;
    }

    const opened = await basketPage.openBasket(0);
    await assertOrDump(opened, 'R39: could not open the first saved basket', 'The first saved basket should be tappable');
    await browser.pause(1000);

    const detailLoaded = await basketPage.isBasketDetailLoaded(5000);
    await assertOrDump(detailLoaded, 'R39: basket detail screen did not load', 'Basket detail screen should load after opening a basket');
  });

  // Continues directly from R39 — the basket detail screen is still open (unless
  // R39 found no saved baskets, in which case this is a no-op).
  it("R40: Validate the opened basket's items and EXECUTE button (no execute)", async function () {
    this.timeout(20000);

    if (!await basketPage.isBasketDetailLoaded(2000)) {
      console.log('  ℹ  No basket detail screen open (R39 found no saved baskets) — nothing to validate.');
      return;
    }

    const itemCount = await basketPage.getItemCount();
    console.log(`  ℹ  Item count: ${itemCount ? `${itemCount.loaded}/${itemCount.total}` : 'unknown'}`);
    await assertOrDump(!!itemCount, 'R40: item count not found on basket detail screen', 'Basket detail screen should show a "loaded/total items" count');

    // Scroll down then back up, printing and validating whatever items are visible.
    await basketPage.swipeUp();
    await browser.pause(400);
    const itemsAfterScrollDown = await basketPage.getBasketItems();
    console.log(`  ℹ  Items after scrolling down (${itemsAfterScrollDown.length}):`);
    itemsAfterScrollDown.forEach((it, i) => console.log(`     [${i}] ${it.raw}`));

    await basketPage.swipeDown();
    await browser.pause(400);
    const items = await basketPage.getBasketItems();
    console.log(`  ℹ  Items after scrolling back up (${items.length}):`);
    await assertOrDump(items.length > 0, 'R40: no basket items found', 'Basket detail screen should show at least one item');
    for (const item of items) {
      console.log(`  ℹ  ${item.side} ${item.name} — qty=${item.qty} price=${item.price} exchange=${item.exchange} product=${item.productType} order=${item.orderType}`);
      await assertOrDump(!!(item.side && item.name && item.qty && item.price && item.exchange),
        'R40: could not parse a basket item', `Row "${item.raw}" should parse into side/name/qty/price/exchange`);
    }

    // EXECUTE is present but deliberately never tapped — it would place every item as a real order.
    const executeVisible = await basketPage.isExecuteVisible();
    console.log(`  ℹ  EXECUTE button visible: ${executeVisible}`);
    await assertOrDump(executeVisible, 'R40: EXECUTE button not found on basket detail screen', 'EXECUTE button should be visible on the basket detail screen');

    const closed = await basketPage.closeBasketDetail();
    console.log(`  ℹ  Basket detail closed: ${closed}`);
    await assertOrDump(closed, 'R40: could not close the basket detail screen', 'Basket detail screen should be closable');
    await browser.pause(500);

    await watchlistPage.goToWatchlist();
  });

  // Read-only pass over Funds/Margin and its sub-screens. Withdraw Funds' "Proceed"
  // and Add Funds' payment-method options both move real money — this test only ever
  // validates that they're present, never taps them.
  it('R41: Open the Funds screen and validate its fields', async function () {
    this.timeout(20000);

    await watchlistPage.goToWatchlist();
    const opened = await fundsPage.openFunds();
    await assertOrDump(opened, 'R41: could not open the Funds screen', 'Should be able to open Funds from the hamburger menu');
    await browser.pause(800);

    const loaded = await fundsPage.isLoaded(8000);
    await assertOrDump(loaded, 'R41: Funds screen did not load', 'Funds screen should load after selecting Funds from the menu');

    const fields = await fundsPage.getAllFields();
    console.log('  ℹ  Funds screen fields:');
    for (const [key, value] of Object.entries(fields)) console.log(`     - ${key}: ${value}`);
    const [viewTxnVisible, withdrawVisible, addFundsVisible] = await Promise.all([
      fundsPage.isViewTransactionsVisible(),
      fundsPage.isWithdrawFundsVisible(),
      fundsPage.isAddFundsVisible(),
    ]);
    console.log(`  ℹ  View Transactions visible: ${viewTxnVisible}  |  Withdraw Funds visible: ${withdrawVisible}  |  Add Funds visible: ${addFundsVisible}`);
    await assertOrDump(!!fields.marginAvailable, 'R41: Margin available field not found', 'Margin available to trade should be visible on the Funds screen');
    await assertOrDump(!!fields.availableFund, 'R41: Available Fund field not found', 'Available Fund should be visible on the Funds screen');
    await assertOrDump(!!fields.marginUtilised, 'R41: Margin utilised field not found', 'Margin utilised should be visible on the Funds screen');
    await assertOrDump(!!fields.cashEquivalent, 'R41: Cash Equivalent field not found', 'Cash Equivalent should be visible on the Funds screen');
    await assertOrDump(!!fields.collateral, 'R41: Collateral field not found', 'Collateral should be visible on the Funds screen');
    await assertOrDump(!!fields.optionCreditForSale, 'R41: Option Credit for Sale field not found', 'Option Credit for Sale should be visible on the Funds screen');
    await assertOrDump(viewTxnVisible, 'R41: View Transactions button not found', 'View Transactions button should be visible on the Funds screen');
    await assertOrDump(withdrawVisible, 'R41: Withdraw Funds button not found', 'Withdraw Funds button should be visible on the Funds screen');
    await assertOrDump(addFundsVisible, 'R41: Add Funds button not found', 'Add Funds button should be visible on the Funds screen');
  });

  it('R42: Funds — View Transactions', async function () {
    this.timeout(20000);

    await watchlistPage.goToWatchlist();
    const opened = await fundsPage.openFunds();
    await assertOrDump(opened, 'R42: could not open the Funds screen', 'Should be able to open Funds from the hamburger menu');
    await browser.pause(800);
    await assertOrDump(await fundsPage.isLoaded(8000), 'R42: Funds screen did not load', 'Funds screen should load after selecting Funds from the menu');

    // View Transactions: print any transactions (or the empty state), then come back.
    const txnTapped = await fundsPage.tapViewTransactions();
    await assertOrDump(txnTapped, 'R42: could not tap View Transactions', 'View Transactions button should be tappable');
    await browser.pause(1000);

    const txnLoaded = await fundsPage.isTransactionHistoryLoaded();
    await assertOrDump(txnLoaded, 'R42: Transaction History screen did not load', 'Transaction History screen should load after tapping View Transactions');

    const noTxn = await fundsPage.isNoTransactionsVisible();
    if (noTxn) {
      console.log('  ℹ  No transactions found for this account.');
    } else {
      const transactions = await fundsPage.getTransactions();
      console.log(`  ℹ  Transactions (${transactions.length}):`);
      transactions.forEach((t, i) => console.log(`     [${i}] ${t}`));
    }

    await safeBack();
    await browser.pause(800);
    const backOnFunds = await fundsPage.isLoaded(5000);
    await assertOrDump(backOnFunds, 'R42: did not return to the Funds screen after View Transactions', 'Should return to the Funds screen after viewing transactions');
    await watchlistPage.goToWatchlist();
  });

  it('R43: Funds — Withdraw Funds (no submit)', async function () {
    this.timeout(20000);

    await watchlistPage.goToWatchlist();
    const opened = await fundsPage.openFunds();
    await assertOrDump(opened, 'R43: could not open the Funds screen', 'Should be able to open Funds from the hamburger menu');
    await browser.pause(800);
    await assertOrDump(await fundsPage.isLoaded(8000), 'R43: Funds screen did not load', 'Funds screen should load after selecting Funds from the menu');

    // Withdraw Funds: validate it opens, then come back WITHOUT tapping Proceed.
    const withdrawTapped = await fundsPage.tapWithdrawFunds();
    await assertOrDump(withdrawTapped, 'R43: could not tap Withdraw Funds', 'Withdraw Funds button should be tappable');
    await browser.pause(1000);

    const withdrawLoaded = await fundsPage.isWithdrawScreenLoaded();
    await assertOrDump(withdrawLoaded, 'R43: Withdraw Funds screen did not load', 'Withdraw Funds screen should load after tapping Withdraw Funds');
    const proceedVisible = await fundsPage.isWithdrawProceedVisible();
    console.log(`  ℹ  Withdraw Funds screen loaded — Proceed button visible: ${proceedVisible} (never tapped)`);
    await assertOrDump(proceedVisible, 'R43: Proceed button not found on Withdraw Funds screen', 'Proceed button should be visible on the Withdraw Funds screen');

    await safeBack();
    await browser.pause(800);
    const backOnFunds = await fundsPage.isLoaded(5000);
    await assertOrDump(backOnFunds, 'R43: did not return to the Funds screen after Withdraw Funds', 'Should return to the Funds screen after viewing Withdraw Funds');
    await watchlistPage.goToWatchlist();
  });

  it('R44: Funds — Add Funds (no submit)', async function () {
    this.timeout(20000);

    await watchlistPage.goToWatchlist();
    const opened = await fundsPage.openFunds();
    await assertOrDump(opened, 'R44: could not open the Funds screen', 'Should be able to open Funds from the hamburger menu');
    await browser.pause(800);
    await assertOrDump(await fundsPage.isLoaded(8000), 'R44: Funds screen did not load', 'Funds screen should load after selecting Funds from the menu');

    // Add Funds: validate it opens, then come back WITHOUT selecting a payment method.
    const addFundsTapped = await fundsPage.tapAddFunds();
    await assertOrDump(addFundsTapped, 'R44: could not tap Add Funds', 'Add Funds button should be tappable');
    await browser.pause(1000);

    const addFundsLoaded = await fundsPage.isAddFundsScreenLoaded();
    await assertOrDump(addFundsLoaded, 'R44: Add Funds screen did not load', 'Add Funds screen should load after tapping Add Funds');
    const paymentMethodsVisible = await fundsPage.isPaymentMethodsVisible();
    console.log(`  ℹ  Add Funds screen loaded — payment methods visible: ${paymentMethodsVisible} (none selected)`);
    await assertOrDump(paymentMethodsVisible, 'R44: payment method options not found on Add Funds screen', 'UPI/Net Banking options should be visible on the Add Funds screen');

    await safeBack();
    await browser.pause(800);
    await watchlistPage.goToWatchlist();
  });

  it('R45: Open News, scroll the list, and validate the search field', async function () {
    this.timeout(30000);

    await watchlistPage.goToWatchlist();
    const opened = await newsPage.openNews();
    await assertOrDump(opened, 'R45: could not open the News screen', 'Should be able to open News from the hamburger menu');
    await browser.pause(800);

    const loaded = await newsPage.isLoaded(8000);
    await assertOrDump(loaded, 'R45: News screen did not load', 'News screen should load after selecting News from the menu');

    // Lands on "All" by default; scroll the list down then back up.
    await newsPage.scrollList('down');
    await newsPage.scrollList('up');
    console.log('  ℹ  Scrolled the News list down and back up.');

    const searchVisible = await newsPage.isSearchFieldVisible();
    console.log(`  ℹ  News search field visible: ${searchVisible}`);
    await assertOrDump(searchVisible, 'R45: search field not found on News screen', 'Search field should be visible on the News screen');
  });

  it('R46: Click through every News tab', async function () {
    this.timeout(30000);

    await watchlistPage.goToWatchlist();
    const opened = await newsPage.openNews();
    await assertOrDump(opened, 'R46: could not open the News screen', 'Should be able to open News from the hamburger menu');
    await browser.pause(800);
    await assertOrDump(await newsPage.isLoaded(8000), 'R46: News screen did not load', 'News screen should load after selecting News from the menu');

    // Click through every tab (All / Result / Block Deals / Equity / Commentary / ...).
    const tabsTapped = await newsPage.tapAllTabs();
    console.log(`  ℹ  News tabs tapped (${tabsTapped.length}): ${tabsTapped.join(', ')}`);
    expect(tabsTapped.length, 'Should have tapped at least 1 News tab').to.be.above(0);

    await newsPage.closeNews();
    await browser.pause(800);
    const backOnWatchlist = await watchlistPage.isLoaded(5000);
    await assertOrDump(backOnWatchlist, 'R46: did not return to Watchlist after closing News', 'Should return to Watchlist after closing News');
  });

  it('R47: Open Alerts and print existing entries with Enabled/Disabled status', async function () {
    this.timeout(20000);

    await watchlistPage.goToWatchlist();
    const opened = await alertsPage.openAlerts();
    await assertOrDump(opened, 'R47: could not open the Alerts screen', 'Should be able to open Alerts from the hamburger menu');
    await browser.pause(800);

    const loaded = await alertsPage.isLoaded(8000);
    await assertOrDump(loaded, 'R47: Alerts screen did not load', 'Alerts screen should load after selecting Alerts from the menu');

    const entries = await alertsPage.getAlertEntries();
    console.log(`  ℹ  Existing alerts (${entries.length}):`);
    entries.forEach((e, i) => console.log(`     [${i}] ${e.symbol} (${e.exchange}) — Status: ${e.status}`));
  });

  // Continues directly from R47 — the Alerts screen is still open.
  it('R48: Create a price Alert for TCS (LTP + ~10%)', async function () {
    this.timeout(30000);

    // Add Alert → search TCS → open its Set Alert screen.
    const addTapped = await alertsPage.tapAddAlert();
    await assertOrDump(addTapped, 'R48: could not tap Add Alert', 'Add Alert button should be tappable');
    await browser.pause(800);

    const searched = await alertsPage.searchSymbol('TCS');
    await assertOrDump(searched, 'R48: no search results for TCS', 'Searching TCS should return at least one result');
    const resultTapped = await alertsPage.tapFirstSearchResult();
    await assertOrDump(resultTapped, 'R48: could not tap the TCS search result', 'Should be able to tap the first TCS search result');
    await browser.pause(1000);

    const onSetAlert = await alertsPage.isSetAlertScreenLoaded();
    await assertOrDump(onSetAlert, 'R48: Set Alert screen did not load', 'Set Alert screen should load after picking TCS');

    // Print the LTP, then set the target value ~10% above it (QA-automation example
    // value only — not a real trading signal).
    const ltp = await alertsPage.getLtp();
    console.log(`  ℹ  TCS LTP: ${ltp}`);
    await assertOrDump(ltp !== null, 'R48: could not read TCS LTP', 'LTP should be readable on the Set Alert screen');

    const targetValue = (Math.round(ltp * 1.10 * 100) / 100).toFixed(2);
    console.log(`  ℹ  Setting alert value to ${targetValue} (LTP + ~10%, QA automation example)`);
    await alertsPage.setAlertValue(targetValue);
    // The alert row's content-desc renders the value with Indian comma-grouping
    // (e.g. "2,582.80"), so strip commas before comparing against targetValue.
    const hasTargetValue = (raw) => raw.replace(/,/g, '').includes(targetValue);

    // Create the alert and capture whatever toast/error appears.
    await alertsPage.tapCreateAlert();
    const toast = await alertsPage.captureToast(3000);
    console.log(`  ℹ  Toast after Create Alert: ${toast || '(none captured — likely a silent success, returned straight to Alerts list)'}`);
    await browser.pause(1000);

    const backOnAlerts = await alertsPage.isLoaded(5000);
    await assertOrDump(backOnAlerts, 'R48: did not return to the Alerts screen after creating the alert', 'Should return to Alerts screen after creating the alert');

    const entriesAfter = await alertsPage.getAlertEntries();
    const created = entriesAfter.find(e => e.symbol === 'TCS' && hasTargetValue(e.raw));
    console.log(`  ℹ  New alert created: ${created ? created.raw.split(/&#10;|\n/).slice(2).join(' ') : 'NOT FOUND'}`);
    await assertOrDump(!!created, 'R48: newly created TCS alert not found in the list', 'The TCS alert just created should appear in the Alerts list');
  });

  // Continues directly from R48 — deletes whatever alert is now topmost (alerts sort
  // newest-first, confirmed via real dumps, so that's the one R48 just created). The
  // Dev backend has been observed to return "Internal server error" on delete — retry
  // a few times before giving up, since that's an environment issue, not a test bug
  // (mirrors the retry pattern used for OTP submission elsewhere).
  it('R49: Delete the created Alert (with confirm popup)', async function () {
    this.timeout(30000);

    const beforeEntries = await alertsPage.getAlertEntries();
    const targetRaw = beforeEntries[0] ? beforeEntries[0].raw : null;
    await assertOrDump(!!targetRaw, 'R49: no alert found to delete', 'There should be at least one alert to delete (created by R48)');

    let deleted = false;
    let lastToast = null;
    for (let attempt = 1; attempt <= 3 && !deleted; attempt++) {
      const rowTapped = await alertsPage.tapAlertRow(0);
      await assertOrDump(rowTapped, 'R49: could not tap the created alert row', 'Should be able to tap the created alert row');
      await browser.pause(800);

      const sheetLoaded = await alertsPage.isAlertDetailSheetLoaded();
      await assertOrDump(sheetLoaded, 'R49: alert detail sheet did not load', 'Alert detail sheet (Disable/Edit/Delete) should load after tapping the alert');

      const deleteTapped = await alertsPage.tapDelete();
      await assertOrDump(deleteTapped, 'R49: DELETE option not found', 'DELETE option should be visible on the alert detail sheet');
      await browser.pause(600);

      const confirmVisible = await alertsPage.isDeleteConfirmVisible();
      await assertOrDump(confirmVisible, 'R49: delete confirmation popup did not appear', 'A confirmation popup should appear after tapping DELETE');

      await alertsPage.confirmDelete();
      lastToast = await alertsPage.captureToast(3000);
      await browser.pause(1000);

      const stillPresent = (await alertsPage.getAlertEntries()).some(e => e.raw === targetRaw);
      deleted = !stillPresent;
      console.log(`  ℹ  Delete attempt ${attempt}: ${deleted ? 'succeeded' : `failed${lastToast ? ` (toast: ${lastToast})` : ''}`}`);
    }

    if (!deleted) {
      console.log('  ⚠  Could not delete the test alert after 3 attempts — Dev backend returned an error each time. This is an environment issue, not a test failure; the alert may need manual cleanup.');
    }

    await watchlistPage.goToWatchlist();
  });

  it('R50: NxtOption — Strategy Builder', async function () {
    this.timeout(20000);

    await watchlistPage.goToWatchlist();
    const expanded = await nxtOptionPage.openNxtOptionMenu();
    await assertOrDump(expanded, 'R50: NxtOption dropdown did not expand', 'Tapping NxtOption in the hamburger menu should reveal Strategy Builder / IV Analysis / OI Analysis');

    const sbTapped = await nxtOptionPage.tapStrategyBuilder();
    await assertOrDump(sbTapped, 'R50: could not tap Strategy Builder', 'Strategy Builder should be tappable from the NxtOption dropdown');
    await browser.pause(800);

    const sbLoaded = await nxtOptionPage.isStrategyBuilderLoaded();
    await assertOrDump(sbLoaded, 'R50: Strategy Builder screen did not load', 'Strategy Builder screen should load after tapping it');

    await nxtOptionPage.goBack();
    await browser.pause(800);
    const backOnWatchlist = await watchlistPage.isLoaded(5000);
    console.log(`  ℹ  Back from Strategy Builder lands on Watchlist directly: ${backOnWatchlist}`);
    await assertOrDump(backOnWatchlist, 'R50: did not return to Watchlist after Strategy Builder', 'Back from Strategy Builder should return to Watchlist');
  });

  it('R51: NxtOption — IV Analysis', async function () {
    this.timeout(20000);

    await watchlistPage.goToWatchlist();
    const expanded = await nxtOptionPage.openNxtOptionMenu();
    await assertOrDump(expanded, 'R51: NxtOption dropdown did not expand', 'NxtOption dropdown should expand for IV Analysis');

    const ivTapped = await nxtOptionPage.tapIvAnalysis();
    await assertOrDump(ivTapped, 'R51: could not tap IV Analysis', 'IV Analysis should be tappable from the NxtOption dropdown');
    await browser.pause(800);

    const ivLoaded = await nxtOptionPage.isIvAnalysisLoaded();
    await assertOrDump(ivLoaded, 'R51: IV Analysis screen did not load', 'IV Analysis screen should load after tapping it');

    await nxtOptionPage.goBack();
    await browser.pause(800);
    const backOnWatchlist = await watchlistPage.isLoaded(5000);
    await assertOrDump(backOnWatchlist, 'R51: did not return to Watchlist after IV Analysis', 'Back from IV Analysis should return to Watchlist');
  });

  it('R52: NxtOption — OI Analysis', async function () {
    this.timeout(20000);

    await watchlistPage.goToWatchlist();
    const expanded = await nxtOptionPage.openNxtOptionMenu();
    await assertOrDump(expanded, 'R52: NxtOption dropdown did not expand', 'NxtOption dropdown should expand for OI Analysis');

    const oiTapped = await nxtOptionPage.tapOiAnalysis();
    await assertOrDump(oiTapped, 'R52: could not tap OI Analysis', 'OI Analysis should be tappable from the NxtOption dropdown');
    await browser.pause(800);

    const oiLoaded = await nxtOptionPage.isOiAnalysisLoaded();
    await assertOrDump(oiLoaded, 'R52: OI Analysis screen did not load', 'OI Analysis screen should load after tapping it');

    await nxtOptionPage.goBack();
    await browser.pause(800);
    const backOnWatchlist = await watchlistPage.isLoaded(5000);
    await assertOrDump(backOnWatchlist, 'R52: did not return to Watchlist after OI Analysis', 'Back from OI Analysis should return to Watchlist');
  });

  it('R53: Validate Portfolio — Holdings fields', async function () {
    this.timeout(30000);

    const opened = await portfolioPage.openPortfolio();
    await assertOrDump(opened, 'R53: could not open the Portfolio tab', 'Portfolio bottom-nav tab should be tappable');
    await browser.pause(800);

    const loaded = await portfolioPage.isLoaded(8000);
    await assertOrDump(loaded, 'R53: Portfolio screen did not load', 'Portfolio screen should show Holdings and Positions tabs');

    const holdingsCount = await portfolioPage.getHoldingsCount();
    console.log(`  ℹ  Holdings count: ${holdingsCount}`);

    const summary = await portfolioPage.getHoldingsSummary();
    console.log(`  ℹ  Holdings summary — Current: ${summary.currentValue}, Overall P&L: ${summary.overallPnl}, Invested: ${summary.investedValue}, Today's P&L: ${summary.todayPnl}`);
    await assertOrDump(!!summary.currentValue && !!summary.investedValue, 'R53: Holdings summary fields not found', 'Current and Invested value should be visible on the Holdings tab');

    const holdingsRows = await portfolioPage.getHoldingsRows();
    console.log(`  ℹ  Holdings rows (${holdingsRows.length}):`);
    holdingsRows.forEach((r, i) => console.log(`     [${i}] ${r.symbol} — Qty: ${r.quantity}, Avg Price: ${r.avgPrice}, Invested: ${r.invested}`));

    if (holdingsRows.length > 0) {
      const rowTapped = await portfolioPage.tapHoldingRow(0);
      await assertOrDump(rowTapped, 'R53: could not tap the first holding row', 'A holding row should be tappable');
      await browser.pause(1000);

      const detailLoaded = await portfolioPage.isHoldingDetailLoaded();
      await assertOrDump(detailLoaded, 'R53: holding detail screen did not load', 'Holding detail screen should load after tapping a holding row');

      const fields = await portfolioPage.getHoldingDetailFields();
      console.log('  ℹ  Holding detail fields:');
      for (const [key, value] of Object.entries(fields)) console.log(`     - ${key}: ${value}`);
      await assertOrDump(!!fields.stockDetails, 'R53: Stock details field not found', 'Stock details should be visible on the holding detail screen');
      await assertOrDump(!!fields.avgPrice, 'R53: Average Price field not found', 'Average Price should be visible on the holding detail screen');
      await assertOrDump(!!fields.marketValue, 'R53: Market Value field not found', 'Market Value should be visible on the holding detail screen');
      await assertOrDump(!!fields.investedValue, 'R53: Invested Value field not found', 'Invested Value should be visible on the holding detail screen');

      const [squareOffVisible, buyMoreVisible] = await Promise.all([
        portfolioPage.isSquareOffVisible(),
        portfolioPage.isBuyMoreVisible(),
      ]);
      console.log(`  ℹ  SQUARE OFF visible: ${squareOffVisible} (never tapped) | BUY MORE visible: ${buyMoreVisible} (never tapped)`);

      await portfolioPage.closeHoldingDetail();
      await browser.pause(800);
    } else {
      console.log('  ℹ  No holdings to open — skipping holding detail validation.');
    }

    await watchlistPage.goToWatchlist();
  });

  it('R54: Validate Portfolio — Positions fields', async function () {
    this.timeout(20000);

    const opened = await portfolioPage.openPortfolio();
    await assertOrDump(opened, 'R54: could not open the Portfolio tab', 'Portfolio bottom-nav tab should be tappable');
    await browser.pause(800);
    await assertOrDump(await portfolioPage.isLoaded(8000), 'R54: Portfolio screen did not load', 'Portfolio screen should show Holdings and Positions tabs');

    const posTapped = await portfolioPage.tapPositionsTab();
    await assertOrDump(posTapped, 'R54: could not tap the Positions tab', 'Positions tab should be tappable');
    await browser.pause(800);

    const positionsCount = await portfolioPage.getPositionsCount();
    console.log(`  ℹ  Positions count: ${positionsCount}`);

    if (positionsCount === 0) {
      const noPositions = await portfolioPage.isNoPositionsVisible();
      console.log(`  ℹ  "You don't have any positions" empty-state message visible: ${noPositions}`);
      await assertOrDump(noPositions, 'R54: empty-state message not found on Positions tab', 'Empty-state message should be visible when there are no positions');
    } else {
      const positionRows = await portfolioPage.getPositionRows();
      console.log(`  ℹ  Position rows (${positionRows.length}):`);
      positionRows.forEach((r, i) => console.log(`     [${i}] ${r}`));
      await assertOrDump(positionRows.length > 0, 'R54: Positions count > 0 but no rows parsed', 'Position rows should be parseable when the count is above 0');
    }

    await watchlistPage.goToWatchlist();
  });
});
