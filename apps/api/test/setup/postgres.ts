// vitest globalSetup: one throwaway PostgreSQL in Docker per test run, with a migrated
// `x2f_template` database that each test file copies (see ../helpers/db.ts).
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { migrate } from '../../src/db/migrate.js';

declare module 'vitest' {
  export interface ProvidedContext {
    pgUrl: string;
  }
}

export const POSTGRES_IMAGE =
  'postgres:17.11-alpine3.24@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
export const TEMPLATE_DB = 'x2f_template';
/** Every harness container carries this label, valued with the PID of the test run that started it. */
export const LABEL = 'x2f-api-test';

const run = promisify(execFile);
const NO_DOCKER = 'api tests need Docker (see docs/dev-setup.md)';

async function docker(...args: string[]): Promise<string> {
  const { stdout } = await run('docker', args, { timeout: 300_000 });
  return stdout.trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Stops containers left by earlier runs that died before teardown (e.g. a killed vitest). A run
 * still alive keeps its container, so two test runs on one machine do not stop each other's.
 */
async function stopLeftovers(): Promise<void> {
  // No -q: with it Docker ignores --format and prints bare IDs.
  const lines = (await docker('ps', '--filter', `label=${LABEL}`, '--format', `{{.ID}} {{.Label "${LABEL}"}}`))
    .split('\n')
    .filter(Boolean);
  for (const line of lines) {
    const [cid, owner] = line.split(' ');
    // Only a well-formed PID label whose process is gone marks a leftover; anything else is left alone.
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
    throw new Error(NO_DOCKER);
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
    // TCP only: the image's init-time server listens on the socket alone, so this waits for the real one.
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) {
      ready = await docker('exec', id, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres').then(() => true, () => false);
      if (!ready) await sleep(500);
    }
    if (!ready) throw new Error('postgres container did not become ready');
    const mapped = (await docker('port', id, '5432/tcp')).split('\n')[0] ?? '';
    const port = mapped.slice(mapped.lastIndexOf(':') + 1);
    const url = `postgres://postgres:${password}@127.0.0.1:${port}`;

    const admin = new pg.Client({ connectionString: `${url}/postgres` });
    await admin.connect();
    await admin.query(`create database ${TEMPLATE_DB}`);
    await admin.end();
    const tpl = new pg.Pool({ connectionString: `${url}/${TEMPLATE_DB}`, max: 1 });
    try {
      await migrate(tpl);
    } finally {
      await tpl.end();
    }
    project.provide('pgUrl', url);
  } catch (e) {
    await stop();
    throw e;
  }
  return stop;
}
