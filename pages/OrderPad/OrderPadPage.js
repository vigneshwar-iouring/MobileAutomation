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
  // The screen has exactly two EditTexts (confirmed via a real UI dump): quantity first,
  // price second - positional, since neither carries a resource-id or distinguishing
  // content-desc of its own.
  priceInput:        '(//android.widget.EditText)[2]',
  // Distinct from the quantity row's own "Swap, Double tap to switch between Amount and
  // Quantity." control, which shares the generic word "Swap" but is a different toggle.
  marketLimitSwapBtn: '//*[@content-desc="Swap, Double tap to switch between Market and Limit"]',

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

  // ── Surveillance warning (shown for some symbols before BUY submit proceeds) ──
  // No confirmed UI dump yet (not triggered by the symbols used so far) - best-effort
  // soft-matching, same defensive style as the rest of this file's not-yet-confirmed SEL.
  surveillanceWarning:   '//*[contains(@content-desc,"Surveillance") or contains(@text,"Surveillance") or contains(@content-desc,"GSM") or contains(@content-desc,"ASM")]',
  proceedSurveillanceBtn: '//*[contains(@content-desc,"PROCEED") or contains(@text,"PROCEED") or contains(@content-desc,"Proceed") or contains(@text,"Proceed")]',

  // ── Buy action ────────────────────────────────────────────────────────────────
  // Exact match - confirmed live that a "contains" match here also caught the OTHER
  // Buy/Sell control on this screen ("Swap Buy Sell, Double tap to Swap Between Buy and
  // Sell"), which sits earlier in the tree and so was tapped first, silently toggling
  // the pad to Sell mode instead of submitting - the actual button's content-desc is the
  // bare word "BUY" with nothing else.
  buySubmitBtn:      '//*[@content-desc="BUY" or @text="BUY"]',

  // ── Navigation ────────────────────────────────────────────────────────────────
  backBtn:           '//android.widget.ImageButton[@content-desc="Navigate up" or @content-desc="Back"] | //android.view.View[@content-desc="Back"]',

  // ── Confirmation popup (shown after tapping BUY) ─────────────────────────────
  // Confirmed via a real UI dump: "Confirmation Preview" heading, then bare Symbol and
  // Exchange values (no label of their own), then "Label" / ":" / "Value" triples for
  // Order Action, Quantity, Price, Product Type, Order Type, Validity, then the
  // "CONFIRMATION" button - the one that actually places the order.
  confirmationHeading: '//*[@content-desc="Confirmation Preview"]',
  applicableChargesLink: '//*[@content-desc="Applicable Charges"]',
  confirmOrderBtn:     '//*[@content-desc="CONFIRMATION"]',

  // ── Applicable Charges panel ─────────────────────────────────────────────────
  chargesHeading:    '//*[@content-desc="Brokerage and Charges"]',
  chargesDisclaimer: '//*[starts-with(@content-desc,"Disclaimer")]',

  // ── DPR (Daily Price Range / circuit) guard ──────────────────────────────────
  dprError: '//*[starts-with(@content-desc,"DPR Range")]',
};

// Every line the Applicable Charges panel must list (as given by the user) - matched
// case-insensitively by label only, values are not checked.
const CHARGE_LABELS = [
  'Order Value',
  'Total Brokerage & charges',
  'Brokerage',
  'Securities Transaction Tax',
  'Transaction Charges',
  'GST',
  'Stamp Duty',
  'SEBI Charges',
  'DP Charges',
  'Clearing Charges',
];

