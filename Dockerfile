FROM node:20-alpine

WORKDIR /app

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S appuser -u 1001

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY src/ ./src/

# Create directories and set ownership
RUN mkdir -p /app/auth /app/data /app/media /app/logs && \
    chown -R appuser:nodejs /app

# Switch to non-root user
USER appuser

# Expose ports
EXPOSE 3001 3002

# Run
CMD ["node", "src/index.js"]
