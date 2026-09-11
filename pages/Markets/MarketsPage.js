'use strict';

const BasePage = require('../Login/BasePage');

// Markets Screen — Globe Capital Dev
// Layout: Header (Market + IST time) → Search bar → Segment tabs (Equity/F&O/Commodity/Currency) → Content

const SEL = {
  // ── Bottom nav ─────────────────────────────────────────────────────────────
  marketNavTab: '//*[contains(@content-desc,"Market") and not(contains(@content-desc,"Watchlist")) and not(contains(@content-desc,"Orders")) and not(contains(@content-desc,"Portfolio")) and not(contains(@content-desc,"Mutual Funds"))]',

  // ── Segment tabs ───────────────────────────────────────────────────────────
  tab: (label) => `//*[@content-desc="${label}" or @text="${label}" or contains(@content-desc,"${label}") or contains(@text,"${label}")]`,

  // ── Search bar ─────────────────────────────────────────────────────────────
  // "Search Globe" is the specific content-desc/text of the Markets search bar
  searchGlobe:    '//*[@content-desc="Search Globe" or contains(@content-desc,"Search Globe") or @text="Search Globe" or contains(@text,"Search Globe")]',
  searchEditText: '//android.widget.EditText[contains(@hint,"Search") or contains(@hint,"search") or contains(@hint,"stocks") or contains(@hint,"Add") or contains(@hint,"add")]',
  searchView:     '//*[(contains(@content-desc,"Search") or contains(@content-desc,"search") or contains(@content-desc,"Add or") or contains(@content-desc,"add or")) and not(contains(@content-desc,"No Recent")) and string-length(@content-desc) < 60]',

  // ── Instrument rows (exchange-tagged content-descs) ────────────────────────
  marketRows: '//android.view.View[(contains(@content-desc,"NSE") or contains(@content-desc,"BSE") or contains(@content-desc,"NFO") or contains(@content-desc,"MCX")) and string-length(@content-desc) > 10]',

  // ── Movers / back ──────────────────────────────────────────────────────────
  seeAllBtn: '//*[@content-desc="See All" or @text="See All" or contains(@content-desc,"See All") or contains(@text,"See All")]',
  backBtn:   '//android.widget.ImageButton[@content-desc="Navigate up" or @content-desc="Back"] | //android.view.View[@content-desc="Back"]',
};

const TABS = ['Equity', 'F&O', 'Commodity', 'Currency'];

const SEGMENT_KEYWORDS = {
  'Equity':    ['NIFTY', 'SENSEX', 'BANKNIFTY', 'BANK NIFTY', 'Gainer', 'Loser', 'NSE', 'BSE'],
  'F&O':       ['Nifty', 'Futures', 'BankNifty', 'Active', 'NFO', 'Expiry'],
  'Commodity': ['GOLD', 'SILVER', 'CRUDEOIL', 'MCX', 'NATURALGAS', 'Commodity'],
  'Currency':  ['USDINR', 'EURINR', 'GBPINR', 'CDS', 'Currency'],
};

const INDEX_NAMES = [
  'NIFTY 50', 'SENSEX', 'BANK NIFTY', 'NIFTY BANK',
  'FINNIFTY', 'MIDCAP NIFTY', 'NIFTY MIDCAP', 'INDIA VIX',
  'NIFTY IT', 'NIFTY AUTO', 'NIFTY PHARMA', 'BSE 500',
];

class MarketsPage extends BasePage {

  // ── Navigation ─────────────────────────────────────────────────────────────

  async goToMarkets() {
    await this.findAndTap(SEL.marketNavTab, 8000);
    await browser.pause(800);
  }

  // Bottom nav (with the Market tab) renders on every Home sub-screen — Watchlist,
  // Market, Orders, Portfolio, Mutual Funds — so this is a tab-agnostic "is Home
  // reachable" check, unlike WatchlistPage.isLoaded() which only matches the
  // Watchlist tab specifically.
  async isNavTabVisible(timeout = 8000) {
    return this.isDisplayed(SEL.marketNavTab, timeout);
  }

  // ── Screen readiness ───────────────────────────────────────────────────────

