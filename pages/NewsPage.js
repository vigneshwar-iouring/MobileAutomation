const BasePage = require('./BasePage');

// News date headers read like "28 Oct 2026" (current app) or the older "7th Aug" / "31st Jul" - day +
// optional ordinal suffix + month abbreviation + optional year. MONTHS lets that be turned into a real
// Date so it can be compared against today.
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

function parseNewsDateHeader(text) {
    const m = text.trim().match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)(?:\s+(\d{4}))?/);
    if (!m) return null;
    const month = MONTHS[m[2].slice(0, 3).toUpperCase()];
    if (month === undefined) return null;

    const day = Number(m[1]);
    if (m[3]) return new Date(Number(m[3]), month, day);
    const now = new Date();
    let date = new Date(now.getFullYear(), month, day);
    // The header carries no year - if reading it against the current year lands more than a
    // couple of days in the future (e.g. today is early Jan and the header says "31st Dec"),
    // the news is actually from the year before.
    if (date.getTime() - now.getTime() > 2 * 24 * 60 * 60 * 1000) {
        date = new Date(now.getFullYear() - 1, month, day);
    }
    return date;
}

// "03:43:59 PM" -> {hours, minutes, seconds} in 24h form, for stitching onto the date header when
// checking whether the latest entry is in the future.
function parseTimeOfDay(text) {
    const m = text.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return null;
    let hours = Number(m[1]) % 12;
    if (/pm/i.test(m[4])) hours += 12;
    return { hours, minutes: Number(m[2]), seconds: Number(m[3]) };
}

// Every tab except "All" tags each of its own entries with its own name (e.g. every entry under
// "Equity" carries an "Equity" tag) - "All" is the merged view and is expected to mix every tag.
const NEWS_TAGS = ['Result', 'Block Deals', 'Equity', 'Commentary', 'Global', 'Fixed Income', 'Commodities'];

// Each feed entry ends with its own "time\ntag" lines - either as a node of its own (Block Deals:
// "11:54:26 AM\nBlock Deals", headline in separate nodes) or as the tail of the headline node
// (Equity: "...Payment Is Made.\n11:42:20 AM\nEquity"). The feed used to be one merged content-desc
// blob - it isn't any more (see ui_dumps/news_*.xml), so entries are read node by node in
// on-screen order.
const ENTRY_PATTERN = /(?:^|\n)(\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM))\n([^\n]+)$/i;
const DATE_HEADER_PATTERN = /^\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+(?:\s+\d{4})?$/;

class NewsPage extends BasePage {
    constructor(driver) {
        super(driver);
        this.hamburgerMenu = 'android=new UiSelector().description("Hamburger menu, Double tap to open the hamburger menu")';
        this.newsMenuOption = 'android=new UiSelector().descriptionContains("News")';
        // "All" is always the leftmost, default-selected tab the instant the News screen renders,
        // so its chip is a reliable "has the screen loaded" signal (descriptionMatches regexes
        // against multi-line content-desc values were unreliable through the UiAutomator2 driver).
        this.firstTabLoaded = 'android=new UiSelector().descriptionContains("Tab 1 of")';
        // The News screen's only top-left affordance is this back arrow (rendered as an X in the
        // app's UI) - there's no separate "Close" element like the Research Calls dialog has.
        this.closeButton = 'android=new UiSelector().description("Back, Double tap to go back")';

        // Fixed left-to-right tab order. Only the first ~5 are visible at once - clicking a tab
        // auto-scrolls the strip, bringing later tabs into the accessibility tree, so visiting
        // them in this order (rather than swiping the strip directly) is what actually works.
        this.tabNames = ['All', 'Result', 'Block Deals', 'Equity', 'Commentary', 'Global', 'Fixed Income', 'Commodities'];

        // Date header (e.g. "21st Aug") is a separate element pinned below the search bar, not part
        // of the scrollable feed's own content-desc - its content-desc is just the date text, so
        // matching the whole description against this pattern (rather than .contains) is what keeps
        // it from also matching the feed's own much longer content-desc blob.
        this.stickyDateHeader = 'android=new UiSelector().className("android.view.View").descriptionMatches("^[0-9]{1,2}(st|nd|rd|th)? [A-Za-z]+( [0-9]{4})?$")';

        // Search bar affordance - a full-width Button (bounds confirmed via live inspection) that
        // becomes the editable, focused search field itself once clicked; the app exposes no
        // content-desc for it, so it's addressed by its position among Buttons on screen.
        this.searchButton = 'android=new UiSelector().className("android.widget.Button").instance(1)';
    }

    async clickHamburgerMenu(timeout = 8000) {
        await this.click(this.hamburgerMenu, timeout);
        console.log('Clicked hamburger menu');
    }

    async clickNewsOption(timeout = 8000) {
        await this.click(this.newsMenuOption, timeout);
        console.log('Clicked News option');
    }

    async clickClose(timeout = 5000) {
        await this.click(this.closeButton, timeout);
        console.log('Clicked X (top-left) to close News screen');
    }

