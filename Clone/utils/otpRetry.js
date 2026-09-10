/**
 * OTP Retry Handler with Automatic Recovery
 * 
 * If OTP verification fails (incorrect OTP), waits a few seconds then:
 * - Fetches a fresh OTP from Gmail
 * - Re-enters the new OTP
 * - Retries verification
 * 
 * Usage:
 *   const freshOtp = await retryOtpWithDelay({
 *     getOtpFunction: getOtpFromGmail,
 *     label: 'FIRST OTP',
 *     maxRetries: 3,
 *     delaySeconds: 5,
 *   });
 */

const otpPage = require('../pages/Login/OTPPage');

/**
 * Retry OTP verification with automatic recovery
 * 
 * @param {object} opts
 * @param {function} opts.getOtpFunction - Function that fetches OTP (e.g., fetchOtpFromGmail)
 * @param {string} opts.label - Label for logging (e.g., "FIRST OTP", "SECOND OTP")
 * @param {number} [opts.maxRetries] - Max retry attempts (default: 3)
 * @param {number} [opts.delaySeconds] - Wait time before retrying after failure (default: 5)
 * @returns {Promise<string>} - The successful OTP
 */
async function retryOtpWithDelay({
  getOtpFunction,
  label = 'OTP',
  maxRetries = 3,
  delaySeconds = 5,
} = {}) {
  if (!getOtpFunction) {
    throw new Error('getOtpFunction is required');
  }

  let attempt = 0;
  let lastError = null;

  while (attempt < maxRetries) {
    attempt++;
    console.log(`\n  🔄 OTP Attempt ${attempt}/${maxRetries} - Fetching ${label}...`);

    try {
      // Fetch fresh OTP
      const otp = await getOtpFunction(label);
      
      if (!otp) {
        console.log(`  ⚠️  OTP is null/empty, retrying...`);
        if (attempt < maxRetries) {
          console.log(`  ⏳ Waiting ${delaySeconds}s before retry...`);
          await browser.pause(delaySeconds * 1000);
          await otpPage.tapResend();  // Resend OTP button
          await browser.pause(2000);
        }
        continue;
      }

      console.log(`  ✅ Got ${label}: ${otp}`);

      // Enter OTP
      console.log(`  📝 Entering ${label}...`);
      await otpPage.enterOTP(otp);
      
      // Wait for verification
      console.log(`  ⏳ Verifying ${label}...`);
      const verified = await otpPage.waitForNavigation(120000);

      if (verified) {
        console.log(`  ✅ ${label} accepted successfully!`);
        return otp;
      } else {
        // OTP was rejected - fetch new one
        lastError = `${label} was not accepted by server`;
        console.log(`  ❌ ${lastError}`);
        
        if (attempt < maxRetries) {
          console.log(`  ⏳ Waiting ${delaySeconds}s before fetching new OTP...`);
          await browser.pause(delaySeconds * 1000);
          
          // Tap resend if we're still on OTP screen
          try {
            if (await otpPage.isLoaded(3000)) {
              console.log(`  🔄 Requesting new ${label}...`);
              await otpPage.tapResend();
              await browser.pause(2000);
            }
          } catch (e) {
            console.log(`  ⚠️  Could not tap resend: ${e.message}`);
          }
        }
      }
    } catch (error) {
      lastError = error.message;
      console.log(`  ❌ Error during attempt ${attempt}: ${error.message}`);

      if (attempt < maxRetries) {
        console.log(`  ⏳ Waiting ${delaySeconds}s before retry...`);
        await browser.pause(delaySeconds * 1000);
      }
    }
  }

  // All retries exhausted
  throw new Error(
    `Failed to get and verify ${label} after ${maxRetries} attempts. Last error: ${lastError}`
  );
}

/**
 * Wrapper for Gmail OTP with retry logic
 * 
 * @param {object} gmailConfig - Gmail credentials and settings
 * @param {string} gmailConfig.user - Gmail address
 * @param {string} gmailConfig.password - Gmail App Password
 * @param {string} [gmailConfig.userIdFilter] - Filter by user ID (e.g., "TEMPMF11")
 * @param {string} [gmailConfig.fromFilter] - Filter by sender
 * @param {string} [gmailConfig.subjFilter] - Filter by subject
 * @param {number} [gmailConfig.timeout] - Timeout in ms
 * @returns {Promise<function>} - Function that fetches OTP
 */
function createGmailOtpFetcher(gmailConfig) {
  const { fetchOtpFromGmail } = require('./emailOtp');

  return async (label) => {
    console.log(`  📧 Fetching ${label} from Gmail...`);
    try {
      const otp = await fetchOtpFromGmail({
        user: gmailConfig.user,
        password: gmailConfig.password,
        fromFilter: gmailConfig.fromFilter,
        subjFilter: gmailConfig.subjFilter,
        userIdFilter: gmailConfig.userIdFilter,
        timeout: gmailConfig.timeout || 120000,
      });
      return otp;
    } catch (error) {
      console.log(`  ❌ Gmail fetch error: ${error.message}`);
      throw error;
    }
  };
}

module.exports = {
  retryOtpWithDelay,
  createGmailOtpFetcher,
};
