import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The staff app (Plan 4 Task 16). Built on its own (`dist`) and served on the staff origin, whose
 * CSP is the staff API's STAFF_CSP (apps/api/src/staff/app.ts): Plan 3's policy without
 * 'wasm-unsafe-eval' and without the relay and node-proxy origins. Nothing is inlined (no data:
 * fonts or scripts), and no source maps ship.
 *
 * `vite` (dev) sends /staff/v1 to the staff API on X2F_STAFF_API (default http://127.0.0.1:8082)
 * so the cookie and the origin check see one origin.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: { '/staff/v1': { target: process.env.X2F_STAFF_API ?? 'http://127.0.0.1:8082', changeOrigin: false } },
  },
  build: { outDir: 'dist', assetsInlineLimit: 0, sourcemap: false },
});
