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

## Import Sales from Excel page

`/sales/import-preview` (`src/pages/sales/ImportSalesPage.tsx`, menu **Sales → Import Sales from Excel**,
permission `sales.invoices.import`) turns a spreadsheet into a **posted sales invoice and its stock
movements in one step**. There is no draft on this page: the lines live in the browser until "Post to
Stock", and the server saves and posts them in one call (`POST api/sales/invoices/import-post`), deleting
its own draft if the posting is refused — so a failure leaves nothing behind and the reader fixes the
lines and posts again.

### The flow

1. **Header** (`SalesImportHeaderCard`): branch → default warehouse (filtered by branch) → price list →
   client → salesman → date → rate type + exchange rate → reference / notes. Defaults: the main branch
   and its main warehouse, the only client when there is exactly one (and its default price list, until
   the reader picks another), the salesman whose `userId` is the signed-in user, today. The rate is
   looked up (`GET api/sales/invoices/rate`) whenever the price list, the type or the date changes: a
   base-currency list shows "1 (base currency)", a foreign one shows the rate found and lets the reader
   change it, a date with no rate says so and asks for one — Post waits until there is one.
2. **Import from Excel** (disabled with a tooltip until branch, warehouse and price list are chosen)
   opens `ImportInvoiceItemsWizard` in `invoice` mode with `checkStock`, so the preview shows an
   **On Hand** column and marks the rows that would overdraw the shelf as Errors. Imported lines are
   **merged** into an identical existing line (same item, unit, warehouse, price, discount, expiry and
   notes) by adding the quantities — `mergeImported` in `salesLines.ts`.
3. **Lines** (`SalesLinesGrid`): On Hand per item + warehouse (read once from `stock/on-hand` and cached;
   refreshed after posting and after an INSUFFICIENT_STOCK refusal), editable quantity, discount and
   notes; the price is editable only with `sales.invoices.priceoverride` and read-only with a tooltip
   otherwise. Only a price the reader typed (or a Manual price the file carried and the server honoured)
   is sent back; a list price is left for the server to re-find.
4. **Post to Stock** (visible with `sales.invoices.post`; the API also wants `sales.invoices.create`): a
   confirm naming the warehouses, then one call. Success replaces the grid with a panel — the invoice
   number, the totals, "Start a new import" (keeps the header) and "Export to Excel".

### Stock check rules

- The check is **cumulative per item + warehouse, in row order, in base units** (qty × packing
  formula). The row that crosses the on-hand figure is the one marked; the rows above it are fine.
- It runs **three times**: in the wizard preview (server, `checkStock=true`), in the grid as quantities
  are edited (client, the same rule), and on posting (server — the only one that is a rule). The first
  two save a round trip. A red row shows "Insufficient stock: available a, required r", the Lines card
  says how many rows exceed the stock, and Post is disabled while any does.
- The server's refusals are shown unchanged. `Line N:` messages (VALIDATION, NO_PRICE) go on line N with
  a tooltip and a notify; INSUFFICIENT_STOCK ("Insufficient stock for <code> in <warehouse>: …")
  highlights every line of that item + warehouse and refreshes their On Hand; MASTER_INACTIVE, NO_LINES
  and CONCURRENCY are a notify. The header stays editable so the reader can fix and post again.
- Changing the branch, warehouse or price list while lines exist asks, then clears them: they were
  validated against the old header.
- A `beforeunload` guard warns while imported lines are not posted (React Router never sees a tab close).

### What the invoice page reuses

`src/api/sales/invoices.ts` already types the whole invoice (`SalesInvoiceDto`, `SaveSalesInvoiceRequest`,
`RateResolutionDto`, `ImportPostResult`) and the rate lookup. `SalesImportHeaderCard`, `SalesLinesGrid`,
`SalesTotals` and the helpers in `salesLines.ts` (`mergeImported`, `sameLine`, `lineTotal`, `stockKey`,
`partyLabel`, `priceListLabel`) are written for a draft that can be saved as well as posted; the invoice
page adds a document number, search, edit, cancel and attachments on the same skeleton as the stock
documents (see *Document pages*).

### The wizard

`ImportInvoiceItemsWizard` (`src/components/sales/ImportInvoiceItemsWizard.tsx`) imports lines from an
Excel file. It is a **component, not a page**: it validates the file against the API, shows what will
happen, and hands the usable rows back. It never saves anything except the audit row — the host screen
owns the lines. That is what lets one wizard serve Import Sales, Inventory In and Inventory Out.

