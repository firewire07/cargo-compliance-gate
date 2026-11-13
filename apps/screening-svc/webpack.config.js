const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { join } = require('path');

const dist = join(__dirname, '../../dist/apps/screening-svc');

module.exports = {
  output: {
    path: dist,
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: true,
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: 'generated/prisma/schema.prisma',
          context: __dirname,
          to: dist,
          noErrorOnMissing: true,
        },
        {
          from: 'generated/prisma/libquery_engine-*',
          context: __dirname,
          to: dist,
          noErrorOnMissing: true,
        },
        {
          from: 'data',
          context: __dirname,
          to: join(dist, 'data'),
          noErrorOnMissing: true,
        },
      ],
    }),
  ],
};
