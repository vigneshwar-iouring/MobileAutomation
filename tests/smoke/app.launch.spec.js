const { expect } = require('chai');
const loginPage = require('../../pages/Login/LoginPage');

describe('[Smoke] App Launch — Globe Capital Dev', () => {
  it('should launch the app and display the login screen', async () => {
    const loaded = await loginPage.isLoaded();
    expect(loaded, 'LOGIN button should be visible on launch').to.be.true;
  });

  it('should display the SIGN UP button', async () => {
    const visible = await loginPage.isSignUpButtonDisplayed();
    expect(visible, 'SIGN UP button should be visible').to.be.true;
  });

  it('should display the FORGET PASSWORD link', async () => {
    const visible = await loginPage.isForgotPasswordDisplayed();
    expect(visible, 'FORGET PASSWORD link should be visible').to.be.true;
  });

  it('should display Terms and Conditions text', async () => {
    const visible = await loginPage.isTermsTextDisplayed();
    expect(visible, 'Terms text should be visible at bottom of login screen').to.be.true;
  });
});
