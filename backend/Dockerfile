FROM node:20-alpine AS builder
WORKDIR /app

# Install only backend dependencies
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY shared/package*.json ./shared/

RUN npm ci --workspace=backend --workspace=shared

COPY backend/ ./backend/
COPY shared/ ./shared/

RUN npm run build --workspace=backend

# ── Runtime image ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/node_modules ./node_modules
COPY --from=builder /app/backend/package.json ./package.json

ENV NODE_ENV=production

EXPOSE 3000
CMD ["node", "dist/index.js"]
