# Device Compatibility Report
## Appium Automation — Globe Capital Dev App

**Project:** Globe Capital Dev — Mobile Test Automation  
**Framework:** Appium 2.x + WebdriverIO v9 + UiAutomator2 + Mocha  
**Date:** 2026-06-11  
**Author:** QA Automation

---

## 1. Devices Under Test

| Property | Device A | Device B |
|---|---|---|
| **Model** | Google Pixel 9a | Xiaomi Redmi (23124RN87I) |
| **OS** | Android 16 (Stock AOSP) | Android 15 (MIUI) |
| **UDID** | 5B181XEBF4PE41 | — |
| **Automation Driver** | UiAutomator2 | UiAutomator2 |
| **Test Result** | PASS ✅ | FAIL ❌ |

---

## 2. How Appium Taps a Button

Before comparing devices, it helps to understand how Appium interacts with the UI.

When `element.click()` is called, UiAutomator2 uses one of two mechanisms:

### Mechanism 1 — Gesture Injection (default)
Synthesizes a physical touch event by writing to the kernel input subsystem (`/dev/input/event*`). This mimics a real finger press at screen coordinates.

- Requires `INJECT_EVENTS` permission on the ADB shell user
- Blocked by SELinux policy if not permitted

### Mechanism 2 — Accessibility Action
Calls `AccessibilityNodeInfo.performAction(ACTION_CLICK)` through the Android Accessibility framework. No touch event is generated — the framework directly signals the view.

- Does not require `INJECT_EVENTS`
- Works even when the element is off-screen or behind the keyboard
- Used by `element.setValue()` → `ACTION_SET_TEXT`

UiAutomator2 defaults to **Mechanism 1 (gesture injection)** for `click()` because it produces more realistic test results. `setValue()` always uses **Mechanism 2 (accessibility)** for text entry.

---

## 3. Google Pixel 9a — Stock Android 16

### Input Injection Status

| Method | Status | Notes |
|---|---|---|
| `el.click()` → gesture injection | ✅ Allowed | ADB shell has `INJECT_EVENTS` by default |
| `adb shell input tap x y` | ✅ Allowed | Full input access |
| `adb shell input keyevent` | ✅ Allowed | Key events work |
| `driver.hideKeyboard()` | ✅ Works | Sends IME hide signal |
| `el.setValue()` → `ACTION_SET_TEXT` | ✅ Works | Accessibility path |
| `pm clear <package>` | ✅ Works | Clears app data cleanly |
| `settings put secure/global` | ✅ Allowed | ADB shell has `WRITE_SECURE_SETTINGS` |

### Why It Works

Stock Android grants the ADB `shell` user a set of trusted permissions including `INJECT_EVENTS`. This allows Appium/UiAutomator2 to inject touch events, key presses, and gestures directly into the kernel input layer — exactly how a real user's finger would interact with the screen.

### Test Execution Result

| Test Step | Result |
|---|---|
| App cold launch via `am start -W` | ✅ Pass |
| Login ID text entry | ✅ Pass |
| Password text entry | ✅ Pass |
| Keyboard dismissal (`hideKeyboard`) | ✅ Pass |
| LOGIN button tap | ✅ Pass |
| OTP screen appeared after login | ✅ Pass |
| OTP auto-fetched from Gmail | ✅ Pass |
| OTP text entry | ✅ Pass |
| ENABLE NOW button tap | ✅ Pass |
| Second OTP entry | ✅ Pass |
| System PIN screen (Android biometric prompt) | ✅ Pass |
| PIN 2580 entry | ✅ Pass |
| Home screen reached | ✅ Pass |
| **Full test runtime** | ~1m 30s |

---

## 4. Xiaomi Redmi — MIUI Android 15

### Input Injection Status

