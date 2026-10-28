import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['worker/test/**/*.test.ts'],
    environment: 'node',
    // The OpenF1 adapter serialises requests with a 500 ms gap on purpose.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
