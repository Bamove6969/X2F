import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { projects: ['packages/*', 'apps/relay', 'apps/node-proxy', 'apps/api', 'apps/moderation', 'apps/web', 'apps/staff-web', 'tools/vitest.config.ts','tools/regtest/vitest.config.ts', 'tools/regtest/vitest.verify.config.ts'] },
});
