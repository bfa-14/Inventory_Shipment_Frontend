# Inventory & Shipment — Web (React + Vite + TypeScript)

The frontend for `Inventory_Shipment.API`. Open **this folder** in VS Code (`File → Open Folder…`).

## Requirements

- **Node.js 20.19+ or 22.12+** — check with `node --version`. (Download from https://nodejs.org if needed.)
- The API running from Visual Studio (F5 on `Inventory_Shipment.API`, which opens the Scalar docs at `https://localhost:7089/scalar/`).

## Run it

```bash
npm install      # first time only
npm run dev      # http://localhost:5173
```

or press **F5** in VS Code (`Run in Edge` / `Run in Chrome`) — it starts the dev server and opens the browser.

Sign in with the seeded administrator: **admin / Admin@12345** (change it on the dashboard).

## How it talks to the API

In development the Vite dev server **proxies** `/api` and `/health` to the API (`vite.config.ts`), so the browser stays on a single origin: no CORS and no certificate warnings for the API's self-signed dev certificate. The target comes from `.env.development`:

```
VITE_API_PROXY_TARGET=https://localhost:7089
```

If the API runs on a different port, change it there. To call the API directly instead, set `VITE_API_BASE_URL` (the API's `Cors:AllowedOrigins` must then contain `http://localhost:5173`).

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build locally (port 4173) |
| `npm run typecheck` | Type-check only |
| `npm run lint` | Lint with oxlint |

## Project layout

```
src/
  api/          typed fetch client (bearer token, automatic refresh on 401, ProblemDetails errors)
    http.ts     request() + ApiError
    auth.ts     login / refresh / logout / me / change-password
    users.ts    admin user management
    types.ts    DTOs mirrored from Inventory_Shipment.Model
  auth/         session state
    AuthProvider.tsx   holds tokens + user, restores the session on reload, single-flight refresh
    ProtectedRoute.tsx route guard (optionally by role)
    session.ts         sessionStorage persistence
  components/   Layout (top bar + nav), Alert, formatting helpers
  pages/        LoginPage, DashboardPage (profile, token actions, change password), UsersPage (Admin)
  App.tsx       routes:  /login  ·  /  (dashboard)  ·  /users (Admin only)
```

## Auth flow

1. `POST /api/auth/login` → access token (15 min) + refresh token (7 days) + user profile.
2. Every request sends `Authorization: Bearer <accessToken>`.
3. On the first `401`, the client calls `POST /api/auth/refresh` once (rotating the refresh token) and replays the request; if that fails the user is sent back to `/login`.
4. `Sign out` revokes the refresh token; `Sign out everywhere` revokes all of the user's tokens.

Tokens are kept in `sessionStorage` (cleared when the tab closes). For a hardened production setup, keep the access token in memory only and let the API issue the refresh token as an `HttpOnly` cookie.

## Production build

`npm run build` writes static files to `dist/`. Host them behind the same reverse proxy as the API (so `/api` is same-origin), or set `VITE_API_BASE_URL` in `.env.production` to the API's public URL and add that site to the API's `Cors:AllowedOrigins`.
