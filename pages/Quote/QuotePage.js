const BasePage = require('../Login/BasePage');

const SEL = {
  segmentLabel:   '//*[contains(@content-desc,"NSE") or contains(@content-desc,"BSE") or contains(@content-desc,"NFO") or contains(@content-desc,"MCX")]',
  viewChartsBtn:  '//*[@content-desc="View Charts" or @text="View Charts" or contains(@content-desc,"Chart")]',
  addAlertsBtn:   '//*[@content-desc="Add Alerts" or @text="Add Alerts" or contains(@content-desc,"Alert")]',
  optionChainBtn: '//*[@content-desc="Option Chain" or @text="Option Chain" or contains(@content-desc,"Option Chain")]',
  // Exact match first — a broad contains(@content-desc,"Buy") also matches the
  // market-depth "Total Buy Qty" label, which sits earlier in the DOM and is not
  // clickable, so $(sel) would silently grab that dead element instead of the
  // real BUY button (confirmed via diagnostic: clickable=false vs clickable=true).
  buyBtn:         '//*[@content-desc="BUY" or @text="BUY" or @content-desc="Buy" or @text="Buy" or (@clickable="true" and contains(@resource-id,"buy"))]',
  sellBtn:        '//*[@content-desc="SELL" or @text="SELL" or @content-desc="Sell" or @text="Sell" or (@clickable="true" and contains(@resource-id,"sell"))]',
  overflowMenu:   '//*[@content-desc="More options" or @content-desc="More Options" or @content-desc="⋮" or contains(@resource-id,"overflow") or contains(@resource-id,"more_options")]',
  overflowByPos:  '//*[@content-desc="BUY" or @text="BUY"]/preceding-sibling::*[1]',
  backBtn:        '//android.widget.ImageButton[@content-desc="Navigate up" or @content-desc="Back"] | //android.view.View[@content-desc="Back"]',
  closeBtn:       '//*[@content-desc="Close" or @text="Close" or contains(@content-desc,"Close")] | //android.widget.ImageButton[@content-desc="Navigate up" or @content-desc="Back"]',
  eventBtn:       '//*[@content-desc="Event" or @text="Event" or contains(@content-desc,"Event")]',
  seeAllBtn:      '//*[@content-desc="See All" or @text="See All" or contains(@content-desc,"See All") or contains(@text,"See All")]',
  swipeUpHandle:  '//*[@content-desc="Swipe up for Stock Details"]',
  // Header card of the Quote sheet: "Stock IDEA, NSE. Last traded price 13.05. ..." - used
  // only as a swipe start point when the handle itself isn't exposed.
  stockSummary:   '//*[starts-with(@content-desc,"Stock ") or contains(@content-desc,"Swipe up to explore quote details")]',
};

class QuotePage extends BasePage {

  // ── Screen readiness ─────────────────────────────────────────────────────────

  async isLoaded(timeout = 8000) {
    return this.pollUntil(async () => {
      const src = await driver.getPageSource();
      return (
        src.includes('Buy') || src.includes('BUY') ||
        src.includes('Sell') || src.includes('SELL') ||
        src.includes('LTP') || src.includes('Last Traded')
      );
    }, timeout, 500);
  }

  // ── Navigation ───────────────────────────────────────────────────────────────

  async goBack() {
    try {
      await this.findAndTap(SEL.backBtn, 3000);
    } catch {
      try { await driver.back(); } catch {}
    }
    await browser.pause(300);
  }

  // ── Header ───────────────────────────────────────────────────────────────────

