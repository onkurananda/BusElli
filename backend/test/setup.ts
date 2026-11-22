// Global test setup — runs before every test file.
// Extend with any global mocks, polyfills, or DB setup hooks here.

import { vi } from 'vitest';

// Ensure crypto.randomUUID is available in test environment
if (typeof globalThis.crypto === 'undefined') {
  const { webcrypto } = await import('node:crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
  });
}
