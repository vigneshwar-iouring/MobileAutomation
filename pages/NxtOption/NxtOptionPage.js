const BasePage = require('../Login/BasePage');

// NxtOption is an inline accordion inside the hamburger drawer, not a separate screen —
// tapping it expands "Strategy Builder / IV Analysis / OI Analysis" right there in the
// same list (confirmed via a real UI dump). OI Analysis sits just below the fold, so it
// needs a small scroll to reveal; Strategy Builder and IV Analysis are visible right
// after expanding. Device `back` from any of the three sub-screens returns straight to
// Watchlist, not just to the drawer — also confirmed live.
const SEL = {
  hamburgerBtn: '//*[contains(@content-desc,"Hamburger") or contains(@content-desc,"hamburger")]',
  nxtOptionItem: '//*[starts-with(@content-desc,"NxtOption")]',

  strategyBuilderItem: '//*[@content-desc="Strategy Builder"]',
  ivAnalysisItem:      '//*[@content-desc="IV Analysis"]',
  oiAnalysisItem:      '//*[@content-desc="OI Analysis"]',

  strategyBuilderHeader: '//*[contains(@content-desc,"Predefined")]',
  ivAnalysisHeader:      '//*[contains(@content-desc,"IV Charts")]',
  oiAnalysisHeader:      '//*[contains(@content-desc,"PCR Chart")]',
};

class NxtOptionPage extends BasePage {

  // Opens the hamburger drawer and expands the NxtOption accordion. Returns true once
  // its sub-items are visible.
  async openNxtOptionMenu() {
    const hamburgerTapped = await this.findAndTap(SEL.hamburgerBtn, 5000);
    if (!hamburgerTapped) return false;
    await browser.pause(800);
    const expanded = await this.findAndTap(SEL.nxtOptionItem, 5000);
    if (!expanded) return false;
    await browser.pause(600);
    return this.isDisplayed(SEL.strategyBuilderItem, 3000);
  }

  async tapStrategyBuilder() { return this.findAndTap(SEL.strategyBuilderItem, 5000); }
  async isStrategyBuilderLoaded(timeout = 8000) { return this.isDisplayed(SEL.strategyBuilderHeader, timeout); }

  async tapIvAnalysis() { return this.findAndTap(SEL.ivAnalysisItem, 5000); }
  async isIvAnalysisLoaded(timeout = 8000) { return this.isDisplayed(SEL.ivAnalysisHeader, timeout); }

  // OI Analysis is below the fold right after expanding — scroll the drawer into view
  // first if it isn't already visible.
  async tapOiAnalysis() {
    let oi = await $(SEL.oiAnalysisItem);
    if (!(await oi.isExisting())) {
      const { width, height } = await driver.getWindowRect();
      await browser.action('pointer', { parameters: { pointerType: 'touch' } })
        .move({ x: Math.round(width * 0.5), y: Math.round(height * 0.75) }).down()
        .move({ x: Math.round(width * 0.5), y: Math.round(height * 0.55), duration: 500 }).up().perform();
      await browser.pause(500);
      oi = await $(SEL.oiAnalysisItem);
    }
    if (!(await oi.isExisting())) return false;
    await oi.click();
    return true;
  }

  async isOiAnalysisLoaded(timeout = 8000) { return this.isDisplayed(SEL.oiAnalysisHeader, timeout); }

  async goBack() { try { await driver.back(); } catch {} }
}

module.exports = new NxtOptionPage();
