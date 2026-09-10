const BasePage = require('./BasePage');

class LoginPage extends BasePage {
    constructor(driver) {
        super(driver);

        this.forgotPasswordLink = 'android=new UiSelector().descriptionContains("FORGOT").clickable(true)';
        this.loginIdField = 'android=new UiSelector().className("android.widget.EditText").instance(0)';
        this.passwordField = 'android=new UiSelector().className("android.widget.EditText").instance(1)';
        this.loginButton = 'android=new UiSelector().description("LOGIN")';

        // Shown in place of the OTP screen when the credentials themselves are wrong - checking for
        // this right after LOGIN avoids misreporting the failure downstream (e.g. as "OTP not
        // fetched", since no OTP email is ever sent for a rejected login). It's a Toast, which
        // vanishes from the accessibility tree well under a second after appearing - a single
        // isElementVisible() check (or one taken after an up-front pause) reliably misses it, so
        // isLoginErrorShown() below polls the raw page source via BasePage.waitForToast instead.
        this.loginErrorText = 'Incorrect User ID or Password';

        // OTP Verification screen (shown after LOGIN, and again after ENABLE NOW below) - a
        // single EditText, same as the login/password fields' pattern of being the only input on
        // screen at that point.
        this.otpField = 'android=new UiSelector().className("android.widget.EditText").instance(0)';

        // The OTP field auto-validates on entry (no separate submit button) - a wrong OTP surfaces
        // this text in place, rather than a Toast like the login-credentials error above.
        this.incorrectOtpText = 'android=new UiSelector().description("Incorrect OTP.")';

        // Reads "Resend OTP 27" (clickable=false) while the cooldown counts down, then "Resend OTP "
        // (trailing space, clickable=true) once it expires - matched by shape since the countdown
        // value changes every second.
        this.resendOtpButton = 'android=new UiSelector().descriptionMatches("^Resend OTP\\s*$")';

        // "Enable Globe Secure" biometric-lock prompt - shown once after the first login OTP and,
        // per the app, mandatory (no skip option was found; pressing back just returns to the
        // previous OTP screen instead of moving forward).
        this.enableGlobeSecureHeading = 'android=new UiSelector().description("Enable Globe Secure")';
        this.enableNowButton = 'android=new UiSelector().description("ENABLE NOW")';

        // Android's own "confirm device credential" dialog (com.android.systemui), shown as the
        // biometric-enrollment fallback - not part of the app under test.
        this.deviceCredentialInput = 'android=new UiSelector().resourceId("com.android.systemui:id/auth_credential_input")';

        // "Risk Disclosure on Derivatives" prompt - shown only on an account's very first login,
        // never again afterwards. Guarded the same way as Enable Globe Secure above. Rendered
        // as plain Views with the label in content-desc (text is empty), not a native TextView,
        // so this has to match on description rather than text.
        this.riskDisclosureHeading = 'android=new UiSelector().descriptionContains("RISK DISCLOSURE")';
        this.iUnderstandButton = 'android=new UiSelector().descriptionContains("I Understand")';

        this.homeHamburgerMenu = 'android=new UiSelector().description("Hamburger menu, Double tap to open the hamburger menu")';

        // "Logout" sits below the fold of the nav drawer, under Profile/Settings.
        this.logoutMenuItem = 'android=new UiSelector().description("Logout")';
        this.logoutConfirmYes = 'android=new UiSelector().description("Yes")';
    }

    async clickForgotPassword() {
        await this.click(this.forgotPasswordLink, 30000);
        console.log('Clicked Forgot Password');
    }

    async enterLoginId(loginId) {
        await this.enterText(this.loginIdField, loginId);
        console.log(`Entered Login ID: ${loginId}`);
    }

    async enterPassword(password) {
        await this.enterText(this.passwordField, password);
        console.log('Entered password');
    }

    async clickLogin() {
        await this.driver.hideKeyboard().catch(() => {});
        await this.click(this.loginButton);
        console.log('Clicked LOGIN');
    }

