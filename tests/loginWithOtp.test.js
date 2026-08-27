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
const PASSWORD = 'Globe@1234';
const LOGIN_ID2 = 'HOGC1103';
const PASSWORD2 = 'Jaya@0004';
const DEVICE_PASSWORD = '11111'; // device screen-lock PIN, used to confirm biometric enrollment
// ─────────────────────────────────────────────────────────────────────

async function run() {
    const driver = await DriverManager.getDriver();
    // Tracks whichever step is currently in progress, so if one throws, the catch block below can
    // report exactly which step never completed alongside the real error the device raised for it.
    let currentStep = 'Driver setup';

    try {
        const splashPage = new SplashPage(driver);
        const loginPage = new LoginPage(driver);

        currentStep = 'Step 1: Launching app...';
        console.log(currentStep);
        await splashPage.launch();
        await splashPage.pause(4000);
        // If a permission popup is observed, allow it; if not, proceed straight to the next step.
        await permissionHandler.dismissAllPermissions(driver);

        currentStep = 'Step 2: Snapshotting Gmail inbox...';
        console.log(currentStep);
        let sinceUid = await getLatestUid();
        await splashPage.pause(5000);

        currentStep = 'Step 3: Entering login ID and password...';
        console.log(currentStep);
        await loginPage.enterLoginId(LOGIN_ID);
        await loginPage.enterPassword(PASSWORD);
        await loginPage.clickLogin();

        // Wrong credentials show a Toast here instead of advancing to OTP - it vanishes from the
        // accessibility tree well under a second after appearing, so this checks immediately
        // (polling page source internally) rather than pausing first and risking checking after
        // it's already gone. Catching it here surfaces the real cause instead of Step 4 timing out
        // on an OTP email that was never sent.
        if (await loginPage.isLoginErrorShown()) {
            throw new Error(`Login rejected by device: "${loginPage.loginErrorText}"`);
        }
        await driver.pause(1000);

        currentStep = 'Step 4: Fetching and entering login OTP...';
        console.log(currentStep);
        const loginOtp = await fetchLatestOtp(sinceUid, 'One time password');
        await loginPage.enterOtp(loginOtp);
        await driver.pause(2000);

        // First-time (or reset) logins are met with a mandatory biometric-lock enrollment prompt,
        // which itself requires a second OTP and a device-credential confirmation. Guarded so this
        // test still passes cleanly on accounts where it doesn't appear.
        if (await loginPage.isEnableGlobeSecureShown()) {
            currentStep = 'Step 6: "Enable Globe Secure" prompt shown - enabling...';
            console.log(currentStep);
            sinceUid = await getLatestUid();
            await loginPage.clickEnableNow();
            await driver.pause(2000);

            currentStep = 'Step 7: Fetching and entering Enable Globe Secure OTP...';
            console.log(currentStep);
            const secureOtp = await fetchLatestOtp(sinceUid, 'One time password');
            await loginPage.enterOtp(secureOtp);
            await driver.pause(2000);

            if (await loginPage.isDeviceCredentialPromptShown()) {
                currentStep = 'Step 8: Confirming device credential...';
                console.log(currentStep);
                await loginPage.enterDevicePassword(DEVICE_PASSWORD);
                await driver.pause(2500);
            }
        }

        // "Risk Disclosure on Derivatives" is shown only on an account's very first login, right
        // after the biometric device-credential step above. If it's observed, acknowledge it; if
        // not, proceed with the flow as-is.
        currentStep = 'Step 9: Checking Risk Disclosure on Derivatives popup...';
        if (await loginPage.isRiskDisclosureShown()) {
            console.log('Step 9: Risk Disclosure on Derivatives popup shown - clicking "I Understand"...');
            await loginPage.acknowledgeRiskDisclosure();
            await driver.pause(1000);
        } else {
            console.log('Step 9: Risk Disclosure on Derivatives popup not shown - proceeding');
        }

        currentStep = 'Final check: verifying home screen';
        const loggedIn = await loginPage.isLoggedIn();
        console.log(loggedIn ? 'Login successful - home screen displayed' : 'Login flow finished, but home screen was not detected');

    } catch (err) {
        console.error(`Step not executed: ${currentStep}`);
        console.error(`Real device error: ${err.message}`);
        console.error(err.stack);
    } finally {
        await DriverManager.closeDriver();
    }
}

run();
