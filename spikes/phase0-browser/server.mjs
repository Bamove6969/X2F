// THROWAWAY Phase 0 spike server. Serves the test page, proxies the private regtest
// node, relays escrow messages, runs the moderator, funds escrows and checks payouts.
// Not product code.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import moneroTs from "monero-ts";
import { runEscrow, ROLES } from "./escrow.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8787;
const DAEMON = "http://127.0.0.1:18081";
const XMR = 1_000_000_000_000n;
const fmt = (a) => (Number(a) / 1e12).toFixed(6);
const SESSION = "s" + Date.now().toString(36);

// ---- mailbox ----
const boxes = new Map(); // room -> Map(key -> value)
const waiters = new Map(); // room|key -> [resolve]
const room = (r) => (boxes.has(r) ? boxes.get(r) : boxes.set(r, new Map()).get(r));
function put(r, k, v) {
  room(r).set(k, v);
  for (const res of waiters.get(r + "|" + k) || []) res(v);
  waiters.delete(r + "|" + k);
}
function get(r, k, timeoutMs) {
  if (room(r).has(k)) return Promise.resolve(room(r).get(k));
  return new Promise((res) => {
    const list = waiters.get(r + "|" + k) || [];
    list.push(res);
    waiters.set(r + "|" + k, list);
    if (timeoutMs) setTimeout(() => res(undefined), timeoutMs);
  });
}
const localBox = (r) => ({ put: async (k, v) => put(r, k, v), get: (k) => get(r, k) });

