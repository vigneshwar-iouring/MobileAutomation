const BasePage = require('../Login/BasePage');

// Search Screen — Globe Capital Dev
// Opened from Watchlist via the "Add or search stocks" EditText.
// Layout (Pixel 9a, 1080×2400):
//   Search bar row  : back arrow (←) | EditText | Cancel
//   Segment tabs    : ALL · STOCK · F&O · COM · CDS  (pill/horizontal scroll)
//   Result list     : scrollable rows below the tabs
//   Empty state     : magnifier illustration + "No Recent Searches"
const SEL = {
  // ── Search bar ─────────────────────────────────────────────────────────────
  searchField: '//android.widget.EditText[contains(@hint,"Add or search stocks") or contains(@text,"Add or search stocks")]',
  backArrow:   '//*[contains(@content-desc,"Back") or contains(@content-desc,"back") or contains(@content-desc,"Navigate up")]',
  cancelBtn:   '//*[@content-desc="Cancel" or @text="Cancel"]',

  // ── Segment filter tabs ─────────────────────────────────────────────────────
  tabALL:   (active) => active
    ? '//*[contains(@content-desc,"ALL") and (@selected="true" or contains(@content-desc,"selected"))]'
    : '//*[contains(@content-desc,"ALL")]',
  tabSTOCK: '//*[contains(@content-desc,"STOCK") or @text="STOCK"]',
  tabFO:    '//*[contains(@content-desc,"F&O") or @text="F&O"]',
  tabCOM:   '//*[contains(@content-desc,"COM") or @text="COM"]',
  tabCDS:   '//*[contains(@content-desc,"CDS") or @text="CDS"]',

  // Dynamic tab selector by label
  tab:      (label) => `//*[contains(@content-desc,"${label}") or @text="${label}"]`,

  // ── Empty state ─────────────────────────────────────────────────────────────
  emptyState:         '//*[contains(@content-desc,"No Recent Searches") or contains(@text,"No Recent Searches")]',
  noResultsText:      '//*[contains(@content-desc,"No search results") or contains(@text,"No search results") or contains(@content-desc,"no results") or contains(@text,"no results")]',

  // ── Result rows ─────────────────────────────────────────────────────────────
  // Real rows' content-desc is "SYMBOL\nAdd Watchlist, Double tap to open Quote
  // Screen." — no NSE/BSE/exchange tag is exposed here at all (confirmed via
  // device dump). "Quote Screen" anchors the match to a genuine result row.
  resultRows:         '//android.view.View[contains(@content-desc,"Add Watchlist") and contains(@content-desc,"Quote Screen")]',

  // Result row containing a specific symbol
  resultBySymbol:     (sym) => `//android.view.View[starts-with(@content-desc,"${sym.toUpperCase()}")]`,

  // Result row containing symbol AND exchange
  resultBySymbolExch: (sym, exch) => `//android.view.View[contains(@content-desc,"${sym.toUpperCase()}") and contains(@content-desc,"${exch}")]`,

  // ── Add (+) and check (✓) buttons ─────────────────────────────────────────
  addBtn:             '//android.widget.ImageView[@content-desc="+" or contains(@content-desc,"Add to watchlist") or contains(@content-desc,"Add")]',
  addBtnForRow:       (sym, exch) => `//android.view.View[contains(@content-desc,"${sym.toUpperCase()}") and contains(@content-desc,"${exch}")]/following-sibling::android.widget.ImageView`,
  checkmark:          '//*[contains(@content-desc,"added") or contains(@content-desc,"Added") or @content-desc="✓" or contains(@content-desc,"check") or contains(@content-desc,"Check")]',
};

class SearchPage extends BasePage {

  // ── Screen detection ───────────────────────────────────────────────────────

  // The Cancel link is only present on the Search screen, not on the Watchlist screen
  // (both screens share the same EditText selector, so we cannot rely on searchField alone).
  // Page-source fallbacks handle Markets-origin search screens where Cancel may render differently.
  async isLoaded(timeout = 8000) {
    return this.pollUntil(async () => {
      try {
        const src = await driver.getPageSource();
        if (/content-desc="Cancel"|text="Cancel"/.test(src)) return true;
        // Search screen has ALL + STOCK segment tabs; these are unique to the Search screen
        if (src.includes('"ALL"') && src.includes('"STOCK"')) return true;
        // Focused EditText means the search field is active (navigated to search)
        if (/focused="true"/.test(src) && src.includes('EditText')) return true;
        // "No Recent Searches" is the search screen empty state (before any query)
        if (src.includes('No Recent') || src.includes('Recent Search')) return true;
      } catch {}
      return false;
    }, timeout, 500);
  }

