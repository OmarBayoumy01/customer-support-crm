#!/usr/bin/env bash
#
# Brings the backend up inside Compose, in the order the pieces actually depend
# on each other. Written as a script rather than a long `command:` line in
# docker-compose.yml so each step can say why it is there.
set -euo pipefail

cd /app

echo "==> Generating the Prisma client"
# Not done at image build time: the schema arrives with the volume mount, and
# the generated client lands in the mounted source tree (where it is gitignored).
npm run prisma:generate --workspace @crm/backend

echo "==> Applying migrations"
# `deploy`, never `dev` — `migrate dev` is interactive and can offer to reset
# the database, which is not a thing an automated start should ever do.
npm run migrate:deploy --workspace @crm/backend

echo "==> Building once, so there is something to run"
# `--force`, and from the root rather than the workspace, for one reason:
# `dist/` is a container-local volume that starts empty, while `.tsbuildinfo`
# comes from the host bind mount and cheerfully reports everything as already
# built. Without `--force`, tsc trusts it, skips `@crm/shared`, and the backend
# then fails to compile against a package whose declarations were never emitted.
npx tsc -b backend --force

echo "==> Starting the TypeScript watcher"
# `dev:build:poll`, not `dev:build`. A bind mount from a Windows or macOS host
# does not deliver filesystem events into a Linux container, so an inotify-based
# watcher sits there seeing nothing while the developer wonders why their edit
# did nothing. Polling costs a little CPU and is the only thing that works
# across all three host operating systems. `--preserveWatchOutput` stops tsc
# clearing the screen on each rebuild, which in a Compose log would eat the
# other services' output.
npm run dev:build:poll --workspace @crm/backend &

echo "==> Starting the API with reload on rebuild"
# `node --watch` restarts when the compiled output under dist/ changes, so the
# chain is: source edit -> tsc rebuild -> process restart (AC2).
exec npm run dev --workspace @crm/backend
