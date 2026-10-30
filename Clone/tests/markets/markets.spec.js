/**
 * Market Screen UI Validation — Globe Capital Dev
 *
 * Test Case: Validate the Market Screen UI
 *   1.  Launch the application and log in with valid credentials.
 *   2.  Navigate to the Home page.
 *   3.  Click on the Market tab.
 *   4.  Verify that the page header is displayed as "Market".
 *   5.  Capture and print the current Date & Time displayed on the screen.
 *   6.  Validate that the Search Globe input field is visible and enabled.
 *   7.  Verify that the Equity / F&O / Commodity / Currency category tabs are displayed.
 *   8.  Validate that each category tab is visible and clickable.
 *   9.  Click on the Equity tab.
 *   10. Verify that the Equity tab is selected/highlighted.
 *   11. Ensure the corresponding Equity indices list is displayed successfully.
 *   12. Repeat selection/indices validation for F&O, Commodity, and Currency tabs.
 *
 * NOTE: The index ticker's cards render as a single natural-language sentence
 * content-desc (e.g. "Index NIFTY 50. Last traded price: 24078.50. Change: 26.45.
 * Change percentage: 0.10 percent., Double tap to view NIFTY 50 details, or swipe
 * right for more options") rather than a stacked multi-line label — confirmed via a
 * full content-desc dump of each segment screen. MarketsPage.getIndexNames() parses
 * that sentence form directly.
 *
 * Run:              npm run test:markets
 * Run (skip login): RESUME_SESSION=1 npm run test:markets
 */

const { expect }    = require('chai');
const marketsPage   = require('../../pages/Markets/MarketsPage');
const { doLogin }   = require('../../utils/loginHelper');
const { dumpScreen } = require('../../utils/helpers');

const RESUME_SESSION = !!process.env.RESUME_SESSION;
const CATEGORY_TABS  = ['Equity', 'F&O', 'Commodity', 'Currency'];

// Result slots for the summary — populated progressively across phases
const R = {
  header:      null,
  searchBar:   null,
  tabsVisible: null,
  tabsClick:   null,
  segments:    {},   // keyed by CATEGORY_TABS label → { selected, indicesVisible, indexNames }
};

