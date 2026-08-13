const { execFileSync } = require('child_process');

class BasePage {
    constructor(driver) {
        this.driver = driver;
    }

    getDeviceUdid() {
        const caps = this.driver.capabilities || {};
        return caps['appium:udid'] || caps.udid;
    }

    // Some custom-drawn controls (e.g. a Jetpack Compose canvas whose own accessibility label
    // literally says "Double tap to search") never register as clicked via Appium's click(),
    // setValue(), or even the `mobile: doubleClickGesture` command - all three were tried against
    // the Mutual Funds Explore search bar and left it completely inert. A raw adb double-tap (two
    // separate `input tap` processes, whose own spawn latency happens to land inside Android's
    // double-tap timing window) reaches the same gesture detector a real finger would, and is the
    // only method observed to actually focus/open the keyboard for that control.
    adbDoubleTap(x, y) {
        const udid = this.getDeviceUdid();
        const args = ['-s', udid, 'shell', 'input', 'tap', String(x), String(y)];
        execFileSync('adb', args);
        execFileSync('adb', args);
    }

    adbTap(x, y) {
        const udid = this.getDeviceUdid();
        execFileSync('adb', ['-s', udid, 'shell', 'input', 'tap', String(x), String(y)]);
    }

    adbTypeText(text) {
        const udid = this.getDeviceUdid();
        execFileSync('adb', ['-s', udid, 'shell', 'input', 'text', text]);
    }

    adbBackspace(times) {
        const udid = this.getDeviceUdid();
        for (let i = 0; i < times; i++) {
            execFileSync('adb', ['-s', udid, 'shell', 'input', 'keyevent', '67']);
        }
    }

    async findElement(selector, timeout = 3000) {
        const el = await this.driver.$(selector);
        await el.waitForDisplayed({ timeout });
        return el;
    }

    async enterText(selector, text, timeout = 3000) {
        const el = await this.findElement(selector, timeout);
        // Focusing before typing matters here: setValue() without a prior click can update the
        // EditText's own text (so it reads back correctly right after) without the app's own
        // form state ever seeing a change event - so on submit it still treats the field as empty.
        await el.click();
        await el.clearValue();
        await el.setValue(text);
    }

    async click(selector, timeout = 5000) {
        const el = await this.driver.$(selector);
        // waitForClickable is browser-only in WebdriverIO and throws on native Appium sessions,
        // so both conditions are polled together by hand in one loop instead - this still clicks
        // the instant the element is interactable, without chaining a displayed-wait and a
        // separate enabled-wait back to back (which could double the worst-case latency).
        await this.driver.waitUntil(
            async () => (await el.isDisplayed().catch(() => false)) && (await el.isEnabled().catch(() => false)),
            { timeout, interval: 200, timeoutMsg: `Element not clickable in time: ${selector}` }
        );
        await el.click();
    }

    async isElementVisible(selector, timeout = 5000) {
        try {
            const el = await this.driver.$(selector);
            await el.waitForDisplayed({ timeout });
            return await el.isDisplayed();
        } catch (_) {
            return false;
        }
    }

    async swipe(direction) {
        const { width, height } = await this.driver.getWindowSize();
        const x = Math.floor(width / 2);
        const [fromY, toY] = direction === 'up'
            ? [Math.floor(height * 0.3), Math.floor(height * 0.7)]
            : [Math.floor(height * 0.7), Math.floor(height * 0.3)];

        await this.driver.action('pointer')
            .move({ duration: 0, x, y: fromY })
            .down()
            .move({ duration: 800, x, y: toY })
            .up()
            .perform();
    }

    async scrollDown() {
        await this.swipe('down');
    }

