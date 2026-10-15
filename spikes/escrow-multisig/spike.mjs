// THROWAWAY feasibility spike: 2-of-3 Monero multisig escrow (buyer, seller, moderator)
// on a private local regtest chain. Not product code.
import moneroTs from "monero-ts";

const RPC = "http://127.0.0.1:18081";
const NET = moneroTs.MoneroNetworkType.MAINNET; // regtest uses mainnet address format
const PW = "spike-password";
const XMR = 1_000_000_000_000n;
const fmt = (a) => (Number(a) / 1e12).toFixed(6) + " XMR";
const t0 = () => performance.now();
const secs = (s) => ((performance.now() - s) / 1000).toFixed(1) + "s";

async function rpc(method, params = {}) {
  const r = await fetch(RPC + "/json_rpc", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "0", method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(method + ": " + JSON.stringify(j.error));
  return j.result;
}
const mine = (n, address) => rpc("generateblocks", { amount_of_blocks: n, wallet_address: address });
const newWallet = () => moneroTs.createWalletFull({ networkType: NET, password: PW, server: { uri: RPC }, proxyToWorker: false, regtest: true });

// Build one escrow: three fresh wallets turned into a 2-of-3 multisig.
async function makeEscrow() {
  const s = t0();
  const w = { buyer: await newWallet(), seller: await newWallet(), mod: await newWallet() };
  const roles = Object.keys(w);
  const prep = Object.fromEntries(await Promise.all(roles.map(async (r) => [r, await w[r].prepareMultisig()])));
  let hex = {};
  for (const r of roles) {
    const others = roles.filter((o) => o !== r).map((o) => prep[o]);
    hex[r] = (await w[r].makeMultisig(others, 2, PW));
  }
  let rounds = 1;
  while (!(await w.buyer.getMultisigInfo()).getIsReady()) {
    const next = {};
    for (const r of roles) {
      const others = roles.filter((o) => o !== r).map((o) => hex[o]);
      next[r] = await w[r].exchangeMultisigKeys(others, PW);
    }
    for (const r of roles) hex[r] = next[r].getMultisigHex();
    rounds++;
    if (rounds > 5) throw new Error("multisig did not converge");
  }
  const addr = await w.buyer.getPrimaryAddress();
  for (const r of roles) if ((await w[r].getPrimaryAddress()) !== addr) throw new Error("address mismatch");
  const info = await w.buyer.getMultisigInfo();
  console.log(`  escrow ready: ${info.getThreshold()}-of-${info.getNumParticipants()}, ${rounds} message rounds, ${secs(s)}`);
  return { w, addr };
}

async function syncAll(wallets) { for (const x of wallets) await x.sync(); }

// The multisig wallets must swap state before anyone can spend.
async function swapState(a, b) {
  const ha = await a.exportMultisigHex(), hb = await b.exportMultisigHex();
  await a.importMultisigHex([hb]); await b.importMultisigHex([ha]);
}

// Two signers move all escrow funds to `to`. `first` builds, `second` co-signs and submits.
async function release(first, second, to, label) {
  const s = t0();
  await swapState(first, second);
  const txs = await first.sweepUnlocked({ address: to, relay: false });
  const setHex = txs[0].getTxSet().getMultisigTxHex();
  const signed = await second.signMultisigTxHex(setHex);
  const hashes = await second.submitMultisigTxHex(signed.getSignedMultisigTxHex());
  console.log(`  ${label}: signed by 2 of 3 and broadcast (${hashes[0].slice(0, 12)}…) in ${secs(s)}`);
}

async function balanceAfterMining(wallet, miner) {
  await mine(11, miner); await wallet.sync();
  return await wallet.getBalance();
}

async function main() {
  console.log("monero-ts", moneroTs.getVersion ? await moneroTs.getVersion() : "");
  const funder = await newWallet();              // seller's normal wallet
  const minerAddr = await funder.getPrimaryAddress();
  const buyerRecv = await newWallet();           // buyer's normal wallet
  const sellerRecv = await newWallet();          // seller refund wallet, separate from the miner
  console.log("mining 80 blocks to the seller's wallet…");
  await mine(80, minerAddr); await funder.sync();
  console.log("  seller unlocked balance:", fmt(await funder.getUnlockedBalance()));

  const amount = 1n * XMR;
  const scenarios = [
    { name: "1. Normal trade: seller confirms payment, seller + buyer release to buyer", signers: ["seller", "buyer"], to: () => buyerRecv },
    { name: "2. Mutual cancel: seller + buyer refund the seller", signers: ["buyer", "seller"], to: () => sellerRecv },
    { name: "3. Dispute won by buyer: moderator + buyer release to buyer", signers: ["mod", "buyer"], to: () => buyerRecv },
    { name: "4. Dispute won by seller: moderator + seller refund the seller", signers: ["mod", "seller"], to: () => sellerRecv },
  ];
  const results = [];
  for (const sc of scenarios) {
    console.log("\n" + sc.name);
    const { w, addr } = await makeEscrow();
    let s = t0();
    await funder.sync();
    await funder.createTx({ accountIndex: 0, address: addr, amount, relay: true });
    console.log(`  seller funded escrow with ${fmt(amount)} in ${secs(s)}`);
    await mine(10, minerAddr);                     // Monero locks new outputs for 10 blocks
    await syncAll(Object.values(w));
    console.log("  escrow balance:", fmt(await w.buyer.getBalance()));
    const target = sc.to();
    await target.sync(); const before = await target.getBalance();
    await release(w[sc.signers[0]], w[sc.signers[1]], await target.getPrimaryAddress(), "release");
    const after = await balanceAfterMining(target, minerAddr);
    const got = after - before;
    // when the target is the seller, the seller also earns mining rewards; measure via tx instead
    await target.sync(); const got2 = (await target.getBalance()) - before; const ok = got2 > amount - XMR / 100n && got2 <= amount;
    console.log(`  recipient received: ${fmt(got2)} ${ok ? "✓" : "✗"}`);
    results.push([sc.name, ok]);
    for (const x of Object.values(w)) await x.close();
  }
  // Negative test: a single party must not be able to move escrow funds alone.
  console.log("\n5. Safety: one key alone cannot move the funds");
  const { w, addr } = await makeEscrow();
  await funder.sync();
  await funder.createTx({ accountIndex: 0, address: addr, amount, relay: true });
  await mine(10, minerAddr); await syncAll(Object.values(w));
  await swapState(w.seller, w.buyer);
  const txs = await w.seller.sweepUnlocked({ address: await funder.getPrimaryAddress(), relay: false });
  let blocked = false;
  try { await w.seller.submitMultisigTxHex(txs[0].getTxSet().getMultisigTxHex()); } catch (e) { blocked = true; console.log("  rejected as expected:", String(e.message).slice(0, 90)); }
  results.push(["5. One key alone cannot spend", blocked]);

  console.log("\nSUMMARY");
  for (const [n, ok] of results) console.log(ok ? "PASS" : "FAIL", n);
  process.exit(results.every((r) => r[1]) ? 0 : 1);
}
main().catch((e) => { console.error("SPIKE ERROR:", e); process.exit(2); });
