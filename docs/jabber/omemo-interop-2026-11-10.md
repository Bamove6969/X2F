# OMEMO interop run, 2026-11-10: the X2F sender against a real XMPP server and a real OMEMO 0.3 client

Branch `wip/lead-jabber-omemo` at `baf56fab` (the build the review's Re-verify section approved for a
dark landing). The review `review-jabber-omemo-2026-11-09.md` asked for an interop run before the
sender is lit; this is that run, on the lead's box, against a lab built for it. No protocol code was
changed. Lab helper, committed with this record: `tools/jabber-omemo-lab.ts` (what differs from
production is listed in its header: a loopback SOCKS5 passthrough instead of Tor, the lab CA as the
TLS trust anchor, X2F's identity seed and bundle in a JSON file instead of the sealed database row).
The sender (`apps/api/src/jabber/xmpp.ts`), the encryptor (`omemoEncryptorFrom`, the same object
`omemoEncryptor` builds from the database rows) and `@x2f/omemo` ran as they are.

## The lab

| Part | What | Version |
|---|---|---|
| Server | Prosody in Docker (Debian bookworm image built for the lab; the official `prosody/prosody` image is 0.11.9 from 2021 and was not used), one VirtualHost `x2f.lab`, ports published on 127.0.0.1 only, `modules_disabled = { "s2s"; "dialback" }`, `mod_stanza_debug` on so every stanza is in the server log, `c2s_direct_tls_ports = { 5223 }` for the sender, STARTTLS on 5222 for the client, `c2s_require_encryption = true`, `authentication = "internal_hashed"`, PEP with its defaults | Prosody 0.12.3, Lua 5.4, LuaSec 1.2.0, OpenSSL 3.0.22 |
| Certificates | a lab CA (P-256) and a leaf for `x2f.lab` (SAN `DNS:x2f.lab`, `keyUsage = digitalSignature`) | OpenSSL 3 on the host |
| Accounts | `x2f-alerts@x2f.lab` (X2F), `mira@x2f.lab` (the user), `mallory@x2f.lab` (a third party; no roster relation to anyone) | |
| Client (not ours) | python slixmpp with the slixmpp-omemo plugin: python-omemo's `oldmemo` backend (`eu.siacs.conversations.axolotl`), built on the x3dh, doubleratchet and xeddsa packages; blind trust before verification; a 60-line driver that logs every stanza and every decrypt result as JSON lines | slixmpp 1.17.0, slixmpp-omemo 2.2.0, OMEMO 2.1.0, Oldmemo 2.1.0, X3DH 1.3.0, DoubleRatchet 1.3.0, XEdDSA 1.2.0, cryptography 50.0.2, Python 3.13.18 |
| Sender | `tools/jabber-omemo-lab.ts` driving the production `xmppSender` | Node 24.22.1, Docker 29.9.2 |

X2F's lab identity: device id `1996535089`, identity key `Bb5u1o33O3Vv5fwZQSWfsDtYZxHrjou78vD09uX/0/BA`
(wire form), signed prekey id `2868628`, 100 prekeys. The client's device: id `102048545`, identity
key `BU4RipCe2NY/T4CecX6Kb1YZ/zQx563hW17CvB5qOfoB`, signed prekey id `1`, 100 prekeys.

Every excerpt below is from the Prosody stanza log (`RECV:` is what the server read from a client,
`SEND:` what it wrote to one) or from the client's JSON log. Base64 bodies longer than a key are
elided as `...`; nothing here is a secret (ciphertext, public keys, ids).

## Results, step by step (the review's plan plus the Re-verify additions)

### 1. Publish: the first connection creates both nodes with publish-options; every later connection republishes idempotently

Each send opens one connection and publishes X2F's device list and bundle before anything else.
Prosody 0.12 accepted the publish-options on the first publish (the node did not exist) and answered
`result` on every one of the 146 connections of this run, item id `current` each time:

```
RECV: <iq type='set' xml:lang='en' id='05e7d7d0600f5b60'><pubsub xmlns='http://jabber.org/protocol/pubsub'><publish node='eu.siacs.conversations.axolotl.devicelist'><item id='current'><list xmlns='eu.siacs.conversations.axolotl'><device id='1996535089'/></list></item></publish><publish-options><x type='submit' xmlns='jabber:x:data'><field type='hidden' var='FORM_TYPE'><value>http://jabber.org/protocol/pubsub#publish-options</value></field><field var='pubsub#persist_items'><value>true</value></field><field var='pubsub#access_model'><value>open</value></field></x></publish-options></pubsub></iq>
SEND: <iq type='result' to='x2f-alerts@x2f.lab/x2f-alerts' id='05e7d7d0600f5b60'><pubsub xmlns='http://jabber.org/protocol/pubsub'><publish node='eu.siacs.conversations.axolotl.devicelist'><item id='current'/></publish></pubsub></iq>
RECV: <iq type='set' xml:lang='en' id='3dfe0151519c8a5a'><pubsub xmlns='http://jabber.org/protocol/pubsub'><publish node='eu.siacs.conversations.axolotl.bundles:1996535089'><item id='current'><bundle xmlns='eu.siacs.conversations.axolotl'><signedPreKeyPublic signedPreKeyId='2868628'>BZYHT1M7RnBQ8svGVQjPPhs8r98egipcS/PFo+7bTNZS</signedPreKeyPublic><signedPreKeySignature>gTQ5JCRRsxBtgZzFa7/RwdTAqQapBh7CDonOb2CprtF31mvzhNk1fHi5SP4TWs+TzSV50yUEdH1G//WPGthnDw==</signedPreKeySignature><identityKey>Bb5u1o33O3Vv5fwZQSWfsDtYZxHrjou78vD09uX/0/BA</identityKey><prekeys><preKeyPublic preKeyId='1'>...</preKeyPublic>...<preKeyPublic preKeyId='100'>...</preKeyPublic></prekeys></bundle></item></publish><publish-options>...same two fields...</publish-options></pubsub></iq>
SEND: <iq type='result' to='x2f-alerts@x2f.lab/x2f-alerts' id='3dfe0151519c8a5a'><pubsub xmlns='http://jabber.org/protocol/pubsub'><publish node='eu.siacs.conversations.axolotl.bundles:1996535089'><item id='current'/></publish></pubsub></iq>
```

The publish answers carry no `from` (the server's own), which `ownAnswer` accepts. **Open access,
anonymous fetch**: `mallory`, who has no roster relation with X2F, fetched both nodes; the answers
come `from` X2F's bare JID and the bundle holds the 100 prekeys (X2F never receives, so none is
ever consumed):

```
{"event": "fetched-devicelist", "target": "x2f-alerts@x2f.lab", "iq_from": "x2f-alerts@x2f.lab", "item": "<item xmlns=\"http://jabber.org/protocol/pubsub\" id=\"current\"><list xmlns=\"eu.siacs.conversations.axolotl\"><device id=\"1996535089\" /></list></item>"}
{"event": "fetched-bundle", "target": "x2f-alerts@x2f.lab", "node": "eu.siacs.conversations.axolotl.bundles:1996535089", "iq_from": "x2f-alerts@x2f.lab", "prekeys": 100, ...}
```

Not run: a server configured without publish-options (`xmpp: publish failed`, unit-tested in
`xmpp.test.ts`), and a fetch across s2s (one server in the lab; the open access model is what makes
the s2s fetch work and it is what Prosody stored).

### 2. The set-up test code, then an account-change notice, to the online client

Device list and bundle fetched from the recipient's bare JID; the answers come `from` the bare JID
exactly (the Re-verify addition), so `answerFrom(to)` takes them:

```
RECV: <iq type='get' to='mira@x2f.lab' xml:lang='en' id='ba0092a0789d016b'><pubsub xmlns='http://jabber.org/protocol/pubsub'><items node='eu.siacs.conversations.axolotl.devicelist'/></pubsub></iq>
SEND: <iq type='result' to='x2f-alerts@x2f.lab/x2f-alerts' id='ba0092a0789d016b' from='mira@x2f.lab'><pubsub xmlns='http://jabber.org/protocol/pubsub'><items node='eu.siacs.conversations.axolotl.devicelist'><item xmlns='http://jabber.org/protocol/pubsub' id='current'><list xmlns='eu.siacs.conversations.axolotl'><device id='102048545'/></list></item></items></pubsub></iq>
RECV: <iq type='get' to='mira@x2f.lab' xml:lang='en' id='175f3713bbcc5c62'><pubsub xmlns='http://jabber.org/protocol/pubsub'><items node='eu.siacs.conversations.axolotl.bundles:102048545'/></pubsub></iq>
SEND: <iq type='result' to='x2f-alerts@x2f.lab/x2f-alerts' id='175f3713bbcc5c62' from='mira@x2f.lab'><pubsub ...><items node='eu.siacs.conversations.axolotl.bundles:102048545'><item xmlns='http://jabber.org/protocol/pubsub' id='current'><bundle xmlns='eu.siacs.conversations.axolotl'><signedPreKeyPublic signedPreKeyId='1'>Bd11uW0BSldi7Rpw8Xocs/+JuVS2OOsUK1ANqMrOP4Am</signedPreKeyPublic><signedPreKeySignature>LISb7daaQI4fqBgDWI9bJVHEKivyGlxDX3Z07ceMjUWrP1fteoyIrNYtm/vx66jbDsykt6bOoALJlaPhQaT0iw==</signedPreKeySignature><identityKey>BU4RipCe2NY/T4CecX6Kb1YZ/zQx563hW17CvB5qOfoB</identityKey><prekeys>...100 preKeyPublic...</prekeys></bundle></item></items></pubsub></iq>
```

The message as the client received it (its own log; `<delay>` was added by the server because this
one had waited in offline storage, see step 3), then the ping:

```
<message xmlns="jabber:client" to="mira@x2f.lab" type="chat" id="x2f09ae4d65c25729c4" xml:lang="en" from="x2f-alerts@x2f.lab/x2f-alerts"><encrypted xmlns="eu.siacs.conversations.axolotl"><header sid="1996535089"><key rid="102048545" prekey="true">MyiySwgbMAESIQUInkwKR4Tjg8QcVzRMWPMw7vn38j0m/sXHz6K/8mDWdxohBb5u1o33O3Vv5fwZQSWfsDtYZxHrjou78vD09uX/0/BAImIzCiEFP33D9UtAC5rzoOBffIBiyQEna6stMqKFRVwfXvMjyjUQABgAIjCzpum+QYf6hgv5RjCtrvxt/0b6sALpXRcgMCN1b9I/s+qZEDvEYre9X8D8ffZVL6Vr1TD7qbHXkg==</key><iv>vdpQbmrgDi7trQLQ</iv></header><payload>vt+4PE7uobakLYVTBEbgaqdsh/gbTnPs76klKy4=</payload></encrypted><encryption xmlns="urn:xmpp:eme:0" namespace="eu.siacs.conversations.axolotl" name="OMEMO" /><nick xmlns="http://jabber.org/protocol/nick">X2F alerts</nick><store xmlns="urn:xmpp:hints" /><delay xmlns="urn:xmpp:delay" stamp="2026-11-10T01:55:21Z" from="x2f.lab" /></message>
RECV: <iq type='get' to='x2f.lab' xml:lang='en' id='5fe90fe403a568f1'><ping xmlns='urn:xmpp:ping'/></iq>
SEND: <iq type='result' to='x2f-alerts@x2f.lab/x2f-alerts' id='5fe90fe403a568f1' from='x2f.lab'/>
```

What the client reported (the sender's own record of the same element: `prekey` key 178 bytes,
registration id 9650, `preKeyId` 27, `signedPreKeyId` 1, 12-byte IV, 29-byte payload):

```
{"event": "message-encrypted", "from": "x2f-alerts@x2f.lab/x2f-alerts", "type": "chat", "id": "x2f09ae4d65c25729c4", "has_body": false, "eme": {"namespace": "eu.siacs.conversations.axolotl", "name": "OMEMO"}, "has_store_hint": true, "nick": "X2F alerts", "sid": "1996535089", "keys": [{"rid": "102048545", "prekey": "true"}], "iv_bytes": 12, "payload_bytes": 29}
{"event": "decrypted", "id": "x2f09ae4d65c25729c4", "body": "Your X2F test code is 482913.", "sender_device_id": 1996535089, "sender_identity_key_b64": "9ExjqrQEGi+X0d+XvSeH3s10dza5uGkDjrfL5EejnQQ=", "trust": "UNDECIDED", "n": 1}
{"event": "decrypted", "id": "x2f43e195b20ba53008", "body": "An account change was made on your X2F account.", "sender_device_id": 1996535089, "sender_identity_key_b64": "9ExjqrQEGi+X0d+XvSeH3s10dza5uGkDjrfL5EejnQQ=", "trust": "UNDECIDED", "n": 2}
```

**Passed.** Both texts decrypt to the fixed sentences; `trust` is python-omemo's "undecided"
(it decrypts anyway, as libsignal clients do; the identity key it prints is X2F's key in its own
Ed25519 storage form, not the wire bytes). Before decrypting, the client fetched X2F's device list and
bundle from X2F's bare JID itself (`<items node='eu.siacs.conversations.axolotl.devicelist' max_items='1'/>`
to `x2f-alerts@x2f.lab`, then `...bundles:1996535089`), which is the open-access fetch the plan
relies on. The second notice is a second `prekey='true'` key (`preKeyId` 66), i.e. a fresh
session; python-omemo logged "Key exchange replaces existing session" at debug level and decrypted
it. No `<body>` was sent, none was shown; the EME hint is present on every message of the run.

