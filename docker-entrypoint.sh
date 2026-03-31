#!/bin/sh
set -e

# Create directories with correct permissions for appuser (uid 1001)
mkdir -p /app/auth /app/data /app/media /app/logs

# Fix ownership if running as root
if [ "$(id -u)" = "0" ]; then
    chown -R appuser:nodejs /app/auth /app/data /app/media /app/logs
fi

# Execute the main command
exec "$@"