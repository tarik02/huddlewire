import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    printWidth: 100,
    semi: true,
    singleQuote: true,
    sortImports: true,
    sortPackageJson: {
      sortScripts: true,
    },
    trailingComma: 'all',
  },
  lint: {
    categories: {
      correctness: 'error',
      pedantic: 'error',
      perf: 'error',
      suspicious: 'error',
    },
    env: {
      node: true,
    },
    options: {
      denyWarnings: true,
      reportUnusedDisableDirectives: 'error',
      typeAware: true,
    },
    overrides: [
      {
        env: {
          browser: true,
        },
        files: ['src/slack/pages.ts', 'src/slack/sticker.ts'],
        rules: {
          'unicorn/consistent-function-scoping': 'off',
        },
      },
    ],
    plugins: ['import', 'node', 'promise', 'typescript', 'unicorn'],
    rules: {
      'import/group-exports': 'error',
      'import/max-dependencies': 'off',
      'import/prefer-default-export': 'error',
      'max-lines-per-function': 'off',
      'no-ternary': 'error',
      'sort-keys': 'error',
      'typescript/prefer-readonly-parameter-types': 'off',
    },
  },
});
