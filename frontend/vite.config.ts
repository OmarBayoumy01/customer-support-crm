/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Polling is opt-in via the environment rather than always on.
 *
 * A bind mount from a Windows or macOS host does not deliver filesystem events
 * into a Linux container, so inside Compose an inotify-based watcher never
 * fires and hot reload silently does nothing. Polling is the only thing that
 * works across all three host operating systems — and it burns CPU, so it stays
 * off for the ordinary case of running Vite directly on the host.
 *
 * `docker-compose.yml` sets `VITE_USE_POLLING=true`.
 */
const usePolling = process.env['VITE_USE_POLLING'] === 'true';

/** Where the API lives during development. Overridable for a split deployment. */
const apiTarget = process.env['VITE_API_PROXY_TARGET'] ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Matches `paths` in tsconfig.json. shadcn/ui's generated components import
    // through this alias, so both the compiler and the bundler have to know it.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    // Required in a container: Vite binds to localhost by default, and a
    // localhost binding inside a container is not reachable from the host.
    host: true,
    /**
     * The API is proxied rather than called cross-origin so that the refresh
     * cookie is **same-site** in development. `SameSite=Strict` means a
     * cross-origin call from :5173 to :3000 would simply not carry it, and
     * login would appear to work while silently issuing no usable session —
     * which is a miserable thing to debug.
     */
    proxy: {
      '/auth': { target: apiTarget, changeOrigin: false },
      '/health': { target: apiTarget, changeOrigin: false },
    },
    ...(usePolling ? { watch: { usePolling: true, interval: 300 } } : {}),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    /**
     * Sources only.
     *
     * `tsc -b` emits compiled `.test.js` files into `.tsbuild/`, and Vitest's
     * default pattern happily collects those too — so every test ran twice, the
     * second time against whatever the last build produced. A stale copy of a
     * test passing (or failing) is worse than not running it.
     */
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', '.tsbuild/**', 'dist/**'],
  },
});
