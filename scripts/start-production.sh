#!/bin/bash
# Production only runs the API server (status page backend).
# Discord/Telegram bots run as separate Replit workflows — running them here
# too would create duplicate bot instances with the same token → double responses.
exec node --enable-source-maps artifacts/api-server/dist/index.mjs
