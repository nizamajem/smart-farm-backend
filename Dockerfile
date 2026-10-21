# ---------- build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Toolchain untuk kompilasi better-sqlite3 bila prebuilt binary tidak tersedia
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---------- runtime ----------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3001 \
    DB_PATH=/app/data/smartfarm.sqlite
WORKDIR /app
RUN npm install -g pm2@6 && mkdir -p /app/data && chown node:node /app/data
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ecosystem.config.js ./
COPY --chown=node:node scripts/backup-db.js ./scripts/backup-db.js
USER node
VOLUME ["/app/data"]
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pm2-runtime", "ecosystem.config.js"]
