import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default function setup(): void {
  execFileSync('bash', [fileURLToPath(new URL('./fetch-monerod.sh', import.meta.url))], { stdio: 'inherit' });
}
