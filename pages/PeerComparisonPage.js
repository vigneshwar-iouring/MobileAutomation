const BasePage = require('./BasePage');
const { decodePng, pixelAt } = require('../utils/pngPixels');

// "PEER COMPARISON - SYMBOL", opened from a Quote's Advanced Options -> Compare with Peer. Tabs
// "Ratios\nTab 1 of 3", "Key Parameters\nTab 2 of 3", "Performance\nTab 3 of 3"; Ratios and Key
// Parameters have Standalone/Consolidated sub-tabs, Performance has none (verified live). The
// sub-tabs carry no selected attribute - the selected one is the pill filled blue (40,94,163).
const PEER_TABS = ['Ratios', 'Key Parameters', 'Performance'];
const PEER_SUB_TABS = ['Standalone', 'Consolidated'];
const PEER_TABS_WITH_SUB_TABS = ['Ratios', 'Key Parameters'];

class PeerComparisonPage extends BasePage {
    constructor(driver) {
        super(driver);
        this.title = 'android=new UiSelector().descriptionStartsWith("PEER COMPARISON")';
    }

    async isDisplayed(timeout = 8000) {
        return this.isElementVisible(this.title, timeout);
    }

    // The title names the base symbol even when opened from the BSE Quote, whose symbol carries a
    // "-B" suffix ("SEJALLTD-B" -> "PEER COMPARISON - SEJALLTD", verified live).
    async verifyOpened(quoteSymbol, timeout = 8000) {
        const symbol = quoteSymbol && quoteSymbol.replace(/-B$/, '');
        const opened = await this.isDisplayed(timeout);
        const nodes = opened ? await this.getDescribedElements() : [];
        const title = (nodes.find(n => n.desc.startsWith('PEER COMPARISON')) || {}).desc || null;
        const tabs = PEER_TABS.filter(t => nodes.some(n => n.desc.startsWith(`${t}\nTab `)));
        const tabsOk = tabs.length === PEER_TABS.length;
        console.log(`Peer Comparison screen opened${title ? ` ("${title}")` : ''}: ${opened ? 'PASS' : 'FAIL'}`);
        const titleOk = !opened || !symbol || (!!title && title.includes(symbol));
        if (!titleOk) console.log(`  Title does not name ${symbol}: FAIL`);
        console.log(`Tabs displayed: ${tabs.join(', ') || 'none'} - ${tabsOk ? 'PASS' : `FAIL (expected ${PEER_TABS.join(', ')})`}`);
        return opened && titleOk && tabsOk;
    }

    // Symbols in the "Script Name" column: clickable nodes down the left edge below that header,
    // each a bare ticker ("ASAHIINDIA") - their figures are a separate node to the right.
    async getSymbols() {
        const nodes = await this.getDescribedElements();
        const header = nodes.find(n => n.desc === 'Script Name');
        if (!header) return [];
        return nodes.filter(n => n.clickable && n.x1 === 0 && n.y1 > header.y1 && !n.desc.includes('\n') && /^[A-Z0-9&.-]+$/.test(n.desc.trim()));
    }

    async waitForSymbols(timeout = 6000) {
        const deadline = Date.now() + timeout;
        let symbols = await this.getSymbols();
        while (!symbols.length && Date.now() < deadline) {
            await this.pause(600);
            symbols = await this.getSymbols();
        }
        return symbols;
    }

    async getSelectedSubTab() {
        const nodes = await this.getDescribedElements();
        const img = decodePng(Buffer.from(await this.driver.takeScreenshot(), 'base64'));
        const { width } = await this.driver.getWindowSize();
        const scale = img.width / width;
        for (const label of PEER_SUB_TABS) {
            const n = nodes.find(x => x.desc === label);
            if (!n) continue;
            let blue = 0, total = 0;
            for (let x = n.x1 + 10; x < n.x2 - 10; x += 6) {
                const [r, , b] = pixelAt(img, x * scale, (n.y1 + 14) * scale);
                total++;
                if (b > 120 && b - r > 60) blue++;
            }
            if (total && blue / total > 0.5) return label;
        }
        return null;
    }