After each prekey message the client answered with an empty key-transport message to X2F's bare
JID and republished its bundle with the used prekey replaced (`preKeyId` 102 and up appear):

```
<message xmlns="jabber:client" to="x2f-alerts@x2f.lab" id="26658fcd4e24463ab4aa6a3f6b966220" xml:lang="en"><encrypted xmlns="eu.siacs.conversations.axolotl"><header sid="102048545"><key rid="1996535089">MwohBSQX6EYH30ydBsDAno0P0ufj1nsAe/C0gLaCzZ8Y+1BpEAAYACIgjDrqqJgHqPUE8kXz8GqDZjaLu6tsuQWpFQGeKM3mkYASfIRHhGI1pw==</key><iv>l3XzC2dQYtMOLMHS</iv></header></encrypted><store xmlns="urn:xmpp:hints" /></message>
```

### 3. The offline device decrypts when it comes back

The two messages above were in fact delivered from offline storage: the client process of the first
attempt had died before initialising OMEMO (a bug in the lab driver, fixed), so Prosody stored them
(`x2f.lab:offline debug Saved to offline storage: <message id='…' to='mira@x2f.lab' type='chat' from='x2f-alerts@x2f.lab/x2f-alerts'>`),
added `<delay>` and delivered them on the next presence; both decrypted. **Passed** (one device; a
second device on the account was not available in the lab).

