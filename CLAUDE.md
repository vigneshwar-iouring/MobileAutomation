# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Appium + WebdriverIO UI automation for the "Globe Capital" Android trading app
(`com.iouring.globecapital` / `.MainActivity`), driven against real hardware (a
Pixel 4a and a OnePlus 6, see `config/devices.config.js`) through an Appium
server that is already running externally on `127.0.0.1:4723` — nothing here
starts or manages Appium itself.

**This app trades with a live account and real money.** Order-placement code
paths are real unless explicitly gated off (see "Real order placement" below).
Never remove or weaken a price/confirmation safety check without the user
explicitly asking for it.

## Two independent test architectures

The repo contains two unrelated automation stacks that must not be mixed:

1. **Plain-Node "DriverManager" style** — everything in `tests/*.test.js`
   (except `Regression/`) and `pages/*.js` (flat files, not in subfolders).
   - Single Appium session owned by `driver/DriverManager.js` (a lazy
     singleton around `webdriverio`'s `remote()`, config from
     `config/appium.config.js`).
   - Page objects extend `pages/BasePage.js` and take `driver` explicitly in
     their constructor (`new SplashPage(driver)`).
   - Each test file is a standalone Node script with its own `run()` and
     `DriverManager.closeDriver()` in a `finally` block — run directly with
     `node`, not a test runner.
   - Uses `utils/logger.js`'s `createLogger`/`getFailedTCs` for structured
     per-TC pass/fail logs, and `utils/reportBuilder.js` for that stack's own
     HTML report/dashboard.

2. **Mocha/WDIO style** — only `Regression/New_Regression.spec.js`, plus the
   page objects under `pages/<Category>/` subfolders (e.g. `pages/Login/`,
   `pages/Watchlist/`, `pages/OrderPad/`, `pages/Orders/`, `pages/Quote/`).
   - Uses WDIO's global `browser`/`driver`/`$`/`$$` and Mocha's
     `describe`/`it` — no explicit driver plumbing.
   - Page objects extend `pages/Login/BasePage.js` (a different, richer
     `BasePage` than the one above — same name, incompatible API).
   - Config chain: `config/wdio.android.conf.js` → merges
     `config/wdio.base.conf.js` (specs, hooks, reporters) with
     `config/caps.android.js` (Android capabilities, built from the same
     `config/devices.config.js` registry the other stack uses).
   - Run only via `wdio run`, never `node`.

Do not import a flat `pages/*.js` file into `Regression/` code or vice versa —
they use different `BasePage` contracts (constructor-injected `driver` vs.
WDIO globals).

## Commands

```bash
# DriverManager-style tests (real device unless :emulator variant used)
npm run launch            # tests/launchApp.test.js
npm run login             # tests/login.test.js
npm run forgotpwd         # tests/forgotPassword.test.js
npm run ncforgotpwd       # tests/NCforgotpassword.test.js
# swap DEVICE_TYPE=real for DEVICE_TYPE=emulator via the :emulator npm scripts,
# or run any other test file directly, e.g.:
node tests/Watchlist/Watchlist.test.js
node tests/MutualFunds/Accounts.test.js

# Regression suite (Mocha/WDIO)
npm run test:regression
# equivalent, and how to target one test case (grep matches the `it()` title):
npx wdio run ./config/wdio.android.conf.js --spec ./Regression/New_Regression.spec.js --mochaOpts.grep "R41"

# Skip R1-R7 login/OTP and resume straight on Watchlist (session already valid on device)
RESUME_SESSION=1 npx wdio run ./config/wdio.android.conf.js --spec ./Regression/New_Regression.spec.js --mochaOpts.grep "R41"

# Target a different device/app without editing config files
DEVICE_TYPE=real1 APP_PACKAGE=com.other.pkg APP_ACTIVITY=.MainActivity npm run test:regression
```

There is no lint or build step; there is no non-regression automated test
runner (each DriverManager `tests/*.test.js` file is itself an executable
script, not a spec run by a shared runner).

### Real order placement — safety gate

