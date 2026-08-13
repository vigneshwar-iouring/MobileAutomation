const BasePage = require('./BasePage');

class LoginPage extends BasePage {
    constructor(driver) {
        super(driver);

        this.forgotPasswordLink = 'android=new UiSelector().descriptionContains("FORGOT").clickable(true)';
        this.loginIdField = 'android=new UiSelector().className("android.widget.EditText").instance(0)';
        this.passwordField = 'android=new UiSelector().className("android.widget.EditText").instance(1)';
        this.loginButton = 'android=new UiSelector().description("LOGIN")';

        // OTP Verification screen (shown after LOGIN, and again after ENABLE NOW below) - a
        // single EditText, same as the login/password fields' pattern of being the only input on
        // screen at that point.
        this.otpField = 'android=new UiSelector().className("android.widget.EditText").instance(0)';

        // "Enable Globe Secure" biometric-lock prompt - shown once after the first login OTP and,
        // per the app, mandatory (no skip option was found; pressing back just returns to the
        // previous OTP screen instead of moving forward).
        this.enableGlobeSecureHeading = 'android=new UiSelector().description("Enable Globe Secure")';
        this.enableNowButton = 'android=new UiSelector().description("ENABLE NOW")';

        // Android's own "confirm device credential" dialog (com.android.systemui), shown as the
        // biometric-enrollment fallback - not part of the app under test.
        this.deviceCredentialInput = 'android=new UiSelector().resourceId("com.android.systemui:id/auth_credential_input")';

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
