const BasePage = require('./BasePage');
const { handlePermissionDialog } = require('../../utils/helpers');

const SEL = {
  loginIdInput:     '//android.widget.EditText[1]',
  passwordInput:    '//android.widget.EditText[2]',
  loginBtn:         '~LOGIN',
  signUpBtn:        '~SIGN UP',
  forgotPasswordBtn:'~FORGET PASSWORD',
  termsBtn:         '~Terms and Conditions',
  termsText:        '~By logging in, I accept the ',
};

class LoginPage extends BasePage {

  // ── Screen readiness ─────────────────────────────────────────────────────────

  async waitForLoginScreen(timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      await handlePermissionDialog();

      try {
        const relaunch = await $('~Relaunch App');
        if (await relaunch.isDisplayed()) {
          await relaunch.click();
          await browser.pause(1200);
          continue;
        }
      } catch {}

      try {
        const login = await $(SEL.loginBtn);
        if (await login.isDisplayed() && await (await $(SEL.loginIdInput)).isDisplayed())
          return true;
      } catch {}

      await browser.pause(500);
    }

    try {
      const src   = await driver.getPageSource();
      const pkg   = (src.match(/package="([^"]+)"/) || [])[1] || '?';
      const descs = [...src.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1]).slice(0, 20);
      const texts = [...src.matchAll(/\btext="([^"]+)"/g)].map(m => m[1]).filter(t => t.trim()).slice(0, 30);
      console.log(`\n  ── waitForLoginScreen TIMEOUT (${timeout}ms) — foreground package: ${pkg}`);
      console.log('  texts :', texts.join(' | '));
      console.log('  descs :', descs.join(' | '));
      await this.takeScreenshot('loginscreen-timeout');
    } catch {}
    return false;
  }

  async isLoaded() {
    return this.waitForLoginScreen(15000);
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  // Tap → brief pause → setValue; shared by enterLoginId and enterPassword.
  async _fillField(selector, value) {
    const el = await this.waitForElement(selector);
    await this._tap(el);
    await browser.pause(100);
    await el.setValue(String(value));
    await browser.pause(150);
  }

  // ── Input actions ────────────────────────────────────────────────────────────

  async enterLoginId(id) {
    await handlePermissionDialog();
    await this._fillField(SEL.loginIdInput, id);
  }

  async enterPassword(password) {
    await this._fillField(SEL.passwordInput, password);
  }

  async tapLogin() {
    await this.hideKeyboard();
    await browser.pause(200);
    await this._tap(await $(SEL.loginBtn));
    await browser.pause(200);
  }

  async login(id, password) {
    await this.enterLoginId(id);
    await this.enterPassword(password);
    await this.tapLogin();
  }

  // ── Navigation taps ──────────────────────────────────────────────────────────

  async tapSignUp()             { await this.click(SEL.signUpBtn); }
  async tapForgotPassword()     { await this.click(SEL.forgotPasswordBtn); }
  async tapTermsAndConditions() { await this.click(SEL.termsBtn); }

  // ── Queries ──────────────────────────────────────────────────────────────────

  async getLoginIdFieldValue()      { return this.getText(SEL.loginIdInput); }
  async isSignUpButtonDisplayed()   { return this.isDisplayed(SEL.signUpBtn); }
  async isForgotPasswordDisplayed() { return this.isDisplayed(SEL.forgotPasswordBtn); }
  async isTermsTextDisplayed()      { return this.isDisplayed(SEL.termsText); }
}

module.exports = new LoginPage();
