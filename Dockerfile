# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
# better-sqlite3 อาจต้อง compile เองถ้าไม่มี prebuilt สำหรับ platform นี้
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ARG ALICE_VERSION=dev
ARG ALICE_REVISION=unknown
LABEL org.opencontainers.image.title="Alice" \
      org.opencontainers.image.description="Self-hosted taskboard for humans and AI agents" \
      org.opencontainers.image.source="https://github.com/KamolpopKK/alice" \
      org.opencontainers.image.licenses="AGPL-3.0" \
      org.opencontainers.image.version="${ALICE_VERSION}" \
      org.opencontainers.image.revision="${ALICE_REVISION}"
ENV NODE_ENV=production \
    ALICE_DATA_DIR=/data \
    ALICE_HOST=0.0.0.0 \
    ALICE_PORT=8080
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/skill ./skill
RUN mkdir -p /data && chown node:node /data && ln -s /app/dist/alice-server.js /usr/local/bin/alice-server && ln -s /app/dist/alice.js /usr/local/bin/alice && chmod +x /app/dist/*.js
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/alice-server.js", "serve"]