    // Waits up to `timeout` for the News screen's tab strip to render - the signal that the
    // screen actually loaded, rather than a fixed sleep.
    async waitForLoaded(timeout = 10000) {
        const loaded = await this.isElementVisible(this.firstTabLoaded, timeout);
        console.log(loaded ? 'News screen loaded within wait time' : `News screen did not load within ${timeout}ms`);
        return loaded;
    }

    // Tab chips ("Name\nTab X of 8") sit earlier in the view tree than the news feed content, so
    // the first descriptionContains(name) match is always the chip - even though the feed's own
    // content-desc also contains every tab name as an inline category label further down.
    async clickTab(name, timeout = 5000) {
        await this.click(`android=new UiSelector().descriptionContains("${name}")`, timeout);
        console.log(`Clicked "${name}" tab`);
    }

    // Overrides BasePage.scrollUp(selector, maxScrolls), which boundary-scrolls a list until it
    // stops changing - the feed here is one static content-desc blob, not a list, and the flow
    // only wants a single swipe up (matching the single-swipe scrollDown() already used per tab).
    async scrollUp() {
        await this.swipe('up');
    }

    // Reads the fixed date label pinned below the search bar - independent of whichever entry the
    // scrollable feed currently happens to have at the top.
    async getStickyDateHeaderText() {
        const el = await this.driver.$(this.stickyDateHeader);
        const visible = await el.isDisplayed().catch(() => false);
        if (!visible) return null;
        return (await el.getAttribute('content-desc').catch(() => null)) || (await el.getText().catch(() => null)) || null;
    }

    async clickSearchBar(timeout = 5000) {
        await this.click(this.searchButton, timeout);
        console.log('Clicked News search bar');
    }

    // This app doesn't render the search field as a separate EditText/AutoCompleteTextView - the
    // search bar Button itself becomes the editable, focused text field once clicked (confirmed via
    // its own "text" attribute correctly reflecting what's typed, and the feed actually filtering
    // live). So typing goes into the same element clickSearchBar() clicked, not a different one.
    async searchNews(query, timeout = 5000) {
        const el = await this.findElement(this.searchButton, timeout);
        await el.click();
        await this.pause(300);
        for (const char of query) {
            await this.driver.keys(char);
            await this.pause(150);
        }
        console.log(`Typed "${query}" into News search`);
        await this.pause(1000);

        const fieldText = await el.getAttribute('text').catch(() => null);
        console.log(`Search field now reads: "${fieldText || ''}"`);
        if (fieldText !== query) {
            console.log(`WARNING - search field does not contain "${query}" after typing - the keystrokes may not have landed on the right element`);
        }
    }

    // A single back press closes the search UI's chrome but leaves its query filter still applied
    // to the feed underneath (confirmed live - every tab visited afterwards falsely reported "No
    // Data Found" except the one tab the filtered article happened to belong to) - clearing the
    // typed text first is what actually resets the feed back to unfiltered before backing out.
    async closeSearch() {
        const el = await this.driver.$(this.searchButton).catch(() => null);
        if (el) {
            const current = (await el.getAttribute('text').catch(() => '')) || '';
            for (let i = 0; i < current.length; i++) {
                await this.driver.pressKeyCode(67); // KEYCODE_DEL
            }
            await this.pause(300);
        }
        await this.driver.back();
        await this.pause(500);
        console.log('Closed News search');
    }

    // Checks the search term is both listed (appears in at least one result's content-desc) and,
    // where the app exposes the match as its own accessibility node rather than only as an inline
    // color/style span invisible to the accessibility tree, highlighted as a distinct match node.
    async verifyNewsSearchResults(query) {
        const nodes = await this.getDescribedElements();
        const listed = nodes.filter(n => n.desc.toLowerCase().includes(query.toLowerCase()));
        const highlighted = nodes.filter(n => n.desc.trim() === query);

        console.log(`News search results for "${query}": ${listed.length} listed result node(s)`);
        listed.forEach(n => console.log(`  - ${n.desc}`));
        console.log(listed.length ? `PASS - "${query}" is listed` : `FAIL - "${query}" not found in any listed result`);

        if (highlighted.length) {
            console.log(`PASS - "${query}" found as its own highlighted node (${highlighted.length} occurrence(s))`);
        }

        return { listed, highlighted, isListed: listed.length > 0, isHighlighted: highlighted.length > 0 };
    }

    async isNoDataFound() {
        const source = await this.driver.getPageSource();
        return /no data found|no news found/i.test(source);
    }