| Method | Status | Error |
|---|---|---|
| `el.click()` → gesture injection | ❌ Blocked | `GestureController.performGesture()` throws reflection error — MIUI patched the class |
| `adb shell input tap x y` | ❌ Blocked | `INJECT_EVENTS` permission denied to ADB shell |
| `adb shell input keyevent` | ❌ Blocked | Same `INJECT_EVENTS` denial |
| `sendevent /dev/input/event*` | ❌ Blocked | SELinux policy denies writes to input devices, even though shell is in the `input` group (gid 1004) |
| `pm grant android.permission.INJECT_EVENTS` | ❌ Blocked | Requires `GRANT_RUNTIME_PERMISSIONS` — also denied |
| `settings put secure/global` | ❌ Blocked | Requires `WRITE_SECURE_SETTINGS` — denied on Android 15 |
| `mobile: performEditorAction` | ❌ Blocked | Internally calls `adb shell input text /action/` — blocked |
| `mobile: type` (with element) | ❌ Blocked | Falls back to `adb shell input text` — blocked |
| `driver.hideKeyboard()` | ❌ Blocked | Uses key injection internally |
| `el.setValue()` → `ACTION_SET_TEXT` | ✅ Works | Accessibility API — no input injection required |

### Why It Fails

MIUI introduces a security feature called **"USB Debugging (Security settings)"** — a separate developer toggle that, when disabled (which is the default), strips `INJECT_EVENTS` from the ADB shell user entirely. This is enforced at multiple layers:

1. **Kernel/SELinux layer** — SELinux policy blocks writes to `/dev/input/event*` regardless of Unix group membership
2. **Permission layer** — `INJECT_EVENTS` is removed from the ADB shell's permission set
3. **Permission grant layer** — `pm grant` for `INJECT_EVENTS` is itself blocked by a missing `GRANT_RUNTIME_PERMISSIONS`
4. **UiAutomator2 layer** — MIUI patched `GestureController` internals, causing reflection failures when UiAutomator2 tries to use them

This forms a complete lockdown of all input injection paths. No software-only workaround exists unless the device toggle is enabled.

### Test Execution Result

| Test Step | Result | Reason |
|---|---|---|
| App cold launch | ✅ Pass | `am start` is not blocked |
| Login ID text entry | ✅ Pass | Uses `ACTION_SET_TEXT` (accessibility) |
| Password text entry | ✅ Pass | Uses `ACTION_SET_TEXT` (accessibility) |
| Keyboard dismissal | ❌ Fail | `hideKeyboard()` uses key injection — blocked |
| **LOGIN button tap** | ❌ Fail | All gesture/click paths blocked |
| OTP screen | ❌ Never reached | LOGIN tap failed |
| **Full flow** | ❌ FAIL | Blocked at LOGIN step |

---

## 5. Side-by-Side Comparison

| Capability | Pixel 9a (Stock Android 16) | Redmi (MIUI Android 15) |
|---|---|---|
| **Gesture injection** | ✅ Full access | ❌ Completely blocked |
| **ADB input commands** | ✅ Work | ❌ INJECT_EVENTS denied |
| **SELinux enforcement** | Standard (input accessible) | Hardened (input devices sealed) |
| **INJECT_EVENTS** | Granted to ADB shell by default | Stripped by MIUI |
| **GRANT_RUNTIME_PERMISSIONS** | Available | Denied |
| **WRITE_SECURE_SETTINGS** | Available via ADB | Denied |
| **Accessibility ACTION_SET_TEXT** | ✅ Works | ✅ Works |
| **Accessibility ACTION_CLICK** | ✅ Works | ❌ Not exposed by Appium standard interface |
| **pm clear** | ✅ Works | ⚠️ Can leave app unlaunchable on MIUI |
| **hideKeyboard()** | ✅ Works | ❌ Blocked |
| **Test suite result** | ✅ PASS (1m 30s) | ❌ FAIL (blocked at LOGIN) |

---

## 6. Technical Deep-Dive: MIUI's Restriction Layers

