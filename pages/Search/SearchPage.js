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
  // Generic result row: any View whose content-desc mentions an exchange AND is
  // longer than 10 chars. Real rows have "SYMBOL\nEXCH\nSEG\nNAME" (20+ chars);
  // the CDS filter tab has just "CDS" (3 chars). &#10; cannot be used in XPath 1.0
  // string literals — string-length() is the XPath-1.0-compatible guard.
  resultRows:         '//android.view.View[(contains(@content-desc,"NSE") or contains(@content-desc,"BSE") or contains(@content-desc,"NFO") or contains(@content-desc,"MCX") or contains(@content-desc,"CDS")) and string-length(@content-desc) > 10]',

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
  async isLoaded(timeout = 8000) {
    return this.isDisplayed(SEL.cancelBtn, timeout);
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
  async _getSearchField(timeout = 4000) {
    // Use a short probe for the hint-based selector so the fallback kicks in
    // quickly when the field already has text (hint attribute disappears once typed).
    const PROBE_MS = 2000;
    try {
      const el = await $(SEL.searchField);
      await el.waitForDisplayed({ timeout: PROBE_MS });
      return el;
    } catch {
      const el = await $('//android.widget.EditText');
      await el.waitForDisplayed({ timeout });
      return el;
    }
  }

  async typeQuery(query) {
    const el = await this._getSearchField(8000);
    // Click first to refocus the field and show the keyboard. Without this,
    // setValue() uses ACTION_SET_TEXT which bypasses onChangeText (e.g. after
    // the (+) button tap in Phase 6 dismisses the keyboard).
    await el.click();
    await browser.pause(300);
    await el.clearValue();
    await el.setValue(String(query));
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
      return (await $$(SEL.resultRows)).length > 0;
    }, timeout, 500);
  }

  async getResultCount() {
    return (await $$(SEL.resultRows)).length;
  }

  // Returns array of { symbol, exchange, segment, secondary, rawDesc } for each visible row
  async getResultRows() {
    const rows = [];
    try {
      const els = await $$(SEL.resultRows);
      for (const el of els) {
        try {
          const rawDesc = await el.getAttribute('content-desc') || '';
          const parts   = rawDesc.split(/\n|&#10;/).map(p => p.trim()).filter(Boolean);
          // Typical parts: ["INFY", "NSE", "EQ", "INFOSYS LIMITED"] or ["INFY25JUN", "NFO", "F&O", "30 Jun 2026"]
          const symbol    = parts[0] || '';
          const exchange  = parts[1] || '';
          const segment   = parts[2] || '';
          const secondary = parts[3] || '';
          rows.push({ symbol, exchange, segment, secondary, rawDesc });
        } catch {}
      }
    } catch {}
    return rows;
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
