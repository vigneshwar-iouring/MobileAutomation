const BasePage = require('./BasePage');

const PIN_SELECTORS = [
  '//*[@resource-id="com.android.systemui:id/lockPassword"]',
  '//*[@resource-id="com.android.systemui:id/entry"]',
  '//*[@resource-id="com.android.settings:id/password_entry"]',
  '//*[@resource-id="com.android.settings:id/edit_text"]',
  '//android.widget.EditText',
];

const PIN_SCREEN_MARKERS = [
  'com.android.systemui:id/lockPassword',
  'com.android.systemui:id/entry',
  'com.android.settings:id/password_entry',
  'Authentication required',
  'Confirm your PIN',
  'Enter your PIN',
];

// Texts that indicate the system biometric face/touch overlay (not PIN input)
const BIOMETRIC_OVERLAY_MARKERS = [
  'Unlock with face or touch',
  'Verify identity',
];

// Buttons to dismiss the biometric overlay and fall back to PIN
const BIOMETRIC_CANCEL_SELECTORS = [
  '//android.widget.Button[contains(@content-desc,"cancel authentication")]',
  '//android.widget.Button[contains(@content-desc,"Cancel")]',
  '//android.widget.Button[contains(@text,"Use PIN")]',
  '//android.widget.Button[contains(@text,"Use password")]',
  '//android.widget.Button[contains(@text,"Use device")]',
];

class BiometricSetupPage extends BasePage {

  async _findPinField() {
    for (const sel of PIN_SELECTORS) {
      try {
        const el = await $(sel);
        if (await el.isDisplayed()) return el;
      } catch {}
    }
    return null;
  }

  async isLoaded(timeout = 10000) {
    return this.pollUntil(async () => {
      try {
        const src = await driver.getPageSource();
        return PIN_SCREEN_MARKERS.some(m => src.includes(m));
      } catch { return false; }
    }, timeout);
  }

  // Returns true if the page source contains the biometric face/touch overlay
  async _isBiometricOverlay() {
    try {
      const src = await driver.getPageSource();
      return BIOMETRIC_OVERLAY_MARKERS.some(m => src.includes(m));
    } catch { return false; }
  }

  // Cancels the biometric face/touch overlay and then enters the PIN fallback.
  // Call this when isLoaded() returns true but the screen shows face/touch auth.
  async handleBiometricAuth(pin) {
    if (!await this._isBiometricOverlay()) return false;

    for (const sel of BIOMETRIC_CANCEL_SELECTORS) {
      try {
        const btn = await $(sel);
        if (await btn.isDisplayed()) {
          await btn.click();
          await browser.pause(800);
          break;
        }
      } catch {}
    }

    // After dismissing the overlay the system PIN screen should appear
    if (await this.isLoaded(10000)) {
      await this.enterPin(pin);
      return true;
    }
    return false;
  }

  async enterPin(pin) {
    const field = await this._findPinField();
    if (!field) {
      try {
        const src    = await driver.getPageSource();
        const unique = [...new Set([...src.matchAll(/resource-id="([^"]+)"/g)].map(m => m[1]).filter(Boolean))];
        const descs  = [...src.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1]).slice(0, 20);
        console.log('\n  ── PIN field not found — resource-ids:', unique.join(' | '));
        console.log('  descs:', descs.join(', '));
        await this.takeScreenshot('pin-field-not-found');
      } catch {}
      throw new Error('PIN input field not found — check screenshot above');
    }
    await this._tap(field);
    await browser.pause(300);
    await field.setValue(String(pin));
    await browser.pause(500);
    try { await driver.execute('mobile: pressKey', { keycode: 66 }); } catch {}
    await browser.pause(500);
  }
}

module.exports = new BiometricSetupPage();
