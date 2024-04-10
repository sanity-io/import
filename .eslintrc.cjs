module.exports = {
  env: {
    browser: false,
    node: true,
  },
  parserOptions: {
    ecmaVersion: 2020,
  },
  extends: ['sanity', 'plugin:prettier/recommended'],
  plugins: ['prettier'],
}
