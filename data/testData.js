const testData = {
  validUser: {
    id:       process.env.TEST_USER_ID || 'TEMPMF11',
    password: process.env.TEST_PASSWORD || 'Globe@98',
  },
  invalidUser: {
    id:       process.env.INVALID_USER_ID || 'INVALID999',
    password: process.env.INVALID_PASSWORD || 'wrongpass',
  },
  devicePin: process.env.DEVICE_PIN || '2580',
};

module.exports = testData;
