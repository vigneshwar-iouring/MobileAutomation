const { expect } = require('chai');
const fs   = require('fs');
const path = require('path');

const SCREENSHOT_DIR = path.join(__dirname, '../../reports/screenshots');

class BasePage {

  // ── Element access ──────────────────────────────────────────────────────────

  async waitForElement(selector, timeout = 5000) {
    const el = await $(selector);
    await el.waitForDisplayed({ timeout });
    return el;
  }

  async isDisplayed(selector, timeout = 5000) {
    try {
      return await (await $(selector)).waitForDisplayed({ timeout });
    } catch {
      return false;
    }
  }

  // Polls condFn (returning a boolean) every intervalMs until truthy or timeout.
  async pollUntil(condFn, timeout = 10000, intervalMs = 500) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await condFn()) return true;
      await browser.pause(intervalMs);
    }
    return false;
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  async click(selector) {
    await this._tap(await this.waitForElement(selector));
  }

  async _tap(el) {
    try { await el.click(); } catch {}
  }

  async setValue(selector, value) {
    const el = await this.waitForElement(selector);
    await el.clearValue();
    await el.setValue(value);
  }

  async getText(selector) {
    return (await this.waitForElement(selector)).getText();
  }

  async hideKeyboard() {
    try { await driver.hideKeyboard(); } catch {}
  }

  // ── Find-and-act helpers (non-throwing) ──────────────────────────────────────
  // Each method waits up to `timeout` for the element.
  // Returns true if element was found and action was taken, false if not found.
  // Safe to call in optional/conditional flows — never throws.

  // Wait for element; if found, tap it.
  async findAndTap(selector, timeout = 5000) {
    try {
      const el = await $(selector);
      await el.waitForDisplayed({ timeout });
      await this._tap(el);
      return true;
    } catch {
      return false;
    }
  }

  // Wait for element; if found, clear it and type the value.
  async findAndSetValue(selector, value, timeout = 5000) {
    try {
      const el = await $(selector);
      await el.waitForDisplayed({ timeout });
      await el.clearValue();
      await el.setValue(String(value));
      return true;
    } catch {
      return false;
    }
  }

  // Wait for element; if found, return its text — returns null if not found.
  async findAndGetText(selector, timeout = 5000) {
    try {
      const el = await $(selector);
      await el.waitForDisplayed({ timeout });
      return await el.getText();
    } catch {
      return null;
    }
  }

  // Wait for element; if found, return its attribute value — returns null if not found.
  async findAndGetAttribute(selector, attribute, timeout = 5000) {
    try {
      const el = await $(selector);
      await el.waitForDisplayed({ timeout });
      return await el.getAttribute(attribute);
    } catch {
      return null;
    }
  }

  // Wait for element; if found, run an arbitrary async callback(el) on it.
  // Useful for custom one-off actions without adding a new method every time.
  async findAndDo(selector, action, timeout = 5000) {
    try {
      const el = await $(selector);
      await el.waitForDisplayed({ timeout });
      await action(el);
      return true;
    } catch {
      return false;
    }
  }

  // Walk through an array of { selector, action } steps in order.
  // Each step waits up to `timeout`; if the element is found the action runs,
  // then execution moves to the next step regardless of the outcome.
  // Returns an array of booleans — one per step — indicating which were found.
  async findAndActSequence(steps, timeout = 5000) {
    const results = [];
    for (const { selector, action } of steps) {
      let found = false;
      try {
        const el = await $(selector);
        await el.waitForDisplayed({ timeout });
        await action(el);
        found = true;
      } catch {}
      results.push(found);
    }
    return results;
  }

  // ── Scroll / swipe ──────────────────────────────────────────────────────────

  async swipeUp() {
    const { width, height } = await browser.getWindowSize();
    await browser.action('pointer', { parameters: { pointerType: 'touch' } })
      .move({ x: Math.round(width / 2), y: Math.round(height * 0.8) })
      .down().pause(200)
      .move({ x: Math.round(width / 2), y: Math.round(height * 0.2), duration: 600 })
      .up().perform();
  }

  async swipeDown() {
    const { width, height } = await browser.getWindowSize();
    await browser.action('pointer', { parameters: { pointerType: 'touch' } })
      .move({ x: Math.round(width / 2), y: Math.round(height * 0.2) })
      .down().pause(200)
      .move({ x: Math.round(width / 2), y: Math.round(height * 0.8), duration: 600 })
      .up().perform();
  }

  async scrollToElement(selector) {
    const el = await $(selector);
    await el.scrollIntoView();
    return el;
  }

  // ── Assertions ───────────────────────────────────────────────────────────────

  async assertText(selector, expectedText) {
    expect(await this.getText(selector)).to.equal(expectedText);
  }

  async assertDisplayed(selector) {
    expect(await this.isDisplayed(selector)).to.be.true;
  }

  // ── Reporting ────────────────────────────────────────────────────────────────

  async takeScreenshot(name) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await browser.saveScreenshot(path.join(SCREENSHOT_DIR, `${name}-${Date.now()}.png`));
  }
}

module.exports = BasePage;