  async isSearchFieldFocused(timeout = 5000) {
    try {
      const el = await $(SEL.searchField);
      await el.waitForDisplayed({ timeout });
      const focused = await el.getAttribute('focused');
      return focused === 'true';
    } catch { return false; }
  }

  // ── Search bar actions ─────────────────────────────────────────────────────

  // Android hides the hint attribute once text is typed into the field, so the
  // hint-based selector stops matching after the first typeQuery() call. Fall
  // back to the single EditText on the search screen when that happens.
  // When opened from Markets the keyboard is pre-raised and waitForDisplayed
  // may return false even though the element exists — use isExisting() first.
  async _getSearchField(timeout = 4000) {
    // UiSelector: find focused or first EditText — works even when waitForDisplayed fails
    for (const uiSel of [
      'android=new UiSelector().className("android.widget.EditText").focused(true)',
      'android=new UiSelector().className("android.widget.EditText").instance(0)',
    ]) {
      try {
        const el = await $(uiSel);
        if (await el.isExisting()) return el;
      } catch {}
    }
    // XPath: hint-based (fast path when field still shows placeholder)
    try {
      const el = await $(SEL.searchField);
      if (await el.isExisting()) return el;
    } catch {}
    // Last resort: wait for any EditText via XPath
    const el = await $('//android.widget.EditText');
    await el.waitForDisplayed({ timeout });
    return el;
  }

  async typeQuery(query) {
    // Strategy 1: native android.widget.EditText (Watchlist search screen)
    for (const uiSel of [
      'android=new UiSelector().className("android.widget.EditText").focused(true)',
      'android=new UiSelector().className("android.widget.EditText").instance(0)',
    ]) {
      try {
        const el = await $(uiSel);
        if (await el.isExisting()) {
          await el.click();
          await browser.pause(300);
          await el.clearValue();
          await el.setValue(String(query));
          await browser.pause(300);
          return;
        }
      } catch {}
    }

    // Strategy 2: ANY focused element (catches React Native custom TextInput that
    // doesn't report as android.widget.EditText in the accessibility tree).
    try {
      const el = await $('android=new UiSelector().focused(true)');
      if (await el.isExisting()) {
        console.log('  ℹ  [typeQuery] found focused element via UiSelector');
        try { await el.clearValue(); } catch {}
        await el.setValue(String(query));
        await browser.pause(300);
        return;
      }
    } catch (e) {
      console.log(`  ℹ  [typeQuery] focused UiSelector: ${String(e.message).slice(0, 80)}`);
    }

    // Ensure keyboard is visible before sending key events
    try {
      const kbShown = await driver.isKeyboardShown();
      console.log(`  ℹ  [typeQuery] keyboard shown: ${kbShown}`);
      if (!kbShown) {
        const { width, height } = await browser.getWindowSize();
        await browser.action('pointer', { parameters: { pointerType: 'touch' } })
          .move({ x: Math.round(width * 0.5), y: Math.round(height * 0.06) })
          .down().pause(80).up().perform();
        await browser.pause(800);
      }
    } catch (e) {
      console.log(`  ℹ  [typeQuery] keyboard check: ${String(e.message).slice(0, 60)}`);
    }

    // Strategy 3: browser.keys() — sends real Android KeyEvents via W3C Actions API.
    // Unlike mobile: type (IME injection), key events trigger React Native onChangeText.
    try {
      await browser.keys([...String(query)]);
      await browser.pause(500);
      return;
    } catch (e) {
      console.log(`  ℹ  [typeQuery] browser.keys failed: ${String(e.message).slice(0, 80)}`);
    }

    // Strategy 4: mobile: type (IME injection — may not trigger RN event handlers)
    try {
      await driver.executeScript('mobile: type', [{ text: String(query) }]);
    } catch (e) {
      console.log(`  ℹ  [typeQuery] mobile: type failed: ${String(e.message).slice(0, 80)}`);
    }

    await browser.pause(500);
  }

  async clearQuery() {
    try {
      const el = await this._getSearchField(3000);
      await el.clearValue();
      await browser.pause(300);
    } catch {}
  }

