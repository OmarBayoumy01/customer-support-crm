/// <reference types="vitest/config" />
import type { IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';

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

/**
 * Every path prefix the browser calls the API on.
 *
 * **A prefix missing from here does not fail loudly.** Vite falls through to
 * the SPA, so a GET is answered with `index.html` at status 200 and a POST with
 * a 404 — the client then fails on JSON that is really a web page. That is how
 * the whole customer portal came to be unreachable in the browser while every
 * test passed: jsdom tests stub the axios adapter and never touch this proxy.
 *
 * `bypass` is needed for any prefix that is **also a frontend route**:
 * `/tickets`, `/customers` and `/portal` are all pages as well as endpoints, so
 * an HTML navigation must be served by the SPA while XHR is proxied. The
 * `accept` header is what tells them apart.
 *
 * `frontend/src/lib/dev-proxy.test.ts` checks this list against the prefixes the
 * client actually calls.
 */
const API_PREFIXES = [
  { path: '/auth', isAlsoARoute: false },
  { path: '/health', isAlsoARoute: false },
  { path: '/tickets', isAlsoARoute: true },
  { path: '/customers', isAlsoARoute: true },
  { path: '/categories', isAlsoARoute: false },
  { path: '/portal', isAlsoARoute: true },
] as const;

/** The proxy table, built from the list above so the two cannot drift. */
const apiProxy: Record<string, ProxyOptions> = Object.fromEntries(
  API_PREFIXES.map(({ path, isAlsoARoute }) => {
    const options: ProxyOptions = { target: apiTarget, changeOrigin: false };

    if (isAlsoARoute) {
      options.bypass = (req: IncomingMessage): string | undefined =>
        req.headers.accept?.includes('text/html') === true ? '/index.html' : undefined;
    }

    return [path, options];
  }),
);

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
    proxy: apiProxy,
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
