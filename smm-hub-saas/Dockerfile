# ---- Build stage ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build:assets && npm prune --omit=dev --ignore-scripts

# ---- Runtime stage ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV DB_PATH=/app/data/data.sqlite
RUN apk add --no-cache tini && addgroup -S smm && adduser -S smm -G smm

COPY --from=builder /app/node_modules ./node_modules
COPY --chown=smm:smm . .
COPY --from=builder --chown=smm:smm /app/public/vendor ./public/vendor

RUN mkdir -p /app/data /app/backups && chown -R smm:smm /app/data /app/backups
VOLUME ["/app/data", "/app/backups"]

USER smm
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -q --spider http://localhost:3000/health || exit 1

CMD ["node", "server/index.js"]