  async tapCancel() {
    const tapped = await this.findAndTap(SEL.cancelBtn, 5000);
    if (!tapped) {
      try { await driver.back(); } catch {}
    }
    await browser.pause(300);
  }

  async tapBackArrow() {
    const tapped = await this.findAndTap(SEL.backArrow, 5000);
    if (!tapped) {
      try { await driver.back(); } catch {}
    }
    await browser.pause(300);
  }

  async getSearchFieldPlaceholder() {
    try {
      const el = await $(SEL.searchField);
      await el.waitForDisplayed({ timeout: 5000 });
      return (await el.getAttribute('hint'))
          || (await el.getAttribute('text'))
          || null;
    } catch { return null; }
  }

  // ── Segment tab actions ────────────────────────────────────────────────────

  async tapTab(label) {
    const sel = SEL.tab(label);
    await this.click(sel);
    await browser.pause(400);
  }

  async isTabSelected(label) {
    try {
      const src = await driver.getPageSource();
      // Look for the tab element with a selected="true" attribute adjacent to the label
      const re = new RegExp(`content-desc="[^"]*${label}[^"]*"[^>]*selected="true"`, 'i');
      if (re.test(src)) return true;
      // Fallback: check if element attribute is true
      const el = await $(SEL.tab(label));
      if (!await el.isExisting()) return false;
      const sel = await el.getAttribute('selected');
      return sel === 'true';
    } catch { return false; }
  }

  // Returns the label of the currently selected tab (or null)
  async getSelectedTab() {
    const labels = ['ALL', 'STOCK', 'F&O', 'COM', 'CDS'];
    for (const label of labels) {
      if (await this.isTabSelected(label)) return label;
    }
    // Fallback: read page source for a highlighted/selected indicator
    try {
      const src = await driver.getPageSource();
      for (const label of labels) {
        if (src.includes(`"${label}"`) && src.includes('selected="true"')) return label;
      }
    } catch {}
    return null;
  }

  // Validates that all 5 tabs are present in the DOM
  async getAllTabLabels() {
    const labels = ['ALL', 'STOCK', 'F&O', 'COM', 'CDS'];
    const found = [];
    try {
      const src = await driver.getPageSource();
      for (const label of labels) {
        if (src.includes(`"${label}"`) || src.includes(`>${label}<`)) found.push(label);
      }
    } catch {}
    return found;
  }

  // ── Empty state ────────────────────────────────────────────────────────────

  async isEmptyStateDisplayed(timeout = 5000) {
    return this.isDisplayed(SEL.emptyState, timeout);
  }

  async getEmptyStateText() {
    return this.findAndGetText(SEL.emptyState, 5000);
  }

  async isNoResultsStateDisplayed(timeout = 5000) {
    // Checks both XPath selector and raw page source
    if (await this.isDisplayed(SEL.noResultsText, timeout)) return true;
    try {
      const src = await driver.getPageSource();
      return src.toLowerCase().includes('no search results') || src.toLowerCase().includes('no results found');
    } catch { return false; }
  }

  // ── Result rows ─────────────────────────────────────────────────────────────

  async waitForResults(timeout = 8000) {
    return this.pollUntil(async () => {
      if ((await $$(SEL.resultRows)).length > 0) return true;
      // Markets search format: results render as separate symbol + action elements
      // rather than a single View with exchange info bundled in content-desc
      const src = await driver.getPageSource();
      return src.includes('Double tap to add to watchlist') || src.includes('Double tap to remove');
    }, timeout, 500);
  }

  async getResultCount() {
    const native = (await $$(SEL.resultRows)).length;
    if (native > 0) return native;
    try {
      const src         = await driver.getPageSource();
      const addCount    = (src.match(/Double tap to add to watchlist/g) || []).length;
      const removeCount = (src.match(/Double tap to remove/g) || []).length;
      return addCount + removeCount;
    } catch { return 0; }
  }