```tsx
<ImportInvoiceItemsWizard
  opened={importOpen}
  onClose={() => setImportOpen(false)}
  header={{ branchId, warehouseId, priceListId, currencyCode, decimalPlaces }}
  mode="invoice"              // or "stock" for Inventory In / Out
  checkStock                  // invoice mode: rows are checked against the stock on hand
  draftReference={draftRef}   // your draft id, so the audit row can be attached on save
  onImported={(lines) => setLines((current) => [...current, ...lines])}
/>
```

| Prop | Meaning |
|------|---------|
| `header.priceListId` | The price list to price against, or `null` in stock mode. |
| `mode` | `invoice` prices rows and shows the Discount column; `stock` sends no price list, labels the price column **Unit Cost** and hides Discount. |
| `checkStock` | Invoice mode only. Rows that would overdraw the shelf, cumulatively per item + warehouse, come back as Errors and the preview shows On Hand. |
| `draftReference` | Your draft id. It goes on the audit row; `usp_InvoiceImport_AttachInvoice` stamps those rows with the real document id once it is saved. |
| `onImported` | Called once, with the Valid **and** Warning rows. Append them; do not replace. |

`ImportedLine` carries `itemId / itemCode / itemName / itemUnitId / unitTypeName / packingFormula /
warehouseId / warehouseCode / quantity / unitPrice / priceSource / discountPercent / expiryDate / notes /
importRowNumber`. Rules for a host: **append, never replace**; give each appended line a **fresh key**
(`importRowNumber` repeats when a file is imported twice); **Warning rows are imported**, only Error rows
are skipped and Merged rows are already inside the row that absorbed them; keep `draftReference` stable
for the life of the draft. The wizard resets itself by remounting on `opened`.

## Document type configuration

`Configuration › Document Types` (`src/pages/configuration/DocumentTypesPage.tsx`, permission
`inventory.documenttypes.manage`) edits the eight document kinds: name, prefix, number length, number on
post, number per branch, requires reason, default pricing (Cost / PriceList / None), price editable, active.
Code, family and stock direction are read-only — the procedures branch on them.

Every document page reads the configuration through **`useDocumentTypes()`** (`src/hooks/useDocumentTypes.ts`,
one cached fetch shared by every reader; the configuration page calls `refresh()` after a save) and
**`pricingOf(type, fallback)`**: `Cost` + editable = a typed cost (Inventory In, purchase documents), `Cost` +
not editable = the read-only average (Inventory Out), `PriceList` = the list price, editable only with the
override permission (sales). The pages no longer hard-code `INV_IN` / `INV_OUT` cost rules; `documentKind.ts`
keeps the direction only (the fallback while the configuration loads). Document numbers run per branch
(`IN-KLW-000012`): the number column is 190 px and never truncates.

## One document = one warehouse

The header warehouse is *the* warehouse of the document (the header card labels it "Warehouse"); the
lines grid has no Warehouse column, and every line is sent with `warehouseId` = the header warehouse
to keep the API contract. A file naming several warehouses does not become one document — see below.

## Bulk actions

Every document list carries a checkbox column (`DataTable` props `selectedRecords`,
`onSelectedRecordsChange`, `isRecordSelectable` — only drafts the reader may post or delete are
selectable) held by **`useBulkSelection()`** so the selection survives paging. `BulkActionsBar` shows
"3 selected: Post selected / Delete selected / Clear" above the grid; each action confirms, calls
`bulk-post` / `bulk-delete` (one call per document on the server, one refusal never stops the others),
shows **`BulkResultsModal`** (number, result badge, message per document), drops the succeeded rows from
the selection and reloads the grid. Sales and purchase lists reuse the same three pieces.

## Import: one document per warehouse

`ImportInvoiceItemsWizard` always sends the hosting page's `documentTypeCode` (the template download uses
it too, and the preview shows a **Type** column; rows typed for another kind are Errors). When the
validated rows span several warehouses and the host passed **`importCreate`**, step 3 lists the groups
("WH-001 - 12 lines, WH-002 - 3 lines") with a "Post immediately" checkbox and creates one document per
warehouse through the family's `import-create` endpoint; the result panel links the new documents and
"Go to the list" calls `onDocumentsCreated`, where the host navigates with `state.highlight` (the list
tints those rows). With one warehouse the lines are appended as before; if it is not the header warehouse
the wizard asks "The file is for WH-002 — switch the document to WH-002?" and calls `onSwitchWarehouse`.
## Sales invoice page

