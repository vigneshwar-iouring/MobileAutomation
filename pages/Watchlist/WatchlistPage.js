const BasePage = require('../Login/BasePage');

// Device layout (Pixel 4a, 1080×2340):
//   Indices strip: y=289–506 (~21%)
//   Tab strip:     y=506–641 (~25%)  ← swipe target
//   Add (+) btn:   [1003,553][1050,595]  center ≈ (1026, 574)  y ≈ 24.5%
//   Search box:    y=688–815
//   Stock list:    y=815+
const SEL = {
  searchBox:       '//android.widget.EditText[contains(@hint,"Add or search stocks")]',
  title:           '//android.view.View[@content-desc="Watchlist"]',

  // Individual watchlist tab Views — content-desc "Name\nTab N of M"
  allTabs:         '//android.view.View[contains(@content-desc,"Tab ") and contains(@content-desc," of ")]',
  tab:             (n) => `//android.view.View[contains(@content-desc,"Watchlist${n}") and contains(@content-desc,"Tab ${n} of ")]`,
  tabByName:       (name) => `//android.view.View[contains(@content-desc,"${name}") and contains(@content-desc,"Tab ") and contains(@content-desc," of ")]`,

  stockItems:      '//android.widget.ScrollView//android.view.View[contains(@content-desc,"NSE") or contains(@content-desc,"BSE")]',
  stockByName:     (name) => `//android.widget.ScrollView//android.view.View[starts-with(@content-desc,"${name}")]`,

  navWatchlist:    '//android.widget.ImageView[contains(@content-desc,"Watchlist") and contains(@content-desc,"Tab 1 of 5")]',
  navMarket:       '//android.widget.ImageView[contains(@content-desc,"Market") and contains(@content-desc,"Tab 2 of 5")]',
  navOrders:       '//android.widget.ImageView[contains(@content-desc,"Orders") and contains(@content-desc,"Tab 3 of 5")]',
  navPortfolio:    '//android.widget.ImageView[contains(@content-desc,"Portfolio") and contains(@content-desc,"Tab 4 of 5")]',
  navMutualFunds:  '//android.widget.ImageView[contains(@content-desc,"Mutual Funds") and contains(@content-desc,"Tab 5 of 5")]',

  // Add (+) button: clickable ImageView inside the tab-strip container View,
  // to the right of the HorizontalScrollView that holds the watchlist tabs.
  addWatchlistBtn: '//android.view.View[.//android.widget.HorizontalScrollView[.//android.view.View[contains(@content-desc,"Tab ")]]]/android.widget.ImageView[@clickable="true"]',

  watchlistInput:  '//android.widget.EditText[1]',
  createBtn:       '//android.widget.Button[contains(@text,"CREATE") or contains(@text,"SAVE") or contains(@text,"ADD")]',
  cancelBtn:       '//android.widget.Button[contains(@text,"CANCEL") or contains(@text,"Cancel")]',
  dialogError:     '//android.widget.TextView[contains(@text,"already") or contains(@text,"required") or contains(@text,"limit") or contains(@text,"maximum") or contains(@text,"characters") or contains(@text,"empty") or contains(@text,"invalid")]',
  renameOption:    '//android.view.View[@content-desc="Rename"]',
  deleteOption:    '//*[contains(@content-desc,"Delete") or contains(@text,"Delete") or contains(@content-desc,"Remove Watchlist") or contains(@text,"Remove Watchlist")]',
  deleteConfirm:   '//android.widget.Button[contains(@text,"DELETE") or contains(@text,"Yes") or contains(@text,"OK")]',

  removeStock:     '//android.view.View[contains(@content-desc,"Remove")]',
  addToWatchlist:  '//*[(@content-desc="+" or contains(@content-desc,"Add to watchlist")) and @clickable="true"]',
  doneBtn:         '//*[@content-desc="Done" or @text="Done" or @text="DONE"]',
  cancelSearchBtn: '//android.view.View[@content-desc="Cancel"]',

  emptyState:      '//android.view.View[contains(@content-desc,"No stocks") or contains(@content-desc,"Add stocks to") or contains(@content-desc,"empty")]',

  // ANR dialog — "Wait" button selector tries multiple approaches (varies by Android version)
  anrWait: [
    '//*[@resource-id="android:id/aerr_wait"]',
    '//android.widget.Button[contains(@text,"Wait")]',
    '//android.widget.Button[contains(@text,"wait")]',
    '//*[@resource-id="android:id/button1"][contains(@text,"Wait") or contains(@text,"OK")]',
  ],
};

