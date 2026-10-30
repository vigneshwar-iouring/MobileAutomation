const BasePage = require('./BasePage');

// Result rows - both under Markets > Results and on its "See all" (Market Results) screen - are
// one node each: " KANOHAR. date 06 Oct 2026. Last traded price 942.50. Change ..., Double tap to
// view KANOHAR details, or swipe right for next category". The " date " part is what sets them
// apart from the other symbol rows on Markets (movers, Stock In Range, recently viewed...).
const RESULT_ROW = /^\s*(\S+)\. date (\d{1,2} [A-Za-z]{3} \d{4})\./;
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

function isResultRow(desc) {
    return RESULT_ROW.test(desc) && /Double tap to view/.test(desc);
}

// Returns { symbol, dateText, date } - date is a local-midnight Date, or null if unparseable.
function parseResultRow(desc) {
    const m = desc.match(RESULT_ROW);
    if (!m) return null;
    const [day, mon, year] = m[2].split(' ');
    const month = MONTHS[mon.toUpperCase()];
    const date = month === undefined ? null : new Date(Number(year), month, Number(day));
    return { symbol: m[1], dateText: m[2], date };
}

// "See all" Results screen: titled "Market Results", rows grouped under date headers
// ("06 Oct 2026"), each row repeating its own result date.
class ResultsPage extends BasePage {
    constructor(driver) {
        super(driver);
        this.title = 'android=new UiSelector().description("Market Results")';
        this.backButton = 'android=new UiSelector().description("Back, Double tap to go back")';
    }

    async isOpen(timeout = 8000) {
        const opened = await this.isElementVisible(this.title, timeout);
        console.log(`Market Results screen opened: ${opened ? 'PASS' : 'FAIL'}`);
        return opened;
    }

    async getVisibleResults() {
        const nodes = await this.getDescribedElements();
        return nodes.filter(n => isResultRow(n.desc)).map(n => ({ ...parseResultRow(n.desc), node: n }));
    }

    // Scrolls through the whole list collecting every result (keyed by symbol + date, so rows
    // seen on more than one screen are counted once). Stops after two swipes add nothing new.
    async collectAllResults(maxScrolls = 30) {
        const all = new Map();
        let idle = 0;
        for (let i = 0; i <= maxScrolls && idle < 2; i++) {
            const before = all.size;
            for (const r of await this.getVisibleResults()) {
                const key = `${r.symbol}|${r.dateText}`;
                if (!all.has(key)) all.set(key, { symbol: r.symbol, dateText: r.dateText, date: r.date });
            }
            idle = all.size === before ? idle + 1 : 0;
            if (i < maxScrolls && idle < 2) {
                await this.swipe('down');
                await this.pause(700);
            }
        }
        console.log(`Collected ${all.size} result(s) from the Market Results list`);
        return [...all.values()];
    }

    // Every listed result date must be today or later (compared by calendar day). Logs each
    // past-dated row as FAIL and returns true only if none were found.
    verifyDatesTodayOrFuture(results) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const bad = results.filter(r => !r.date || r.date < today);
        bad.forEach(r => console.log(`Result date for ${r.symbol}: ${r.dateText} - FAIL (${r.date ? 'before today' : 'unparseable'})`));
        const dates = [...new Set(results.map(r => r.dateText))];
        console.log(`Result dates listed: ${dates.join(', ') || 'none'}`);
        const ok = results.length > 0 && bad.length === 0;
        console.log(`All ${results.length} result date(s) are today or in the future: ${ok ? 'PASS' : 'FAIL'}`);
        return ok;
    }

    // The list runs to 100+ rows, and scrollToBoundaryByMovement('up') was seen to stop partway
    // back (it landed on a 23 Oct row instead of the 06 Oct top). Quick flings cover far more
    // ground per swipe; the top is reached once a fling no longer changes the visible rows.
    async scrollToTop(maxFlings = 25) {
        const { width, height } = await this.driver.getWindowSize();
        const x = Math.floor(width / 2);
        const signature = async () => (await this.getVisibleResults()).map(r => `${r.symbol}|${r.dateText}`).join(',');
        let previous = await signature();
        for (let i = 0; i < maxFlings; i++) {
            await this.driver.action('pointer', { parameters: { pointerType: 'touch' } })
                .move({ duration: 0, x, y: Math.floor(height * 0.3) })
                .down()
                .move({ duration: 150, x, y: Math.floor(height * 0.85) })
                .up()
                .perform();
            await this.pause(900);
            const current = await signature();
            if (current === previous) return true;
            previous = current;
        }
        return false;
    }

    // Taps the first result in the list (scrolling back to the top first) and returns it. Pass the
    // first row seen before any scrolling (collectAllResults()[0]) to confirm the top was reached.
    async tapFirstResult(expectedFirst = null) {
        await this.scrollToTop();
        const [first] = await this.getVisibleResults();
        if (!first) return null;
        if (expectedFirst) {
            const same = first.symbol === expectedFirst.symbol && first.dateText === expectedFirst.dateText;
            console.log(`Back at the top of Market Results (first row ${first.symbol}, ${first.dateText}): ${same ? 'PASS' : `FAIL (expected ${expectedFirst.symbol}, ${expectedFirst.dateText})`}`);
        }
        await this.tapNode(first.node);
        console.log(`Tapped first result on Market Results: ${first.symbol} (${first.dateText})`);
        return { symbol: first.symbol, dateText: first.dateText, date: first.date };
    }
}

module.exports = { ResultsPage, isResultRow, parseResultRow };
