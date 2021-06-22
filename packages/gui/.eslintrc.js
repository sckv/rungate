const eslintConfig = require('../../.eslintrc.js');

module.exports = {
  ...eslintConfig,
  extends: eslintConfig.extends.concat(['next', 'next/core-web-vitals']),
};