  async getSymbolName() {
    try {
      const src   = await driver.getPageSource();
      const descs = [...src.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1]);
      const candidate = descs.find(d =>
        /^[A-Z]{2,10}(\s*&\s*[A-Z]{2,10})?$/.test(d.split(/\n|&#10;/)[0].trim())
      );
      return candidate ? candidate.split(/\n|&#10;/)[0].trim() : null;
    } catch { return null; }
  }

  // Exchange this Quote screen is showing, from the header card - "Stock RTNPOWER, BSE.
  // Last traded price ..." -> "BSE". Circuit limits differ per exchange (confirmed live:
  // RTNPOWER NSE 5.40 - 8.10 vs BSE 5.41 - 8.11), so callers must check this before
  // trusting getCircuitLimits() for a given exchange.
  async getExchange() {
    try {
      const src = await driver.getPageSource();
      const m = src.match(/content-desc="Stock [^",]+, ([A-Z]+)\./);
      return m ? m[1] : null;
    } catch { return null; }
  }

  // Taps the NSE/BSE toggle under the symbol name in the expanded Quote header, then waits
  // for the header to report the new exchange. The toggle has no node of its own - it's
  // merged into the header card ("Stock RTNPOWER, BSE. Last traded price ...", confirmed
  // live via r35_quote_expanded dump + screenshot), so it's tapped at a fixed dp offset
  // from the card's top-left, measured on the Pixel 4a (440dpi, card at [42,150]: NSE
  // centre (181,263), BSE (283,263)) and scaled by display density for other devices.
  // The header's "Stock X, EX." text and the circuit limits both update on the tap
  // (confirmed live through Appium; a raw `adb shell uiautomator dump` showed them stale).
  // Returns { tapped, exchange } - exchange is what the header reads after the tap.
  async tapExchange(exchange, timeout = 5000) {
    const TOGGLE_DP = { NSE: { dx: 50.5, dy: 41 }, BSE: { dx: 87.6, dy: 41 } }[exchange];
    let card = null;
    try {
      const src = await driver.getPageSource();
      const m = src.match(/content-desc="Stock [^"]*"[^>]*?bounds="\[(\d+),(\d+)\]\[\d+,\d+\]"/);
      if (m) card = { x: Number(m[1]), y: Number(m[2]) };
    } catch {}
    if (!TOGGLE_DP || !card) return { tapped: false, exchange: await this.getExchange() };

    let scale = 2.75;
    try { scale = (await driver.getDisplayDensity()) / 160; } catch {}
    await browser.action('pointer', { parameters: { pointerType: 'touch' } })
      .move({ x: Math.round(card.x + TOGGLE_DP.dx * scale), y: Math.round(card.y + TOGGLE_DP.dy * scale) })
      .down().pause(80).up().perform();

    let current = null;
    await this.pollUntil(async () => (current = await this.getExchange()) === exchange, timeout, 500);
    return { tapped: true, exchange: current };
  }

  async getSegment() {
    try {
      return await this.findAndGetAttribute(SEL.segmentLabel, 'content-desc', 3000);
    } catch { return null; }
  }

  async getLTP() {
    try {
      const src   = await driver.getPageSource();
      const descs = [...src.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1].trim());
      return descs.find(d => /^\d{2,6}\.\d{2}$/.test(d)) || null;
    } catch { return null; }
  }

  async isViewChartsDisplayed()  { return this.isDisplayed(SEL.viewChartsBtn,  3000); }
  async isAddAlertsDisplayed()   { return this.isDisplayed(SEL.addAlertsBtn,   3000); }
  async isOptionChainDisplayed() { return this.isDisplayed(SEL.optionChainBtn, 3000); }

  async tapViewCharts() {
    try { await this.findAndTap(SEL.viewChartsBtn, 5000); await browser.pause(1500); return true; } catch { return false; }
  }

  async isChartScreenLoaded(timeout = 6000) {
    return this.pollUntil(async () => {
      const src = await driver.getPageSource();
      return src.includes('Chart') || src.includes('chart') ||
             src.includes('Candlestick') || src.includes('Line') ||
             src.includes('1D') || src.includes('1W') || src.includes('1M');
    }, timeout, 500);
  }

  async tapCloseChart() {
    // Use system back — most reliable way to close a chart screen on Android
    try { await driver.back(); await browser.pause(1000); return true; } catch { return false; }
  }

  async tapAddAlerts() {
    try { await this.findAndTap(SEL.addAlertsBtn, 5000); await browser.pause(1500); return true; } catch { return false; }
  }

  async getAlertScreenHeader() {
    try {
      const src = await driver.getPageSource();
      for (const h of ['Set Alert', 'Create Alert', 'Add Alert', 'Price Alert', 'Alert']) {
        if (src.includes(h)) return h;
      }
      return null;
    } catch { return null; }
  }

  async tapOptionChain() {
    try { await this.findAndTap(SEL.optionChainBtn, 5000); await browser.pause(1500); return true; } catch { return false; }
  }

