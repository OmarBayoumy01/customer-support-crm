# Development image for the frontend. NOT for production — P15 owns that.
#
# As with the backend image, it carries the toolchain and `node_modules` only;
# the source arrives as a volume mount so Vite's HMR has something to watch.
FROM node:24.15.0-alpine

RUN apk add --no-cache bash curl

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY packages/shared/package.json ./packages/shared/

RUN npm ci --ignore-scripts

COPY infrastructure/docker/frontend-dev-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 5173

HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -fsS http://127.0.0.1:5173/ > /dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
