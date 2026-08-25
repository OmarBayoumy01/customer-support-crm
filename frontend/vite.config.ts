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

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Required in a container: Vite binds to localhost by default, and a
    // localhost binding inside a container is not reachable from the host.
    host: true,
    ...(usePolling ? { watch: { usePolling: true, interval: 300 } } : {}),
  },
});