### 4. Offline burst, one outbox pass

Client offline. 3 notices with one `PreKeyLedger` (as `sendDueNotices` does): prekey ids 1, 32, 11,
all distinct; then the client came back and decrypted all 5 waiting messages (these 3 plus 2 from step 2):

```
{"event": "done", "decrypted": 5, "failed": 0}
```

Then 25 notices in one pass (`OUTBOX_BATCH`), `trade-attention`, client offline: 25 sends ok (1.63 s
each on average), 25 distinct prekey ids `[4, 9, 12, 18, 19, 21, 24, 34, 37, 39, 44, 45, 52, 59, 61, 64, 68, 70, 71, 76, 83, 85, 100, 407, 609]`;
the client came back and decrypted 25 of 25:

```
{"event": "done", "decrypted": 25, "failed": 0}      25 x "body": "A trade on your X2F account needs your attention."
```

**Passed.**

### 4b (Re-verify addition). More notices in one pass than the device has prekeys: the no-prekey fallback

103 notices in one pass with one ledger to the offline client (100 published prekeys). The sender
used 100 distinct prekeys and then, as designed (review M2), set up the last 3 sessions without a
one-time prekey (no `preKeyId` field; `prekey` keys of 176 to 179 bytes instead of 178):

```
sends 103 ok 103 ms avg 1629
with prekey 100 without 3 distinct 100
no-prekey sends at i = [100, 101, 102]
```

