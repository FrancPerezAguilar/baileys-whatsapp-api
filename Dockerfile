FROM node:20-alpine

WORKDIR /app

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++ git

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S appuser -u 1001

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code and scripts
COPY src/ ./src/
COPY docker-entrypoint.sh /docker-entrypoint.sh

# Create directories with correct ownership
RUN mkdir -p /app/auth /app/data /app/media /app/logs && \
    chown -R appuser:nodejs /app

# Make entrypoint executable
RUN chmod +x /docker-entrypoint.sh

# Switch to non-root user
USER appuser

# Expose ports
EXPOSE 3001 3002

# Use entrypoint to fix permissions on mounted volumes
ENTRYPOINT ["/docker-entrypoint.sh"]

# Run
CMD ["node", "src/index.js"]
