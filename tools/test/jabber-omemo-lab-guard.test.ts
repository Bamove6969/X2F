// Review R6 (re-verify of 7919b276): the OMEMO lab driver logs in with X2F_XMPP_* over a loopback
// passthrough instead of Tor, so it refuses to run against anything but a `.lab` account, or with
// NODE_ENV=production.
import { describe, expect, it } from 'vitest';
import { labRefusal } from '../jabber-omemo-lab-guard.js';

describe('jabber-omemo-lab guard', () => {
  it('runs only for a .lab JID and never with NODE_ENV=production', () => {
    expect(labRefusal({ X2F_XMPP_JID: 'x2f-alerts@x2f.lab' })).toBeNull();
    expect(labRefusal({ X2F_XMPP_JID: 'x2f-alerts@x2f.lab', NODE_ENV: 'development' })).toBeNull();
    expect(labRefusal({ X2F_XMPP_JID: 'x2f-alerts@x2f.lab', NODE_ENV: 'production' })).toMatch(/production/);
    for (const jid of ['x2f-alerts@xmpp.example.org', 'x2f-alerts@x2f.lab.example.org', 'x2f-alerts@lab', 'x2f-alerts@evil-lab', 'x2f.lab', '']) {
      expect(labRefusal({ X2F_XMPP_JID: jid }), jid).toMatch(/\.lab/);
    }
    expect(labRefusal({})).toMatch(/\.lab/);
  });
});
