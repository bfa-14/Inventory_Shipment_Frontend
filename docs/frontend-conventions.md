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
customer-approved design. It is **not** built with Mantine and must not be restyled. It keeps its own
`Alert` (`src/components/Alert.tsx`); every other screen uses Mantine's `<Alert>` or `notify()`.

## Theme (`src/theme.ts`)

- `brand` colour tuple built around **#2563EB**, `primaryColor: 'brand'`, `primaryShade: 6`.
- `defaultRadius: 'md'`, `fontFamily: '"Segoe UI", Inter, system-ui, sans-serif'`, headings `fontWeight: 700`.
- Component defaults: Button/TextInput/Textarea/Select/NumberInput/PasswordInput radius `md`, Paper radius
  `lg`, Modal radius `lg` + centered + overlay blur 2, Badge radius `xl`, Table `highlightOnHover`.
- `CONTENT_BG` (`#F5F7FB`) is the shell's content background.

Use theme tokens (`var(--mantine-color-brand-6)`, `c="dimmed"`, `radius="lg"`) rather than hard-coded
colours. `src/styles/app.css` holds the few brand overrides (active nav item on `--mantine-color-brand-0`).

## Shell

`src/components/layout/` — `AppShell` (Mantine `AppShell`: navbar 240 / 72 collapsed, header 64, footer 44,
padding `md`) with `AppNavbar`, `AppHeader`, `AppFooter`, `NavIcon`.

- The menu is generated from `src/navigation.ts`; never hard-code menu items in the shell.
- Collapsed state is remembered in `localStorage` inside `try/catch`; below `sm` the navbar becomes a drawer
  driven by the header `Burger`.
- Items the user lacks the permission for are hidden (`visibleNavigation`), `comingSoon` items render
  disabled with a "Soon" `Badge`, and the group holding the active route is opened on load.

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
parameter and cannot disagree: the funnel's `onApply` sets both the `draft*` state and `query`, and applies
at once rather than waiting for the Filter button - the popover has its own OK. `triStateFilter` /
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

List-page behaviour: filters are held in `draft*` state and copied into `query` only on **Filter** or
**Enter**; **Clear Filters** resets everything; sorting and paging hit the server and reset `page` to 1;
`fetching` drives the grid's loading state.

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
