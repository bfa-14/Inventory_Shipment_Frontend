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
| Command palette | `@mantine/spotlight` (same 9.5.x as the rest) |
| Icons | `@tabler/icons-react` |

`postcss.config.cjs` runs `postcss-preset-mantine` and `postcss-simple-vars` (breakpoints xs 36em, sm 48em,
md 62em, lg 75em, xl 88em). `src/main.tsx` imports the stylesheets in this order and wraps the router in
`MantineProvider` → `Notifications` (top-right) → `ModalsProvider`:

```
@mantine/core/styles.css → @mantine/notifications/styles.css → @mantine/dates/styles.css
→ @mantine/spotlight/styles.css → mantine-datatable/styles.layer.css → src/index.css → src/styles/app.css
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

## Finding a page: the menu search and the Spotlight

There are two ways to reach a screen by typing, and **both read `src/navigation.ts` through
`visibleNavigation(hasPermission, …)`**. That is the rule, not an implementation detail: a search must never
be a way to see — or open — a page the menu is hiding, so neither surface may keep a list of its own. Adding a
page to `navigation.ts` adds it to both; nothing else is needed.

**The sidebar box** (`AppNavbar`) sits below the logo, `TextInput` + `IconSearch`, placeholder
"Search menu...". It narrows the menu as it is typed, through `searchNavigation(sections, query)` in
`navigation.ts` — the one function that decides what "matching" means:

| The query names… | What stays |
|---|---|
| a section (`title` **or** `breadcrumb` — "backoffice", "setup") | that section, whole |
| a group ("master data") | the group and **every** child, because the group is what was asked for |
| anything else | only the items whose label matches, inside the groups that hold them |

A group holding a match is **expanded while the box has text**, whatever the reader last collapsed by hand —
and that hand-made state is waiting again the moment the box is emptied. The matched text is **bold**
(`Highlight` with `highlightStyles` that only set `fontWeight`, no marker background — this is a sidebar, not
a highlighter). **Enter** opens the first item still on screen and empties the box; **Esc** empties it. When
nothing matches, the sidebar says so rather than going blank. In the collapsed (72 px) rail the box is
replaced by a search `ActionIcon`: it expands the sidebar and puts the cursor in the box that appears.

**The Spotlight** (`AppSpotlight`, rendered once by `AppShell`) is the header's "Search anything..." box and
**Ctrl+K / Cmd+K**. It lists every page the user may open — `navLeaves(visibleNavigation(hasPermission,
false))`, so items with no route and the modules that are not built yet are absent by construction. Each
action carries the page's label, its place in the menu as the description ("Setup › Master Data" — Spotlight's
own filter matches it, so "setup" finds every back-office page), and its `NavIcon`; sub-items borrow their
group's icon. The header box is `readOnly` and opens the palette on click, Enter or Space — it looks like a
field, so it has to answer like one. `tagsToIgnore={[]}` overrides Mantine's default of standing the
shortcut down while a text field has focus: a palette is exactly what a reader reaches for while typing in
a filter box, and `Ctrl+K` cannot be mistaken for typing. Below `md` the box is an icon instead. The
modifier in the hint is read from the reader's own platform.

## Shared components (`src/components/ui/`)

| Component | Purpose |
|---|---|
| `notify.success / error / info(message)` | Toasts. Green / red / blue, auto-close 4 s. |
| `confirm({ title, message, confirmLabel, cancelLabel, danger }): Promise<boolean>` | Confirmation dialog. `danger` gives a red confirm button. |
| `DataTable` | `mantine-datatable` wired for **server-side** paging + sorting, and for row selection. Props: `records`, `columns`, `totalRecords`, `page`, `recordsPerPage`, `onPageChange`, `onRecordsPerPageChange`, `sortStatus`, `onSortStatusChange`, `fetching`, `noRecordsText`, `filters`, `onRowClick`, `onRowActivate`. Footer reads "Showing {from} to {to} of {total} entries"; page sizes come from `PAGE_SIZE_OPTIONS`. See **The selected row**. |
| `columnFilter({ label, value, onApply, options?, withText?, single?, placeholder? })` | The `filter` + `filtering` props for one column - spread into its definition to give it a header funnel. See **Column filters**. |
| `useGridFilters(columnText, onChange?)` | Filter state for a grid that holds all its rows: `apply(rows)`, `options(rows, accessor)`, `bind(accessor)`, `clearAll()`, `activeCount`. |
| `rowNumberColumn(page, recordsPerPage)` | The leading "#" column, numbered across pages. |
| `StatusBadge({ active })` | Active (green) / Inactive (grey) pill. |
| `MainFlag({ isMain })` | Amber star + "Yes", otherwise "No". |
| `PageHeader({ title, subtitle, breadcrumbs, actions })` | Title (order 2), dimmed subtitle, optional breadcrumbs, right-hand actions. |
| `FilterBar` + `FilterBar.Col` | Bordered `Paper` with a responsive `Grid` for filter controls. **No Apply/Filter button** — see **Filtering**. |
| `RowActions({ label, edit, toggleStatus, custom, remove })` | Subtle `ActionIcon`s with tooltips. Each action takes `visible`, `disabled`, `disabledReason`, `onClick`. `custom` adds page-specific icons (`{ icon, tooltip, color }`) between the standard ones and Delete, through the same tooltip/disabled wrapper. |
| `MoreActionsMenu({ actions })` | The "More Actions" dropdown. |
| `FormModal` | Modal with a form, `size="lg"`, Cancel / Save footer; refuses to close on a backdrop click while saving. Opens with the cursor in the first field and gives the focus back on close — see **Modals and the keyboard**. |

## Modals and the keyboard

`FormModal` does this for **every** dialog in the application, create and edit alike. No page asks for it, and
no page may re-implement it:

- **The cursor starts in the first field.** A dialog that opens with nothing focused makes the reader reach
  for the mouse to begin typing — New user opens on Username, New role on Name. The wrapper finds the first
  focusable control that is actually painted, skipping its own Cancel / Save footer so a form with no fields
  cannot open on "Cancel". It does this twice over, because the two halves cannot race: a layout effect tags
  that control `data-autofocus`, which is what Mantine's focus trap looks for first, and the effect after it
  focuses the same node directly in case the trap has already run.
- **Closing returns the focus to whatever opened it** — the New button, or the row's Edit icon. The opener is
  read in a layout effect, before any focus has moved; the return happens on unmount, because the pages mount
  these modals conditionally (`{dialog ? <XxxFormModal … /> : null}`) and Mantine's own `returnFocus` is torn
  down before it can see the modal close. It is off (`returnFocus={false}`) so there is one owner of that
  behaviour, not two.
- **Enter submits.** The body is a real `<form>` with a real `type="submit"` button, so Enter in any
  single-line field — including the last — submits it. Nothing else is needed; a `Textarea` keeps Enter for
  its own newline, which is right.

A form modal that does not use `FormModal` gets none of this, which is the reason not to write one.

## The selected row

**Every grid marks the row the reader last touched**, from the wrapper, without a page opting in. A screen of
near-identical lines loses your place the moment a toast fires or a dialog closes over it; the mark is how the
record you were working on is still findable afterwards.

- Clicking a row selects it — and so does clicking any of its **action icons**, which is the same click on its
  way up. The row takes the brand light background (`--mantine-color-brand-0`, #EEF3FF) with a 3 px
  brand-blue bar down its left edge.
- A click that landed on a **control** (a button, link, checkbox…) selects the row and then stops: the control
  has already answered it. Pressing Edit on the Items list asks to edit the item, not to edit it *and* open
  it — the wrapper is where that is decided, so no page needs its own `stopPropagation`.
- The colour is painted on the **cells**, not the row, and the bar is an `inset` shadow rather than a border.
  A cell sits on top of mantine-datatable's own hover fill, so the mark survives the cursor passing over it;
  an inset shadow costs no width, so no column shifts by 3 px when a row is marked. Both rules live in
  `src/styles/app.css` under `.app-grid__row--selected`.
- **The selection is the record's id, not the object**, so it survives the reload behind a toast: edit a user,
  save, and the same row is still marked when the list comes back. It clears when the row is no longer in the
  list — filtered away, deleted — judged only on a settled result (`fetching` false), and when the reader
  turns the page. Both are corrected during the render that changes the rows, never in an effect, so no mark
  is ever painted on the wrong row for a frame.
- With the grid focused, **Up / Down** move the mark and **Enter** runs `onRowActivate` — give it what the
  row's primary icon does (Edit on the master-data lists, View on Items) and gate it on the same permission:
  `onRowActivate={canEdit ? ({ record }) => setDialog({ kind: 'edit', … }) : undefined}`. It falls back to
  `onRowClick` when only that is given.
- `onRowClick` still means what it did — *the row leads somewhere* — and only such a grid shows the pointer
  cursor. Selecting is not navigating, and the cursor must not promise that it is.

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
parameter and cannot disagree: both call the same `setFilter` on the page's `useGridQuery`. `triStateFilter` /
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

## Filtering

**There is no Apply or Filter button anywhere.** A filter takes effect as it is edited:

| Control | When it applies |
|---|---|
| text / search box | **350 ms** after the last keystroke, or at once on **Enter** and on clearing it (the X, or select-all-delete — an empty box is a finished thought) |
| select, switch, checkbox, segmented control, date picker | **immediately** |
| a column header funnel | on its **OK** |

Any filter change resets to **page 1** (the page size and the sort are kept). Sorting resets the page too but
never touches the filters. **Clear Filters** stays: it restores every filter to its default and applies at
once, and it is **disabled while nothing is filtered**.

Grids that filter on the **server** get all of this from one hook, [`src/hooks/useGridQuery.ts`](../src/hooks/useGridQuery.ts):

```tsx
const grid = useGridQuery<Filters, BranchDto, PagedResult<BranchDto>>({
  initialFilters: NO_FILTERS,        // also exactly what Clear Filters restores
  debounced: ['search'],             // only the fields that are TYPED into
  initialSort: { columnAccessor: 'branchCode', direction: 'asc' },
  paging: 'server',                  // 'client' when the endpoint returns one flat list
  errorMessage: 'The branches could not be loaded.',
  fetcher: useCallback(({ filters, page, pageSize, sortStatus, signal }) => branchesApi.search({ … }, signal), []),
})
```

It returns `{ filters, setFilter, commitFilters, clearFilters, isDefault, page, setPage, pageSize, setPageSize,
sortStatus, setSortStatus, data, loading, error, reload }`. Two guarantees are the reason it exists rather
than each page repeating the pattern:

- **One request per settled state.** The inputs write to `filters`; the fetch reads `applied`, which is only
  ever a whole snapshot of `filters`. A pending keystroke and a dropdown pick a moment later therefore
  collapse into a single request carrying both, instead of firing twice.
- **The last request wins.** Every fetch runs under an `AbortController` that the next one aborts, so typing
  `wh` then `wh-0` can never flicker back to the `wh` rows. Pass the `signal` straight into the API call —
  the search functions in `src/api` all accept one.

`paging: 'client'` is for an endpoint that answers with one flat list the page slices itself (the login
audit). It keeps page/size/sort out of the fetch key, so turning a page does not re-ask the server for rows
it already sent.

Lists that hold **all** their rows and filter in the browser (Users, Roles) do not need the hook — they are
already instant. They must simply have no Apply button either.

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

## Sales import wizard

`ImportInvoiceItemsWizard` (`src/components/sales/ImportInvoiceItemsWizard.tsx`) imports lines from an
Excel file. It is a **component, not a page**: it validates the file against the API, shows what will
happen, and hands the usable rows back. It never saves anything except the audit row — the host screen
owns the lines and saves them with the rest of its document. That is what lets one wizard serve the
Sales Invoice, Inventory In and Inventory Out screens.

```tsx
<ImportInvoiceItemsWizard
  opened={importOpen}
  onClose={() => setImportOpen(false)}
  header={{ branchId, warehouseId, priceListId, currencyCode, decimalPlaces }}
  mode="invoice"              // or "stock" for Inventory In / Out
  draftReference={draftRef}   // your draft id, so the audit row can be attached on save
  onImported={(lines) => setLines((current) => [...current, ...lines])}