`/sales/invoices` (list, `SalesInvoicesPage`) and `/sales/invoices/new` / `/:id` (`SalesInvoicePage`) are
the priced document on the same skeleton as Inventory In: a header card, an editable lines grid, the
summary and audit cards, the sticky action bar, attachments in a drawer, a Draft → Posted → Cancelled
lifecycle where posted and cancelled are read-only text. What is the invoice's own:

- **Header** (`SalesInvoiceHeaderCard`): invoice no. ("Assigned on posting"), invoice date, due date,
  branch, warehouse, client (searchable; its default price list pre-fills Price List until the reader
  picks one), salesman (defaults to the salesman linked to the signed-in user), price list (shows the
  currency), rate type + exchange rate (auto from `GET api/sales/invoices/rate`; "1 (base currency)" for
  USD; a warning and a manual box when none is defined), reference, notes. A loaded invoice keeps its own
  rate until the price list, the type or the date is changed.
- **Lines** (`SalesInvoiceLinesGrid`): Quick Item Search and "+ Add Item" give a line its **sales unit**
  (else the base unit), quantity 1 and the price from `GET api/masterdata/unit-prices/resolve` (branch
  price first, then All Branches). Changing the unit re-resolves the price. **No price = a red line
  "No price in <list>"** and the save is blocked with the NO_PRICE wording. The price column follows the
  type configuration (`pricingOf`): PriceList pricing is editable only with `sales.invoices.priceoverride`,
  and a typed price that differs from the list price carries a **manual** badge; only a Manual price is
  sent to the API (`unitPrice`), a list price is left for the server to re-find. On Hand turns red when
  qty × formula exceeds it; the page repeats the count above the grid.
- **Import from Excel**: the wizard in invoice mode with `checkStock`; a multi-warehouse file becomes one
  invoice per warehouse through `importCreate` (Manual prices only are sent).
- **Errors**: `Line N:` messages land on line N; INSUFFICIENT_STOCK highlights every line of the named
  item and refreshes its On Hand; CONCURRENCY reloads. Same unsaved-changes guard as Inventory In.
- **List**: filters (search, branch, client, salesman, status, dates), bulk Post / Delete on ticked
  drafts, a total in the invoice currency ("$ 5,000.00 USD"), row actions gated by permission and status.

