import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The build-time flags (vite.config.ts): tests run as a production build would.
  define: { __X2F_FIXTURES__: 'false', __X2F_DEMO__: 'false' },
  test: {
    name: '@x2f/web',
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
