# Python Firehose Consumer - Optimized for high-performance async I/O
FROM python:3.12-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY firehose_consumer.py .

# Create non-root user
RUN useradd -m -u 1000 firehose && chown -R firehose:firehose /app
USER firehose

# Set environment variables (can be overridden in docker-compose)
ENV PYTHONUNBUFFERED=1
ENV RELAY_URL=wss://bsky.network
ENV REDIS_URL=redis://redis:6379
ENV REDIS_STREAM_KEY=firehose:events
ENV REDIS_CURSOR_KEY=firehose:python_cursor
ENV REDIS_MAX_STREAM_LEN=500000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python -c "import redis; r = redis.from_url('${REDIS_URL}'); r.ping()" || exit 1

# Run the consumer
CMD ["python", "-u", "firehose_consumer.py"]
