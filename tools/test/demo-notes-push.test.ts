import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNotesPusher, pushEnabled, type PushConfig } from '../demo/notes-push.js';

const FILE = 'owner-demo-notes-2026-11-16.jsonl';
let dir: string;
let origin: string;
let his: string;
let work: string;
let env: NodeJS.ProcessEnv;
let logs: Record<string, unknown>[];
let stops: (() => void)[];

/** git with no global or system config: no identity, no credential helper, as on a bare machine. */
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
const as = ['-c', 'user.name=someone', '-c', 'user.email=someone@example.invalid'];
const commsFiles = (): string[] => git(origin, 'ls-tree', '--name-only', 'comms').trim().split('\n');
const commsFile = (): string => git(origin, 'show', `comms:${FILE}`);
const commsCount = (): number => Number(git(origin, 'rev-list', '--count', 'comms').trim());

function pusher(over: Partial<PushConfig> & { text?: () => string } = {}) {
  const p = createNotesPusher({
    repo: his,
    dir: join(dir, 'x2f-comms', '.comms-push'),
    fileName: FILE,
    render: async () => (over.text ?? (() => '{"id":"a","time":"t","text":"one"}\n'))(),
    env,
    debounceMs: 50,
    retryMs: 150,
    backoffMs: 10,
    log: (e) => logs.push(e),
    ...over,
  });
  stops.push(p.stop);
  return p;
}

async function until(check: () => boolean, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'x2f-push-'));
  env = { PATH: process.env.PATH ?? '', HOME: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(dir, 'no-gitconfig') };
  logs = [];
  stops = [];
  origin = join(dir, 'origin.git');
  execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', origin], { env });
  // main, and a comms branch with notes on it, as on GitHub.
  const seed = join(dir, 'seed');
  execFileSync('git', ['clone', '--quiet', origin, seed], { env, stdio: 'ignore' });
  writeFileSync(join(seed, 'README.md'), 'app\n');
  git(seed, 'add', '.');
  git(seed, ...as, 'commit', '--quiet', '-m', 'main');
  git(seed, 'push', '--quiet', 'origin', 'HEAD:main');
  git(seed, 'checkout', '--quiet', '--orphan', 'comms');
  git(seed, 'rm', '-r', '-q', '--cached', '.');
  rmSync(join(seed, 'README.md'));
  writeFileSync(join(seed, 'to-agy.log'), 'hello\n');
  git(seed, 'add', '.');
  git(seed, ...as, 'commit', '--quiet', '-m', 'comms');
  git(seed, 'push', '--quiet', 'origin', 'HEAD:comms');
  // The owner's checkout: on a branch of his own, with work in progress that must not be touched.
  his = join(dir, 'x2f');
  execFileSync('git', ['clone', '--quiet', origin, his], { env, stdio: 'ignore' });
  git(his, 'checkout', '--quiet', '-b', 'his-branch');
  writeFileSync(join(his, 'README.md'), 'app, edited\n');
  writeFileSync(join(his, 'scratch.txt'), 'not added\n');
  git(his, 'add', 'README.md');
  writeFileSync(join(his, 'README.md'), 'app, edited twice\n');
  work = join(dir, 'other');
  execFileSync('git', ['clone', '--quiet', '-b', 'comms', origin, work], { env, stdio: 'ignore' });
});

afterEach(() => {
  for (const s of stops) s();
  rmSync(dir, { recursive: true, force: true });
});

