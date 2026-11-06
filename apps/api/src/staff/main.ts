import type { FastifyInstance } from 'fastify';
import { LISTEN_OPTIONS, type Deps } from '../app.js';
import { buildStaffApi, type ModerationClient } from './app.js';
import { ensureSetupCode, setupCodeLine } from './ownerSetup.js';
import { startHoursSweeper } from './sweeper.js';

/** The staff listener's settings; `null` when `X2F_STAFF_ORIGIN` is unset (no staff app on this host). */
export interface StaffListen {
  origin: string;
  rpId?: string;
  host: string;
  port: number;
  /** `X2F_STAFF_WEB_ROOT`: the built staff app to serve on the staff origin (Task 16); unset, the API alone. */
  webRoot?: string;
}

export function staffListenFromEnv(env: Record<string, string | undefined>): StaffListen | null {
  const origin = env.X2F_STAFF_ORIGIN;
  if (origin === undefined || origin === '') return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error('config: X2F_STAFF_ORIGIN is malformed (an exact origin such as https://staff.example.org)');
  }
  if (url.origin !== origin || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    throw new Error('config: X2F_STAFF_ORIGIN is malformed (an exact origin such as https://staff.example.org)');
  }
  const raw = env.X2F_STAFF_PORT || '8082';
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('config: X2F_STAFF_PORT is malformed (1-65535)');
  const rpId = env.X2F_STAFF_RP_ID;
  if (rpId !== undefined && rpId !== '' && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(rpId)) {
    throw new Error('config: X2F_STAFF_RP_ID is malformed (a lower-case host name)');
  }
  const webRoot = env.X2F_STAFF_WEB_ROOT;
  return { origin, ...(rpId ? { rpId } : {}), ...(webRoot ? { webRoot } : {}), host: env.X2F_STAFF_HOST || '127.0.0.1', port };
}

/** Until Plan 4 Task 11 builds the moderation client, nothing on the staff API calls it. */
const NO_MODERATION: ModerationClient = { name: 'moderation' };

export interface StartOptions {
  /** Where the setup code line goes: stderr (default). Never the structured logger. */
  stderr?: (line: string) => void;
  /** The structured logger's destination (tests). */
  logStream?: { write(line: string): void };
}

/**
 * Builds the staff API, starts the login-hours sweeper and listens on `X2F_STAFF_PORT` (default
 * 8082, bound to `X2F_STAFF_HOST`, default 127.0.0.1). Called by `main.ts`; `close()` stops both.
 * While no owner has finished setup (Plan 4 Task 6), it writes exactly one line to stderr with the
 * owner setup code, the only place the code is ever shown: the structured logger never sees it.
 */
export async function startStaffApi(deps: Deps, s: StaffListen, o: StartOptions = {}): Promise<{ app: FastifyInstance; close(): Promise<void> }> {
  const code = await ensureSetupCode(deps);
  const app = await buildStaffApi(
    { ...deps, staffOrigin: s.origin, ...(s.rpId ? { staffRpId: s.rpId } : {}), ...(s.webRoot ? { staffWebRoot: s.webRoot } : {}), moderation: NO_MODERATION },
    o.logStream ? { logStream: o.logStream } : {},
  );
  if (code !== null) (o.stderr ?? ((line: string) => void process.stderr.write(line)))(setupCodeLine(code));
  const sweeper = startHoursSweeper({ db: deps.db, clock: deps.clock, events: app.events }, (err) => app.log.error({ err }, 'staff hours sweep failed'));
  await app.listen({ ...LISTEN_OPTIONS, host: s.host, port: s.port });
  return {
    app,
    async close() {
      await sweeper.stop();
      await app.close();
    },
  };
}
