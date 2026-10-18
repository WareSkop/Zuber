# ==============================================================================
# Stage 1: Build Frontend & Verify Types
# ==============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY shared ./shared
COPY src ./src
COPY server ./server

RUN npm run build

# ==============================================================================
# Stage 2: Production Runtime
# ==============================================================================
FROM node:22-alpine AS runner

RUN apk add --no-cache openssl wget git

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3443 \
    CONFIG_PATH=/data/config/server-config.json \
    VAULT_DIR=/data/vault \
    ENABLE_HTTPS=false \
    TRUST_PROXY=true \
    FORCE_AUTH=true \
    MAX_UPLOAD_MB=100

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY server ./server
COPY shared ./shared

RUN mkdir -p /data/vault /data/config /data/certs

EXPOSE 3443

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-check-certificate -qO- http://127.0.0.1:3443/api/auth/status || exit 1

CMD ["npx", "tsx", "server/index.ts"]
