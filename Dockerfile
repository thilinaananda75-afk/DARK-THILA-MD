# ── Base ──────────────────────────────────────────────────────────
FROM node:20-bookworm-slim

# ── System tools ──────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ── App directory ─────────────────────────────────────────────────
WORKDIR /app

# ── Install dependencies ──────────────────────────────────────────
COPY package.json ./
RUN npm install --legacy-peer-deps --omit=dev

# ── Copy source ───────────────────────────────────────────────────
COPY . .

# ── Session directory ─────────────────────────────────────────────
RUN mkdir -p /app/session

# ── Port ──────────────────────────────────────────────────────────
EXPOSE 8000

# ── Health check ─────────────────────────────────────────────────
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:${PORT:-8000}/healthz || exit 1

# ── Start ─────────────────────────────────────────────────────────
CMD ["node", "server/index.js"]
