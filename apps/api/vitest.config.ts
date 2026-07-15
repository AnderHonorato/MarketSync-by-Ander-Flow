import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: { reporter: ['text', 'html'] },
  },
});
