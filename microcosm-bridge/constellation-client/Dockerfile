FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Remove dev dependencies and source
RUN npm prune --production && \
    rm -rf src tsconfig.json

# Run as non-root user
USER node

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3003/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

EXPOSE 3003

CMD ["node", "dist/index.js"]
