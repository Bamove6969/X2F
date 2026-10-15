// THROWAWAY Phase 0 spike: one party's side of a 2-of-3 Monero multisig escrow.
// The same code runs in the buyer's browser, the seller's phone browser and the
// moderator process on the server. Parties only talk through the mailbox (`box`),
// standing in for X2F's end-to-end encrypted relay.

export const ROLES = ["buyer", "seller", "mod"];
const PW = "spike-password";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runEscrow({ moneroTs, role, box, daemonUri, scenario, proxyToWorker, log }) {
  const now = () => performance.now();
  const timed = async (step, fn) => {
    const s = now();
    const out = await fn();
    await log(step, Math.round(now() - s));
    return out;
  };
  const others = ROLES.filter((r) => r !== role);
  const getOthers = (key) => Promise.all(others.map((o) => box.get(`${key}:${o}`)));

  const w = await timed("create wallet", () => moneroTs.createWalletFull({
    networkType: moneroTs.MoneroNetworkType.MAINNET, // regtest uses mainnet address format
    password: PW, server: { uri: daemonUri }, regtest: true, proxyToWorker,
  }));

  const setupStart = now();
  await timed("round 1: prepare", async () => {
    await box.put(`prep:${role}`, await w.prepareMultisig());
  });
  let hex = await timed("round 2: make multisig", async () => w.makeMultisig(await getOthers("prep"), 2, PW));
  let round = 3;
  while (!(await w.getMultisigInfo()).getIsReady()) {
    const r = round;
    hex = await timed(`round ${r}: exchange keys`, async () => {
      await box.put(`kex${r}:${role}`, hex);
      return (await w.exchangeMultisigKeys(await getOthers(`kex${r}`), PW)).getMultisigHex();
    });
    if (++round > 8) throw new Error("multisig did not converge");
  }
  const addr = await w.getPrimaryAddress();
  await box.put(`addr:${role}`, addr);
  const addrs = await getOthers("addr");
  if (addrs.some((a) => a !== addr)) throw new Error("escrow address mismatch between parties");
  await log("escrow ready (total setup)", Math.round(now() - setupStart));

  await box.get("funded");
  await timed("see funded escrow", async () => {
    for (let i = 0; i < 120; i++) {
      await w.sync();
      if ((await w.getUnlockedBalance()) > 0n) return;
      await sleep(1000);
    }
    throw new Error("escrow funds never unlocked");
  });

  const [builder, cosigner] = scenario.signers;
  if (role === builder || role === cosigner) {
    const other = role === builder ? cosigner : builder;
    await timed("swap multisig state", async () => {
      await box.put(`msig:${role}`, await w.exportMultisigHex());
      await w.importMultisigHex([await box.get(`msig:${other}`)]);
    });
    if (role === builder) {
      await timed("build release tx", async () => {
        const txs = await w.sweepUnlocked({ address: scenario.to, relay: false });
        await box.put("txset", txs[0].getTxSet().getMultisigTxHex());
      });
    } else {
      await timed("co-sign and broadcast", async () => {
        const signed = await w.signMultisigTxHex(await box.get("txset"));
        const hashes = await w.submitMultisigTxHex(signed.getSignedMultisigTxHex());
        await box.put("done", hashes[0]);
      });
    }
  }
  const result = await box.get("result");
  await w.close();
  return result;
}

// Long-polling mailbox client for one room.
export function mailbox(base, room) {
  return {
    async put(key, value) {
      const r = await fetch(`${base}/box/${room}/${encodeURIComponent(key)}`, { method: "POST", body: value });
      if (!r.ok) throw new Error("mailbox put failed: " + r.status);
    },
    async get(key) {
      for (;;) {
        const r = await fetch(`${base}/box/${room}/${encodeURIComponent(key)}`);
        if (r.status === 200) return await r.text();
        if (r.status !== 204) throw new Error("mailbox get failed: " + r.status);
      }
    },
  };
}
