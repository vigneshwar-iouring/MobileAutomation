const BasePage = require('./BasePage');
const { APP_PACKAGE } = require('../config/appium.config');

class SplashPage extends BasePage {
    constructor(driver) {
        super(driver);

        this.loginButton = 'android=new UiSelector().textContains("Login")';
        this.splashLogo = 'android=new UiSelector().className("android.widget.ImageView").instance(0)';
        this.getStartedBtn = 'android=new UiSelector().textContains("Get Started")';
        // Reads like "Globe Capital Stock Trading: v0.0.59 (59)" - matched by the trailing
        // "vX.X.X (N)" shape rather than the whole string, since the app-name prefix isn't
        // guaranteed stable and the build number changes on every release. An earlier version of
        // this selector anchored the whole content-desc to start with "v" (^v...), which never
        // matched once the label started carrying that "Globe Capital Stock Trading: " prefix.
        this.buildVersionLabel = 'android=new UiSelector().descriptionMatches(".*v\\d+\\.\\d+\\.\\d+ \\(\\d+\\)$")';
    }

    async launch() {
        await this.driver.activateApp(APP_PACKAGE);
        console.log('App activated');
    }

    async relaunch() {
        await this.driver.terminateApp(APP_PACKAGE);
        await this.driver.pause(1000);
        await this.driver.activateApp(APP_PACKAGE);
        console.log('App relaunched from scratch');
    }

    async getBuildVersion(timeout = 5000) {
        const el = await this.findElement(this.buildVersionLabel, timeout);
        const desc = ((await el.getAttribute('content-desc')) || '').trim();
        const match = desc.match(/v\d+\.\d+\.\d+ \(\d+\)$/);
        return match ? match[0] : desc;
    }

    async isAppLoaded() {
        const loginVisible = await this.isElementVisible(this.loginButton, 5000);
        const logoVisible = await this.isElementVisible(this.splashLogo, 3000);
        return loginVisible || logoVisible;
    }

    async navigateToLogin() {
        // Try "Login" button first, then "Get Started"
        const loginVisible = await this.isElementVisible(this.loginButton, 5000);
        if (loginVisible) {
            await this.click(this.loginButton);
            console.log('Clicked Login button');
            return;
        }

        const getStartedVisible = await this.isElementVisible(this.getStartedBtn, 3000);
        if (getStartedVisible) {
            await this.click(this.getStartedBtn);
            console.log('Clicked Get Started');
        }
    }
}

module.exports = SplashPage;
