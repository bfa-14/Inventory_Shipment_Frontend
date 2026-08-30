# Frontend conventions

How every screen in `Inventory_Shipment.Web` is built. New pages follow this file; prompts reference it
instead of repeating the rules.

## Stack

| Concern | Package |
|---|---|
| UI components | `@mantine/core` 9.5 (+ `@mantine/hooks`) |
| Grids | `mantine-datatable` |
| Forms and validation | `@mantine/form` |
| Toasts | `@mantine/notifications` |
| Confirmations | `@mantine/modals` |
| Dates | `@mantine/dates` + `dayjs` |
| Icons | `@tabler/icons-react` |

`postcss.config.cjs` runs `postcss-preset-mantine` and `postcss-simple-vars` (breakpoints xs 36em, sm 48em,
md 62em, lg 75em, xl 88em). `src/main.tsx` imports the stylesheets in this order and wraps the router in
`MantineProvider` → `Notifications` (top-right) → `ModalsProvider`:

```
@mantine/core/styles.css → @mantine/notifications/styles.css → @mantine/dates/styles.css
→ mantine-datatable/styles.layer.css → src/index.css → src/styles/app.css
```

The app is **light-only** (`defaultColorScheme="light"`, `forceColorScheme="light"`).

### The sign-in screen is the exception

`src/pages/LoginPage.tsx`, its CSS in `src/index.css` and the images in `src/assets` are a
customer-approved design that must not be restyled.

Its **controls are Mantine** like everywhere else (`TextInput`, `PasswordInput`, `Button`, `Alert`) — what is
exceptional is the **paint**. Every rule that decides how the screen looks lives in `src/index.css` under
`.login-field` / `.login-input` / `.login-submit` / `.login-alert`, and `src/main.tsx` loads that file **after**
`@mantine/core/styles.css`, so those rules win the specificity ties against Mantine's own. Change the look
there, never with inline styles on the page. Two details worth knowing before editing it:

- `PasswordInput` renders the visible box as its `input` slot and the real `<input>` as `innerInput`; the
  box is what carries the border, height and radius.
- its reveal toggle fires on `mousedown`, not `click` — a test that calls `element.click()` will see nothing
  happen and wrongly report a regression.

## Theme (`src/theme.ts`)

- `brand` colour tuple built around **#2563EB**, `primaryColor: 'brand'`, `primaryShade: 6`.
- `defaultRadius: 'md'`, `fontFamily: '"Segoe UI", Inter, system-ui, sans-serif'`, headings `fontWeight: 700`.
- Component defaults: Button/TextInput/Textarea/Select/NumberInput/PasswordInput radius `md`, Paper radius
  `lg`, Modal radius `lg` + centered + overlay blur 2, Badge radius `xl`, Table `highlightOnHover`.
- `CONTENT_BG` (`#EDF1F9`) is the shell's content background — a tint of the sign-in navy, so cards and grids
  read as white panels **on** something rather than as slightly different whites.
- `KATANGA` carries the sign-in screen's palette (`navy` #013596, `navyDeep` #01235a, `navyGlow` #0a2e6e,
  `ink` #101f43), mirroring the `--katanga-*` custom properties in `index.css`. It is a TS constant because
  the shell sets some of these as inline styles, which cannot see a CSS variable declared later.

Use theme tokens (`var(--mantine-color-brand-6)`, `c="dimmed"`, `radius="lg"`) rather than hard-coded
colours. `src/styles/app.css` holds the few brand overrides (active nav item on `--mantine-color-brand-0`).

## Shell

`src/components/layout/` — `AppShell` (Mantine `AppShell`: navbar 240 / 72 collapsed, header 64, footer 44,
padding `md`) with `AppNavbar`, `AppHeader`, `AppFooter`, `NavIcon`, `useComingSoon`.

The **sidebar is navy** — a `KATANGA.navyGlow → navyDeep` gradient set in `AppShell.tsx` — under a white logo
plate that lines up with the white header beside it. Everything that has to sit legibly on that navy lives in
`src/styles/app.css`, scoped under `.app-navbar`: Mantine's `NavLink` is also used on white grounds (the Roles
page's master list), and those must keep the default light styling.

- The menu is generated from `src/navigation.ts`; never hard-code menu items in the shell.
- Collapsed state is remembered in `localStorage` inside `try/catch`; below `sm` the navbar becomes a drawer
  driven by the header `Burger`.
- Items the user lacks the permission for are hidden (`visibleNavigation`), and the group holding the active
  route is opened on load.
