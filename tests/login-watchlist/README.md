# 🔄 Login + Watchlist Continuous Flow

## Overview

The **Login + Watchlist Continuous Flow** test suite runs a complete end-to-end testing scenario combining:

1. **🔐 Phase 1**: Full authentication workflow (Login → OTP1 → Enable Secure → OTP2 → PIN)
2. **📊 Phase 2**: Watchlist operations (UI verification, tab navigation, bottom navigation)

This is perfect for:
- ✅ **Continuous testing** during development
- ✅ **Regression testing** to ensure nothing breaks
- ✅ **Demo scenarios** showing complete user flows
- ✅ **CI/CD pipelines** with scheduled test runs
- ✅ **Device testing** validating both login and core features

---

## 🚀 Quick Start

### Run Continuous Flow
```bash
# Terminal 1 - Start Appium
npm run appium:start

# Terminal 2 - Run continuous login + watchlist
npm run test:login-watchlist
```

### Expected Execution Time
- **~5-10 minutes** depending on device speed and network
- Includes OTP generation and auto-retry logic

---

## 📋 Test Structure

### Phase 1️⃣: Authentication (6 Steps)

```
✅ Step 1: Enter Credentials & Login
✅ Step 2: FIRST OTP Verification (with auto-retry)
✅ Step 3: Tap ENABLE NOW for Globe Secure
✅ Step 4: SECOND OTP Verification (with auto-retry)
✅ Step 5: Enter PIN (if required)
✅ Step 6: Reach Home Screen (Watchlist)
```

**Key Features**:
- OTP retry logic: If OTP is incorrect, waits 5s and fetches new OTP
- Auto-retry up to 3 times
- Handles PIN setup screen gracefully (skips if already registered)

### Phase 2️⃣: Watchlist Operations (13 Tests)

#### 2.1 - UI Elements (9 Tests)
- Watchlist header display
- Market indices (NIFTY 50, BANKNIFTY, SENSEX)
- Default tab selection
- Tab count verification
- Search box display
- Stock list display
- Navigation tabs verification

#### 2.2 - Tab Navigation (4 Tests)
- Switch to Watchlist2
- Switch back to Watchlist1
- Switch to Watchlist3
- Switch to Watchlist4

#### 2.3 - Bottom Navigation (4 Tests)
- Navigate to Market tab & back
- Navigate to Orders tab & back
- Navigate to Portfolio tab & back
- Navigate to Mutual Funds tab & back

---

## 🎯 Use Cases

### Use Case 1: Daily Smoke Testing
```bash
npm run test:login-watchlist
```
Runs the complete flow once to ensure login and basic watchlist functionality work.

### Use Case 2: CI/CD Pipeline
```bash
# Add to GitHub Actions / Jenkins
npm run appium:start &
sleep 5
npm run test:login-watchlist
npm run test:report
```

### Use Case 3: Device Compatibility Testing
```bash
# Test on Pixel 9a
npm run test:login-watchlist

# Switch device in .env
# TARGET_DEVICE=PIXEL_4A

# Test on Pixel 4a
npm run test:login-watchlist
```

### Use Case 4: Stress Testing (Repeat N Times)
```powershell
# PowerShell: Run 5 times
1..5 | ForEach-Object {
  Write-Host "Run $_/5"
  npm run test:login-watchlist
}
```

---

## 🔧 Configuration

### Device Selection
Edit `.env`:
```env
TARGET_DEVICE=PIXEL_9A    # or PIXEL_4A
```

Or via command line:
```bash
$env:TARGET_DEVICE='PIXEL_4A'; npm run test:login-watchlist
```

### Test Credentials
```env
TEST_USER_ID=TEMPMF11
TEST_PASSWORD=Globe@98
DEVICE_PIN=2580 (Pixel 9a) / 11111 (Pixel 4a)
```

### Gmail OTP Configuration
For automatic OTP fetching:
```env
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
```

### OTP Retry Settings
The test suite includes automatic retry logic:
- **Max retries**: 3 attempts
- **Delay**: 5 seconds between retries
- **Fresh OTP**: Fetches new OTP from Gmail on retry

---

## 📊 Console Output Example