    // Taps tab `tab` and checks it carries selected="true", and that its sub-tabs are as expected:
    // Standalone + Consolidated on Ratios/Key Parameters, none on Performance.
    async clickTab(tab) {
        const node = (await this.getDescribedElements()).find(n => n.desc.startsWith(`${tab}\nTab `));
        if (!node) {
            console.log(`Peer Comparison "${tab}" tab not found: FAIL`);
            return false;
        }
        await this.tapNode(node);
        await this.pause(1500);
        let selected = false;
        try {
            const el = await this.driver.$(`//*[starts-with(@content-desc,"${tab}") and contains(@content-desc,"Tab ")]`);
            selected = (await el.getAttribute('selected')) === 'true';
        } catch (_) { /* logged as FAIL below */ }
        const nodes = await this.getDescribedElements();
        const subTabs = PEER_SUB_TABS.filter(s => nodes.some(n => n.desc === s));
        const expected = PEER_TABS_WITH_SUB_TABS.includes(tab) ? PEER_SUB_TABS : [];
        const subTabsOk = subTabs.length === expected.length;
        console.log(`Peer Comparison "${tab}" tab selected: ${selected ? 'PASS' : 'FAIL'}`);
        console.log(`  Sub-tabs displayed: ${subTabs.join(', ') || 'none'} - ${subTabsOk ? 'PASS' : `FAIL (expected ${expected.join(', ') || 'none - symbols only'})`}`);
        return selected && subTabsOk;
    }

    async clickSubTab(label) {
        const node = (await this.getDescribedElements()).find(n => n.desc === label);
        if (!node) {
            console.log(`Peer Comparison "${label}" sub-tab not found: FAIL`);
            return false;
        }
        await this.tapNode(node);
        await this.pause(1500);
        const selected = await this.getSelectedSubTab();
        console.log(`"${label}" sub-tab selected (selected: ${selected || 'none'}): ${selected === label ? 'PASS' : 'FAIL'}`);
        return selected === label;
    }

    // Fails when nothing is listed; otherwise taps the first symbol and returns it (the Quote it
    // opens is checked by the caller).
    async tapFirstSymbol(context) {
        const symbols = await this.waitForSymbols();
        console.log(`${context} - symbols listed (${symbols.length}): ${symbols.map(s => s.desc.trim()).join(', ') || 'none'} - ${symbols.length ? 'PASS' : 'FAIL'}`);
        if (!symbols.length) return null;
        await this.tapNode(symbols[0]);
        const symbol = symbols[0].desc.trim();
        console.log(`Clicked the first symbol: ${symbol}`);
        return symbol;
    }

    // One back-press from a Quote opened here returns to this screen, on the same tab/sub-tab
    // (verified live).
    async navigateBackFromQuote() {
        await this.driver.back();
        await this.pause(1200);
        const back = await this.isDisplayed(4000);
        console.log(`Navigated back from Quote to Peer Comparison: ${back ? 'PASS' : 'FAIL'}`);
        return back;
    }

    // Back from here lands on the Advanced Options sheet, and once more on the Quote it was opened
    // from (verified live).
    async close(quoteSelector, maxBackPresses = 3) {
        for (let i = 0; i < maxBackPresses; i++) {
            await this.driver.back();
            await this.pause(1000);
            const onQuote = await this.isElementVisible(quoteSelector, 1500)
                && !(await this.isElementVisible('android=new UiSelector().description("Scrim")', 500));
            if (onQuote) {
                console.log('Closed Peer Comparison - back on the Quote screen: PASS');
                return true;
            }
        }
        console.log('Could not get back to the Quote screen from Peer Comparison: FAIL');
        return false;
    }
}

module.exports = { PeerComparisonPage, PEER_TABS, PEER_SUB_TABS, PEER_TABS_WITH_SUB_TABS };