// Page source attributes are XML-escaped ("&amp;" etc.) - needed for "&" in the labels.
const decodeXml = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#10;/g, '\n').replace(/&amp;/g, '&');

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

  // Confirmed live across every instrument type (equities, F&O options, currency and
  // commodity futures) that the contract/symbol name is always the very first
  // content-desc on the OrderPad screen, immediately followed by "Back, Double tap to go
  // back". The previous simple-all-caps-code regex (meant to skip non-symbol UI text)
  // rejected multi-word contract names like "GBPUSD 29DEC FUT" or "NIFTY 15SEP 25100 CE"
  // outright, then fell through to matching the single-segment exchange label instead
  // (e.g. "CDS", "MCX") - silently returning the wrong "symbol" for single-segment
  // instruments while still working by accident for plain equities.
  async getSymbolName() {
    try {
      const src   = await driver.getPageSource();
      const descs = [...src.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1]);
      return descs[0] ? descs[0].split(/\n|&#10;/)[0].trim() : null;
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

  // Which segment(s) this symbol is offered on - a dual-listed equity shows an NSE/BSE
  // toggle ("NSE \nExchange is NSE and the last traded price is ...", "BSE \n..."), while
  // a derivative contract (NFO/BFO/CDS/MCX) shows just its own single segment instead of
  // a toggle. Matched generically on the first line of each content-desc against the
  // known segment codes, rather than assuming the NSE/BSE toggle is always present.
  async getVisibleSegments() {
    try {
      const src = await driver.getPageSource();
      const descs = [...src.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1]);
      const known = ['NSE', 'BSE', 'NFO', 'BFO', 'CDS', 'MCX'];
      const found = new Set();
      for (const d of descs) {
        const first = d.split(/\n|&#10;/)[0].trim();
        if (known.includes(first)) found.add(first);
      }
      return [...found];
    } catch { return []; }
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

  async getPrice() {
    try {
      const el = await $(SEL.priceInput);
      await el.waitForDisplayed({ timeout: 3000 });
      return (await el.getText()) || (await el.getAttribute('text'));
    } catch { return null; }
  }

  // Uses real key events (hardware backspace + a real typed key sequence), NOT
  // clearValue()/setValue() (findAndSetValue's approach, and this method's own previous
  // implementation). Confirmed live via the Confirmation popup's own displayed price
  // that clearValue()/setValue() only update the accessibility layer's exposed text -
  // the field visually/programmatically reads back the new value and stays there
  // indefinitely, but the app's real order-entry state never changes, so BUY silently
  // submitted at the untouched original (near-market) price every time. Real key events
  // route through the same input path a physical keyboard would, which this app's
  // Price field DOES listen to.
  async setPrice(value) {
    try {
      const el = await $(SEL.priceInput);
      await el.waitForDisplayed({ timeout: 3000 });
      await el.click();
      await browser.pause(200);
      // 15 backspaces comfortably covers every price length seen so far (bare digits
      // up to Indian-comma-grouped 6-7 figure commodity prices).
      for (let i = 0; i < 15; i++) {
        await driver.pressKeyCode(67);
      }
      await browser.pause(200);
      await driver.keys(String(value).split(''));
      await browser.pause(300);
      return true;
    } catch { return false; }
  }

  // The "Price (Limit)" / "Price (Market)" label carries the current mode in parens.
  async getPriceMode() {
    try {
      const el = await $(SEL.priceLabel);
      const desc = await el.getAttribute('content-desc');
      const m = desc && desc.match(/\(([^)]+)\)/);
      return m ? m[1] : null;
    } catch { return null; }
  }

  async tapMarketLimitSwap() { return this.findAndTap(SEL.marketLimitSwapBtn, 3000); }

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
  // tapBuySubmit/tapConfirmOrder DO place a real order on this real trading account -
  // explicitly authorized for the Regression suite's R24/R27/R33-R38, which each
  // control price/segment carefully (DPR-bounce to the lower circuit, or dismiss
  // before confirming) rather than submit blind. Do not call these outside that
  // reviewed flow.

  async isBuySubmitVisible() { return this.isDisplayed(SEL.buySubmitBtn, 3000); }

  async isBuySubmitEnabled() {
    try {
      const el = await $(SEL.buySubmitBtn);
      await el.waitForDisplayed({ timeout: 3000 });
      const enabled = await el.getAttribute('enabled');
      return enabled === null ? true : enabled === 'true';
    } catch { return false; }
  }

  async tapBuySubmit() { return this.findAndTap(SEL.buySubmitBtn, 3000); }

  // ── Surveillance warning ──────────────────────────────────────────────────────

  async isSurveillanceWarningVisible(timeout = 3000) { return this.isDisplayed(SEL.surveillanceWarning, timeout); }

  async getSurveillanceMessage() {
    try { return await (await $(SEL.surveillanceWarning)).getAttribute('content-desc'); } catch { return null; }
  }

  async tapProceedSurveillance() { return this.findAndTap(SEL.proceedSurveillanceBtn, 3000); }

  // ── Confirmation popup ────────────────────────────────────────────────────────
  // Shown after tapping BUY with an in-range price. tapConfirmOrder() is the one call
  // in this whole page object that actually places the order.

  async isConfirmationPopupVisible(timeout = 5000) { return this.isDisplayed(SEL.confirmationHeading, timeout); }

  // Bare Symbol/Exchange values followed by "Label" / ":" / "Value" triples (Order
  // Action, Quantity, Price, Product Type, Order Type, Validity) - confirmed via a real
  // UI dump of the popup's content-desc order.
  // Label/value pairs are found by scanning for the bare ":" separator itself, rather
  // than assuming a fixed position - confirmed live that F&O contracts (NFO/BFO/CDS/
  // MCX) insert an extra expiry-date header item ("15 SEP 2026") between Exchange and
  // Order Action that plain equities don't have, which silently broke the previous
  // fixed-offset-of-3 parsing for every field on those contracts (including Price -
  // the one field the real-order safety check in the spec depends on).
  async getConfirmationDetails() {
    try {
      const src = await driver.getPageSource();
      const descs = [...src.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1]);
      const startIdx = descs.indexOf('Confirmation Preview');
      if (startIdx === -1) return {};
      const endIdx = descs.indexOf('CONFIRMATION');
      const body = descs
        .slice(startIdx + 1, endIdx === -1 ? undefined : endIdx)
        .filter(d => d !== 'Applicable Charges');

      const details = {};
      for (let i = 1; i < body.length - 1; i++) {
        if (body[i] === ':') details[body[i - 1]] = body[i + 1];
      }

      // Everything before the first label:value pair is the header - Symbol is always
      // first; Exchange is a known code that can sit anywhere in that header (directly
      // after Symbol for equities, or after an expiry-date item for F&O contracts).
      const firstLabelIdx = body.findIndex((d, idx) => body[idx + 1] === ':');
      const header = firstLabelIdx > 0 ? body.slice(0, firstLabelIdx) : [];
      if (header.length) details.Symbol = header[0];
      const knownExchanges = ['NSE', 'BSE', 'NFO', 'BFO', 'CDS', 'MCX'];
      details.Exchange = header.find(d => knownExchanges.includes(d)) || null;

      return details;
    } catch { return {}; }
  }

  // Raw ordered content-desc list of the popup - used for logging/dumping, not parsing.
  async getConfirmationText() {
    try {
      const src = await driver.getPageSource();
      const descs = [...src.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1]);
      const startIdx = descs.indexOf('Confirmation Preview');
      if (startIdx === -1) return [];
      const endIdx = descs.indexOf('CONFIRMATION');
      return descs.slice(startIdx, endIdx === -1 ? undefined : endIdx + 1);
    } catch { return []; }
  }

  // Dismisses via the hardware back action - confirmed live that this closes the popup
  // without confirming (lands back on the OrderPad screen), unlike tapping CONFIRMATION.
  async dismissConfirmationPopup() {
    try { await driver.back(); await browser.pause(300); return true; } catch { return false; }
  }

  async tapConfirmOrder() { return this.findAndTap(SEL.confirmOrderBtn, 3000); }

  // ── Applicable Charges panel ──────────────────────────────────────────────────

  async tapApplicableCharges() { return this.findAndTap(SEL.applicableChargesLink, 3000); }

  async isChargesPanelVisible(timeout = 5000) { return this.isDisplayed(SEL.chargesHeading, timeout); }

  async getChargesHeader() {
    try { return await (await $(SEL.chargesHeading)).getAttribute('content-desc'); } catch { return null; }
  }

  // Whatever sits between the header and the disclaimer - a real breakdown (Brokerage,
  // STT, GST, ...) most of the time, but confirmed live that this can also show
  // "Something went wrong" instead - see getChargesPanelStatus() for how R26 fails that.
  async getChargesBreakdown(src = null) {
    try {
      src = src || await driver.getPageSource();
      const descs = [...src.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1]);
      const startIdx = descs.indexOf('Brokerage and Charges');
      if (startIdx === -1) return [];
      const endIdx = descs.findIndex(d => d.startsWith('Disclaimer'));
      return descs
        .slice(startIdx + 1, endIdx === -1 ? undefined : endIdx)
        .filter(d => d !== 'Scrim');
    } catch { return []; }
  }

  // Pass/fail status of the Applicable Charges panel, read from a single page source so
  // the breakdown and any (transient) toast are captured at the same instant. Charge
  // values are deliberately not checked - only that every line in CHARGE_LABELS is
  // listed and no error is shown, either inline (confirmed live: "Order Value | 12.08 |
  // Something went wrong") or as a toast.
  async getChargesPanelStatus() {
    let src = '';
    try { src = await driver.getPageSource(); } catch { /* treated as empty below */ }
    const breakdown = await this.getChargesBreakdown(src);
    const isError = d => /something went wrong|error|failed|unable to|try again|not available|no data/i.test(d);
    const norm = s => decodeXml(s).replace(/\s+/g, ' ').trim().toLowerCase();

    const inlineErrors = breakdown.filter(isError).map(decodeXml);
    const toasts = [...src.matchAll(/<android\.widget\.Toast[^>]*\btext="([^"]+)"/g)].map(m => decodeXml(m[1]));
    const errors = [...inlineErrors, ...toasts.map(t => `toast: ${t}`)];

    // A label counts as listed if a line equals it or starts with it followed by a
    // non-letter (so "Brokerage" isn't satisfied by "Total Brokerage & charges").
    const lines = breakdown.map(norm);
    const isListed = label => {
      const l = norm(label);
      return lines.some(d => d === l || (d.startsWith(l) && !/[a-z]/.test(d[l.length])));
    };
    const charges = CHARGE_LABELS.filter(isListed);
    const missing = CHARGE_LABELS.filter(l => !isListed(l));

    const causes = [];
    if (errors.length) causes.push(`error message shown (${errors.join(' | ')})`);
    if (missing.length) causes.push(`charges not listed: ${missing.join(', ')}`);
    return { breakdown: breakdown.map(decodeXml), charges, missing, errors,
      isValid: causes.length === 0, failureCause: causes.join('; ') };
  }

  async getChargesDisclaimer() {
    try { return await (await $(SEL.chargesDisclaimer)).getAttribute('content-desc'); } catch { return null; }
  }

  // Hardware back - confirmed live that this returns to the still-open confirmation
  // popup underneath, rather than closing the whole OrderPad flow.
  async closeChargesPanel() {
    try { await driver.back(); await browser.pause(300); return true; } catch { return false; }
  }

  // ── DPR (circuit) guard ───────────────────────────────────────────────────────
  // Submitting a price outside the daily price range shows "DPR Range: <lower> - <upper>"
  // in place of the confirmation popup (confirmed live) - used by R27 and the real
  // order-placement tests (R33-R38) to read the lower circuit price to retry at.

  async isDprErrorVisible(timeout = 5000) { return this.isDisplayed(SEL.dprError, timeout); }

  async getDprErrorMessage() {
    try { return await (await $(SEL.dprError)).getAttribute('content-desc'); } catch { return null; }
  }

  parseDprRange(message) {
    if (!message) return null;
    const m = message.match(/DPR Range:\s*([\d.]+)\s*-\s*([\d.]+)/);
    return m ? { lower: m[1], upper: m[2] } : null;
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
