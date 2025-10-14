# Constellation - Local AT Protocol Backlink Index
# Multi-stage build for optimal image size

# Stage 1: Build the Rust binary
FROM rust:1.75-slim as builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    git \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /build

# Clone microcosm-rs repository
# We'll use a specific commit/tag for stability
ARG CONSTELLATION_VERSION=main
RUN git clone https://tangled.org/@microcosm.blue/microcosm-rs.git . && \
    git checkout ${CONSTELLATION_VERSION}

# Build only the constellation binary
WORKDIR /build/constellation
RUN cargo build --release --bin constellation

# Stage 2: Runtime image
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -u 1000 constellation

# Create data directory
RUN mkdir -p /data && chown constellation:constellation /data

# Copy binary from builder
COPY --from=builder /build/constellation/target/release/constellation /usr/local/bin/

# Set user
USER constellation

# Set working directory
WORKDIR /data

# Expose API port (default 8080)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8080/ || exit 1

# Default command
# Users can override JETSTREAM_URL and other settings via environment variables
CMD ["constellation", \
    "--jetstream", "${JETSTREAM_URL:-wss://jetstream2.us-east.bsky.network/subscribe}", \
    "--data", "/data", \
    "--bind", "0.0.0.0:8080"]
