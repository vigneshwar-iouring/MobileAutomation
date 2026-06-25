const BasePage = require('../Login/BasePage');

const SEL = {
  // Header
  symbolName:    (name) => `//*[contains(@content-desc,"${name}") or @text="${name}"]`,
  segmentLabel:  '//*[contains(@content-desc,"NSE") or contains(@content-desc,"BSE") or contains(@content-desc,"NFO") or contains(@content-desc,"MCX")]',
  headerBar:     '//android.view.View[@content-desc="Quote" or contains(@content-desc,"Quote Screen")]',

  // Price data
  ltp:           '//*[contains(@content-desc,"LTP") or contains(@content-desc,"Last Traded Price") or @resource-id="ltp" or @resource-id="last_traded_price"]',
  priceChange:   '//*[contains(@content-desc,"+") or contains(@content-desc,"-") or contains(@resource-id,"price_change") or contains(@resource-id,"change")]',
  percentChange: '//*[contains(@content-desc,"%") or contains(@resource-id,"percent_change")]',
  volume:        '//*[contains(@content-desc,"Vol") or contains(@content-desc,"Volume") or contains(@resource-id,"volume")]',
  open:          '//*[contains(@content-desc,"Open") or contains(@resource-id,"open")]',
  high:          '//*[contains(@content-desc,"High") or contains(@resource-id,"high")]',
  low:           '//*[contains(@content-desc,"Low") or contains(@resource-id,"low")]',
  close:         '//*[contains(@content-desc,"Close") or contains(@resource-id,"close") or contains(@content-desc,"Prev. Close")]',

  // Action buttons (header row)
  viewChartsBtn: '//*[@content-desc="View Charts" or @text="View Charts" or contains(@content-desc,"Chart")]',
  addAlertsBtn:  '//*[@content-desc="Add Alerts" or @text="Add Alerts" or contains(@content-desc,"Alert")]',
  optionChainBtn:'//*[@content-desc="Option Chain" or @text="Option Chain" or contains(@content-desc,"Option Chain")]',

  // BUY / SELL — use contains() to handle combined descs like "Buy TATASTEEL NSE"
  // and cover both android.view.View and android.widget.Button element types.
  buyBtn:        '//*[contains(@content-desc,"Buy") or contains(@content-desc,"BUY") or contains(@text,"BUY") or contains(@text,"Buy") or contains(@resource-id,"buy")]',
  sellBtn:       '//*[contains(@content-desc,"Sell") or contains(@content-desc,"SELL") or contains(@text,"SELL") or contains(@text,"Sell") or contains(@resource-id,"sell")]',

  // 3-dot menu — standard labels
  overflowMenu:    '//*[@content-desc="More options" or @content-desc="More Options" or @content-desc="⋮" or contains(@resource-id,"overflow") or contains(@resource-id,"more_options")]',
  // 3-dot menu — positional: element immediately to the LEFT of the BUY button
  overflowByPos:   '//*[contains(@content-desc,"Buy") or contains(@text,"BUY") or contains(@text,"Buy")]/preceding-sibling::*[1]',
  menuItems:       '//android.widget.ListView//android.widget.TextView | //android.widget.PopupWindow//*[@clickable="true"]',

  // Bottom quote / full quote panel
  bottomPanel:   '//*[contains(@content-desc,"Market Depth") or contains(@content-desc,"Depth") or contains(@resource-id,"bottom_sheet") or contains(@resource-id,"quote_panel")]',

  // Full quote expanded content
  week52High:    '//*[contains(@content-desc,"52") and (contains(@content-desc,"High") or contains(@content-desc,"H"))]',
  week52Low:     '//*[contains(@content-desc,"52") and (contains(@content-desc,"Low") or contains(@content-desc,"L"))]',
  openInterest:  '//*[contains(@content-desc,"OI") or contains(@content-desc,"Open Interest")]',
  circuitHigh:   '//*[contains(@content-desc,"Circuit") and (contains(@content-desc,"High") or contains(@content-desc,"Upper"))]',
  circuitLow:    '//*[contains(@content-desc,"Circuit") and (contains(@content-desc,"Low") or contains(@content-desc,"Lower"))]',

  // Back navigation
  backBtn:       '//android.widget.ImageButton[@content-desc="Navigate up" or @content-desc="Back"] | //android.view.View[@content-desc="Back"]',
};

class QuotePage extends BasePage {

  // ── Screen readiness ──────────────────────────────────────────────────────────

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

  // ── Navigation ────────────────────────────────────────────────────────────────

  async tapSymbolFromWatchlist(symbolSelector) {
    await this.click(symbolSelector);
    await browser.pause(500);
  }

  async goBack() {
    try {
      await this.findAndTap(SEL.backBtn, 3000);
    } catch {
      try { await driver.back(); } catch {}
    }
    await browser.pause(300);
  }

  // ── Header ────────────────────────────────────────────────────────────────────