    // Entry cards embed live market data in their content-desc (e.g. "...Returns % : \n8.73 %\n
    // BUY\nREVISED\nEntry Price\n602.40\nStop Loss\n580.00\nLTP\n₹584.10") - the LTP, and the
    // return % derived from it, tick in real time. Comparing the raw content-desc across a scroll
    // attempt then never stabilizes: the same on-screen entry looks "changed" purely because the
    // price moved, so a boundary is never detected and the automation keeps swiping. Truncating at
    // the first "Returns %" keeps only what's fixed when the call is published (symbol, target,
    // company name) - still unique per entry, but immune to the ticker.
    //
    // The same problem hits a generic full-screen boundary-scroll (any descriptionMatches(".+")
    // selector) even harder: every screen in this app has a fixed Nifty/Sensex index ticker
    // ("Index Nifty 50. Last traded price: 24471.70...") that's always present regardless of
    // scroll depth and updates continuously, so its signature contribution never repeats - the
    // scroll never detects "nothing changed" and burns through every one of maxScrolls every time
    // instead of stopping as soon as the real boundary is reached. Truncating at "Last traded
    // price" the same way handles it identically.
    //
    // " category." (Explore tab's Category Solutions cards, e.g. "Equity category. Large-Cap
    // Funds...") reduces to just the category name for the same reason a caller would want the
    // stable id here: it's what should actually get counted/printed, not the full description.
    stableEntryId(desc) {
        if (!desc) return desc;
        for (const marker of ['Returns %', 'Last traded price', ' category.']) {
            const idx = desc.indexOf(marker);
            if (idx !== -1) return desc.slice(0, idx);
        }
        return desc;
    }

    // Joins every currently-visible matching element's stable id into one string. Comparing this
    // whole-batch signature across a scroll attempt is more reliable than comparing a single
    // top/bottom element: it isn't thrown off by a lone recycled/reordered view, so a real "nothing
    // moved" boundary is detected in exactly one confirmation swipe instead of drifting through
    // several redundant ones.
    async captureVisibleSignature(selector, seen) {
        const cards = await this.driver.$$(selector);
        const ids = [];
        for (const card of cards) {
            const desc = await card.getAttribute('content-desc').catch(() => '');
            const id = this.stableEntryId(desc);
            ids.push(id);
            if (seen && id) seen.add(id);
        }
        return ids.join('|');
    }

    // Reusable boundary-aware scroller shared by every tab/direction: swipes `direction` on
    // `selector`'s list until the visible signature stops changing, then stops immediately -
    // no extra confirmation pass beyond the one swipe needed to prove the boundary was reached.
    async scrollToBoundary(selector, direction, { maxScrolls = 20, settleMs = 300, seen } = {}) {
        let previousSignature = await this.captureVisibleSignature(selector, seen);
        for (let i = 0; i < maxScrolls; i++) {
            await this.swipe(direction);
            await this.driver.pause(settleMs);
            const signature = await this.captureVisibleSignature(selector, seen);
            if (signature === previousSignature) break;
            previousSignature = signature;
        }
    }

    async scrollUp(selector, maxScrolls = 20) {
        await this.scrollToBoundary(selector, 'up', { maxScrolls });
    }

    async pause(ms) {
        await this.driver.pause(ms);
    }

    // Parses the raw page source into {desc, x1,y1,x2,y2, clickable} for every element with a
    // non-empty content-desc, in document (== visual top-to-bottom) order. One XML fetch instead
    // of N per-element Appium round trips, and bounds/clickable let callers reason about layout
    // (grids, ordered pickers) that content-desc text alone can't express.
    async getDescribedElements() {
        const src = await this.driver.getPageSource();
        const tags = src.match(/<[\w.]+[^>]*>/g) || [];
        const nodes = [];
        for (const tag of tags) {
            const descMatch = tag.match(/content-desc="([^"]*)"/);
            const boundsMatch = tag.match(/bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/);
            if (!descMatch || !descMatch[1] || !boundsMatch) continue;
            const desc = descMatch[1]
                .replace(/&#10;/g, '\n')
                .replace(/&quot;/g, '"')
                .replace(/&apos;/g, "'")
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&');
            nodes.push({
                desc,
                x1: Number(boundsMatch[1]), y1: Number(boundsMatch[2]),
                x2: Number(boundsMatch[3]), y2: Number(boundsMatch[4]),
                clickable: /clickable="true"/.test(tag),
            });
        }
        return nodes;
    }

