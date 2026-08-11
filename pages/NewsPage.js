const BasePage = require('./BasePage');

// News date headers read like "7th Aug" / "31st Jul" - day + ordinal suffix + month abbreviation,
// no year. MONTHS lets that be turned into a real Date so it can be compared against today.
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

function parseNewsDateHeader(text) {
    const m = text.trim().match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)/);
    if (!m) return null;
    const month = MONTHS[m[2].slice(0, 3).toUpperCase()];
    if (month === undefined) return null;

    const day = Number(m[1]);
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

// The feed is one content-desc blob per tab, entries running newest-first as repeating
// [optional headline] / time / tag groups (e.g. "...Kubota Branding Soon.\n03:35:05 PM\nEquity\n
// 03:33:23 PM\nResult\n..."). The headline is often missing entirely between two entries, so the
// only reliable anchor is a timestamp immediately followed by one of the known tag names.
function extractEntries(feedText) {
    const tagAlternation = NEWS_TAGS.join('|');
    const pattern = new RegExp(`(\\d{1,2}:\\d{2}:\\d{2}\\s*(?:AM|PM))\\n(${tagAlternation})`, 'g');
    const entries = [];
    let match;
    while ((match = pattern.exec(feedText)) !== null) {
        entries.push({ time: match[1], tag: match[2] });
    }
    return entries;
}

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

    async isNoDataFound() {
        const source = await this.driver.getPageSource();
        return /no data found|no news found/i.test(source);
    }

    // The entire feed for a tab is one merged content-desc (not per-item cards) starting with a
    // date header - the longest content-desc on screen is always this feed node.
    async getFeedText() {
        const source = await this.driver.getPageSource();
        const descs = [...source.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1]);
        if (!descs.length) return null;
        const longest = descs.reduce((a, b) => (b.length > a.length ? b : a), '');
        return longest.replace(/&#10;/g, '\n').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    }

    // Reads the date header at the very top of the feed (the latest news item, since entries run
    // newest-first), reports whether it's today or earlier, and cross-checks every entry's tag
    // against `tabName` - every tab except "All" should only ever show its own tag.
    async getFeedSummary(tabName) {
        const empty = { raw: null, date: null, latestTime: null, isPastOrNow: null, entryCount: 0, distinctTags: [], mismatches: [] };
        if (await this.isNoDataFound()) {
            console.log('No Data Found for this tab');
            return empty;
        }

        const feedText = await this.getFeedText();
        const headerLine = feedText ? feedText.split('\n')[0].trim() : null;
        const date = headerLine ? parseNewsDateHeader(headerLine) : null;
        if (!date) {
            console.log(`Could not parse a date header from feed (got: "${headerLine}")`);
            return { ...empty, raw: headerLine };
        }

        const entries = extractEntries(feedText);
        const latestTime = entries[0] ? entries[0].time : null;

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

        const distinctTags = [...new Set(entries.map(e => e.tag))];
        let mismatches = [];
        if (tabName === 'All') {
            console.log(`"${tabName}" tab contains tags: ${distinctTags.join(', ') || '(none found)'}`);
        } else {
            mismatches = entries.filter(e => e.tag !== tabName);
            if (!entries.length) {
                console.log(`No tagged entries found to validate for "${tabName}"`);
            } else if (!mismatches.length) {
                console.log(`All ${entries.length} tag(s) under "${tabName}" match the tab (PASS)`);
            } else {
                const badTags = [...new Set(mismatches.map(e => e.tag))];
                console.log(`FAIL: ${mismatches.length}/${entries.length} entries under "${tabName}" carry a mismatched tag: ${badTags.join(', ')}`);
            }
        }

        return { raw: headerLine, date, latestTime, isPastOrNow, entryCount: entries.length, distinctTags, mismatches };
    }
}

module.exports = { NewsPage, parseNewsDateHeader };
