import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      exclude: ['src/**/*.d.ts'],
      include: ['src/**/*.ts'],
    },
    disableConsoleIntercept: true, // helps @sanity/cli-test helpers
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