- `comingSoon` items — the modules not built yet — are **hidden by default**: a menu is a list of places you
  can go, and nine dead entries above the live ones make a working application look like a demo. The switch
  on the dashboard brings them back, rendered disabled with a "Soon" `Badge`. The preference lives in
  `useShowComingSoon()` (`localStorage`, key `inventory_shipment.showComingSoon`); Mantine's `useLocalStorage`
  keeps the dashboard switch and the sidebar in step within the tab, so neither needs a provider. Pass the
  flag as `visibleNavigation(hasPermission, showComingSoon)` — it defaults to `true`, so callers that only
  care about permissions are unaffected.

## Shared components (`src/components/ui/`)

| Component | Purpose |
|---|---|
| `notify.success / error / info(message)` | Toasts. Green / red / blue, auto-close 4 s. |
| `confirm({ title, message, confirmLabel, cancelLabel, danger }): Promise<boolean>` | Confirmation dialog. `danger` gives a red confirm button. |
| `DataTable` | `mantine-datatable` wired for **server-side** paging + sorting. Props: `records`, `columns`, `totalRecords`, `page`, `recordsPerPage`, `onPageChange`, `onRecordsPerPageChange`, `sortStatus`, `onSortStatusChange`, `fetching`, `noRecordsText`, `filters`. Footer reads "Showing {from} to {to} of {total} entries"; page sizes come from `PAGE_SIZE_OPTIONS`. |
| `columnFilter({ label, value, onApply, options?, withText?, single?, placeholder? })` | The `filter` + `filtering` props for one column - spread into its definition to give it a header funnel. See **Column filters**. |
| `useGridFilters(columnText, onChange?)` | Filter state for a grid that holds all its rows: `apply(rows)`, `options(rows, accessor)`, `bind(accessor)`, `clearAll()`, `activeCount`. |
| `rowNumberColumn(page, recordsPerPage)` | The leading "#" column, numbered across pages. |
| `StatusBadge({ active })` | Active (green) / Inactive (grey) pill. |
| `MainFlag({ isMain })` | Amber star + "Yes", otherwise "No". |
| `PageHeader({ title, subtitle, breadcrumbs, actions })` | Title (order 2), dimmed subtitle, optional breadcrumbs, right-hand actions. |
| `FilterBar` + `FilterBar.Col` | Bordered `Paper` with a responsive `Grid` for filter controls. |
| `RowActions({ label, edit, toggleStatus, remove })` | Subtle `ActionIcon`s with tooltips. Each action takes `visible`, `disabled`, `disabledReason`, `onClick`. |
| `MoreActionsMenu({ actions })` | The "More Actions" dropdown. |
| `FormModal` | Modal with a form, `size="lg"`, Cancel / Save footer; refuses to close on a backdrop click while saving. |

## Column filters

Every grid column can carry a **header funnel**, the same control the previous application used: a
"contains" box over a tick list of that column's values, with Clear / Cancel / OK. Nothing applies until
OK. Two funnels AND with each other and with the page's search box.

A column is described to the filter layer by **one function - the text it shows for a row**
(`ColumnText<T>`). Both halves of the filter test that same string and the tick list is built from it, so
the values a reader can pick are exactly the values they can see. Sorting still works off the raw record,
so a date column stays chronological while its filter matches the text in the cell.

```tsx
const COLUMN_TEXT: Record<string, ColumnText<UserDto>> = {
  username: (u) => u.username,
  isActive: (u) => (u.isActive ? 'Active' : 'Inactive'),
}
const grid = useGridFilters(COLUMN_TEXT, () => setPage(1))   // a filter always returns to page 1

// ...in columns
{ accessor: 'isActive', title: 'Status', ...columnFilter({ ...grid.bind('isActive'),
  label: 'Status', options: STATUS_VALUES, withText: false }) }
```

Declare `COLUMN_TEXT` at module level: `apply` and `options` are memoised on it, and a map rebuilt each
render would defeat the page's own memos.

**Grids that hold all their rows** (Users, Login audit) call `grid.apply(rows)` before sorting and paging,
build each funnel's `options` from the **full** row set - never the filtered one, or a list would shrink as
values are ticked and leave a filtered-out value impossible to un-tick - and pass `filters={grid}` to
`DataTable` for the "N column filters in effect / Clear column filters" strip.

**Grids that page on the server** (Branches, Warehouses) do not use `useGridFilters`. Each funnel reads and
writes that page's `query` directly, so a header funnel and the filter bar's dropdown are two ways into one
parameter and cannot disagree: both go through the same `apply*` helper, which sets the `draft*` state and
`query` together and applies at once. `triStateFilter` /
`triStateQuery` in `gridFilters.ts` are the bridge for a `'true' | 'false' | null` parameter. These pages
pass no `filters` prop: the filter bar already shows and clears the same filters, and two Clears would be
one too many.

### Which columns get a funnel