The client came back: **100 decrypted, 3 failed**, every failure the same:

```
{"event": "decrypt-failed", "id": "x2f6690bfe6cc3f8406", "error": "KeyExchangeFailed: No pre key with id 0 known.", "cause": null, "n": 1}
{"event": "decrypt-failed", "id": "x2fa672cccf1bbbb806", "error": "KeyExchangeFailed: No pre key with id 0 known.", "cause": null, "n": 2}
{"event": "decrypt-failed", "id": "x2f39b01c807f950880", "error": "KeyExchangeFailed: No pre key with id 0 known.", "cause": null, "n": 3}
{"event": "done", "decrypted": 100, "failed": 3}
```

**Finding (interop, not a bug in our bytes).** python-omemo's `oldmemo` backend reads an absent
`preKeyId` as 0 and refuses (`oldmemo.py` `build_session_passive`: `if key_exchange.pre_key_id not in pre_keys_by_id: raise KeyExchangeFailed`;
and its x3dh `get_shared_secret_passive` has `require_pre_key=True`). libsignal accepts a
PreKeySignalMessage without a prekey id (`SessionBuilder.processV3`, as the review read it), so
Conversations and Dino would decrypt these; Gajim's omemo-dr and Monal were not tested. The case is
reached only when one pass sends a device more notices than it publishes prekeys: with
`OUTBOX_BATCH = 25` that is impossible against a client publishing the XEP's 100 (this client
refills to 100 after every message) and possible only against one publishing fewer than 25.
See the questions at the end.