```
[Test Code]
    │  el.click()
    ▼
[UiAutomator2]
    │  Tries: GestureController.performGesture()
    │  ❌ MIUI patched class → reflection error
    │
    │  Falls back: adb shell input tap
    │  ❌ INJECT_EVENTS not held by shell user
    │
    │  Falls back: sendevent /dev/input/event2
    │  ❌ SELinux policy: avc denied { write } to /dev/input/event2
    │
    │  No more fallbacks.
    ▼
  FAIL (error silently swallowed by _tap wrapper)
```

```
[Attempted Fix: pm grant]
    │  pm grant com.iouring.globecapital.dev android.permission.INJECT_EVENTS
    │  ❌ "Neither user 2000 nor current process has android.permission.GRANT_RUNTIME_PERMISSIONS"
    ▼
  BLOCKED

[Attempted Fix: settings put]
    │  settings put secure mock_location 0
    │  ❌ "Exception occurred while executing: java.lang.SecurityException:
    │      Permission denial: writing to settings requires WRITE_SECURE_SETTINGS"
    ▼
  BLOCKED

[Only Working Path on MIUI]
    │  el.setValue("text")
    │  → UiAutomator2 → AccessibilityNodeInfo.ACTION_SET_TEXT
    │  ✅ No INJECT_EVENTS required
    ▼
  WORKS (text input only — no tap/click)
```

---

## 7. Resolution

### Option A — Enable the MIUI security toggle (Recommended)

On the Redmi device:

1. Open **Settings**
2. Go to **Additional Settings → Developer Options**
3. Enable **USB Debugging (Security settings)**

This re-grants `INJECT_EVENTS` to the ADB shell user, unblocking all gesture injection. No code changes required.

> **Note:** This toggle is separate from the standard "USB Debugging" toggle. Both must be enabled.

### Option B — Use a different test device

Use a device running stock Android (Google Pixel, Android One, or stock AOSP). These devices do not restrict `INJECT_EVENTS` and work with standard Appium automation.

### Option C — Root the device

With root access, it is possible to:
- Modify the SELinux policy to allow input device writes
- Grant `INJECT_EVENTS` via `pm grant` as root

This is not recommended for a test environment.

### What does NOT work (confirmed)

The following approaches were fully investigated and are not viable on MIUI without the security toggle:

- Granting `INJECT_EVENTS` via `pm grant` — requires `GRANT_RUNTIME_PERMISSIONS` (also blocked)
- Writing input events via `sendevent` — blocked by SELinux at the kernel level
- Modifying `settings` namespaces — requires `WRITE_SECURE_SETTINGS` (blocked)
- `mobile: type`, `mobile: performEditorAction` — both internally use blocked ADB commands
- Any Appium plugin or strategy that ultimately generates a gesture — all blocked at the same layer

---

## 8. Appium Configuration Differences

### Pixel 9a (`wdio.android.conf.js`)

```javascript
'appium:udid':           '5B181XEBF4PE41',
'appium:deviceName':     'Pixel 9a',
'appium:platformVersion': '16',
'appium:skipUnlock':      true,
'appium:disableWindowAnimation': true,
'appium:autoGrantPermissions':   true,
```

### Redmi — Additional flags required

```javascript
// These were needed only for the Redmi / MIUI device:
'appium:skipServerInstallation':    true,  // MIUI blocks Appium server re-install
'appium:skipDeviceInitialization':  true,  // Avoids MIUI-specific init failures
```

> These flags are NOT needed on stock Android and should be removed when running on Pixel.

---

## 9. Summary

| | Pixel 9a | Redmi (MIUI) |
|---|---|---|
| **Automation viable** | Yes | No (without toggle) |
| **Blocker** | None | INJECT_EVENTS stripped by MIUI |
| **Text entry** | Works | Works |
| **Button taps** | Works | Blocked |
| **Recommended action** | Use as primary test device | Enable "USB Debugging (Security settings)" toggle |

The root cause is a **deliberate security hardening decision by Xiaomi** in MIUI, not a bug in the test code or Appium. The same test suite runs cleanly on any stock Android device.