  async getOptionChainHeader() {
    try {
      const src = await driver.getPageSource();
      // Try known header patterns; fall back to any toolbar title text
      const candidates = [
        'Option Chain', 'Options Chain', 'OC', 'Option',
      ];
      for (const h of candidates) {
        if (src.includes(h)) return h;
      }
      // Grab first content-desc that looks like a screen title (3-40 chars, no numbers-only)
      const descs = [...src.matchAll(/content-desc="([^"]{3,40})"/g)]
        .map(m => m[1].split(/\n|&#10;/)[0].trim())
        .filter(d => !/^\d+(\.\d+)?%?$/.test(d) && !/^(NSE|BSE|NFO|MCX|BUY|SELL)$/.test(d));
      return descs[0] || null;
    } catch { return null; }
  }

  // ── Tabs (visible after full-screen expansion) ───────────────────────────────

  async getTabsStatus() {
    const src = await driver.getPageSource();
    return {
      overview:     src.includes('Overview'),
      futures:      src.includes('Futures') || src.includes('Fut'),
      fundamentals: src.includes('Fundamentals') || src.includes('Fund'),
      technical:    src.includes('Technical') || src.includes('Tech'),
    };
  }

  // ── OHLC ─────────────────────────────────────────────────────────────────────

  async getOHLCStatus() {
    const src = await driver.getPageSource();
    return {
      prevClose: src.includes('Pr. Close') || src.includes('Prev. Close'),
      open:      src.includes('Open'),
      high:      src.includes('High'),
      low:       src.includes('Low'),
    };
  }

  async isPriceDataVisible() {
    const src = await driver.getPageSource();
    return (
      (src.includes('Open') || src.includes('open')) &&
      (src.includes('High') || src.includes('high')) &&
      (src.includes('Low')  || src.includes('low'))
    );
  }

  // ── Market Depth ─────────────────────────────────────────────────────────────

  async isMarketDepthVisible() {
    const src = await driver.getPageSource();
    return (src.includes('Bid') || src.includes('Total Buy')) &&
           (src.includes('Ask') || src.includes('Total Sell'));
  }

  async isVolumeVisible() {
    const src = await driver.getPageSource();
    return src.includes('Vol') || src.includes('Volume') || src.includes('Qty') || src.includes('Traded');
  }

  // ── Volume / ATP (visible after scrolling down) ──────────────────────────────

  async getVolumeATPStatus() {
    const src = await driver.getPageSource();
    return {
      volume: src.includes('Vol') || src.includes('Volume') || src.includes('Turnover') ||
              src.includes('Traded') || src.includes('Qty'),
      atp:    src.includes('ATP') || src.includes('Avg') || src.includes('Average') ||
              src.includes('Trade Price') || src.includes('Traded Price'),
    };
  }

  // ── Circuit limits (visible after scrolling down) ────────────────────────────

  async getCircuitStatus() {
    const src = await driver.getPageSource();
    const hasCircuit = src.includes('Circuit') || src.includes('circuit');
    return {
      lower: hasCircuit || src.includes('Lower') || src.includes('lower'),
      upper: hasCircuit || src.includes('Upper') || src.includes('upper'),
    };
  }

  // Confirmed via a real UI dump: one single content-desc carries both values -
  // "Circuit limits. Lower circuit 13.41. Upper circuit 16.39., Displays the lower and
  // upper circuit limits." - not two separate attributes, which is what
  // getFullQuoteFields()'s circuitHigh/circuitLow regexes actually expect (and so don't
  // match this real format). Used to place a real order at a genuine in-range price
  // (the lower circuit) instead of guessing at an out-of-range one and hoping for a
  // DPR rejection to bounce off of - confirmed live that at least one segment/symbol
  // doesn't reject an out-of-range price at all, silently substituting near-market
  // price instead.
  async getCircuitLimits() {
    try {
      const src = await driver.getPageSource();
      const m = src.match(/Circuit limits\. Lower circuit ([\d.]+)\. Upper circuit ([\d.]+)/);
      return m ? { lower: m[1], upper: m[2] } : null;
    } catch { return null; }
  }

  // ── 52-Week (visible after scrolling down) ───────────────────────────────────

  async get52WeekStatus() {
    const src = await driver.getPageSource();
    const has52 = src.includes('52W') || src.includes('52 W') || src.includes('52-W') || src.includes('52week') ||
                  (src.includes('52') && (src.includes('Week') || src.includes('week')));
    return { low: has52, high: has52 };
  }

  // ── Last Traded Qty / Time (visible after scrolling down) ────────────────────

  async getLastTradedStatus() {
    const src = await driver.getPageSource();
    return {
      qty:  src.includes('LTQ') || src.includes('Last Trade') || src.includes('Last Traded'),
      time: src.includes('LTT') || src.includes('Last Trade') || src.includes('Last Traded') ||
            /\d{2}:\d{2}/.test(src),
    };
  }

  // Returns all visible text/desc keywords for debugging scroll position
  async debugVisibleKeywords(keywords) {
    try {
      const src = await driver.getPageSource();
      return keywords.filter(k => src.includes(k));
    } catch { return []; }
  }

  // ── Action buttons ───────────────────────────────────────────────────────────

  async _isActionButtonDisplayed(sel) {
    if (await this.isDisplayed(sel, 5000)) return true;
    try { return await (await $(sel)).isExisting(); } catch { return false; }
  }

  async isBuyButtonDisplayed()  { return this._isActionButtonDisplayed(SEL.buyBtn);  }
  async isSellButtonDisplayed() { return this._isActionButtonDisplayed(SEL.sellBtn); }

  // Neither plain .click() nor a W3C pointer action reliably triggers navigation
  // on this custom-drawn button — try native mobile: clickGesture first (works
  // for the same class of stubborn element elsewhere, e.g. WatchlistPage's
  // long-press), then fall back to a W3C pointer tap.
  async _coordTap(sel) {
    let el;
    try {
      el = await $(sel);
      await el.waitForDisplayed({ timeout: 5000 });
    } catch { return false; }

    try {
      await driver.execute('mobile: clickGesture', { elementId: el.elementId });
      return true;
    } catch {}

    try {
      const loc  = await el.getLocation();
      const size = await el.getSize();
      await browser.action('pointer', { parameters: { pointerType: 'touch' } })
        .move({ x: Math.round(loc.x + size.width / 2), y: Math.round(loc.y + size.height / 2) })
        .down().pause(80).up().perform();
      return true;
    } catch { return false; }
  }

  async tapBuyButton()  { return this._coordTap(SEL.buyBtn); }
  async tapSellButton() { return this._coordTap(SEL.sellBtn); }

  // ── 3-dot overflow menu ──────────────────────────────────────────────────────

  async _findOverflowMenu() {
    for (const sel of [SEL.overflowMenu, SEL.overflowByPos]) {
      try {
        const el = await $(sel);
        if (await el.isExisting()) return el;
      } catch {}
    }
    return null;
  }

  async isOverflowMenuDisplayed() {
    const el = await this._findOverflowMenu();
    if (!el) return false;
    try { return await el.isDisplayed(); } catch { return true; }
  }

  async tapOverflowMenu() {
    const el = await this._findOverflowMenu();
    if (!el) return false;
    try { await el.click(); await browser.pause(300); return true; } catch { return false; }
  }

  async getMenuItems() {
    try {
      await browser.pause(200);
      const src   = await driver.getPageSource();
      const texts = [...src.matchAll(/\btext="([^"]{2,40})"/g)]
        .map(m => m[1].trim())
        .filter(t => t && !/^\d+$/.test(t));
      const descs = [...src.matchAll(/content-desc="([^"]{2,40})"/g)]
        .map(m => m[1].split(/\n|&#10;/)[0].trim())
        .filter(d => d && d.length >= 2 && d.length <= 40 && !/Tab \d/.test(d));
      return [...new Set([...texts, ...descs])];
    } catch { return []; }
  }

  async dismissMenu() {
    try {
      const backBtn = await $(SEL.backBtn);
      if (await backBtn.isExisting()) {
        await backBtn.click();
        await browser.pause(400);
        return;
      }
    } catch {}
    try { await driver.back(); } catch {}
    await browser.pause(300);
  }

  // ── Corporate Actions ────────────────────────────────────────────────────────

  async tapEventButton() {
    try { await this.findAndTap(SEL.eventBtn, 5000); await browser.pause(1000); return true; } catch { return false; }
  }

  async tapSeeAll() {
    try { await this.findAndTap(SEL.seeAllBtn, 3000); await browser.pause(800); return true; } catch { return false; }
  }

  async getCorporateActionItems() {
    try {
      const src   = await driver.getPageSource();
      const descs = [...src.matchAll(/content-desc="([^"]{4,80})"/g)]
        .map(m => m[1].split(/\n|&#10;/)[0].trim())
        .filter(d => !/^(Overview|Futures|Fundamentals|Technical|SELL|BUY|NSE|BSE|NFO|MCX|Tab \d)$/.test(d));
      const texts = [...src.matchAll(/\btext="([^"]{4,80})"/g)].map(m => m[1].trim());
      return [...new Set([...descs, ...texts])].slice(0, 15);
    } catch { return []; }
  }

  // ── Key Stats ────────────────────────────────────────────────────────────────

  async scrollToKeyStats() {
    try {
      const { width, height } = await driver.getWindowRect();
      const x      = Math.round(width / 2);
      const startY = Math.round(height * 0.75);
      const endY   = Math.round(height * 0.35);
      for (let i = 0; i < 6; i++) {
        await browser.action('pointer', { parameters: { pointerType: 'touch' } })
          .move({ x, y: startY })
          .down().pause(100)
          .move({ x, y: endY, duration: 500 })
          .up().perform();
        await browser.pause(400);
        const src = await driver.getPageSource();
        if (src.includes('Standalone') || src.includes('Consolidated') || src.includes('Key Stat')) break;
      }
      return true;
    } catch { return false; }
  }

  async tapKeyStatMode(mode) {
    const sel = `//*[@content-desc="${mode}" or @text="${mode}" or contains(@content-desc,"${mode}") or contains(@text,"${mode}")]`;
    try { await this.findAndTap(sel, 5000); await browser.pause(600); return true; } catch { return false; }
  }

  async getKeyStatValues() {
    try {
      const src   = await driver.getPageSource();
      const descs = [...src.matchAll(/content-desc="([^"]{2,60})"/g)]
        .map(m => m[1].split(/\n|&#10;/)[0].trim())
        .filter(d => !/^(Overview|Futures|Fundamentals|Technical|SELL|BUY|NSE|BSE|Tab \d|See All|Event|View Chart|Add Alert|Option Chain)$/.test(d));
      return [...new Set(descs)].slice(0, 25);
    } catch { return []; }
  }

  // ── Symbol classification helpers ────────────────────────────────────────────

  // Returns 'Equity' for NSE/BSE, 'Future & Options' for everything else (NFO, BFO, CDS, MCX …)
  classifySegment(segment) {
    const s = (segment || '').toUpperCase().trim();
    return (s === 'NSE' || s === 'BSE') ? 'Equity' : 'Future & Options';
  }

  async isOptionChainPresent() {
    return this.isDisplayed(SEL.optionChainBtn, 3000);
  }

  async getFnOSpecificFields() {
    const src = await driver.getPageSource();
    return {
      expiry:  src.includes('Expiry') || /\d{1,2}\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(src),
      strike:  src.includes('Strike') || src.includes(' CE') || src.includes(' PE'),
      lotSize: src.includes('Lot') || src.includes('Market Lot') || src.includes('Lot Size'),
      oi:      src.includes(' OI') || src.includes('Open Interest') || src.includes('Open Int'),
    };
  }

  // ── Bottom sheet gestures ────────────────────────────────────────────────────

  // Tapping a symbol/index opens the Quote screen as a half-height bottom sheet; swiping
  // it up expands it to full screen. Confirmed via before/after page sources (IDEA, NSE,
  // 1080x2340): collapsed, the "Stock IDEA, NSE. Last traded price..." summary card sits
  // at y≈789-992 with no tab strip; expanded, it moves to y≈150 and the
  // "Overview / Futures / Fundamentals / Technicals" tab strip appears - so the Overview
  // tab is the expanded-state signal.
  async isQuoteExpanded(timeout = 0) {
    const check = async () => {
      try {
        const src = await driver.getPageSource();
        return /content-desc="Overview(?:&#10;|\n)Tab 1 of \d+"/.test(src);
      } catch { return false; }
    };
    return timeout ? this.pollUntil(check, timeout, 400) : check();
  }

  // Real upward swipe on the sheet: starts on the "Swipe up for Stock Details" handle (or
  // the summary card / ~40% height if the handle isn't exposed) and drags to near the top.
  async swipeUpQuoteSheet() {
    const { width, height } = await driver.getWindowRect();
    let x = Math.round(width / 2);
    let startY = Math.round(height * 0.40);
    for (const sel of [SEL.swipeUpHandle, SEL.stockSummary]) {
      try {
        const el = await $(sel);
        if (!(await el.isExisting())) continue;
        const loc  = await el.getLocation();
        const size = await el.getSize();
        x      = Math.round(loc.x + size.width / 2);
        startY = Math.round(loc.y + size.height / 2);
        break;
      } catch {}
    }
    await browser.action('pointer', { parameters: { pointerType: 'touch' } })
      .move({ x, y: startY })
      .down().pause(150)
      .move({ x, y: Math.round(height * 0.08), duration: 600 })
      .up().perform();
    await browser.pause(800);
    return startY;
  }

  // Expands the Quote sheet by swiping up (two attempts), verifying the expanded state each
  // time. Tapping the handle is only a last-resort fallback, and is logged as such so a
  // swipe that stops working is visible rather than silently papered over.
  // Returns { expanded, method: 'already' | 'swipe' | 'tap-fallback' | 'failed' }.
  async expandBottomQuotePanel() {
    if (await this.isQuoteExpanded()) return { expanded: true, method: 'already' };
    for (let attempt = 1; attempt <= 2; attempt++) {
      let startY = null;
      try { startY = await this.swipeUpQuoteSheet(); } catch {}
      if (await this.isQuoteExpanded(2500)) {
        console.log(`  ℹ  Quote screen expanded by swipe-up (attempt ${attempt}, from y=${startY})`);
        return { expanded: true, method: 'swipe' };
      }
    }
    console.log('  ⚠  Swipe-up did not expand the Quote screen — falling back to tapping "Swipe up for Stock Details"');
    if (await this.findAndTap(SEL.swipeUpHandle, 2000) && await this.isQuoteExpanded(2500)) {
      return { expanded: true, method: 'tap-fallback' };
    }
    return { expanded: false, method: 'failed' };
  }

  // Scrolls DOWN inside the full-screen Quote view (below tab bar ~38%, above footer ~78%).
  async scrollToRevealFullQuote() {
    try {
      const { width, height } = await driver.getWindowRect();
      const x      = Math.round(width / 2);
      const startY = Math.round(height * 0.78);
      const endY   = Math.round(height * 0.38);
      for (let i = 0; i < 3; i++) {
        await browser.action('pointer', { parameters: { pointerType: 'touch' } })
          .move({ x, y: startY })
          .down().pause(120)
          .move({ x, y: endY, duration: 500 })
          .up().perform();
        await browser.pause(400);
      }
      return true;
    } catch { return false; }
  }

  async getFullQuoteFields() {
    const src  = await driver.getPageSource();
    const pick = (re) => { const m = src.match(re); return m ? m[1] : null; };
    return {
      week52High:   pick(/52[\s\S]{0,40}?(?:High|H)[^"]*"([0-9,.]+)"/i),
      week52Low:    pick(/52[\s\S]{0,40}?(?:Low|L)[^"]*"([0-9,.]+)"/i),
      openInterest: pick(/(?:OI|Open Interest)[^"]*"([0-9,. KLCr]+)"/i),
      circuitHigh:  pick(/(?:Circuit|Upper)[^"]*"([0-9,.]+)"/i),
      circuitLow:   pick(/(?:Circuit|Lower)[^"]*"([0-9,.]+)"/i),
    };
  }

  // Scrolls content back to top by swiping DOWN within the scrollable band.
  async scrollToTop() {
    try {
      const { width, height } = await driver.getWindowRect();
      const x      = Math.round(width / 2);
      const startY = Math.round(height * 0.35);
      const endY   = Math.round(height * 0.80);
      for (let i = 0; i < 4; i++) {
        await browser.action('pointer', { parameters: { pointerType: 'touch' } })
          .move({ x, y: startY })
          .down().pause(120)
          .move({ x, y: endY, duration: 500 })
          .up().perform();
        await browser.pause(400);
        const src = await driver.getPageSource();
        if ((src.includes('Buy') || src.includes('BUY')) &&
            (src.includes('View Chart') || src.includes('Add Alert'))) break;
      }
      return true;
    } catch { return false; }
  }
}

module.exports = new QuotePage();
