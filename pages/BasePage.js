class BasePage {
    constructor(driver) {
        this.driver = driver;
    }

    async findElement(selector, timeout = 10000) {
        const el = await this.driver.$(selector);
        await el.waitForDisplayed({ timeout });
        return el;
    }

    async enterText(selector, text, timeout = 10000) {
        const el = await this.findElement(selector, timeout);
        await el.clearValue();
        await el.setValue(text);
    }

    async click(selector, timeout = 10000) {
        const el = await this.findElement(selector, timeout);
        await el.waitForEnabled({ timeout });
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

    async scrollDown() {
        const { width, height } = await this.driver.getWindowSize();
        await this.driver.action('pointer')
            .move({ duration: 0, x: Math.floor(width / 2), y: Math.floor(height * 0.7) })
            .down()
            .move({ duration: 800, x: Math.floor(width / 2), y: Math.floor(height * 0.3) })
            .up()
            .perform();
    }

    async scrollUp(maxScrolls = 20) {
        const { width, height } = await this.driver.getWindowSize();
        let previousSource = null;
        for (let i = 0; i < maxScrolls; i++) {
            const currentSource = await this.driver.getPageSource();
            if (currentSource === previousSource) break;
            previousSource = currentSource;
            await this.driver.action('pointer')
                .move({ duration: 0, x: Math.floor(width / 2), y: Math.floor(height * 0.3) })
                .down()
                .move({ duration: 800, x: Math.floor(width / 2), y: Math.floor(height * 0.7) })
                .up()
                .perform();
            await this.driver.pause(300);
        }
    }

    async pause(ms) {
        await this.driver.pause(ms);
    }
}

module.exports = BasePage;
