# ── Stage 1: Dependencies ─────────────────────────────────────────
FROM node:20-slim AS deps
WORKDIR /app

# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Enable Corepack for Yarn
RUN corepack enable

# Copy package manifests
COPY package.json yarn.lock* ./

# Override .yarnrc.yml for Docker context (platform paths don't exist here)
RUN echo 'nodeLinker: node-modules' > .yarnrc.yml

# Install all dependencies (including devDependencies for build)
RUN yarn install

# ── Stage 2: Build ────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable

# Copy deps from previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/.yarnrc.yml ./.yarnrc.yml

# Copy source
COPY . .

# Fix Prisma schema for Docker context:
# 1. Remove hardcoded output path (use default node_modules/.prisma/client)
# 2. Add debian-openssl binary target for this runtime
RUN sed -i '/output = /d' prisma/schema.prisma && \
    sed -i 's/binaryTargets = .*/binaryTargets = ["native", "debian-openssl-3.0.x"]/' prisma/schema.prisma

# Generate Prisma client
RUN yarn prisma generate

# Build Next.js in standalone mode
ENV NEXT_OUTPUT_MODE=standalone
ENV NEXT_DIST_DIR=.next
ENV NEXT_TELEMETRY_DISABLED=1
# Provide build-time placeholder for NEXTAUTH_URL (overridden at runtime)
ENV NEXTAUTH_URL=http://localhost:3000
RUN yarn build

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

# Copy Prisma schema + generated client for runtime
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
