// Plan 3 Task 31 (e2e only): loaded into the API process of the regtest stack (tools/regtest/e2e/stack.ts) with
// `node --import`, so the price feed reads fixed prices instead of the public exchanges: an e2e
// run never depends on the network, and every price is the same on every run (within a cent). Only the price and
// exchange-rate hosts are answered here; a loopback request (the stack's own services) goes to the
// real fetch, and every other host is refused, so nothing in the stack can reach the network. Never
// loaded outside that stack.
const BASE = Number(process.env.X2F_E2E_XMR_USD ?? '200');
// The feed calls a source frozen after 30 minutes of exactly the same price (price/feed.ts), and a
// run can last longer: each answer moves by one cent, back and forth.
let tick = 0;
const price = () => (BASE + (tick++ % 2) * 0.01).toFixed(2);
const real = globalThis.fetch;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
  const XMR_USD = price();
  switch (url.hostname) {
    case 'api.kraken.com':
      return json({ error: [], result: { XXMRZUSD: { c: [XMR_USD, '1'] }, XXMRZEUR: { c: [XMR_USD, '1'] } } });
    case 'api-pub.bitfinex.com':
      return json([['tXMRUSD', 0, 0, 0, 0, 0, 0, Number(XMR_USD), 0, 0, 0]]);
    case 'api.coingecko.com':
      if (url.pathname.endsWith('/exchange_rates')) return json({ rates: { usd: { value: 1, type: 'fiat' } } });
      return json({ monero: { usd: Number(XMR_USD), cad: Number(XMR_USD) * 1.4, eur: Number(XMR_USD), last_updated_at: Math.floor(Date.now() / 1000) } });
    case 'api.coinbase.com':
      return json({ data: { currency: 'USD', rates: { USD: '1', CAD: '1.4', EUR: '1', GBP: '0.8' } } });
    case 'bitpay.com':
      return json({ data: [] });
    default:
      if (LOOPBACK.has(url.hostname)) return real(input, init);
      throw new TypeError(`fixed-prices: ${url.hostname} is not loopback; an e2e stack never reaches the network`);
  }
};
