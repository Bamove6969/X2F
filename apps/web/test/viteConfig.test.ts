import type { ConfigEnv, UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import config, { FIXTURES_BUILD_MODE, FIXTURES_OUT_DIR, fixturesOn } from '../vite.config.js';

describe('fixturesOn', () => {
  it.each([
    ['serve', 'development', '1', true],
    ['serve', 'fixtures', '1', true],
    ['serve', 'production', '1', false],
    ['build', 'fixtures', '1', true],
    ['build', 'production', '1', false],
    ['build', 'staging', '1', false],
    ['build', 'development', '1', false],
    ['serve', 'development', undefined, false],
    ['serve', 'development', 'true', false],
    ['build', 'fixtures', undefined, false],
    ['build', 'fixtures', '0', false],
  ] as const)('command %s, mode %s, VITE_FIXTURES=%j → %s', (command, mode, flag, expected) => {
    expect(fixturesOn(command, mode, flag)).toBe(expected);
  });
});

describe('build output directory', () => {
  const resolve = (env: ConfigEnv): UserConfig => (config as (env: ConfigEnv) => UserConfig)(env);

  it('a fixtures-mode build writes to dist-fixtures, never the production dist', () => {
    expect(FIXTURES_OUT_DIR).toBe('dist-fixtures');
    expect(resolve({ command: 'build', mode: FIXTURES_BUILD_MODE }).build?.outDir).toBe('dist-fixtures');
  });

  it.each(['production', 'staging'])('a %s build writes to dist', (mode) => {
    expect(resolve({ command: 'build', mode }).build?.outDir).toBe('dist');
  });
});
