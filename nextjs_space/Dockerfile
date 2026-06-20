# ── Stage 1: Dependencies ─────────────────────────────────────────
FROM node:20-slim AS deps
WORKDIR /app

# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copy package manifest only (no lockfile — generate fresh)
COPY package.json ./

# Install all dependencies (including devDependencies for build)
RUN npm install

# ── Stage 2: Build ────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copy deps from previous stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source
COPY . .

# Fix Prisma schema for Docker context:
# 1. Remove hardcoded output path (use default node_modules/.prisma/client)
# 2. Add debian-openssl binary target for this runtime
RUN sed -i '/output = /d' prisma/schema.prisma && \
    sed -i 's/binaryTargets = .*/binaryTargets = ["native", "debian-openssl-3.0.x"]/' prisma/schema.prisma

# Remove outputFileTracingRoot (only needed for Abacus platform builds;
# in Docker it resolves to "/" and nests server.js under .next/standalone/app/)
RUN sed -i '/outputFileTracingRoot/d' next.config.js

# Generate Prisma client
RUN npx prisma generate

# Build Next.js in standalone mode
ENV NEXT_OUTPUT_MODE=standalone
ENV NEXT_DIST_DIR=.next
ENV NEXT_TELEMETRY_DISABLED=1
# Provide build-time placeholder for NEXTAUTH_URL (overridden at runtime)
ENV NEXTAUTH_URL=http://localhost:3000
RUN npm run build

# ── Stage 3: Production runner ────────────────────────────────────
FROM node:20-slim AS runner
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone output + static assets + public files
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy Prisma schema + generated client + CLI for runtime migrations
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/prisma ./prisma

# Entrypoint: push schema then start server
RUN printf '#!/bin/sh\nset -e\necho "[entrypoint] Running prisma db push..."\nnode node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss 2>&1 || echo "[entrypoint] prisma db push failed (non-fatal)"\necho "[entrypoint] Starting server..."\nexec node server.js\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

USER nextjs
EXPOSE 3000

CMD ["/app/entrypoint.sh"]
