const path = require('path');
const nxPreset = require('@nx/jest/preset').default;

module.exports = {
  ...nxPreset,
  moduleNameMapper: {
    ...(nxPreset.moduleNameMapper || {}),
    '^@cargo-compliance-gate/contracts$': path.join(
      __dirname,
      'libs/contracts/src/index.ts',
    ),
  },
};
