import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    exclude: ['**/node_modules/**', '**/_salvage/**', '**/dist/**'],
    env: {
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres@localhost:5432/market_hft_test',
    },
  },
});
