import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    exclude: ['**/node_modules/**', '**/_salvage/**', '**/dist/**'],
  },
});
