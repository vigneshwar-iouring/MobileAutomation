/**
 * Quote Header — Symbol Type & Segment Validation
 *
 * Classifies each symbol by its exchange segment and validates
 * Option Chain availability based on the instrument type.
 *
 * Scenario 1  SBI       → NSE/BSE  → Equity  → Option Chain Present  ✅
 * Scenario 2  RTNPOWER  → NSE/BSE  → Equity  → Option Chain Absent   ❌
 * Scenario 3  NIFTY     → NFO      → F&O     → Option Chain Present  ✅ + F&O fields
 *
 * Run:              npm run test:quote:symbol
 * Run (skip login): RESUME_SESSION=1 npm run test:quote:symbol
 */

'use strict';

const { expect }    = require('chai');
const watchlistPage = require('../../pages/Watchlist/WatchlistPage');
const searchPage    = require('../../pages/Search/SearchPage');
const quotePage     = require('../../pages/Quote/QuotePage');
const { doLogin }   = require('../../utils/loginHelper');

const RESUME_SESSION = !!process.env.RESUME_SESSION;

// Scenario results — populated progressively
const S = { s1: null, s2: null, s3: null };

// ── Helpers ───────────────────────────────────────────────────────────────────

const SEARCH_BAR_SEL = '//android.widget.EditText[contains(@hint,"Add or search stocks") or contains(@text,"Add or search stocks")]';

async function openSearch() {
  await watchlistPage.goToWatchlist();
  await browser.pause(400);
  try { await $(SEARCH_BAR_SEL).click(); } catch { await $('//android.widget.EditText').click(); }
  await browser.pause(600);
  return searchPage.isLoaded(5000);
}

async function searchAndOpenQuote(symbol, filterTab) {
  const opened = await openSearch();
  if (!opened) throw new Error(`Search screen did not open for ${symbol}`);
  await searchPage.typeQuery(symbol);
  await browser.pause(400);
  if (filterTab) { await searchPage.tapTab(filterTab); await browser.pause(400); }
  const hasResults = await searchPage.waitForResults(8000);
  if (!hasResults) throw new Error(`No results found for "${symbol}"`);
  const tapped = await searchPage.tapFirstResult();
  if (!tapped) throw new Error(`Could not tap first result for "${symbol}"`);
  return quotePage.isLoaded(8000);
}

