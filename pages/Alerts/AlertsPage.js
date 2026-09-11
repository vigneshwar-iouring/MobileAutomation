const BasePage = require('../Login/BasePage');

// Alerts screen (hamburger menu -> Alerts) and its Add/Set Alert + delete sub-flows.
// Each alert row's content-desc is one long sentence: "<Company>\n<Symbol>\n<Exchange>\n
// Last traded price for <Symbol>: <LTP>...\nAlert condition for <Symbol>: <condition>.
// Created/Triggered at <date>. Status: Enabled|Disabled., ...Double tap to view alert
// details and actions" — confirmed via a real UI dump. Tapping a row opens a bottom
// sheet (Disable/Edit/DELETE); DELETE opens a native confirm dialog.
const SEL = {
  hamburgerBtn:  '//*[contains(@content-desc,"Hamburger") or contains(@content-desc,"hamburger")]',
  alertsMenuItem: '//*[starts-with(@content-desc,"Alerts") or @text="Alerts"]',

  header:        '//*[@content-desc="Alerts"]',
  addAlertBtn:   '//*[starts-with(@content-desc,"Add Alert")]',
  alertRow:      '//*[contains(@content-desc,"Double tap to view alert details and actions")]',

  // ── Add Alert search screen (reuses the same search-field pattern as Watchlist) ──
  searchField:   '//android.widget.Button[@hint="Add or search stocks"]',
  searchResult:  '//*[contains(@content-desc,"Double tap to open Quote Screen")]',

  // ── Set Alert screen ──
  setAlertHeader: '//*[@content-desc="Set Alert"]',
  valueField:     '//android.widget.EditText[1]',
  createAlertBtn: '//*[starts-with(@content-desc,"Create Alert")]',

  // ── Alert detail bottom sheet ──
  disableAlertBtn: '//*[starts-with(@content-desc,"Disable Alert") or starts-with(@content-desc,"Enable Alert")]',
  editAlertBtn:    '//*[starts-with(@content-desc,"Edit Alert")]',
  deleteBtn:       '//*[@text="DELETE" or @content-desc="DELETE"]',

  // ── Delete confirm dialog ──
  deleteConfirmHeading: '//*[@content-desc="Delete Alert"]',
  deleteConfirmBtn:     '//*[@content-desc="Delete"]',
  deleteCancelBtn:      '//*[@content-desc="Cancel"]',

  serverErrorToast: '//*[contains(@content-desc,"Internal server error") or contains(@text,"Internal server error")]',
};

class AlertsPage extends BasePage {

  async openAlerts() {
    const hamburgerTapped = await this.findAndTap(SEL.hamburgerBtn, 5000);
    if (!hamburgerTapped) return false;
    await browser.pause(800);
    return this.findAndTap(SEL.alertsMenuItem, 5000);
  }

  async isLoaded(timeout = 8000) { return this.isDisplayed(SEL.header, timeout); }

  async closeAlerts() { return this.findAndTap('//*[@content-desc="Back" or contains(@content-desc,"go back")]', 5000); }

  // Parses every visible alert row into { raw, company, symbol, exchange, status }.
  // Keyed off "Alert condition for" rather than the row's full merged content-desc —
  // when two alerts share the same symbol/condition/status, Compose's accessibility
  // merging has been observed to split a row's label across two separate content-desc
  // attributes instead of one (confirmed via a real dump), so the symbol/company/
  // exchange fields aren't reliably in the same string as "Alert condition for".
  // "Alert condition for <SYMBOL>:" itself is present in both the merged and split
  // forms, so it's used to both find each row and extract its symbol.
  async getAlertEntries() {
    try {
      const src  = await driver.getPageSource();
      const rows = [...src.matchAll(/content-desc="([^"]*Alert condition for[^"]*)"/g)].map(m => m[1]);
      return rows.map(raw => {
        const symbolMatch = raw.match(/Alert condition for ([^:]+):/);
        const statusMatch = raw.match(/Status:\s*(Enabled|Disabled)/i);
        const parts = raw.split(/&#10;|\n/);
        return {
          raw,
          company:  parts.length > 1 ? parts[0] : null,
          symbol:   symbolMatch ? symbolMatch[1].trim() : (parts[1] || null),
          exchange: parts.length > 1 ? parts[2] : null,
          status:   statusMatch ? statusMatch[1] : null,
        };
      });
    } catch { return []; }
  }

  async tapAddAlert() { return this.findAndTap(SEL.addAlertBtn, 5000); }

  async searchSymbol(query) {
    const tapped = await this.findAndTap(SEL.searchField, 5000);
    if (!tapped) return false;
    await browser.pause(400);
    await (await $(SEL.searchField)).setValue(query);
    return this.pollUntil(async () => (await $$(SEL.searchResult)).length > 0, 8000, 400);
  }

  async tapFirstSearchResult() {
    const results = await $$(SEL.searchResult);
    if (results.length === 0) return false;
    await results[0].click();
    return true;
  }

  async isSetAlertScreenLoaded(timeout = 8000) { return this.isDisplayed(SEL.setAlertHeader, timeout); }

  // Parses the "Last traded price for <SYM>: <value>..." sentence on the Set Alert screen.
  async getLtp() {
    try {
      const src = await driver.getPageSource();
      const m = src.match(/Last traded price for [^:]+:\s*([\d,]+\.\d+)/);
      return m ? parseFloat(m[1].replace(/,/g, '')) : null;
    } catch { return null; }
  }

  async setAlertValue(value) {
    const field = await $(SEL.valueField);
    await field.click();
    await browser.pause(200);
    await field.clearValue();
    await browser.pause(150);
    await field.setValue(String(value));
    await browser.pause(300);
  }

  async tapCreateAlert() { return this.findAndTap(SEL.createAlertBtn, 5000); }

  // Best-effort transient-toast capture — polls briefly right after an action.
  async captureToast(timeoutMs = 3000, pollMs = 250) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const src = await driver.getPageSource();
        if (src.includes('Internal server error')) return 'Internal server error';
      } catch {}
      await browser.pause(pollMs);
    }
    return null;
  }

  async tapAlertRow(index = 0) {
    const rows = await $$(SEL.alertRow);
    if (rows.length <= index) return false;
    await rows[index].click();
    return true;
  }

  async isAlertDetailSheetLoaded(timeout = 5000) { return this.isDisplayed(SEL.deleteBtn, timeout); }
  async tapDelete() { return this.findAndTap(SEL.deleteBtn, 5000); }
  async isDeleteConfirmVisible(timeout = 5000) { return this.isDisplayed(SEL.deleteConfirmHeading, timeout); }
  async confirmDelete() { return this.findAndTap(SEL.deleteConfirmBtn, 5000); }
}

module.exports = new AlertsPage();
