#!/usr/bin/env bash
set -euo pipefail

cd /app

echo "==> Building @crm/shared, which the app imports"
# The frontend imports `@crm/shared` by its built output, so the package has to
# be compiled before Vite can resolve it on a cold start.
npm run build --workspace @crm/shared

echo "==> Starting Vite"
# `--host 0.0.0.0` is required: Vite binds to localhost by default, and a
# localhost binding inside a container is not reachable from the host.
exec npm run dev --workspace @crm/frontend -- --host 0.0.0.0