`AttachmentsDrawer` and `AuditTrail` are shared by every family: the drawer takes the family's file
endpoints through `api` (the stock documents' when left out) and both read structural DTOs.
## Purchase documents

`/purchase/orders`, `/purchase/invoices` and `/purchase/returns` (lists, `PurchaseDocumentsPage`) and their
`/new` / `/:id` document pages (`PurchaseDocumentPage`) are **one component each, parameterised by
`kind: PurchaseKind`** (`src/components/purchase/purchaseKind.ts`: PO blue, PINV green, PRET orange —
title, plural, noun, route, colour, the posting wording and the five `purchase.<kind>.*` permissions).
Nothing in the pages branches on `'PO'` except through that table. They sit on the sales invoice skeleton
in **cost mode**:

- **Header** (`PurchaseHeaderCard`): document no. (orders are numbered on save, invoices and returns on
  posting), document date, expected / due date, supplier (searchable; **picking a supplier sets Currency to
  the supplier's default currency**, else the base one, until the reader picks another), branch, warehouse,
  currency, rate type + exchange rate (auto from `GET api/purchase/rate?currencyId=&rateType=&date=`;
  "1 (base currency)" for USD; a warning and a manual box when none is defined), supplier reference, notes.
  A document made from another shows a **source chip** ("From Purchase Order PO-…") that links to it; its
  supplier and branch are fixed, and Add Item / Import are hidden because the lines are the source's.
- **Lines** (`PurchaseLinesGrid`, helpers in `purchaseLines.ts`): Quick Item Search and "+ Add Item" give a
  line its **purchase unit** (else the base unit), quantity 1 and a **Unit Cost = last cost × packing formula
  × exchange rate** (blank when the item was never bought — the server then writes 0). The cost column
  follows the type configuration (`pricingOf`, Cost mode: editable unless the owner turned it off). On a
  line with a source, the Qty box is capped at what remains on the source line and says **"Remaining: n"**
  under it; a larger quantity turns the row red before the server's SOURCE_INVALID does, and that message
  ("Line 1: … only 6 remain on the order line.") lands on line N like every other `Line N:` error.
- **Import from Excel**: the wizard in stock (cost) mode with the kind's `documentTypeCode`; the Unit Price
  / Cost column is the unit cost; a multi-warehouse file becomes one document per warehouse through
  `purchaseDocumentsApi.importCreate`.
- **Summary** (`SalesTotals` reused): subtotal, discount, grand total in the document currency and the
  "≈ … USD" line at the document rate. **Linked Documents** (`LinkedDocumentsCard`): the source and every
  document created from this one, each with its status — a cancelled invoice under an order means the
  order is open again.
- **Lifecycle**: Draft → Posted → Cancelled, plus **Closed (teal)** for orders: automatically when every line
  is received, or by hand with "Close Order" (`CloseOrderModal`, reason optional, needs
  `purchase.orders.post`). Confirmations say what posting does per kind — an order is *confirmed* and its
  quantities count as incoming; an invoice adds stock and sets costs; a return removes stock at the
  invoice cost. View mode offers Export, **Create Purchase Invoice** (open order, needs
  `purchase.invoices.create`), **Create Purchase Return** (posted invoice, needs `purchase.returns.create`),
  Close Order, Cancel Document, Back. Posted, closed and cancelled documents are read-only text.
- **List**: filters (search, branch, supplier, status Draft / Posted / Cancelled / Closed, dates), a Source
  column that links to the order / invoice, a **Received** progress bar on orders (0–100 % of the ordered
  quantity invoiced), bulk Post / Delete on ticked drafts, row actions gated by permission and status
  including Create invoice / Create return.
- **API**: `src/api/purchase/documents.ts` — one module for the three kinds; every 403 from it names the
  permission that was missing (`code: FORBIDDEN`).

## Shortages → PO

`/inventory/shortages` (`ShortagesPage`, behind `inventory.shortages.view`) is the shortage report:
one row per item and warehouse from `GET api/inventory/shortages` (not paged — the page holds the whole
list, sorts and pages it itself with `useGridQuery({ paging: 'client' })`, and sums it for the cards).

- **Filters**: branch, warehouse (of the branch), family (tree order, includes sub-families), brand,
  supplier, search, **Only shortages** (default on; off shows every evaluated item and warehouse) and
  **Average over** 30 / 60 / 90 days for the average daily sales.
- **Cards**: Items short, Total suggested cost (suggested base quantity × last cost, else average cost),
  Warehouses affected.
- **Grid**: item (link), warehouse, On Hand, Incoming (open purchase orders), Available (= on hand +
  incoming, what is compared with Min), Min, Max, Shortage, **Suggested in the purchase unit** ("3 Box
  (x12)"), average daily sales, **Days of cover** (red when shorter than the lead time), supplier with a
  *default* / *last* badge or a warning when the item has none, last cost, lead time. A row is **red when
  nothing is on hand** and **orange when short** (`app-grid__row--danger` / `--warning`). Export writes
  the same rows to Excel.
- **Create Purchase Order (n)** (needs `purchase.orders.create`): the ticked rows in a modal
  (`CreatePurchaseOrdersModal`) with an editable quantity (the suggestion) and supplier, an order date
  and an expected date, and a **grouping preview** — one order per supplier AND warehouse, updated as
  suppliers change. Create calls `POST api/inventory/shortages/create-orders`; the result lists each
  draft with a link, and Done reloads the report with an info line naming the orders. The branch of each
  order is the warehouse's own; the currency is the supplier's; the line price is the last cost converted.

## Numbers

Every quantity and amount the app shows goes through `formatNumber` / `formatMoney`
(`src/components/format.ts`): thousands separators and fixed decimals in the en-US shape — 14020800 reads
**14,020,800.00**, whatever the browser locale. `money()` in `documentKind.ts` is the same thing with the
currency code. A `NumberInput` that holds a quantity or an amount carries `thousandSeparator=","`.
Counts (items, rows) go through `formatNumber` too; a bare `{value}` of a number in JSX is a bug.
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
