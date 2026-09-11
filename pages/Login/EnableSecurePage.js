// ─────────────────────────────────────────────────────────────────────────────
// EnableSecurePage — "Enable Globe Secure" screen.
// Appears after the first successful OTP verification.
// User can either enable biometric security or go back to skip it.
// ─────────────────────────────────────────────────────────────────────────────
const BasePage = require('./BasePage');

const SEL = {
  heading:   '~Enable Globe Secure',
  enableBtn: '~ENABLE NOW',
  backBtn:   '//android.widget.ImageView[1]',
};

class EnableSecurePage extends BasePage {

  // ── Screen readiness ─────────────────────────────────────────────────────────

  // Returns true when the Enable Globe Secure heading is visible.
  async isLoaded(timeout = 5000) {
    return this.isDisplayed(SEL.heading, timeout);
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  // Proceeds with biometric setup — triggers the second OTP flow.
  async tapEnableNow() {
    await this.click(SEL.enableBtn);
  }

  // Dismisses the screen without enabling biometrics.
  async tapBack() {
    await this.click(SEL.backBtn);
  }
}

module.exports = new EnableSecurePage();
