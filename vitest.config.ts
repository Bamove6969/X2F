import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { projects: ['packages/*', 'tools/regtest/vitest.config.ts', 'tools/regtest/vitest.verify.config.ts'] },
});