    // Clicks the Nth (1-based) clickable, described row in a top-to-bottom list/picker dialog -
    // e.g. a basket or watchlist selector - without needing a per-item selector. `exclude` filters
    // out non-item rows (a "New X" creation affordance) that aren't real list entries.
    async selectListItemByPosition(position, { exclude = [] } = {}) {
        const nodes = await this.getDescribedElements();
        const items = nodes
            .filter(n => n.clickable && n.desc && n.desc !== 'Scrim' && !exclude.includes(n.desc))
            .sort((a, b) => a.y1 - b.y1);
        const target = items[position - 1];
        if (!target) throw new Error(`List item #${position} not found (only ${items.length} selectable items visible)`);
        const el = await this.driver.$(`android=new UiSelector().description("${target.desc}")`);
        await el.click();
        return target.desc;
    }

    // Taps the center of a described element's own bounds directly, bypassing selector-based
    // lookup - needed when two elements share identical content-desc text (e.g. a Mutual Fund
    // detail screen's "Peer Comparison" and "Funds in this Category" sections both render
    // "Return period button. Currently showing 1 Year Return values...." whenever both default to
    // the same period) and a plain description() selector would hit whichever comes first.
    async tapNode(node) {
        const x = Math.round((node.x1 + node.x2) / 2);
        const y = Math.round((node.y1 + node.y2) / 2);
        await this.driver.action('pointer').move({ duration: 0, x, y }).down().up().perform();
    }

    // Finds the described element immediately to the right of `labelNode`, within the same row -
    // the layout used by e.g. Order Pad's "Approx margin:"/"Avail:" and the NEFT/RTGS/IMPS
    // dialog's "Beneficiary"/"Bank Name" rows, where a label and its value are side-by-side
    // siblings rather than stacked in separate label/value rows.
    findInlineValue(nodes, labelNode, rowTolerance = 15) {
        const sameRow = nodes.filter(n => n !== labelNode && Math.abs(n.y1 - labelNode.y1) <= rowTolerance && n.x1 > labelNode.x1);
        if (!sameRow.length) return null;
        sameRow.sort((a, b) => a.x1 - b.x1);
        return sameRow[0].desc.trim();
    }

    // Finds the nearest described element directly below `labelNode` in the same x-column - the
    // layout used by e.g. a Mutual Fund detail screen's NAV/Annualised header, where a label sits
    // above its value in a separate row rather than beside it in the same one (findInlineValue).
    // >= rather than > on the y-comparison: some layouts (e.g. an NFO's "Minimum Investment
    // Amount") stack the value with zero gap, its y1 landing exactly on the label's y2, and a
    // strict > would exclude the real value and fall through to something further down instead.
    findValueBelow(nodes, labelNode, xTolerance = 30) {
        const below = nodes.filter(n => n !== labelNode && n.y1 >= labelNode.y2 && Math.abs(n.x1 - labelNode.x1) <= xTolerance);
        if (!below.length) return null;
        below.sort((a, b) => a.y1 - b.y1);
        return below[0].desc.trim();
    }

    parseCurrency(text) {
        if (!text) return NaN;
        return parseFloat(text.replace(/[₹,\s]/g, ''));
    }

    // Polls the page source for `text` for a short window - used for toasts (e.g. "Added to
    // Watchlist") that vanish from the accessibility tree well under a second after appearing, so
    // a single getPageSource() taken even slightly late would miss it.
    async waitForToast(text, { timeout = 2000, interval = 150 } = {}) {
        try {
            await this.driver.waitUntil(async () => {
                const src = await this.driver.getPageSource();
                return src.includes(text);
            }, { timeout, interval });
            return true;
        } catch (_) {
            return false;
        }
    }
}

module.exports = BasePage;
