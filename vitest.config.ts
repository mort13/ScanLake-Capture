import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts: the tests need neither React nor the Cloudflare plugin.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
