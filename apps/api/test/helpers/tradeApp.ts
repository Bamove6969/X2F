import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import type { BuildOptions, Deps } from '../../src/app.js';
import { seedAccount } from './accounts.js';
import { testApp } from './app.js';
import { Browser, addTestLogin } from './totp.js';

/** A trade-route test app with a direct test login, and helpers for traders. */
export async function tradeApp(options: Omit<BuildOptions, 'logStream'> = {}): Promise<{
  app: FastifyInstance;
  deps: Deps;
  setNow(d: Date): void;
  logs: string[];
  trader(kind?: 'trader' | 'staff'): Promise<{ id: string; username: string; browser: Browser }>;
}> {
  const t = await testApp({}, options);
  addTestLogin(t.app, t.deps);
  let n = 0;
  const trader = async (kind: 'trader' | 'staff' = 'trader') => {
    const username = `trader${String(++n).padStart(4, '0')}x`;
    const id = await seedAccount(t.deps, { username, kind });
    const browser = new Browser(t.app);
    const res = await browser.post('/t/login', { accountId: id });
    expect(res.statusCode).toBe(200);
    return { id, username, browser };
  };
  return { ...t, trader };
}
