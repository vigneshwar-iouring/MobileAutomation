# 🚀 Globe Capital Mobile Test Automation Demo

**Project**: Mobile Test Automation Framework for Globe Capital App  
**Framework**: Appium + WebdriverIO + JavaScript  
**Platforms**: Android (iOS capable)  
**Date**: 2026-06-12

---

## 📋 Table of Contents
1. [Project Overview](#project-overview)
2. [Framework Architecture](#framework-architecture)
3. [Test Suites](#test-suites)
4. [Device Configuration](#device-configuration)
5. [Setup & Prerequisites](#setup--prerequisites)
6. [Running Tests](#running-tests)
7. [Demo Scenarios](#demo-scenarios)
8. [Test Reports](#test-reports)
9. [Troubleshooting](#troubleshooting)

---

## 📱 Project Overview

### Application Under Test
**Globe Capital Development App**
- **Package**: `com.iouring.globecapital.dev`
- **Main Activity**: `com.iouring.globecapital.MainActivity`
- **Platforms**: Android (API 13-16), iOS support available

### Purpose
Automated mobile testing of authentication workflows, OTP verification, biometric setup, and watchlist management on the Globe Capital mobile application.

### Key Features Tested
- ✅ **User Login** - Credential validation, error handling
- ✅ **OTP Verification** - Email-based OTP fetching and entry
- ✅ **Biometric Setup** - Fingerprint/face recognition configuration
- ✅ **Security Settings** - Secure app setup and PIN configuration
- ✅ **Watchlist Management** - Add/remove stocks, portfolio tracking

---

## 🏗️ Framework Architecture

### Technology Stack
```
Appium Server
    ↓
WebdriverIO (WDIO v9)
    ↓
JavaScript / Node.js
    ↓
Android Devices (Physical)
```

### File Structure
```
appium-js-framework/
├── tests/                    # Test suites
│   ├── login/               # Login & authentication tests
│   ├── watchlist/           # Watchlist functionality tests
│   ├── smoke/               # Quick sanity checks
│   └── explore/             # Interactive device exploration
├── pages/                    # Page Object Model (POM)
│   └── Login/
│       ├── LoginPage.js
│       ├── OTPPage.js
│       ├── EnableSecurePage.js
│       ├── BiometricSetupPage.js
│       ├── HomePage.js
│       └── BasePage.js      # Base class for all pages
├── config/                   # Configuration files
│   ├── wdio.android.conf.js # WebdriverIO Android config
│   ├── wdio.ios.conf.js     # WebdriverIO iOS config
│   ├── caps.android.js      # Android device capabilities
│   └── wdio.base.conf.js    # Base configuration
├── utils/                    # Helper utilities
│   ├── emailOtp.js          # Gmail OTP fetching
│   ├── helpers.js           # Common functions
│   └── ...
├── data/                     # Test data
│   └── testData.js          # Credentials, test users
├── apps/                     # Application binaries
│   ├── android/
│   │   └── base (1).apk
│   └── ios/
├── logs/                     # Test execution logs
├── allure-results/          # Test results (Allure format)
├── reports/                 # HTML reports
├── .env                     # Environment configuration
└── package.json             # Dependencies & scripts
```

---

## 🧪 Test Suites

### 1. **Login Suite** - Authentication Testing
**Command**: `npm run test:login`

Tests covered:
- ✅ User login with valid credentials
- ✅ OTP verification via email
- ✅ Invalid credential handling
- ✅ Biometric setup
- ✅ Security page navigation

**Key Files**:
- `tests/login/login.spec.js`
- `pages/Login/LoginPage.js`
- `pages/Login/OTPPage.js`

---

### 2. **Watchlist Suite** - Portfolio Management
**Command**: `npm run test:watchlist`

Tests covered:
- ✅ Add stocks to watchlist
- ✅ Remove stocks from watchlist
- ✅ View watchlist items
- ✅ Stock price updates

**Key Files**:
- `tests/watchlist/watchlist.spec.js`
- `pages/Watchlist/WatchlistPage.js`

---

### 3. **Smoke Tests** - Quick Sanity Checks
**Command**: `npm run test:android:smoke`

Lightweight tests for CI/CD pipelines:
- ✅ App launch
- ✅ Login screen display
- ✅ Basic navigation

---

### 4. **E2E (End-to-End)** - Complete User Journey
**Command**: `npm run demo`

Full workflow testing:
1. Launch app
2. Login with credentials
3. Verify OTP
4. Setup biometrics
5. Navigate to watchlist
6. Add/remove stocks
7. Return to home

---

## 📱 Device Configuration

### Supported Devices

#### Device 1: Google Pixel 9a (USB)
```
Device Name:    Pixel 9a
UDID:           5B181XEBF4PE41
Android Version: 16
PIN:            2580
Connection:     USB
Status:         ✅ Configured & Ready
```

#### Device 2: Google Pixel 4a (USB)
```
Device Name:    Pixel 4a
UDID:           14081JEC205128
Android Version: 13
PIN:            11111
Connection:     USB
Status:         ⏳ Configured, awaiting authorization
```

### Switching Devices

**Option 1: Edit `.env` file**
```bash
# .env
TARGET_DEVICE=PIXEL_9A    # or PIXEL_4A
```

**Option 2: Command line**
```powershell
$env:TARGET_DEVICE='PIXEL_4A'; npm run test:login
```

**Option 3: In test code**
```javascript
process.env.TARGET_DEVICE = 'PIXEL_4A';
const { androidCaps } = require('./config/caps.android');
```

---

## 🔧 Setup & Prerequisites

### System Requirements
- Windows 10/11
- Node.js 18+
- Android SDK
- Appium 3.0+

### Installation Steps

**1. Install Node dependencies**
```bash
npm install
```

**2. Install Appium drivers**
```bash
npm run appium:setup
```

**3. Set up Android SDK**
```bash
Set-ExecutionPolicy Bypass -Scope Process
$env:ANDROID_HOME='C:\Users\NewUser\AppData\Local\Android\Sdk'
```

**4. Configure `.env` file**
```bash
# Copy from .env.example (already configured)
# Key configurations:
APPIUM_HOST=127.0.0.1
APPIUM_PORT=4723
TARGET_DEVICE=PIXEL_9A
TEST_USER_ID=TEMPMF11
TEST_PASSWORD=Globe@98
```

**5. Gmail OTP Setup (Optional)**
```bash
# Enable IMAP in Gmail
# Create App Password: https://myaccount.google.com/apppasswords
# Add to .env:
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
```

### Device Preparation

**Enable USB Debugging on Device**:
1. Settings → About phone
2. Tap "Build number" 7 times
3. Go back to Settings
4. Open "Developer options"
5. Enable "USB Debugging"
6. Connect via USB
7. Tap "Trust this computer" on device popup

**Verify Connection**:
```powershell
& "$env:ANDROID_HOME\platform-tools\adb.exe" devices

# Expected output:
# List of devices attached
# 5B181XEBF4PE41    device
```

---

## 🎯 Running Tests

### Starting Appium Server
```bash
npm run appium:start
```
Server runs on: `http://127.0.0.1:4723`

### Running Test Suites

**Run all Android tests**
```bash
npm run test:android
```

**Run login tests only**
```bash
npm run test:login
```

**Run watchlist tests only**
```bash
npm run test:watchlist
```

**Run smoke tests (quick)**
```bash
npm run test:android:smoke
```

**Run full E2E demo**
```bash
npm run demo
```

**Run with specific device**
```powershell
# Terminal 1 - Start Appium
npm run appium:start

# Terminal 2 - Run tests on Pixel 4a
$env:TARGET_DEVICE='PIXEL_4A'; npm run test:login
```

---

## 🎬 Demo Scenarios

### Demo 1: Quick Login Flow (5 minutes)

**Setup**:
- Device: Pixel 9a
- Internet: Required (for OTP)

**Steps**:
```bash
# Terminal 1
npm run appium:start

# Terminal 2
npm run test:login
```

**What happens**:
1. ✅ App launches
2. ✅ Login screen displays
3. ✅ User credentials entered
4. ✅ OTP fetched from Gmail
5. ✅ OTP verified
6. ✅ Biometric setup initiated
7. ✅ Home screen confirmed

**Expected Output**:
```
[Pixel 9a Android 16 #0-0] Running: Pixel 9a on Android 16
[Pixel 9a Android 16 #0-0] ✓ Full Login Flow > 
  ✓ should login with valid credentials
  ✓ should enter correct OTP
  ✓ should setup biometric
```

---

### Demo 2: Device Switching (3 minutes)

**Setup**:
- Device 1: Pixel 9a
- Device 2: Pixel 4a (connected)

**Steps**:
```bash
# Edit .env
TARGET_DEVICE=PIXEL_4A

# Run tests
npm run test:login
```

**What happens**:
1. Framework detects Pixel 4a from `.env`
2. Connects to Pixel 4a (UDID: 14081JEC205128)
3. Uses Pixel 4a's PIN (11111)
4. Runs identical test suite on different device

---

### Demo 3: Full E2E Journey (10 minutes)

**Setup**:
- Device: Pixel 9a or Pixel 4a
- Gmail OTP enabled

**Steps**:
```bash
npm run demo
```

**What happens**:
1. ✅ App launches on device
2. ✅ Login with test credentials
3. ✅ OTP verification
4. ✅ Biometric setup
5. ✅ Navigate to watchlist
6. ✅ Add stocks to watchlist
7. ✅ Verify stocks appear
8. ✅ Remove stocks
9. ✅ Return to home screen

---

## 📊 Test Reports

### Generate Allure Report
```bash
npm run test:report
```

This will:
1. Collect test results from `allure-results/`
2. Generate HTML report in `allure-report/`
3. Open browser automatically

### View Test Logs
```bash
# Latest login test log
cat logs/test-login-*.log | tail -100

# Check for errors
ls -la logs/
```

### Screenshots & Video
- UI dumps saved in: `ui_dumps/`
- Screen captures in: `allure-results/` (attachments)

---

## 🔍 Key Page Objects

### LoginPage
```javascript
// File: pages/Login/LoginPage.js

await loginPage.waitForLoginScreen(60000)     // Wait for login screen
await loginPage.enterLoginId('TEMPMF11')      // Enter user ID
await loginPage.enterPassword('Globe@98')     // Enter password
await loginPage.tapLogin()                    // Click login button
await loginPage.tapSignUp()                   // Go to signup
await loginPage.tapForgotPassword()           // Go to forgot password
```

### OTPPage
```javascript
// File: pages/Login/OTPPage.js

await otpPage.waitForOTPScreen(60000)         // Wait for OTP input
await otpPage.enterOTP('123456')              // Enter 6-digit OTP
await otpPage.tapVerify()                     // Verify OTP
```

### BiometricPage
```javascript
// File: pages/Login/BiometricSetupPage.js

await biometricPage.waitForSetup(30000)       // Wait for biometric screen
await biometricPage.tapEnable()               // Enable biometric
await biometricPage.tapSkip()                 // Skip biometric setup
```

---

## 🔐 Test Credentials

**Valid User**:
```
User ID:    TEMPMF11
Password:   Globe@98
Device PIN: 2580 (Pixel 9a) / 11111 (Pixel 4a)
```

**Invalid User** (for negative testing):
```
User ID:    INVALID999
Password:   wrongpass
```

---

## 🛠️ Troubleshooting

### Issue 1: Device Shows "offline"

**Problem**: Device connected but shows as offline

**Solution**:
1. Unplug USB cable
2. Re-plug USB cable
3. Tap "Trust" on device popup
4. Run: `& "$env:ANDROID_HOME\platform-tools\adb.exe" kill-server`
5. Run: `& "$env:ANDROID_HOME\platform-tools\adb.exe" start-server`
6. Verify: `& "$env:ANDROID_HOME\platform-tools\adb.exe" devices`

---

### Issue 2: Appium Server Connection Error

**Problem**: "Could not find a connected Android device in 20000ms"

**Solution**:
1. Verify Appium server is running: `npm run appium:start`
2. Check device connection: `adb devices`
3. Ensure device shows as "device" (not "offline")
4. Verify UDID in `.env` matches `adb devices` output
5. Restart Appium server

---

### Issue 3: OTP Not Fetching

**Problem**: "Failed to fetch OTP from Gmail"

**Solution**:
1. Verify Gmail credentials in `.env`:
   ```
   GMAIL_USER=your-email@gmail.com
   GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
   ```
2. Enable IMAP: Gmail → Settings → Forwarding and POP/IMAP
3. Create App Password: https://myaccount.google.com/apppasswords
4. Verify IMAP permission in `utils/emailOtp.js`

---

### Issue 4: App Installation Fails

**Problem**: "Failed to install app on device"

**Solution**:
1. Verify APK exists: `ls apps/android/`
2. Check device storage: `adb shell df /data`
3. Clear app: `adb shell pm clear com.iouring.globecapital.dev`
4. Reinstall: `npm run test:login`

---

## 📞 Support & Debug

### Enable Debug Logging
```javascript
// In test file
browser.enableLogging();

// In terminal output:
console.log('🔍 Debug info:', variable);
```

### View Device UI Hierarchy
```bash
npm run explore
```

This launches interactive device exploration to inspect UI elements.

---

### Capture Device Screen
```bash
# In test
await dumpScreen('login-screen');

# Saved to: ui_dumps/login-screen-*.xml
```

---

## 📈 Performance Metrics

Typical test execution times:

| Test Suite | Device | Time | Status |
|-----------|--------|------|--------|
| Login Flow | Pixel 9a | ~2-3 min | ✅ Pass |
| Watchlist | Pixel 9a | ~2-3 min | ✅ Pass |
| Smoke Tests | Pixel 9a | ~1 min | ✅ Pass |
| Full E2E | Pixel 9a | ~5-7 min | ✅ Pass |

---

## 🎓 Learning Resources

- [Appium Documentation](https://appium.io/)
- [WebdriverIO Guide](https://webdriver.io/)
- [Mobile Testing Best Practices](https://webdriver.io/docs/appium/)
- [Page Object Model Pattern](https://webdriver.io/docs/pageobjects/)

---

## 📝 Summary

**Current Setup**:
- ✅ Framework: Appium + WebdriverIO v9
- ✅ Devices: Pixel 9a (Active), Pixel 4a (Configured)
- ✅ Test Suites: Login, Watchlist, Smoke, E2E
- ✅ Reporting: Allure Reports + HTML logs
- ✅ OTP Support: Gmail integration for auto-OTP
- ✅ CI/CD Ready: PowerShell scripts for automation

**Next Steps for Demo**:
1. Connect Pixel 9a or Pixel 4a via USB
2. Start Appium: `npm run appium:start`
3. Run demo: `npm run demo`
4. View report: `npm run test:report`

---

**Last Updated**: 2026-06-12  
**Framework Version**: 1.0.0  
**Status**: ✅ Production Ready

