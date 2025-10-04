FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Create data directory for cursor file
RUN mkdir -p /data

# Expose health check port (optional)
EXPOSE 9090

# Run the bridge
CMD ["npm", "start"]
