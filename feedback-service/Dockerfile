# syntax=docker.io/docker/dockerfile:1

FROM oven/bun:1-alpine AS base
WORKDIR /app

# Dependencies
FROM base AS deps
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production

# Build
FROM base AS build
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ ./src/
# Bun can run TypeScript directly, no build step needed

# Runtime
FROM base
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["bun", "run", "src/index.ts"]
