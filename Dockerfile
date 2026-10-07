# syntax=docker/dockerfile:1

# The web container: the built React app served by Caddy, which also forwards /api and /health to
# the API container and gets the HTTPS certificate. See Caddyfile, and deploy/README.md in the
# Inventory_Shipment repository for the whole stack.

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