describe('publishing the demo notes to comms (notes-push.ts)', () => {
  it('pushes the notes file to comms, from its own worktree, as owner when he has no git name, changing only that file', async () => {
    const before = { status: git(his, 'status', '--porcelain=v2', '--branch'), head: git(his, 'rev-parse', 'HEAD'), readme: readFileSync(join(his, 'README.md'), 'utf8') };
    expect(await pusher().flush()).toBe('pushed');
    expect(commsFile()).toBe('{"id":"a","time":"t","text":"one"}\n');
    expect(commsFiles().sort()).toEqual([FILE, 'to-agy.log']);
    expect(git(origin, 'log', '-1', '--format=%s|%an <%ae>', 'comms').trim()).toBe('owner demo notes 2026-11-16 (auto)|owner <owner@localhost>');
    expect(git(origin, 'show', '--name-only', '--format=', 'comms').trim()).toBe(FILE);
    // His checkout: same branch, same HEAD, same staged and unstaged work, main untouched on origin.
    expect(git(his, 'status', '--porcelain=v2', '--branch')).toBe(before.status);
    expect(git(his, 'rev-parse', 'HEAD')).toBe(before.head);
    expect(readFileSync(join(his, 'README.md'), 'utf8')).toBe(before.readme);
    expect(existsSync(join(his, FILE))).toBe(false);
    expect(git(origin, 'log', '--format=%s', 'main').trim()).toBe('main');
    expect(existsSync(join(dir, 'x2f-comms', '.comms-push', FILE))).toBe(true);
  });

  it('uses his own git name when he has one, and makes no commit when nothing changed', async () => {
    git(his, 'config', 'user.name', 'Flem');
    git(his, 'config', 'user.email', 'flem@example.invalid');
    const p = pusher();
    await p.flush();
    expect(git(origin, 'log', '-1', '--format=%an <%ae>', 'comms').trim()).toBe('Flem <flem@example.invalid>');
    const n = commsCount();
    expect(await p.flush()).toBe('pushed');
    expect(commsCount()).toBe(n);
  });

  it('updates the same file through the day, and reuses its worktree on the next start', async () => {
    let text = '{"id":"a","time":"t","text":"one"}\n';
    await pusher({ text: () => text }).flush();
    text += '{"id":"b","time":"u","text":"two"}\n';
    expect(await pusher({ text: () => text }).flush()).toBe('pushed');
    expect(commsFile()).toBe(text);
    expect(commsCount()).toBe(3);
  });

  it('when comms moved under it: starts again on the new comms (a rebase), merges that copy, never force-pushes', async () => {
    let raced = false;
    const seen: (string | null)[] = [];
    const p = createNotesPusher({
      repo: his,
      dir: join(dir, 'x2f-comms', '.comms-push'),
      fileName: FILE,
      env,
      backoffMs: 10,
      log: (e) => logs.push(e),
      render: async (current) => {
        seen.push(current);
        if (!raced) {
          // Another computer pushes to comms between this round's fetch and its push.
          raced = true;
          writeFileSync(join(work, FILE), '{"id":"z","time":"s","text":"other computer"}\n');
          writeFileSync(join(work, 'to-lead.log'), 'line\n');
          git(work, 'add', '.');
          git(work, ...as, 'commit', '--quiet', '-m', 'other');
          git(work, 'push', '--quiet', 'origin', 'HEAD:comms');
        }
        return `${current ?? ''}{"id":"a","time":"t","text":"one"}\n`;
      },
    });
    stops.push(p.stop);
    const other = () => git(work, 'rev-parse', 'HEAD').trim();
    expect(await p.flush()).toBe('pushed');
    expect(logs.some((l) => l.reason === 'notes-push-rejected')).toBe(true);
    expect(seen).toEqual([null, '{"id":"z","time":"s","text":"other computer"}\n']);
    expect(commsFile()).toBe('{"id":"z","time":"s","text":"other computer"}\n{"id":"a","time":"t","text":"one"}\n');
    expect(commsFiles().sort()).toEqual([FILE, 'to-agy.log', 'to-lead.log']);
    // The other computer's commit is still there, under ours: history was added to, not rewritten.
    expect(git(origin, 'rev-parse', 'comms~1').trim()).toBe(other());
  });

  it('offline (or no credentials): keeps the notes pending, says so, and pushes once it can', async () => {
    renameSync(origin, `${origin}.away`);
    const p = pusher();
    expect(await p.flush()).toBe('pending');
    expect(p.state()).toBe('pending');
    expect(logs.some((l) => l.reason === 'notes-push-failed')).toBe(true);
    renameSync(`${origin}.away`, origin);
    await until(() => p.state() === 'pushed');
    expect(commsFile()).toContain('"one"');
  });

  it('pushes 30 s (here 50 ms) after the last of several changes, once', async () => {
    let text = 'x\n';
    const p = pusher({ text: () => text });
    await p.flush();
    const n = commsCount();
    for (const t of ['a\n', 'b\n', 'c\n']) {
      text = t;
      p.changed();
      expect(p.state()).toBe('pending');
    }
    await until(() => p.state() === 'pushed');
    expect(commsCount()).toBe(n + 1);
    expect(commsFile()).toBe('c\n');
  });

  it('at shutdown makes one last round straight away, with what is on disk', async () => {
    let text = 'x\n';
    const p = pusher({ text: () => text, debounceMs: 60_000 });
    await p.flush();
    text = 'last\n';
    p.changed();
    expect(await p.final()).toBe('pushed');
    expect(commsFile()).toBe('last\n');
  });

  it('leaves a folder that is not its worktree alone', async () => {
    mkdirSync(join(dir, 'x2f-comms', '.comms-push'), { recursive: true });
    writeFileSync(join(dir, 'x2f-comms', '.comms-push', 'mine.txt'), 'keep\n');
    const p = pusher();
    expect(await p.flush()).toBe('pending');
    expect(String(logs.find((l) => l.reason === 'notes-push-failed')?.error)).toMatch(/is not the notes worktree/);
    expect(readFileSync(join(dir, 'x2f-comms', '.comms-push', 'mine.txt'), 'utf8')).toBe('keep\n');
    p.stop();
  });

  it('is on unless DEMO_NOTES_PUSH=0', () => {
    expect(pushEnabled({})).toBe(true);
    expect(pushEnabled({ DEMO_NOTES_PUSH: '1' })).toBe(true);
    expect(pushEnabled({ DEMO_NOTES_PUSH: '0' })).toBe(false);
  });
});
