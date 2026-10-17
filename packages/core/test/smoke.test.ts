import { expect, test } from 'vitest';

test('@x2f/core loads', async () => {
  expect(await import('@x2f/core')).toBeDefined();
});
