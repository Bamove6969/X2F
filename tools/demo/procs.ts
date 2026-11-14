/** DEMO ONLY: starting, recording and stopping the demo's background processes. */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO_DIR, LOG_DIR, PG_CONTAINER, PIDS_FILE, ROOT } from './config.js';

export type Pids = Record<string, number>;

export function readPids(): Pids {
  if (!existsSync(PIDS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(PIDS_FILE, 'utf8')) as Pids;
  } catch {
    return {};
  }
}

function writePids(p: Pids): void {
  mkdirSync(DEMO_DIR, { recursive: true });
  writeFileSync(PIDS_FILE, JSON.stringify(p, null, 2));
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Starts `cmd args` detached (it outlives `npm run demo`), logging to .demo/logs/<name>.log. */
export function startDetached(name: string, cmd: string, args: string[], env: Record<string, string>): number {
  mkdirSync(LOG_DIR, { recursive: true });
  const log = openSync(join(LOG_DIR, `${name}.log`), 'a');
  const child = spawn(cmd, args, {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', log, log],
    // A clean environment: PATH and HOME only, plus what the process needs.
    // NODE_EXTRA_CA_CERTS passes through so the API's price fetches work behind a TLS-inspecting proxy.
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...(process.env.NODE_EXTRA_CA_CERTS ? { NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS } : {}), ...env },
  });
  child.unref();
  if (child.pid === undefined) throw new Error(`could not start ${name}`);
  writePids({ ...readPids(), [name]: child.pid });
  return child.pid;
}

/** A TypeScript entry point run with tsx, detached. */
export function startTs(name: string, file: string, env: Record<string, string>): number {
  return startDetached(name, process.execPath, ['--import', 'tsx', file], env);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Stops every recorded process (its whole group), then the Postgres container. */
export async function stopAll(log: (s: string) => void = console.log): Promise<void> {
  const pids = readPids();
  // Reverse start order: the gateway and the demo moderator first, the chain last.
  for (const [name, pid] of Object.entries(pids).reverse()) {
    if (!alive(pid)) continue;
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
    for (let i = 0; i < 50 && alive(pid); i++) await sleep(200);
    if (alive(pid)) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // gone
      }
    }
    log(`stopped ${name}`);
  }
  rmSync(PIDS_FILE, { force: true });
  try {
    execFileSync('docker', ['rm', '-f', PG_CONTAINER], { stdio: 'ignore' });
    log('removed the Postgres container');
  } catch {
    // not running
  }
}

/** Stops the recorded process `name` (its whole group) and starts `file` under that name again. */
export async function restartTs(name: string, file: string, env: Record<string, string>): Promise<number> {
  const pid = readPids()[name];
  if (pid !== undefined && alive(pid)) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
    for (let i = 0; i < 50 && alive(pid); i++) await sleep(200);
    if (alive(pid)) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // gone
      }
    }
  }
  return startTs(name, file, env);
}
