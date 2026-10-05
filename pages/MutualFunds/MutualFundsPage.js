const BasePage = require('../Login/BasePage');

// Mutual Funds tab strip (Home/Explore/Portfolio/Accounts) and the minimal set of flows the
// Regression suite needs (R59-R62): Home -> High Returns -> first fund -> One Time/Start SIP,
// Explore -> category count -> Equity -> All, Portfolio -> Active SIPs, Accounts. Selectors and
// parsing are ported from the DriverManager-style pages/MutualFundsPage.js (confirmed live on
// device) but rewritten against this stack's WDIO globals ($/$$/browser/driver) since the two
// BasePage contracts are incompatible (see CLAUDE.md) — do not import that file from here.
const SEL = {
  mutualFundsNav: 'android=new UiSelector().description("Mutual Funds")',
  // "Tab 1 of 4"/"Tab 3 of 4"/"Tab 4 of 4" are unique to Home/Portfolio/Accounts respectively -
  // Explore has no stable "Tab N of 4" text of its own (verified live), so it's matched by name.
  homeTab:        'android=new UiSelector().descriptionContains("Tab 1 of 4")',
  exploreTab:     'android=new UiSelector().descriptionContains("Explore")',
  portfolioTab:   'android=new UiSelector().descriptionContains("Tab 3 of 4")',
  accountsTab:    'android=new UiSelector().descriptionContains("Tab 4 of 4")',
  handpickCollectionsLabel: 'android=new UiSelector().description("Handpick Collections")',
  highReturnsTile: 'android=new UiSelector().descriptionContains("High Returns")',
  // "<Name>. Categories: ...%., Double tap to view details." - shared by every fund card.
  fundCard:       'android=new UiSelector().descriptionContains("Double tap to view details")',
  oneTimeButton:  'android=new UiSelector().descriptionContains("One Time button")',
  startSipButton: 'android=new UiSelector().descriptionContains("Start Systematic Investment Plan")',
  categorySolutionsLabel: 'android=new UiSelector().description("Category Solutions")',
  categoryTag:    'android=new UiSelector().descriptionContains("Double tap to view funds under this tag")',
  // "2 Active SIPs ₹1500.00, Double tap to view active plans." on the Portfolio tab - absent
  // entirely when the account has no running SIPs.
  activeSipsTile: 'android=new UiSelector().descriptionContains("Active SIPs")',
  reportsMenuButton: 'android=new UiSelector().description("Reports button., Double tap to go to Reports page")',
};

class MutualFundsPage extends BasePage {

  // Only taps the bottom nav's "Mutual Funds" button when some other section is active.
  async openMutualFunds(timeout = 8000) {
    if (await this.isDisplayed(SEL.homeTab, 1500)) return true;
    return this.findAndTap(SEL.mutualFundsNav, timeout);
  }

  async isHomeTabDisplayed(timeout = 8000) { return this.isDisplayed(SEL.homeTab, timeout); }

  async clickExploreTab(timeout = 5000)   { return this.findAndTap(SEL.exploreTab, timeout); }
  async clickPortfolioTab(timeout = 5000) { return this.findAndTap(SEL.portfolioTab, timeout); }
  async clickAccountsTab(timeout = 5000)  { return this.findAndTap(SEL.accountsTab, timeout); }

  async isReportsMenuVisible(timeout = 8000) { return this.isDisplayed(SEL.reportsMenuButton, timeout); }

  // "High Returns\n12\nFunds" - read before navigating away so it can be compared against the
  // list screen's own "<N> Funds" header.
  async getHighReturnsTileCount(timeout = 5000) {
    try {
      const el = await $(SEL.highReturnsTile);
      await el.waitForDisplayed({ timeout });
      const desc = (await el.getAttribute('content-desc')) || '';
      const m = desc.match(/(\d+)\s+Funds/i);
      return m ? Number(m[1]) : null;
    } catch { return null; }
  }

  async clickHighReturnsCollection(timeout = 5000) { return this.findAndTap(SEL.highReturnsTile, timeout); }

