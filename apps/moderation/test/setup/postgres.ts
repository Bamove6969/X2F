// vitest globalSetup: one throwaway PostgreSQL in Docker per test run (same image as the API's
// harness), with a migrated moderation template database that each test file copies, and an
// unprivileged `x2f_api` login role standing in for the API's database role (it gets NO grant).
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { migrateModeration } from '../../src/keystore.js';

declare module 'vitest' {
  export interface ProvidedContext {
    modPgUrl: string;
    apiRolePassword: string;
  }
}

const POSTGRES_IMAGE =
  'postgres:17.11-alpine3.24@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
export const MOD_TEMPLATE_DB = 'x2f_moderation_template';
const LABEL = 'x2f-moderation-test';

const run = promisify(execFile);
const docker = async (...args: string[]): Promise<string> => (await run('docker', args, { timeout: 300_000 })).stdout.trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function stopLeftovers(): Promise<void> {
  const lines = (await docker('ps', '--filter', `label=${LABEL}`, '--format', `{{.ID}} {{.Label "${LABEL}"}}`)).split('\n').filter(Boolean);
  for (const line of lines) {
    const [cid, owner] = line.split(' ');
    if (!cid || !owner || !/^[1-9]\d{0,9}$/.test(owner)) continue;
    const pid = Number(owner);
    if (pid === process.pid || alive(pid)) continue;
    await docker('stop', '-t', '1', cid).catch(() => undefined);
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  try {
    await docker('info', '--format', '{{.ServerVersion}}');
  } catch {
    throw new Error('moderation tests need Docker (see docs/dev-setup.md)');
  }
  await stopLeftovers();
  const password = randomBytes(18).toString('hex');
  const id = await docker(
    'run', '-d', '--rm', '--label', `${LABEL}=${process.pid}`, '--tmpfs', '/var/lib/postgresql/data',
    '-e', `POSTGRES_PASSWORD=${password}`, '-p', '127.0.0.1::5432', POSTGRES_IMAGE,
  );
  const stop = async () => {
    await docker('stop', '-t', '2', id).catch(() => undefined);
  };
  try {
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) {
      ready = await docker('exec', id, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres').then(() => true, () => false);
      if (!ready) await sleep(500);
    }
    if (!ready) throw new Error('postgres container did not become ready');
    const mapped = (await docker('port', id, '5432/tcp')).split('\n')[0] ?? '';
    const port = mapped.slice(mapped.lastIndexOf(':') + 1);
    const url = `postgres://postgres:${password}@127.0.0.1:${port}`;

    const apiRolePassword = randomBytes(18).toString('hex');
    const admin = new pg.Client({ connectionString: `${url}/postgres` });
    await admin.connect();
    await admin.query(`create database ${MOD_TEMPLATE_DB}`);
    // The API's database role: may log in, owns nothing, is granted nothing on the moderation tables.
    await admin.query(`create role x2f_api login nosuperuser nocreatedb nocreaterole noinherit password '${apiRolePassword}'`);
    await admin.end();
    const tpl = new pg.Pool({ connectionString: `${url}/${MOD_TEMPLATE_DB}`, max: 1 });
    try {
      await migrateModeration(tpl);
    } finally {
      await tpl.end();
    }
    project.provide('modPgUrl', url);
    project.provide('apiRolePassword', apiRolePassword);
  } catch (e) {
    await stop();
    throw e;
  }
  return stop;
}
