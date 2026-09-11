import fsd from '@feature-sliced/steiger-plugin';
import { defineConfig } from 'steiger';

export default defineConfig([
  ...fsd.configs.recommended,
  {
    // src/app is the Next.js routing layer, not an FSD layer
    files: ['./src/app/**'],
    rules: {
      'fsd/forbidden-imports': 'off',
      'fsd/public-api': 'off',
      'fsd/no-public-api-sidestep': 'off',
    },
  },
]);
