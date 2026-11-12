import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@x2f/web',
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
