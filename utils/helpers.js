const APP_ID       = process.env.APP_PACKAGE  || 'com.iouring.globecapital.dev';
const APP_ACTIVITY = process.env.APP_ACTIVITY || 'com.iouring.globecapital.MainActivity';

// Dismisses any Android permission popup by tapping the most permissive option.
async function handlePermissionDialog() {
  try {
    const src = await driver.getPageSource();
    const isPermDialog =
      src.includes('permissioncontroller') ||
      src.includes('com.android.packageinstaller') ||
      src.includes('permission_allow');
    if (!isPermDialog) return false;

    const candidates = [
      '//android.widget.Button[@text="Allow all the time"]',
      '//android.widget.Button[@resource-id="com.android.permissioncontroller:id/permission_allow_always_button"]',
      '//android.widget.Button[@text="Allow all"]',
      '//android.widget.Button[@text="Allow"]',
      '//android.widget.Button[@resource-id="com.android.permissioncontroller:id/permission_allow_button"]',
      '//android.widget.Button[@text="While using the app"]',
      '//android.widget.Button[@resource-id="com.android.permissioncontroller:id/permission_allow_foreground_only_button"]',
    ];
    for (const sel of candidates) {
      try {
        const btn = await $(sel);
        if (await btn.isDisplayed()) { await btn.click(); return true; }
      } catch {}
    }
  } catch {}
  return false;
}

// Wipes app data and cold-launches the app from a clean state (no cached session).
// Uses pm clear (safe on stock Android) + am start -W (waits for full launch).
async function clearAndLaunch() {
  try { await driver.terminateApp(APP_ID); } catch {}
  await browser.pause(500);
  try { await driver.execute('mobile: shell', { command: `pm clear ${APP_ID}` }); } catch {}
  await browser.pause(1000);
  try { await driver.execute('mobile: shell', { command: 'wm dismiss-keyguard' }); } catch {}
  await browser.pause(300);
  try { await driver.execute('mobile: shell', { command: `am start -W -n ${APP_ID}/${APP_ACTIVITY}` }); } catch {}
  await browser.pause(3000); // extra settle time — app may do network checks after a clean install
}

// Prints visible content-descs and non-trivial texts for the current screen.
async function dumpScreen(label) {
  try {
    const src   = await driver.getPageSource();
    const descs = [...src.matchAll(/content-desc="([^"]+)"/g)].map(m => m[1]).slice(0, 20);
    const texts = [...src.matchAll(/\btext="([^"]{2,})"/g)].map(m => m[1]).slice(0, 20);
    console.log(`\n  ── ${label} ──`);
    if (descs.length) console.log('  descs :', descs.join(' | '));
    if (texts.length) console.log('  texts :', texts.join(' | '));
  } catch {}
}

// Polls until `text` is absent from the page source.
async function waitUntilGone(text, timeoutMs = 120000, pollMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await browser.pause(pollMs);
    const src = await browser.getPageSource();
    if (!src.includes(text)) return src;
  }
  return browser.getPageSource();
}

// Polls until the page source differs from `fromSrc`.
async function waitForScreenChange(fromSrc, timeoutMs = 120000, pollMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await browser.pause(pollMs);
    const cur = await browser.getPageSource();
    if (cur !== fromSrc) return cur;
  }
  return browser.getPageSource();
}

module.exports = {
  handlePermissionDialog,
  clearAndLaunch,
  dumpScreen,
  waitUntilGone,
  waitForScreenChange,
};
