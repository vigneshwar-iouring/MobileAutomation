// ─────────────────────────────────────────────────────────────────────────────
// HomePage — Globe Capital Dev home screen.
// Identified by the bottom navigation bar with 5 tabs.
// Uses contains() in XPath because tab labels include badge counts at runtime.
// ─────────────────────────────────────────────────────────────────────────────
const BasePage = require('./BasePage');

const SEL = {
  watchlistTab:   '//*[contains(@content-desc, "Watchlist")]',
  marketTab:      '//*[contains(@content-desc, "Market")]',
  ordersTab:      '//*[contains(@content-desc, "Orders")]',
  portfolioTab:   '//*[contains(@content-desc, "Portfolio")]',
  mutualFundsTab: '//*[contains(@content-desc, "Mutual Funds")]',
};

class HomePage extends BasePage {

  // ── Screen readiness ─────────────────────────────────────────────────────────

  // Returns true when the Watchlist tab (default landing tab) is visible.
  async isLoaded(timeout = 10000) {
    return this.isDisplayed(SEL.watchlistTab, timeout);
  }

  // ── Navigation taps ──────────────────────────────────────────────────────────

  async tapWatchlist() {
    await this.click(SEL.watchlistTab);
  }

  async tapMarket() {
    await this.click(SEL.marketTab);
  }

  async tapOrders() {
    await this.click(SEL.ordersTab);
  }

  async tapPortfolio() {
    await this.click(SEL.portfolioTab);
  }

  async tapMutualFunds() {
    await this.click(SEL.mutualFundsTab);
  }
}

module.exports = new HomePage();
