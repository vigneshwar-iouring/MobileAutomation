class BasePage {
    constructor(driver) {
        this.driver = driver;
    }

    async findElement(selector, timeout = 3000) {
        const el = await this.driver.$(selector);
        await el.waitForDisplayed({ timeout });
        return el;
    }

    async enterText(selector, text, timeout = 3000) {
        const el = await this.findElement(selector, timeout);
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
    stableEntryId(desc) {
        if (!desc) return desc;
        const idx = desc.indexOf('Returns %');
        return idx === -1 ? desc : desc.slice(0, idx);
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
