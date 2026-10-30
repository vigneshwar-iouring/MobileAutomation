const testData = {
  validUser: {
    id:       process.env.TEST_USER_ID || 'TEMPMF!!',
    password: process.env.TEST_PASSWORD || 'Globe@4321',
  },
  invalidUser: {
    id:       process.env.INVALID_USER_ID || 'INVALID999',
    password: process.env.INVALID_PASSWORD || 'wrongpass',
  },
  devicePin: process.env.DEVICE_PIN || '11111',
};

module.exports = testData;
