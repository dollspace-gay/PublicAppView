# Multi-stage build for production-ready AT Protocol AppView
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy application source
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Add drizzle-kit for runtime migrations (pinned version for stability)
RUN npm install drizzle-kit@0.31.4

# Install PM2 globally for cluster mode
RUN npm install -g pm2

# Copy built application from builder (includes both server and frontend)
# Note: Vite builds frontend to dist/public, backend builds to dist/index.js
COPY --from=builder /app/dist ./dist

# Copy necessary config files
COPY drizzle.config.ts ./
COPY shared ./shared

# Set production environment
ENV NODE_ENV=production

# Configuration defaults (can be overridden in docker-compose.yml or at runtime)
ENV RELAY_URL=wss://bsky.network
ENV REDIS_URL=redis://localhost:6379
ENV PORT=5000
ENV APPVIEW_DID=did:web:appview.local
ENV DATA_RETENTION_DAYS=0
ENV DB_POOL_SIZE=32
ENV MAX_CONCURRENT_OPS=80
ENV NODE_OPTIONS="--max-old-space-size=2048"

# Expose port
EXPOSE 5000

# Health check using the /health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run database migrations and start the application with PM2 cluster mode
# Optimized for 47GB RAM VPS: 32 workers × 2GB heap = 64GB target (leaves room for OS/PostgreSQL)
# Each worker runs 5 parallel pipelines × 300 events/batch for maximum throughput
CMD ["sh", "-c", "npm run db:push && pm2-runtime start dist/index.js -i 32 --name bluesky-app --max-memory-restart 2G"]