// ---- daemon helpers ----
async function rpc(method, params = {}) {
  const r = await fetch(DAEMON + "/json_rpc", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "0", method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(method + ": " + JSON.stringify(j.error));
  return j.result;
}
const newWallet = () => moneroTs.createWalletFull({ networkType: moneroTs.MoneroNetworkType.MAINNET,
  password: "spike-password", server: { uri: DAEMON }, regtest: true, proxyToWorker: false });

// ---- results ----
const results = { session: SESSION, startedAt: new Date().toISOString(), devices: {}, steps: [], outcomes: [] };
const save = () => fs.writeFileSync(path.join(DIR, "results.json"), JSON.stringify(results, null, 2));

// ---- scenarios ----
let wallets;
async function setupChain() {
  const funder = await newWallet(), buyerRecv = await newWallet(), sellerRecv = await newWallet();
  const minerAddr = await funder.getPrimaryAddress();
  await rpc("generateblocks", { amount_of_blocks: 80, wallet_address: minerAddr });
  await funder.sync();
  console.log("funder unlocked:", fmt(await funder.getUnlockedBalance()), "XMR");
  wallets = { funder, buyerRecv, sellerRecv, minerAddr,
    buyerAddr: await buyerRecv.getPrimaryAddress(), sellerAddr: await sellerRecv.getPrimaryAddress() };
}

function plan() {
  return [
    { name: "1. Normal trade: seller + buyer release to buyer", signers: ["seller", "buyer"], to: wallets.buyerAddr, recv: "buyerRecv" },
    { name: "2. Mutual cancel: buyer + seller refund the seller", signers: ["buyer", "seller"], to: wallets.sellerAddr, recv: "sellerRecv" },
    { name: "3. Dispute won by buyer: moderator + buyer release to buyer", signers: ["mod", "buyer"], to: wallets.buyerAddr, recv: "buyerRecv" },
  ].map((s, i) => ({ ...s, id: i + 1, room: `${SESSION}-${i + 1}` }));
}

async function orchestrate() {
  for (const sc of plan()) {
    const r = sc.room;
    console.log(`\n${sc.name} (room ${r}) waiting for buyer and seller…`);
    const modRun = runEscrow({ moneroTs, role: "mod", box: localBox(r), daemonUri: DAEMON, scenario: sc,
      proxyToWorker: false, log: async (step, ms) => logStep({ scenario: sc.id, role: "mod", step, ms }) });
    modRun.catch((e) => console.error("moderator error:", e));
    const addrs = await Promise.all(ROLES.map((x) => get(r, "addr:" + x)));
    if (new Set(addrs).size !== 1) throw new Error("address mismatch");
    await wallets.funder.sync();
    await wallets.funder.createTx({ accountIndex: 0, address: addrs[0], amount: XMR, relay: true });
    // 12, not 10: with exactly 10 the wallets sometimes saw the funds one block short of unlocked.
    await rpc("generateblocks", { amount_of_blocks: 12, wallet_address: wallets.minerAddr });
    console.log("  funded escrow with 1 XMR and mined 12 blocks");
    put(r, "funded", "1");
    const hash = await get(r, "done");
    const target = wallets[sc.recv];
    await rpc("generateblocks", { amount_of_blocks: 11, wallet_address: wallets.minerAddr });
    await target.sync();
    // Count only what this release transaction paid to the recipient's wallet.
    const txs = await target.getTxs({ hash, isIncoming: true });
    const received = txs.reduce((sum, tx) => sum + (tx.getIncomingAmount() || 0n), 0n);
    console.log(`  recipient wallet height ${await target.getHeight()}, matching txs ${txs.length}`);
    const ok = received > XMR - XMR / 100n && received <= XMR;
    const outcome = { scenario: sc.id, name: sc.name, received: fmt(received), ok, tx: hash };
    results.outcomes.push(outcome); save();
    console.log(`  ${ok ? "PASS" : "FAIL"}: recipient got ${fmt(received)} XMR (tx ${hash.slice(0, 12)}…)`);
    put(r, "result", JSON.stringify(outcome));
    await modRun.catch(() => {});
  }
  console.log("\nALL SCENARIOS DONE");
}

function logStep(entry) {
  results.steps.push({ ...entry, at: new Date().toISOString() }); save();
  console.log(`  [s${entry.scenario}] ${entry.role.padEnd(6)} ${entry.step.padEnd(30)} ${String(entry.ms).padStart(7)} ms`);
}

// ---- http ----
const readBody = (req) => new Promise((res, rej) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => res(Buffer.concat(c))); req.on("error", rej); });
const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/client.js": ["dist/client.js", "text/javascript"],
  "/monero.worker.js": ["node_modules/monero-ts/dist/monero.worker.js", "text/javascript"],
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      return fs.createReadStream(path.join(DIR, file)).pipe(res);
    }
    // Monero's wallet code keeps only host:port of the node address, so node paths
    // (/json_rpc, /getblocks.bin, …) arrive at the root and are forwarded as-is.
    const DAEMON_PATH = /^\/(json_rpc|[a-z_]+\.bin|get_[a-z_]+|send_?raw_?transaction|is_key_image_spent|getheight|gettransactions|get_transaction_pool[a-z_]*)$/;
    if (DAEMON_PATH.test(url.pathname)) {
      const body = req.method === "POST" ? await readBody(req) : undefined;
      const r = await fetch(DAEMON + url.pathname + url.search,
        { method: req.method, body, headers: { "content-type": req.headers["content-type"] || "application/octet-stream" } });
      if (process.env.DEBUG_DAEMON) console.log(`  daemon ${req.method} ${url.pathname} ${req.headers["content-type"] || ""} -> ${r.status}`);
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/octet-stream" });
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    const m = url.pathname.match(/^\/box\/([\w-]+)\/(.+)$/);
    if (m) {
      const key = decodeURIComponent(m[2]);
      if (req.method === "POST") { put(m[1], key, (await readBody(req)).toString()); res.writeHead(204); return res.end(); }
      const v = await get(m[1], key, 20000);
      if (v === undefined) { res.writeHead(204); return res.end(); }
      res.writeHead(200, { "content-type": "text/plain" }); return res.end(v);
    }
    if (url.pathname === "/plan") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ session: SESSION, scenarios: plan().map(({ recv, ...s }) => s) }));
    }
    if (url.pathname === "/log" && req.method === "POST") {
      const e = JSON.parse((await readBody(req)).toString());
      if (e.device) { results.devices[e.role] = e.device; save(); console.log(`  ${e.role} joined: ${e.device.ua}`); }
      else logStep(e);
      res.writeHead(204); return res.end();
    }
    res.writeHead(404); res.end();
  } catch (e) {
    console.error("http error:", e.message);
    res.writeHead(500); res.end(String(e.message));
  }
});

await setupChain();
server.listen(PORT, "0.0.0.0", () => console.log(`test page: http://<laptop-ip>:${PORT}/  (session ${SESSION})`));
orchestrate().catch((e) => { console.error("ORCHESTRATION ERROR:", e); });