### 5. Replenishment

After 130 prekey messages had been consumed across the run, the client's published bundle still held
100 prekeys (an anonymous fetch by `mallory`):

```
{"event": "fetched-bundle", "target": "mira@x2f.lab", "node": "eu.siacs.conversations.axolotl.bundles:102048545", "iq_from": "mira@x2f.lab", "prekeys": 100}
```

python-omemo republished its bundle after every single prekey message (136 publishes in the run).
**Passed** (as a burst; the plan's "101 over an hour" timing variant was not run separately).

### 6. Replay

The `<encrypted>` element of the step-2 test-code message (prekey id 14, consumed by then) was sent
again from X2F's account, as a server-side replay would look to the client. The client showed
nothing new and reported:

```
{"event": "decrypt-failed", "id": "x2f52b55ca1bf0ec9b0", "error": "KeyExchangeFailed: No pre key with id 14 known.", "cause": null, "n": 1}
```

**Passed** for the property that matters (no duplicate text, no prekey consumed). python-omemo
refuses it because the prekey is gone; libsignal would refuse it as a duplicate message of the
archived session (review L9). Either way nothing is shown.

### 7. Bounce

- A blocked sender (the user blocked `x2f-alerts@x2f.lab` with XEP-0191): Prosody refused the
  device-list fetch, the sender failed with `xmpp: omemo failed` in 101 ms and wrote no message
  (`parseDeviceList` of an error answer is "no devices"). The bounce path was not reached; nothing
  was sent in any form. The user's "block strangers" case of the review's L10 looks like this.
- An account that does not exist (`nobody@x2f.lab`): `xmpp: omemo failed` in 94 ms, no message.
  These two fetch refusals are the only IQ errors the server sent X2F in the whole run:

```
SEND: <iq type='error' to='x2f-alerts@x2f.lab/x2f-alerts' id='e6561a5c3dd7db87' from='mira@x2f.lab'><error type='cancel'><service-unavailable xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/></error></iq>
SEND: <iq type='error' to='x2f-alerts@x2f.lab/x2f-alerts' id='15e8eb1d6df17236' from='nobody@x2f.lab'><error type='auth'><forbidden xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/></error></iq>
```
- A real bounce, obtained by running Prosody with `"offline"` in `modules_disabled` so a message to
  an offline user is refused instead of stored:

```
RECV: <message to='mira@x2f.lab' id='x2f148e909a7fecdc88' type='chat' xml:lang='en'><encrypted ...>...</encrypted><encryption xmlns='urn:xmpp:eme:0' name='OMEMO' namespace='eu.siacs.conversations.axolotl'/><nick ...>X2F alerts</nick><store xmlns='urn:xmpp:hints'/></message>
SEND: <message to='x2f-alerts@x2f.lab/x2f-alerts' id='x2f148e909a7fecdc88' type='error' from='mira@x2f.lab'><error type='cancel'><service-unavailable xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/></error></message>
RECV: <iq to='x2f.lab' id='a58087e977929108' type='get' xml:lang='en'><ping xmlns='urn:xmpp:ping'/></iq>
```

  The sender: `{"ok": false, "ms": 130, "error": "xmpp: delivery failed"}`. The error stanza came
  `from` the recipient's bare JID before the ping answer, which is exactly `fromRecipient`'s case.
  **Passed.** (The first attempt at this, commenting `"offline"` out of `modules_enabled`, changed
  nothing: Prosody 0.12 loads mod_offline on its own unless it is in `modules_disabled`; that message
  went to the user's offline store and the send counted as delivered, correctly.)
- "A server that is down": not run (one server; the TLS/SOCKS failure paths are unit-tested).

### 8. IV and tag

The 12-byte IV and the 32-byte `key ‖ tag` decrypted on python-omemo (`oldmemo` requires exactly this
form). Gajim and Monal were not available on this box: that line of the plan is still open for them.

### 9. Hostile stanzas (M1 regression, plus the Re-verify 64 KB note)

`mallory` flooded X2F's full JID `x2f-alerts@x2f.lab/x2f-alerts` for 14 s at one stanza per 15 ms
(903 stanzas) while X2F sent 3 notices to the online client. The four noise shapes, cycled:

```
<message to='x2f-alerts@x2f.lab/x2f-alerts' type='chat' id='noiseN'><failure xmlns='x'/><body>noise</body></message>
<iq type='result' id='<random 16 hex>' to='x2f-alerts@x2f.lab/x2f-alerts'><pubsub xmlns='http://jabber.org/protocol/pubsub'><items node='eu.siacs.conversations.axolotl.devicelist'><item id='current'><list xmlns='eu.siacs.conversations.axolotl'><device id='99999'/></list></item></items></pubsub></iq>
<message to='x2f-alerts@x2f.lab/x2f-alerts' type='error' id='x2f0000000000000000'><error type='cancel'><service-unavailable xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/></error></message>
<iq type='get' id='discoN' to='x2f-alerts@x2f.lab/x2f-alerts'><query xmlns='http://jabber.org/protocol/disco#info'/></iq>
```

Prosody put 311 of them on the sender's live stream across the connections of that window (stamped
`from='mallory@x2f.lab/lab'`; 77 were the forged error messages), returned 150 IQ errors to
`mallory` for IQs sent while no `x2f-alerts` resource was connected, and stored the 148 chat
messages sent in those gaps in X2F's offline store. All 3 sends completed (`ok: true`, 1.6 to 1.76 s)
and the client decrypted all 3. **Passed**: the `<failure xmlns='x'/>` inside a stranger's message
is not a SASL answer, a forged device list with a random id never matches a pending request, a forged
error stanza from a stranger is not a bounce (and its id cannot match anyway), and a disco `get` is
ignored. The 64 KB buffer cap was not approached at this rate (a few hundred bytes per stanza, under
2 s per connection).

### 10. Offline store

At the end of the run X2F's offline store (`/var/lib/prosody/x2f%2elab/offline/x2f%2dalerts.list`)
held **284 messages, 202,760 bytes**: 136 from `mira@x2f.lab/lab`, each the empty key-transport
"session completed" message a client sends after a prekey message (exactly one per decrypted notice:
2 + 5 + 25 + 100 + 4), and 148 from `mallory@x2f.lab/lab` (the noise of step 9). X2F never fetches
them, so on X2F's own server (p11-42) the account's offline store needs the cap or expiry of owner
question 7; Prosody's default limit here was 10,000 items per user (`storage_internal debug mira has 0 items out of 10000 limit in store offline`).

### L2 (malformed device skipped)

The user's account published a second device `12` whose bundle verifies (a real XEdDSA signature)
but whose three prekeys are all `u = 0`, a key OpenSSL's X25519 refuses. The sender fetched both
bundles, skipped device 12 (logged `skippedDevice: 12` only) and encrypted to the real device,
which decrypted; the device list was restored afterwards:

```
{"ok": true, "ms": 1682, "skipped": [12], "element": {"sid": 1996535089, "ivBytes": 12, "payloadBytes": 47, "keys": [{"rid": 102048545, "prekey": true, "bytes": 179, "registrationId": 9650, "preKeyId": 6715, "signedPreKeyId": 1, ...}]}}
{"event": "decrypted", "id": "x2fad2d9fd0f5b2cef3", "body": "An account change was made on your X2F account.", ...}
```

**Passed.**

## Other things the run showed

- **SASL**: Prosody 0.12 offered `PLAIN` and `SCRAM-SHA-1` only (`<mechanisms><mechanism>PLAIN</mechanism><mechanism>SCRAM-SHA-1</mechanism></mechanisms>`);
  the sender chose `SCRAM-SHA-1`, as designed (SCRAM-SHA-256 first when offered). For the production
  server (p11-42): SCRAM-SHA-256 needs Prosody 13 or ejabberd; not a code matter.
- **Per-send cost**: about 1.63 s per notice end to end (connect, TLS, SCRAM, bind, two publishes,
  two fetches, the message, the ping, then the 1.5 s bounce wait, which dominates). With
  `OUTBOX_BATCH = 25` a full pass is about 41 s, well inside the 5 s tick's "pass in flight skips
  the next tick" rule and the 30 s per-send timeout.
- **A body-less message and bot frameworks**: slixmpp's own `message` event fires only for a
  `<message>` with a `<body>` (its `IM` callback matches `message/body`); the lab client needed an
  explicit handler for `message/{eu.siacs.conversations.axolotl}encrypted` to see X2F's notices at
  all. GUI clients key on `<encrypted>`; a slixmpp bot written the usual way would not see them. This
  belongs with owner question 2 (fallback body), as information, not a recommendation to add one.
- **python-omemo's client behaviour per notice**: one empty key-transport message to X2F (never
  read; step 10) and one bundle republish. Nothing else was sent to X2F; no presence, no subscription.
