const BasePage = require('./BasePage');
const { APP_PACKAGE } = require('../config/appium.config');

class SplashPage extends BasePage {
    constructor(driver) {
        super(driver);

        this.loginButton = 'android=new UiSelector().textContains("Login")';
        this.splashLogo = 'android=new UiSelector().className("android.widget.ImageView").instance(0)';
        this.getStartedBtn = 'android=new UiSelector().textContains("Get Started")';
        // Reads like "v0.0.59 (59)" - matched by pattern rather than an exact version string,
        // since the build number changes on every release.
        this.buildVersionLabel = 'android=new UiSelector().descriptionMatches("^v\\d+\\.\\d+\\.\\d+ \\(\\d+\\)$")';
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
        return ((await el.getAttribute('content-desc')) || '').trim();
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
