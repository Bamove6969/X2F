/**
 * DEMO ONLY: publishes the owner's demo notes to the `comms` branch on GitHub (owner, 16 Nov: "Make
 * it so it dumps it to GitHub"), so he never has to use git for them himself.
 *
 * It works in its own git worktree of origin/comms (by default ~/x2f-comms/.comms-push), never in
 * his checkout: his working tree, index and current branch are not touched. Each round: fetch
 * origin comms, check out origin/comms detached, write the whole record into
 * owner-demo-notes-<date>.jsonl (merged with comms' copy of that file, so another computer's lines
 * are kept), add that one file, commit, `git push origin HEAD:comms`. A rejected push (comms moved)
 * starts the round again on the new origin/comms, which is a rebase of that one commit; never a
 * force-push. Rounds run 30 s after the last change, once at start and once at shutdown. When a
 * push cannot be made (offline, no credentials), the notes stay safe in the local files and it
 * tries again later. git never asks for anything (GIT_TERMINAL_PROMPT=0): it uses the credentials
 * he already has.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type PushState = 'off' | 'pending' | 'pushed';

export interface PushConfig {
  /** The owner's checkout (its .git holds the worktree's records; its files are never touched). */
  repo: string;
  /** The worktree for publishing. */
  dir: string;
  /** owner-demo-notes-<date>.jsonl: the demo session's date. */
  fileName: string;
  /** The file's content, given comms' current copy of it (or null). */
  render: (current: string | null) => Promise<string>;
  /** The environment git runs with (default process.env). */
  env?: NodeJS.ProcessEnv;
  debounceMs?: number;
  /** After a round that could not push, the next try (default 2 minutes). */
  retryMs?: number;
  /** Pushes tried per round, waiting backoffMs, 2x, 4x... between rejected ones. */
  attempts?: number;
  backoffMs?: number;
  log?: (event: Record<string, unknown>) => void;
}

interface Run {
  code: number;
  out: string;
  err: string;
}

/** DEMO_NOTES_PUSH=0 turns publishing off. */
export function pushEnabled(env: Record<string, string | undefined>): boolean {
  return env.DEMO_NOTES_PUSH !== '0';
}

export function createNotesPusher(cfg: PushConfig): {
  changed: () => void;
  flush: () => Promise<PushState>;
  state: () => PushState;
  stop: () => void;
  final: () => Promise<PushState>;
} {
  const debounceMs = cfg.debounceMs ?? 30_000;
  const retryMs = cfg.retryMs ?? 120_000;
  const attempts = cfg.attempts ?? 4;
  const backoffMs = cfg.backoffMs ?? 2_000;
  const log = cfg.log ?? ((e) => console.log(JSON.stringify(e)));
  const dir = resolve(cfg.dir);
  const env: NodeJS.ProcessEnv = { ...(cfg.env ?? process.env), GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  let state: PushState = 'pending';
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<PushState> | null = null;
  let again = false;
  let stopped = false;

  /** git in its own process group, so the demo's stop (SIGTERM to the gateway's group) does not cut a push short. */
  const git = (cwd: string, args: string[], timeoutMs = 60_000): Promise<Run> =>
    new Promise((done) => {
      const child = spawn('git', ['-C', cwd, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      let out = '';
      let err = '';
      child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
      child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
      const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      child.on('error', (e) => {
        clearTimeout(t);
        done({ code: -1, out, err: e.message });
      });
      child.on('close', (code) => {
        clearTimeout(t);
        done({ code: code ?? -1, out, err });
      });
    });
  const ok = async (cwd: string, args: string[]): Promise<string> => {
    const r = await git(cwd, args);
    if (r.code !== 0) throw new Error(`git ${args[0]}: ${r.err.trim().split('\n').at(-1) ?? r.code}`);
    return r.out;
  };

  /** The worktree, made once from the owner's checkout (reused after); a folder that is anything else is left alone. */
  async function worktree(): Promise<void> {
    if (existsSync(join(dir, '.git'))) {
      const top = (await git(dir, ['rev-parse', '--show-toplevel'])).out.trim();
      if (top !== '' && resolve(top) === dir) return;
    }
    if (existsSync(dir)) throw new Error(`${dir} exists and is not the notes worktree; move it away`);
    await ok(cfg.repo, ['fetch', '--quiet', 'origin', 'comms']);
    await git(cfg.repo, ['worktree', 'prune']);
    mkdirSync(dirname(dir), { recursive: true });
    await ok(cfg.repo, ['worktree', 'add', '--detach', '--quiet', dir, 'origin/comms']);
  }

  /** The owner's own git name if he has one, else owner <owner@localhost>. */
  async function identity(): Promise<string[]> {
    const name = (await git(dir, ['config', 'user.name'])).out.trim();
    const email = (await git(dir, ['config', 'user.email'])).out.trim();
    return name !== '' && email !== '' ? [] : ['-c', 'user.name=owner', '-c', 'user.email=owner@localhost'];
  }

  async function round(): Promise<PushState> {
    await worktree();
    const date = cfg.fileName.replace(/^owner-demo-notes-|\.jsonl$/g, '');
    for (let i = 0; i < attempts; i++) {
      await ok(dir, ['fetch', '--quiet', 'origin', 'comms']);
      await ok(dir, ['checkout', '--quiet', '--force', '--detach', 'origin/comms']);
      const file = join(dir, cfg.fileName);
      const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
      const text = await cfg.render(current);
      if (text !== current) {
        writeFileSync(`${file}.tmp`, text, { mode: 0o600 });
        renameSync(`${file}.tmp`, file);
      }
      await ok(dir, ['add', '--', cfg.fileName]);
      const staged = await git(dir, ['diff', '--cached', '--quiet']);
      if (staged.code === 0) return 'pushed'; // comms already holds every note
      await ok(dir, [...(await identity()), 'commit', '--quiet', '-m', `owner demo notes ${date} (auto)`, '--', cfg.fileName]);
      const push = await git(dir, ['push', '--quiet', 'origin', 'HEAD:comms']);
      if (push.code === 0) return 'pushed';
      if (!/rejected|non-fast-forward|fetch first|stale info/i.test(push.err)) throw new Error(`git push: ${push.err.trim().split('\n').at(-1) ?? push.code}`);
      log({ reason: 'notes-push-rejected', attempt: i + 1 });
      await new Promise((r) => setTimeout(r, backoffMs * 2 ** i));
    }
    throw new Error('comms kept moving; trying again later');
  }

  function flush(): Promise<PushState> {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (running !== null) {
      again = true;
      return running;
    }
    running = round()
      .then(
        (s) => {
          // A change that came in during this round is not in it yet.
          state = again ? 'pending' : s;
          log({ reason: 'notes-pushed', file: cfg.fileName });
          return s;
        },
        (e: unknown) => {
          state = 'pending';
          log({ reason: 'notes-push-failed', error: (e as Error).message, retryInMs: retryMs });
          if (!stopped) schedule(retryMs);
          return state;
        },
      )
      .finally(() => {
        running = null;
        if (again && !stopped) {
          again = false;
          schedule(0);
        }
      });
    return running;
  }

  function schedule(ms: number): void {
    if (stopped) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, ms);
    timer.unref?.();
  }

  return {
    changed: () => {
      state = 'pending';
      if (running !== null) again = true;
      schedule(debounceMs);
    },
    flush,
    state: () => state,
    stop: () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
    /** At shutdown: waits for a round under way, then makes one more with everything on disk. */
    final: async () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (running !== null) await running;
      again = false;
      return flush();
    },
  };
}
