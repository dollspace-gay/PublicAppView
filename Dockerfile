FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy application code
COPY . .

# Build the application (requires dev dependencies like esbuild, vite, etc.)
RUN npm run build

# Expose port
EXPOSE 5000

# Start the application (migrations run before pruning dev deps)
# Note: Keeping drizzle-kit in the image for runtime migrations
CMD ["sh", "-c", "npm run db:push && npm start"]
