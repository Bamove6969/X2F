/**
 * Review R6 (re-verify of 7919b276): the OMEMO lab driver (jabber-omemo-lab.ts) logs in with
 * X2F_XMPP_JID and X2F_XMPP_PASSWORD through a loopback passthrough, not Tor, and publishes the lab
 * identity's device list and bundle on that account. Run with the production environment it would
 * replace X2F's real OMEMO device list over clearnet, so it refuses unless the account is on a
 * `.lab` domain, and always under NODE_ENV=production. The reason it gives quotes no address.
 */
export function labRefusal(env: Record<string, string | undefined>): string | null {
  if (env.NODE_ENV === 'production') return 'jabber-omemo-lab: refused with NODE_ENV=production';
  const jid = env.X2F_XMPP_JID ?? '';
  const at = jid.indexOf('@');
  const domain = at > 0 ? jid.slice(at + 1) : '';
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.lab$/.test(domain)) return 'jabber-omemo-lab: X2F_XMPP_JID must be an account on a .lab domain';
  return null;
}
