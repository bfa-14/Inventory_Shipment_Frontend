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
src/auth/         session, AuthProvider, ProtectedRoute, useAuth().hasPermission(code)
src/hooks/        useGridQuery (server grids), useSeesItemCosts (script 94), the menu counts
public/templates/ the Excel templates the import pages offer for download
scripts/          dev.mjs (starts the API, then Vite) and tests/*.test.ts (node --test)
```

## Rules every page follows

- **Permissions decide the layout.** The page is routed behind `ProtectedRoute` with its permission, every button and
  row action is gated with `hasPermission(...)` (codes in `src/navigation.ts`), and a figure the reader may not see is
  decided by the permission, never by the data (`useSeesItemCosts()` for item costs). A button the user may not use
  *now* stays visible and **disabled with a tooltip saying why**; it is hidden only without the permission.
- **API messages are shown as they come** (`ApiError.message`, its `code` for the branches the page handles; a 409 says
  "Someone else changed … Reload the page."). The server's reasons for a disabled button come from the document's
  abilities, not from a rule re-written in the page.
- Lists are `PageHeader` + `FilterBar` + `DataTable` on `useGridQuery` (column chooser, funnels, CSV from the columns
  drawn); details in drawers; actions in `FormModal`s; `confirm` before anything destructive, `notify` after.
- Every page works at **1440 px and 390 px**. The checklist at the end of `docs/frontend-conventions.md` ("Checklist
  for a new page") is the definition of done.

## Checks before pushing

`npm run lint` (oxlint), `npm run typecheck`, `npm run test` (node's test runner over `scripts/tests/*.test.ts`; one
file: `node --test scripts/tests/trackingNumbers.test.ts`), `npm run build`.

`npm run dev` probes the API's `/health` first and starts it (`dotnet run`, the **https** profile on `7089`) only
when nothing answers, then Vite on `5174`, which proxies `/api` (README.md: ports, `.env.development`,
`VITE_API_PROXY_TARGET`). A stale API shows 404 / 405 on new endpoints: stop both and run `npm run dev` again.

## Production

Built into the `web` container (`Dockerfile`, `Caddyfile`) by `deploy/` in Inventory_Shipment. It serves the app
over HTTPS and forwards `/api` to the API, so the app always calls `/api` on its own origin.

## Working with the user

Short, plain English. For anything they run, say where: on their PC, on the server, or in the browser.
Commit messages end with `(prompt NN)` when the change belongs to a numbered prompt.