// ═════════════════════════════════════════════════════════════════════════════
describe('Market Screen UI Validation — Globe Capital Dev', () => {

  afterEach(function () {
    if (!this.currentTest) return;
    const { state, title } = this.currentTest;
    if (state === 'passed')       console.log(`  ✅ ${title}`);
    else if (state === 'pending') console.log(`  ⏭  ${title} — skipped`);
    else if (state === 'failed')  console.log(`  ❌ ${title} — FAILED`);
  });

  // ── Phase 1: Authentication ──────────────────────────────────────────────────

  describe('Phase 1: Authentication', () => {

    before(async function () {
      this.timeout(300000);
      if (RESUME_SESSION) {
        try { await driver.terminateApp(process.env.APP_PACKAGE || 'com.iouring.globecapital.dev'); } catch {}
        await browser.pause(500);
        try { await driver.activateApp(process.env.APP_PACKAGE  || 'com.iouring.globecapital.dev'); } catch {}
        await browser.pause(800);
        if (!await marketsPage.isNavTabVisible(8000))
          throw new Error('RESUME_SESSION: Home page not reachable — run without RESUME_SESSION for a fresh login.');
        return;
      }
      console.log('  ℹ  Starting fresh login via doLogin()...');
      await doLogin();
    });

    // Home page is reachable once the bottom nav (Watchlist/Market/Orders/Portfolio/
    // Mutual Funds) is visible — checked via the Market nav tab, since it renders on
    // every Home sub-screen regardless of which tab is currently active. Login may land
    // on a tab other than Watchlist, so we don't gate this on the Watchlist tab specifically.
    (RESUME_SESSION ? it.skip : it)('1.1: Fresh login completed and Home page is reachable', async function () {
      this.timeout(30000);
      // Home nav can render a beat after the final OTP screen transition —
      // give it more room than a single quick check to avoid a timing-based flake.
      expect(await marketsPage.isNavTabVisible(15000), 'Home page bottom nav should be visible after login').to.be.true;
    });
  });

  // ── Phase 2: Navigate to Market tab ──────────────────────────────────────────

  describe('Phase 2: Navigate to Market Tab', () => {

    before(async function () {
      this.timeout(30000);
      if (!await marketsPage.isNavTabVisible(12000)) throw new Error('Home page not reachable');
    });

    it('2.1: Tap Market tab → Market screen loads', async function () {
      this.timeout(20000);
      await marketsPage.goToMarkets();
      const loaded = await marketsPage.isLoaded(10000);
      if (!loaded) await dumpScreen('markets-not-loaded');
      expect(loaded, 'Market screen should load after tapping the Market tab').to.be.true;
    });
  });

  // ── Phase 3: Header — title + date/time  [items 4, 5] ───────────────────────

  describe('Phase 3: Market Screen Header', () => {

    it('3.1: Header title is displayed as "Market"  [item 4]', async function () {
      this.timeout(10000);
      const title = await marketsPage.getHeaderTitle();
      R.header = { title };
      console.log(`  ℹ  Header title: "${title || 'not found'}"`);
      expect(title, 'Header title should be readable').to.not.be.null;
      expect(title, 'Header title should read "Market"').to.match(/^Market(s)?$/i);
    });

    it('3.2: Current Date & Time is captured and printed  [item 5]', async function () {
      this.timeout(10000);
      const time = await marketsPage.getHeaderTime();
      R.header = { ...R.header, time };
      console.log(`  ℹ  Date & Time displayed on screen: "${time || 'not found'}"`);
      expect(time, 'A Date/Time value should be readable on the Market screen header').to.not.be.null;
    });
  });

  // ── Phase 4: Search Globe field  [item 6] ────────────────────────────────────

  describe('Phase 4: Search Globe Field', () => {

    it('4.1: Search Globe input is visible and enabled  [item 6]', async function () {
      this.timeout(20000);
      const visible = await marketsPage.isSearchBarDisplayed(6000);
      let enabled = null;
      try {
        const el = await $('//android.widget.EditText[contains(@hint,"Search") or contains(@hint,"search") or contains(@hint,"Add")]');
        if (await el.isExisting()) enabled = await el.isEnabled();
      } catch {}
      R.searchBar = { visible, enabled, placeholder: await marketsPage.getSearchPlaceholder() };
      console.log(`  ℹ  Search Globe visible: ${visible ? '✔' : '✘'}  enabled: ${enabled === null ? 'N/A' : (enabled ? '✔' : '✘')}  placeholder: "${R.searchBar.placeholder || 'N/A'}"`);
      expect(visible, 'Search Globe input field should be visible').to.be.true;
      if (enabled !== null) {
        expect(enabled, 'Search Globe input field should be enabled').to.be.true;
      }
    });
  });

  // ── Phase 5: Category tabs — Equity / F&O / Commodity / Currency  [items 7, 8] ─

  describe('Phase 5: Category Tabs', () => {

    // This app renders only the currently-active tab's label in the accessibility
    // tree (see MarketsPage.getAvailableTabs()), so a blind DOM scan before any tap
    // can only ever find whichever tab loaded first — it can't confirm the other 3
    // exist. Tapping through each tab is the only reliable way to confirm all 4, so
    // 5.1 and 5.2 share a single tap pass (MarketsPage.verifyAllTabs()) instead of
    // 5.1 doing a doomed blind check and 5.2 re-tapping everything from scratch.
    let tabResults;

    it('5.1: All 4 category tabs are displayed  [item 7]', async function () {
      this.timeout(30000);
      tabResults = await marketsPage.verifyAllTabs(CATEGORY_TABS);
      const found = CATEGORY_TABS.filter(t => tabResults.displayed[t]);
      R.tabsVisible = { found, pass: CATEGORY_TABS.every(t => tabResults.displayed[t]) };
      console.log(`  ℹ  Tabs found after tapping through: [${found.join(', ') || 'none'}]`);
      for (const label of CATEGORY_TABS) {
        console.log(`  ℹ  ${label}: ${tabResults.displayed[label] ? '✔' : '✘'}`);
      }
      expect(R.tabsVisible.pass, `All 4 category tabs (${CATEGORY_TABS.join(', ')}) should be present`).to.be.true;
    });

    it('5.2: Each category tab is clickable  [item 8]', async function () {
      this.timeout(10000);
      R.tabsClick = { results: tabResults.tapped, pass: CATEGORY_TABS.every(t => tabResults.tapped[t]) };
      for (const label of CATEGORY_TABS) {
        console.log(`  ℹ  Tap "${label}": ${tabResults.tapped[label] ? '✔' : '✘'}`);
      }
      expect(R.tabsClick.pass, 'Every category tab should be tappable').to.be.true;
    });
  });

  // ── Phase 6: Per-segment tab selection + indices  [items 9, 10, 11, 12] ─────

  CATEGORY_TABS.forEach((label) => {

    describe(`${label} Validation`, () => {

      it(`Click the ${label} tab`, async function () {
        this.timeout(15000);
        const tapped = await marketsPage.tapTab(label);
        await browser.pause(600);
        expect(tapped, `${label} tab should be tappable`).to.be.true;
      });

      it(`Verify the ${label} tab is selected/highlighted`, async function () {
        this.timeout(10000);
        const selected = await marketsPage.getSelectedTab();
        // App does not always expose selected="true"; fall back to checking that
        // segment-only content (e.g. NIFTY/SENSEX for Equity, GOLD/SILVER for
        // Commodity) is what's currently rendered.
        const segmentContent = await marketsPage.getSegmentContent(label);
        const pass = selected === label || segmentContent.length > 0;
        R.segments[label] = { ...R.segments[label], selected: pass };
        console.log(`  ℹ  Selected tab (attribute): ${selected || 'N/A'}  |  ${label} keywords visible: [${segmentContent.join(', ') || 'none'}]`);
        expect(pass, `${label} tab should be the selected/highlighted tab`).to.be.true;
      });

      // The index ticker's cards render as a single natural-language sentence
      // content-desc — 'Index NIFTY 50. Last traded price: 24078.50. Change: ...' —
      // not a stacked multi-line label, which is why this needed a dedicated parser
      // (see MarketsPage.getIndexNames()). Confirmed present on all 4 segments via
      // a full content-desc dump.
      it(`Validate that the ${label} indices list is displayed`, async function () {
        this.timeout(15000);
        const visible = await marketsPage.areIndexNamesVisible(10000);
        R.segments[label] = { ...R.segments[label], indicesVisible: visible };
        console.log(`  ℹ  ${label} indices list visible: ${visible ? '✔' : '✘'}`);
        expect(visible, `${label} indices list should be displayed`).to.be.true;
      });

      it(`Capture all displayed ${label} index names`, async function () {
        this.timeout(15000);
        // Same index often repeats with different expiries on F&O/Commodity/Currency
        // (e.g. two NIFTY futures) — swipe the ticker to surface a second, distinct index.
        const names = await marketsPage.collectIndexNames(2, 4);
        R.segments[label] = { ...R.segments[label], indexNames: names };
        console.log(`  ℹ  ${label} index names captured: [${names.join(', ') || 'none'}]`);
        expect(names.length, `${label} should have at least one index name captured`).to.be.above(0);
      });

      it(`Print the first two ${label} index names`, async function () {
        this.timeout(10000);
        const names = R.segments[label]?.indexNames?.length
          ? R.segments[label].indexNames
          : await marketsPage.collectIndexNames(2, 4);
        const firstTwo = names.slice(0, 2);
        console.log(`  ${label} Indices: ${firstTwo.join(', ')}`);
        expect(firstTwo.length, `At least one ${label} index name should be printed`).to.be.above(0);
      });
    });
  });

  // ── Phase 7: Summary ─────────────────────────────────────────────────────────

  describe('Phase 7: Summary', () => {

    it('7.1: Market Screen UI Validation — summary', async function () {
      this.timeout(10000);

      const p = (r) => r?.pass ? '✅' : '❌';
      const sp = (s) => (s?.selected && s?.indicesVisible && s?.indexNames?.length > 0) ? '✅' : '❌';

      console.log('\n  ===================================================');
      console.log('          MARKET SCREEN UI — QA TEST SUMMARY');
      console.log('  ===================================================');
      console.log(`  1. Header title ....................... ${R.header?.title || 'N/A'}`);
      console.log(`  2. Date & Time ......................... ${R.header?.time || 'N/A'}`);
      console.log(`  3. Search Globe (visible/enabled) ...... ${R.searchBar?.visible ? '✔' : '✘'} / ${R.searchBar?.enabled === null ? 'N/A' : (R.searchBar?.enabled ? '✔' : '✘')}`);
      console.log(`  4. Category tabs displayed ............. ${p(R.tabsVisible)}`);
      console.log(`  5. Category tabs clickable ............. ${p(R.tabsClick)}`);
      for (const label of CATEGORY_TABS) {
        const s = R.segments[label];
        console.log(`  6. ${label} tab + indices ............. ${sp(s)}  [${s?.indexNames?.slice(0, 2).join(', ') || 'N/A'}]`);
      }
      console.log('  ---------------------------------------------------');
      const overallPass = [R.tabsVisible, R.tabsClick, ...CATEGORY_TABS.map(l => ({ pass: sp(R.segments[l]) === '✅' }))]
        .every(r => r?.pass);
      console.log(`  Overall Status: ${overallPass ? 'PASS ✅' : 'FAIL ❌'}`);
      console.log('  ===================================================\n');

      expect(await marketsPage.isLoaded(3000)).to.be.true;
    });
  });
});
