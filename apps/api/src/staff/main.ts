import type { FastifyInstance } from 'fastify';
import { LISTEN_OPTIONS, type Deps } from '../app.js';
import { LOOPBACK_HOSTS } from '../static/serve.js';
import { NO_MODERATION, socketModerationClient } from '../disputes/moderationClient.js';
import type { EventBus } from '../events/bus.js';
import { buildStaffApi, type ModerationClient } from './app.js';
import { ensureSetupCode, setupCodeLine } from './ownerSetup.js';
import type { TradePublisher } from '../trades/store.js';
import { startHoursSweeper } from './sweeper.js';
import { runFeeSweep } from './feeSweep.js';
import { PAYROLL_PASS_MS, runPayrollPayouts } from './payrollSend.js';
import { startEarnings, type EarningsWatch } from './earnings.js';

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
  // Plain http only on this machine (RV5 m3), the loopback hosts the web CSP allows in clear text
  // (static/serve.ts), and with no opt-out: the `__Host-` staff cookie needs Secure, and a staff
  // origin served over http anywhere else would invite renaming the cookie to make it work.
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.origin !== origin || !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) {
    throw new Error('config: X2F_STAFF_ORIGIN is malformed (an exact https origin such as https://staff.example.org; http only for 127.0.0.1, [::1] or localhost)');
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

/**
 * Plan 4 Task 11: the moderation process's internal API, from `MOD_INTERNAL_SOCKET` (an absolute
 * Unix socket path) and `MOD_INTERNAL_SECRET` (base64 of 32 bytes). Both unset: no moderation
 * process, and every chat or proof read answers `moderation-unavailable`. One without the other,
 * or a malformed value, refuses to start; errors name the variable, never its value.
 */
export function moderationFromEnv(env: Record<string, string | undefined>, clock: () => Date): ModerationClient {
  const socketPath = env.MOD_INTERNAL_SOCKET ?? '';
  const secret = env.MOD_INTERNAL_SECRET ?? '';
  if (socketPath === '' && secret === '') return NO_MODERATION;
  if (socketPath === '' || !socketPath.startsWith('/')) throw new Error('config: MOD_INTERNAL_SOCKET is malformed (an absolute Unix socket path)');
  const bytes = new Uint8Array(Buffer.from(secret, 'base64'));
  if (bytes.length !== 32) throw new Error('config: MOD_INTERNAL_SECRET is malformed (base64 of 32 bytes)');
  return socketModerationClient({ socketPath, secret: bytes, clock });
}

export interface StartOptions {
  /** Plan 4 Task 11: the moderation process's internal API (`moderationFromEnv`); omitted, none. */
  moderation?: ModerationClient;
  /** Plan 4 Task 11: the trader API's event bus, for moderator-joined, proof-requested and chat. */
  traderEvents?: Pick<EventBus, 'publish' | 'closeAccount'>;
  /** Hold model v3: the trader app's trade publisher, so a staff hold end's resumed trades reach the live views. */
  tradePublish?: TradePublisher;
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
  // Plan 4 Task 9: the owner's earnings, read from the fee wallet (view-only) and the payroll wallet
  // every 10 minutes. A failed read is logged by wallet name only (never the error: it may come
  // from the wallet library).
  let log: FastifyInstance['log'] | null = null;
  const earnings: EarningsWatch | null = deps.earnings ?? (deps.feeWalletView || deps.payrollWallet?.incoming
    ? startEarnings({
        fee: deps.feeWalletView ?? null,
        payroll: deps.payrollWallet?.incoming ? { incoming: () => deps.payrollWallet!.incoming!() } : null,
        clock: deps.clock,
        onError: (wallet) => log?.warn({ wallet }, 'earnings: wallet read failed'),
      })
    : null);
  const app = await buildStaffApi(
    {
      ...deps,
      ...(earnings ? { earnings } : {}),
      staffOrigin: s.origin,
      ...(s.rpId ? { staffRpId: s.rpId } : {}),
      ...(s.webRoot ? { staffWebRoot: s.webRoot } : {}),
      moderation: o.moderation ?? NO_MODERATION,
      ...(o.traderEvents ? { traderEvents: o.traderEvents } : {}),
      ...(o.tradePublish ? { tradePublish: o.tradePublish } : {}),
    },
    o.logStream ? { logStream: o.logStream } : {},
  );
  log = app.log;
  if (code !== null) (o.stderr ?? ((line: string) => void process.stderr.write(line)))(setupCodeLine(code));
  const sweeper = startHoursSweeper({ db: deps.db, clock: deps.clock, events: app.events }, (err) => app.log.error({ err }, 'staff hours sweep failed'));
  // Owner 26 Nov: with a payroll wallet, every minute: the payouts waiting to be sent, then the sweep of
  // anything over the owner's cap to the fee wallet.
  const payroll = deps.payrollWallet ? startPayrollPasses(deps, app) : null;
  await app.listen({ ...LISTEN_OPTIONS, host: s.host, port: s.port });
  return {
    app,
    async close() {
      await payroll?.stop();
      if (deps.earnings === undefined) await earnings?.stop();
      await sweeper.stop();
      await app.close();
    },
  };
}

/**
 * Owner 26 Nov 2026: the payroll wallet's pass every PAYROLL_PASS_MS: first the clock-out payouts
 * waiting to be sent (`runPayrollPayouts`), then the sweep of the excess over the owner's cap to the
 * fee wallet (`runFeeSweep`), one after the other so they never spend the same coins at once. A
 * failing pass is logged and the next one runs as usual.
 */
export function startPayrollPasses(deps: Deps, app: FastifyInstance, everyMs = PAYROLL_PASS_MS): { stop(): Promise<void> } {
  const wallet = deps.payrollWallet!;
  let running: Promise<void> | null = null;
  const pass = async (): Promise<void> => {
    try {
      await runPayrollPayouts({ db: deps.db, clock: deps.clock, wallet, push: app.push });
    } catch (err) {
      app.log.error({ err }, 'payroll payouts failed');
    }
    try {
      await runFeeSweep({ db: deps.db, clock: deps.clock, wallet, feeWallet: deps.config.feeWallet ?? null, push: app.push });
    } catch (err) {
      app.log.error({ err }, 'payroll sweep failed');
    }
  };
  const timer = setInterval(() => {
    if (running === null) running = pass().finally(() => (running = null));
  }, everyMs);
  timer.unref();
  return {
    async stop() {
      clearInterval(timer);
      await running;
    },
  };
}