| Column | Control |
|---|---|
| a closed set (Status, Yes/No, Result) | tick list, `withText: false` |
| a name or code a reader might pick several of | tick list + contains box; the list grows its own search above 10 values |
| filtered on the server by a single-value parameter (Warehouses' Branch / Site) | `single: true` - a one-of-many list with `(All)`, because a control that let three be ticked and then sent one would be lying about what it did |
| free prose, or a value unique per row (e-mail, user agent, a timestamp) | contains box only - omit `options`, since the list would be one entry per row |
| a multi-value cell (a user's Roles) | contains box only - a tick list would offer combinations ("Admin, Manager") rather than roles |
| **on a server-paged grid, a column the API cannot filter by** | **no funnel at all** |

That last row is why Branch Code, Branch Name and Address - and the warehouse equivalents - carry no
funnel. `usp_Branch_Search` / `usp_Warehouse_Search` take one free-text `@Search` that matches code **or**
name, so a box on the Branch Code header could only narrow by something other than the column it sits on;
the filter bar's search box is that parameter under its own name. Per-column text filtering there needs
`BranchCode` / `BranchName` / `Address` parameters threaded through the procedure, the query DTO, the
repository and the controller first - add the funnels in the same story.

Widths: a header cell carries caption + sort arrows + funnel, so a column sized for caption + arrows alone
clips once it gains one. Budget about 30px more.

## Control mapping

| Field | Control |
|---|---|
| text | `TextInput` |
| multiline | `Textarea` (`autosize`, `minRows={3}`) |
| dropdown | `Select` — `searchable`, `clearable` when optional, `nothingFoundMessage` |
| yes/no status | `Switch` |
| yes/no flag | `Checkbox` |
| numbers | `NumberInput` |
| dates | `DateInput` / `DatePickerInput` |

Required fields carry `withAsterisk`. Validation lives in `@mantine/form`'s `validate`; API field errors go
back through `form.setErrors({ field: message })`.

## Page skeleton

```tsx
<PageHeader title="…" subtitle="…" actions={<><MoreActionsMenu … /><Button>New …</Button></>} />
<FilterBar>…<FilterBar.Col>…</FilterBar.Col>…</FilterBar>
{error ? <Alert color="red">{error}</Alert> : null}
<Paper radius="lg" p="md" withBorder><DataTable … /></Paper>
{dialog ? <XxxFormModal … /> : null}
```

List-page behaviour: a filter **dropdown applies the moment it changes** — picking a value is a finished
choice, and asking the reader to confirm it again with the Filter button is one click too many. The
`draft*` state remains for the **search box** only, which is copied into `query` on **Filter** or **Enter**
(typing has no natural end, and a request per keystroke is a different feature). Each dropdown therefore
goes through a small `apply*` helper that sets both the `draft*` value and `query`, so the bar and the
column funnel above it can never disagree. **Clear Filters** resets everything; sorting and paging hit the
server and reset `page` to 1; `fetching` drives the grid's loading state.

## Error handling

The API returns RFC 9457 problem details. `ApiError` exposes `.status`, `.messages`, `.code`, `.data` and
`.fieldErrors`. Handle `code` before anything else:

| `code` | Handling |
|---|---|
| `DUPLICATE_CODE` | `form.setErrors({ <codeField>: 'A … with this … already exists.' })` |
| `MAIN_BRANCH_EXISTS` / `MAIN_WAREHOUSE_EXISTS` | `confirm()` naming `data.currentMain…`; on yes resend with `replaceMain… = true` |
| `REFERENCED` | `confirm()` showing the API message with a **Deactivate instead** action |
| `CONCURRENCY` | Inline `Alert` with a **Reload** link that re-fetches the record into the form |
| `BRANCH_INACTIVE` | `form.setErrors({ branchId: message })` |
| `MAIN_*_PROTECTED` | `notify.error(message)` (the icons are already disabled with a tooltip) |
| ASP.NET `errors` object | Map `fieldErrors` onto form fields |
| anything else | Inline `Alert` in the form, or `notify.error` for row actions |

## Checklist for a new page

- [ ] Route added in `src/App.tsx` behind `ProtectedRoute` with the right permission.
- [ ] Menu entry in `src/navigation.ts` with its permission code (breadcrumb comes from the model).
- [ ] `PageHeader` + `FilterBar` + `Paper > DataTable` + `FormModal`, no bespoke layout CSS.
- [ ] Header funnels per **Column filters** - and none on a server-paged column the API cannot filter by.
- [ ] Every button and row action gated with `hasPermission(...)`.
- [ ] `@mantine/form` validation; API field errors via `form.setErrors`.
- [ ] `notify` for success, `confirm` for destructive or irreversible actions.
- [ ] Error codes handled per the table above.
- [ ] Works at 1440 px and 390 px.
- [ ] `npm run typecheck`, `npm run lint`, `npm run build` all clean; no `any`, no TODOs, no mock data.