  async getFundListHeaderCount(timeout = 5000) {
    try {
      await this.waitForElement(SEL.fundCard, timeout);
      const src = await driver.getPageSource();
      const descs = [...src.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1]);
      const header = descs.find(d => /^\d+\s+Funds$/i.test(d.trim()));
      return header ? Number(header.match(/\d+/)[0]) : null;
    } catch { return null; }
  }

  async clickFirstFund(timeout = 5000) {
    const el = await this.waitForElement(SEL.fundCard, timeout);
    const desc = (await el.getAttribute('content-desc')) || '';
    const name = desc.split('.')[0].trim();
    await el.click();
    return name;
  }

  async clickOneTimeButton(timeout = 5000) { return this.findAndTap(SEL.oneTimeButton, timeout); }

  // Not every fund supports SIP mode - returns false (without throwing) rather than treating a
  // timeout as a failure, same reasoning as the DriverManager version of this flow.
  async clickStartSipButtonIfApplicable(timeout = 4000) { return this.findAndTap(SEL.startSipButton, timeout); }

  async goBack() {
    try { await driver.back(); } catch {}
    await browser.pause(800);
  }

  // Backs out however many screens deep the fund detail/order-pad flow went, until Home's
  // Handpick Collections section (or its own tab marker) is visible again.
  async navigateBackToHome(maxBackPresses = 6) {
    for (let i = 0; i < maxBackPresses; i++) {
      if (await this.isDisplayed(SEL.homeTab, 500)) return true;
      await this.goBack();
    }
    return this.isDisplayed(SEL.homeTab, 1000);
  }

  // One pass over Explore's "Category Solutions" cards, scrolling down until the visible set
  // stops changing - each card's content-desc reads "<Name> category. <description>., Double tap
  // to show the tags in this category.", so truncating at " category." gives a stable, unique id
  // per category regardless of the free-form text or fund count that follows it.
  async countCategorySolutionsHeaders(maxScrolls = 12) {
    await this.waitForElement(SEL.categorySolutionsLabel, 8000);
    const seen = new Set();
    const capture = async () => {
      const src = await driver.getPageSource();
      const descs = [...src.matchAll(/content-desc="([^"]*category\.[^"]*)"/g)].map(m => m[1]);
      const ids = descs.map(d => d.split(' category.')[0].trim());
      ids.forEach(id => seen.add(id));
      return ids.join('|');
    };
    let previous = await capture();
    for (let i = 0; i < maxScrolls; i++) {
      await this.swipeUp();
      await browser.pause(400);
      const current = await capture();
      if (current === previous) break;
      previous = current;
    }
    return [...seen];
  }

  // Not BasePage.swipeDown() - its drag starts at 20% height, which lands on the fixed
  // indices strip above the Explore list (y~12-21% on the Pixel 4a), so it never scrolled:
  // confirmed live that R60 stayed parked on Debt..Solution Oriented with Equity off-screen.
  async scrollExploreToTop(maxScrolls = 12) {
    for (let i = 0; i < maxScrolls; i++) {
      if (await this.isDisplayed(SEL.categorySolutionsLabel, 500)) return true;
      const { width, height } = await browser.getWindowSize();
      await browser.action('pointer', { parameters: { pointerType: 'touch' } })
        .move({ x: Math.round(width / 2), y: Math.round(height * 0.40) })
        .down().pause(200)
        .move({ x: Math.round(width / 2), y: Math.round(height * 0.85), duration: 600 })
        .up().perform();
      await browser.pause(400);
    }
    return this.isDisplayed(SEL.categorySolutionsLabel, 500);
  }

  // Reads "Available: <N> funds" straight off the (collapsed) category card - the ground truth
  // to compare against the filtered fund list's own "<N> Results" once "All" is selected.
  async getCategoryFundCount(categoryName) {
    try {
      const src = await driver.getPageSource();
      const descs = [...src.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1]);
      const card = descs.find(d => d.startsWith(`${categoryName} category.`));
      if (!card) return null;
      const m = card.match(/Available:\s*(\d+)\s*funds/i);
      return m ? Number(m[1]) : null;
    } catch { return null; }
  }

  // Tapping a category card toggles its tag list open/closed in place - calling this twice on
  // the same category expands then collapses it again.
  async clickCategoryCard(categoryName, timeout = 5000) {
    return this.findAndTap(`android=new UiSelector().descriptionContains("${categoryName} category")`, timeout);
  }

  async getCategoryTags(timeout = 5000) {
    try {
      await this.waitForElement(SEL.categoryTag, timeout);
      const src = await driver.getPageSource();
      const descs = [...src.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1]);
      return descs.filter(d => d.includes('Double tap to view funds under this tag')).map(d => d.split('.')[0].trim());
    } catch { return []; }
  }

  async clickCategoryTag(tagName, timeout = 5000) {
    return this.findAndTap(`android=new UiSelector().description("${tagName}., Double tap to view funds under this tag.")`, timeout);
  }

  async getFilteredResultsCount() {
    try {
      const src = await driver.getPageSource();
      const descs = [...src.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1]);
      const node = descs.find(d => /^\d+\s+Results$/i.test(d.trim()));
      return node ? Number(node.match(/\d+/)[0]) : null;
    } catch { return null; }
  }

  async isActiveSipsTileVisible(timeout = 4000) { return this.isDisplayed(SEL.activeSipsTile, timeout); }

  async getActiveSipsCount(timeout = 5000) {
    try {
      const el = await $(SEL.activeSipsTile);
      await el.waitForDisplayed({ timeout });
      const desc = (await el.getAttribute('content-desc')) || '';
      const m = desc.match(/(\d+)\s+Active SIPs/i);
      return m ? Number(m[1]) : null;
    } catch { return null; }
  }

  async clickActiveSipsTile(timeout = 5000) { return this.findAndTap(SEL.activeSipsTile, timeout); }
}

module.exports = new MutualFundsPage();
