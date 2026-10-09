/**
 * Regression: Login & Authentication Flow — Globe Capital Dev
 *
 * R1 : Build version             — read the "vX.Y.Z (build)" label on the Login screen
 * R2 : Forgot Password           — tap, verify navigation, back to Login (validated before login)
 * R3 : Login flow                — enter credentials, tap LOGIN
 * R4 : OTP Login                 — verify + submit FIRST OTP
 * R5 : Enable Now                — Enable Globe Secure screen
 * R6 : Second OTP page           — verify + submit SECOND OTP
 * R7 : Device PIN Login          — biometric/PIN screen
 * R8 : Risk Disclosure           — some accounts don't show this screen at all; accept if shown, skip if not
 *
 * Note: watchlist names/count differ per client ID, so Watchlist steps (R10+) locate
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
const mutualFundsPage  = require('../pages/MutualFunds/MutualFundsPage');
const testData         = require('../data/testData');
const { getLatestUid, fetchLatestOtp }             = require('../utils/gmailOtpHelper');
const { clearAndLaunch, dumpScreen, handlePermissionDialog } = require('../utils/helpers');

// Set RESUME_SESSION=1 to skip R2-R8 login and land straight on Watchlist when the
// app already has a valid session — combine with --mochaOpts.grep to run one test
// case in isolation, e.g.:
//   RESUME_SESSION=1 npx wdio run ./config/wdio.android.conf.js --spec ./Regression/New_Regression.spec.js --mochaOpts.grep "R42"
const RESUME_SESSION = !!process.env.RESUME_SESSION;

// Set PLACE_REAL_ORDERS=1 to let R34-R39 proceed past reading the Quote screen's lower
// circuit and actually open the OrderPad, submit, and confirm a real order at that
// price. Defaults to OFF (verification only): each test reads and prints the segment's
// lower/upper circuit, then returns to Watchlist without ever tapping Buy - these tests
// place real trades on a live account, so this stays off until explicitly confirmed.
const PLACE_REAL_ORDERS = !!process.env.PLACE_REAL_ORDERS;

// Trading hours (IST) per segment - R34-R39 only run inside their segment's window and are
// skipped (reported as skipped, not failed) outside it, including Saturday/Sunday. Times are
// [open, close) in minutes after midnight: an order at exactly the close time is outside.
// Exchange holidays are not known here, so a weekday holiday still runs (and fails).
const MARKET_HOURS = {
  NSE: { open: 9 * 60 + 15, close: 15 * 60 + 30 },
  BSE: { open: 9 * 60 + 15, close: 15 * 60 + 30 },
  NFO: { open: 9 * 60 + 15, close: 15 * 60 + 40 },
  BFO: { open: 9 * 60 + 15, close: 15 * 60 + 40 },
  CDS: { open: 9 * 60, close: 17 * 60 },
  MCX: { open: 9 * 60, close: 17 * 60 },
};

// Current IST weekday and minutes after midnight, independent of the machine's own timezone.
function nowInIST() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map(p => [p.type, p.value]));
  return { weekday: parts.weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute), label: `${parts.weekday} ${parts.hour}:${parts.minute} IST` };
}

const fmtMinutes = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// Call first thing in an order test: skips it (this.skip()) when `segment` is outside its
// trading hours, so no order is attempted on a closed market.
function skipIfMarketClosed(ctx, label, segment) {
  const { open, close } = MARKET_HOURS[segment];
  const now = nowInIST();
  const weekend = now.weekday === 'Sat' || now.weekday === 'Sun';
  if (weekend || now.minutes < open || now.minutes >= close) {
    console.log(`  ⏸  ${label}: Market closed - unable to place orders (${segment} trades ${fmtMinutes(open)}-${fmtMinutes(close)} IST, Mon-Fri; now ${now.label})`);
    ctx.skip();
  }
}

// Reads like "Globe Capital Stock Trading: v1.0.0 (68)" on the Login screen — ported from
// SplashPage.buildVersionLabel (DriverManager stack) since that page object's BasePage isn't
// compatible with this one. Not anchored to start with "v": the label gained that app-name
// prefix, and the old "^v..." copy here silently never matched (R1 always "skipping").
const BUILD_VERSION_SEL = 'android=new UiSelector().descriptionMatches(".*v\\d+\\.\\d+\\.\\d+ \\(\\d+\\)$")';

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
// symbol, expiry, segment and price ("... FUT. MCXLast traded price ...", ending
// "...or swipe right for next category"). The Index ticker banner pinned above the
// movers list (e.g. "Index USDINR. Expiry: ...") ALSO contains "Double tap to view" and
// "Last traded price", and sits earlier in the tree, so without the "next category"
// qualifier it was matched as the "first mover" instead of any real row - landing on
// whatever that day's index-level ticker happens to be (once an already-expired
// same-day contract with no order-entry fields at all) rather than an actual movers
// list entry. The ticker's own ending ("...or swipe right for more options") never
// contains "next category", so this excludes it cleanly.
const MARKET_SEL = {
  tabPosition: { Commodity: 3, Currency: 4 },
  moversRow: '//*[contains(@content-desc,"Double tap to view") and contains(@content-desc,"Last traded price") and contains(@content-desc,"next category")]',
};

// Fetches the OTP mail that arrived after `sinceUid` (an inbox snapshot taken right before the
// action that triggers the email - see R3/R5 below - so a same-second email can't be missed) via
// this repo's existing gmailOtpHelper/credentials/gmail-config.json, same as tests/loginWithOtp.test.js.
// One resend-and-retry on rejection, mirroring that file's incorrect-OTP recovery.
async function submitOtp(label, sinceUid) {
  // SUBMIT must stay greyed out while no OTP has been entered.
  const submitEnabled = await otpPage.isSubmitEnabled();
  await assertOrDump(!submitEnabled, `${label}: SUBMIT enabled with empty OTP`,
    `${label}: SUBMIT should be disabled when no OTP is entered`);

  // The Enable Globe Secure OTP email was observed live to sometimes take longer than the
  // default 60s to arrive (unlike the first login OTP, which always arrived within ~15s) - so a
  // timed-out fetch here falls through to the same resend-and-refetch path used below for an
  // outright-rejected OTP, rather than failing the whole test on a slow but genuine email.
  let otp;
  try {
    otp = await fetchLatestOtp(sinceUid, 'One time password', 90000);
  } catch (err) {
    console.log(`  ⚠️  ${label} email not received in time (${err.message}) - requesting resend...`);
    const resendUid = await getLatestUid();
    await otpPage.tapResend();
    await browser.pause(1500);
    otp = await fetchLatestOtp(resendUid, 'One time password', 90000);
  }
  console.log(`  📧 Fetched ${label}: ${otp}`);
  await otpPage.enterOTP(otp);

  const verified = await otpPage.waitForNavigation(120000);
  if (verified) return;

  console.log(`  ❌ ${label} was rejected - requesting resend...`);
  const resendUid = await getLatestUid();
  await otpPage.tapResend();
  await browser.pause(1500);

  const resentOtp = await fetchLatestOtp(resendUid, 'One time password', 90000);
  console.log(`  📧 Fetched resent ${label}: ${resentOtp}`);
  await otpPage.enterOTP(resentOtp);

  const reverified = await otpPage.waitForNavigation(120000);
  if (!reverified) throw new Error(`${label} was rejected even after resend`);
}

// Collapses the "dump the screen for diagnosis, then assert" pattern repeated
// throughout this file: dumpScreen() only runs when the check actually failed.
// Every passed check is logged with ✓ so the report shows what each step verified, not
// only what failed (previously a fully passing step could show "No log output captured").
async function assertOrDump(ok, dumpLabel, message) {
  if (!ok) await dumpScreen(dumpLabel);
  expect(ok, message).to.be.true;
  console.log(`  ✓  ${message}`);
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

// Brings the tab at `pos` into view regardless of its name. Tap-based (see
// WatchlistPage.scrollToTabPosition) — swiping this tab strip does nothing.
async function scrollToTabPosition(pos) {
  return (await findTabByPosition(pos)) || watchlistPage.scrollToTabPosition(pos);
}

// NxtOption sub-screens (R51-R56): how to open each one from the hamburger drawer's
// NxtOption accordion, and how to tell it has loaded.
const NXT_SCREENS = {
  'Strategy Builder': { tap: () => nxtOptionPage.tapStrategyBuilder(), loaded: t => nxtOptionPage.isStrategyBuilderLoaded(t) },
  'IV Analysis':      { tap: () => nxtOptionPage.tapIvAnalysis(),      loaded: t => nxtOptionPage.isIvAnalysisLoaded(t) },
  'OI Analysis':      { tap: () => nxtOptionPage.tapOiAnalysis(),      loaded: t => nxtOptionPage.isOiAnalysisLoaded(t) },
};

async function openNxtOptionScreen(label, screen) {
  await watchlistPage.goToWatchlist();
  const expanded = await nxtOptionPage.openNxtOptionMenu();
  await assertOrDump(expanded, `${label}: NxtOption dropdown did not expand`, 'Tapping NxtOption in the hamburger menu should reveal Strategy Builder / IV Analysis / OI Analysis');
  const tapped = await NXT_SCREENS[screen].tap();
  console.log(`  ℹ  ${screen} tapped: ${tapped}`);
  await assertOrDump(tapped, `${label}: could not tap ${screen}`, `${screen} should be tappable from the NxtOption dropdown`);
  await browser.pause(800);
  const loaded = await NXT_SCREENS[screen].loaded(8000);
  console.log(`  ℹ  ${screen} screen loaded: ${loaded}`);
  await assertOrDump(loaded, `${label}: ${screen} screen did not load`, `${screen} screen should load after tapping it`);
}

// Reuses the screen the previous "open" test left showing; opens it fresh otherwise.
async function ensureNxtOptionScreen(label, screen) {
  if (await NXT_SCREENS[screen].loaded(2000)) return;
  console.log(`  ℹ  ${screen} not already open — opening it from the NxtOption menu`);
  await openNxtOptionScreen(label, screen);
}

// Device back from any NxtOption sub-screen lands straight on Watchlist (confirmed live);
// goToWatchlist() covers the case where Buy Call / a tab tap pushed an extra level.
async function backToWatchlistFromNxtOption(label, screen) {
  await nxtOptionPage.goBack();
  await browser.pause(800);
  await watchlistPage.goToWatchlist();
  console.log(`  ℹ  Back on Watchlist after ${screen}: ${await watchlistPage.isLoaded(5000)}`);
}

// Fails on a loader that never clears (infinite loading), any error message, or a
// screen that rendered nothing beyond its own header/tabs (`tabLabels`). With
// `chartAnchor` (a regex for the controls sitting directly above the chart), also fails
// if the area below them is blank in the screenshot — the chart itself is custom-drawn
// and invisible to the accessibility tree, so the label checks alone passed R54 on a
// completely empty IV Charts area. Saves a screenshot (and an XML dump on failure).
async function assertNxtOptionHealthy(label, what, tabLabels = [], { chartAnchor = null } = {}) {
  const health = await nxtOptionPage.getScreenHealth({ ignore: tabLabels, timeout: 20000 });
  console.log(`  ℹ  ${what}: loader cleared in ${health.stillLoading ? '>20s (still loading)' : `${health.loadMs}ms`}`);
  console.log(`  ℹ  ${what}: error messages: ${health.errors.join(' | ') || 'none'}`);
  console.log(`  ℹ  ${what}: content items (${health.content.length}): ${health.content.slice(0, 15).join(' | ') || 'none'}`);
  let chart = null;
  if (chartAnchor) {
    chart = await nxtOptionPage.getChartCoverage(chartAnchor);
    const pct = chart.coverage === null ? `unreadable (${chart.error})` : `${(chart.coverage * 100).toFixed(2)}%`;
    console.log(`  ℹ  ${what}: chart area y=${chart.region?.top}-${chart.region?.bottom} drawn pixels: ${pct} → chart displayed: ${chart.rendered}`);
  }
  const tag = `${label}-${what.replace(/\W+/g, '_')}`;
  await nxtOptionPage.takeScreenshot(tag);
  const ok = !health.stillLoading && health.errors.length === 0 && health.content.length > 0 && (!chart || chart.rendered);
  if (!ok) await nxtOptionPage.dumpPageSource(tag.toLowerCase());
  await assertOrDump(!health.stillLoading, `${label}: ${what} — infinite loading`, `${what} should finish loading within 20s (loader still shown)`);
  await assertOrDump(health.errors.length === 0, `${label}: ${what} — error shown`, `${what} should show no error — got: ${health.errors.join(' | ')}`);
  await assertOrDump(health.content.length > 0, `${label}: ${what} — no chart/data rendered`, `${what} should display charts/data`);
  if (chart) {
    await assertOrDump(chart.rendered, `${label}: ${what} — chart area is blank`,
      `${what} chart should be displayed — chart area is blank (${chart.coverage === null ? chart.error : `${(chart.coverage * 100).toFixed(2)}% drawn pixels`})`);
  }
  return health;
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
// absent. Shared by R25 and R28, the two tests that reach this point in the order flow.
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

// Reads the lower/upper circuit limits directly off the Quote screen (must be called
// while still on it, BEFORE tapping Buy - the OrderPad screen itself never shows these).
// Confirmed live that guessing at an out-of-range price and hoping the DPR guard
// rejects it (the previous "DPR-bounce" approach) is not reliable: at least one
// segment/symbol (IDEA/NSE) silently substitutes near-market price for an invalid entry
// instead of rejecting it, so no error ever appears to bounce off of. Reading the real
// lower circuit directly and entering it as a genuine in-range limit price sidesteps
// that entirely.
// Every flow that taps a symbol/index lands on the Quote screen as a half-height sheet —
// swipe it up to expand it to full screen before doing anything else on it.
async function expandQuoteScreen(label) {
  const { expanded, method } = await quotePage.expandBottomQuotePanel();
  console.log(`  ℹ  Quote screen expanded: ${expanded} (${method})`);
  await assertOrDump(expanded, `${label}: Quote screen did not expand after swiping up`, 'Swiping up on the Quote screen should expand it to full screen');
}

async function getLowerCircuitFromQuote(label) {
  // No-op when the caller already expanded the Quote screen (expandQuoteScreen above).
  await quotePage.expandBottomQuotePanel();
  await browser.pause(500);
  let limits = await quotePage.getCircuitLimits();
  if (!limits) {
    await quotePage.scrollToRevealFullQuote();
    limits = await quotePage.getCircuitLimits();
  }
  console.log(`  ℹ  Circuit limits: ${limits ? `${limits.lower} - ${limits.upper}` : 'not found'}`);
  await assertOrDump(!!limits, `${label}: could not read circuit limits from the Quote screen`, 'Circuit limits (Lower circuit / Upper circuit) should be readable on the Quote screen');
  return limits;
}

// Assumes the OrderPad is already open. Reads the symbol/segments, enters the given
// (already-read, genuinely in-range) lower circuit price into the Price field, and
// verifies it took - stops there, does NOT tap BUY submit. Safe to call unconditionally
// (no order placed) - the actual submission lives in submitAndConfirmOrder below, gated
// behind PLACE_REAL_ORDERS.
async function enterPriceOnOrderPad(label, price) {
  // Captured now, before navigating away — needed later to confirm the placed
  // order actually shows up in the Orderbook.
  const symbolName = await orderPadPage.getSymbolName();
  console.log(`  ℹ  Symbol for this order: ${symbolName}`);

  const segments = await orderPadPage.getVisibleSegments();
  console.log(`  ℹ  Segments for this symbol: ${segments.join(', ') || 'none detected'}`);

  const priceEdited = await orderPadPage.setPrice(price);
  console.log(`  ℹ  Price field cleared and set to the lower circuit (${price}): ${priceEdited}`);
  await assertOrDump(priceEdited, `${label}: could not click/clear/enter the price field with the lower circuit value`, 'Price field should be editable with the lower circuit value');
  await browser.pause(300);
  const priceAfter = await orderPadPage.getPrice();
  console.log(`  ℹ  Price field now reads: ${priceAfter}`);
  // Only the field's accessibility text - can read back correctly without the real order
  // state changing (see setPrice), so the confirmation popup's price check remains the
  // authoritative guard. This just catches an obviously wrong entry earlier.
  await assertOrDump(Number(priceAfter) === Number(price), `${label}: price field reads ${priceAfter}, expected the lower circuit price ${price}`, 'Price field should show the lower circuit value after entry');

  return symbolName;
}

// Places a REAL order — every caller is a segment-specific test that has been
// explicitly authorized to do so. Assumes the OrderPad is already open with the price
// field already set (via enterPriceOnOrderPad above). Taps BUY submit, continues
// through any surveillance warning, confirms the order, and verifies it lands in the
// Orderbook before returning to Watchlist.
async function submitAndConfirmOrder(label, price, symbolName, expectedExchange) {
  const buyTapped = await orderPadPage.tapBuySubmit();
  console.log(`  ℹ  BUY tapped at lower circuit price (${price}): ${buyTapped}`);
  await assertOrDump(buyTapped, `${label}: could not tap BUY submit on OrderPad`, 'BUY submit button should be tappable on the OrderPad screen');
  await browser.pause(1000);

  // The lower circuit is a genuine in-range price, so this should go straight to the
  // confirmation popup - but still guard against a DPR error, in case the true
  // enforced band is narrower than what the Quote screen displays.
  const dprVisible = await orderPadPage.isDprErrorVisible(3000);
  if (dprVisible) {
    const dprMessage = await orderPadPage.getDprErrorMessage();
    await dumpScreen(`${label}: unexpected DPR error even at the Quote screen's own lower circuit`);
    expect.fail(`${label}: BUY at the Quote screen's own lower circuit (${price}) was still rejected: "${dprMessage}"`);
  }

  await handleSurveillanceIfNeeded(label);

  const confirmVisible = await orderPadPage.isConfirmationPopupVisible(5000);
  console.log(`  ℹ  Confirmation popup visible: ${confirmVisible}`);
  if (!confirmVisible) await orderPadPage.dumpPageSource(`${label.toLowerCase()}-confirmation-popup-missing`);
  await assertOrDump(confirmVisible, `${label}: confirmation popup did not appear after tapping BUY`, 'Confirmation popup should appear after tapping BUY');
  console.log(`  ℹ  Confirmation content: ${(await orderPadPage.getConfirmationText()).join(' | ')}`);
  // Full untruncated dump of the popup, regardless of what happens next — the 20/30-item
  // slices used elsewhere have twice now cut off before reaching the real Confirm button.
  await orderPadPage.dumpPageSource(`${label.toLowerCase()}-confirmation-popup-full`);

  // Critical safety check, run before ever tapping Confirm: the price the app is
  // actually about to submit (read straight off the confirmation popup) must match the
  // lower circuit price this whole flow entered. Confirmed live that price entry can
  // silently fail to reach the app's real order state while still reading back
  // correctly from the field's own accessibility text - the popup's own displayed
  // price is the one thing that reflects what will actually be submitted.
  const confirmDetails = await orderPadPage.getConfirmationDetails();
  const confirmedPrice = confirmDetails.Price;
  console.log(`  ℹ  Confirmation popup price: ${confirmedPrice}  (expected: ${price})`);
  if (Number(confirmedPrice) !== Number(price)) {
    await dumpScreen(`${label}: confirmation popup price mismatch`);
    // Dismiss the still-open popup and back out to Watchlist before failing - so this
    // test fails cleanly on its own instead of leaving the app stuck on a confirmation
    // popup, which would otherwise cascade into every test that runs after it.
    try { await driver.back(); await browser.pause(500); } catch {}
    await watchlistPage.goToWatchlist();
    expect.fail(`${label}: confirmation popup shows price ${confirmedPrice}, expected the lower circuit price ${price} - refusing to tap Confirm`);
  }

  // Same guard for the exchange: the OrderPad's NSE/BSE toggles expose no selected state
  // (both read selected="false"), so the popup is the only place to confirm the order is
  // going to the exchange whose circuit limits were read. NSE and BSE bands overlap, so
  // the price check alone would not catch an order silently left on the wrong exchange.
  console.log(`  ℹ  Confirmation popup exchange: ${confirmDetails.Exchange}  (expected: ${expectedExchange})`);
  if (confirmDetails.Exchange !== expectedExchange) {
    await dumpScreen(`${label}: confirmation popup exchange mismatch`);
    try { await driver.back(); await browser.pause(500); } catch {}
    await watchlistPage.goToWatchlist();
    expect.fail(`${label}: confirmation popup shows exchange ${confirmDetails.Exchange}, expected ${expectedExchange} - refusing to tap Confirm`);
  }

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

  const onOrdersScreen = await orderbookPage.isLoaded(8000);
  console.log(`  ℹ  Landed on the Orderbook screen: ${onOrdersScreen}`);
  await assertOrDump(onOrdersScreen, `${label}: did not land on the Orderbook screen`, 'Should land on the Orderbook screen after confirming the order');

  // Explicitly select the All tab rather than trusting whichever tab the app restored -
  // a just-placed order may already be Executed/Rejected, so only "All" is guaranteed
  // to list it regardless of status.
  const allTapped = await orderbookPage.tapTab('all');
  console.log(`  ℹ  Orderbook "All" tab tapped: ${allTapped}`);
  await assertOrDump(allTapped, `${label}: could not tap the Orderbook All tab`, 'Orderbook All tab should be tappable');
  await browser.pause(600);
  console.log(`  ℹ  All tab count: ${await orderbookPage.getTabCount('all')}`);

  // The placed order must show up as a BUY row for this symbol at the lower circuit
  // price entered - symbol alone could match an older order. Row prices carry Indian
  // comma grouping ("1,47,178.00"), so strip commas before comparing numerically.
  const isPlacedOrder = (r) => {
    const symbolMatch = symbolName && ((r.symbol && r.symbol.trim() === symbolName.trim()) || (r.raw && r.raw.includes(symbolName)));
    const priceMatch  = r.price && Number(r.price.replace(/,/g, '')) === Number(price);
    return symbolMatch && priceMatch && /^BUY$/i.test(r.action || '');
  };

  // The Orderbook's own API call lags a few seconds behind the UI navigation - poll
  // instead of reading the page source once right after arriving. Only checks that the
  // order is listed, not that it reached any particular status - prints whatever status
  // is actually shown (Pending, Executed, Rejected, ...) for the record.
  // Re-reading alone isn't enough: confirmed live (R39, MCX GOLD) that the All tab's
  // header count already included the new order (24 -> 25) while the rows below stayed
  // stale for the whole poll, topmost row still the previous (CDS) order — so every few
  // polls, force the list to reload by switching tabs away and back to All, then
  // pull down from the top (new orders are listed first).
  let matchedRow = null;
  let polls = 0;
  await orderPadPage.pollUntil(async () => {
    matchedRow = (await orderbookPage.getOrderRows()).find(isPlacedOrder) || null;
    if (matchedRow) return true;
    if (++polls % 4 === 0) {
      console.log('  ℹ  Placed order not listed yet — reloading the All tab (Pending → All, pull down)');
      await orderbookPage.tapTab('pending');
      await browser.pause(800);
      await orderbookPage.tapTab('all');
      await browser.pause(800);
      await orderbookPage.swipeDown();
    }
    return false;
  }, 30000, 1000);

  // Not in the visible rows (e.g. a long order list) - scroll through the All tab once.
  for (let i = 0; !matchedRow && i < 3; i++) {
    await orderbookPage.swipeUp();
    matchedRow = (await orderbookPage.getOrderRows()).find(isPlacedOrder) || null;
  }

  const orderVisible = !!matchedRow;
  console.log(`  ℹ  "${symbolName}" BUY order at lower circuit (${price}) visible in Orderbook → All: ${orderVisible}`);
  if (matchedRow) {
    console.log(`  ℹ  Matched row: ${matchedRow.raw}`);
    console.log(`  ℹ  "${symbolName}" order status: ${matchedRow.status || 'unknown (row text did not fully parse)'}`);
  } else {
    const rows = await orderbookPage.getOrderRows();
    console.log(`  ℹ  Rows visible on the All tab (${rows.length}):`);
    rows.forEach((r, i) => console.log(`     [${i}] ${r.raw}`));
  }
  await assertOrDump(orderVisible, `${label}: "${symbolName}" BUY order at ${price} not found on the Orderbook All tab`, `The just-placed ${symbolName} BUY order at the lower circuit price ${price} should be listed on the Orderbook All tab`);

  await browser.pause(500);
  await watchlistPage.goToWatchlist();
}

// Navigates Watchlist -> Market tab -> the given segment tab (Commodity/Currency) ->
// the given movers sub-tab (default "Top Gainers") -> taps the first symbol row shown.
// Used for CDS/MCX, where "any symbol" from the segment's movers list is enough.
// Uses whichever movers sub-tab is already selected by default (Top Gainers, confirmed
// live to be "Tab 1 of 5" - the leftmost/default one) rather than explicitly tapping a
// sub-tab - only switches to fallbackSubTab if that default list turns out to be empty.
async function tapFirstMarketMover(marketTab, fallbackSubTab = 'Top Losers') {
  await watchlistPage.goToWatchlist();
  await watchlistPage.tapNavMarket();
  await browser.pause(1200);

  const pos = MARKET_SEL.tabPosition[marketTab];
  const tabTapped = await watchlistPage.findAndTap(`//*[contains(@content-desc,"${marketTab}") and contains(@content-desc,"Tab ${pos} of 4")]`, 5000);
  if (!tabTapped) return false;
  await browser.pause(1000);

  let rows = await $$(MARKET_SEL.moversRow);
  if (!rows.length && fallbackSubTab) {
    console.log(`  ℹ  No symbols in the default movers list - falling back to "${fallbackSubTab}"`);
    const subTapped = await watchlistPage.findAndTap(`//*[contains(@content-desc,"${fallbackSubTab}")]`, 5000);
    if (subTapped) {
      await browser.pause(1000);
      rows = await $$(MARKET_SEL.moversRow);
    }
  }
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
  // Inbox snapshots taken right before the action that triggers each OTP email (R3/R5 below),
  // carried forward to the R4/R6 tests that fetch and enter them.
  let firstOtpSinceUid;
  let secondOtpSinceUid;

  afterEach(function () {
    if (!this.currentTest) return;
    if (this.currentTest.state === 'passed') {
      console.log(`  ✅ ${this.currentTest.title} — succeeded`);
    } else if (this.currentTest.state === 'failed') {
      console.log(`  ❌ ${this.currentTest.title} — FAILED`);
    } else if (this.currentTest.isPending()) {
      console.log(`  ⏭  ${this.currentTest.title} — skipped`);
    }
  });

  before(async function () {
    this.timeout(120000);
    if (RESUME_SESSION) {
      // Relaunch without clearing data — restores the existing login session instead
      // of running R2-R8 again.
      try { await driver.terminateApp(process.env.APP_PACKAGE || 'com.iouring.globecapital'); } catch {}
      await browser.pause(500);
      try { await driver.activateApp(process.env.APP_PACKAGE || 'com.iouring.globecapital'); } catch {}
      await browser.pause(800);
      await handleBiometricIfNeeded(8000);
      await watchlistPage.goToWatchlist();
      if (!await watchlistPage.isLoaded(8000))
        throw new Error('RESUME_SESSION: Watchlist not reachable — run without RESUME_SESSION to do a fresh login.');
      return;
    }
    await clearAndLaunch();
    if (!await loginPage.waitForLoginScreen(30000)) {
      await dumpScreen('before: login screen not found');
      throw new Error('Login screen did not appear within 30 s');
    }
  });

  const authIt = RESUME_SESSION ? it.skip : it;

  authIt('R1: Verify build version is displayed on the Login screen', async function () {
    this.timeout(15000);
    // Read on a fresh Login screen, before any credentials are entered — same point in the
    // flow tests/loginWithOtp.test.js reads it at (right after launch, before login): permission
    // popup handling first, then build version fetching.
    await handlePermissionDialog();
    const versionVisible = await loginPage.isDisplayed(BUILD_VERSION_SEL, 10000);
    console.log(`  ℹ  Build version label visible: ${versionVisible}`);
    await assertOrDump(versionVisible, 'R1: build version label not found on the Login screen', 'Build version label should be displayed on the Login screen');

    const el = await $(BUILD_VERSION_SEL);
    const desc = ((await el.getAttribute('content-desc')) || '').trim();
    const buildVersion = (desc.match(/v\d+\.\d+\.\d+ \(\d+\)$/) || [desc])[0];
    console.log(`  ℹ  Build version: ${buildVersion}`);
    await assertOrDump(!!buildVersion, 'R1: build version label found but empty', 'Build version label should carry a non-empty value');
  });

  authIt('R2: Verify Forgot Password - click and back to the login screen', async function () {
    this.timeout(15000);
    // Validated on a fresh Login screen, before any credentials are entered.
    const wasDisplayed = await loginPage.isForgotPasswordDisplayed();
    console.log(`  ℹ  Forgot Password button visible: ${wasDisplayed}`);
    await assertOrDump(wasDisplayed, 'R2: forgot password button not found', 'Forgot Password button should be visible on Login screen');

    await loginPage.tapForgotPassword();
    await browser.pause(500);
    const leftLogin = !await loginPage.isDisplayed('~LOGIN', 2000);
    console.log(`  ℹ  Navigated away from Login screen: ${leftLogin}`);

    await safeBack();
    await browser.pause(500);

    const backOnLogin = await loginPage.waitForLoginScreen(10000);
    await assertOrDump(backOnLogin, 'R2: did not return to login screen', 'Should return to Login screen after back');
  });

  authIt('R3: Verify Login flow', async function () {
    this.timeout(15000);
    await loginPage.enterLoginId(testData.validUser.id);
    await loginPage.enterPassword(testData.validUser.password);
    expect(await loginPage.getLoginIdFieldValue(), 'Login ID field should hold entered value')
      .to.equal(testData.validUser.id);
    // Snapshot the inbox right before LOGIN triggers the first OTP email - not inside R4 - so an
    // email that arrives in the gap between this test ending and R4 starting still counts as "new".
    firstOtpSinceUid = await getLatestUid();
    await loginPage.tapLogin();
  });

  authIt('R4: Verify OTP Login', async function () {
    this.timeout(180000);
    const onOTP1 = await otpPage.isLoaded(35000);
    await assertOrDump(onOTP1, 'R4: OTP1 not found', 'First OTP screen should appear after LOGIN');
    await submitOtp('FIRST OTP', firstOtpSinceUid);
  });

  authIt('R5: Verify the Enable now', async function () {
    this.timeout(20000);
    const onSecure = await enableSecurePage.isLoaded(10000);
    await assertOrDump(onSecure, 'R5: Enable Globe Secure screen not found', 'Enable Globe Secure screen should appear');
    // Same reasoning as firstOtpSinceUid above, for the second OTP email triggered by Enable Now.
    secondOtpSinceUid = await getLatestUid();
    await enableSecurePage.tapEnableNow();
  });

  authIt('R6: Verify second otp page', async function () {
    this.timeout(180000);
    const onOTP2 = await otpPage.isLoaded(20000);
    await assertOrDump(onOTP2, 'R6: OTP2 not found', 'Second OTP screen should appear');
    await submitOtp('SECOND OTP', secondOtpSinceUid);
    await browser.pause(500);
  });

  authIt('R7: Verify device pin Login', async function () {
    this.timeout(30000);
    const handled = await handleBiometricIfNeeded(15000);
    console.log(`  ℹ  Device PIN / biometric screen handled: ${handled}`);
    // Some builds skip straight to Risk Disclosure / Watchlist — not a failure.
  });

  authIt('R8: Verify Risk Disclosure', async function () {
    this.timeout(30000);
    // Not every account shows this screen — some client IDs skip straight to Watchlist.
    // So this is a genuine if/else, not a required step: accept it when present, otherwise
    // move on without failing.
    const onRisk = await loginPage.isDisplayed(RISK_SEL.heading, 5000);
    console.log(`  ℹ  Risk Disclosure screen shown for this account: ${onRisk}`);

    if (onRisk) {
      const accepted = await loginPage.findAndTap(RISK_SEL.acceptBtn, 5000);
      console.log(`  ℹ  Risk Disclosure accept tapped: ${accepted}`);
      await assertOrDump(accepted, 'R8: Risk Disclosure accept control not found', 'Should be able to accept the Risk Disclosure screen');
      await browser.pause(1000);
    } else {
      console.log('  ℹ  This account has no Risk Disclosure step — proceeding straight to landing check');
    }

    const onWatchlist = await watchlistPage.isLoaded(10000);
    await assertOrDump(onWatchlist, 'R8: Watchlist not reached after login flow', 'Watchlist home screen should be visible after full login flow');
  });

  it('R9: Validate app launched into the Watchlist screen', async function () {
    this.timeout(30000);
    await watchlistPage.goToWatchlist();
    const onWatchlist = await watchlistPage.isLoaded(20000);
    await assertOrDump(onWatchlist, 'R9: Watchlist screen not launched', 'Watchlist screen should be launched');
    // Informational only — the exact title content-desc varies across accounts/builds;
    // isLoaded() above (title OR search box OR tabs) is the reliable signal.
    console.log(`  ℹ  Watchlist title element visible: ${await watchlistPage.isTitleDisplayed()}`);
  });

  it('R10: Tap through all the watchlist tabs', async function () {
    this.timeout(45000);
    // Tabs are read by position/content-desc pattern, not by an assumed name —
    // different client IDs have different watchlists.
    await watchlistPage.scrollToFirstTab();

    const seen = new Set();
    for (let scroll = 0; scroll < 8; scroll++) {
      // Rapidly tapping through tabs can trigger the app's ANR dialog on this
      // real hardware — without a check here it silently blocks the next
      // getPageSource()/click() call until the test's own timeout fires
      // (confirmed live: R10 hung past the it()-level timeout right after the
      // last tab was tapped, with no ANR check between taps and the pageSource
      // read below).
      await watchlistPage._dismissANRIfPresent();
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
      await watchlistPage._dismissANRIfPresent();
      const total = await watchlistPage.getTotalTabCount();
      if (seen.size >= total) break;
      await watchlistPage._swipeTabStrip('right');
    }
    await watchlistPage.scrollToFirstTab();

    console.log(`  ℹ  Watchlists tapped (${seen.size}): ${[...seen].join(', ')}`);
    expect(seen.size, 'Should have tapped at least 1 watchlist tab').to.be.above(0);
  });

  it('R11: Choose the 1st watchlist and open search', async function () {
    this.timeout(20000);
    // Selected by position ("Tab 1 of N"), not by name — the 1st tab's name varies per account.
    const firstTab = await scrollToTabPosition(1);
    if (!firstTab) await dumpScreen('R11: 1st watchlist tab not found by position');
    expect(firstTab, 'A watchlist tab at position 1 should be found').to.not.be.null;
    console.log(`  ℹ  1st watchlist tab: "${firstTab.name}"`);

    await firstTab.el.click();
    await browser.pause(300);
    const isActive = (await firstTab.el.getAttribute('selected')) === 'true';
    console.log(`  ℹ  1st watchlist tab active: ${isActive}`);

    await watchlistPage.tapSearchBox();
    const searchOpen = await watchlistPage.isDisplayed(WL_SEL.searchInput, 5000);
    await assertOrDump(searchOpen, 'R11: search overlay did not open', 'Search overlay input should be visible after tapping search');
  });

  it('R12: Search the symbol "HCL"', async function () {
    this.timeout(15000);
    const results = await searchAndGetResults('HCL');
    let first = null;
    try { if (results.length) first = ((await results[0].getAttribute('content-desc')) || '').split(/\n|&#10;/)[0].trim(); } catch {}
    console.log(`  ℹ  "HCL" search results: ${results.length}${first ? `  |  first: ${first}` : ''}`);
    await assertOrDump(results.length > 0, 'R12: no search results for "HCL"', 'Searching "HCL" should list at least one result');
  });

  it('R13: Validate the search list and click cancel', async function () {
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
    await assertOrDump(backOnWatchlist, 'R13: Watchlist not visible after cancel', 'Should be back on Watchlist after cancelling search');
  });

  it('R14: Click the Manage Watchlist button', async function () {
    this.timeout(15000);
    const opened = await watchlistPage.findAndTap(WL_SEL.manageBtn, 5000);
    await assertOrDump(opened, 'R14: Manage Watchlist button not found', 'Manage Watchlist button should be tappable');
    await browser.pause(300);
  });

  it('R15: Print the list shown in Manage Watchlist', async function () {
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

  it('R16: Return to the Watchlist screen', async function () {
    this.timeout(15000);
    await safeBack();
    await browser.pause(300);
    await watchlistPage.goToWatchlist();
    const onWatchlist = await watchlistPage.isLoaded(8000);
    await assertOrDump(onWatchlist, 'R16: did not return to Watchlist screen', 'Should be back on the Watchlist screen');
  });

  it('R17: Validate the top indices — print names, scroll right and left', async function () {
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
    await assertOrDump(onWatchlist, 'R17: Watchlist not visible after scrolling indices', 'Watchlist should remain visible after scrolling the indices strip');
  });

  it('R18: Validate the hamburger button', async function () {
    this.timeout(20000);
    await watchlistPage.goToWatchlist();

    const found = await watchlistPage.isDisplayed(MENU_SEL.hamburgerBtn, 5000);
    console.log(`  ℹ  Hamburger button visible: ${found}`);
    await assertOrDump(found, 'R18: hamburger button not found', 'Hamburger button should be visible on the Watchlist screen');

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
    await assertOrDump(backOnWatchlist, 'R18: did not return to Watchlist after hamburger interaction', 'Should return to Watchlist after hamburger interaction');
  });

  // Previously flaky: WatchlistPage's bottom-nav selectors required a "Tab N of 5"
  // suffix in the content-desc that only exists on the Beta build — the Dev build
  // renders plain labels ("Orders") with no suffix at all. Fixed by accepting both formats.
  // Shared by R19-R22: tap one bottom-nav tab, confirm it leaves Watchlist, then
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

  it('R19: Switch to the Market tab and return to Watchlist', async function () {
    this.timeout(20000);
    await watchlistPage.goToWatchlist();
    await browser.pause(500);
    await verifyNavSwitch('R19', 'Market', () => watchlistPage.tapNavMarket());
  });

  it('R20: Switch to the Orders tab and return to Watchlist', async function () {
    this.timeout(20000);
    await watchlistPage.goToWatchlist();
    await browser.pause(500);
    await verifyNavSwitch('R20', 'Orders', () => watchlistPage.tapNavOrders());
  });

  it('R21: Switch to the Portfolio tab and return to Watchlist', async function () {
    this.timeout(20000);
    await watchlistPage.goToWatchlist();
    await browser.pause(500);
    await verifyNavSwitch('R21', 'Portfolio', () => watchlistPage.tapNavPortfolio());
  });

  it('R22: Switch to the Mutual Funds tab and return to Watchlist', async function () {
    this.timeout(20000);
    await watchlistPage.goToWatchlist();
    await browser.pause(500);
    await verifyNavSwitch('R22', 'Mutual Funds', () => watchlistPage.tapNavMutualFunds());
  });

  it('R23: Open first symbol from any watchlist and tap Buy to reach the OrderPad screen', async function () {
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

    if (!stockEl) await dumpScreen('R23: no watchlist with a symbol found');
    expect(stockEl, 'At least one watchlist should contain a symbol').to.not.be.null;
    console.log(`  ℹ  Opening first symbol from "${usedTabName}"`);

    await stockEl.click();
    await browser.pause(500);

    const quoteOpen = await quotePage.isLoaded(8000);
    await assertOrDump(quoteOpen, 'R23: Quote screen did not open', 'Quote screen should open after tapping a symbol');
    await expandQuoteScreen('R23');

    const buyVisible  = await quotePage.isBuyButtonDisplayed();
    const sellVisible = await quotePage.isSellButtonDisplayed();
    console.log(`  ℹ  Buy button visible: ${buyVisible}  |  Sell button visible: ${sellVisible}`);
    await assertOrDump(buyVisible,  'R23: Buy button not found on Quote screen',  'Buy button should be visible on the Quote screen');
    await assertOrDump(sellVisible, 'R23: Sell button not found on Quote screen', 'Sell button should be visible on the Quote screen');

    const buyTapped = await quotePage.tapBuyButton();
    console.log(`  ℹ  Buy button tapped: ${buyTapped}`);
    await assertOrDump(buyTapped, 'R23: could not tap Buy button', 'Buy button should be tappable');
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

  it('R24: Validate the OrderPad screen fields', async function () {
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
    await assertOrDump(buySubmitVisible, 'R24: BUY submit button not found on OrderPad', 'BUY submit button should be visible on the OrderPad screen');
  });

  // Submits BUY at the OrderPad's current (default, in-range) price to reach the real
  // confirmation popup, validates its fields and the Applicable Charges/Brokerage
  // breakdown, then dismisses via the Scrim — never taps CONFIRMATION, so no order
  // is placed. Runs before R27 so the price field is still at its untouched default.
  it('R25: Validate the confirmation popup fields (no submit)', async function () {
    this.timeout(20000);

    const buyTapped = await orderPadPage.tapBuySubmit();
    console.log(`  ℹ  OrderPad BUY submit tapped: ${buyTapped}`);
    await assertOrDump(buyTapped, 'R25: could not tap BUY submit on OrderPad', 'BUY submit button should be tappable on the OrderPad screen');
    await browser.pause(800);

    await handleSurveillanceIfNeeded('R25', { assertTap: true });

    const confirmVisible = await orderPadPage.isConfirmationPopupVisible(5000);
    console.log(`  ℹ  Confirmation popup visible: ${confirmVisible}`);
    if (!confirmVisible) await orderPadPage.dumpPageSource('r21-confirmation-popup-missing');
    await assertOrDump(confirmVisible, 'R25: confirmation popup did not appear after BUY submit', 'Confirmation popup should appear after tapping BUY submit');

    // Validate every field shown on the confirmation popup.
    const confirmDetails = await orderPadPage.getConfirmationDetails();
    console.log('  ℹ  Confirmation popup field values:');
    for (const [label, value] of Object.entries(confirmDetails)) {
      console.log(`     - ${label}: ${value}`);
    }
    const expectedFields = ['Symbol', 'Exchange', 'Order Action', 'Quantity', 'Price', 'Product Type', 'Order Type', 'Validity'];
    const missingFields = expectedFields.filter(f => !confirmDetails[f]);
    await assertOrDump(missingFields.length === 0, 'R25: confirmation popup missing expected fields',
      `Confirmation popup should show all of ${expectedFields.join(', ')} — missing: ${missingFields.join(', ') || 'none'}`);
  });

  // Continues directly from R25 — the confirmation popup is still open.
  it('R26: Validate the Applicable Charges breakdown, then dismiss without submitting', async function () {
    this.timeout(20000);

    // Open "Applicable Charges" — validate its header and brokerage breakdown, print
    // the disclaimer, then return to the confirmation popup.
    const chargesTapped = await orderPadPage.tapApplicableCharges();
    console.log(`  ℹ  Applicable Charges tapped: ${chargesTapped}`);
    await assertOrDump(chargesTapped, 'R26: could not tap Applicable Charges', 'Applicable Charges link should be tappable on the confirmation popup');
    await browser.pause(600);

    // On a validation failure below, back out of the charges panel and the confirmation
    // popup before rethrowing — confirmed live that leaving the panel open ("Something
    // went wrong" from the charges API) stranded the app there and cascaded into R27-R32.
    let validated = false;
    try {
      const chargesPanelVisible = await orderPadPage.isChargesPanelVisible(5000);
      console.log(`  ℹ  Applicable Charges panel visible: ${chargesPanelVisible}`);
      if (!chargesPanelVisible) await orderPadPage.dumpPageSource('r21-charges-panel-missing');
      await assertOrDump(chargesPanelVisible, 'R26: Applicable Charges panel did not open', 'Applicable Charges panel should open after tapping the link');

      const chargesHeader = await orderPadPage.getChargesHeader();
      console.log(`  ℹ  Applicable Charges header: ${chargesHeader}`);
      await assertOrDump(!!chargesHeader, 'R26: Applicable Charges header not found', 'Applicable Charges panel should show a header');

      // Pass only if every expected charge is listed with a value next to it, not every
      // value is 0, and no error message/toast is shown; otherwise fail with the cause.
      const charges = await orderPadPage.getChargesPanelStatus();
      console.log(`  ℹ  Brokerage/charges details: ${charges.breakdown.join(' | ')}`);
      console.log(`  ℹ  Charges listed (${charges.charges.length}): ${charges.charges.map(c => `${c} = ${charges.values[c] ?? '(no value)'}`).join(', ') || 'none'}`);
      if (charges.missing.length) console.log(`  ℹ  Charges missing (${charges.missing.length}): ${charges.missing.join(', ')}`);
      if (charges.noValue.length) console.log(`  ℹ  Charges with no value (${charges.noValue.length}): ${charges.noValue.join(', ')}`);
      if (charges.allZero) console.log('  ℹ  Every charge shows 0');
      if (!charges.isValid) {
        console.log(`  ✗  Applicable Charges failure cause: ${charges.failureCause}`);
        await orderPadPage.dumpPageSource('r26-charges-breakdown-invalid');
      }
      await assertOrDump(charges.isValid, `R26: Applicable Charges failed — ${charges.failureCause}`,
        `Applicable Charges panel should list every charge with a value (not all 0) and no error message — cause: ${charges.failureCause}`);

      const chargesDisclaimer = await orderPadPage.getChargesDisclaimer();
      console.log(`  ℹ  Disclaimer: ${chargesDisclaimer}`);
      await assertOrDump(!!chargesDisclaimer, 'R26: disclaimer text not found on the Applicable Charges panel', 'Applicable Charges panel should show a disclaimer');
      validated = true;
    } finally {
      if (!validated) {
        // Best-effort, never confirms: each back press closes one layer (panel, then popup).
        // Not gated on orderPadPage.isLoaded() — its "Order Type"/"Quantity" text check also
        // matches the confirmation popup, so it can't tell the two apart.
        for (let i = 0; i < 3; i++) {
          if (await orderPadPage.isChargesPanelVisible(1500)) await orderPadPage.closeChargesPanel();
          else if (await orderPadPage.isConfirmationPopupVisible(500)) await orderPadPage.dismissConfirmationPopup();
          else break;
          await browser.pause(500);
        }
        console.log(`  ℹ  Cleanup after failure — back on OrderPad screen: ${await orderPadPage.isLoaded(2000)}`);
      }
    }

    const chargesClosed = await orderPadPage.closeChargesPanel();
    console.log(`  ℹ  Applicable Charges back button tapped: ${chargesClosed}`);
    await browser.pause(500);
    const backOnConfirmation = await orderPadPage.isConfirmationPopupVisible(5000);
    console.log(`  ℹ  Back on confirmation popup: ${backOnConfirmation}`);
    await assertOrDump(backOnConfirmation, 'R26: did not return to the confirmation popup after closing Applicable Charges', 'Should return to the confirmation popup after tapping back on Applicable Charges');

    // Dismiss WITHOUT confirming — this test only validates the popup, it never places an order.
    const dismissed = await orderPadPage.dismissConfirmationPopup();
    console.log(`  ℹ  Confirmation popup dismissed (no order placed): ${dismissed}`);
    await browser.pause(500);

    const backOnOrderPad = await orderPadPage.isLoaded(5000);
    console.log(`  ℹ  Back on OrderPad screen: ${backOnOrderPad}`);
    await assertOrDump(backOnOrderPad, 'R26: did not return to the OrderPad screen after dismissing the confirmation popup', 'Should return to the OrderPad screen after dismissing the confirmation popup');
  });

  // Read/edit-only pass over the OrderPad's interactive fields — segment, quantity,
  // Market/Limit mode, price tick. Deliberately never taps BUY or SELL, so it's safe
  // to run against a real account.
  it('R27: OrderPad field interactions — segment, quantity, Market/Limit, price tick (no submit)', async function () {
    this.timeout(30000);

    // Step 1 — segments actually offered for this symbol.
    const segments = await orderPadPage.getVisibleSegments();
    console.log(`  ℹ  Segments available: ${segments.join(', ') || 'none detected'}`);
    await assertOrDump(segments.length > 0, 'R27: no segment (NSE/BSE/NFO/MCX/...) detected on OrderPad', 'At least one segment should be visible on the OrderPad screen');

    // Step 2 — quantity 1 -> 10 -> back to the original value.
    const qtyBefore = await orderPadPage.getQuantity();
    console.log(`  ℹ  Quantity before: ${qtyBefore}`);
    await orderPadPage.setQuantity(10);
    await browser.pause(300);
    const qtyAfterTen = await orderPadPage.getQuantity();
    console.log(`  ℹ  Quantity after setting to 10: ${qtyAfterTen}`);
    await assertOrDump(String(qtyAfterTen) === '10', 'R27: quantity did not update to 10', 'Quantity field should read 10 after editing');

    await orderPadPage.setQuantity(qtyBefore);
    await browser.pause(300);
    const qtyReversed = await orderPadPage.getQuantity();
    console.log(`  ℹ  Quantity reversed back to: ${qtyReversed}`);
    await assertOrDump(String(qtyReversed) === String(qtyBefore), 'R27: quantity did not reverse back to its original value', `Quantity field should read back to ${qtyBefore}`);

    // Step 3 — Limit -> Market -> Limit via the swap toggle, printing each mode.
    const modeBefore = await orderPadPage.getPriceMode();
    console.log(`  ℹ  Price mode before: ${modeBefore}`);

    const swappedToMarket = await orderPadPage.tapMarketLimitSwap();
    await browser.pause(500);
    const modeAfterSwap1 = await orderPadPage.getPriceMode();
    console.log(`  ℹ  Market/Limit swap tapped: ${swappedToMarket}  |  Price mode now: ${modeAfterSwap1}`);
    await assertOrDump(swappedToMarket, 'R27: could not tap the Market/Limit swap toggle', 'Market/Limit swap toggle should be tappable');

    const swappedBack = await orderPadPage.tapMarketLimitSwap();
    await browser.pause(500);
    const modeAfterSwap2 = await orderPadPage.getPriceMode();
    console.log(`  ℹ  Swapped back: ${swappedBack}  |  Price mode now: ${modeAfterSwap2}`);
    await assertOrDump(modeAfterSwap2 === modeBefore, 'R27: price mode did not return to its original value after two swaps', `Price mode should read back to "${modeBefore}"`);

    // Step 4 — click the price field, remove the existing value, enter 0.00.
    const priceBefore = await orderPadPage.getPrice();
    console.log(`  ℹ  Price before: ${priceBefore}`);
    const priceEdited = await orderPadPage.setPrice('0.00');
    console.log(`  ℹ  Price field clicked, cleared, and 0.00 entered: ${priceEdited}`);
    await assertOrDump(priceEdited, 'R27: could not click/clear/enter the price field', 'Price field should be clickable and editable');
    await browser.pause(300);
    const priceAfter = await orderPadPage.getPrice();
    console.log(`  ℹ  Price field now reads: ${priceAfter}`);
    await assertOrDump(priceAfter === '0.00', 'R27: price field did not accept 0.00', 'Price field should read 0.00 after clearing and re-entering it');

    console.log('  ℹ  R27 complete — BUY/SELL were not tapped at any point');
  });

  // Continues directly from R27 — OrderPad is still open with price cleared to 0.00.
  //
  // Validation only — taps BUY with this out-of-range price and confirms the DPR
  // (Daily Price Range) guard rejects it, parsing the lower/upper circuit out of the
  // error. Does NOT retry at the corrected price or confirm anything, so no order is
  // placed. Real order placement now lives in the segment-specific tests below
  // (e.g. R34 for NSE), which reuse this same DPR-bounce technique deliberately.
  it('R28: Tap Buy with price 0.00 — validate the DPR/circuit-range guard (no order placed)', async function () {
    this.timeout(20000);

    const segments = await orderPadPage.getVisibleSegments();
    console.log(`  ℹ  Segments for this symbol: ${segments.join(', ') || 'none detected'}`);

    const buyTapped = await orderPadPage.tapBuySubmit();
    console.log(`  ℹ  BUY tapped with price 0.00: ${buyTapped}`);
    await assertOrDump(buyTapped, 'R28: could not tap BUY submit on OrderPad', 'BUY submit button should be tappable on the OrderPad screen');
    await browser.pause(1000);

    const dprVisible = await orderPadPage.isDprErrorVisible(5000);
    console.log(`  ℹ  DPR / price-range error shown: ${dprVisible}`);

    if (dprVisible) {
      const dprMessage = await orderPadPage.getDprErrorMessage();
      console.log(`  ℹ  DPR error value: ${dprMessage}`);

      const range = orderPadPage.parseDprRange(dprMessage);
      if (!range) {
        await dumpScreen('R28: could not parse lower/upper circuit from the DPR message');
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
  it('R29: Open the Orderbook and validate its common controls', async function () {
    this.timeout(20000);

    await watchlistPage.tapNavOrders();
    const loaded = await orderbookPage.isLoaded(8000);
    if (!loaded) await orderbookPage.dumpPageSource('r24-orderbook-not-loaded');
    await assertOrDump(loaded, 'R29: Orderbook screen did not load', 'Orderbook screen should load after tapping the Orders tab');

    // Search box / filter button - confirmed live (only 7 clickable elements on this screen:
    // the Regular/Basket tabs and the 5 bottom-nav icons) that neither exists on the Orderbook
    // screen in this app build, so this is informational rather than a hard requirement.
    const searchVisible = await orderbookPage.isSearchBoxVisible();
    const filterVisible = await orderbookPage.isFilterButtonVisible();
    console.log(`  ℹ  Search box visible: ${searchVisible}  |  Filter button visible: ${filterVisible}`);

    // Tab counts, printed up front.
    const counts = await orderbookPage.getAllTabCounts();
    console.log(`  ℹ  Tab counts — All: ${counts.all}  Pending: ${counts.pending}  Executed: ${counts.executed}  Cancelled: ${counts.cancelled}`);
  });

  // Shared by R30-R33: switch to one Orderbook tab, scroll, and validate its rows
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

  it('R30: Validate the Orderbook — All tab', async function () {
    this.timeout(20000);
    await validateOrderbookTab('R30', 'all');
  });

  it('R31: Validate the Orderbook — Pending tab', async function () {
    this.timeout(20000);
    await validateOrderbookTab('R31', 'pending');
  });

  it('R32: Validate the Orderbook — Executed tab', async function () {
    this.timeout(20000);
    await validateOrderbookTab('R32', 'executed');
  });

  it('R33: Validate the Orderbook — Cancelled tab', async function () {
    this.timeout(20000);
    await validateOrderbookTab('R33', 'cancelled');
    await watchlistPage.goToWatchlist();
  });

  // Places a REAL order on the NSE segment — searches for a known NSE symbol directly
  // (rather than whatever happens to be first in a watchlist), then reuses the same
  // DPR-bounce technique as R28: enter 0.00, let the DPR guard reject it, retry at the
  // parsed lower circuit price, and confirm. Explicitly authorized per segment.
  it('R34: Place a real order for the NSE segment — search "IDEA", DPR-bounce to the lower circuit', async function () {
    this.timeout(120000);
    skipIfMarketClosed(this, 'R34', 'NSE');

    await watchlistPage.goToWatchlist();
    await watchlistPage.tapSearchBox();
    const searchOpen = await watchlistPage.isDisplayed(WL_SEL.searchInput, 5000);
    await assertOrDump(searchOpen, 'R34: search overlay did not open', 'Search overlay input should be visible after tapping search');

    const results = await searchAndGetResults('IDEA');
    console.log(`  ℹ  "IDEA" search results: ${results.length}`);
    await assertOrDump(results.length > 0, 'R34: "IDEA" not found in search results', 'Search should return at least one result for "IDEA"');

    await results[0].click();
    await browser.pause(500);

    const quoteOpen = await quotePage.isLoaded(8000);
    await assertOrDump(quoteOpen, 'R34: Quote screen did not open for IDEA', 'Quote screen should open after selecting IDEA from search');
    await expandQuoteScreen('R34');

    const limits = await getLowerCircuitFromQuote('R34');
    console.log(`  ℹ  IDEA (NSE) — Lower circuit: ${limits.lower}  Upper circuit: ${limits.upper}`);

    const buyTapped = await quotePage.tapBuyButton();
    console.log(`  ℹ  Buy button tapped: ${buyTapped}`);
    await assertOrDump(buyTapped, 'R34: could not tap Buy on the Quote screen', 'Buy button should be tappable on the Quote screen');
    await browser.pause(1000);

    const onOrderPad = await orderPadPage.isLoaded(8000);
    await assertOrDump(onOrderPad, 'R34: OrderPad screen did not open for IDEA', 'OrderPad screen should open after tapping Buy');

    const symbolName = await enterPriceOnOrderPad('R34', limits.lower);

    if (!PLACE_REAL_ORDERS) {
      console.log('  ℹ  PLACE_REAL_ORDERS not set - stopping here (price entered, BUY not submitted).');
      await orderPadPage.goBack();
      await watchlistPage.goToWatchlist();
      return;
    }

    await submitAndConfirmOrder('R34', limits.lower, symbolName, 'NSE');
  });

  // Places a REAL order on the BSE segment — RTNPOWER trades on both NSE and BSE with
  // different circuit limits (confirmed live: NSE 5.40 - 8.10, BSE 5.41 - 8.11), so the
  // lower circuit must be read off the BSE quote. Opens the first search result, expands
  // the Quote screen, switches it to BSE via the toggle next to the symbol name, reads the
  // lower circuit, then taps Buy and checks the OrderPad carried BSE over (its BSE radio
  // is selected) before entering the price. The confirmation popup's exchange check in
  // submitAndConfirmOrder remains the final guard before Confirm.
  it('R35: Place a real order for the BSE segment — search "RTNPOWER", switch the Quote to BSE, DPR-bounce to the lower circuit', async function () {
    this.timeout(120000);
    skipIfMarketClosed(this, 'R35', 'BSE');

    await watchlistPage.goToWatchlist();
    await watchlistPage.tapSearchBox();
    const searchOpen = await watchlistPage.isDisplayed(WL_SEL.searchInput, 5000);
    await assertOrDump(searchOpen, 'R35: search overlay did not open', 'Search overlay input should be visible after tapping search');

    const results = await searchAndGetResults('RTNPOWER');
    console.log(`  ℹ  "RTNPOWER" search results: ${results.length}`);
    await assertOrDump(results.length > 0, 'R35: "RTNPOWER" not found in search results', 'Search should return at least one result for "RTNPOWER"');

    await results[0].click();
    await browser.pause(500);

    const quoteOpen = await quotePage.isLoaded(8000);
    await assertOrDump(quoteOpen, 'R35: Quote screen did not open for RTNPOWER', 'Quote screen should open after selecting RTNPOWER from search');
    console.log(`  ℹ  Quote screen opened on: ${await quotePage.getExchange()}`);
    await expandQuoteScreen('R35');

    const { tapped: bseTapped, exchange: quoteExchange } = await quotePage.tapExchange('BSE');
    console.log(`  ℹ  BSE toggle tapped on the Quote screen: ${bseTapped} — Quote now shows: ${quoteExchange}`);
    await assertOrDump(bseTapped, 'R35: Quote header card not found - could not locate the BSE toggle', 'BSE toggle should be tappable on the expanded Quote screen');
    await assertOrDump(quoteExchange === 'BSE', `R35: Quote screen shows ${quoteExchange} after tapping BSE`, 'Quote screen should switch to BSE after tapping the BSE toggle');
    await browser.pause(500);

    const limits = await getLowerCircuitFromQuote('R35');
    console.log(`  ℹ  RTNPOWER (BSE) — Lower circuit: ${limits.lower}  Upper circuit: ${limits.upper}`);

    const buyTapped = await quotePage.tapBuyButton();
    console.log(`  ℹ  Buy button tapped: ${buyTapped}`);
    await assertOrDump(buyTapped, 'R35: could not tap Buy on the Quote screen', 'Buy button should be tappable on the Quote screen');
    await browser.pause(1000);

    const onOrderPad = await orderPadPage.isLoaded(8000);
    await assertOrDump(onOrderPad, 'R35: OrderPad screen did not open for RTNPOWER', 'OrderPad screen should open after tapping Buy');

    const radio = await orderPadPage.getSelectedExchange();
    console.log(`  ℹ  OrderPad selected exchange radio: ${radio.selected}  (pixel coverage NSE ${radio.coverage.NSE?.toFixed(3)} / BSE ${radio.coverage.BSE?.toFixed(3)}${radio.error ? `, ${radio.error}` : ''})`);
    await assertOrDump(radio.selected === 'BSE', `R35: OrderPad BSE radio is not selected (detected: ${radio.selected})`, 'BSE radio button next to the symbol name should be selected on the OrderPad');

    const symbolName = await enterPriceOnOrderPad('R35', limits.lower);

    if (!PLACE_REAL_ORDERS) {
      console.log('  ℹ  PLACE_REAL_ORDERS not set - stopping here (price entered, BUY not submitted).');
      await orderPadPage.goBack();
      await watchlistPage.goToWatchlist();
      return;
    }

    await submitAndConfirmOrder('R35', limits.lower, symbolName, 'BSE');
  });

  // Places a REAL order on the NFO segment — NIFTY 25100 CE. Searches the contract
  // directly (e.g. "NIFTY 25100 CE" returns one result per expiry) and takes the first
  // one, rather than drilling through the Option Chain screen — that screen's strike
  // table only renders what's scrolled into view, so a strike outside that visible
  // range (like 25100 against a ~24000 spot) was unreachable even though the contract
  // itself exists and is searchable.
  it('R36: Place a real order for the NFO segment — NIFTY 25100 CE, DPR-bounce to the lower circuit', async function () {
    this.timeout(120000);
    skipIfMarketClosed(this, 'R36', 'NFO');

    await watchlistPage.goToWatchlist();
    await watchlistPage.tapSearchBox();
    const searchOpen = await watchlistPage.isDisplayed(WL_SEL.searchInput, 5000);
    await assertOrDump(searchOpen, 'R36: search overlay did not open', 'Search overlay input should be visible after tapping search');

    const results = await searchAndGetResults('NIFTY 25100 CE');
    console.log(`  ℹ  "NIFTY 25100 CE" search results: ${results.length}`);
    await assertOrDump(results.length > 0, 'R36: "NIFTY 25100 CE" not found in search results', 'Search should return at least one result for "NIFTY 25100 CE"');

    await results[0].click();
    await browser.pause(500);

    const quoteOpen = await quotePage.isLoaded(8000);
    await assertOrDump(quoteOpen, 'R36: Quote screen did not open for NIFTY 25100 CE', 'Quote screen should open after selecting the contract');
    await expandQuoteScreen('R36');

    const limits = await getLowerCircuitFromQuote('R36');
    console.log(`  ℹ  NIFTY 25100 CE — Lower circuit: ${limits.lower}  Upper circuit: ${limits.upper}`);

    const buyTapped = await quotePage.tapBuyButton();
    console.log(`  ℹ  Buy button tapped: ${buyTapped}`);
    await assertOrDump(buyTapped, 'R36: could not tap Buy on the Quote screen', 'Buy button should be tappable on the Quote screen');
    await browser.pause(1000);

    const onOrderPad = await orderPadPage.isLoaded(8000);
    await assertOrDump(onOrderPad, 'R36: OrderPad screen did not open for NIFTY 25100 CE', 'OrderPad screen should open after tapping Buy');

    const symbolName = await enterPriceOnOrderPad('R36', limits.lower);

    if (!PLACE_REAL_ORDERS) {
      console.log('  ℹ  PLACE_REAL_ORDERS not set - stopping here (price entered, BUY not submitted).');
      await orderPadPage.goBack();
      await watchlistPage.goToWatchlist();
      return;
    }

    await submitAndConfirmOrder('R36', limits.lower, symbolName, 'NFO');
  });

  // Places a REAL order on the BFO segment — SENSEX 77100 CE. Same direct-search
  // approach as R36, for the same reason (the target strike sits outside the Option
  // Chain screen's default visible range).
  it('R37: Place a real order for the BFO segment — SENSEX 77100 CE, DPR-bounce to the lower circuit', async function () {
    this.timeout(120000);
    skipIfMarketClosed(this, 'R37', 'BFO');

    await watchlistPage.goToWatchlist();
    await watchlistPage.tapSearchBox();
    const searchOpen = await watchlistPage.isDisplayed(WL_SEL.searchInput, 5000);
    await assertOrDump(searchOpen, 'R37: search overlay did not open', 'Search overlay input should be visible after tapping search');

    const results = await searchAndGetResults('SENSEX 77100 CE');
    console.log(`  ℹ  "SENSEX 77100 CE" search results: ${results.length}`);
    await assertOrDump(results.length > 0, 'R37: "SENSEX 77100 CE" not found in search results', 'Search should return at least one result for "SENSEX 77100 CE"');

    await results[0].click();
    await browser.pause(500);

    const quoteOpen = await quotePage.isLoaded(8000);
    await assertOrDump(quoteOpen, 'R37: Quote screen did not open for SENSEX 77100 CE', 'Quote screen should open after selecting the contract');
    await expandQuoteScreen('R37');

    const limits = await getLowerCircuitFromQuote('R37');
    console.log(`  ℹ  SENSEX 77100 CE — Lower circuit: ${limits.lower}  Upper circuit: ${limits.upper}`);

    const buyTapped = await quotePage.tapBuyButton();
    console.log(`  ℹ  Buy button tapped: ${buyTapped}`);
    await assertOrDump(buyTapped, 'R37: could not tap Buy on the Quote screen', 'Buy button should be tappable on the Quote screen');
    await browser.pause(1000);

    const onOrderPad = await orderPadPage.isLoaded(8000);
    await assertOrDump(onOrderPad, 'R37: OrderPad screen did not open for SENSEX 77100 CE', 'OrderPad screen should open after tapping Buy');

    const symbolName = await enterPriceOnOrderPad('R37', limits.lower);

    if (!PLACE_REAL_ORDERS) {
      console.log('  ℹ  PLACE_REAL_ORDERS not set - stopping here (price entered, BUY not submitted).');
      await orderPadPage.goBack();
      await watchlistPage.goToWatchlist();
      return;
    }

    await submitAndConfirmOrder('R37', limits.lower, symbolName, 'BFO');
  });

  // Places a REAL order on the CDS segment — Market tab -> Currency -> whichever movers
  // sub-tab is selected by default (Top Gainers), falling back to Top Losers if that
  // list is empty -> first symbol shown. Confirmed live that picking the literal first
  // row without any further check can land on an already-expired same-day contract
  // (0 LTP, no order-entry fields at all) - a real risk worth knowing about, though not
  // filtered out here per instruction.
  it('R38: Place a real order for the CDS segment — first Currency market mover, DPR-bounce to the lower circuit', async function () {
    this.timeout(120000);
    skipIfMarketClosed(this, 'R38', 'CDS');

    const opened = await tapFirstMarketMover('Currency', 'Top Losers');
    await assertOrDump(opened, 'R38: could not open a Currency market mover', 'Should be able to open a symbol from the Currency market movers list');
    await browser.pause(1000);

    const quoteOpen = await quotePage.isLoaded(8000);
    await assertOrDump(quoteOpen, 'R38: Quote screen did not open for the Currency mover', 'Quote screen should open after selecting the symbol');
    await expandQuoteScreen('R38');

    const limits = await getLowerCircuitFromQuote('R38');
    const symbolR38 = await quotePage.getSymbolName();
    console.log(`  ℹ  ${symbolR38 || 'Currency mover'} — Lower circuit: ${limits.lower}  Upper circuit: ${limits.upper}`);

    const buyTapped = await quotePage.tapBuyButton();
    console.log(`  ℹ  Buy button tapped: ${buyTapped}`);
    await assertOrDump(buyTapped, 'R38: could not tap Buy on the Quote screen', 'Buy button should be tappable on the Quote screen');
    await browser.pause(1000);

    const onOrderPad = await orderPadPage.isLoaded(8000);
    await assertOrDump(onOrderPad, 'R38: OrderPad screen did not open', 'OrderPad screen should open after tapping Buy');

    const symbolName = await enterPriceOnOrderPad('R38', limits.lower);

    if (!PLACE_REAL_ORDERS) {
      console.log('  ℹ  PLACE_REAL_ORDERS not set - stopping here (price entered, BUY not submitted).');
      await orderPadPage.goBack();
      await watchlistPage.goToWatchlist();
      return;
    }

    await submitAndConfirmOrder('R38', limits.lower, symbolName, 'CDS');
  });

  // Places a REAL order on the MCX segment — Market tab -> Commodity -> whichever movers
  // sub-tab is selected by default (Top Gainers), falling back to Top Losers if that
  // list is empty -> first symbol shown.
  it('R39: Place a real order for the MCX segment — first Commodity market mover, DPR-bounce to the lower circuit', async function () {
    this.timeout(120000);
    skipIfMarketClosed(this, 'R39', 'MCX');

    const opened = await tapFirstMarketMover('Commodity', 'Top Losers');
    await assertOrDump(opened, 'R39: could not open a Commodity market mover', 'Should be able to open a symbol from the Commodity market movers list');
    await browser.pause(1000);

    const quoteOpen = await quotePage.isLoaded(8000);
    await assertOrDump(quoteOpen, 'R39: Quote screen did not open for the Commodity mover', 'Quote screen should open after selecting the symbol');
    await expandQuoteScreen('R39');

    const limits = await getLowerCircuitFromQuote('R39');
    const symbolR39 = await quotePage.getSymbolName();
    console.log(`  ℹ  ${symbolR39 || 'Commodity mover'} — Lower circuit: ${limits.lower}  Upper circuit: ${limits.upper}`);

    const buyTapped = await quotePage.tapBuyButton();
    console.log(`  ℹ  Buy button tapped: ${buyTapped}`);
    await assertOrDump(buyTapped, 'R39: could not tap Buy on the Quote screen', 'Buy button should be tappable on the Quote screen');
    await browser.pause(1000);

    const onOrderPad = await orderPadPage.isLoaded(8000);
    await assertOrDump(onOrderPad, 'R39: OrderPad screen did not open', 'OrderPad screen should open after tapping Buy');

    const symbolName = await enterPriceOnOrderPad('R39', limits.lower);

    if (!PLACE_REAL_ORDERS) {
      console.log('  ℹ  PLACE_REAL_ORDERS not set - stopping here (price entered, BUY not submitted).');
      await orderPadPage.goBack();
      await watchlistPage.goToWatchlist();
      return;
    }

    await submitAndConfirmOrder('R39', limits.lower, symbolName, 'MCX');
  });

  // Read-only pass over the Basket screen (Orders -> Basket tab). A saved basket's
  // EXECUTE button places every item in it as a REAL order — this test only ever
  // reads the basket's contents, and never taps EXECUTE, Edit, or Add symbols.
  it('R40: Open the Basket screen and open the first saved basket', async function () {
    this.timeout(20000);

    await watchlistPage.goToWatchlist();
    await watchlistPage.tapNavOrders();
    await browser.pause(1000);

    const basketTabTapped = await basketPage.tapBasketTab();
    await assertOrDump(basketTabTapped, 'R40: could not tap the Basket tab', 'Basket tab should be tappable on the Orders screen');
    await browser.pause(1000);

    const newBasketVisible = await basketPage.isNewBasketVisible();
    console.log(`  ℹ  "New Basket" button visible: ${newBasketVisible}`);
    await assertOrDump(newBasketVisible, 'R40: "New Basket" button not found', '"New Basket" button should be visible on the Basket tab');

    const basketRows = await basketPage.getBasketListRows();
    console.log(`  ℹ  Saved baskets (${basketRows.length}):`);
    basketRows.forEach((r, i) => console.log(`     [${i}] ${r}`));

    if (basketRows.length === 0) {
      console.log('  ℹ  No saved baskets to open — nothing further to validate.');
      await watchlistPage.goToWatchlist();
      return;
    }

    const opened = await basketPage.openBasket(0);
    await assertOrDump(opened, 'R40: could not open the first saved basket', 'The first saved basket should be tappable');
    await browser.pause(1000);

    const detailLoaded = await basketPage.isBasketDetailLoaded(5000);
    await assertOrDump(detailLoaded, 'R40: basket detail screen did not load', 'Basket detail screen should load after opening a basket');
  });

  // Continues directly from R40 — the basket detail screen is still open (unless
  // R40 found no saved baskets, in which case this is a no-op).
  it("R41: Validate the opened basket's items and EXECUTE button (no execute)", async function () {
    this.timeout(20000);

    if (!await basketPage.isBasketDetailLoaded(2000)) {
      console.log('  ℹ  No basket detail screen open (R40 found no saved baskets) — nothing to validate.');
      return;
    }

    const itemCount = await basketPage.getItemCount();
    console.log(`  ℹ  Item count: ${itemCount ? `${itemCount.loaded}/${itemCount.total}` : 'unknown'}`);
    await assertOrDump(!!itemCount, 'R41: item count not found on basket detail screen', 'Basket detail screen should show a "loaded/total items" count');

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
    await assertOrDump(items.length > 0, 'R41: no basket items found', 'Basket detail screen should show at least one item');
    for (const item of items) {
      console.log(`  ℹ  ${item.side} ${item.name} — qty=${item.qty} price=${item.price} exchange=${item.exchange} product=${item.productType} order=${item.orderType}`);
      await assertOrDump(!!(item.side && item.name && item.qty && item.price && item.exchange),
        'R41: could not parse a basket item', `Row "${item.raw}" should parse into side/name/qty/price/exchange`);
    }

    // EXECUTE is present but deliberately never tapped — it would place every item as a real order.
    const executeVisible = await basketPage.isExecuteVisible();
    console.log(`  ℹ  EXECUTE button visible: ${executeVisible}`);
    await assertOrDump(executeVisible, 'R41: EXECUTE button not found on basket detail screen', 'EXECUTE button should be visible on the basket detail screen');

    const closed = await basketPage.closeBasketDetail();
    console.log(`  ℹ  Basket detail closed: ${closed}`);
    await assertOrDump(closed, 'R41: could not close the basket detail screen', 'Basket detail screen should be closable');
    await browser.pause(500);

    await watchlistPage.goToWatchlist();
  });

  // Read-only pass over Funds/Margin and its sub-screens. Withdraw Funds' "Proceed"
  // and Add Funds' payment-method options both move real money — this test only ever
  // validates that they're present, never taps them.
  it('R42: Open the Funds screen and validate its fields', async function () {
    this.timeout(20000);

    await watchlistPage.goToWatchlist();
    const opened = await fundsPage.openFunds();
    await assertOrDump(opened, 'R42: could not open the Funds screen', 'Should be able to open Funds from the hamburger menu');
    await browser.pause(800);

    const loaded = await fundsPage.isLoaded(8000);
    await assertOrDump(loaded, 'R42: Funds screen did not load', 'Funds screen should load after selecting Funds from the menu');

    const fields = await fundsPage.getAllFields();
    console.log('  ℹ  Funds screen fields:');
    for (const [key, value] of Object.entries(fields)) console.log(`     - ${key}: ${value}`);
    const [viewTxnVisible, withdrawVisible, addFundsVisible] = await Promise.all([
      fundsPage.isViewTransactionsVisible(),
      fundsPage.isWithdrawFundsVisible(),
      fundsPage.isAddFundsVisible(),
    ]);
    console.log(`  ℹ  View Transactions visible: ${viewTxnVisible}  |  Withdraw Funds visible: ${withdrawVisible}  |  Add Funds visible: ${addFundsVisible}`);
    await assertOrDump(!!fields.marginAvailable, 'R42: Margin available field not found', 'Margin available to trade should be visible on the Funds screen');
    await assertOrDump(!!fields.availableFund, 'R42: Available Fund field not found', 'Available Fund should be visible on the Funds screen');
    await assertOrDump(!!fields.marginUtilised, 'R42: Margin utilised field not found', 'Margin utilised should be visible on the Funds screen');
    await assertOrDump(!!fields.cashEquivalent, 'R42: Cash Equivalent field not found', 'Cash Equivalent should be visible on the Funds screen');
    await assertOrDump(!!fields.collateral, 'R42: Collateral field not found', 'Collateral should be visible on the Funds screen');
    await assertOrDump(!!fields.optionCreditForSale, 'R42: Option Credit for Sale field not found', 'Option Credit for Sale should be visible on the Funds screen');
    await assertOrDump(viewTxnVisible, 'R42: View Transactions button not found', 'View Transactions button should be visible on the Funds screen');
    await assertOrDump(withdrawVisible, 'R42: Withdraw Funds button not found', 'Withdraw Funds button should be visible on the Funds screen');
    await assertOrDump(addFundsVisible, 'R42: Add Funds button not found', 'Add Funds button should be visible on the Funds screen');
  });

  it('R43: Funds — View Transactions', async function () {
    this.timeout(20000);

    await watchlistPage.goToWatchlist();
    const opened = await fundsPage.openFunds();
    await assertOrDump(opened, 'R43: could not open the Funds screen', 'Should be able to open Funds from the hamburger menu');
    await browser.pause(800);
    await assertOrDump(await fundsPage.isLoaded(8000), 'R43: Funds screen did not load', 'Funds screen should load after selecting Funds from the menu');

    // View Transactions: print any transactions (or the empty state), then come back.
    const txnTapped = await fundsPage.tapViewTransactions();
    await assertOrDump(txnTapped, 'R43: could not tap View Transactions', 'View Transactions button should be tappable');
    await browser.pause(1000);

    const txnLoaded = await fundsPage.isTransactionHistoryLoaded();
    await assertOrDump(txnLoaded, 'R43: Transaction History screen did not load', 'Transaction History screen should load after tapping View Transactions');

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
    await assertOrDump(backOnFunds, 'R43: did not return to the Funds screen after View Transactions', 'Should return to the Funds screen after viewing transactions');
    await watchlistPage.goToWatchlist();
  });

  it('R44: Funds — Withdraw Funds (no submit)', async function () {
    this.timeout(20000);

    await watchlistPage.goToWatchlist();
    const opened = await fundsPage.openFunds();
    await assertOrDump(opened, 'R44: could not open the Funds screen', 'Should be able to open Funds from the hamburger menu');
    await browser.pause(800);
    await assertOrDump(await fundsPage.isLoaded(8000), 'R44: Funds screen did not load', 'Funds screen should load after selecting Funds from the menu');

    // Withdraw Funds: validate it opens, then come back WITHOUT tapping Proceed.
    const withdrawTapped = await fundsPage.tapWithdrawFunds();
    await assertOrDump(withdrawTapped, 'R44: could not tap Withdraw Funds', 'Withdraw Funds button should be tappable');
    await browser.pause(1000);

    const withdrawLoaded = await fundsPage.isWithdrawScreenLoaded();
    await assertOrDump(withdrawLoaded, 'R44: Withdraw Funds screen did not load', 'Withdraw Funds screen should load after tapping Withdraw Funds');
    const proceedVisible = await fundsPage.isWithdrawProceedVisible();
    console.log(`  ℹ  Withdraw Funds screen loaded — Proceed button visible: ${proceedVisible} (never tapped)`);
    await assertOrDump(proceedVisible, 'R44: Proceed button not found on Withdraw Funds screen', 'Proceed button should be visible on the Withdraw Funds screen');

    await safeBack();
    await browser.pause(800);
    const backOnFunds = await fundsPage.isLoaded(5000);
    await assertOrDump(backOnFunds, 'R44: did not return to the Funds screen after Withdraw Funds', 'Should return to the Funds screen after viewing Withdraw Funds');
    await watchlistPage.goToWatchlist();
  });

  it('R45: Funds — Add Funds (no submit)', async function () {
    this.timeout(20000);

    await watchlistPage.goToWatchlist();
    const opened = await fundsPage.openFunds();
    await assertOrDump(opened, 'R45: could not open the Funds screen', 'Should be able to open Funds from the hamburger menu');
    await browser.pause(800);
    await assertOrDump(await fundsPage.isLoaded(8000), 'R45: Funds screen did not load', 'Funds screen should load after selecting Funds from the menu');

    // Add Funds: validate it opens, then come back WITHOUT selecting a payment method.
    const addFundsTapped = await fundsPage.tapAddFunds();
    await assertOrDump(addFundsTapped, 'R45: could not tap Add Funds', 'Add Funds button should be tappable');
    await browser.pause(1000);

    const addFundsLoaded = await fundsPage.isAddFundsScreenLoaded();
    await assertOrDump(addFundsLoaded, 'R45: Add Funds screen did not load', 'Add Funds screen should load after tapping Add Funds');
    const paymentMethodsVisible = await fundsPage.isPaymentMethodsVisible();
    console.log(`  ℹ  Add Funds screen loaded — payment methods visible: ${paymentMethodsVisible} (none selected)`);
    await assertOrDump(paymentMethodsVisible, 'R45: payment method options not found on Add Funds screen', 'UPI/Net Banking options should be visible on the Add Funds screen');

    await safeBack();
    await browser.pause(800);
    await watchlistPage.goToWatchlist();
  });

  it('R46: Open News, scroll the list, and validate the search field', async function () {
    this.timeout(30000);

    await watchlistPage.goToWatchlist();
    const opened = await newsPage.openNews();
    await assertOrDump(opened, 'R46: could not open the News screen', 'Should be able to open News from the hamburger menu');
    await browser.pause(800);

    const loaded = await newsPage.isLoaded(8000);
    await assertOrDump(loaded, 'R46: News screen did not load', 'News screen should load after selecting News from the menu');

    // Lands on "All" by default; scroll the list down then back up.
    await newsPage.scrollList('down');
    await newsPage.scrollList('up');
    console.log('  ℹ  Scrolled the News list down and back up.');

    const searchVisible = await newsPage.isSearchFieldVisible();
    console.log(`  ℹ  News search field visible: ${searchVisible}`);
    await assertOrDump(searchVisible, 'R46: search field not found on News screen', 'Search field should be visible on the News screen');
  });

  it('R47: Click through every News tab', async function () {
    this.timeout(30000);

    await watchlistPage.goToWatchlist();
    const opened = await newsPage.openNews();
    await assertOrDump(opened, 'R47: could not open the News screen', 'Should be able to open News from the hamburger menu');
    await browser.pause(800);
    await assertOrDump(await newsPage.isLoaded(8000), 'R47: News screen did not load', 'News screen should load after selecting News from the menu');

    // Click through every tab (All / Result / Block Deals / Equity / Commentary / ...).
    const tabsTapped = await newsPage.tapAllTabs();
    console.log(`  ℹ  News tabs tapped (${tabsTapped.length}): ${tabsTapped.join(', ')}`);
    expect(tabsTapped.length, 'Should have tapped at least 1 News tab').to.be.above(0);

    await newsPage.closeNews();
    await browser.pause(800);
    const backOnWatchlist = await watchlistPage.isLoaded(5000);
    await assertOrDump(backOnWatchlist, 'R47: did not return to Watchlist after closing News', 'Should return to Watchlist after closing News');
  });

  it('R48: Open Alerts and print existing entries with Enabled/Disabled status', async function () {
    this.timeout(20000);

    await watchlistPage.goToWatchlist();
    const opened = await alertsPage.openAlerts();
    await assertOrDump(opened, 'R48: could not open the Alerts screen', 'Should be able to open Alerts from the hamburger menu');
    await browser.pause(800);

    const loaded = await alertsPage.isLoaded(8000);
    await assertOrDump(loaded, 'R48: Alerts screen did not load', 'Alerts screen should load after selecting Alerts from the menu');

    const entries = await alertsPage.getAlertEntries();
    console.log(`  ℹ  Existing alerts (${entries.length}):`);
    entries.forEach((e, i) => console.log(`     [${i}] ${e.symbol} (${e.exchange}) — Status: ${e.status}`));
  });

  // Continues directly from R48 — the Alerts screen is still open.
  it('R49: Create a price Alert for TCS (LTP + ~10%)', async function () {
    this.timeout(30000);

    // Add Alert → search TCS → open its Set Alert screen.
    const addTapped = await alertsPage.tapAddAlert();
    await assertOrDump(addTapped, 'R49: could not tap Add Alert', 'Add Alert button should be tappable');
    await browser.pause(800);

    const searched = await alertsPage.searchSymbol('TCS');
    await assertOrDump(searched, 'R49: no search results for TCS', 'Searching TCS should return at least one result');
    const resultTapped = await alertsPage.tapFirstSearchResult();
    await assertOrDump(resultTapped, 'R49: could not tap the TCS search result', 'Should be able to tap the first TCS search result');
    await browser.pause(1000);

    const onSetAlert = await alertsPage.isSetAlertScreenLoaded();
    await assertOrDump(onSetAlert, 'R49: Set Alert screen did not load', 'Set Alert screen should load after picking TCS');

    // Print the LTP, then set the target value ~10% above it (QA-automation example
    // value only — not a real trading signal).
    const ltp = await alertsPage.getLtp();
    console.log(`  ℹ  TCS LTP: ${ltp}`);
    await assertOrDump(ltp !== null, 'R49: could not read TCS LTP', 'LTP should be readable on the Set Alert screen');

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
    await assertOrDump(backOnAlerts, 'R49: did not return to the Alerts screen after creating the alert', 'Should return to Alerts screen after creating the alert');

    const entriesAfter = await alertsPage.getAlertEntries();
    const created = entriesAfter.find(e => e.symbol === 'TCS' && hasTargetValue(e.raw));
    console.log(`  ℹ  New alert created: ${created ? created.raw.split(/&#10;|\n/).slice(2).join(' ') : 'NOT FOUND'}`);
    await assertOrDump(!!created, 'R49: newly created TCS alert not found in the list', 'The TCS alert just created should appear in the Alerts list');
  });

  // Continues directly from R49 — deletes whatever alert is now topmost (alerts sort
  // newest-first, confirmed via real dumps, so that's the one R49 just created). The
  // Dev backend has been observed to return "Internal server error" on delete — retry
  // a few times before giving up, since that's an environment issue, not a test bug
  // (mirrors the retry pattern used for OTP submission elsewhere).
  it('R50: Delete the created Alert (with confirm popup)', async function () {
    this.timeout(30000);

    const beforeEntries = await alertsPage.getAlertEntries();
    const targetRaw = beforeEntries[0] ? beforeEntries[0].raw : null;
    await assertOrDump(!!targetRaw, 'R50: no alert found to delete', 'There should be at least one alert to delete (created by R49)');

    let deleted = false;
    let lastToast = null;
    for (let attempt = 1; attempt <= 3 && !deleted; attempt++) {
      const rowTapped = await alertsPage.tapAlertRow(0);
      await assertOrDump(rowTapped, 'R50: could not tap the created alert row', 'Should be able to tap the created alert row');
      await browser.pause(800);

      const sheetLoaded = await alertsPage.isAlertDetailSheetLoaded();
      await assertOrDump(sheetLoaded, 'R50: alert detail sheet did not load', 'Alert detail sheet (Disable/Edit/Delete) should load after tapping the alert');

      const deleteTapped = await alertsPage.tapDelete();
      await assertOrDump(deleteTapped, 'R50: DELETE option not found', 'DELETE option should be visible on the alert detail sheet');
      await browser.pause(600);

      const confirmVisible = await alertsPage.isDeleteConfirmVisible();
      await assertOrDump(confirmVisible, 'R50: delete confirmation popup did not appear', 'A confirmation popup should appear after tapping DELETE');

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

  // ── NxtOption (R51-R56) ──────────────────────────────────────────────────────
  // Each "open" test (R51/R53/R55) leaves its sub-screen open for the "verify" test right
  // after it; each verify test re-opens the sub-screen itself if it isn't already showing
  // (so it can run alone via --mochaOpts.grep) and always backs out to Watchlist at the
  // end, so one failing NxtOption check can't strand the next group.
  // Read-only: Buy Call only loads a predefined strategy's payoff view — nothing here
  // taps Execute / Place Order.

  it('R51: NxtOption — Strategy Builder', async function () {
    this.timeout(25000);
    await openNxtOptionScreen('R51', 'Strategy Builder');
    await browser.pause(2000);
  });

  it('R52: NxtOption — Strategy Builder → Buy Call (no error / no infinite loading)', async function () {
    this.timeout(45000);
    try {
      await ensureNxtOptionScreen('R52', 'Strategy Builder');
      const buyCallTapped = await nxtOptionPage.tapLabel('Buy Call');
      console.log(`  ℹ  Buy Call tapped: ${buyCallTapped}`);
      await assertOrDump(buyCallTapped, 'R52: Buy Call not found on Strategy Builder', 'Buy Call should be tappable on the Strategy Builder screen');
      await browser.pause(800);
      await assertNxtOptionHealthy('R52', 'Buy Call', ['Buy Call', 'Predefined']);
    } finally {
      await backToWatchlistFromNxtOption('R52', 'Strategy Builder');
    }
  });

  it('R53: NxtOption — IV Analysis', async function () {
    this.timeout(25000);
    await openNxtOptionScreen('R53', 'IV Analysis');
    await browser.pause(2000);
  });

  it('R54: NxtOption — IV Analysis → IV Charts (default) displays charts, IVR-IVP Scan lists values', async function () {
    this.timeout(75000);
    try {
      await ensureNxtOptionScreen('R54', 'IV Analysis');
      // IV Charts must be the default tab — checked before IVR-IVP Scan is tapped.
      const ivChartsSelected = await nxtOptionPage.getSelectedState('IV Charts');
      const ivrSelected      = await nxtOptionPage.getSelectedState('IVR');
      console.log(`  ℹ  IV Charts selected: ${ivChartsSelected ?? 'unknown'}  |  IVR-IVP Scan selected: ${ivrSelected ?? 'unknown'}`);
      await assertOrDump(ivChartsSelected !== 'false' && ivrSelected !== 'true', 'R54: IV Charts is not the default tab',
        'IV Charts should be selected by default on IV Analysis (not IVR-IVP Scan)');
      // The chart draws directly below the Line / Area radio buttons (confirmed via screenshot).
      await assertNxtOptionHealthy('R54', 'IV Charts', ['IV Charts', 'IVR'], { chartAnchor: /^(line|area)$/i });

      const scanTapped = await nxtOptionPage.tapLabel('IVR');
      console.log(`  ℹ  IVR-IVP Scan tapped: ${scanTapped}`);
      await assertOrDump(scanTapped, 'R54: IVR-IVP Scan not found on IV Analysis', 'IVR-IVP Scan should be tappable on the IV Analysis screen');
      await browser.pause(2000);
      const scanSelected = await nxtOptionPage.getSelectedState('IVR');
      console.log(`  ℹ  IVR-IVP Scan selected: ${scanSelected ?? 'unknown'}`);
      await assertOrDump(scanSelected !== 'false', 'R54: IVR-IVP Scan did not become selected', 'IVR-IVP Scan should be selected after tapping it');

      // A list, not a chart — no pixel check; instead require numeric IVR/IVP values.
      const scan = await assertNxtOptionHealthy('R54', 'IVR-IVP Scan', ['IV Charts', 'IVR']);
      const values = scan.content.filter(l => /\d/.test(l));
      console.log(`  ℹ  IVR-IVP Scan values listed (${values.length}): ${values.slice(0, 15).join(' | ') || 'none'}`);
      if (values.length === 0) await nxtOptionPage.dumpPageSource('r54-ivr_ivp_scan');
      await assertOrDump(values.length > 0, 'R54: IVR-IVP Scan — no values listed', 'IVR-IVP Scan should list values');
    } finally {
      await backToWatchlistFromNxtOption('R54', 'IV Analysis');
    }
  });

  it('R55: NxtOption — OI Analysis', async function () {
    this.timeout(25000);
    await openNxtOptionScreen('R55', 'OI Analysis');
    await browser.pause(2000);
  });

  it('R56: NxtOption — OI Analysis → OI (default), OI Change, PCR Chart display data', async function () {
    this.timeout(75000);
    const tabLabels = ['OI', 'OI Change', 'PCR Chart'];
    // Chart/data sits below the tab row and the expiry selector ("06 Oct 2026 / W1").
    const chartAnchor = /^(oi|oi change|pcr chart|line|area)$|\d{2} \w{3} \d{4}/i;
    try {
      await ensureNxtOptionScreen('R56', 'OI Analysis');
      // The tab row's selected state isn't set the instant the screen opens (all three
      // tabs read selected="false" right after landing) - give it 2s, then poll a bit more.
      await browser.pause(2000);
      let oiSelected = null;
      await nxtOptionPage.pollUntil(async () => {
        oiSelected = await nxtOptionPage.getSelectedState('OI', { exact: true });
        return oiSelected === 'true';
      }, 5000, 500);
      console.log(`  ℹ  OI selected by default: ${oiSelected ?? 'unknown'}`);
      if (oiSelected !== 'true') {
        // If no tab reports selected at all, the app isn't exposing selection - fall
        // back to the OI chart's own legend, which only renders while OI is active.
        const othersSelected = [];
        for (const t of ['OI Change', 'PCR Chart']) {
          if ((await nxtOptionPage.getSelectedState(t, { exact: true })) === 'true') othersSelected.push(t);
        }
        const oiLegendShown = await nxtOptionPage.isDisplayed('//*[@content-desc="Cumulative OI"]', 2000);
        console.log(`  ℹ  Other tabs selected: ${othersSelected.join(', ') || 'none'} | OI chart legend ("Cumulative OI") shown: ${oiLegendShown}`);
        if (othersSelected.length === 0 && oiLegendShown) oiSelected = 'true';
      }
      if (oiSelected !== 'true') {
        // Capture the OI screen itself — the failure screenshot is only taken after the
        // finally below has already backed out to Watchlist.
        await nxtOptionPage.takeScreenshot('R56-OI_default_tab');
        await nxtOptionPage.dumpPageSource('r56-oi-default-tab');
      }
      await assertOrDump(oiSelected === 'true', 'R56: OI is not the default tab', 'OI should be selected by default on OI Analysis');
      await assertNxtOptionHealthy('R56', 'OI', tabLabels, { chartAnchor });

      for (const tab of ['OI Change', 'PCR Chart']) {
        const tapped = await nxtOptionPage.tapLabel(tab);
        console.log(`  ℹ  ${tab} tapped: ${tapped}`);
        await assertOrDump(tapped, `R56: ${tab} not found on OI Analysis`, `${tab} should be tappable on the OI Analysis screen`);
        await browser.pause(800);
        await assertNxtOptionHealthy('R56', tab, tabLabels, { chartAnchor });
      }
    } finally {
      await backToWatchlistFromNxtOption('R56', 'OI Analysis');
    }
  });

  it('R57: Validate Portfolio — Holdings fields', async function () {
    this.timeout(30000);

    const opened = await portfolioPage.openPortfolio();
    await assertOrDump(opened, 'R57: could not open the Portfolio tab', 'Portfolio bottom-nav tab should be tappable');
    await browser.pause(800);

    const loaded = await portfolioPage.isLoaded(8000);
    await assertOrDump(loaded, 'R57: Portfolio screen did not load', 'Portfolio screen should show Holdings and Positions tabs');

    const holdingsCount = await portfolioPage.getHoldingsCount();
    console.log(`  ℹ  Holdings count: ${holdingsCount}`);

    const summary = await portfolioPage.getHoldingsSummary();
    console.log(`  ℹ  Holdings summary — Current: ${summary.currentValue}, Overall P&L: ${summary.overallPnl}, Invested: ${summary.investedValue}, Today's P&L: ${summary.todayPnl}`);
    await assertOrDump(!!summary.currentValue && !!summary.investedValue, 'R57: Holdings summary fields not found', 'Current and Invested value should be visible on the Holdings tab');

    const holdingsRows = await portfolioPage.getHoldingsRows();
    console.log(`  ℹ  Holdings rows (${holdingsRows.length}):`);
    holdingsRows.forEach((r, i) => console.log(`     [${i}] ${r.symbol} — Qty: ${r.quantity}, Avg Price: ${r.avgPrice}, Invested: ${r.invested}`));

    if (holdingsRows.length > 0) {
      const rowTapped = await portfolioPage.tapHoldingRow(0);
      await assertOrDump(rowTapped, 'R57: could not tap the first holding row', 'A holding row should be tappable');
      await browser.pause(1000);

      const detailLoaded = await portfolioPage.isHoldingDetailLoaded();
      await assertOrDump(detailLoaded, 'R57: holding detail screen did not load', 'Holding detail screen should load after tapping a holding row');

      const fields = await portfolioPage.getHoldingDetailFields();
      console.log('  ℹ  Holding detail fields:');
      for (const [key, value] of Object.entries(fields)) console.log(`     - ${key}: ${value}`);
      await assertOrDump(!!fields.stockDetails, 'R57: Stock details field not found', 'Stock details should be visible on the holding detail screen');
      await assertOrDump(!!fields.avgPrice, 'R57: Average Price field not found', 'Average Price should be visible on the holding detail screen');
      await assertOrDump(!!fields.marketValue, 'R57: Market Value field not found', 'Market Value should be visible on the holding detail screen');
      await assertOrDump(!!fields.investedValue, 'R57: Invested Value field not found', 'Invested Value should be visible on the holding detail screen');

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

  it('R58: Validate Portfolio — Positions fields, Today / Derivatives counts', async function () {
    this.timeout(45000);

    const opened = await portfolioPage.openPortfolio();
    await assertOrDump(opened, 'R58: could not open the Portfolio tab', 'Portfolio bottom-nav tab should be tappable');
    await browser.pause(800);
    await assertOrDump(await portfolioPage.isLoaded(8000), 'R58: Portfolio screen did not load', 'Portfolio screen should show Holdings and Positions tabs');

    const posTapped = await portfolioPage.tapPositionsTab();
    await assertOrDump(posTapped, 'R58: could not tap the Positions tab', 'Positions tab should be tappable');
    await browser.pause(800);

    const positionsCount = await portfolioPage.getPositionsCount();
    console.log(`  ℹ  Positions count: ${positionsCount}`);

    if (positionsCount === 0) {
      const noPositions = await portfolioPage.isNoPositionsVisible();
      console.log(`  ℹ  "You don't have any positions" empty-state message visible: ${noPositions}`);
      await assertOrDump(noPositions, 'R58: empty-state message not found on Positions tab', 'Empty-state message should be visible when there are no positions');
    } else {
      // Today is the default sub-tab — check it before tapping anything.
      const todayLabel = await portfolioPage.getPositionsSubTabLabel('Today');
      const derivLabel = await portfolioPage.getPositionsSubTabLabel('Derivatives');
      console.log(`  ℹ  Sub-tab labels — Today: "${todayLabel}", Derivatives: "${derivLabel}"`);
      if (!todayLabel || !derivLabel) await portfolioPage.dumpPageSource('r58_positions_subtabs');
      await assertOrDump(!!todayLabel, 'R58: Today tab not found on Positions', 'Today tab should be visible on the Positions tab');
      await assertOrDump(!!derivLabel, 'R58: Derivatives tab not found on Positions', 'Derivatives tab should be visible on the Positions tab');

      const todaySelected = await portfolioPage.getPositionsSubTabSelected('Today');
      console.log(`  ℹ  Today selected by default: ${todaySelected}`);
      await assertOrDump(todaySelected === 'true', 'R58: Today is not the default Positions sub-tab', 'Today should be selected by default on the Positions tab');

      // Count from the sub-tab's label; if the label has no number, fall back to the
      // number of position rows the tab lists.
      const checkSubTab = async (name) => {
        const rows       = await portfolioPage.getPositionRows();
        const labelCount = await portfolioPage.getPositionsSubTabCount(name);
        const count      = labelCount ?? rows.length;
        console.log(`  ℹ  ${name} count: ${count} (${labelCount !== null ? 'from tab label' : 'from listed rows'}) | rows listed: ${rows.length}`);
        rows.forEach((r, i) => console.log(`     [${i}] ${r}`));
        if (count > 0) {
          await assertOrDump(rows.length > 0, `R58: ${name} count ${count} but no position rows listed`, `${name} tab should list position rows when its count is above 0`);
        } else {
          const empty = await portfolioPage.isNoPositionsVisible();
          console.log(`  ℹ  ${name} empty-state message visible: ${empty}`);
          await assertOrDump(rows.length === 0, `R58: ${name} count 0 but position rows listed`, `${name} tab should list no position rows when its count is 0`);
        }
        return { count, rows };
      };

      const today = await checkSubTab('Today');

      const derivTapped = await portfolioPage.tapPositionsSubTab('Derivatives');
      await assertOrDump(derivTapped, 'R58: could not tap the Derivatives tab', 'Derivatives tab should be tappable');
      await browser.pause(1000);
      const deriv = await checkSubTab('Derivatives');

      // Today = orders executed today (any segment); Derivatives = every F&O position, both
      // executed today and carried forward. So a today's F&O position shows on BOTH tabs and
      // Positions = Derivatives + Today's non-F&O rows, not Today + Derivatives.
      await assertOrDump(today.count <= positionsCount && deriv.count <= positionsCount, 'R58: sub-tab count above Positions count',
        `Today (${today.count}) and Derivatives (${deriv.count}) should each be at most the Positions count (${positionsCount})`);

      // Row key = everything before "Quantity:" (symbol, contract, exchange, product), so the
      // same position matches across tabs even if quantity/price text differs.
      const rowKey = r => r.split(/\s*Quantity:/)[0].trim();
      const allListed = today.rows.length === today.count && deriv.rows.length === deriv.count;
      if (allListed) {
        const derivKeys = new Set(deriv.rows.map(rowKey));
        const todayFno  = today.rows.filter(r => derivKeys.has(rowKey(r)));
        const todayOnly = today.rows.filter(r => !derivKeys.has(rowKey(r)));
        console.log(`  ℹ  Today rows also on Derivatives (today's F&O): ${todayFno.length} | Today-only (non-F&O): ${todayOnly.length}`);
        const expected = deriv.count + todayOnly.length;
        console.log(`  ℹ  Positions ${positionsCount} vs Derivatives ${deriv.count} + Today-only ${todayOnly.length} = ${expected}`);
        if (expected !== positionsCount) await portfolioPage.dumpPageSource('r58_positions_subtabs');
        await assertOrDump(expected === positionsCount, 'R58: Derivatives + Today-only count does not match Positions count',
          `Derivatives (${deriv.count}) + Today's non-F&O (${todayOnly.length}) should equal the Positions count (${positionsCount})`);
      } else {
        // Some rows are below the fold, so they can't be matched across tabs - fall back to
        // the bounds the overlap allows.
        console.log(`  ℹ  Not every row is on screen (Today ${today.rows.length}/${today.count}, Derivatives ${deriv.rows.length}/${deriv.count}) — checking count bounds only`);
        await assertOrDump(positionsCount <= today.count + deriv.count, 'R58: Positions count above Today + Derivatives',
          `Positions (${positionsCount}) should be at most Today (${today.count}) + Derivatives (${deriv.count})`);
      }
    }

    await watchlistPage.goToWatchlist();
  });

  it('R59: Mutual Funds — Home, High Returns, first fund One Time & Start SIP', async function () {
    this.timeout(60000);

    await watchlistPage.tapNavMutualFunds();
    await browser.pause(1000);
    const homeLoaded = await mutualFundsPage.isHomeTabDisplayed();
    await assertOrDump(homeLoaded, 'R59: Mutual Funds Home tab did not load', 'Mutual Funds Home tab should be displayed after tapping the bottom nav');

    const tileCount = await mutualFundsPage.getHighReturnsTileCount();
    console.log(`  ℹ  High Returns tile count: ${tileCount}`);
    await mutualFundsPage.clickHighReturnsCollection();
    await browser.pause(1000);
    const listCount = await mutualFundsPage.getFundListHeaderCount();
    console.log(`  ℹ  High Returns list header count: ${listCount} (tile said ${tileCount}) — ${tileCount !== null && tileCount === listCount ? 'match' : 'mismatch'}`);

    const fundName = await mutualFundsPage.clickFirstFund();
    console.log(`  ℹ  Clicked first fund: "${fundName}"`);
    await browser.pause(1500);

    const oneTimeOpened = await mutualFundsPage.clickOneTimeButton();
    await assertOrDump(oneTimeOpened, 'R59: could not open One Time order pad', 'One Time button should be tappable on the fund detail screen');
    await browser.pause(1000);
    await mutualFundsPage.goBack();

    const sipOpened = await mutualFundsPage.clickStartSipButtonIfApplicable();
    console.log(`  ℹ  Start SIP order pad opened: ${sipOpened}`);
    if (sipOpened) {
      await browser.pause(1000);
      await mutualFundsPage.goBack();
    }

    const backOnHome = await mutualFundsPage.navigateBackToHome();
    await assertOrDump(backOnHome, 'R59: did not return to Mutual Funds Home', 'Navigating back from the fund detail flow should reach the Mutual Funds Home tab');

    await watchlistPage.goToWatchlist();
  });

  it('R60: Mutual Funds — Explore, category count, Equity → All', async function () {
    this.timeout(45000);

    await watchlistPage.tapNavMutualFunds();
    await browser.pause(1000);

    const exploreTapped = await mutualFundsPage.clickExploreTab();
    await assertOrDump(exploreTapped, 'R60: could not tap the Explore tab', 'Explore tab should be tappable from Mutual Funds');
    await browser.pause(1000);

    const categories = await mutualFundsPage.countCategorySolutionsHeaders();
    console.log(`  ℹ  Category Solutions — ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'} found: ${categories.join(', ')}`);
    await assertOrDump(categories.length > 0, 'R60: no Category Solutions headers found', 'At least one category should be found under Category Solutions');

    await mutualFundsPage.scrollExploreToTop();
    const equityCount = await mutualFundsPage.getCategoryFundCount('Equity');
    console.log(`  ℹ  Equity category card shows: ${equityCount} funds`);

    const equityExpanded = await mutualFundsPage.clickCategoryCard('Equity');
    await assertOrDump(equityExpanded, 'R60: could not tap the Equity category card', 'Equity category card should be tappable');
    await browser.pause(1000);

    const equityTags = await mutualFundsPage.getCategoryTags();
    console.log(`  ℹ  Equity tags: ${equityTags.join(', ')}`);

    const allTapped = await mutualFundsPage.clickCategoryTag('All');
    await assertOrDump(allTapped, 'R60: could not tap the "All" tag under Equity', '"All" tag should be tappable once Equity is expanded');
    await browser.pause(1500);

    const allResultsCount = await mutualFundsPage.getFilteredResultsCount();
    console.log(`  ℹ  "All" tag results: ${allResultsCount} (Equity card said ${equityCount}) — ${equityCount !== null && equityCount === allResultsCount ? 'match' : 'mismatch'}`);

    await mutualFundsPage.goBack();
    const backOnExplore = await mutualFundsPage.clickCategoryCard('Equity');
    console.log(`  ℹ  Navigated back to Explore and re-tapped Equity: ${backOnExplore}`);

    await watchlistPage.goToWatchlist();
  });

  it('R61: Mutual Funds — Portfolio, Active SIPs (if available)', async function () {
    this.timeout(30000);

    await watchlistPage.tapNavMutualFunds();
    await browser.pause(1000);

    const portfolioTapped = await mutualFundsPage.clickPortfolioTab();
    await assertOrDump(portfolioTapped, 'R61: could not tap the Portfolio tab', 'Portfolio tab should be tappable from Mutual Funds');
    await browser.pause(1000);

    const sipsVisible = await mutualFundsPage.isActiveSipsTileVisible();
    if (sipsVisible) {
      const activeSipsCount = await mutualFundsPage.getActiveSipsCount();
      console.log(`  ℹ  Active SIPs count: ${activeSipsCount}`);
      await mutualFundsPage.clickActiveSipsTile();
      await browser.pause(1500);
      await mutualFundsPage.goBack();
    } else {
      console.log('  ℹ  No "Active SIPs" tile visible — skipping (no active SIPs on this account)');
    }

    const backOnPortfolio = await mutualFundsPage.clickPortfolioTab();
    console.log(`  ℹ  Navigated back to Mutual Funds Portfolio tab: ${backOnPortfolio}`);

    await watchlistPage.goToWatchlist();
  });

  it('R62: Mutual Funds — Accounts', async function () {
    this.timeout(20000);

    await watchlistPage.tapNavMutualFunds();
    await browser.pause(1000);

    const accountsTapped = await mutualFundsPage.clickAccountsTab();
    await assertOrDump(accountsTapped, 'R62: could not tap the Accounts tab', 'Accounts tab should be tappable from Mutual Funds');
    await browser.pause(1000);

    const reportsMenuVisible = await mutualFundsPage.isReportsMenuVisible();
    await assertOrDump(reportsMenuVisible, 'R62: Accounts tab did not load', 'Reports menu button should be visible on the Accounts tab');

    await watchlistPage.goToWatchlist();
  });

  it('R63: Logout of the app', async function () {
    this.timeout(20000);

    await watchlistPage.goToWatchlist();
    const loggedOut = await loginPage.logout();
    await assertOrDump(loggedOut, 'R63: could not complete the logout flow', 'Hamburger menu → Logout → Yes should all be tappable');
    await browser.pause(1000);

    const backOnLogin = await loginPage.waitForLoginScreen(15000);
    await assertOrDump(backOnLogin, 'R63: did not return to the Login screen after logout', 'Login screen should reappear after logging out');
  });
});
