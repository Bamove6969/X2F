import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import type { BuildOptions, Deps } from '../../src/app.js';
import { seedAccount } from './accounts.js';
import { testApp } from './app.js';
import { Browser, addTestLogin } from './totp.js';

/** A trade-route test app with a direct test login, and helpers for traders. */
export async function tradeApp(options: Omit<BuildOptions, 'logStream'> = {}, overrides: Partial<Deps> = {}): Promise<{
  app: FastifyInstance;
  deps: Deps;
  setNow(d: Date): void;
  logs: string[];
  trader(kind?: 'trader' | 'staff'): Promise<{ id: string; displayName: string; browser: Browser }>;
}> {
  const t = await testApp(overrides, options);
  addTestLogin(t.app, t.deps);
  let n = 0;
  const trader = async (kind: 'trader' | 'staff' = 'trader') => {
    const loginName = `trader${String(++n).padStart(4, '0')}x`;
    const displayName = `D${loginName}`;
    const id = await seedAccount(t.deps, { loginName, displayName, kind });
    const browser = new Browser(t.app);
    const res = await browser.post('/t/login', { accountId: id });
    expect(res.statusCode).toBe(200);
    return { id, displayName, browser };
  };
  return { ...t, trader };
}
