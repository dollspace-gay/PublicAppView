# Multi-stage build for a lean, production-ready AT Protocol AppView

# Stage 1: Builder
# This stage installs all dependencies (including dev) and builds the application.
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files and install all dependencies
COPY package*.json ./
RUN npm ci

# Copy the rest of the application source code
COPY . .

# Build both the frontend (vite) and backend (esbuild)
RUN npm run build

# Stage 2: Production
# This stage creates the final, lean image with only what's needed for production.
FROM node:20-slim

WORKDIR /app

# Copy package files and install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Install drizzle-kit and typescript for runtime migrations.
# These are dev dependencies but are needed by the entrypoint script.
RUN npm install drizzle-kit@0.31.4 typescript

# Install PM2 globally for cluster mode
RUN npm install -g pm2

# Copy the built application from the builder stage
COPY --from=builder /app/dist ./dist

# Copy configuration files needed for runtime database migrations
COPY drizzle.config.ts ./
COPY tsconfig.json ./
COPY shared ./shared

# Copy and make the entrypoint script executable
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

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

# Run the application using the entrypoint script, which handles migrations
CMD ["./docker-entrypoint.sh"]