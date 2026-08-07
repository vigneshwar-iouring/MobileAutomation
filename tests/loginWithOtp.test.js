const DriverManager = require('../driver/DriverManager');
const SplashPage = require('../pages/SplashPage');
const LoginPage = require('../pages/LoginPage');
const permissionHandler = require('../utils/permissionHandler');
const { getLatestUid, fetchLatestOtp } = require('../utils/gmailOtpHelper');
const { createLogger } = require('../utils/logger');

const { logFile } = createLogger('loginWithOtp');
console.log(`Logging this run to: ${logFile}`);

// ── Credentials ─────────────────────────────────────────────────────
const LOGIN_ID = 'TEMPMF11';
const PASSWORD = 'Globe@4321';
const DEVICE_PASSWORD = '11111'; // device screen-lock PIN, used to confirm biometric enrollment
// ─────────────────────────────────────────────────────────────────────

async function run() {
    const driver = await DriverManager.getDriver();

    try {
        const splashPage = new SplashPage(driver);
        const loginPage = new LoginPage(driver);

        console.log('Step 1: Relaunching app...');
        await splashPage.relaunch();
        await splashPage.pause(4000);
        await permissionHandler.dismissAllPermissions(driver);

        console.log('Step 2: Snapshotting Gmail inbox...');
        let sinceUid = await getLatestUid();

        console.log('Step 3: Entering login ID and password...');
        await loginPage.enterLoginId(LOGIN_ID);
        await loginPage.enterPassword(PASSWORD);
        await loginPage.clickLogin();
        await driver.pause(3000);

        console.log('Step 4: Fetching and entering login OTP...');
        const loginOtp = await fetchLatestOtp(sinceUid, 'One time password');
        await loginPage.enterOtp(loginOtp);
        await driver.pause(2000);

        // First-time (or reset) logins are met with a mandatory biometric-lock enrollment prompt,
        // which itself requires a second OTP and a device-credential confirmation. Guarded so this
        // test still passes cleanly on accounts where it doesn't appear.
        if (await loginPage.isEnableGlobeSecureShown()) {
            console.log('Step 5: "Enable Globe Secure" prompt shown - enabling...');
            sinceUid = await getLatestUid();
            await loginPage.clickEnableNow();
            await driver.pause(2000);

            console.log('Step 6: Fetching and entering Enable Globe Secure OTP...');
            const secureOtp = await fetchLatestOtp(sinceUid, 'One time password');
            await loginPage.enterOtp(secureOtp);
            await driver.pause(2000);

            if (await loginPage.isDeviceCredentialPromptShown()) {
                console.log('Step 7: Confirming device credential...');
                await loginPage.enterDevicePassword(DEVICE_PASSWORD);
                await driver.pause(2500);
            }
        }

        const loggedIn = await loginPage.isLoggedIn();
        console.log(loggedIn ? 'Login successful - home screen displayed' : 'Login flow finished, but home screen was not detected');

    } catch (err) {
        console.error('Test failed:', err.message);
        console.error(err.stack);
    } finally {
        await DriverManager.closeDriver();
    }
}

run();
