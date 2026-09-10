const BasePage = require('../Login/BasePage');

// Portfolio (bottom nav) — Holdings and Positions tabs. Holdings rows and their detail
// screen expose rich content-desc sentences (confirmed via a real UI dump); Positions
// has "Today" / "Derivatives" sub-tabs and an explicit empty-state message when there
// are no open positions. SQUARE OFF and BUY MORE on the holding detail screen move
// real money — this page only ever reads them, never taps them.
const SEL = {
  navPortfolio: '//*[@content-desc="Portfolio"]',

  holdingsTab:  '//*[starts-with(@content-desc,"Holdings")]',
  positionsTab: '//*[starts-with(@content-desc,"Positions")]',

  // ── Holdings tab ────────────────────────────────────────────────────────────
  holdingRow:      '//*[contains(@content-desc,"Double tap to view holdings details")]',
  filterHoldings:  '//*[contains(@content-desc,"Filter Holdings")]',
  pledgeBtn:       '//*[@content-desc="Pledge, Double tap to open pledge"]',
  alertsBtn:       '//*[@content-desc="Alerts, Double tap to open alerts"]',

  // ── Holding detail screen ──────────────────────────────────────────────────
  stockDetails:    '//*[contains(@content-desc,"Stock details:")]',
  squareOffBtn:    '//*[@content-desc="SQUARE OFF"]',
  buyMoreBtn:      '//*[@content-desc="BUY MORE"]',

  // ── Positions tab ───────────────────────────────────────────────────────────
  positionsTodayTab:       '//*[contains(@content-desc,"Today") and contains(@content-desc,"tab")]',
  positionsDerivativesTab: '//*[contains(@content-desc,"Derivatives tab")]',
  noPositionsMsg:          '//*[contains(@content-desc,"don\'t have any positions") or contains(@text,"don\'t have any positions")]',
  positionRow:             '//*[contains(@content-desc,"Double tap to view position details")]',
};

class PortfolioPage extends BasePage {

  async openPortfolio() { return this.findAndTap(SEL.navPortfolio, 5000); }
  async isLoaded(timeout = 8000) {
    const [h, p] = await Promise.all([
      this.isDisplayed(SEL.holdingsTab, timeout),
      this.isDisplayed(SEL.positionsTab, timeout),
    ]);
    return h && p;
  }

  // ── Holdings ────────────────────────────────────────────────────────────────

  async getHoldingsCount() {
    try {
      const el = await $(SEL.holdingsTab);
      const desc = await el.getAttribute('content-desc');
      const m = desc.match(/(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    } catch { return 0; }
  }

  // Header summary stats: Current value / Overall P&L / Invested value / Today's P&L.
  async getHoldingsSummary() {
    try {
      const src = await driver.getPageSource();
      const descs = [...src.matchAll(/content-desc="([^"]{1,60})"/g)].map(m => m[1]);
      // Rendered as a 2-column grid — two header labels, then their two value cells
      // on the next row: "Current | Overall P&L | 7.39 | -1.32 (-15.15%) | Invested |
      // Today's P&L | 8.71 | 0.06 (0.81%)" (confirmed via a real dump) — NOT sequential
      // label->value pairs, so values sit 2/3 and 6/7 positions after "Current", not 1.
      const currentIdx = descs.indexOf('Current');
      return {
        currentValue:  currentIdx >= 0 ? descs[currentIdx + 2] : null,
        overallPnl:    currentIdx >= 0 ? descs[currentIdx + 3] : null,
        investedValue: currentIdx >= 0 ? descs[currentIdx + 6] : null,
        todayPnl:      currentIdx >= 0 ? descs[currentIdx + 7] : null,
      };
    } catch { return {}; }
  }

  // Parses each holdings row: "Stock: X.Invested Value: Y.Average price: Z. Quantity: Q."
  async getHoldingsRows() {
    try {
      const src  = await driver.getPageSource();
      const rows = [...src.matchAll(/content-desc="(Stock:[^"]*Double tap to view holdings details)"/g)].map(m => m[1]);
      return rows.map(raw => {
        const symbol   = raw.match(/Stock:\s*([^.]+)\./);
        const invested = raw.match(/Invested Value:\s*([\d,]+\.?\d*)/);
        const avgPrice = raw.match(/Average price:\s*([\d,]+\.?\d*)/);
        const qty      = raw.match(/Quantity:\s*(\d+)/);
        return {
          raw,
          symbol:   symbol ? symbol[1].trim() : null,
          invested: invested ? invested[1] : null,
          avgPrice: avgPrice ? avgPrice[1] : null,
          quantity: qty ? qty[1] : null,
        };
      });
    } catch { return []; }
  }

  async tapHoldingRow(index = 0) {
    const rows = await $$(SEL.holdingRow);
    if (rows.length <= index) return false;
    await rows[index].click();
    return true;
  }

  async isHoldingDetailLoaded(timeout = 5000) { return this.isDisplayed(SEL.stockDetails, timeout); }

  // Parses the discrete fields on a holding's detail screen.
  async getHoldingDetailFields() {
    try {
      const src = await driver.getPageSource();
      const get = (re) => { const m = src.match(re); return m ? m[1].trim() : null; };
      return {
        stockDetails: get(/Stock details:\s*([^".]+)\./),
        // Non-greedy [^"]+?\. would stop at the decimal point inside the number itself
        // (e.g. "-1.32" -> "-1") — anchor on the "(...percent)" suffix instead.
        pnl:          get(/Profit and loss:\s*([-\d.]+ \([-\d.]+ percent\))\./),
        ltp:          get(/Last traded price is\s*([-\d.]+ \([-\d.]+ percent\))\./),
        avgPrice:     get(/Average Price:\s*([\d,]+\.?\d*)/),
        marketValue:  get(/Market Value:\s*([\d,]+\.?\d*)/),
        investedValue: get(/Invested Value:\s*([\d,]+\.?\d*)/),
        daysPnl:      get(/Day's P&amp;L:\s*([\d,.-]+)/),
      };
    } catch { return {}; }
  }

  async isSquareOffVisible(timeout = 3000) { return this.isDisplayed(SEL.squareOffBtn, timeout); }
  async isBuyMoreVisible(timeout = 3000)   { return this.isDisplayed(SEL.buyMoreBtn, timeout); }

  async closeHoldingDetail() { try { await driver.back(); } catch {} }

  // ── Positions ───────────────────────────────────────────────────────────────

  async tapPositionsTab() { return this.findAndTap(SEL.positionsTab, 5000); }

  async getPositionsCount() {
    try {
      const el = await $(SEL.positionsTab);
      const desc = await el.getAttribute('content-desc');
      const m = desc.match(/(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    } catch { return 0; }
  }

  async isNoPositionsVisible(timeout = 3000) { return this.isDisplayed(SEL.noPositionsMsg, timeout); }

  async getPositionRows() {
    try {
      const src  = await driver.getPageSource();
      const rows = [...src.matchAll(/content-desc="([^"]*Double tap to view position details[^"]*)"/g)].map(m => m[1]);
      return rows;
    } catch { return []; }
  }
}

module.exports = new PortfolioPage();