  // Uses only markers exclusive to Markets — NIFTY/SENSEX/Gainer also appear on Quote
  // screens and would cause false positives in returnToMarkets() navigation guards.
  async isLoaded(timeout = 10000) {
    return this.pollUntil(async () => {
      const src = await driver.getPageSource();
      // Segment tab labels — only one is in DOM (the active tab), but all are Markets-exclusive.
      // F&O encoded as F&amp;O in XML source; also check plain form.
      // Search bar hints vary by app version: "Add or search", "Search Globe", etc.
      // NIFTY/SENSEX/Gainer excluded — they also appear on Quote screens.
      return src.includes('Equity') || src.includes('Commodity') || src.includes('Currency') ||
             src.includes('F&amp;O') || src.includes('F&O') ||
             src.toLowerCase().includes('search globe') || src.toLowerCase().includes('add or search');
    }, timeout, 500);
  }

  // ── Header ─────────────────────────────────────────────────────────────────

  // Single page-source fetch for both title and time.
  async getHeaderInfo() {
    try {
      const src   = await driver.getPageSource();
      const descs = [...src.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1].split(/\n|&#10;/)[0].trim());
      const texts = [...src.matchAll(/\btext="([^"]+)"/g)].map(m => m[1].trim());
      const title = [...descs, ...texts].find(v => /^Market(s)?$/i.test(v)) || null;
      const timeM = src.match(/\b(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\b/i);
      const time  = timeM ? timeM[1].trim() : null;
      return { title, time };
    } catch { return { title: null, time: null }; }
  }

  // Poll rather than single-shot read — the header title/time can render a beat
  // after isLoaded() flips true (segment tabs / search bar land first), so a
  // one-shot getHeaderInfo() call right after navigation intermittently races it.
  async getHeaderTitle(timeout = 8000) {
    let title = null;
    await this.pollUntil(async () => {
      title = (await this.getHeaderInfo()).title;
      return title !== null;
    }, timeout, 500);
    return title;
  }

  async getHeaderTime(timeout = 8000) {
    let time = null;
    await this.pollUntil(async () => {
      time = (await this.getHeaderInfo()).time;
      return time !== null;
    }, timeout, 500);
    return time;
  }

  // ── Search bar ─────────────────────────────────────────────────────────────

  async isSearchBarDisplayed(timeout = 5000) {
    if (await this.isDisplayed(SEL.searchEditText, timeout)) return true;
    if (await this.isDisplayed(SEL.searchView,     timeout)) return true;
    try {
      const src = await driver.getPageSource();
      return src.toLowerCase().includes('search');
    } catch { return false; }
  }

  async getSearchPlaceholder() {
    try {
      const el = await $(SEL.searchEditText);
      if (await el.isExisting()) {
        const hint = await el.getAttribute('hint');
        if (hint && hint !== 'null') return hint;
        const txt = await el.getText();
        if (txt && txt !== 'null' && txt.trim()) return txt;
      }
    } catch {}
    try {
      const el = await $(SEL.searchView);
      if (await el.isExisting()) {
        const desc = await el.getAttribute('content-desc');
        if (desc && desc !== 'null') return desc;
      }
    } catch {}
    try {
      const src = await driver.getPageSource();
      const m   = src.match(/hint="([^"]{4,60})"/);
      if (m) return m[1];
    } catch {}
    return null;
  }

  async tapSearchBar() {
    // UiSelector finds by text/description regardless of element type or hierarchy depth
    for (const uiSel of [
      'android=new UiSelector().text("Search Globe")',
      'android=new UiSelector().textContains("Search Globe")',
      'android=new UiSelector().descriptionContains("Search Globe")',
      'android=new UiSelector().className("android.widget.EditText").textContains("Search")',
    ]) {
      try {
        const el = await $(uiSel);
        if (await el.isExisting()) { await el.click(); await browser.pause(1200); return true; }
      } catch {}
    }
    // XPath fallbacks
    if (await this.findAndTap(SEL.searchGlobe,    2000)) { await browser.pause(800); return true; }
    if (await this.findAndTap(SEL.searchEditText, 2000)) { await browser.pause(600); return true; }
    if (await this.findAndTap(SEL.searchView,     2000)) { await browser.pause(600); return true; }
    // Coordinate tap: search bar at ~16 % from top (tabs sit at 17%; search bar is just above)
    try {
      const { width, height } = await browser.getWindowSize();
      await browser.action('pointer', { parameters: { pointerType: 'touch' } })
        .move({ x: Math.round(width * 0.5), y: Math.round(height * 0.16) })
        .down().pause(80).up().perform();
      await browser.pause(1500);
      return true;
    } catch {}
    if (await this.findAndTap('//android.widget.EditText', 2000)) { await browser.pause(600); return true; }
    return false;
  }

  // ── Segment tabs ───────────────────────────────────────────────────────────

  async tapTab(label) {
    const tapped = await this.findAndTap(SEL.tab(label), 3000);
    if (tapped) { await browser.pause(500); return true; }
    // This app only renders the ACTIVE tab's label in the accessibility tree.
    // Fall back to coordinate tap for any non-active tab.
    return this._tapTabByCoordinate(label);
  }

  // Tab bar sits ~17% from top (status bar ~24dp + header ~56dp + search ~48dp = ~128dp).
  // 4 equal-width slots: centres at 12.5 / 37.5 / 62.5 / 87.5 % of viewport width.
  async _tapTabByCoordinate(label) {
    const X_RATIOS = { 'Equity': 0.125, 'F&O': 0.375, 'Commodity': 0.625, 'Currency': 0.875 };
    const xRatio = X_RATIOS[label];
    if (!xRatio) return false;
    try {
      const { width, height } = await browser.getWindowSize();
      const x = Math.round(width  * xRatio);
      const y = Math.round(height * 0.17);
      await browser.action('pointer', { parameters: { pointerType: 'touch' } })
        .move({ x, y }).down().pause(80).up().perform();
      await browser.pause(600);
      console.log(`  ℹ  coord-tap('${label}') → x=${x}, y=${y} (${width}×${height})`);
      return true;
    } catch (e) {
      console.log(`  ⚠  coord-tap('${label}') failed: ${e.message}`);
      return false;
    }
  }

  async isTabDisplayed(label, timeout = 5000) {
    return this.isDisplayed(SEL.tab(label), timeout);
  }

  // App does not set selected="true" — returns null in practice; kept for forward compatibility.
  async getSelectedTab() {
    try {
      const src = await driver.getPageSource();
      for (const label of TABS) {
        const encoded = label.replace('&', '&amp;');
        const re = new RegExp(`(?:content-desc|text)="[^"]*${encoded}[^"]*"[^>]*selected="true"`, 'i');
        if (re.test(src)) return label;
      }
    } catch {}
    return null;
  }

  // Returns tab labels currently present in the accessibility tree.
  // Note: this app renders only the active tab's label, so the result is usually a single item.
  async getAvailableTabs() {
    const found = [];
    try {
      const src = await driver.getPageSource();
      for (const label of TABS) {
        const encoded = label.replace('&', '&amp;');
        if (src.includes(label) || src.includes(encoded)) found.push(label);
      }
    } catch {}
    return found;
  }

  // Taps each tab in turn and records whether it became the active (displayed) tab.
  // This app only renders the currently-active tab's label in the accessibility
  // tree (see getAvailableTabs()), so tab presence can only be confirmed by
  // tapping through them — a blind pre-tap DOM scan only ever sees whichever
  // tab happened to load first.
  async verifyAllTabs(labels = TABS) {
    const tapped = {};
    const displayed = {};
    for (const label of labels) {
      tapped[label] = await this.tapTab(label);
      displayed[label] = await this.isTabDisplayed(label, 3000);
    }
    return { tapped, displayed };
  }

  async getSegmentContent(label) {
    try {
      const src = await driver.getPageSource();
      return (SEGMENT_KEYWORDS[label] || []).filter(k => src.includes(k));
    } catch { return []; }
  }

  // ── Index / Market Cards ───────────────────────────────────────────────────

  async getIndexCards() {
    try {
      const src  = await driver.getPageSource();
      const seen = new Set();
      return [...src.matchAll(/content-desc="([^"]{10,200})"/g)]
        .map(m => m[1])
        .filter(desc => INDEX_NAMES.some(idx => desc.toUpperCase().includes(idx.toUpperCase())))
        .map(desc => {
          const lines     = desc.split(/\n|&#10;/).map(l => l.trim()).filter(Boolean);
          const value     = lines.find(l => /^\d[\d,]+\.?\d*$/.test(l.replace(/,/g, ''))) || null;
          const change    = lines.find(l => /^[+\-]\d[\d,.]+$/.test(l.trim())) || null;
          const pctChange = lines.find(l => /%/.test(l)) || null;
          const color     = /green/i.test(desc) ? 'green'
                          : /red/i.test(desc)   ? 'red'
                          : change?.startsWith('+') ? 'green'
                          : change?.startsWith('-') ? 'red'
                          : 'unknown';
          return { name: lines[0] || '', value, change, pctChange, color };
        })
        .filter(c => c.name && !seen.has(c.name) && seen.add(c.name));
    } catch { return []; }
  }

  // Returns true once at least one index card is readable (polls until timeout).
  async areIndexCardsVisible(timeout = 8000) {
    return this.pollUntil(async () => (await this.getIndexCards()).length > 0, timeout, 500);
  }

  // Segment-agnostic index name capture. Each ticker card's content-desc is a single
  // natural-language sentence — 'Index NIFTY 50. Last traded price: 24078.50. Change: ...' —
  // not the multi-line stacked label getIndexCards() expects, so this parses that
  // sentence form directly. Works for all 4 segments (NIFTY 50, NIFTY, GOLD, USDINR, …).
  async getIndexNames() {
    try {
      const src  = await driver.getPageSource();
      const seen = new Set();
      return [...src.matchAll(/content-desc="Index ([A-Za-z0-9 &]+?)\./g)]
        .map(m => m[1].trim())
        .filter(name => name && !seen.has(name) && seen.add(name));
    } catch { return []; }
  }

  // Returns true once at least one index name is readable (polls until timeout).
  async areIndexNamesVisible(timeout = 8000) {
    return this.pollUntil(async () => (await this.getIndexNames()).length > 0, timeout, 500);
  }

  // Accumulates at least minCount unique index names, swiping the ticker strip to
  // reveal more when the current viewport only shows the same index repeated with
  // different expiries (common on F&O/Commodity/Currency, e.g. two NIFTY futures).
  async collectIndexNames(minCount = 2, maxSwipes = 4) {
    const names = await this.getIndexNames();
    for (let i = 0; i < maxSwipes && names.length < minCount; i++) {
      await this.swipeIndexTicker();
      await browser.pause(400);
      for (const name of await this.getIndexNames()) {
        if (!names.includes(name)) names.push(name);
      }
    }
    return names;
  }

  // Swipe the index ticker strip right-to-left to reveal additional index cards.
  async swipeIndexTicker() {
    try {
      const { width, height } = await browser.getWindowSize();
      const y = Math.round(height * 0.23); // just below segment tabs
      await browser.action('pointer', { parameters: { pointerType: 'touch' } })
        .move({ x: Math.round(width * 0.8), y })
        .down().pause(60)
        .move({ x: Math.round(width * 0.2), y })
        .up().perform();
      await browser.pause(800);
      return true;
    } catch { return false; }
  }

  // ── Market Movers ──────────────────────────────────────────────────────────

  async getMarketMovers() {
    try {
      const src = await driver.getPageSource();
      return {
        gainersVisible: /[Gg]ainer/.test(src),
        losersVisible:  /[Ll]oser/.test(src),
        seeAllVisible:  /See All/i.test(src),
      };
    } catch {
      return { gainersVisible: false, losersVisible: false, seeAllVisible: false };
    }
  }

  // Scroll until the Market Movers header is physically visible on screen, then stop.
  // Uses getLocation() to detect actual screen y-coordinate — stops as soon as the header
  // appears within the visible area (y > 0 and y < screenH - 100).
  async scrollToMarketMovers() {
    let screenH;
    try { ({ height: screenH } = await browser.getWindowSize()); } catch { screenH = 900; }
    const SELS = [
      'android=new UiSelector().textContains("Market Mover")',
      'android=new UiSelector().descriptionContains("Market Mover")',
      'android=new UiSelector().textContains("Top Gainer")',
      'android=new UiSelector().descriptionContains("Top Gainer")',
    ];
    const isOnScreen = async () => {
      for (const sel of SELS) {
        try {
          const el = await $(sel);
          if (!await el.isExisting()) continue;
          const loc = await el.getLocation();
          if (loc.y > 0 && loc.y < screenH - 100) return true;
        } catch {}
      }
      return false;
    };
    if (await isOnScreen()) return true;
    for (let i = 0; i < 8; i++) {
      await this.swipeUp();
      await browser.pause(600);
      if (await isOnScreen()) return true;
    }
    return false;
  }

  // Snapshot of the Market Movers card on the main Equity page.
  async getMoverCardInfo() {
    try {
      const src = await driver.getPageSource();
      // Count rows via page source — Movers rows have % change and a numeric price
      // (exchange codes may not appear in the content-desc on the card or full screen).
      const rowCount = this._countMoverRows(src);
      const tabMatches = [...src.matchAll(/content-desc="([^"\n]{3,50})"/g)]
        .map(m => m[1].split(/\n|&#10;/)[0].trim())
        .filter(v => /Gainer|Loser|High|Low|Active|52\s*W|Most|Volume/i.test(v));
      // Equity's section is literally titled "Market Movers"; F&O/Commodity/Currency
      // use "<Segment> Market Insights" instead but share the same Gainer/Loser tabs —
      // fall back to tab presence so the check works across all 4 segments.
      return {
        headerVisible: src.includes('Market Mover') || src.includes('Market Insights') || tabMatches.length > 0,
        tabLabels:     [...new Set(tabMatches)],
        rowCount,
        seeAllVisible: /See All/i.test(src),
      };
    } catch { return { headerVisible: false, tabLabels: [], rowCount: 0, seeAllVisible: false }; }
  }

  // Shared row shape check: 2+ content lines, a bare price, a % figure, and a
  // +/-/arrow sign — used by both the count and detail parsers below.
  _isMoverRow(desc) {
    const lines = desc.split(/\n|&#10;/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return false;
    const hasPrice = lines.some(l => /^\d[\d,.]+$/.test(l.replace(/[₹,\s]/g, '')));
    const hasPct   = lines.some(l => /%/.test(l));
    const hasSign  = lines.some(l => /^[+\-]/.test(l) || /[↑↓]/.test(l) || /\([+\-]/.test(l));
    return hasPrice && hasPct && hasSign;
  }

  // Count stock-price rows from raw page source (works even without exchange codes).
  _countMoverRows(src) {
    return [...src.matchAll(/content-desc="([^"]{8,300})"/g)]
      .map(m => m[1])
      .filter(d => this._isMoverRow(d)).length;
  }

  // Parse visible stock rows from page source {symbol, exchange, ltp, change, pct}.
  async parseMoverRows(maxRows = 5) {
    try {
      const src = await driver.getPageSource();
      return [...src.matchAll(/content-desc="([^"]{8,300})"/g)]
        .map(m => m[1])
        .filter(d => this._isMoverRow(d))
        .slice(0, maxRows)
        .map(raw => {
          const parts  = raw.split(/\n|&#10;/).map(p => p.trim()).filter(Boolean);
          const symbol   = parts[0] || '';
          const exchange = parts.find(p => /^(NSE|BSE|NFO|MCX|CDS)$/.test(p)) || '';
          const ltp      = parts.find(p => /^\d[\d,.]+$/.test(p.replace(/[₹,\s]/g, ''))) || '';
          const pct      = parts.find(p => /%/.test(p)) || '';
          const change   = parts.find(p => /^[+\-][\d,.]+$/.test(p)) || '';
          return { symbol, exchange, ltp, change, pct, raw };
        });
    } catch { return []; }
  }

  // Snapshot of the full-screen Market Movers (after tapping See All).
  async getMoversFullScreenInfo() {
    try {
      const src      = await driver.getPageSource();
      const rowCount = this._countMoverRows(src);
      return {
        hasBackBtn: /Navigate up|content-desc="Back"/i.test(src),
        hasIndexDD: /NIFTY 50|Nifty 50|NIFTY/i.test(src),
        hasTabs:    /Gainer|Loser|High|Low|Active/i.test(src),
        rowCount,
      };
    } catch { return { hasBackBtn: false, hasIndexDD: false, hasTabs: false, rowCount: 0 }; }
  }

  // On the full Movers screen: open the index dropdown and select targetIndex.
  async changeMoversIndex(targetIndex) {
    for (const sel of [
      'android=new UiSelector().textContains("NIFTY 50")',
      'android=new UiSelector().descriptionContains("NIFTY 50")',
      '//*[contains(@text,"NIFTY 50") or contains(@content-desc,"NIFTY 50")]',
      'android=new UiSelector().textContains("NIFTY")',
    ]) {
      try {
        const el = await $(sel);
        if (!await el.isExisting()) continue;
        await el.click();
        await browser.pause(1000);
        const variants = [targetIndex, targetIndex.replace(/\s/g, ''),
                          targetIndex.split(' ').slice(-1)[0]].filter(Boolean);
        for (const v of variants) {
          try {
            const opt = await $(`android=new UiSelector().textContains("${v}")`);
            if (await opt.isExisting()) { await opt.click(); await browser.pause(1200); return true; }
          } catch {}
        }
        try { await driver.back(); } catch {}
        return false;
      } catch {}
    }
    return false;
  }

  async tapSeeAll() {
    const tapped = await this.findAndTap(SEL.seeAllBtn, 5000);
    if (tapped) await browser.pause(800);
    return tapped;
  }

  async goBack() {
    try { await this.findAndTap(SEL.backBtn, 3000); }
    catch { try { await driver.back(); } catch {} }
    await browser.pause(400);
  }

  async tapFirstSymbol() {
    // Strategy 1: exchange-tagged NSE/BSE rows (SEL.marketRows)
    try {
      const rows = await $$(SEL.marketRows);
      if (rows.length > 0) { await rows[0].click(); await browser.pause(1000); return true; }
    } catch {}
    // Strategy 2: any View whose content-desc contains % (stock row indicator)
    try {
      const src  = await driver.getPageSource();
      const descs = [...src.matchAll(/content-desc="([^"]{10,120})"/g)]
        .map(m => m[1])
        .filter(d => d.includes('%') && (d.includes('+') || d.includes('-') || d.includes('↑') || d.includes('↓')));
      for (const desc of descs.slice(0, 5)) {
        const snippet = desc.slice(0, 20).replace(/["'<>&]/g, ' ').trim();
        try {
          const el = await $(`android=new UiSelector().descriptionStartsWith("${snippet}")`);
          if (await el.isExisting()) { await el.click(); await browser.pause(1000); return true; }
        } catch {}
      }
    } catch {}
    // Strategy 3: any UiSelector View with % character in content-desc
    try {
      const el = await $('android=new UiSelector().descriptionContains("%").instance(0)');
      if (await el.isExisting()) { await el.click(); await browser.pause(1000); return true; }
    } catch {}
    // Strategy 4: coordinate tap toward the top of visible rows (avoid bottom-nav area)
    try {
      const { width, height } = await browser.getWindowSize();
      await browser.action('pointer', { parameters: { pointerType: 'touch' } })
        .move({ x: Math.round(width * 0.3), y: Math.round(height * 0.45) })
        .down().pause(80).up().perform();
      await browser.pause(1000);
      return true;
    } catch {}
    return false;
  }

  // ── Content helpers ────────────────────────────────────────────────────────

  async waitForContent(timeout = 8000) {
    return this.pollUntil(async () => (await $$(SEL.marketRows)).length > 0, timeout, 500);
  }

  async getRowCount() {
    try { return (await $$(SEL.marketRows)).length; } catch { return 0; }
  }

  async getVisibleRows(limit = 5) {
    const rows = [];
    try {
      for (const el of (await $$(SEL.marketRows)).slice(0, limit)) {
        try {
          const raw   = await el.getAttribute('content-desc') || '';
          const parts = raw.split(/\n|&#10;/).map(p => p.trim()).filter(Boolean);
          rows.push({ symbol: parts[0] || '', exchange: parts[1] || '', rawDesc: raw });
        } catch {}
      }
    } catch {}
    return rows;
  }

  // ── Scroll ─────────────────────────────────────────────────────────────────

  async scrollDown(times = 2) {
    for (let i = 0; i < times; i++) { await this.swipeUp(); await browser.pause(400); }
  }

  async scrollToTop(times = 4) {
    for (let i = 0; i < times; i++) { await this.swipeDown(); await browser.pause(350); }
  }

  // Use Android UiAutomator's UiScrollable to auto-scroll to any text — more reliable than manual swipes.
  async uiScrollToText(keyword) {
    for (const uiSel of [
      `android=new UiScrollable(new UiSelector().scrollable(true).instance(0)).scrollIntoView(new UiSelector().textContains("${keyword}"))`,
      `android=new UiScrollable(new UiSelector().scrollable(true).instance(0)).scrollIntoView(new UiSelector().descriptionContains("${keyword}"))`,
    ]) {
      try {
        const el = await $(uiSel);
        if (await el.isExisting()) { await browser.pause(400); return true; }
      } catch {}
    }
    return false;
  }

  // Swipe up until keyword appears in page source; returns true if found.
  async scrollToKeyword(keyword, maxSwipes = 8) {
    for (let i = 0; i < maxSwipes; i++) {
      try {
        if ((await driver.getPageSource()).includes(keyword)) return true;
      } catch {}
      await this.swipeUp();
      await browser.pause(600);
    }
    try { return (await driver.getPageSource()).includes(keyword); } catch { return false; }
  }

  // ── Market Live / News ─────────────────────────────────────────────────────

  // Scroll until "Market Live" section is visible.
  async scrollToMarketLive() {
    return this.scrollToKeyword('Market Live', 6);
  }

  async tapMarketLiveSeeAll() {
    if (!await this.scrollToKeyword('Market Live', 6)) return false;
    await browser.pause(400);
    // Try sibling See All button relative to Market Live text
    for (const sel of [
      'android=new UiSelector().text("See All").instance(0)',
      SEL.seeAllBtn,
    ]) {
      try {
        const el = await $(sel);
        if (await el.isExisting()) { await el.click(); await browser.pause(900); return true; }
      } catch {}
    }
    return false;
  }

  async isNewsScreenLoaded(timeout = 8000) {
    return this.pollUntil(async () => {
      const src = await driver.getPageSource();
      return src.includes('Block Deals') ||
             (src.includes('Result') && src.includes('All')) ||
             src.includes('Search for stocks') ||
             (src.includes('Equity') && src.includes('Commodity') && src.includes('All'));
    }, timeout, 500);
  }

  async tapNewsTab(label) { return this._tapLabel(label); }

  // ── Market Movers — full See All screen ────────────────────────────────────

  // Scrolls to Market Movers card, then taps its own See All (not Market Live's).
  //
  // Why getLocation() instead of page-source checks:
  //   React Navigation keeps the Movers full screen mounted in the background at all times.
  //   "Tab N of N" and "Market Movers" therefore appear in the accessibility tree even when
  //   we are on the main Market Equity page — any page-source check returns a false positive.
  //   getLocation() returns the actual screen y-coordinate:
  //     • element truly visible → 0 < y < screenHeight
  //     • background-mounted element → y >= screenHeight (rendered below the visible area)
  //   We use this to (a) skip Market Live's off-screen "See All", and (b) confirm the full
  //   screen is actually open by checking whether "Tab 1 of N" is physically on screen.
  async tapMoversSeeAll() {
    await browser.pause(400);

    let screenH;
    try { ({ height: screenH } = await browser.getWindowSize()); } catch { screenH = 900; }

    // Returns true only when the "Tab 1 of N" element is physically visible on screen.
    // Background-mounted full-screen tabs have y >= screenH; visible ones have y in (50, screenH-80).
    const isTabVisible = async () => {
      for (const pat of [
        'android=new UiSelector().textContains("Tab 1 of")',
        'android=new UiSelector().descriptionContains("Tab 1 of")',
      ]) {
        try {
          const el = await $(pat);
          if (!await el.isExisting()) continue;
          const loc = await el.getLocation();
          if (loc.y >= 0 && loc.y < screenH) return true;
        } catch {}
      }
      return false;
    };

    const waitForFullScreen = async () => {
      for (let p = 0; p < 8; p++) {
        if (await isTabVisible()) return true;
        await browser.pause(500);
      }
      return false;
    };

    // Primary: find the "Market Mover" header's y-coordinate, then click the "See All"
    // on the same row (closest y-distance). This avoids clicking F&O tab's "See All"
    // or Market Live's "See All" — both of which can be in the accessibility tree simultaneously.
    let headerY = -1;
    for (const sel of [
      'android=new UiSelector().textContains("Market Mover")',
      'android=new UiSelector().descriptionContains("Market Mover")',
      'android=new UiSelector().textContains("Top Gainer")',
      'android=new UiSelector().descriptionContains("Top Gainer")',
    ]) {
      try {
        const el = await $(sel);
        if (!await el.isExisting()) continue;
        const loc = await el.getLocation();
        if (loc.y >= 0 && loc.y < screenH) { headerY = loc.y; break; }
      } catch {}
    }

    try {
      const els = await $$('android=new UiSelector().text("See All")');
      let bestEl = null;
      let bestDist = Infinity;
      for (const el of els) {
        try {
          if (!await el.isExisting()) continue;
          const loc = await el.getLocation();
          if (loc.y < 0 || loc.y >= screenH) continue;  // skip off-screen
          const dist = headerY >= 0 ? Math.abs(loc.y - headerY) : loc.y;
          if (dist < bestDist) { bestDist = dist; bestEl = el; }
        } catch {}
      }
      if (bestEl) {
        try { await bestEl.click(); } catch {}
        if (await waitForFullScreen()) return true;
        // Navigated somewhere wrong — recover back to Market Equity
        try { await driver.back(); await browser.pause(600); } catch {}
        await this.goToMarkets();
        await this.tapTab('Equity');
        await browser.pause(400);
      }
    } catch {}

    // Fallback: instance iteration (if $$ returns empty or getLocation fails)
    for (let inst = 0; inst <= 4; inst++) {
      try {
        const el = await $(`android=new UiSelector().text("See All").instance(${inst})`);
        if (!await el.isExisting()) break;
        try { await el.click(); } catch {}
        if (await waitForFullScreen()) return true;
        try { await (await $(SEL.backBtn)).click(); await browser.pause(500); } catch {}
        await this.goToMarkets();
        await this.tapTab('Equity');
        await browser.pause(400);
      } catch {}
    }

    return await isTabVisible();
  }

  // Shared "find a label by text/description and tap it" helper — used by every
  // tab/pill switcher below (Mover tabs, News tabs, HRA cap tabs, SIR bands) that
  // otherwise repeated the same 4-selector fallback chain.
  async _tapLabel(label, pauseMs = 700) {
    for (const sel of [
      `android=new UiSelector().text("${label}")`,
      `android=new UiSelector().textContains("${label}")`,
      `android=new UiSelector().descriptionContains("${label}")`,
      `//*[@content-desc="${label}" or @text="${label}" or contains(@content-desc,"${label}") or contains(@text,"${label}")]`,
    ]) {
      try {
        const el = await $(sel);
        if (await el.isExisting()) { await el.click(); await browser.pause(pauseMs); return true; }
      } catch {}
    }
    return false;
  }

  // Switch a tab on the full Market Movers screen (Top Gainers, Top Losers, 52 Week High…).
  async tapMoverTab(label) { return this._tapLabel(label); }

  // ── Corporate Action ───────────────────────────────────────────────────────

  // Shared "swipe up until one of these keywords appears" helper — used by every
  // scrollTo*() below. Manual swipes only: UiScrollable hangs for ~15s per keyword
  // when the element doesn't exist, making it unusable as a search strategy.
  async _scrollToSection(keywords, initialSwipes) {
    for (let i = 0; i < initialSwipes; i++) { await this.swipeUp(); await browser.pause(300); }
    // Poll: check page source every 1.5 s; nudge scroll every 6 polls.
    for (let i = 0; i < 20; i++) {
      try {
        const src = await driver.getPageSource();
        if (keywords.some(k => src.includes(k))) return true;
      } catch {}
      if (i > 0 && i % 6 === 0) { await this.swipeUp(); await browser.pause(300); }
      await browser.pause(1500);
    }
    return false;
  }

  async scrollToCorporateAction() {
    return this._scrollToSection(
      ['Corporate Action', 'Corporate Actions', 'Ex Date', 'Ex-Date', 'Dividend', 'FINAL', 'INTERIM', 'Bonus', 'Record Date'],
      8
    );
  }

  async getCorporateActionInfo() {
    try {
      const src = await driver.getPageSource();
      return {
        hasDividend:  src.includes('Dividend')  || src.includes('DIVIDEND'),
        hasExDate:    src.includes('Ex Date')   || src.includes('ExDate'),
        hasFinalTag:  src.includes('FINAL')     || src.includes('INTERIM'),
        hasAllFilter: src.includes('ALL')       || src.includes('Bonus') || src.includes('Split'),
      };
    } catch { return {}; }
  }

  // ── High Return Achievers ───────────────────────────────────────────────────

  async scrollToHighReturnAchievers() {
    return this._scrollToSection(
      ['High Return', 'High-Return', 'Achiever', 'Return Achiever', 'Large Cap', 'Mid Cap'],
      10
    );
  }

  async tapHRACapTab(label) {
    // Only scroll if not already near the section
    const src = await driver.getPageSource().catch(() => '');
    const near = src.includes('High Return') || src.includes('Large Cap') || src.includes('Mid Cap');
    if (!near) await this.scrollToHighReturnAchievers();
    return this._tapLabel(label);
  }

  // ── Stock In Range ──────────────────────────────────────────────────────────

  async scrollToStockInRange() {
    return this._scrollToSection(
      ['Stock In Range', 'StockInRange', 'In Range', 'Under 100', '100-500', '500-1000'],
      12
    );
  }

  async tapSIRBand(label) {
    const src = await driver.getPageSource().catch(() => '');
    const near = src.includes('Under 100') || src.includes('100-500') || src.includes('Stock In Range');
    if (!near) await this.scrollToStockInRange();
    return this._tapLabel(label, 600);
  }

  async tapStockInRangeSeeAll() {
    if (!await this.scrollToStockInRange()) return false;
    await browser.pause(400);
    // Stock In Range See All is the last one on the page; use last instance
    try {
      const els = await $$(SEL.seeAllBtn);
      if (els.length > 0) { await els[els.length - 1].click(); await browser.pause(900); return true; }
    } catch {}
    return this.findAndTap(SEL.seeAllBtn, 4000);
  }
}

module.exports = new MarketsPage();
