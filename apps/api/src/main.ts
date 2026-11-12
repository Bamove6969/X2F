import { assertLoginNamesTagged } from './accounts.js';
import { LISTEN_OPTIONS, buildApi, type Deps } from './app.js';
import { buildInternalListener } from './internal/routes.js';
import { tradeEventPublisher } from './events/tradePublisher.js';
import { siteMaintenanceSince, startTimers } from './trades/timers.js';
import { addOwnerAlert } from './alerts.js';
import { fileAttestationPolicy } from './auth/attestation.js';
import { openLeakedList } from './auth/leaked.js';
import { loadPgpSigner } from './auth/pgp.js';
import { assertSigningKeyFile, loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { PRICE_FEED_DEFAULTS, createPriceFeed } from './price/feed.js';
import { createFxRates, fxSources } from './price/fx.js';
import type { PriceAlert } from './price/health.js';
import { createMarketPrices } from './price/market.js';
import { loadFxSettings } from './price/settings.js';
import { priceSources } from './price/sources.js';
import { startRetention } from './retention.js';
import { settleDueHolds } from './auth/hold.js';
import { settleDueChanges } from './auth/holdChanges.js';
import { syncHeldTradesJob } from './trades/held.js';
import { startDisputeTimers } from './disputes/timers.js';
import { RETENTION_JOBS } from './retentionJobs.js';
import { serveWeb, webOptionsFromEnv } from './static/serve.js';
import { moneroAddressValidator } from './wallets/address.js';
import { productionNudgeWiring } from './nudge/wiring.js';
import { daemonConfirmations, monerodUrlFromEnv } from './trades/chain.js';
import { ownerAlertSink } from './push/ownerAlert.js';
import { moderationFromEnv, staffListenFromEnv, startStaffApi } from './staff/main.js';
import { assertOneSiteFlagsRow } from './site/flags.js';
import { endMemberSessionsOutsideHours } from './team/limits.js';
import { startOutbox } from './jabber/outbox.js';
import { omemoEncryptor } from './jabber/omemo.js';
import { xmppSender } from './jabber/xmpp.js';

function port(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 8080;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65_535) throw new Error('config: X2F_PORT is malformed (1-65535)');
  return n;
}

const config = loadConfig(process.env);
// Serves apps/web/dist on this origin when X2F_WEB_ROOT is set (with X2F_RELAY_ORIGIN and X2F_NODE_PROXY_ORIGIN for the CSP;
// http/ws origins only on loopback unless X2F_ALLOW_INSECURE_ORIGINS=1).
const web = webOptionsFromEnv(process.env);
await assertSigningKeyFile(config.pgpSigningKeyPath);
// R7: refuses a public-only or passphrase-protected key and a fingerprint other than
// X2F_PGP_SIGNING_FINGERPRINT; the process exits before listening.
const pgpSigner = await loadPgpSigner(config.pgpSigningKeyPath, config.pgpSigningFingerprint);

// Task 8: the FIDO metadata snapshot, loaded before listening (no network fetch).
const attestation = fileAttestationPolicy(config.attestationDir);
await attestation.init();

const db = createPool(config.databaseUrl);
// FU-D: no start while a login name is still stored in plaintext (migration 012 without its tool).
await assertLoginNamesTagged(db);
// Review M1: exactly one site_flags row, so a missing row never means maintenance to one reader and none to another.
await assertOneSiteFlagsRow(db);
// Plan 3 Task 3 (spec 11.6): XMR/USD = median of the PRICE_SOURCES, polled every minute; USD→X
// from the FX_SOURCES in trust order, polled every 5 minutes, with the owner's settings read from
// owner_settings before each poll. Price health alerts go to the owner's in-app alerts and, for
// the urgent and source-failing kinds, to the owner's phone as the generic push (Task 19,
// push/ownerAlert.ts; the sink needs `app.push`, so it is set once the app is built, before
// polling starts). Every source fetches through the global fetch (no proxy wired; routing them
// over Tor is a Plan 6 follow-up, see docs/coordination.md).
const clock = () => new Date();
let onAlert: (a: PriceAlert) => Promise<void> = (a) => addOwnerAlert(db, a.kind, a.detail, clock());
// A lost alert is logged once the app's logger exists (the sink only runs after prices.start()).
let alertLog: { error(obj: { error: string }, msg: string): void; info(obj: object, msg: string): void } | null = null;
const prices = createMarketPrices({
  xmr: createPriceFeed(priceSources(config.priceSources), { ...PRICE_FEED_DEFAULTS, clock }),
  fx: createFxRates(fxSources(config.fxSources), { clock, settings: () => loadFxSettings(db) }),
  clock,
  onAlert: (a) => onAlert(a),
  log: { error: (obj, msg) => alertLog?.error(obj, msg) },
});
const deps: Deps = {
  config,
  db,
  clock,
  leaked: await openLeakedList(config.leakedListPath),
  // Task 12: loads monero-ts's WebAssembly keys module before listening.
  addresses: await moneroAddressValidator(config.moneroNetwork),
  attestation,
  pgpSigner,
  prices,
  // Task 26: shared context from real trades (Task 6), open chats (Task 20), delivery over Task 19's SSE and Web Push (nudge/wiring.ts).
  nudges: productionNudgeWiring(db),
  // Owner rule p5-7: Jabber account-change notices, only when X2F_XMPP_* name X2F's sending account
  // (GAP: the production account and server are not set up; unset, the set-up answers jabber-unavailable).
  // Owner ruling p11-31: only through Tor (config.xmpp.socks) and only OMEMO-encrypted (jabber/omemo.ts,
  // @x2f/omemo; docs/jabber/omemo-plan.md): X2F's identity and bundle live sealed in jabber_omemo_identity.
  ...(config.xmpp && config.jabberKeys
    ? { jabberSender: xmppSender(config.xmpp, omemoEncryptor(db, config.jabberKeys, clock, (e) => alertLog?.info(e, 'jabber omemo'))) }
    : {}),
};

