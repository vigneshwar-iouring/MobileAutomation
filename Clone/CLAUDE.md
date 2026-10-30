# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Appium mobile test automation framework for the **Globe Capital** Android app (`com.iouring.globecapital.dev`). Stack: WebdriverIO v9 + Appium 2.x/3.x + Mocha (BDD) + Chai + Allure reporting. Language: JavaScript (CommonJS).

## Commands

### Running Tests
```bash
npm run test:android              # All Android tests
npm run test:android:smoke        # Quick smoke/sanity check
npm run test:login                # Login flow (logs to file)
npm run test:watchlist            # Watchlist tests (logs to file)
npm run test:login-watchlist      # Full E2E: login → watchlist
npm run test:login-watchlist:resume  # E2E skipping login (existing session)
npm run test:quote                # Quote/price tests
npm run test:search               # Search tests
npm run demo                      # Full E2E demo
```

### Running a Specific Suite / Grep
```bash
npx wdio run ./config/wdio.android.conf.js --suite login
npx wdio run ./config/wdio.android.conf.js --suite watchlist --grep "Add stocks"
```

### Allure Reports
```bash
npm run test:report               # Generate and open Allure HTML report
```

### Appium Server
```bash
npm run appium:start              # Start local Appium server (port 4723)
npm run appium:setup              # Install uiautomator2 + xcuitest drivers
```

### Lint
```bash
npm run lint                      # ESLint on tests/ pages/ utils/
```

### Device Exploration
```bash
npm run explore                   # Interactive UI inspection via explore.spec.js
```

## Architecture

### Config Files (`config/`)
- **`wdio.base.conf.js`** — Shared base: Mocha timeouts (60s base, 300s for Android), Allure + spec reporters, screenshot on failure to `reports/screenshots/`, retry logic.
- **`wdio.android.conf.js`** — Extends base; defines test suites (`smoke`, `login`, `watchlist`, `quote`, `search`, `e2e`, `regression`); calls `handlePermissionDialog()` in `beforeEach`.
- **`caps.android.js`** — Device capabilities. Device selected via `TARGET_DEVICE` env var (`PIXEL_9A` default, `PIXEL_4A`). All values pulled from `.env`.
- **`wdio.explore.conf.js`** — Minimal config for interactive device exploration.

### Page Objects (`pages/`)
All pages extend `pages/Login/BasePage.js` and are exported as **singletons** (`module.exports = new XxxPage()`).

**BasePage** provides: `waitForElement`, `click`, `setValue`, `getText`, `pollUntil`, `swipeUp/Down`, `scrollToElement`, `assertText`, `assertDisplayed`, `takeScreenshot`, `findAndTap/SetValue/GetText` (non-throwing optional variants).

Page hierarchy:
- `Login/LoginPage.js` — Credential entry; `waitForLoginScreen()` handles permission dialogs and "Relaunch App" recovery button.
- `Login/OTPPage.js` — OTP entry; `waitForNavigation()` polls twice to avoid transient screen flashes.
- `Login/EnableSecurePage.js` — Intermediate "Enable Globe Secure" step between OTP flows.
- `Login/BiometricSetupPage.js` — System PIN + biometric auth. Has multiple selector fallbacks for Android version differences; dumps resource-ids on failure.
- `Login/HomePage.js` — 5-tab bottom nav; tabs have dynamic badge counts.
- `Watchlist/WatchlistPage.js` — Complex: dynamic tabs, ANR dialog auto-dismissal, regex-based page source parsing for speed.
- `Quote/QuotePage.js`, `Search/SearchPage.js`

### Tests (`tests/`)
Mocha BDD. Common structure: `before()` for full login setup, `beforeEach()` to reset state, `describe`/`it` blocks with Chai assertions.

Suites map to directories: `login/`, `watchlist/` (5 spec files), `login-watchlist/`, `quote/`, `search/`, `smoke/`, `explore/`.

### Utilities (`utils/`)
- **`helpers.js`** — `handlePermissionDialog()` (multiple selector fallbacks for Android versions), `clearAndLaunch()` (cold launch via adb), `dumpScreen()` (debugging tool that prints content-descs/texts).
- **`emailOtp.js`** — IMAP/Gmail OTP fetching. `fetchOtpFromGmail()` polls inbox until OTP email arrives. `purgeStaleOtps()` marks old emails seen before a new test flow.
- **`otpRetry.js`** — `retryOtpWithDelay()` wraps OTP entry with automatic retry: on rejection, waits, taps Resend, retries up to N times.
- **`loginHelper.js`** — Login-specific helpers.

### Data (`data/testData.js`)
Credentials and device PINs. All values loaded from `.env` with defaults.

## Key Patterns

**Selectors:** Prefer accessibility content-desc (`~LOGIN`) over XPath, XPath over resource IDs. App resource IDs are unreliable. Use `contains(@content-desc, "...")` and `starts-with(...)` for dynamic labels. `enforceXPath1: true` is set in caps.

**Polling over sleeping:** `pollUntil(condFn, timeout, intervalMs)` is the standard wait pattern. Hard `pause()` calls are a code smell.

**Page source parsing:** `WatchlistPage.getVisibleIndices()` and `getTotalTabCount()` use regex on raw page source instead of element queries — much faster for extracting counts from tab/list UIs.

**Silent error catching:** `try { /* risky */ } catch {}` is intentional for optional UI elements (ANR dialogs, permission popups). Not a bug, not to be removed.

**Resume mode:** Several suites support `RESUME_SESSION=1` to skip login when a session already exists on device.

**Device selection:**
```bash
# PowerShell
$env:TARGET_DEVICE='PIXEL_4A'; npm run test:login

# Bash
TARGET_DEVICE=PIXEL_4A npm run test:login
```

## Environment Setup

Create a `.env` file in the project root and fill in device UDIDs, credentials, and Gmail App Password for OTP automation.

Required `.env` keys:
- `TARGET_DEVICE` — `PIXEL_9A` or `PIXEL_4A`
- `PIXEL_9A_UDID` / `PIXEL_4A_UDID` — ADB device UDIDs
- `TEST_USER_ID` / `TEST_PASSWORD` — Globe Capital test credentials
- `GMAIL_USER` / `GMAIL_APP_PASSWORD` — Gmail + App Password for IMAP OTP fetching
- `OTP_EMAIL_FROM`, `OTP_EMAIL_SUBJECT`, `OTP_USER_ID` — OTP email filters

## Device Notes

**Pixel 9a / Stock Android:** Full automation support. Recommended primary device.

**MIUI/Xiaomi devices:** Gesture injection fails (MIUI strips `INJECT_EVENTS` from ADB shell). Fix: enable "USB Debugging (Security settings)" in MIUI Developer Options. Text entry (`ACTION_SET_TEXT`) still works.

**App binary:** `apps/android/base (2).apk` — Note the space in the filename; it is intentional and referenced in caps.

## Allure Reporting

Allure results auto-generated to `allure-results/` on every test run. `npm run test:report` generates and opens the HTML report. Screenshots on failure are saved to `reports/screenshots/` and attached to Allure.
