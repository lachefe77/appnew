FROM node:24-alpine AS base
WORKDIR /app

# Install build deps for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public
COPY .env.example .env.example

# Data and logs dirs
RUN mkdir -p data logs

EXPOSE 3000

# Use node directly (PM2 optional for container — docker handles restart)
CMD ["node", "server/index.js"]