- **Prosody added `<delay>`** to offline-stored messages and nothing else to any stanza; carbons
  were skipped for the offline user (`Skip carbons for offline user`).
- **The hand-written SOCKS and TLS path** behaved like the tests: the proxy saw `atyp=3 host=x2f.lab port=5223`
  (a name, never an address) on every connection; TLS 1.2+ with the lab CA, SNI `x2f.lab`.

## Not covered by this run

Conversations, Dino, Gajim (omemo-dr) and Monal themselves (no Android or desktop here); two devices
on one account; s2s (one server); a server without publish-options; Tor; the identity and bundle
loaded from the sealed database row (the in-memory path from the same function was used); "101 over
an hour" as a timing test. The client here is one real, independent OMEMO 0.3 implementation; the
libsignal family remains to be run before the flag is set, as the review says.

## Questions for the owner or lead (with recommendations)

1. **The no-prekey fallback and python-omemo clients (step 4b).** When a pass sends one device more
   notices than it publishes prekeys, the extra notices are undecryptable on python-omemo-based
   clients (they refuse a prekey message without a prekey id) while libsignal-based ones accept them.
   Options: keep as is (unreachable against a 100-prekey client with `OUTBOX_BATCH = 25`; reachable
   only against a client publishing fewer than 25, which the XEP allows down to 20), or stop the pass
   for that recipient once its prekeys are used up and leave the rest for the next pass (a later
   pass sees a republished bundle if the client was online in between; if it was not, the same
   problem returns). Recommendation: keep the fallback, and let owner question 5 (coalescing unsent
   notices per account and kind) remove the burst that gets there; note it in the plan.
2. **Offline store (owner question 7, now with a number).** 136 notices produced 136 unread
   key-transport messages (about 600 bytes each) in X2F's offline store, plus whatever strangers send.
   Recommendation unchanged: cap or expire that account's offline store on p11-42.

## How to run it again

The lab lives in the lead's scratchpad (`omemo-lab/`: `prosody/` config and Dockerfile, `certs/`,
`client.py`, `env.sh`, `state/`, `logs/`); nothing of it is in the repository except
`tools/jabber-omemo-lab.ts`. Start Prosody with the config and certs mounted, register the three
accounts with `prosodyctl register`, run `client.py run` as the user, and drive the sender with the
environment the tool's header shows. The container was stopped after the run; its image is
`x2f-omemo-lab-prosody:0.12`.
