# Inventory & Shipment Web - notes for Claude

The React app (Vite, TypeScript, Mantine, mantine-datatable, react-router) of the Inventory & Shipment ERP.
The API, the database and the deployment are in **bfa-14/Inventory_Shipment**, usually checked out next to this
folder (`../Inventory_Shipment`).

## Read first

- **The business** (company, glossary, modules and flows, business rules, numbered prompts, how prompts are
  written): `docs/business-context.md` in **Inventory_Shipment**, and that repository's `CLAUDE.md` for how a
  change is made end to end (database script -> API -> this app).
- **UI rules**: `docs/frontend-conventions.md` here: grids, column filters, modals and the keyboard, document
  pages, numbers, import wizards. Read the section for what you are building before you build it, and add a
  section when you introduce a new pattern.

## Layout

```
src/api/          typed client per module (http.ts: bearer token, refresh on 401, ProblemDetails -> ApiError)
src/pages/        one folder per module (inventory, purchase, logistics, sales, masterdata, security,
                  configuration, public = the emailed approval page)
src/components/   shared UI (components/ui: grid, filters, modals), per-module components, RequirePermission
src/navigation.ts the menu, each item guarded by a permission code
src/auth/         session, AuthProvider, ProtectedRoute
```

## Checks before pushing

`npm run lint`, `npm run typecheck`, `npm run build`. `npm run dev` starts the API too (see README.md).

## Production

Built into the `web` container (`Dockerfile`, `Caddyfile`) by `deploy/` in Inventory_Shipment. It serves the app
over HTTPS and forwards `/api` to the API, so the app always calls `/api` on its own origin.

## Working with the user

Short, plain English. For anything they run, say where: on their PC, on the server, or in the browser.
Commit messages end with `(prompt NN)` when the change belongs to a numbered prompt.
