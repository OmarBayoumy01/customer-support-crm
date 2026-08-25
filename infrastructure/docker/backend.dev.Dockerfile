# Development image for the backend. NOT for production — P15 owns that.
#
# It deliberately contains no application source: `docker-compose.yml` mounts
# the repository over `/app`, which is what makes hot reload possible (AC2).
# The image exists to carry the toolchain and a populated `node_modules`.
FROM node:24.15.0-alpine

# `openssl` is required by Prisma; `bash` makes the entrypoint readable rather
# than contorted into POSIX sh; `curl` powers the healthcheck below.
RUN apk add --no-cache openssl bash curl

WORKDIR /app

# Copied first, and alone, so this layer is only rebuilt when a dependency
# changes — not on every source edit.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY packages/shared/package.json ./packages/shared/

# `--ignore-scripts` because `postinstall` runs `prisma generate`, and the
# schema is not in the image — it arrives with the volume mount at runtime.
# The entrypoint generates the client once the real source is there.
RUN npm ci --ignore-scripts

COPY infrastructure/docker/backend-dev-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3000/health > /dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
