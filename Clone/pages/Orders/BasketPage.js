const BasePage = require('../Login/BasePage');

// Read-only Basket screen validation. "New Basket" is a confirmed app-side Compose bug
// (unresponsive to all synthetic taps, oversized/wrong accessibility bounds) — not
// automated here, see memory/CLAUDE notes. EXECUTE is deliberately never tapped: it
// would place every item in the basket as a real order.
const SEL = {
  basketTab:     '//*[starts-with(@content-desc,"Basket") and contains(@content-desc,"Tab")]',
  newBasketBtn:  '//*[starts-with(@content-desc,"New Basket")]',
  basketListRow: '//*[contains(@content-desc,"Created on") and contains(@content-desc,"items")]',
  itemCountText: '//*[contains(@content-desc,"items") and contains(@content-desc,"loaded")]',
  basketItem:    '//*[contains(@content-desc,"Double tap to View option")]',
  executeBtn:    '//*[@content-desc="EXECUTE" or @text="EXECUTE"]',
  closeBtn:      '//*[@content-desc="Back" or contains(@content-desc,"go back")]',
};

class BasketPage extends BasePage {

  async tapBasketTab() { return this.findAndTap(SEL.basketTab, 5000); }

  async isNewBasketVisible() { return this.isDisplayed(SEL.newBasketBtn, 3000); }

  // Returns each saved basket's raw row text (name, created date, item count).
  async getBasketListRows() {
    try {
      const src = await driver.getPageSource();
      const rows = [...src.matchAll(/content-desc="([^"]*Created on[^"]*items[^"]*)"/g)].map(m => m[1]);
      return rows;
    } catch { return []; }
  }

  async openBasket(index = 0) {
    const rows = await $$(SEL.basketListRow);
    if (rows.length <= index) return false;
    await rows[index].click();
    return true;
  }

  async isBasketDetailLoaded(timeout = 5000) { return this.isDisplayed(SEL.executeBtn, timeout); }

  // Parses the "N/M items loaded" style counter into { loaded, total }.
  async getItemCount() {
    try {
      const src = await driver.getPageSource();
      const m = src.match(/(\d+)\s*\/\s*(\d+)/);
      if (!m) return null;
      return { loaded: m[1], total: m[2] };
    } catch { return null; }
  }

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

  // Parses each item row: "Side: X ,Name: Y, Quantity: N, Order price: P, Exchange: E,
  // Product type: T, Order type: O, Double tap to View option".
  async getBasketItems() {
    try {
      const src  = await driver.getPageSource();
      const rows = [...src.matchAll(/content-desc="(Side:[^"]*Double tap to View option)"/g)].map(m => m[1]);
      return rows.map(raw => {
        const side       = raw.match(/Side:\s*([a-zA-Z]+)/);
        const name       = raw.match(/Name:\s*([^,]+)/);
        const qty        = raw.match(/Quantity:\s*(\d+)/);
        const price      = raw.match(/Order price:\s*([\d,.]+)/);
        const exchange   = raw.match(/Exchange:\s*([A-Z]+)/);
        const productType = raw.match(/Product type:\s*([a-zA-Z]+)/);
        const orderType  = raw.match(/Order type:\s*([a-zA-Z]+)/);
        return {
          raw,
          side: side ? side[1] : null,
          name: name ? name[1].trim() : null,
          qty: qty ? qty[1] : null,
          price: price ? price[1] : null,
          exchange: exchange ? exchange[1] : null,
          productType: productType ? productType[1] : null,
          orderType: orderType ? orderType[1] : null,
        };
      });
    } catch { return []; }
  }

  async isExecuteVisible(timeout = 3000) { return this.isDisplayed(SEL.executeBtn, timeout); }

  async closeBasketDetail() { return this.findAndTap(SEL.closeBtn, 3000); }
}

module.exports = new BasketPage();
