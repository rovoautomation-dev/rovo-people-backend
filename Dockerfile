# ── Stage 1: deps ──────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy only manifest files first for better layer caching
COPY package.json package-lock.json ./

RUN npm ci --production

# ── Stage 2: runtime ───────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# Copy installed modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY . .

# Do NOT embed .env — it is injected at runtime via docker compose env_file
# Expose the API port
EXPOSE 5005

CMD ["node", "server.js"]
