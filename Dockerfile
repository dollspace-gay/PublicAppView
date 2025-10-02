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

# Copy built application from builder (includes both server and frontend)
# Note: Vite builds frontend to dist/public, backend builds to dist/index.js
COPY --from=builder /app/dist ./dist

# Copy necessary config files
COPY drizzle.config.ts ./
COPY shared ./shared

# Set production environment
ENV NODE_ENV=production

# Expose port
EXPOSE 5000

# Health check using the /health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run database migrations and start the application
CMD ["sh", "-c", "npm run db:push && node dist/index.js"]
