/**
 * Interactive exploration spec — run via: npm run explore
 * Walks through the full login → OTP → Enable Globe Secure → 2nd OTP → PIN flow,
 * dumping every screen to ui_dumps/ and to the console for inspection.
 */
const fs   = require('fs');
const path = require('path');
const { handlePermissionDialog, waitForScreenChange, waitUntilGone } = require('../../utils/helpers');

const DUMP_DIR = path.join(__dirname, '../../ui_dumps');

// Writes the XML to disk and logs every clickable/visible node to the console.
function dumpScreen(src, label) {
  fs.mkdirSync(DUMP_DIR, { recursive: true });
  fs.writeFileSync(path.join(DUMP_DIR, `${label}.xml`), src);

  const seen  = new Set();
  const nodes = src.match(/<[a-z][^>]+>/gi) || [];
  console.log(`\n  ──── ${label} ────`);
  for (const node of nodes) {
    const desc      = node.match(/content-desc="([^"]+)"/)?.[1];
    const txt       = node.match(/\btext="([^"]+)"/)?.[1];
    const cls       = node.match(/class="([^"]+)"/)?.[1]?.split('.').pop();
    const rid       = node.match(/resource-id="([^"]+)"/)?.[1];
    const clickable = node.includes('clickable="true"');
    const bounds    = node.match(/bounds="([^"]+)"/)?.[1];
    const val = desc || txt;
    if (val && val.trim() && !seen.has(val)) {
      seen.add(val);
      console.log(`    ${clickable ? '🖱' : ' '} [${cls}] "${val}"${rid ? ` (${rid})` : ''}${bounds ? ` @ ${bounds}` : ''}`);
    }
  }
}

