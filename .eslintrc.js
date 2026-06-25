module.exports = {
  env: {
    node: true,
    es2021: true,
    mocha: true,
  },
  globals: {
    browser: 'readonly',
    driver: 'readonly',
    $: 'readonly',
    $$: 'readonly',
  },
  parserOptions: {
    ecmaVersion: 2021,
  },
  rules: {
    'no-unused-vars': 'warn',
    'no-console': 'off',
    'prefer-const': 'error',
  },
};
