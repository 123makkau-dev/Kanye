#!/bin/bash
# Start the Discord bot in the background
node discord-bot/index.js &

# Start the API server as the main foreground process (keeps the container alive)
exec node --enable-source-maps artifacts/api-server/dist/index.mjs
