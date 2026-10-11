# syntax=docker/dockerfile:1

# The web container: the built React app served by Caddy over plain HTTP on port 8080 (see Caddyfile),
# which also forwards /api and /health to the API. HTTPS and the public address belong to the proxy in
# Inventory_Shipment/deploy (deploy/README.md there).

FROM node:22-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# .env.production leaves VITE_API_BASE_URL empty: the app calls /api on its own origin, i.e. Caddy.
RUN npm run build

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/dist /srv
