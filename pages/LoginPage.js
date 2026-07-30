const BasePage = require('./BasePage');

class LoginPage extends BasePage {
    constructor(driver) {
        super(driver);

        this.forgotPasswordLink = 'android=new UiSelector().descriptionContains("FORGOT").clickable(true)';
        this.loginIdField = 'android=new UiSelector().className("android.widget.EditText").instance(0)';
    }

    async clickForgotPassword() {
        await this.click(this.forgotPasswordLink, 30000);
        console.log('Clicked Forgot Password');
    }

    async enterLoginId(loginId) {
        await this.enterText(this.loginIdField, loginId);
        console.log(`Entered Login ID: ${loginId}`);
    }
}

module.exports = LoginPage;
