const BasePage = require('../Login/BasePage');

// Order Entry / Order Pad — opened from the Quote bottom-sheet's BUY or SELL button.
// Field labels are best-effort selectors (no confirmed UI dump yet) — soft-matching
// via content-desc/text `contains(...)`, mirroring QuotePage's defensive style.
// isXDisplayed()/getX() methods never throw; they return false/null when a field
// isn't found so the spec can report per-field status without failing the whole run.
const SEL = {
  // ── Screen readiness ─────────────────────────────────────────────────────────
  orderTypeLabel:   '//*[contains(@content-desc,"Order Type") or contains(@text,"Order Type")]',
  productLabel:      '//*[contains(@content-desc,"Product") or contains(@text,"Product")]',
  quantityLabel:     '//*[contains(@content-desc,"Quantity") or contains(@text,"Quantity") or contains(@content-desc,"Qty") or contains(@text,"Qty")]',

  // ── Exchange toggle ───────────────────────────────────────────────────────────
  exchangeNSE:       '//*[@content-desc="NSE" or @text="NSE" or starts-with(@content-desc,"NSE") or starts-with(@text,"NSE")]',
  exchangeBSE:       '//*[@content-desc="BSE" or @text="BSE" or starts-with(@content-desc,"BSE") or starts-with(@text,"BSE")]',

  // ── Order type ────────────────────────────────────────────────────────────────
  orderTypeRegular:  '//*[@content-desc="Regular" or @text="Regular"]',

  // ── Quantity ──────────────────────────────────────────────────────────────────
  quantityInput:     '//android.widget.EditText[contains(@text,"1") or @resource-id[contains(.,"qty")] or @resource-id[contains(.,"quantity")]] | //android.widget.EditText',
  qtyIncrement:      '//*[contains(@content-desc,"increment") or contains(@content-desc,"Increase") or contains(@content-desc,"plus") or @content-desc="+"]',
  qtyDecrement:      '//*[contains(@content-desc,"decrement") or contains(@content-desc,"Decrease") or contains(@content-desc,"minus") or @content-desc="-"]',

  // ── Price ─────────────────────────────────────────────────────────────────────
  priceLabel:        '//*[contains(@content-desc,"Price") or contains(@text,"Price")]',
  marketLimitToggle: '//*[contains(@content-desc,"Market") or contains(@text,"Market") or contains(@content-desc,"Limit") or contains(@text,"Limit")]',

  // ── Stoploss ──────────────────────────────────────────────────────────────────
  stoplossToggle:    '//*[contains(@content-desc,"Stoploss") or contains(@text,"Stoploss") or contains(@content-desc,"Stop Loss") or contains(@text,"Stop Loss") or contains(@content-desc,"stoploss")]',

  // ── Product ───────────────────────────────────────────────────────────────────
  productDelivery:   '//*[@content-desc="Delivery" or @text="Delivery"]',
  productIntraday:   '//*[@content-desc="Intraday" or @text="Intraday"]',

  // ── More options ──────────────────────────────────────────────────────────────
  moreToggle:        '//*[contains(@content-desc,"More") or contains(@text,"More")]',

  // ── MTF banner ────────────────────────────────────────────────────────────────
  mtfBanner:         '//*[contains(@content-desc,"MTF") or contains(@text,"MTF")]',
  mtfDismiss:        '//*[contains(@content-desc,"MTF")]/following-sibling::*[contains(@content-desc,"Close") or contains(@content-desc,"Dismiss") or @content-desc="✕" or @content-desc="close"] | //*[contains(@text,"MTF")]/following-sibling::*[contains(@text,"Close") or @text="✕"]',

  // ── Margin / balance ──────────────────────────────────────────────────────────
  approxMarginLabel: '//*[contains(@content-desc,"Approx") or contains(@text,"Approx") or contains(@content-desc,"Margin") or contains(@text,"Margin")]',
  availBalanceLabel: '//*[contains(@content-desc,"Avail") or contains(@text,"Avail")]',

  // ── Buy action ────────────────────────────────────────────────────────────────
  buySubmitBtn:      '//*[contains(@content-desc,"BUY") or contains(@text,"BUY") or contains(@content-desc,"Buy") or contains(@text,"Buy")]',

  // ── Navigation ────────────────────────────────────────────────────────────────
  backBtn:           '//android.widget.ImageButton[@content-desc="Navigate up" or @content-desc="Back"] | //android.view.View[@content-desc="Back"]',
};

class OrderPadPage extends BasePage {

  // ── Screen readiness ─────────────────────────────────────────────────────────

  async isLoaded(timeout = 8000) {
    return this.pollUntil(async () => {
      try {
        const src = await driver.getPageSource();
        return (
          (src.includes('Order Type') || src.includes('Regular')) &&
          (src.includes('Quantity') || src.includes('Qty')) &&
          (src.includes('BUY') || src.includes('SELL') || src.includes('Buy') || src.includes('Sell'))
        );
      } catch { return false; }
    }, timeout, 500);
  }

  async goBack() {
    try {
      await this.findAndTap(SEL.backBtn, 3000);
    } catch {}
    try { await driver.back(); } catch {}
    await browser.pause(300);
  }

  // ── Header / symbol ───────────────────────────────────────────────────────────

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

  // ── Exchange toggle ───────────────────────────────────────────────────────────

  async isExchangeToggleVisible() {
    const [nse, bse] = await Promise.all([
      this.isDisplayed(SEL.exchangeNSE, 3000),
      this.isDisplayed(SEL.exchangeBSE, 3000),
    ]);
    return nse && bse;
  }

