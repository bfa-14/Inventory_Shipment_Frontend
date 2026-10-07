# Inventory & Shipment — Web (React + Vite + TypeScript)

The frontend for `Inventory_Shipment.API`. Open **this folder** in VS Code (`File → Open Folder…`).

## Requirements

- **Node.js 20.19+ or 22.12+** — check with `node --version`. (Download from https://nodejs.org if needed.)
- The **.NET 10 SDK**, so `npm run dev` can start the API. (Running it from Visual Studio instead is fine — use the **https** launch profile.)

## Running in development

Two processes have to be up: the **API** on `https://localhost:7089` and the **web dev server** on
`http://localhost:5174`. The dev server proxies `/api` and `/health` to the API, so the browser stays on one
origin.

```bash
npm run dev        # starts the API if it is not already up, then the web dev server
```

`npm run dev` probes `<VITE_API_PROXY_TARGET>/health` first:

- **answered** → prints `[dev] API already running ... - starting web only` and starts only Vite. This is the
  normal case when the API is already running from Visual Studio.
- **no answer** → runs `dotnet run --project ../Inventory_Shipment/Inventory_Shipment.API --launch-profile https`,
  streams its output prefixed `[api] `, waits for `/health` (up to 90 s), and only then starts Vite (`[web] `).
  If the API dies during start-up you get its exit code and the `[api] ` lines that explain why, and Vite is
  not started. `Ctrl+C` stops both.

| Command | What it does |
|---------|--------------|
| `npm run dev` | API (when needed) + web |
| `npm run dev:web` | Web only — use it when the API is already running from Visual Studio |
| `npm run dev:api` | API only, on the `https` profile |

### Ports

| Port | What |
|------|------|
| `7089` | API, HTTPS — what the proxy targets |
| `5121` | API, HTTP |
| `5174` | web dev server |

**Start the API on the `https` profile, not `IIS Express`.** The IIS Express profile binds `44395`/`49677`
instead, so the proxy finds nothing on `7089` and every API call fails. In Visual Studio pick the **https**
profile from the run-button dropdown (or press F5 with it selected).

To use a different API port, change it in `.env.development` — `npm run dev`, the proxy and the health probe
all read the same value:

```
VITE_API_PROXY_TARGET=https://localhost:7089
```

If the API lives somewhere other than `..\Inventory_Shipment\Inventory_Shipment.API`, point `API_PROJECT_DIR`
at it.

Sign in with the seeded administrator: **admin / Admin@12345**.

### When the API is not reachable

The proxy answers `503` with `code: "API_UNREACHABLE"` and the page shows *"The API is not reachable. Make sure
Inventory_Shipment.API is running (https://localhost:7089)."* — rather than the old bare `502`, which surfaced
as a generic "the server ran into a problem". The dev-server terminal prints the same thing in red.

`dotnet dev-certs https --trust` only matters for opening `https://localhost:7089/scalar` directly; the proxy
sets `secure: false` and does not care.

## How it talks to the API

In development the Vite dev server **proxies** `/api` and `/health` to the API (`vite.config.ts`), so the browser stays on a single origin: no CORS and no certificate warnings for the API's self-signed dev certificate. The target comes from `.env.development`:

```
VITE_API_PROXY_TARGET=https://localhost:7089
```

If the API runs on a different port, change it there. To call the API directly instead, set `VITE_API_BASE_URL` (the API's `Cors:AllowedOrigins` must then contain `http://localhost:5174`).

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the API (when it is not already up) and the web dev server |
| `npm run dev:web` | Web dev server only |
| `npm run dev:api` | API only, on the `https` profile |
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

`npm run build` writes static files to `dist/`. The app calls `/api` on its own origin (`VITE_API_BASE_URL` is
empty in `.env.production`), so it must be served behind the same address as the API.

That is what the `Dockerfile` here does: it builds `dist/` and serves it with [Caddy](https://caddyserver.com),
which also forwards `/api` and `/health` to the API and gets the HTTPS certificate (`Caddyfile`). The image is
built and run by `deploy/docker-compose.yml` in the **Inventory_Shipment** repository: see `deploy/README.md`
there to put the whole application on a server.