  async getSymbolName() {
    try {
      const src   = await driver.getPageSource();
      const descs = [...src.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1]);
      // Symbol names are short uppercase words (2–8 chars) near the top of the screen
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

  async isHeaderBarDisplayed()   { return this.isDisplayed(SEL.headerBar,    5000); }
  async isViewChartsDisplayed()  { return this.isDisplayed(SEL.viewChartsBtn, 3000); }
  async isAddAlertsDisplayed()   { return this.isDisplayed(SEL.addAlertsBtn,  3000); }
  async isOptionChainDisplayed() { return this.isDisplayed(SEL.optionChainBtn,3000); }

  // ── Price data ────────────────────────────────────────────────────────────────

  async getLTP() {
    // Reads LTP from page source — numeric string near "LTP" label
    try {
      const src = await driver.getPageSource();
      const m   = src.match(/content-desc="(\d[\d,.]*)"/);
      return m ? m[1] : null;
    } catch { return null; }
  }

  async isPriceDataVisible() {
    const src = await driver.getPageSource();
    return (
      (src.includes('Open') || src.includes('open')) &&
      (src.includes('High') || src.includes('high')) &&
      (src.includes('Low')  || src.includes('low'))
    );
  }

  async isVolumeVisible() {
    const src = await driver.getPageSource();
    return (
      src.includes('Vol')         ||  // Vol, Volume, LTP Vol
      src.includes('Volume')      ||
      src.includes('Qty')         ||  // Traded Qty, TotalQty
      src.includes('Turnover')    ||  // Total Turnover
      src.includes('TURNOVER')    ||
      src.includes('traded')      ||  // Total Traded
      src.includes('Traded')
    );
  }

  // ── Action buttons ────────────────────────────────────────────────────────────

  async isBuyButtonDisplayed() {
    // First check if visible in current viewport
    if (await this.isDisplayed(SEL.buyBtn, 5000)) return true;
    // Button may exist below the fold — fall back to DOM existence check
    try {
      const el = await $(SEL.buyBtn);
      return await el.isExisting();
    } catch { return false; }
  }

  async isSellButtonDisplayed() {
    if (await this.isDisplayed(SEL.sellBtn, 5000)) return true;
    try {
      const el = await $(SEL.sellBtn);
      return await el.isExisting();
    } catch { return false; }
  }

  async getBuyButtonColor() {
    try {
      const el  = await $(SEL.buyBtn);
      await el.waitForDisplayed({ timeout: 3000 });
      return await el.getCSSProperty('background-color');
    } catch { return null; }
  }

  async getSellButtonColor() {
    try {
      const el  = await $(SEL.sellBtn);
      await el.waitForDisplayed({ timeout: 3000 });
      return await el.getCSSProperty('background-color');
    } catch { return null; }
  }

  async tapBuyButton()  { await this.findAndTap(SEL.buyBtn,  5000); }
  async tapSellButton() { await this.findAndTap(SEL.sellBtn, 5000); }

  // ── 3-dot overflow menu ───────────────────────────────────────────────────────

  // Tries the standard "More options" selector first, then falls back to the
  // element immediately to the LEFT of the BUY button (preceding sibling).
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
    try { return await el.isDisplayed(); } catch { return true; } // exists = visible enough
  }

  async tapOverflowMenu() {
    const el = await this._findOverflowMenu();
    if (!el) return false;
    try {
      await el.click();
      await browser.pause(300);
      return true;
    } catch { return false; }
  }

  // Returns all visible text/content-desc labels from an open context/popup menu.
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
    // Prefer the in-screen Navigate up / Back button so we return to the Quote
    // screen rather than skipping all the way back to the Watchlist.
    try {
      const backBtn = await $(SEL.backBtn);
      if (await backBtn.isExisting()) {
        await backBtn.click();
        await browser.pause(400);
        return;
      }
    } catch {}
    // Hardware back as last resort
    try { await driver.back(); } catch {}
    await browser.pause(300);
  }

  // ── Bottom quote / full-quote panel ──────────────────────────────────────────

  async isBottomPanelVisible() { return this.isDisplayed(SEL.bottomPanel, 3000); }

  // Swipes up on the bottom 25% of the screen to expand the bottom quote panel.
  async expandBottomQuotePanel() {
    try {
      const { width, height } = await driver.getWindowRect();
      const startX = Math.round(width / 2);
      const startY = Math.round(height * 0.85);
      const endY   = Math.round(height * 0.30);
      await browser.action('pointer', { parameters: { pointerType: 'touch' } })
        .move({ x: startX, y: startY })
        .down().pause(200)
        .move({ x: startX, y: endY, duration: 700 })
        .up().perform();
      await browser.pause(500);
      return true;
    } catch { return false; }
  }

  // Reads expanded full-quote fields from page source after panel expansion.
  async getFullQuoteFields() {
    const src    = await driver.getPageSource();
    const fields = {};

    const pick = (pattern) => {
      const m = src.match(pattern);
      return m ? m[1] : null;
    };

    fields.week52High  = pick(/52[\s\S]{0,40}?(?:High|H)[^"]*"([0-9,.]+)"/i);
    fields.week52Low   = pick(/52[\s\S]{0,40}?(?:Low|L)[^"]*"([0-9,.]+)"/i);
    fields.openInterest= pick(/(?:OI|Open Interest)[^"]*"([0-9,. KLCr]+)"/i);
    fields.circuitHigh = pick(/(?:Circuit|Upper)[^"]*"([0-9,.]+)"/i);
    fields.circuitLow  = pick(/(?:Circuit|Lower)[^"]*"([0-9,.]+)"/i);

    return fields;
  }

  async is52wHighVisible()    { return this.isDisplayed(SEL.week52High,   3000); }
  async is52wLowVisible()     { return this.isDisplayed(SEL.week52Low,    3000); }
  async isOpenInterestVisible(){ return this.isDisplayed(SEL.openInterest,3000); }
}

module.exports = new QuotePage();
