import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/db/migrations/**'],
      // Thresholds per .bobrules §5.1
      thresholds: {
        'src/eta/**': {
          lines: 95,
          branches: 90,
        },
        'src/clustering/**': {
          lines: 95,
          branches: 90,
        },
        'src/map-matching/**': {
          lines: 90,
          branches: 85,
        },
        'src/crowd-tags/**': {
          lines: 85,
          branches: 80,
        },
        // Global fallback
        lines: 80,
        branches: 75,
      },
      reporter: ['text', 'lcov', 'html'],
    },
    setupFiles: ['./test/setup.ts'],
  },
  resolve: {
    alias: {
      '@buselli/shared': path.resolve(__dirname, '../shared/src/index.ts'),
      '@buselli/backend': path.resolve(__dirname, './src'),
    },
  },
});