  // Returns array of { symbol, exchange, segment, secondary, rawDesc } for each visible row.
  // exchange/segment/secondary are always null — the app's content-desc for a result
  // row is just "SYMBOL\nAdd Watchlist, Double tap to open Quote Screen." with no
  // exchange/segment/secondary data exposed via accessibility in this build.
  async getResultRows() {
    const rows = [];
    try {
      const els = await $$(SEL.resultRows);
      for (const el of els) {
        try {
          const rawDesc = await el.getAttribute('content-desc') || '';
          const symbol  = rawDesc.split(/\n|&#10;/)[0].trim();
          rows.push({ symbol, exchange: null, segment: null, secondary: null, rawDesc });
        } catch {}
      }
    } catch {}
    return rows;
  }

  // Taps the first visible result row and waits for navigation
  async tapFirstResult() {
    // Watchlist format: single View per row with exchange info in content-desc
    try {
      const rows = await $$(SEL.resultRows);
      if (rows.length > 0) { await rows[0].click(); await browser.pause(1200); return true; }
    } catch {}

    // Markets format: symbol labels (content-desc="SBI") are non-interactive children.
    // Locate the first add/remove action button, read its Y position, then tap the
    // LEFT side of that row (x=30%) where the stock symbol/name is displayed.
    // A single tap on the row's left area triggers navigation to the Quote screen.
    for (const addSel of [
      'android=new UiSelector().descriptionContains("Double tap to add to watchlist").instance(0)',
      'android=new UiSelector().descriptionContains("Double tap to remove").instance(0)',
    ]) {
      try {
        const el = await $(addSel);
        if (!await el.isExisting()) continue;
        const rect = await el.getRect();
        const { width } = await browser.getWindowSize();
        await browser.action('pointer', { parameters: { pointerType: 'touch' } })
          .move({ x: Math.round(width * 0.3), y: Math.round(rect.y + rect.height / 2) })
          .down().pause(80).up().perform();
        await browser.pause(1200);
        return true;
      } catch (e) {
        console.log(`  ℹ  [tapFirstResult] ${e.message?.slice(0, 80)}`);
      }
    }

    return false;
  }

  // Returns true if any result row matches the given symbol
  async hasResultForSymbol(sym) {
    return this.isDisplayed(SEL.resultBySymbol(sym), 5000);
  }

  // ── Add to watchlist (+→✓) ─────────────────────────────────────────────────

  // Taps the (+) button for a specific symbol+exchange row.
  // Falls back to the first visible (+) if the targeted selector fails.
  async tapAddForSymbol(sym, exch = 'NSE') {
    const targeted = SEL.addBtnForRow(sym, exch);
    if (await this.findAndTap(targeted, 3000)) return true;

    // Fallback 1: generic add button inside matching row
    const rowSel = SEL.resultBySymbolExch(sym, exch);
    try {
      const row = await $(rowSel);
      await row.waitForDisplayed({ timeout: 3000 });
      const addInRow = await row.$('./following-sibling::android.widget.ImageView');
      await this._tap(addInRow);
      return true;
    } catch {}

    // Fallback 2: first visible generic (+) button
    return this.findAndTap(SEL.addBtn, 2000);
  }

  // Checks whether the add button for the row has changed to a checkmark (✓)
  async isSymbolAdded(sym, exch = 'NSE') {
    // Check if the (+) changed to a checkmark via page source
    try {
      const src = await driver.getPageSource();
      const symIdx = src.indexOf(sym.toUpperCase());
      if (symIdx < 0) return false;
      const snippet = src.substring(symIdx, symIdx + 600);
      // App may use content-desc "added", "check", or selected="true" on the ImageView
      return /added|check|✓|selected="true"/i.test(snippet);
    } catch { return false; }
  }

  // Convenience: tap (+) then verify it flipped to ✓
  async addSymbolAndVerify(sym, exch = 'NSE') {
    const added = await this.tapAddForSymbol(sym, exch);
    if (!added) return false;
    await browser.pause(500);
    return this.isSymbolAdded(sym, exch);
  }

  // ── Page-source helpers ────────────────────────────────────────────────────

  // Dumps all content-desc and text attributes from page source (for diagnostics)
  async _dumpPageSource(label) {
    try {
      const src   = await driver.getPageSource();
      const descs = [...src.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1].split(/\n|&#10;/)[0].trim());
      const texts = [...src.matchAll(/\btext="([^"]{2,})"/g)].map(m => m[1]);
      console.log(`\n  ── ${label} ──`);
      console.log('  descs :', descs.slice(0, 20).join(' | '));
      console.log('  texts :', texts.slice(0, 20).join(' | '));
    } catch {}
  }

  // ── Scroll helpers ─────────────────────────────────────────────────────────

  async scrollResultsDown() { await this.swipeUp(); await browser.pause(200); }
  async scrollResultsUp()   { await this.swipeDown(); await browser.pause(200); }
}

module.exports = new SearchPage();
