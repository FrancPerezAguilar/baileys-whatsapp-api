FROM node:20-alpine

WORKDIR /app

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY src/ ./src/

# Create directories
RUN mkdir -p /app/auth /app/data /app/media /app/logs

# Expose ports
EXPOSE 3001 3002

# Run
CMD ["node", "src/index.js"]
