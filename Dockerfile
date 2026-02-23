# ── Base ──────────────────────────────────────────────────────────
FROM node:20-bookworm-slim

# ── System tools ──────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    git \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# ── CRITICAL: Force git to use HTTPS instead of SSH ───────────────
# Baileys depends on libsignal-node via ssh://git@github.com — this fixes it
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" && \
    git config --global url."https://github.com/".insteadOf "git@github.com:"

# ── App directory ─────────────────────────────────────────────────
WORKDIR /app

# ── Install dependencies ──────────────────────────────────────────
COPY package.json .npmrc* ./
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