class WatchlistPage extends BasePage {

  async isLoaded(timeout = 10000) {
    return this.isDisplayed(SEL.searchBox, timeout);
  }

  async isTitleDisplayed() {
    return this.isDisplayed(SEL.title, 3000);
  }

  // Reads visible indices from page source — faster than querying individual elements.
  async getVisibleIndices() {
    try {
      const src   = await driver.getPageSource();
      const descs = [...src.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1]);
      const names = descs
        .filter(d =>
          (d.includes('\n') || d.includes('&#10;')) &&
          !d.includes('Tab') && !d.includes('NSE') && !d.includes('BSE') &&
          !d.includes('Watchlist') && !d.includes('Mutual') &&
          /^[A-Z]/.test(d) && /\d/.test(d)
        )
        .map(d => d.split(/\n|&#10;/)[0].trim());
      return [...new Set(names)];
    } catch { return []; }
  }

  // Number of watchlist tabs currently in the viewport.
  async getTabCount() {
    return (await $$(SEL.allTabs)).length;
  }

  // Total number of watchlists — parsed from page source (no element round-trips).
  async getTotalTabCount() {
    try {
      const src = await driver.getPageSource();
      const m = src.match(/content-desc="[^"]*(?:&#10;|\n)Tab \d+ of (\d+)"/);
      return m ? parseInt(m[1]) : 0;
    } catch { return 0; }
  }

  async isTabActive(n, timeout = 5000) {
    return this.pollUntil(async () => {
      try {
        return (await (await $(SEL.tab(n))).getAttribute('selected')) === 'true';
      } catch { return false; }
    }, timeout, 300);
  }

  async tapTab(n) {
    await this._dismissANRIfPresent();
    await this.click(SEL.tab(n));
    await browser.pause(100);
  }

  async isSearchBoxDisplayed() {
    return this.isDisplayed(SEL.searchBox, 5000);
  }

  async searchStock(query) {
    await this.click(SEL.searchBox);
    await browser.pause(100);
    await (await $(SEL.searchBox)).setValue(String(query));
    await browser.pause(300);
  }

  async isSearchResultVisible(stockName, exchange) {
    const sel = `//android.view.View[contains(@content-desc,"${stockName}") and contains(@content-desc,"${exchange}")]`;
    return this.isDisplayed(sel, 5000);
  }

  async exitSearchMode() {
    await this.hideKeyboard();
    await browser.pause(100);
    // Tap "Cancel" if visible — the correct search-dismiss button in this app
    if (await this.isDisplayed(SEL.cancelSearchBtn, 1200)) {
      try { await this.click(SEL.cancelSearchBtn); await browser.pause(200); return; } catch {}
    }
    if (!await this.isDisplayed(SEL.navWatchlist, 1500)) {
      try { await driver.back(); } catch {}
      await browser.pause(200);
    }
  }

  // Returns immediately if already on watchlist; navigates back via bottom nav otherwise.
  async goToWatchlist() {
    await this._dismissANRIfPresent();
    if (await this.isLoaded(2000)) return;
    let navVisible = await this.isDisplayed(SEL.navWatchlist, 1500);
    if (!navVisible) {
      try { await driver.back(); } catch {}
      await browser.pause(500);
      await this._dismissANRIfPresent();
      navVisible = await this.isDisplayed(SEL.navWatchlist, 2000);
    }
    if (navVisible) {
      await this.click(SEL.navWatchlist);
      await browser.pause(300);
    }
  }

  async clearSearch() {
    try { await (await $(SEL.searchBox)).clearValue(); } catch {}
    await this.exitSearchMode();
  }

  async getStockCount() {
    return (await $$(SEL.stockItems)).length;
  }

  async tapNavWatchlist()   { await this.click(SEL.navWatchlist);   await browser.pause(100); }
  async tapNavMarket()      { await this.click(SEL.navMarket);      await browser.pause(100); }
  async tapNavOrders()      { await this.click(SEL.navOrders);      await browser.pause(100); }
  async tapNavPortfolio()   { await this.click(SEL.navPortfolio);   await browser.pause(100); }
  async tapNavMutualFunds() { await this.click(SEL.navMutualFunds); await browser.pause(100); }

  async tapSearchBox() {
    await this.click(SEL.searchBox);
    await browser.pause(300);
  }

  async tapTabByName(name) { await this.click(SEL.tabByName(name)); await browser.pause(100); }

  // Long-press a named tab using coordinate-based approach (avoids stale-element errors).
  async longPressTabByName(name) {
    const el   = await $(SEL.tabByName(name));
    await el.waitForDisplayed({ timeout: 5000 });
    const loc  = await el.getLocation();
    const size = await el.getSize();
    await browser.action('pointer', { parameters: { pointerType: 'touch' } })
      .move({ x: Math.round(loc.x + size.width / 2), y: Math.round(loc.y + size.height / 2) })
      .down().pause(800).up().perform();
    await browser.pause(100);
  }

  // Long-press a tab by number using coordinate-based approach.
  async longPressTab(n) {
    const el   = await $(SEL.tab(n));
    await el.waitForDisplayed({ timeout: 5000 });
    const loc  = await el.getLocation();
    const size = await el.getSize();
    await browser.action('pointer', { parameters: { pointerType: 'touch' } })
      .move({ x: Math.round(loc.x + size.width / 2), y: Math.round(loc.y + size.height / 2) })
      .down().pause(800).up().perform();
    await browser.pause(200);
  }

  // Scrolls the tab strip back to the leftmost position (makes Watchlist1 visible).
  async scrollToFirstTab() {
    for (let i = 0; i < 7; i++) {
      try { if (await (await $(SEL.tab(1))).isDisplayed()) return; } catch {}
      await this._swipeTabStrip('left');
    }
  }

  async areAllNavTabsDisplayed() {
    const navSels = [
      '//android.widget.ImageView[contains(@content-desc,"Watchlist") and contains(@content-desc,"Tab 1 of 5")]',
      '//android.widget.ImageView[contains(@content-desc,"Market") and contains(@content-desc,"Tab 2 of 5")]',
      '//android.widget.ImageView[contains(@content-desc,"Orders") and contains(@content-desc,"Tab 3 of 5")]',
      '//android.widget.ImageView[contains(@content-desc,"Portfolio") and contains(@content-desc,"Tab 4 of 5")]',
      '//android.widget.ImageView[contains(@content-desc,"Mutual Funds") and contains(@content-desc,"Tab 5 of 5")]',
    ];
    const results = await Promise.all(navSels.map(s => this.isDisplayed(s, 3000)));
    return results.every(Boolean);
  }

  // Dismiss ANR "Globe Capital Dev isn't responding" dialog.
  // Tries multiple selectors because resource-id varies by Android version.
  async _dismissANRIfPresent() {
    for (const sel of SEL.anrWait) {
      try {
        const btn = await $(sel);
        if (await btn.isExisting()) {
          await btn.click();
          await browser.pause(2000);
          return true;
        }
      } catch {}
    }
    return false;
  }

  // Horizontal swipe across the tab strip (y ≈ 25% of screen — centre of tab row).
  async _swipeTabStrip(direction) {
    try {
      const { width, height } = await driver.getWindowRect();
      const y  = Math.round(height * 0.25);
      const x1 = direction === 'right' ? Math.round(width * 0.80) : Math.round(width * 0.20);
      const x2 = direction === 'right' ? Math.round(width * 0.20) : Math.round(width * 0.80);
      await browser.action('pointer', { parameters: { pointerType: 'touch' } })
        .move({ x: x1, y }).down().move({ x: x2, y, duration: 300 }).up().perform();
      await browser.pause(150);
    } catch {}
  }

  // If at the 11-tab limit, deletes one WatchlistN tab to free a slot.
  // Scrolls left first so WatchlistN tabs are in view.
  // Only long-presses tabs whose CENTER is within the visible screen width.
  async ensureWatchlistSlotAvailable() {
    const total = await this.getTotalTabCount();
    if (total === 0 || total < 11) return true;

    // Dismiss any lingering ANR before we start
    await this._dismissANRIfPresent();
    await this.goToWatchlist();

    // WatchlistN tabs are at the start — scroll left
    await this.scrollToFirstTab();

    const { width, height } = await driver.getWindowRect();

    for (let attempt = 0; attempt < 6; attempt++) {
      await this._dismissANRIfPresent();

      // Get fresh element list; extract the last VISIBLE (on-screen) WatchlistN tab element + coords
      let coords  = null;
      let tabElem = null;
      try {
        const tabs = await $$(SEL.allTabs);
        for (let i = tabs.length - 1; i >= 0; i--) {
          try {
            const desc = await tabs[i].getAttribute('content-desc');
            if (!/^Watchlist\d/.test(desc || '')) continue;
            const loc  = await tabs[i].getLocation();
            const size = await tabs[i].getSize();
            const cx   = Math.round(loc.x + size.width / 2);
            const cy   = Math.round(loc.y + size.height / 2);
            // Skip tabs whose center is outside the physical screen
            if (cx < 10 || cx > width - 10 || cy < 10 || cy > height - 10) continue;
            coords  = { x: cx, y: cy };
            tabElem = tabs[i];
            break;
          } catch {}
        }
      } catch {}

      if (!coords) {
        // No on-screen WatchlistN tab — scroll right and retry
        await this._swipeTabStrip('right');
        continue;
      }

      try {
        // Primary: native longClickGesture (more reliable than pointer action for tab strips)
        let longPressed = false;
        try {
          await driver.execute('mobile: longClickGesture', {
            elementId: tabElem.elementId,
            duration:  1500,
          });
          longPressed = true;
        } catch {}

        // Fallback: W3C pointer action with extended duration
        if (!longPressed) {
          await browser.action('pointer', { parameters: { pointerType: 'touch' } })
            .move({ x: coords.x, y: coords.y }).down().pause(1500).up().perform();
        }

        await browser.pause(600); // allow context menu to appear
        await this._dismissANRIfPresent();

        if (await this.findAndTap(SEL.deleteOption, 2000)) {
          await this.findAndTap(SEL.deleteConfirm, 2000);
          await browser.pause(500);
          return true;
        }

        // Log what is actually on-screen after the long-press (for diagnosis)
        try {
          const src   = await driver.getPageSource();
          const texts = [...src.matchAll(/\btext="([^"]{1,40})"/g)].map(m => m[1]).filter(t => t.trim());
          const descs = [...src.matchAll(/content-desc="([^"]{1,60})"/g)].map(m => m[1].split(/\n|&#10;/)[0]);
          console.log(`  ensureWatchlist menu: texts=${texts.join('|')} | descs=${descs.slice(0, 10).join('|')}`);
        } catch {}

        // Dismiss any open context menu before next attempt
        if (await this.isDisplayed(SEL.renameOption, 500)) {
          try { await driver.back(); } catch {}
          await browser.pause(200);
        }
      } catch (e) {
        console.log('  ensureWatchlistSlotAvailable:', e.message);
        await this._dismissANRIfPresent();
      }
    }
    console.log('  ensureWatchlistSlotAvailable: no deletable tab found after 6 attempts');
    return false;
  }

  // Opens the "Create Watchlist" dialog.
  // Tries XPath selector first, then falls back to known coordinates.
  async tapAddWatchlist() {
    const slotOk = await this.ensureWatchlistSlotAvailable();
    if (!slotOk) {
      console.log('  tapAddWatchlist: could not free a slot — attempting Add anyway');
    }

    // Dismiss any ANR that may have appeared during slot-clearing
    await this._dismissANRIfPresent();
    await browser.pause(300);

    // Navigate back to watchlist screen
    await this.goToWatchlist();
    if (!await this.isLoaded(5000)) {
      // App might be on a stale screen — try harder
      try { await driver.back(); } catch {}
      await browser.pause(500);
      await this._dismissANRIfPresent();
      await this.goToWatchlist();
    }
    await browser.pause(200);

    // Primary: XPath selector for the Add (+) button
    if (await this.findAndTap(SEL.addWatchlistBtn, 3000)) {
      await browser.pause(400);
      if (await this.isDisplayed(SEL.watchlistInput, 3000)) return;
      // Button tapped but no dialog — might be a "max reached" message; press back and retry
      try { await driver.back(); } catch {}
      await browser.pause(300);
    }

    // Fallback 1: known absolute coordinates of the Add button (center of [1003,553][1050,595])
    try {
      const { width, height } = await driver.getWindowRect();
      await browser.action('pointer', { parameters: { pointerType: 'touch' } })
        .move({ x: Math.round(width * 0.951), y: Math.round(height * 0.245) })
        .down().up().perform();
      await browser.pause(400);
      if (await this.isDisplayed(SEL.watchlistInput, 3000)) return;
    } catch {}

    // Dump page source for diagnosis
    try {
      const src   = await driver.getPageSource();
      const descs = [...src.matchAll(/content-desc="([^"]{1,120})"/g)].map(m => m[1]);
      const texts = [...src.matchAll(/\btext="([^"]{1,60})"/g)].map(m => m[1]).filter(t => t.trim());
      console.log('\n  ── tapAddWatchlist: button not found ──');
      console.log('  descs:', descs.map((d, i) => `[${i}]${d.split(/\n|&#10;/)[0]}`).join(' | '));
      console.log('  texts:', texts.join(' | '));
      const fs   = require('fs'), path = require('path');
      const dump = path.join(__dirname, '../../ui_dumps/add_btn_debug.xml');
      require('fs').mkdirSync(path.dirname(dump), { recursive: true });
      require('fs').writeFileSync(dump, src);
      console.log('  Full XML → ui_dumps/add_btn_debug.xml');
    } catch {}
    throw new Error('Add Watchlist button not found');
  }

  async enterWatchlistName(name) {
    await this.setValue(SEL.watchlistInput, name);
    await browser.pause(100);
  }

  async tapCreateWatchlist() { await this.click(SEL.createBtn);  await browser.pause(300); }
  async tapCancelDialog()    { await this.click(SEL.cancelBtn);  await browser.pause(100); }

  async getDialogErrorMessage() {
    return this.findAndGetText(SEL.dialogError, 3000);
  }

  async tapRenameOption()  { await this.click(SEL.renameOption); await browser.pause(100); }
  async tapDeleteOption()  { await this.click(SEL.deleteOption); await browser.pause(100); }
  async tapDeleteConfirm() { await this.click(SEL.deleteConfirm); await browser.pause(300); }

  // Check if a named watchlist tab exists in the DOM (works even if off-screen in HScrollView).
  async watchlistExists(name) {
    try {
      return await (await $(SEL.tabByName(name))).isExisting();
    } catch { return false; }
  }

  async createWatchlist(name) {
    await this.tapAddWatchlist();
    await this.enterWatchlistName(name);
    await this.tapCreateWatchlist();
    await browser.pause(300);
    return this.watchlistExists(name);
  }

  // Scrolls through the tab strip to make a named tab visible, then deletes it.
  async deleteWatchlistByName(name) {
    try {
      await this.scrollToFirstTab();
      const { width } = await driver.getWindowRect();

      // Scroll right until the target tab is on-screen
      for (let swipe = 0; swipe <= 8; swipe++) {
        try {
          const el  = await $(SEL.tabByName(name));
          const loc = await el.getLocation();
          const siz = await el.getSize();
          const cx  = Math.round(loc.x + siz.width / 2);
          const cy  = Math.round(loc.y + siz.height / 2);
          if (cx >= 10 && cx <= width - 10) {
            // Tab is on-screen — long-press it
            await browser.action('pointer', { parameters: { pointerType: 'touch' } })
              .move({ x: cx, y: cy }).down().pause(800).up().perform();
            await browser.pause(200);
            await this._dismissANRIfPresent();
            if (await this.findAndTap(SEL.deleteOption, 2000)) {
              await this.findAndTap(SEL.deleteConfirm, 2000);
              await browser.pause(500);
              return true;
            }
            // Context menu appeared but no Delete — dismiss it
            if (await this.isDisplayed(SEL.renameOption, 500)) {
              try { await driver.back(); } catch {}
              await browser.pause(200);
            }
            break;
          }
        } catch {}
        if (swipe < 8) await this._swipeTabStrip('right');
      }
    } catch {}
    return false;
  }

  async longPressStock(name) {
    const el = await $(SEL.stockByName(name));
    await el.waitForDisplayed({ timeout: 5000 });
    const loc  = await el.getLocation();
    const size = await el.getSize();
    await browser.action('pointer', { parameters: { pointerType: 'touch' } })
      .move({ x: Math.round(loc.x + size.width / 2), y: Math.round(loc.y + size.height / 2) })
      .down().pause(800).up().perform();
    await browser.pause(200);
  }

  async tapRemoveStockOption() { await this.click(SEL.removeStock); await browser.pause(200); }

  // Searches for a stock, taps the "+" beside the result row, then taps "Done" (top-right) to confirm.
  async addStockFromSearch(name, exchange = 'NSE') {
    try {
      await this.searchStock(name);

      const exchSel     = `//android.view.View[contains(@content-desc,"${name}") and contains(@content-desc,"${exchange}")]`;
      const anySel      = `//android.view.View[contains(@content-desc,"${name}")]`;

      // Wait for results
      await this.isDisplayed(anySel, 5000);
      await browser.pause(200);

      // + button has no content-desc; look for a clickable ImageView sibling/child of the result row
      const imgSibExch   = `${exchSel}/following-sibling::android.widget.ImageView[@clickable="true"]`;
      const imgSibAny    = `${anySel}/following-sibling::android.widget.ImageView[@clickable="true"]`;
      const imgChildExch = `${exchSel}//android.widget.ImageView[@clickable="true"]`;
      const imgChildAny  = `${anySel}//android.widget.ImageView[@clickable="true"]`;

      let tapped = await this.findAndTap(imgSibExch,   1500)
               || await this.findAndTap(imgSibAny,    1500)
               || await this.findAndTap(SEL.addToWatchlist, 1500)
               || await this.findAndTap(imgChildExch, 1500)
               || await this.findAndTap(imgChildAny,  1500);

      if (!tapped) {
        // Coordinate fallback: right side of the result row at ~90% screen width
        const row = await $(anySel);
        const loc = await row.getLocation();
        const siz = await row.getSize();
        const { width: screenW } = await driver.getWindowSize();
        const tapX = Math.round(Math.max(loc.x + siz.width + 30, screenW * 0.88));
        const tapY = Math.round(loc.y + siz.height / 2);
        await driver.action('pointer', { parameters: { pointerType: 'touch' } })
          .move({ x: tapX, y: tapY }).down().up().perform();
        console.log(`  ℹ  addStockFromSearch(${name}): coord tap at (${tapX}, ${tapY})`);
        tapped = true;
      }

      await browser.pause(300);

      // After tapping +, "Done" button appears top-right to confirm the addition
      if (await this.isDisplayed(SEL.doneBtn, 2000)) {
        await this.click(SEL.doneBtn);
        await browser.pause(300);
      } else {
        // Done not found — exit via Cancel to avoid being stuck in search
        await this.findAndTap(SEL.cancelSearchBtn, 1500);
      }
    } catch (e) {
      console.log(`  ✗  addStockFromSearch(${name}): ${e.message}`);
      // Hard recovery so this failure doesn't cascade to subsequent tests
      try { await this.findAndTap(SEL.cancelSearchBtn, 1500); } catch {}
      try { await driver.back(); } catch {}
      await browser.pause(300);
    }
  }

  async isStockVisible(name) { return this.isDisplayed(SEL.stockByName(name), 5000); }

  async getFirstStockContentDesc() {
    const items = await $$(SEL.stockItems);
    return items.length ? items[0].getAttribute('content-desc') : null;
  }

  async isEmptyStateDisplayed() { return this.isDisplayed(SEL.emptyState, 5000); }

  async dragStockToPosition(fromIndex, toIndex) {
    const items = await $$(SEL.stockItems);
    if (fromIndex >= items.length || toIndex >= items.length) return false;
    const [srcLoc, srcSiz] = await Promise.all([items[fromIndex].getLocation(), items[fromIndex].getSize()]);
    const [dstLoc, dstSiz] = await Promise.all([items[toIndex].getLocation(),  items[toIndex].getSize()]);
    await browser.action('pointer', { parameters: { pointerType: 'touch' } })
      .move({ x: Math.round(srcLoc.x + srcSiz.width / 2), y: Math.round(srcLoc.y + srcSiz.height / 2) })
      .down().pause(1000)
      .move({ x: Math.round(dstLoc.x + dstSiz.width / 2), y: Math.round(dstLoc.y + dstSiz.height / 2), duration: 800 })
      .up().perform();
    await browser.pause(200);
    return true;
  }

  async scrollToBottom(swipes = 5) {
    for (let i = 0; i < swipes; i++) { await this.swipeUp(); await browser.pause(100); }
  }

  async scrollToTop(swipes = 5) {
    for (let i = 0; i < swipes; i++) { await this.swipeDown(); await browser.pause(100); }
  }
}

module.exports = new WatchlistPage();
