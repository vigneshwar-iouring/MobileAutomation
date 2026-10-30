const fs   = require('fs');
const path = require('path');
const BasePage = require('../Login/BasePage');
const { decodePng, regionCoverage } = require('../../utils/pngPixels');

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

  // Loader shown while a sub-screen/tab fetches its data - a ProgressBar widget, or a
  // "Loading..."/"Please wait" label.
  loader: '//android.widget.ProgressBar | //*[contains(translate(@content-desc,"LOADINGPLEASWT","loadingpleaswt"),"loading") or contains(translate(@text,"LOADINGPLEASWT","loadingpleaswt"),"loading") or contains(translate(@content-desc,"LOADINGPLEASWT","loadingpleaswt"),"please wait") or contains(translate(@text,"LOADINGPLEASWT","loadingpleaswt"),"please wait")]',
};

// Case-insensitive match on content-desc OR text - Strategy Builder / IV / OI sub-screen
// labels haven't been confirmed against a real UI dump yet, so don't assume which
// attribute carries them or their exact case. `exact` matches the first line of the
// content-desc ("OI\nTab 1 of 3" -> "OI") or the whole text, so "OI" doesn't also match
// "OI Change" / "OI Analysis".
const LOWER = 'translate(%s,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz")';
function byLabel(label, { exact = false } = {}) {
  const l = label.toLowerCase();
  const desc = LOWER.replace('%s', '@content-desc');
  const text = LOWER.replace('%s', '@text');
  if (!exact) return `//*[contains(${desc},"${l}") or contains(${text},"${l}")]`;
  return `//*[${desc}="${l}" or starts-with(${desc},"${l}\n") or starts-with(${desc},"${l},") or ${text}="${l}"]`;
}

// Labels that are screen chrome rather than loaded data - excluded when deciding whether
// a sub-screen actually rendered content (charts/rows) or is just showing its header.
const CHROME = /^(back|scrim|hamburger|index |watchlist|market|orders|portfolio|mutual funds|strategy builder|iv analysis|oi analysis|nxtoption)\b/i;
// "Retry" included - confirmed live that OI Analysis shows a bare Retry button (no other
// message) when its data request fails.
const ERROR_RE = /went wrong|\berror\b|failed|unable to|try again|no data|not available|^retry$/i;

// Below this fraction of non-background pixels the chart area is treated as blank.
// Calibrated on real screenshots: the empty IV Charts area scores 0.00%, populated
// NxtOption/Watchlist screens 4.5-24%.
const MIN_CHART_COVERAGE = 0.01;

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

  // ── Sub-screen tabs / buttons (Buy Call, IV Charts, IVR-IVP Scan, OI, OI Change, PCR Chart)

  async tapLabel(label, opts = {}, timeout = 5000) { return this.findAndTap(byLabel(label, opts), timeout); }

  // 'true' / 'false' from the element's selected (or checked) attribute, or null when the
  // label isn't found or the app doesn't expose either attribute for it.
  async getSelectedState(label, opts = {}) {
    try {
      const el = await $(byLabel(label, opts));
      if (!(await el.isExisting())) return null;
      // The label can sit on a child of the actual tab node, which is the one carrying
      // selected="true" - so check the matched node's ancestors too.
      const sel = await $(`(${byLabel(label, opts)})[1]/ancestor-or-self::*[@selected="true" or @checked="true"]`);
      if (await sel.isExisting()) return 'true';
      return (await el.getAttribute('selected')) === 'false' ? 'false' : null;
    } catch { return null; }
  }

  // Waits for the current sub-screen to settle, then reports what it shows. Fails "infinite
  // loading" if a loader is still up after `timeout`. `content` = desc/text labels that
  // aren't screen chrome or the caller's own tab/button labels (`ignore`) - i.e. evidence
  // that chart axes/values or data rows actually rendered.
  async getScreenHealth({ ignore = [], timeout = 20000 } = {}) {
    const start = Date.now();
    const stillLoading = async () => {
      try {
        for (const el of await $$(SEL.loader)) if (await el.isDisplayed()) return true;
      } catch {}
      return false;
    };
    const settled = await this.pollUntil(async () => !(await stillLoading()), timeout, 500);
    const loadMs = Date.now() - start;
    // Give the chart one more beat to draw after the loader clears.
    await browser.pause(1000);

    let src = '';
    try { src = await driver.getPageSource(); } catch {}
    const decode = s => s.replace(/&#10;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
    const labels = [...src.matchAll(/(?:content-desc|\btext)="([^"]+)"/g)].map(m => decode(m[1])).filter(Boolean);
    const ignoreRe = ignore.map(i => i.toLowerCase());
    const errors = [...new Set(labels.filter(l => ERROR_RE.test(l)))];
    const content = [...new Set(labels.filter(l =>
      !CHROME.test(l) && !ERROR_RE.test(l) && !ignoreRe.some(i => l.toLowerCase().startsWith(i))))];
    return { stillLoading: !settled, loadMs, errors, content };
  }

  // Whether a chart/data actually drew, measured from screenshot pixels - custom-drawn
  // charts expose nothing in the accessibility tree, so an empty chart area and a drawn
  // one look identical there (confirmed live: R54 passed on a blank IV Charts area).
  // Region = from just below the lowest on-screen control matching `anchorRe` (only
  // controls in the top half count, so chart axis labels can't push it down) to 90% of
  // screen height, above the system nav bar. Returns { coverage, rendered, region }.
  async getChartCoverage(anchorRe) {
    try {
      const src = await driver.getPageSource();
      const img = decodePng(Buffer.from(await driver.takeScreenshot(), 'base64'));
      let top = Math.round(img.height * 0.30);
      const nodeRe = /<[^>]*?(?:content-desc|\btext)="([^"]+)"[^>]*?bounds="\[\d+,\d+\]\[\d+,(\d+)\]"/g;
      for (const m of src.matchAll(nodeRe)) {
        const label = m[1].split('&#10;')[0].trim();
        const y2 = Number(m[2]);
        if (anchorRe.test(label) && y2 < img.height / 2) top = Math.max(top, y2 + 20);
      }
      const region = { top, bottom: Math.round(img.height * 0.9) };
      const coverage = regionCoverage(img, region);
      return { coverage, rendered: coverage >= MIN_CHART_COVERAGE, region };
    } catch (e) {
      return { coverage: null, rendered: false, region: null, error: e.message };
    }
  }

  async dumpPageSource(label) {
    try {
      const file = path.join(__dirname, '../../ui_dumps', `${label}.xml`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, await driver.getPageSource());
      console.log(`  Full XML → ui_dumps/${label}.xml`);
    } catch {}
  }

  async goBack() { try { await driver.back(); } catch {} }
}

module.exports = new NxtOptionPage();