// One scheduler for every purge job (X-12); the list is in retentionJobs.ts.
const stopRetention = startRetention(deps, [...RETENTION_JOBS]);

// Task 24: X2F's own node for the released screen's confirmations (X2F_MONEROD_URL; unset: not shown).
const monerod = monerodUrlFromEnv(process.env);
const app = await buildApi(deps, monerod ? { txConfirmations: daemonConfirmations({ url: monerod }) } : {});
onAlert = ownerAlertSink({ db, clock, push: app.push });
// Plan 2 Task 17, hold model v3: every minute, holds whose 24 hours are up end, changes whose 24
// hours are up apply, and held trades are paused or resumed as their holds say.
const stopHolds = startRetention(
  deps,
  [
    settleDueHolds(config, app.events, app.log), settleDueChanges(config, app.events, app.log, app.push), syncHeldTradesJob(app.tradePublish),
    // J-20 (owner p7-11): members' sessions end when their working hours do.
    endMemberSessionsOutsideHours(app.events),
  ],
  60_000,
);
// Plan 4 Task 10: every 30 s, appeal windows close and maintenance shifts dispute deadlines (A7).
const stopDisputeTimers = startDisputeTimers(deps, app.events);
// Owner rule p5-7: queued Jabber notices go out every 5 s, after the change committed (counts-only logs).
const stopJabber = deps.jabberSender
  ? startOutbox({ db, clock, config, sender: deps.jabberSender }, (e) => app.log.info(e, 'jabber outbox'))
  : async () => undefined;
alertLog = app.log;
prices.start();
if (web) await serveWeb(app, web);
await app.listen({ ...LISTEN_OPTIONS, host: process.env.X2F_HOST || '127.0.0.1', port: port(process.env.X2F_PORT) });

// Plan 3 Task 8: the private internal listener (moderation pulls work and posts reports). It binds
// to a private interface only (default 127.0.0.1) and holds no secret beyond MOD_SIGNING_PUBLIC.
const modSigningPublic = process.env.X2F_MOD_SIGNING_PUBLIC;
const internal = modSigningPublic
  ? await buildInternalListener({
      db,
      modSigningPublic,
      now: () => deps.clock().getTime(),
      clock: deps.clock,
      // Task 9: a watcher report's committed event reaches both traders like any other trade event.
      publish: tradeEventPublisher({ events: app.events, push: app.push }),
    })
  : null;
if (internal) {
  await internal.listen({
    ...LISTEN_OPTIONS,
    host: process.env.X2F_INTERNAL_HOST || '127.0.0.1',
    port: port(process.env.X2F_INTERNAL_PORT || '8081'),
  });
}

// Plan 4 Task 4: the staff API on its own origin and port (X2F_STAFF_ORIGIN, X2F_STAFF_PORT); unset: none.
const staffListen = staffListenFromEnv(process.env);
// Plan 4 Task 11: the moderation process's internal API (MOD_INTERNAL_SOCKET, MOD_INTERNAL_SECRET),
// and the trader API's events (a moderator joining, a proof request, a moderator's message). Hold
// model v3: the trade publisher, so a staff hold end's resumed trades reach the live views.
const staff = staffListen
  ? await startStaffApi(deps, staffListen, { moderation: moderationFromEnv(process.env, clock), traderEvents: app.events, tradePublish: app.tradePublish })
  : null;

// Plan 3 Task 9: the timer loop (deadline ticks, lapse escalation, and maintenance pause/resume
// from `site_flags.maintenance_since`).
const timers = startTimers({
  db,
  clock: deps.clock,
  maintenanceSince: () => siteMaintenanceSince(db),
  publish: tradeEventPublisher({ events: app.events, push: app.push }),
  log: (e) => app.log.info({ reason: e.reason }, 'trade timers'),
});

const shutdown = async () => {
  if (staff) await staff.close();
  await stopHolds();
  await stopDisputeTimers();
  await stopJabber();
  await timers.stop(); // lets a pass in flight finish before the pool closes
  await stopRetention(); // lets a purge in flight finish before the pool closes
  await prices.stop();
  if (internal) await internal.close();
  await app.close();
  await db.end();
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