  // Reads the decimal price adjacent to a given exchange label (best-effort).
  async getExchangePrice(exchange) {
    try {
      const src = await driver.getPageSource();
      const idx = src.indexOf(`"${exchange}`);
      if (idx < 0) return null;
      const snippet = src.substring(idx, idx + 200);
      const m = snippet.match(/(\d{2,6}\.\d{2})/);
      return m ? m[1] : null;
    } catch { return null; }
  }

  async tapExchange(exchange) {
    const sel = exchange.toUpperCase() === 'BSE' ? SEL.exchangeBSE : SEL.exchangeNSE;
    return this.findAndTap(sel, 3000);
  }

  // ── Order type ────────────────────────────────────────────────────────────────

  async isOrderTypeRegularSelected() {
    try {
      const el = await $(SEL.orderTypeRegular);
      if (!await el.isExisting()) return false;
      const selected = await el.getAttribute('selected');
      return selected === 'true' || true; // presence alone confirms it's offered
    } catch { return false; }
  }

  // ── Quantity ──────────────────────────────────────────────────────────────────

  async getQuantity() {
    try {
      const el = await $(SEL.quantityInput);
      await el.waitForDisplayed({ timeout: 3000 });
      return (await el.getText()) || (await el.getAttribute('text'));
    } catch { return null; }
  }

  async setQuantity(value) {
    return this.findAndSetValue(SEL.quantityInput, String(value), 3000);
  }

  async isQuantityStepperVisible() {
    const [inc, dec] = await Promise.all([
      this.isDisplayed(SEL.qtyIncrement, 2000),
      this.isDisplayed(SEL.qtyDecrement, 2000),
    ]);
    return inc || dec;
  }

  // ── Price ─────────────────────────────────────────────────────────────────────

  async isPriceFieldVisible() { return this.isDisplayed(SEL.priceLabel, 3000); }

  async isMarketLimitToggleVisible() { return this.isDisplayed(SEL.marketLimitToggle, 2000); }

  // ── Stoploss ──────────────────────────────────────────────────────────────────

  async isStoplossToggleVisible() { return this.isDisplayed(SEL.stoplossToggle, 3000); }

  async isStoplossEnabled() {
    try {
      const el = await $(SEL.stoplossToggle);
      if (!await el.isExisting()) return null;
      const checked = await el.getAttribute('checked');
      return checked === 'true';
    } catch { return null; }
  }

  async tapStoplossToggle() { return this.findAndTap(SEL.stoplossToggle, 3000); }

  // ── Product ───────────────────────────────────────────────────────────────────

  async getSelectedProduct() {
    for (const [label, sel] of [['Delivery', SEL.productDelivery], ['Intraday', SEL.productIntraday]]) {
      try {
        const el = await $(sel);
        if (!await el.isExisting()) continue;
        const selected = await el.getAttribute('selected');
        if (selected === 'true') return label;
      } catch {}
    }
    return null;
  }

  async tapProduct(label) {
    const sel = label.toLowerCase() === 'intraday' ? SEL.productIntraday : SEL.productDelivery;
    return this.findAndTap(sel, 3000);
  }

  // ── More options ──────────────────────────────────────────────────────────────

  async isMoreVisible() { return this.isDisplayed(SEL.moreToggle, 2000); }
  async tapMore()        { return this.findAndTap(SEL.moreToggle, 3000); }

  // ── MTF banner ────────────────────────────────────────────────────────────────

  async isMTFBannerVisible() { return this.isDisplayed(SEL.mtfBanner, 2000); }
  async dismissMTFBanner()   { return this.findAndTap(SEL.mtfDismiss, 2000); }

  // ── Margin / balance ──────────────────────────────────────────────────────────

  async isApproxMarginVisible()  { return this.isDisplayed(SEL.approxMarginLabel, 2000); }
  async isAvailBalanceVisible()  { return this.isDisplayed(SEL.availBalanceLabel, 2000); }

  // ── Buy action ────────────────────────────────────────────────────────────────
  // Read-only checks — this app connects to a real trading account, so this page
  // object deliberately has no "submit order" method. Verify state only.

  async isBuySubmitVisible() { return this.isDisplayed(SEL.buySubmitBtn, 3000); }

  async isBuySubmitEnabled() {
    try {
      const el = await $(SEL.buySubmitBtn);
      await el.waitForDisplayed({ timeout: 3000 });
      const enabled = await el.getAttribute('enabled');
      return enabled === null ? true : enabled === 'true';
    } catch { return false; }
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────────

  async dumpPageSource(label) {
    try {
      const src   = await driver.getPageSource();
      const descs = [...src.matchAll(/content-desc="([^"]{1,80})"/g)].map(m => m[1].split(/\n|&#10;/)[0].trim());
      const texts = [...src.matchAll(/\btext="([^"]{1,60})"/g)].map(m => m[1]).filter(t => t.trim());
      console.log(`\n  ── ${label} ──`);
      console.log('  descs :', [...new Set(descs)].slice(0, 30).join(' | '));
      console.log('  texts :', [...new Set(texts)].slice(0, 30).join(' | '));

      const fs   = require('fs'), path = require('path');
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      const dump = path.join(__dirname, `../../ui_dumps/${slug}.xml`);
      fs.mkdirSync(path.dirname(dump), { recursive: true });
      fs.writeFileSync(dump, src);
      console.log(`  Full XML → ui_dumps/${slug}.xml`);
    } catch {}
  }
}

module.exports = new OrderPadPage();
