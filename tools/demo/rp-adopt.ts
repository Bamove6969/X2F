/**
 * DEMO ONLY: security keys and passkeys under a preview pane's (or any other unplanned) https host.
 *
 * WebAuthn binds a credential to an RP ID that must be the page's own host name (or a parent of
 * it), and the API checks the page's origin and RP ID in what the key signs. The demo's API starts
 * with X2F_RP_ID=localhost (or the public tunnel's host), so a page opened from a preview pane's
 * https host could not make a security key or passkey: the browser refuses `localhost` there before
 * the key is even asked (owner demo 13 Nov, "Unable to add security key", USB and NFC alike).
 *
 * So the gateway adopts the first such host it is opened from: it restarts the API with that host
 * as the RP ID and its origin added to X2F_ORIGINS, and holds API requests until the API is back.
 * The first host is kept (a later one does not move it again, so keys made under it keep working);
 * localhost still opens the app, but keys and passkeys then work under the adopted host only.
 * Off when the demo runs with a public origin (a tunnel: its host is the RP ID already) or with
 * DEMO_ADOPT_SELF=0.
 *
 * Who may choose it (review M4): only a request from a loopback peer (the preview pane's forwarder),
 * and X-Forwarded-Host/-Proto count only from one (gateway-core.ts), so a client on the phone's LAN
 * address or the tailnet cannot claim it. DEMO_ADOPT_HOST=<host name> pins the one host that may be
 * adopted, which also shuts out a local page that rebinds its own name to 127.0.0.1.
 */

/** The RP ID for a self origin (`https://host[:port]`): its host name, or null when WebAuthn cannot use it. */
export function rpIdOf(selfOrigin: string): string | null {
  let u: URL;
  try {
    u = new URL(selfOrigin);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.origin !== selfOrigin) return null;
  const host = u.hostname;
  // An IP address is never an RP ID; the API takes a lower-case DNS name.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[')) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host)) return null;
  return host;
}

/** The API's environment with `selfOrigin` adopted: its host as the RP ID, the origin allowed. */
export function adoptedApiEnv(apiEnv: Record<string, string>, selfOrigin: string): Record<string, string> {
  const rpId = rpIdOf(selfOrigin);
  if (rpId === null) throw new Error(`demo: ${selfOrigin} cannot be an RP ID`);
  const origins = (apiEnv.X2F_ORIGINS ?? '').split(',').filter((o) => o !== '' && o !== selfOrigin);
  return { ...apiEnv, X2F_RP_ID: rpId, X2F_ORIGINS: [...origins, selfOrigin].join(',') };
}

export interface Adopter {
  /**
   * For a request routed to the API: resolves once the API may take it. `selfOrigin` is the
   * request's own https origin when it is not one of the demo's configured ones, else null;
   * `page` is true for a page load (only a page load adopts a new host).
   */
  beforeApi(selfOrigin: string | null, page: boolean): Promise<void>;
  /** The adopted origin, or null. */
  adopted(): string | null;
}

/**
 * `restart(origin)` restarts the API with the origin adopted and resolves once it answers. `pin`
 * (DEMO_ADOPT_HOST), when set, is the only host name that may be adopted.
 */
export function createAdopter(o: { enabled: boolean; pin?: string | undefined; restart: (selfOrigin: string) => Promise<void>; log?: (line: string) => void }): Adopter {
  const log = o.log ?? ((line: string) => console.log(line));
  const pin = o.pin?.trim().toLowerCase() || null;
  let origin: string | null = null;
  let ready: Promise<void> = Promise.resolve();
  return {
    beforeApi(selfOrigin, page) {
      if (!o.enabled || selfOrigin === null) return ready;
      const rpId = rpIdOf(selfOrigin);
      if (origin === null && page && rpId !== null && (pin === null || rpId === pin)) {
        origin = selfOrigin;
        log(JSON.stringify({ reason: 'rp-adopt', origin: selfOrigin }));
        ready = o.restart(selfOrigin).catch((e: unknown) => {
          log(JSON.stringify({ reason: 'rp-adopt-failed', origin: selfOrigin, error: (e as Error).message }));
        });
      }
      return ready;
    },
    adopted: () => origin,
  };
}