    async isLoginErrorShown(timeout = 4000) {
        return await this.waitForToast(this.loginErrorText, { timeout, interval: 150 });
    }

    // Shared by both OTP screens (login, and Enable Globe Secure) - clears first since a stale
    // digit left over from a previous screen would otherwise get prepended to the new OTP.
    async enterOtp(otp) {
        const el = await this.driver.$(this.otpField);
        await el.waitForDisplayed({ timeout: 10000 });
        await el.click();
        await el.clearValue().catch(() => {});
        await el.setValue(otp.toString());
        console.log(`Entered OTP: ${otp}`);
    }

    async isIncorrectOtpShown(timeout = 3000) {
        return await this.isElementVisible(this.incorrectOtpText, timeout);
    }

    // Polls for the countdown to expire rather than sleeping a fixed duration upfront - the
    // cooldown length isn't guaranteed constant, so this waits for the real enabled state instead.
    async waitForResendOtpEnabled(timeout = 40000, interval = 2000) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            if (await this.isElementVisible(this.resendOtpButton, 500)) return true;
            await this.driver.pause(interval);
        }
        return false;
    }

    async clickResendOtp() {
        await this.click(this.resendOtpButton, 5000);
        console.log('Clicked Resend OTP');
    }

    async isEnableGlobeSecureShown(timeout = 3000) {
        return await this.isElementVisible(this.enableGlobeSecureHeading, timeout);
    }

    async clickEnableNow() {
        await this.click(this.enableNowButton);
        console.log('Clicked ENABLE NOW');
    }

    async isDeviceCredentialPromptShown(timeout = 5000) {
        return await this.isElementVisible(this.deviceCredentialInput, timeout);
    }

    async isRiskDisclosureShown(timeout = 3000) {
        return await this.isElementVisible(this.riskDisclosureHeading, timeout);
    }

    async acknowledgeRiskDisclosure() {
        await this.click(this.iUnderstandButton);
        console.log('Clicked "I Understand" on Risk Disclosure on Derivatives popup');
    }

    // The system credential field rejects setValue() outright ("Cannot set the element...") -
    // it needs real key events instead, same as OTP entry elsewhere in this codebase.
    async enterDevicePassword(devicePassword) {
        const el = await this.driver.$(this.deviceCredentialInput);
        await el.waitForDisplayed({ timeout: 5000 });
        await el.click();
        await this.driver.pause(300);
        for (const digit of devicePassword.toString()) {
            await this.driver.keys(digit);
            await this.driver.pause(100);
        }
        await this.driver.pressKeyCode(66); // KEYCODE_ENTER
        console.log('Entered device password');
    }

    async isLoggedIn(timeout = 5000) {
        return await this.isElementVisible(this.homeHamburgerMenu, timeout);
    }

    async openHamburgerMenu() {
        await this.click(this.homeHamburgerMenu);
        console.log('Opened hamburger menu');
    }

    // Scrolls the nav drawer until "Logout" is visible instead of hardcoding a fixed number of
    // swipes - the menu item list above it can grow without breaking this.
    async clickLogout(maxScrolls = 5) {
        let visible = await this.isElementVisible(this.logoutMenuItem, 1500);
        for (let i = 0; i < maxScrolls && !visible; i++) {
            await this.swipe('down');
            await this.driver.pause(400);
            visible = await this.isElementVisible(this.logoutMenuItem, 1500);
        }
        if (!visible) throw new Error('Logout menu item not found in the nav drawer');
        await this.click(this.logoutMenuItem);
        console.log('Clicked Logout');
    }

    async confirmLogout() {
        await this.click(this.logoutConfirmYes);
        console.log('Confirmed logout');
    }

    async logout() {
        await this.openHamburgerMenu();
        await this.clickLogout();
        await this.confirmLogout();
    }
}

module.exports = LoginPage;
