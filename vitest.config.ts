import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { projects: ['packages/*', 'apps/relay', 'tools/regtest/vitest.config.ts', 'tools/regtest/vitest.verify.config.ts'] },
});