describe('Explore: Full Login → Biometric Setup Flow', () => {
  it('walks through login → OTP → Enable Now → 2nd OTP → PIN', async function () {
    this.timeout(480000); // 8 min — two manual OTP steps up to 2 min each

    // ── Step 0: clear app data → force fresh login screen ────────────────────
    const APP_ID = process.env.APP_PACKAGE || 'com.iouring.globecapital.dev';
    console.log('\n  🧹 Clearing app data for fresh login state...');
    try { await driver.terminateApp(APP_ID); } catch {}
    try { await driver.execute('mobile: shell', { command: `pm clear ${APP_ID}` }); } catch {}
    await browser.pause(1500);
    try { await driver.execute('mobile: shell', { command: 'wm dismiss-keyguard' }); } catch {}
    await browser.pause(500);
    try { await driver.execute('mobile: shell', { command: `am start -W -n ${APP_ID}/${process.env.APP_ACTIVITY || 'com.iouring.globecapital.MainActivity'}` }); } catch {}
    await browser.pause(2000);

    // ── Step 1: wait past splash screen (auto-dismiss permission dialogs) ────
    console.log('\n  ⏳ Waiting for login screen...');
    const splashDeadline = Date.now() + 45000;
    let src = await browser.getPageSource();
    while (Date.now() < splashDeadline && !src.includes('LOGIN') && !src.includes('Relaunch App')) {
      await handlePermissionDialog();
      await browser.pause(2000);
      src = await browser.getPageSource();
    }
    dumpScreen(src, '01_app_launch');

    if (src.includes('Relaunch App')) {
      console.log('\n  🔄 Tapping "Relaunch App"...');
      await (await $('~Relaunch App')).click();
      const rlDeadline = Date.now() + 30000;
      src = await browser.getPageSource();
      while (Date.now() < rlDeadline && !src.includes('LOGIN')) {
        await browser.pause(2000);
        src = await browser.getPageSource();
      }
    }

    // ── Step 2: enter credentials ────────────────────────────────────────────
    src = await browser.getPageSource();
    dumpScreen(src, '02_login_screen');

    const userId   = process.env.TEST_USER_ID || 'TEMPMF11';
    const password = process.env.TEST_PASSWORD || 'Globe@98';
    console.log(`\n  ⌨  Entering credentials (${userId})...`);

    const loginIdField = await $('//android.widget.EditText[1]');
    await loginIdField.click();
    await browser.pause(400);
    await loginIdField.setValue(userId);
    await browser.pause(500);

    const passField = await $('//android.widget.EditText[2]');
    await passField.click();
    await browser.pause(400);
    await passField.setValue(password);
    await browser.pause(500);

    try { await browser.hideKeyboard(); } catch {}
    await browser.pause(400);

    // ── Step 3: tap LOGIN ────────────────────────────────────────────────────
    console.log('  🖱  Tapping LOGIN...');
    await (await $('~LOGIN')).click();

    const srcBeforeOtp = await browser.getPageSource();
    console.log('  ⏳ Waiting for OTP screen...');
    src = await waitForScreenChange(srcBeforeOtp, 20000);
    dumpScreen(src, '03_otp_screen_1');

    // ── Step 4: first OTP — manual entry ────────────────────────────────────
    console.log('\n  ════════════════════════════════════════════');
    console.log('  📱 ENTER FIRST OTP ON YOUR DEVICE NOW');
    console.log('     Waiting up to 2 min...');
    console.log('  ════════════════════════════════════════════\n');

    src = await waitUntilGone('OTP Verification', 120000);
    dumpScreen(src, '04_after_otp_1');

    // ── Step 5: Enable Globe Secure — auto-tap ENABLE NOW ───────────────────
    const cdValues = (src.match(/content-desc="([^"]+)"/g) || []).join(' ');
    if (/enable now/i.test(cdValues)) {
      console.log('  🖱  "Enable Globe Secure" detected — tapping ENABLE NOW...');
      await (await $('~ENABLE NOW')).click();
      await browser.pause(1000);
      src = await browser.getPageSource();
      dumpScreen(src, '05_after_enable_now');
    } else {
      console.log('  ⚠  Enable Globe Secure not detected — skipping');
      dumpScreen(src, '05_skip_enable');
    }

    // ── Step 6: second OTP — manual entry ───────────────────────────────────
    const otpDeadline = Date.now() + 20000;
    while (Date.now() < otpDeadline) {
      src = await browser.getPageSource();
      if (src.includes('OTP Verification')) break;
      await browser.pause(1000);
    }
    dumpScreen(src, '06_otp_screen_2');

    if (src.includes('OTP Verification')) {
      console.log('\n  ════════════════════════════════════════════');
      console.log('  📱 ENTER SECOND OTP ON YOUR DEVICE NOW');
      console.log('     Waiting up to 2 min...');
      console.log('  ════════════════════════════════════════════\n');
      src = await waitUntilGone('OTP Verification', 120000);
      dumpScreen(src, '07_after_otp_2');
    }

    // ── Step 7: system PIN screen ────────────────────────────────────────────
    await browser.pause(1000);
    src = await browser.getPageSource();
    dumpScreen(src, '08_after_otp2_screen');

    const hasLockPwd = src.includes('com.android.systemui:id/lockPassword') ||
                       src.includes('Authentication required');
    if (hasLockPwd) {
      const devicePin = process.env.DEVICE_PIN || '2580';
      console.log(`  ⌨  Entering PIN: ${devicePin}...`);
      try {
        const pinField = await $('//*[@resource-id="com.android.systemui:id/lockPassword"]');
        await pinField.waitForDisplayed({ timeout: 5000 });
        await pinField.click();
        await browser.pause(300);
        await pinField.setValue(devicePin);
        await browser.pause(500);
        try { await driver.execute('mobile: pressKey', { keycode: 66 }); } catch {}
      } catch (e) {
        console.log('  ⚠  PIN field not interactable:', e.message);
      }
    } else {
      console.log('  ⚠  System PIN screen not detected — skipping');
    }

    await browser.pause(1000);
    src = await browser.getPageSource();
    dumpScreen(src, '09_final_screen');
    console.log('\n  ✅ All screens captured → ui_dumps/');
  });
});
