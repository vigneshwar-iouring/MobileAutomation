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

  // Expands the bottom sheet to full screen. Tries tapping the "Swipe up for
  // Stock Details" handle first (clickable="true" — a direct tap reliably
  // triggers the same expand animation as an actual swipe), then falls back
  // to dragging the handle upward for sheets where the handle isn't tappable.
  async expandBottomQuotePanel() {
    if (await this.findAndTap(SEL.swipeUpHandle, 3000)) {
      await browser.pause(800);
      return true;
    }
    try {
      const { width, height } = await driver.getWindowRect();
      const x      = Math.round(width / 2);
      const startY = Math.round(height * 0.32);
      const endY   = Math.round(height * 0.10);
      await browser.action('pointer', { parameters: { pointerType: 'touch' } })
        .move({ x, y: startY })
        .down().pause(200)
        .move({ x, y: endY, duration: 800 })
        .up().perform();
      await browser.pause(800);
      return true;
    } catch { return false; }
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
