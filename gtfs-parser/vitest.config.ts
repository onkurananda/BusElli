import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/cli.ts', 'src/index.ts'],
      thresholds: {
        lines: 90,
        branches: 85,
      },
      reporter: ['text', 'lcov'],
    },
  },
  resolve: {
    alias: {
      '@buselli/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
