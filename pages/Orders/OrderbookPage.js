const BasePage = require('../Login/BasePage');
const fs = require('fs');
const path = require('path');

// Read-only pass over the Orderbook — never taps Cancel All / Convert to Market /
// Filter, since those mutate real pending orders; this page only validates that they
// are present. Tab counters render as "There are N <Tab> orders, Double Tap to view
// <Tab> orders" (confirmed via a real UI dump), and each order row as one sentence:
// "<BUY|SELL> order for <SYMBOL>. Status: <status>. Quantity: <n> of <m>. Price: <p>,
// Double tap to view order details" — symbol can contain spaces (F&O contracts like
// "GOLD 05OCT FUT") and price can carry Indian comma grouping ("1,47,178.00").
const SEL = {
  tabAll:       '//*[contains(@content-desc,"ALL orders")]',
  tabPending:   '//*[contains(@content-desc,"Pending orders")]',
  tabExecuted:  '//*[contains(@content-desc,"Executed orders")]',
  tabCancelled: '//*[contains(@content-desc,"Cancelled orders")]',

  searchBox:    '//*[contains(@content-desc,"Search") or contains(@hint,"Search")]',
  filterBtn:    '//*[contains(@content-desc,"Filter Orders")]',

  cancelAllBtn:      '//*[contains(@content-desc,"Cancel All") or contains(@text,"Cancel All")]',
  convertToMarketBtn: '//*[contains(@content-desc,"Convert to Market") or contains(@text,"Convert to Market")]',

  emptyState:   '//*[contains(@content-desc,"don\'t have any") or contains(@text,"don\'t have any")]',
};

const TABS = {
  all:       SEL.tabAll,
  pending:   SEL.tabPending,
  executed:  SEL.tabExecuted,
  cancelled: SEL.tabCancelled,
};

class OrderbookPage extends BasePage {

  async isLoaded(timeout = 8000) {
    return this.pollUntil(async () => {
      const [all, pending, executed, cancelled] = await Promise.all([
        this.isDisplayed(SEL.tabAll, 300),
        this.isDisplayed(SEL.tabPending, 300),
        this.isDisplayed(SEL.tabExecuted, 300),
        this.isDisplayed(SEL.tabCancelled, 300),
      ]);
      return all || pending || executed || cancelled;
    }, timeout);
  }

  async isSearchBoxVisible(timeout = 3000) { return this.isDisplayed(SEL.searchBox, timeout); }
  async isFilterButtonVisible(timeout = 3000) { return this.isDisplayed(SEL.filterBtn, timeout); }

  // Parses "There are N <Tab> orders" for every tab at once.
  async getAllTabCounts() {
    try {
      const src = await driver.getPageSource();
      const get = (label) => {
        const m = src.match(new RegExp(`There are (\\d+) ${label} orders`, 'i'));
        return m ? parseInt(m[1], 10) : 0;
      };
      return { all: get('ALL'), pending: get('Pending'), executed: get('Executed'), cancelled: get('Cancelled') };
    } catch { return { all: 0, pending: 0, executed: 0, cancelled: 0 }; }
  }

  async getTabCount(name) {
    const counts = await this.getAllTabCounts();
    return counts[name.toLowerCase()] ?? 0;
  }

  // Some Orderbook tab elements report oversized/incorrect accessibility bounds
  // (a recurring Compose quirk in this app) — a plain .click() can miss, so tap by
  // the element's actual measured center coordinates instead.
  async _coordTap(selector) {
    try {
      const el = await $(selector);
      const loc = await el.getLocation();
      const size = await el.getSize();
      const x = Math.round(loc.x + size.width / 2);
      const y = Math.round(loc.y + size.height / 2);
      await browser.action('pointer', { parameters: { pointerType: 'touch' } })
        .move({ x, y }).down().pause(50).up().perform();
      return true;
    } catch { return false; }
  }

  async tapTab(name) { return this._coordTap(TABS[name.toLowerCase()]); }

  async swipeUp() {
    const { width, height } = await driver.getWindowRect();
    await browser.action('pointer', { parameters: { pointerType: 'touch' } })
      .move({ x: Math.round(width * 0.5), y: Math.round(height * 0.8) }).down()
      .move({ x: Math.round(width * 0.5), y: Math.round(height * 0.3), duration: 400 }).up().perform();
    await browser.pause(400);
  }

  async swipeDown() {
    const { width, height } = await driver.getWindowRect();
    await browser.action('pointer', { parameters: { pointerType: 'touch' } })
      .move({ x: Math.round(width * 0.5), y: Math.round(height * 0.3) }).down()
      .move({ x: Math.round(width * 0.5), y: Math.round(height * 0.8), duration: 400 }).up().perform();
    await browser.pause(400);
  }

  async getOrderRows() {
    try {
      const src  = await driver.getPageSource();
      const rows = [...src.matchAll(/content-desc="([^"]*order for[^"]*)"/gi)].map(m => m[1]);
      return rows.map(raw => {
        // Symbol can contain spaces (F&O contracts like "GOLD 05OCT FUT"), and price
        // can carry Indian comma grouping (e.g. "1,47,178.00") — both confirmed via
        // real UI dump once MCX/CDS orders started appearing in the Orderbook.
        const m = raw.match(/(BUY|SELL) order for ([A-Z0-9&\-\s]+?)\.\s*Status:\s*([A-Za-z]+)\.\s*Quantity:\s*(\d+)\s*of\s*(\d+)\.\s*Price:\s*([\d,]+(?:\.\d+)?)/i);
        return m
          ? { raw, action: m[1], symbol: m[2], status: m[3], filledQty: m[4], totalQty: m[5], price: m[6] }
          : { raw };
      });
    } catch { return []; }
  }

  async isEmptyStateVisible(timeout = 3000) { return this.isDisplayed(SEL.emptyState, timeout); }
  async isCancelAllVisible(timeout = 3000) { return this.isDisplayed(SEL.cancelAllBtn, timeout); }
  async isConvertToMarketVisible(timeout = 3000) { return this.isDisplayed(SEL.convertToMarketBtn, timeout); }

  async dumpPageSource(label) {
    try {
      const src = await driver.getPageSource();
      const dumpPath = path.join(__dirname, '../../ui_dumps', `${label}.xml`);
      fs.mkdirSync(path.dirname(dumpPath), { recursive: true });
      fs.writeFileSync(dumpPath, src);
    } catch {}
  }
}

module.exports = new OrderbookPage();
