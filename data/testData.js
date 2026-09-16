const testData = {
  // Regression currently runs as EKY6998 - switched from TEMPMF11, which the same TEMPMF11
  // account used by tests/loginWithOtp.test.js kept hitting "Unable to connect to endpoint"
  // on repeated regression runs (looked like a per-account login cooldown/rate-limit).
  // The other accounts below (id1-id3) are kept as alternates to rotate to if this one also
  // gets rate-limited.
  validUser: {
    id: process.env.TEST_USER_ID || 'EKY6998',
    password: process.env.TEST_PASSWORD || 'May@2026',
    id1: 'TEMPMF11',
    password1: 'Globe@1234',
    id2: 'HOGC1103',
    password2: 'Jaya@0005',
    id3: 'TEMPMF2',
    password3: 'Globe@9876',
  },
  invalidUser: {
    id: process.env.INVALID_USER_ID || 'INVALID999',
    password: process.env.INVALID_PASSWORD || 'wrongpass',
  },
  devicePin: process.env.DEVICE_PIN || '11111',
};

module.exports = testData;