```
═════════════════════════════════════════════════════════════════
🟢 PHASE 1: AUTHENTICATION & LOGIN
═════════════════════════════════════════════════════════════════

  📝 Step 1: Entering credentials...
    ✅ User ID entered: TEMPMF11
    ✅ Password entered
    ✅ LOGIN button tapped

  🔐 Step 2: First OTP Verification (with auto-retry)...
    ✅ OTP screen loaded
    📧 Fetching FIRST OTP from Gmail...
    ✅ Got FIRST OTP: 123456
    📝 Entering FIRST OTP...
    ⏳ Verifying FIRST OTP...
    ✅ FIRST OTP verified successfully

  🔒 Step 3: Enabling Globe Secure...
    ✅ Enable Secure page loaded
    ✅ ENABLE NOW tapped

  🔐 Step 4: Second OTP Verification (with auto-retry)...
    ✅ OTP screen loaded
    📧 Fetching SECOND OTP from Gmail...
    ✅ Got SECOND OTP: 234567
    📝 Entering SECOND OTP...
    ⏳ Verifying SECOND OTP...
    ✅ SECOND OTP verified successfully

  🔑 Step 5: PIN Setup (if required)...
    ℹ️  No PIN setup required (already registered)

  🏠 Step 6: Verifying Home Screen...
    ✅ Home screen (Watchlist) reached

═════════════════════════════════════════════════════════════════
🟡 PHASE 2: WATCHLIST OPERATIONS
═════════════════════════════════════════════════════════════════

  📋 2.1.1 Verifying header...
    ✅ Header displayed

  📈 2.1.2 Verifying NIFTY 50...
    ✅ NIFTY 50 visible

  [More tests...]

═════════════════════════════════════════════════════════════════
🟢 ALL TESTS COMPLETED SUCCESSFULLY!
═════════════════════════════════════════════════════════════════

📊 Summary:
  ✅ Phase 1: Authentication (6 steps)
  ✅ Phase 2: Watchlist Operations (13 tests)
  ✅ Total: 19 test cases passed

⏱️  Total Execution Time: ~5-10 minutes
```

---

## 🐛 Troubleshooting

### Issue: OTP Verification Fails Repeatedly

**Cause**: Gmail OTP not being fetched correctly

**Solution**:
1. Verify Gmail credentials in `.env`
2. Check IMAP is enabled in Gmail
3. Verify App Password is set correctly (no extra spaces)
4. Check `.env` has `GMAIL_USER` and `GMAIL_APP_PASSWORD`

```env
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
```

### Issue: Device Not Found

**Cause**: Device is offline or not connected

**Solution**:
```bash
& "$env:ANDROID_HOME\platform-tools\adb.exe" devices
```

Device should show as "device" (not "offline")

### Issue: Tests Timeout

**Cause**: Device is slow or app is hanging

**Solution**:
1. Increase timeout in test:
```javascript
await otpPage.waitForNavigation(240000)  // 4 minutes
```

2. Restart Appium server:
```bash
npm run appium:start
```

---

## 📈 Performance Metrics

| Metric | Value |
|--------|-------|
| Total Test Cases | 19 |
| Phase 1 (Auth) | ~2-3 min |
| Phase 2 (Watchlist) | ~2-3 min |
| **Total Time** | **~5-10 min** |
| OTP Retry Attempts | 3 max |
| Expected Pass Rate | >95% |

---

## 🔄 Continuous/Loop Execution

### Run Tests in a Loop (PowerShell)

```powershell
# Run 10 times continuously
1..10 | ForEach-Object {
  Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Green
  Write-Host "Run $_ / 10" -ForegroundColor Green
  Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Green
  npm run test:login-watchlist
  
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Test failed on run $_" -ForegroundColor Red
    break
  }
  
  Write-Host "✅ Run $_ passed" -ForegroundColor Green
  Start-Sleep -Seconds 5
}
```

### Run Until Failure (PowerShell)

```powershell
$iteration = 0
while ($true) {
  $iteration++
  Write-Host "Run $iteration starting at $(Get-Date)" -ForegroundColor Cyan
  
  npm run test:login-watchlist
  
  if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ FAILED on iteration $iteration" -ForegroundColor Red
    break
  }
  
  Write-Host "✅ Iteration $iteration passed" -ForegroundColor Green
  Start-Sleep -Seconds 10
}
```

---

## 📄 File Locations

- **Test File**: [tests/login-watchlist/login-watchlist-flow.spec.js](tests/login-watchlist/login-watchlist-flow.spec.js)
- **Config**: [config/wdio.android.conf.js](config/wdio.android.conf.js) (suite: `login-watchlist`)
- **Package Script**: [package.json](package.json) (`test:login-watchlist`)
- **Logs**: `logs/test-login-watchlist-*.log`
- **Reports**: `allure-results/` + `allure-report/`

---

## ✅ Next Steps

1. ✅ Connect device via USB
2. ✅ Start Appium: `npm run appium:start`
3. ✅ Run tests: `npm run test:login-watchlist`
4. ✅ View report: `npm run test:report`

---

## 📞 Support

For issues with:
- **OTP Retry Logic**: See [utils/otpRetry.js](utils/otpRetry.js)
- **Device Configuration**: See `.env` file and [DEMO.md](DEMO.md)
- **Test Framework**: See [WebdriverIO Documentation](https://webdriver.io/)

---

**Created**: 2026-06-12  
**Status**: ✅ Ready for Use  
**Total Test Cases**: 19  
**Expected Duration**: 5-10 minutes
