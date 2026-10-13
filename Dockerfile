# The MIMS app image, used by docker-compose.yml. The React pages are built in a first stage, then copied into a small
# Node.js image that runs the Express API and serves those pages on the same port (3001 inside the container).

# Stage 1: build the frontend into /build/dist
FROM node:24-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# Stage 2: the backend, which also serves the built pages. Only the backend's own packages are installed here.
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY backend/src ./src
COPY --from=frontend /build/dist ./public

# The database settings (DB_HOST, DB_PASSWORD, ...) come from docker-compose.yml, so the image holds no password.
ENV STATIC_DIR=/app/public \
    PORT=3001
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s \
    CMD wget -qO- http://127.0.0.1:3001/api/health > /dev/null || exit 1
CMD ["node", "src/server.js"]
