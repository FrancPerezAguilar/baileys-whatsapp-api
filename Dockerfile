FROM node:20-alpine

WORKDIR /app

# Install sharp for QR code generation
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY src/ ./src/

# Create auth directory
RUN mkdir -p /app/auth

# Expose port
EXPOSE 3001

# Run
CMD ["node", "src/index.js"]
