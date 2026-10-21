import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { projects: ['packages/*', 'apps/relay', 'apps/api', 'apps/web', 'tools/regtest/vitest.config.ts', 'tools/regtest/vitest.verify.config.ts'] },
});