`Regression/New_Regression.spec.js` R33-R38 place real orders across
NSE/BSE/NFO/BFO/CDS/MCX. They are **off by default**: without
`PLACE_REAL_ORDERS=1` they only read and print the Quote screen's lower/upper
circuit limits, then back out to Watchlist without ever tapping Buy.

```bash
PLACE_REAL_ORDERS=1 npx wdio run ./config/wdio.android.conf.js --spec ./Regression/New_Regression.spec.js --mochaOpts.grep "R3[3-8]"
```

Before touching this flow, understand `submitAndConfirmOrder()` in the spec
and `OrderPadPage.getConfirmationDetails()`: after entering a price, the code
re-reads the price shown on the app's own confirmation popup and calls
`expect.fail()` if it doesn't match the intended price, refusing to tap
Confirm. This exists because Compose's accessibility layer can accept
`setValue()`/`clearValue()` without the real order form state changing at all
(see `OrderPadPage.setPrice()`, which types via real `pressKeyCode`/
`driver.keys()` for this reason) — do not "fix" a failure here by relaxing the
comparison; root-cause why the popup price doesn't match instead.

### Reports

- DriverManager-style tests: `utils/reportBuilder.js` writes per-run/compiled
  HTML reports (see that stack's own `MODULE_REGISTRY`).
- Regression suite: `utils/regressionReportBuilder.js`, wired into
  `config/wdio.base.conf.js`'s `beforeTest`/`afterTest`/`after` hooks (console
  output is captured per-test and embedded in the report). Writes both a
  timestamped file and a stable `reports/Regression Report.html`. This logic
  **must** live in the `after` hook, not `onComplete` — `onComplete` runs in
  WDIO's separate launcher process and never sees state the worker process
  (`beforeTest`/`afterTest`) populated.

### VS Code debugging

`.vscode/launch.json` has "Regression Spec — Real Device", which launches
`node_modules/@wdio/cli/bin/wdio.js run` directly so breakpoints in the spec
and page objects hit. Plain `node`-based "Run/Debug" on the spec file itself
does not work — it isn't a Node entry point, WDIO's CLI is.

## Architecture notes specific to this app

- **External Appium server, no relaxed security**: `mobile: shell` (and thus
  raw `adb shell` commands like `pm clear`/`am start` via Appium) fails with
  "Potentially insecure feature 'adb_shell' has not been enabled". Use
  `driver.execute('mobile: clearApp', {appId})` + `driver.activateApp()`
  instead (see `utils/helpers.js`'s `clearAndLaunch`). `pages/BasePage.js`
  (DriverManager stack) instead shells out to a local `adb` binary directly
  via `execFileSync` for taps/typing that Appium's own APIs can't reach.
- **Jetpack Compose accessibility quirks** drive a lot of the non-obvious code
  in both `BasePage.js` files: content-desc-based screen scraping via regex
  over `getPageSource()` (`getDescribedElements()`/`dumpScreen()`) instead of
  per-element selectors, because Compose elements are often custom-drawn with
  merged semantics that don't map to real Android widgets/resource-ids.
  Several controls only register a raw `adb input tap`/`keyevent`, not
  Appium's `click()`/`setValue()`.
  `pages/Watchlist/WatchlistPage.js`'s tab row is click-only (swiping the
  ScrollableTabRow does nothing) — always tap the tab by its label/position.
- **Navigation is not always one back-press away**: some flows land more than
  one screen deep (e.g. OrderPad), so `WatchlistPage.goToWatchlist()` retries
  up to `maxBackPresses` back presses rather than assuming one is enough.
- **OTP automation**: `utils/gmailOtpHelper.js` (IMAP via `imapflow`) reads
  the login OTP from the inbox described in `credentials/gmail-config.json`.
  `getLatestUid()` is called before triggering the OTP send so
  `fetchLatestOtp()` can wait for a UID newer than that baseline, avoiding a
  stale/previous OTP email.
- **Credentials/test data**: `data/testData.js` holds the account used across
  both stacks (`validUser`, plus alternate `id1`-`id3` client IDs). This is a
  real trading account, not a sandbox.
