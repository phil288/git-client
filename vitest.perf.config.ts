import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  test: {
    environment: 'node',
    include: ['tests/perf/**/*.perf.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000
  }
})
