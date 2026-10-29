// THROWAWAY Phase 0 spike: browser side (buyer on the laptop, seller on the phone).
import moneroTs from "monero-ts";
import { runEscrow, mailbox } from "./escrow.mjs";

const $ = (id) => document.getElementById(id);
const role = new URLSearchParams(location.search).get("role");

async function post(body) {
  await fetch("/log", { method: "POST", body: JSON.stringify(body) });
}

function row(scenario, step, ms) {
  const tr = document.createElement("tr");
  for (const [text, cls] of [[scenario, ""], [step, ""], [(ms / 1000).toFixed(1) + " s", "num"]]) {
    const td = document.createElement("td");
    td.textContent = String(text);
    if (cls) td.className = cls;
    tr.appendChild(td);
  }
  $("log").appendChild(tr);
}

async function main() {
  if (role !== "buyer" && role !== "seller") return;
  $("pick").hidden = true;
  $("run").hidden = false;
  $("who").textContent = role === "buyer" ? "Buyer" : "Seller";
  const device = { ua: navigator.userAgent, cores: navigator.hardwareConcurrency, memoryGb: navigator.deviceMemory ?? null,
    secureContext: window.isSecureContext };
  await post({ role, device });
  const { scenarios } = await (await fetch("/plan")).json();
  for (const sc of scenarios) {
    $("status").textContent = `Running ${sc.name}…`;
    const t0 = performance.now();
    try {
      const result = JSON.parse(await runEscrow({
        moneroTs, role, scenario: sc, proxyToWorker: true,
        box: mailbox(location.origin, sc.room),
        daemonUri: location.origin,
        log: async (step, ms) => { row(sc.id, step, ms); await post({ scenario: sc.id, role, step, ms }); },
      }));
      row(sc.id, `${result.ok ? "PASS" : "FAIL"}: recipient got ${result.received} XMR`, performance.now() - t0);
    } catch (e) {
      $("status").textContent = "Error: " + e.message;
      await post({ scenario: sc.id, role, step: "ERROR " + e.message, ms: 0 });
      return;
    }
  }
  $("status").textContent = "All done. You can close this page.";
}

$("deeplink").addEventListener("submit", (e) => {
  e.preventDefault();
  const addr = $("addr").value.trim();
  if (!addr) return;
  location.href = `monero:${addr}?tx_amount=0.0001&tx_description=X2F%20link%20test`;
});

main().catch((e) => { $("status").textContent = "Error: " + e.message; });
