/** DEMO ONLY: `npm run demo:code [login name]`: the demo accounts' current authenticator codes. */
import { readTotpSecrets, stepOf, totpCode } from './totp.js';

const secrets = readTotpSecrets();
const want = process.argv[2];
const names = Object.keys(secrets).filter((n) => want === undefined || n === want);
if (names.length === 0) {
  console.error(want ? `demo: no demo account with login name ${want}` : 'demo: no codes (is the demo running? npm run demo)');
  process.exit(1);
}
const now = Date.now();
const left = 30 - Math.floor((now / 1000) % 30);
for (const n of names) console.log(`${n.padEnd(16)} ${totpCode(secrets[n]!, stepOf(now))}`);
console.log(`(new codes in ${left} s; each code works once)`);
