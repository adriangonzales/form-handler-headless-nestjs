# One image for the app (`node dist/main.js`) and the worker (`node dist/worker.js`).
# Migrations run as a release step: `npm run migration:run` (ch. 1 §1.7).

FROM node:22-bookworm-slim AS build
WORKDIR /app
# Native modules (bcrypt, better-sqlite3) fall back to compiling without prebuilds.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production TZ=UTC PORT=8000
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p storage/app/private && chown -R node:node storage
USER node
EXPOSE 8000
CMD ["node", "dist/main.js"]
