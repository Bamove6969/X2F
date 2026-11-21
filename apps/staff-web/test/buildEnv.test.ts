// Design build task 9: a production build of the staff app pins the moderation signing key
// (VITE_MOD_SIGNING_PUBLIC), so the build fails loudly without it rather than ship a ModCase that
// can open no disputed chat. Dev builds and the vitest run need no key.
import type { ConfigEnv, UserConfig } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import config, { checkBuildEnv } from '../vite.config.js';

const KEY = 'ab'.repeat(32);
const configFor = (mode: string) => (config as (e: ConfigEnv) => UserConfig)({ mode, command: 'build', isSsrBuild: false, isPreview: false });

describe('checkBuildEnv', () => {
  it('fails a production build without VITE_MOD_SIGNING_PUBLIC, or with it empty, naming the variable', () => {
    expect(() => checkBuildEnv('production', {})).toThrow(/VITE_MOD_SIGNING_PUBLIC must be set for a production build/);
    expect(() => checkBuildEnv('production', { VITE_MOD_SIGNING_PUBLIC: '' })).toThrow(/VITE_MOD_SIGNING_PUBLIC must be set/);
  });

  it('fails a production build whose key is not 64 lower-case hex', () => {
    for (const v of ['ab'.repeat(31), 'AB'.repeat(32), `${'ab'.repeat(32)}00`, 'zz'.repeat(32), ` ${KEY}`]) {
      expect(() => checkBuildEnv('production', { VITE_MOD_SIGNING_PUBLIC: v }), v).toThrow(/64 lower-case hex/);
    }
  });

  it('passes a production build with the key, and any other mode without it', () => {
    expect(() => checkBuildEnv('production', { VITE_MOD_SIGNING_PUBLIC: KEY })).not.toThrow();
    expect(() => checkBuildEnv('development', {})).not.toThrow();
    expect(() => checkBuildEnv('test', {})).not.toThrow();
  });
});

describe('vite.config.ts', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.VITE_MOD_SIGNING_PUBLIC;
    delete process.env.VITE_MOD_SIGNING_PUBLIC;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.VITE_MOD_SIGNING_PUBLIC;
    else process.env.VITE_MOD_SIGNING_PUBLIC = saved;
  });

  it('runs the check: `vite build` (mode production) throws without the key and builds with it from the environment', () => {
    expect(() => configFor('production')).toThrow(/VITE_MOD_SIGNING_PUBLIC must be set/);
    process.env.VITE_MOD_SIGNING_PUBLIC = KEY;
    expect(configFor('production').build).toMatchObject({ outDir: 'dist', sourcemap: false, assetsInlineLimit: 0 });
  });

  it('leaves the dev server alone', () => {
    expect(configFor('development').server).toMatchObject({ port: 5174 });
  });
});
