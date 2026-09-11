const BasePage = require('../Login/BasePage');

// News screen (hamburger menu -> News). Tabs render the same "<Name>\nTab N of M"
// content-desc pattern used by Watchlist — confirmed via a real UI dump (All, Result,
// Block Deals, Equity, Commentary, + 3 more revealed only after swiping the tab strip).
// Individual news rows are informational only — tapping one does not navigate anywhere
// (confirmed live), so this page only validates the tabs, scroll, and search field.
const SEL = {
  hamburgerBtn: '//*[contains(@content-desc,"Hamburger") or contains(@content-desc,"hamburger")]',
  newsMenuItem: '//*[starts-with(@content-desc,"News") or @text="News"]',

  header:      '//*[@content-desc="News"]',
  allTabs:     '//*[contains(@content-desc,"Tab ") and contains(@content-desc," of ")]',
  searchField: '//android.widget.Button[@hint="Search for stocks, commodity..."]',
  backBtn:     '//*[@content-desc="Back" or contains(@content-desc,"go back")]',
};

class NewsPage extends BasePage {

  async openNews() {
    const hamburgerTapped = await this.findAndTap(SEL.hamburgerBtn, 5000);
    if (!hamburgerTapped) return false;
    await browser.pause(800);
    return this.findAndTap(SEL.newsMenuItem, 5000);
  }

  async isLoaded(timeout = 8000) { return this.isDisplayed(SEL.header, timeout); }

  async closeNews() { return this.findAndTap(SEL.backBtn, 5000); }

  async isSearchFieldVisible(timeout = 3000) { return this.isDisplayed(SEL.searchField, timeout); }

  async scrollList(direction = 'down') {
    const { width, height } = await driver.getWindowRect();
    const yTop    = Math.round(height * 0.3);
    const yBottom = Math.round(height * 0.8);
    const x       = Math.round(width * 0.5);
    const [yStart, yEnd] = direction === 'down' ? [yBottom, yTop] : [yTop, yBottom];
    await browser.action('pointer', { parameters: { pointerType: 'touch' } })
      .move({ x, y: yStart }).down().move({ x, y: yEnd, duration: 400 }).up().perform();
    await browser.pause(400);
  }

  async _swipeTabStrip(direction) {
    const { width, height } = await driver.getWindowRect();
    const y  = Math.round(height * 0.155); // tab strip band, confirmed via UI dump bounds
    const x1 = direction === 'left' ? Math.round(width * 0.85) : Math.round(width * 0.15);
    const x2 = direction === 'left' ? Math.round(width * 0.15) : Math.round(width * 0.85);
    await browser.action('pointer', { parameters: { pointerType: 'touch' } })
      .move({ x: x1, y }).down().move({ x: x2, y, duration: 300 }).up().perform();
    await browser.pause(400);
  }

  async getTotalTabCount() {
    try {
      const src = await driver.getPageSource();
      const m = src.match(/Tab \d+ of (\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    } catch { return 0; }
  }

  // Taps through every tab by position, swiping the strip left to reveal ones off-screen.
  // Returns the ordered list of tab names actually tapped.
  async tapAllTabs() {
    const seen = new Set();
    const total = await this.getTotalTabCount();

    for (let scroll = 0; scroll < 8 && seen.size < total; scroll++) {
      const tabEls = await $$(SEL.allTabs);
      for (const tabEl of tabEls) {
        let desc;
        try { desc = await tabEl.getAttribute('content-desc'); } catch { continue; }
        const name = desc.split(/\n|&#10;/)[0].trim();
        if (seen.has(name)) continue;
        try {
          await tabEl.click();
          await browser.pause(400);
          seen.add(name);
        } catch {}
      }
      if (seen.size >= total) break;
      await this._swipeTabStrip('left');
    }
    return [...seen];
  }
}

module.exports = new NewsPage();