    // Visible entries top-to-bottom (newest first), each paired with the date it was published on.
    // The topmost date header is the sticky one pinned under the tab strip - it belongs to the
    // topmost entry; any further date header lower down starts a new (older) day for the entries
    // below it. Pairing each time with its OWN day matters: mixing today's header with an older
    // day's time is what made a past entry look like it was "in the future".
    async getFeedEntries() {
        const nodes = (await this.getDescribedElements()).sort((a, b) => a.y1 - b.y1);
        const dateNodes = nodes.filter(n => DATE_HEADER_PATTERN.test(n.desc.trim()));
        const sticky = dateNodes[0] || null;
        let currentDate = sticky ? sticky.desc.trim() : null;
        const entries = [];
        for (const n of nodes) {
            if (sticky && n !== sticky && n.y1 >= sticky.y2 && DATE_HEADER_PATTERN.test(n.desc.trim())) {
                currentDate = n.desc.trim();
                continue;
            }
            const m = n.desc.trim().match(ENTRY_PATTERN);
            if (m) entries.push({ time: m[1], tag: m[2].trim(), date: currentDate });
        }
        return { stickyDate: sticky ? sticky.desc.trim() : null, entries };
    }

    // Reads the date header at the very top of the feed (the latest news item, since entries run
    // newest-first), reports whether it's today or earlier, and cross-checks every entry's tag:
    // every tab except "All" should only ever show its own tag; "All" is allowed to mix multiple
    // different tags, but every one of them must still be a real, known category tag.
    async getFeedSummary(tabName) {
        const empty = { raw: null, date: null, latestTime: null, isPastOrNow: null, isWithinLast10Days: null, entryCount: 0, distinctTags: [], mismatches: [] };
        if (await this.isNoDataFound()) {
            console.log('No Data Found for this tab');
            return { ...empty, noData: true };
        }

        const { stickyDate, entries } = await this.getFeedEntries();
        // The latest entry is the topmost one, dated by its own section header (the sticky one).
        const latestTime = entries[0] ? entries[0].time : null;
        const headerLine = (entries[0] && entries[0].date) || stickyDate || (await this.getStickyDateHeaderText());
        const date = headerLine ? parseNewsDateHeader(headerLine) : null;
        if (!date) {
            console.log(`FAIL: could not parse a date header from feed (got: "${headerLine}") - the header format may have changed`);
            return { ...empty, raw: headerLine };
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let isPastOrNow = date.getTime() < today.getTime();
        if (!isPastOrNow && date.getTime() === today.getTime()) {
            // Same day - the date header alone can't say "in the future", the time has to.
            const timeOfDay = latestTime ? parseTimeOfDay(latestTime) : null;
            isPastOrNow = timeOfDay
                ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), timeOfDay.hours, timeOfDay.minutes, timeOfDay.seconds).getTime() <= Date.now()
                : true; // no parseable time to contradict the date - don't fail on that basis
        }
        console.log(`Latest news: "${headerLine}" ${latestTime || '(no time found)'} - ${isPastOrNow ? 'PASS (on or before now)' : 'FAIL (in the future)'}`);

        // The latest news item shown should also be recent, not stale - anything older than 10
        // days back from today is flagged as its own separate FAIL.
        const tenDaysAgo = new Date(today);
        tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
        const isWithinLast10Days = date.getTime() >= tenDaysAgo.getTime();
        console.log(`Latest news date within last 10 days: ${isWithinLast10Days ? 'PASS' : `FAIL (older than 10 days: "${headerLine}")`}`);

        const distinctTags = [...new Set(entries.map(e => e.tag))];
        let mismatches = [];
        if (tabName === 'All') {
            // "All" is expected to mix multiple different tags (one per category) - that's not a
            // mismatch. What IS worth failing on is any tag value that isn't one of the real
            // category names at all (which would mean the tag-extraction pattern itself is broken).
            mismatches = entries.filter(e => !NEWS_TAGS.includes(e.tag));
            console.log(`"${tabName}" tab contains tags: ${distinctTags.join(', ') || '(none found)'}`);
            if (!entries.length) {
                console.log(`FAIL: no time/tag entries could be read for "${tabName}" (tab has data, so the feed layout may have changed)`);
            } else if (!mismatches.length) {
                console.log(`All ${entries.length} tag(s) under "${tabName}" are valid category tags (PASS)`);
            } else {
                const badTags = [...new Set(mismatches.map(e => e.tag))];
                console.log(`FAIL: ${mismatches.length}/${entries.length} entries under "${tabName}" carry an unrecognized tag: ${badTags.join(', ')}`);
            }
        } else {
            mismatches = entries.filter(e => e.tag !== tabName);
            if (!entries.length) {
                console.log(`FAIL: no time/tag entries could be read for "${tabName}" (tab has data, so the feed layout may have changed)`);
            } else if (!mismatches.length) {
                console.log(`All ${entries.length} tag(s) under "${tabName}" match the tab (PASS)`);
            } else {
                const badTags = [...new Set(mismatches.map(e => e.tag))];
                console.log(`FAIL: ${mismatches.length}/${entries.length} entries under "${tabName}" carry a mismatched tag: ${badTags.join(', ')}`);
            }
        }

        return { raw: headerLine, date, latestTime, isPastOrNow, isWithinLast10Days, entryCount: entries.length, distinctTags, mismatches };
    }
}

module.exports = { NewsPage, parseNewsDateHeader };
