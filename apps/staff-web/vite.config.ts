import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/**
 * The staff app (Plan 4 Task 16). Built on its own (`dist`) and served on the staff origin, whose
 * CSP is the staff API's STAFF_CSP (apps/api/src/staff/app.ts): Plan 3's policy without the relay
 * and node-proxy origins ('wasm-unsafe-eval' only for libsodium, lead call 18 Nov). Nothing is inlined (no data:
 * fonts or scripts), and no source maps ship.
 *
 * `vite` (dev) sends /staff/v1 to the staff API on X2F_STAFF_API (default http://127.0.0.1:8082)
 * so the cookie and the origin check see one origin.
 *
 * Design build task 9: a production build pins the moderation signing key, VITE_MOD_SIGNING_PUBLIC
 * (64 lower-case hex, the public half of MOD_SIGNING_SECRET, as the trader app pins it). ModCase
 * checks every disputed chat's attestation against it, so a build without it could open no chat:
 * `checkBuildEnv` fails the production build instead (docs/coordination.md, staff-web).
 */
const HEX64 = /^[0-9a-f]{64}$/;

/** Throws when a production build lacks a value the staff app needs at build time. */
export function checkBuildEnv(mode: string, env: Readonly<Record<string, string | undefined>>): void {
  if (mode !== 'production') return;
  const v = env.VITE_MOD_SIGNING_PUBLIC;
  if (v === undefined || v === '') {
    throw new Error('staff-web: VITE_MOD_SIGNING_PUBLIC must be set for a production build (the moderation signing public key, 64 hex); see docs/coordination.md');
  }
  if (!HEX64.test(v)) throw new Error('staff-web: VITE_MOD_SIGNING_PUBLIC must be 64 lower-case hex characters (the moderation signing public key)');
}

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  // The same values Vite itself gives import.meta.env: .env files here, then the process's own.
  checkBuildEnv(mode, loadEnv(mode, here, 'VITE_'));
  return {
    plugins: [react()],
    server: {
      port: 5174,
      strictPort: true,
      proxy: { '/staff/v1': { target: process.env.X2F_STAFF_API ?? 'http://127.0.0.1:8082', changeOrigin: false } },
    },
    build: { outDir: 'dist', assetsInlineLimit: 0, sourcemap: false },
  };
});