function logScenario(num, s) {
  console.log(`\n  ┌─ Scenario ${num} ${'─'.repeat(35)}`);
  console.log(`  │  Symbol Name     : ${s.symbol   || 'N/A'}`);
  console.log(`  │  Exchange Segment: ${s.segment  || 'N/A'}`);
  console.log(`  │  Classified As   : ${s.classified}`);
  console.log(`  │  Option Chain    : ${s.hasOC ? 'Present ✅' : 'Not Present ❌'}`);
  if (s.fnoFields) {
    console.log(`  │  F&O Fields      :`);
    console.log(`  │    Expiry   : ${s.fnoFields.expiry  ? '✔' : '✘'}`);
    console.log(`  │    Strike   : ${s.fnoFields.strike  ? '✔' : '✘'}`);
    console.log(`  │    Lot Size : ${s.fnoFields.lotSize ? '✔' : '✘'}`);
    console.log(`  │    OI       : ${s.fnoFields.oi      ? '✔' : '✘'}`);
  }
  console.log(`  │  Validation Path : ${s.classified === 'Equity' ? 'Equity-flow' : 'F&O-flow'}`);
  console.log(`  └${'─'.repeat(43)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('Quote Header — Symbol Type & Segment Validation', () => {

  afterEach(function () {
    if (!this.currentTest) return;
    const { state, title } = this.currentTest;
    if (state === 'passed')       console.log(`  ✅ ${title}`);
    else if (state === 'pending') console.log(`  ⏭  ${title} — skipped`);
    else if (state === 'failed')  console.log(`  ❌ ${title} — FAILED`);
  });

  // ── Phase 1: Authentication ────────────────────────────────────────────────

  describe('Phase 1: Authentication', () => {

    before(async function () {
      this.timeout(300000);
      if (RESUME_SESSION) {
        try { await driver.activateApp(process.env.APP_PACKAGE || 'com.iouring.globecapital.dev'); } catch {}
        await browser.pause(800);
        return;
      }
      console.log('  ℹ  Starting fresh login...');
      await doLogin();
    });

    (RESUME_SESSION ? it.skip : it)('1.1: Login completed — Watchlist reachable', async function () {
      this.timeout(30000);
      expect(await watchlistPage.isLoaded(10000), 'Watchlist should be visible after login').to.be.true;
    });
  });

  // ── Scenario 1: SBI — Equity WITH Option Chain ────────────────────────────

  describe('Scenario 1: SBI — Equity WITH Option Chain', () => {

    before(async function () {
      this.timeout(40000);
      await searchAndOpenQuote('SBI', 'STOCK');
    });

    it('S1.1: SBI quote screen loads', async function () {
      this.timeout(10000);
      expect(await quotePage.isLoaded(8000), 'SBI Quote screen should load').to.be.true;
    });

    it('S1.2: Segment NSE/BSE → Equity → Option Chain present', async function () {
      this.timeout(12000);
      const symbol     = await quotePage.getSymbolName();
      const segment    = await quotePage.getSegment();
      const classified = quotePage.classifySegment(segment);
      const hasOC      = await quotePage.isOptionChainPresent();

      S.s1 = { symbol, segment, classified, hasOC, pass: classified === 'Equity' && hasOC };
      logScenario(1, S.s1);

      expect(classified, 'SBI should be Equity (NSE or BSE segment)').to.equal('Equity');
      expect(hasOC,      'SBI should have Option Chain').to.be.true;
    });

    after(async function () {
      try { await driver.back(); await browser.pause(600); } catch {}
      // If still on quote (half-sheet), dismiss it
      try { await driver.back(); await browser.pause(400); } catch {}
    });
  });

  // ── Scenario 2: RTNPOWER — Equity WITHOUT Option Chain ───────────────────

  describe('Scenario 2: RTNPOWER — Equity WITHOUT Option Chain', () => {

    before(async function () {
      this.timeout(40000);
      await searchAndOpenQuote('RTNPOWER', 'STOCK');
    });

    it('S2.1: RTNPOWER quote screen loads', async function () {
      this.timeout(10000);
      expect(await quotePage.isLoaded(8000), 'RTNPOWER Quote screen should load').to.be.true;
    });

    it('S2.2: Segment NSE/BSE → Equity → Option Chain absent', async function () {
      this.timeout(12000);
      const symbol     = await quotePage.getSymbolName();
      const segment    = await quotePage.getSegment();
      const classified = quotePage.classifySegment(segment);
      const hasOC      = await quotePage.isOptionChainPresent();

      S.s2 = { symbol, segment, classified, hasOC, pass: classified === 'Equity' && !hasOC };
      logScenario(2, S.s2);

      expect(classified, 'RTNPOWER should be Equity (NSE or BSE segment)').to.equal('Equity');
      expect(hasOC,      'RTNPOWER should NOT have Option Chain').to.be.false;
    });

    after(async function () {
      try { await driver.back(); await browser.pause(600); } catch {}
      try { await driver.back(); await browser.pause(400); } catch {}
    });
  });

  // ── Scenario 3: NIFTY — Future & Options WITH Option Chain ───────────────

  describe('Scenario 3: NIFTY — Future & Options WITH Option Chain', () => {

    before(async function () {
      this.timeout(40000);
      await searchAndOpenQuote('NIFTY', 'F&O');
    });

    it('S3.1: NIFTY F&O quote screen loads', async function () {
      this.timeout(10000);
      expect(await quotePage.isLoaded(8000), 'NIFTY F&O Quote screen should load').to.be.true;
    });

    it('S3.2: Segment NFO → F&O → Option Chain present + F&O fields', async function () {
      this.timeout(15000);
      const symbol     = await quotePage.getSymbolName();
      const segment    = await quotePage.getSegment();
      const classified = quotePage.classifySegment(segment);
      const hasOC      = await quotePage.isOptionChainPresent();
      const fnoFields  = await quotePage.getFnOSpecificFields();

      S.s3 = { symbol, segment, classified, hasOC, fnoFields, pass: classified === 'Future & Options' && hasOC };
      logScenario(3, S.s3);

      expect(classified, 'NIFTY should be Future & Options (non NSE/BSE segment)').to.equal('Future & Options');
      expect(hasOC,      'NIFTY F&O should have Option Chain').to.be.true;
    });

    after(async function () {
      try { await driver.back(); await browser.pause(600); } catch {}
      try { await driver.back(); await browser.pause(400); } catch {}
    });
  });

  // ── Summary ───────────────────────────────────────────────────────────────

  describe('Summary', () => {

    it('Final: Symbol Type & Option Chain Validation Summary', async function () {
      this.timeout(10000);

      const p = (r) => r?.pass ? '✅' : '❌';
      const classificationOk =
        S.s1?.classified === 'Equity' &&
        S.s2?.classified === 'Equity' &&
        S.s3?.classified === 'Future & Options';
      const overallPass = !!(S.s1?.pass && S.s2?.pass && S.s3?.pass && classificationOk);

      console.log('\n  =========================================================');
      console.log('     QUOTE HEADER — SYMBOL TYPE & OPTION CHAIN VALIDATION');
      console.log('  =========================================================');
      console.log(`  Scenario 1  ${(S.s1?.symbol || 'SBI').padEnd(9)} Equity  → Option Chain Present ..... ${p(S.s1)}`);
      console.log(`  Scenario 2  ${(S.s2?.symbol || 'RTNPOWER').padEnd(9)} Equity  → Option Chain Absent ...... ${p(S.s2)}`);
      console.log(`  Scenario 3  ${(S.s3?.symbol || 'NIFTY').padEnd(9)} F&O     → Option Chain Present ..... ${p(S.s3)}`);
      console.log('  ---------------------------------------------------------');
      console.log(`  Segment classification logic correct ................... ${classificationOk ? '✅' : '❌'}`);
      console.log(`  Overall Status: ${overallPass ? 'PASS ✅' : 'FAIL ❌'}`);
      console.log('  =========================================================\n');

      expect(overallPass, 'All 3 scenarios must pass').to.be.true;
    });
  });
});