/>
```

### Props

| Prop | Meaning |
|------|---------|
| `header.priceListId` | The price list to price against, or `null` in stock mode. |
| `mode` | `invoice` prices rows and shows the Discount column; `stock` sends no price list, labels the price column **Unit Cost** and hides Discount. |
| `draftReference` | Your draft id. It goes on the audit row; `usp_InvoiceImport_AttachInvoice` stamps those rows with the real document id once it is saved. |
| `onImported` | Called once, with the Valid **and** Warning rows. Append them; do not replace. |

### ImportedLine

```ts
interface ImportedLine {
  itemId: number; itemCode: string; itemName: string
  itemUnitId: number; unitTypeName: string; packingFormula: number
  warehouseId: number; warehouseCode: string
  quantity: number
  unitPrice: number | null      // the selling price, or the unit cost in stock mode
  discountPercent: number
  expiryDate: string | null
  notes: string | null
  importRowNumber: number       // the Excel row, so a later error can point back at the file
}
```

### Rules the host must keep

- **Append, never replace.** Somebody may import twice, or import on top of lines typed by hand.
- **Give each appended line a fresh key.** `importRowNumber` repeats when the same file is imported
  twice, and React will reuse one row's state for another.
- **Warning rows ARE imported.** Only Error rows are skipped; Merged rows are already counted inside
  the row that absorbed them.
- **Keep the `draftReference` stable** for the life of the draft, and pass it to your save so the audit
  row can be attached.
- The wizard opens on `opened` and resets itself by remounting on that prop, so nothing leaks between
  runs; the host only has to toggle it.

## Document pages

Inventory In and Inventory Out are the first **document family**. Purchase and Sales will be the same
shape — a header, editable lines, attachments, an audit trail and a Draft → Posted → Cancelled
lifecycle — so the pieces live in `src/components/documents/` and are meant to be reused rather than
copied.

### The pieces

| Component | What it owns |
|---|---|
| `documentKind.ts` | Everything that differs between two documents of the same shape: title, route, accent colour, stock direction, whether the cost is typed, and the five permissions. Not a component — a table the pages read. |
| `DocumentHeaderCard` | Document no. / branch / warehouse / date / reason / reference / currency / notes, in a grid that collapses at 390 px. |
| `QuickItemSearch` | The scanner's way in: type or scan, press Enter, the line appears. |
| `DocumentLinesGrid` | The lines, edited in place. A plain Mantine table, not the shared `DataTable`. |
| `DocumentSummary` | Total items, total quantity in base units, total cost. |
| `AuditTrail` | What has happened to the document, five entries then the rest on asking. |
| `DocumentActionBar` | The actions, sticky, collapsing to a menu below 768 px. |
| `AttachmentsDrawer` | The paperwork behind the document. |
| `CancelReasonModal` | Asks why a posted document is being cancelled. |

### The rules that are easy to get wrong

- **One component for both directions.** `StockDocumentsPage` and `StockDocumentPage` take a
  `kind: DocumentKind` prop; nothing in them branches on `'INV_IN'`. Adding Purchase means adding a
  row to `documentKind.ts`, not a page.
- **The mode is the status, not a prop.** A draft is a form; posted and cancelled are records, and
  every input becomes **text** rather than a disabled input — a greyed form reads as broken, and
  disabled inputs are skipped by keyboard and screen readers.
- **Quantities on screen are in the chosen unit; totals and the ledger are in base units.** Two boxes
  of twelve is 2 in the Qty cell and 24 everywhere else. Say "base units" in any label that shows the
  second one.
- **A repeated scan increments, it does not duplicate.** Same item + unit + warehouse is the same
  line. Somebody counting twelve boxes scans twelve times.
- **`Line N:` messages go on line N.** The API numbers them because it knows which row it judged;
  show the row highlighted with a tooltip *and* as a notify, because the row may be scrolled away.
- **The server owns every rule that matters.** Check what saves a round trip (missing branch, empty
  grid, quantity below 1) and nothing else. Stock levels, draft status and the real cost are decided
  in SQL and their sentences are shown unchanged.
- **Unsaved-changes guard on both exits.** A `dirty` ref for in-app navigation (via `confirm`) and a
  `beforeunload` listener for the tab close, which React Router never sees.

### Adding the next family

1. Add a `DocumentKind` for it (title, route, colour, direction, cost rule, five permission codes).
2. Add the permission codes to `src/navigation.ts` and the menu entries.
3. Add three routes in `src/App.tsx` pointing at `StockDocumentsPage` / `StockDocumentPage` — or at a
   family-specific page that reuses the same components when its header needs more fields.

## Checklist for a new page

- [ ] Route added in `src/App.tsx` behind `ProtectedRoute` with the right permission.
- [ ] Menu entry in `src/navigation.ts` with its permission code (breadcrumb comes from the model). That entry
      is also what puts the page into the sidebar search and the Ctrl+K Spotlight — nothing else to register.
- [ ] `PageHeader` + `FilterBar` + `Paper > DataTable` + `FormModal`, no bespoke layout CSS.
- [ ] Filters auto-apply per **Filtering** — no Apply/Filter button, server grids on `useGridQuery`.
- [ ] Header funnels per **Column filters** - and none on a server-paged column the API cannot filter by.
- [ ] Every button and row action gated with `hasPermission(...)`.
- [ ] `onRowActivate` given the row's primary action, behind the same permission (see **The selected row**).
- [ ] `@mantine/form` validation; API field errors via `form.setErrors`.
- [ ] `notify` for success, `confirm` for destructive or irreversible actions.
- [ ] Error codes handled per the table above.
- [ ] Works at 1440 px and 390 px.
- [ ] `npm run typecheck`, `npm run lint`, `npm run build` all clean; no `any`, no TODOs, no mock data.
