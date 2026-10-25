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
| Charts (the Dashboard) | `@mantine/charts` (same 9.5.x) on `recharts` |
| Icons | `@tabler/icons-react` |

`postcss.config.cjs` runs `postcss-preset-mantine` and `postcss-simple-vars` (breakpoints xs 36em, sm 48em,
md 62em, lg 75em, xl 88em). `src/main.tsx` imports the stylesheets in this order and wraps the router in
`MantineProvider` → `EnvironmentProvider` (see **Environments (Production / Testing)**) → `Notifications`
(top-right) → `ModalsProvider`. `EnvironmentProvider` sits above the other two because they render toasts and
`modals.open()` bodies beside their children, where a provider below them would not reach:

```
@mantine/core/styles.css → @mantine/charts/styles.css → @mantine/notifications/styles.css → @mantine/dates/styles.css
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

The Production / Testing switch and the "Testing environment" badge are the one addition to the design; they
follow the same rule (classes `.login-env-switch` / `.login-env-badge` in `src/index.css`) and are described
under **Environments (Production / Testing)**.

## Theme (`src/theme.ts`)

- `brand` colour tuple built around **#2563EB**, `primaryColor: 'brand'`, `primaryShade: 6`.
- `defaultRadius: 'md'`, `fontFamily: '"Segoe UI", Inter, system-ui, sans-serif'`, headings `fontWeight: 700`.
- Component defaults: Button/TextInput/Textarea/Select/NumberInput/PasswordInput radius `md`, Paper radius
  `lg`, Modal radius `lg` + centered + overlay blur 2, Badge radius `xl`, Table `highlightOnHover`, DateInput
  `dateParser: parseTypedDate` (see **Dates**).
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

- **The header on a phone.** Its buttons (TESTING badge, search, bell, avatar) never shrink (`flexShrink: 0`); the
  title on the left gives way, cut with "…" and clipped. Below `sm` the breadcrumb trail and the avatar's chevron are
  hidden, so at 390 px the avatar stays whole on screen (it ran 22 px past the edge); the page repeats the title.
- **A `SegmentedControl` on a phone** (the Dashboard's "Today / This month / Last month / This year") never sets the
  page's width: below `48em` it takes the whole row (`fullWidth`, its group at `100%`), `size="xs"`, and its
  controls `flex: 1 1 auto; minWidth: 0`, so each option is as wide as its label and an even narrower screen cuts a
  label with "…" instead of scrolling the page sideways (at the normal size the four periods were 383 px in a 358 px
  column).
- The menu is generated from `src/navigation.ts`; never hard-code menu items in the shell.
- Collapsed state is remembered in `localStorage` inside `try/catch`; below `sm` the navbar becomes a drawer
  driven by the header `Burger`.
- Items the user lacks the permission for are hidden (`visibleNavigation`), and the group holding the active
  route is opened on load.
- `comingSoon` items — the modules not built yet — are **hidden by default**: a menu is a list of places you
  can go, and nine dead entries above the live ones make a working application look like a demo. The switch
  on Home (`/`, the first landing page; Ali's Dashboard of figures and charts is `/dashboard`) brings them
  back, rendered disabled with a "Soon" `Badge`. The preference lives in
  `useShowComingSoon()` (`localStorage`, key `inventory_shipment.showComingSoon`); Mantine's `useLocalStorage`
  keeps Home's switch and the sidebar in step within the tab, so neither needs a provider. Pass the
  flag as `visibleNavigation(hasPermission, showComingSoon)` — it defaults to `true`, so callers that only
  care about permissions are unaffected.

## Environments (Production / Testing)

The application runs twice on the same server: **production** (built from the `production` branch, the real
database) and **testing** (built from `main`, a database of its own), each at its own address with its own web
container and API. The app learns which one it is at run time, so the same build serves both.

**`GET /environment.json`** is answered by the web container (the `Caddyfile`, from `APP_ENVIRONMENT` and
`APP_SWITCH_URL` set by `deploy/docker-compose.yml` in Inventory_Shipment), never by the API, with
`Cache-Control: no-store`:

```
{ "environment": "production" | "testing", "switchUrl": "<absolute http(s) address of the other environment, or empty>" }
```

**`src/environment/`** reads it: `EnvironmentProvider` (in `main.tsx`) fetches it **once** at start-up
(`cache: 'no-store'`) and never holds up the first render; screens read the answer with `useEnvironment()` →
`{ environment, switchUrl }`. The parsing is strict: `environment` must be exactly `production` or `testing`,
and `switchUrl` must be an absolute `http:`/`https:` URL that is not this site, otherwise it is `null`. **Any**
failure — a 404, a network error, invalid JSON, the Vite dev server answering with `index.html` — leaves both
`null`, and `null` means *show nothing*: `npm run dev` looks exactly as it always has. Never treat `null` as
production.

What the reader sees:

| Where | When | What |
|---|---|---|
| Sign-in page, below **Sign in** | `environment` known **and** `switchUrl` set | Mantine `Switch` "Test environment" (on = testing, orange), with "Off: Production. On: Testing (test data, safe to try things)." under it. Flipping it — click, or Space from the keyboard — loads `new URL('/login', switchUrl)`: a full page load of the other site, nothing carried across. |
| Sign-in page, above the logo | `environment === 'testing'` | Orange filled badge "Testing environment". |
| App header, left of the search box | `environment === 'testing'` | Orange filled `Badge` "TESTING", tooltip "Test environment: test data; emails are not sent to real people". The badge is a tab stop and the tooltip opens on hover, focus and tap. |
| Pages outside the shell: the print pages (receipt, payment voucher, customer statement, shortage plan) and the emailed approval page | `environment === 'testing'` | `<TestingMarker />` (`src/environment/`): an orange strip "Test environment - test data, not a real document" at the top of the page. It is **not** `.no-print`: it goes onto the paper, colour kept with `print-color-adjust: exact`. A new page outside `AppShell` puts it first. |
| Browser tab | `environment === 'testing'` | `document.title` prefixed with `TEST · `, kept there if a page sets its own title. |

**The switch always shows where the page is, never where it is going.** The form under it signs in to *this*
environment, so after a press it stays put, disabled, with "Opening the Testing (or Production) sign-in
page..." under it until the other page replaces this one. If that load is stopped or stalls, the switch comes
back after 10 seconds; a page restored from the back-forward cache gets it back at once.

Production shows nothing new anywhere. Orange is the testing colour: do not use a filled orange badge in the
header for anything else.

On the sign-in page both pieces use space the design leaves empty (the badge is absolutely placed in the
panel's top margin), so a full-size card looks exactly as approved. The switch does add height, so while it is
shown the card carries `.login-card--env-switch`: its 1034:772 height becomes a minimum, and on screens of about
900–1130px, where the scaled-down card would cut the footer off, it grows instead.

## The menu's groups and their order

`src/navigation.ts`, in the owner's order: Home and Dashboard on top, then **Reports** (Shortages, Stock Valuation,
Sales Profit, Customer Statement, Out-of-Stock Sales), **Logistics**, **Purchase**, **Inventory**, **Sales** and
**Configurations** (the former Backoffice and Configuration groups: Master Data, Users & Permissions, Document Types,
Charge Types, Container Types, Settings). A page moved to another group keeps its address and its permission; its
breadcrumb, the menu search and the Spotlight follow the menu by themselves.

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
| a section (`title` **or** `breadcrumb` — "configurations", "reports") | that section, whole |
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
action carries the page's label, its place in the menu as the description ("Configurations › Master Data" — Spotlight's
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
| `DataTable` | `mantine-datatable` wired for **server-side** paging + sorting, and for row selection. Props: `records`, `columns`, `totalRecords`, `page`, `recordsPerPage`, `onPageChange`, `onRecordsPerPageChange`, `sortStatus`, `onSortStatusChange`, `fetching`, `noRecordsText`, `filters`, `onRowClick`, `onRowActivate`, `pinLastColumn` (keeps the actions column in view on a grid wider than the screen), `storeKey` (turns on draggable widths and the header's right-click column chooser, and names where they are remembered), `summaryRecords` (the filtered rows the footer totals — see **The summary row**). Footer reads "Showing {from} to {to} of {total} entries"; page sizes come from `PAGE_SIZE_OPTIONS`. See **The selected row** and **Column chooser and column widths**. |
| `columnFilter({ label, value, onApply, options?, withText?, single?, placeholder? })` | The `filter` + `filtering` props for one column - spread into its definition to give it a header funnel. See **Column filters**. |
| `useGridFilters(columnText, onChange?)` | Filter state for a grid that holds all its rows: `apply(rows)`, `options(rows, accessor)`, `bind(accessor)`, `clearAll()`, `activeCount`. |
| `rowNumberColumn(page, recordsPerPage)` | The leading "#" column, numbered across pages. |
| `StatusBadge({ active })` | Active (green) / Inactive (grey) pill. |
| `MainFlag({ isMain })` | Amber star + "Yes", otherwise "No". |
| `PageHeader({ title, subtitle, breadcrumbs, actions })` | Title (order 2), dimmed subtitle, optional breadcrumbs, right-hand actions. |
| `FilterBar` + `FilterBar.Col` | Bordered `Paper` with a responsive `Grid` for filter controls. **No Apply/Filter button** — see **Filtering**. |
| `RowActions({ label, edit, toggleStatus, custom, remove })` | Subtle `ActionIcon`s with tooltips. Each action takes `visible`, `disabled`, `disabledReason`, `onClick`. `custom` adds page-specific icons (`{ icon, tooltip, color }`) between the standard ones and Delete, through the same tooltip/disabled wrapper. |
| `MoreActionsMenu({ actions })` | The "More Actions" dropdown. |
| `FormModal` | Modal with a form, `size="lg"`, Cancel / Save footer; refuses to close on a backdrop click while saving. Opens with the cursor in the first field and gives the focus back on close — see **Modals and the keyboard**. Optional, all off by default (script 90): `closeOnEscape` (default `true`; an outer dialog passes `false` while an inner one is open), `fullScreen` (a phone: not centred then), `saveDisabledReason` (while `saveDisabled`: the Save button's tooltip, a dimmed line above the footer below 48em). A submit bubbling up from a dialog opened on top of it is ignored. |
| `SearchSelect({ load, value, onChange, selected?, resolve? })` / `SearchMultiSelect({ load, value, onChange, selected })` | A dropdown that **searches the server as it is typed** (debounced, abandoned requests aborted), for the lists without a ceiling: orders, invoices, containers, movements, parties. `load(search, signal)` answers the first matches (a stable function: module level or `useCallback`; the shared ones are in `components/purchase/documentSearch.ts`); `selected` keeps a known option (a default, a preset) in the list; `resolve(value)` finds the label of a value kept from the last visit. See **Lists of any length**. |

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
- **Only the dialog's own form submits it.** A dialog opened on top of another lives in a portal, but its submit
  still bubbles up the React tree to the dialog under it, which would then post too. `FormModal` ignores a submit
  whose target is not its own form (`event.target !== event.currentTarget`), as Item Definition already did. No
  dialog held another form before script 90, so none of them changed.

Three options, all off by default (script 90, the transfer order's large dialogs that post, and the dialogs opened on
top of them); left out, a dialog is exactly what it was:

| Prop | What it does |
|---|---|
| `closeOnEscape` (default `true`) | `false` keeps Escape from closing the dialog (it never closes while saving). Mantine 9.5 closes EVERY open modal on one Escape, so an outer dialog passes `false` while an inner one is open: Escape then closes the inner one only. |
| `fullScreen` | The whole screen, not centred: the Dispatch, Receive and Dispatch and receive dialogs pass it below 48em. |
| `saveDisabledReason` | Why Save is disabled, while `saveDisabled` is true: the button's tooltip on a wide screen and, below 48em (a phone shows no tooltip), a dimmed line above the footer - the rule of `DocumentActionBar`. Enter does not submit through it. |

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

## Column chooser and column widths

Every list page's grid lets the reader hide columns and drag column edges, and remembers both.
A page turns this on with **one prop** - `storeKey` on `DataTable`:

```tsx
<DataTable<BranchDto> storeKey="masterdata.branches" ... />
```

`storeKey` names where the choices are kept (localStorage, so per browser and per person, never sent
to the server). The wrapper then marks every column `resizable` for itself, so a column list needs
no extra flags, and `mantine-datatable`'s own `useDataTableColumns` does the storing.

**The chooser is not on screen.** Right-click the grid's **header** → **Column chooser** → a small
dialog with one checkbox per column and **Reset columns** / **Reset widths**. Nothing is shown until
it is asked for: a grid is read far more often than it is rearranged. Widths are dragged directly on
the header edge, and double-clicking that edge resets the one column.

Note the wrapper deliberately does **not** set `toggleable` on columns, although those are exactly
the columns the chooser offers. `mantine-datatable` treats that flag as permission to run its own
column UI - a cross in every header, and a checkbox list that opens straight from the right-click
with no menu in between. Hiding does not depend on the flag (`effectiveColumns` reads the stored
toggle state either way), so the flag stays off and `FIXED_ACCESSORS` decides what the chooser lists.

Conventions:

- **The key is namespaced after the page** - `masterdata.branches`, `logistics.containers`,
  `purchase.purchaseDocuments.PO`, `security.users`. It is persisted, so treat it as permanent: reusing
  one key for two grids has them overwrite each other's layout, and renaming one throws away what
  the reader arranged. **One page component that serves several lists takes one key per list**: the
  purchase orders, invoices and returns once shared `purchase.purchaseDocuments`, and the saved layout of
  the first list opened put the other lists' own columns after Actions. They now use
  `purchase.purchaseDocuments.{PO|PINV|PRET}` (the hidden columns, widths and page size saved under the old
  key are copied once), and the page remounts per kind (`key={kind.code}`), since the three routes render
  the same component and would otherwise carry one list's state into the next.
- **The columns stay in the page's order.** Nothing lets a reader move a column, yet `mantine-datatable`
  stores an order under `<storeKey>-columns-order` and puts a column it has not seen before at the
  end, after Actions - every column a release adds would land there for anyone who opened the list before.
  `DataTable` therefore keeps that stored order equal to the column list as defined: written before the
  grid reads it, and put back if it drifts. Add a column where it belongs in the definition; no key
  change is needed.
- **`#` and `Actions` are never hideable or resizable** (`FIXED_ACCESSORS` in `DataTable.tsx`). `#`
  is a position marker rather than data, and `Actions` is what `pinLastColumn` deliberately keeps in
  view. `mantine-datatable` also never resizes the last column, whatever it is, and a resize takes
  width from the neighbouring column rather than widening the table - each keeps a 50px floor.
- **The context menu is the header's alone.** A right-click on a row stays the browser's, so copying
  a cell is not interrupted.
- **A grid inside a form leaves `storeKey` out** - the document and shortage line grids, and the load
  items drawer. There a hidden column would hide a figure someone is editing. Without the prop the
  grid behaves exactly as before and stores nothing.
- The last visible column cannot be unticked: a grid of no columns is a blank rectangle with a
  paging footer under it.
- A column can start hidden with `defaultToggle: false` on its definition.
- A title may be a node - a caption inside a `Tooltip` that explains it (script 90: Sales Profit's "COGS adjustments
  (USD)"). The chooser, the filter dialog, the footer menu and the CSV header then name the column by the text inside
  the node (`captionOf` in `DataTable.tsx`; the tooltip's label is a prop, never part of the name), and only a node
  without text falls back to the accessor in words.

A reader can hide a column whose funnel is set, which would otherwise leave a filter narrowing the
rows with nothing on screen saying so. The "N column filters in effect" strip above the table is what
covers that, and it is why that strip now shows for either reason.

## The summary row

Grids that hold their whole result carry a footer row. **Every column's footer cell is the control**:
click it and pick **Count**, **Sum**, **Average**, **Min** or **Max** — or **None**, which is where every
column starts. A column with no numbers in it offers only Count. Choices are remembered per grid, under
`<storeKey>-summaries`, beside the column layout.

A page turns it on by passing the rows to total:

```tsx
<DataTable<BranchDto> storeKey="masterdata.branches" records={records} summaryRecords={narrowed} … />
```

`summaryRecords` is the **filtered, unpaged** set — the same `narrowed` the footer count reads from.
Not the page on screen, which would change as the reader turned it, and not the whole table, which would
answer a question they had just narrowed away from.

A grid that pages on the **server** can only add up the rows it was sent, so it passes the page and says
so — `summaryScope="page"` prints **“of this page”** under every figure:

```tsx
<DataTable storeKey="inventory.stockDocuments" records={data?.items ?? []}
           summaryRecords={data?.items ?? []} summaryScope="page" … />
```

The qualifier is in the **cell**, not once above the grid, because the figure is what gets read, quoted
and screenshotted — and on its own a Sum looks like a total of everything. A total of ten rows passed
off as a total of five hundred is how a grid lies, and the label is what stops it.

The honest version of those figures is the search procedure returning aggregates over the whole filtered
result. Until a grid's procedure does that, its footer covers the page and admits it.

Two columns never get a cell: `#` and `Actions` (`FIXED_ACCESSORS`) — a total of row numbers is not a
fact about anything. A column that brings its **own** `footer` keeps it: the sales profit report states
its totals in its own words, and a generic Sum must not overwrite them.

Sum, Average, Min and Max read the row's raw field, so they work wherever that field is a number; a blank
cell is skipped rather than counted as zero. Whole numbers print whole; anything else keeps two places.

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

**Every filter control carries a visible `label`** - the field it filters on, worded as the column is
(`Status`, `Is Main Branch`, `Branch / Site`, `Date from`). A search box is labelled just `Search`,
whatever it searches; its placeholder is what says which columns it matches ("Search by branch code or
name..."). `aria-label` is not enough: a lone `All` in a dropdown tells a sighted reader nothing about
which field is narrowed, and the page cannot be read at a glance. The placeholder then says what
*no choice* means (`All`, `Any`) and never repeats the label. An icon-only control - the Containers
page's **Advanced filters** toggle - keeps `aria-label`, since a visible label would be wrong there.
`FilterBar` aligns its columns on `flex-end`, so a **Clear Filters** button with no label of its own
still lines up with the inputs beside it.

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
| `importCreate` | Optional `(lines, postImmediately, splitByWarehouse) => Promise<ImportCreateResult>`: a file naming several warehouses becomes new documents instead of being appended (see *Import: one document, or one per warehouse*). |
| `allowSplitByWarehouse` | Offers the "One document per warehouse" switch in step 3; only for a family whose `import-create` takes `splitByWarehouse`. |

`ImportedLine` carries `itemId / itemCode / itemName / itemUnitId / unitTypeName / packingFormula /
warehouseId / warehouseCode / quantity / unitPrice / priceSource / discountPercent / expiryDate / notes /
importRowNumber`. Rules for a host: **append, never replace**; give each appended line a **fresh key**
(`importRowNumber` repeats when a file is imported twice); **Warning rows are imported**, only Error rows
are skipped and Merged rows are already inside the row that absorbed them; keep `draftReference` stable
for the life of the draft. The wizard resets itself by remounting on `opened`.

## Document type configuration

`Configurations › Document Types` (`src/pages/configuration/DocumentTypesPage.tsx`, permission
`inventory.documenttypes.manage`) edits the document kinds: name, prefix, number length, number on
post, number per branch, **year in number** (a checkbox: `SHR-2026-000001`, one sequence per year), requires reason, default pricing (Cost / PriceList / None), price editable, active.
Code, family, stock direction and **BIVAC items only** are read-only — the procedures branch on them (see
**A document type that limits its items**).

Every document page reads the configuration through **`useDocumentTypes()`** (`src/hooks/useDocumentTypes.ts`,
one cached fetch shared by every reader; the configuration page calls `refresh()` after a save) and
**`pricingOf(type, fallback)`**: `Cost` + editable = a typed cost (Inventory In, purchase documents), `Cost` +
not editable = the read-only average (Inventory Out), `PriceList` = the list price, editable only with the
override permission (sales). The pages no longer hard-code `INV_IN` / `INV_OUT` cost rules; `documentKind.ts`
keeps the direction only (the fallback while the configuration loads). Document numbers run per branch
(`IN-KLW-000012`): the number column is 190 px and never truncates.

**What a type does** (script 79; the fourth switch came with script 90). Switches each meaningful on ONE type,
described in one place, `pages/configuration/documentTypeEffects.ts` (`EFFECT_TEXT`, `stockText`, `stockSentence`,
`effectsText`):

| Type | Field | Default | The form's switch |
|---|---|---|---|
| PINV | `affectsItemCost` | true | "Affects item cost": the invoice's price becomes the cost of the goods received against it |
| PINV | `affectsOnHand` | false | "Affects on-hand (receive the goods when posted)": posting also receives its goods with a goods receipt |
| GRN | `autoCreateOnDelivery` | true | "Create goods receipts when a Delivery is completed" |
| TRO | `needsApproval` | false | "Needs approval before release": a transfer order is sent for approval and released when an approver approves it (script 90; see **Inventory transfers**) |

- The form shows a switch, with its one-line description, only on its own type, under "What it does", and SENDS it only
  for that type (`undefined` otherwise): the request fields are nullable, so an older form never turns one off, and the
  server refuses one sent for another type (62000). Under the invoice's two: "Each invoice keeps the values it was
  posted with…".
- The list has one **What it does** column ("Item cost: yes · Receives on posting: no", "On Delivery: automatic" /
  "by hand", "Approval: yes" / "no", a dimmed "-" elsewhere) with its grid text, so it filters and exports like the
  others.
- The **Stock** column says what really happens: for PINV "None (goods receipts)" or "In, through a goods receipt at
  posting" (green); the stored `stockDirection` is never changed (old invoices read it). The transfer types are stored
  with direction 0 (a dispatch and a receipt each write two legs, which one direction cannot say), and read TRO "None (an
  order)", TRD "Out of the source, onto On the way", TRR "From On the way into the destination" (blue).
- Turning the TRO switch never changes an order already waiting or released: orders waiting stay waiting (an approver
  approves them, or the requester withdraws and releases).
- Where the switches show elsewhere, a missing field (an older API) means today's behaviour:
  - the invoice: `document.affectsCost === false` -> the "Cost of received goods" card says why it is empty
    (`NO_COST_INVOICE_TEXT`) and the posted invoice's Charges card offers no late charge
    (`lateChargesBlockedReason`, the server's 67013 in other words); the post confirmation shows the server's preview
    sentence as it comes, never the "invoice price equals the cost" wording;
  - `document.receiveOnPost === true` (not shipped in containers, something to receive) -> the post confirmation SAYS
    "Its goods are received at once into {warehouse}: …" (`receiveOnPostText`) instead of the "Receive the goods now"
    tick; no goods receipt right is needed, the receipt is the type's rule;
  - after posting, A RECEIPT WAS TRIED when the tick was on OR the answer carries a goods receipt or a `receiveWarning`:
    the page then names the receipt, or shows the warning ("Invoice posted; the goods receipt was not: {reason}. Use
    Receive goods…") - never only "posted". `postResult.receivedByDocumentType` is true only when the type's receipt was
    made or refused (false for goods in containers or nothing left to receive);
  - bulk posts and imports that post: a `BulkActionItemResult` can be ok with a `warning` (orange badge, the warning in
    orange in `BulkResultsModal`) and a `message` saying what was done besides ("Goods received: GRN-…"); an
    `ImportCreateDocument` carries `goodsReceiptNumber` / `warning`, shown under its status, plus a warning
    notification;
  - the invoice list's goods receipts banner says "Posting a supplier invoice receives its goods with a goods receipt…"
    when the PINV type's `affectsOnHand` is on, the "no longer adds stock" sentence otherwise;
  - the movement: `goodsReceiptsAutomatic === false` -> the Complete dialog of a Delivery shows
    `DELIVERY_BY_HAND_TEXT` instead of the per-container preview, the answer's `goodsReceiptsMessage` is shown as an
    info notification, and the Cancel dialog says the movement created no draft when it has none.
- A saved setting is kept: since script 89 the seed values are applied only to a type nobody has saved (before, five
  seeds reset Price / cost editable, Number per branch and the pricing of twelve types at every start).

## The warehouse is a line's, not the document's

Inventory In/Out, Sales and Purchase all take the warehouse per LINE: the lines grid has a Warehouse
column and the header card has no Warehouse field. One document may move stock in several
warehouses.

The header still *has* a warehouse, because the document lists, filters, reports and Excel exports
all show one — but it is now only a label. The editors send `warehouseId: null` in the header and
the server keeps the first line's.

New rows are seeded from the branch's main warehouse (the page's `defaultWarehouseId`), so the
ordinary single-warehouse document still needs no picking; the row's own cell overrides it.

**A line takes a warehouse at the bottom of the tree, of any branch** (Ali, scripts 69-71; goods receipts
too, script 72). The header's branch numbers the document, it does not limit its lines; a warehouse with
warehouses under it is a group, not a place that holds stock, and the database refuses it on save and at
posting. One helper for every document line, `components/documents/lineWarehouses.ts`:

- `lineWarehouseOptions(warehouses, headerBranchId, keepIds)`: the leaves of every branch, the header
  branch's first, the others with their branch named. A warehouse a line already holds stays listed even
  when it is no longer allowed, marked "- has warehouses under it, choose one of those", so an older line
  still shows where it is.
- `defaultLineWarehouseId(warehouses, branchId)`: the branch's main warehouse when it is a leaf, else its
  first leaf - the seed of new rows.
- Changing the branch leaves the lines alone; only the seed of NEW rows goes back to the new branch's.

Goods receipts keep their own grouped pickers (`warehouseChoices` in `goodsReceiptModel.ts`, one group per
branch, the receipt's or document's branch first) with the same rule: leaves only, a kept parent marked the
same way. A container's receipt offers the leaves of the container's branch only; an order's, an invoice's or
a receipt without an order, the leaves of every branch. On a receipt without an order a branch change sets
"Receive into" (where new lines start) to the new branch's default and leaves the lines alone. The container
form's "Warehouse (offloading destination)" offers the branch's leaves; a draft goods receipt takes it as
"Receive into" only when it is one ("warehouse to choose" otherwise, and the Delivery's Complete dialog and
notification say why).

The Warehouses form greys out, as a parent, a warehouse already used in transactions (`isUsed` of the
lookup: stock movements, documents, containers, goods receipts...), with " - used in transactions, cannot
be a parent"; the current parent stays selectable.

The import creates ONE document however many warehouses the file names — or, on Sales Invoice and
Inventory In when the reader asks for it, one document per warehouse; see below. Each row keeps the
warehouse the file gave it.

## Inventory transfers: the warehouses are the document's

**Inventory › Transfer Orders** (script 90; `/inventory/transfers`, `/new`, `/:id`, and the dispatch note
`/:id/dispatches/:postingId/print` outside the shell; permissions `inventory.transfers.view / create / delete / release /
approve / dispatch / receive / close / cancel / reverse`) moves stock from one warehouse to another of any branch without
changing its cost. A **dispatch** (TRD, numbered by the source branch) takes the pieces out of From onto the hidden **On
the way** warehouse of the destination branch; a **transfer receipt** (TRR, numbered by the destination branch) takes them
from there into To. The client is `src/api/inventory/transfers.ts`; the pieces are in `src/components/transfers/`
(`transferStatus.ts`, `transferAbilities.ts`, the header, lines and postings cards, the approval notice, the Dispatch and
Receive dialogs).

- **The exception to "the warehouse is a line's".** From and To are on the HEADER, and every line leaves From and goes
  to To ("The warehouses are the order's: every line leaves From and goes to To."). A transfer is one journey between
  two places - one truck, one dispatch note, one receipt at the other end - and a warehouse per line would make one
  order of several journeys. From and To are leaves of any branch, grouped by branch with the order's first, never an On
  the way warehouse, never the same one; a held warehouse no longer allowed stays shown and marked as
  `lineWarehouses.ts` does. The number is given at the first save, by From's branch then.
- **Stored and shown statuses** (`transferStatus.ts`). Stored: Draft, Waiting for approval, Released, Cancelled. A
  released order SHOWS, the first that applies, Released, Partly dispatched, Dispatched, Partly received, Closed
  ("Nothing more will be sent"), Received: the server's `displayStatus`, from its counters, as purchase orders show Saved
  / Partially posted / Posted. Colours: Draft gray, Waiting for approval yellow, Released blue, Partly dispatched
  orange, Dispatched indigo, Partly received orange, Received green, Closed teal, Cancelled red; a reversed dispatch or
  receipt orange. Beside the status a red filled "Late" badge, and an orange "{n} lost" badge once goods were written
  off.
- **Ordered in the unit, every counter in pcs.** Ordered is typed in the line's unit ("= 24 pcs" dimmed when it is not
  the base unit); Dispatched, Received, To dispatch, Not sent and Lost are pcs. **On the way is never a column of the
  lines grid**: it belongs to a dispatch, so it is on the totals row (Ordered, Dispatched, Received, On the way, Not
  sent, Lost) and on each dispatch of the "Dispatches and receipts" card.
- **The dialogs post directly.** There are no draft dispatches or receipts: Dispatch…, Receive… and Dispatch and
  receive… post what they show, each in one transaction (Dispatch and receive needs both rights, and posts both or
  neither). They are xl, full screen below 48em, and their disabled button says why (`FormModal`'s `fullScreen` and
  `saveDisabledReason`).
- **Receipt before dispatch.** Reverse… undoes one whole dispatch or receipt, with a reason and a "Reversal date"; a
  dispatch whose goods were received or written off waits for that receipt ("TRD-… has goods received by TRR-…: reverse
  that receipt first."): the row's Reverse… is disabled with the server's `reverseBlockedReason`. Goods turned back
  before they arrive: reverse their dispatch. Goods sent back after they arrived: Create return… (a new order the
  other way).
- **Late** is the server's, in UTC: a dispatch with pieces on the way after its ETA, or a released order with something
  still to dispatch after its Expected arrival. A red filled "Late" badge and the list's "Late only" switch; never
  "Overdue".
- **The approval switch** (Configuration › Document Types, TRO, "Needs approval before release", off by default). On,
  Release is hidden and "Send for approval…" (for approvers also "Approve & release") takes its place; the order waits,
  locked, and its approvers - the users holding Approve Transfer Orders - see the menu's count
  (`useTransfersWaiting`) and the list's "Waiting for approval" switch, and are emailed.
- **One rule per button** (`transferAbilities.ts`): the reader's permission hides, the server's `abilities.{action}`
  (allowed, reason) disables with its sentence, in `DocumentActionBar`; while the page has unsaved changes the actions
  that change the order say "Save your changes first.".
- **On the way warehouses** (`isTransit`, one per branch, made and kept by the system). No picker offers them but Stock
  Valuation's (`warehousesApi.lookup(activeOnly, branchId, includeId, includeTransit = true)`: "OTW-BR-002 - On the way
  to BR-002 (transfers)"). The Warehouses page shows them with an "On the way" badge and offers neither Deactivate nor
  Delete; their form edits Name and Address, the rest is text with "Managed by transfers: the On the way warehouse of
  {branch}." (`pages/masterdata/transitWarehouse.ts`); the Parent picker never lists them.
- **The barcode's unit, on this page only.** `QuickItemSearch` passes `onPick(item, term)` the text scanned; the
  transfer page takes the unit whose barcode it is, else the base unit, and a second scan of the same item and unit adds
  1. Every other page ignores `term`.
- **Values only with the permission.** Without `inventory.valuation.view` the server sends the order's
  `onTheWayValueBase`, a posting's `valueBase` / `lostValueBase` and a line's `unitCostBase` / `lossUnitCostBase` as null,
  never 0: the page then leaves the figure out ("—" in a value column), it never shows a 0 that is not one. The
  dispatch note never shows a cost.
- **`CancelReasonModal`'s `withDate.label`** names the date field when it is not a cancellation's: Reverse… passes
  `{ minDate: the posting date, label: 'Reversal date' }`; the sales cancel of script 84 keeps "Cancellation date".
- **The Email log links by category.** `TransferApproval`, `TransferApproved` and `TransferRejected` ("Transfer approval
  request", "Transfer approved", "Transfer rejected") are about a transfer order: their Document cell reads "Transfer
  order #{id}" and opens it (`isTransferCategory`, `api/emails.ts`), as text for a reader without
  `inventory.transfers.view`. Every other category keeps its purchase-order link.
- **The dispatch note** (`TransferDispatchPrintPage`, "Print dispatch note" on a dispatch's row): like the goods
  receipt's count sheet, outside the shell, A4 portrait, the browser's print dialog at once: "Dispatch note {TRD}", the
  transfer order, From → To, the dates, "Waybill / truck", the lines in pcs, the total, and three signature boxes
  ("Dispatched by", "Driver", "Received by").
- **`FormModal`'s options** (`closeOnEscape`, `fullScreen`, `saveDisabledReason`, and the nested form's submit ignored)
  came with these dialogs: see **Modals and the keyboard**.
- **Around them.** The item statement opens a TRD or TRR row, and its TRO, on the order (`transferOrderId`; the
  counterparty reads "LKS-01 → LUB-01"). Shortages count what is on the way to a warehouse as **Transfers in** (see
  **Shortage plans**). The Dashboard's Inventory value of one branch says, on hover, that it includes goods on the way
  to that branch's warehouses (its "Stock value by warehouse" chart shows an On the way slice). Inventory In / Out show
  a gray hint under the reason "Transfer in" / "Transfer out" (TRF_IN / TRF_OUT): "Moving stock between your own
  warehouses? Inventory › Transfer Orders moves it without changing its cost and follows it on the way." Sales Profit's
  COGS adjustments header says, on hover, that adjustments stay in the branch that received the goods.

## Bulk actions

Every document list carries a checkbox column (`DataTable` props `selectedRecords`,
`onSelectedRecordsChange`, `isRecordSelectable` — only drafts the reader may post or delete are
selectable) held by **`useBulkSelection()`** so the selection survives paging. `BulkActionsBar` shows
"3 selected: Post selected / Delete selected / Clear" above the grid; each action confirms, calls
`bulk-post` / `bulk-delete` (one call per document on the server, one refusal never stops the others),
shows **`BulkResultsModal`** (number, result badge, message per document), drops the succeeded rows from
the selection and reloads the grid. Sales and purchase lists reuse the same three pieces.

## Import: one document, or one per warehouse

`ImportInvoiceItemsWizard` always sends the hosting page's `documentTypeCode` (the template download uses
it too, and the preview shows a **Type** column; rows typed for another kind are Errors). When the
validated rows span several warehouses and the host passed **`importCreate`**, step 3 lists them
("WH-001 - 12 lines, WH-002 - 3 lines") with a "Post immediately" checkbox and creates **one** document
through the family's `import-create` endpoint — every line keeping the warehouse the file named. The
result's Warehouse column says "2 warehouses" rather than naming one (`warehouseCount`); "Go to the
list" calls `onDocumentsCreated`, where the host navigates with `state.highlight` (the list tints those
rows). With one warehouse the lines are appended as before; if it is not the seeded warehouse the wizard
asks "The file is for WH-002 — switch the document to WH-002?" and calls `onSwitchWarehouse`, which now
moves the lines and the seed rather than a header field.

**One document per warehouse** is a choice the reader makes on every import, on the pages whose host
passes **`allowSplitByWarehouse`**: Sales Invoice and Inventory In (not Inventory Out, BIVAC Out, purchase or
Import Sales). Step 3's groups panel then shows a Mantine `Switch` — "One invoice per warehouse" on the sales
page, "One document per warehouse" on Inventory In — **off by default**, described "Off: one invoice
holding every warehouse. On: one invoice per warehouse (2 invoices)." The panel follows it: the alert,
a **Becomes** column on each warehouse row ("Lines on the one new invoice" / "New invoice 1 of 2"), the
"Post immediately" description and the button ("Create 1 invoice" / "Create 2 invoices, one per
warehouse"). The host's `importCreate(lines, postImmediately, splitByWarehouse)` sends
`splitByWarehouse` in the request; the server makes one document per warehouse in the file's order, each
with the shared header, its own line numbers and its own posting, so one refusal never stops the others.
The result lists every document with its warehouse and a link (it scrolls past a few rows), and each
refusal starts with the warehouse it concerns. The audit: a sales invoice gets its "Imported" entry from
the log the wizard writes with its id, so a split writes **one log per invoice**, each counting that
warehouse's rows; stock documents keep the one log with the draft reference. Off — or a file naming one
warehouse — is exactly the single document above.
## Sales invoice page

`/sales/invoices` (list, `SalesInvoicesPage`) and `/sales/invoices/new` / `/:id` (`SalesInvoicePage`) are
the priced document on the same skeleton as Inventory In: a header card, an editable lines grid, the
summary and audit cards, the sticky action bar, a Documents card, a Draft → Posted → Cancelled
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
  mixed-warehouse invoice through `importCreate` (Manual prices only are sent).
- **Errors**: `Line N:` messages land on line N; INSUFFICIENT_STOCK highlights every line of the named
  item and refreshes its On Hand; CONCURRENCY reloads. Same unsaved-changes guard as Inventory In.
- **Out of stock and goods receipts**: before posting, `decideOutOfStock(id, canViewGoodsReceipts)` asks the stock
  check; for a reader with `purchase.goodsreceipts.view` it also looks for DRAFT goods receipts holding the items short
  (the drafts whose search matches the item code, confirmed on their lines) and the warning (or the refusal) adds "A
  goods receipt is waiting to be posted: GRN draft of KTG-2026-0031." Nothing found or not readable: the warning as
  before.
- **List**: filters (search, branch, client, salesman, status, dates), bulk Post / Delete on ticked
  drafts, a total in the invoice currency ("$ 5,000.00 USD"), row actions gated by permission and status.

`DocumentAttachmentsCard` and `AuditTrail` are shared by every family: the card takes the family's file
endpoints through `api` (required) and both read structural DTOs (see **Attachments (documents on every page)**).
## Purchase documents

`/purchase/orders`, `/purchase/invoices` and `/purchase/returns` (lists, `PurchaseDocumentsPage`) and their
`/new` / `/:id` document pages (`PurchaseDocumentPage`) are **one component each, parameterised by
`kind: PurchaseKind`** (`src/components/purchase/purchaseKind.ts`: PO blue, PINV green, PRET orange —
title, plural, noun, route, colour, the posting wording and the five `purchase.<kind>.*` permissions).
Nothing in the pages branches on `'PO'` except through that table. They sit on the sales invoice skeleton
in **cost mode**:

- **One URL per document, built in one place.** Every link to a purchase document uses
  `routes.purchaseOrder(id)` / `purchaseInvoice(id)` / `purchaseReturn(id)` / `purchaseDocument(typeCode, id)`
  (`src/routes.ts`). This covers the lists, the containers list and container page, the shortages, the
  linked documents and the source chip. The page decides everything from the document it LOADS: its type,
  status, containers and invoicing figures, plus the reader's permissions. Never from the route it came
  from, a query string or navigation state; only a `?tab=` may choose the tab that opens. A URL whose kind
  does not match the loaded document (`/purchase/invoices/<an order's id>`) is replaced by that document's
  own route.
- **A page instance per document.** The six document routes render `PurchaseDocumentRoute`, which keys
  `PurchaseDocumentPage` per document. Without that key, React reused one instance from an order to its
  invoice and back (ticked containers, lookups loaded for the other kind, a frame of the previous document).
  The one exception is `/new` turning into `/:id` on the first save, which keeps its instance.
- **What can be done on an order, and why not: `orderAbilities`** (`src/components/purchase/orderAbilities.ts`).
  It returns `{ visible, blockedBy }` for every order button. A missing permission hides the button. An
  order that is not approved keeps the button visible and disabled, with the reason as its
  tooltip (`OrderActionButton`, or `disabledReason` in the action bar):
  - draft: "Approve the order first: containers / invoices are created from an approved order.";
  - PendingApproval: "This order is waiting for approval.";
  - cancelled: "This order is cancelled.".

  An approved order (Saved, Partially posted or Posted, below) is never closed: each button then follows its figures
  ("Everything ordered is already invoiced." on a Posted one).

  The **Containers card** shows on every saved order to readers with `containers.view`. Its Add Container… /
  Auto-plan containers… buttons need `containers.create`, and Create Invoice from Containers… needs
  `purchase.invoices.create`. The action bar's Create Purchase Invoice reads the same
  object. A new order action, approval ones included, is added there, not decided in its button.

  **`receiveGoods`** ("Receive goods…", `purchase.goodsreceipts.create`) has reasons of its own and never
  `notOpenReason`, because goods may arrive before or after their invoices, whatever the order shows: draft "Approve the order first:
  goods are received against an approved order.", waiting "This order is waiting for approval.", "This order is
  cancelled.", then the server's `canReceive` / `receiveBlockedReason`, else the lines' figures: "Everything ordered is
  already received.", "Everything still to receive travels in containers: it is received with its containers." (and
  "The rest is in draft goods receipts: post or delete them first." when drafts hold it).
- **Posting and receiving (scripts 64-65).** Goods enter the stock only with a goods receipt (see **Goods receipts**).
  A supplier invoice posted since the switch moves no stock: it becomes payable and sets the cost of what was received
  against it. The page says so in every text that names posting, from `purchaseKind.ts`:
  - **Posting wording.** Order: "Confirm this purchase order? The number is assigned and the ordered quantities count
    as incoming stock until they are received.", banner "{Saved | Partially posted | Posted} — PO-…": "Confirmed by
    {user} on {date}." + what its posted invoices cover ("No supplier invoice is posted against it yet." / "Posted
    invoices cover 60 of 100 pcs." / "Posted invoices cover everything ordered (100 pcs).") + "Its quantities count
    as incoming stock until they are received, and goods can be received and invoiced against it.". Invoice:
    `PURCHASE_INVOICE.postConfirm` "Post this purchase invoice? The number is assigned and the amount becomes payable
    to the supplier. The stock does not change: goods enter with goods receipts.", banner "Posted by {user} on {date}."
    + `invoicePostedBanner` "Received so far: {r} of {q} pcs.". Return: unchanged, "…Stock will be removed from
    {warehouse} at the invoice cost…". Never write that a posted invoice "adds stock" (only an invoice posted before
    the switch keeps that text, below).
  - **The invoice's post confirmation** (`askInvoicePost`, `invoicePostQuestion.tsx`) adds the estimate of
    `GET api/purchase/documents/{id}/receipt-cost-preview` (`receiptCostPreviewText`): "60 pcs already received will have their cost adjusted
    by +60.00 USD (estimate: stock 40.00, cost of sales 20.00)." or "No goods received yet: their cost will be this
    invoice's when they arrive." When the difference is 0.00 on every line it says instead "The invoice price equals
    the cost of the {n} pcs already received: their cost does not change." (`receiptCostUnchangedText`), whatever the
    server's `message` wrote. For a LOCAL invoice, read by someone with goods receipts create + post, with pieces
    left to receive, it adds the checkbox "Receive the goods now into {warehouses of the lines}" (`ReceiveNowChoice`,
    off by default), sent as `receiveNow`. The posting's `message` is shown as it comes: a warning when the receipt was
    not made (the invoice stays posted).
  - **An old local invoice** (posted before the switch, `usesGoodsReceipts` false, `receiptMode` 1) keeps the texts of
    its time: `PURCHASE_INVOICE.postedBanner` "Stock has been added…", the gray hint `LEGACY_INVOICE_TEXTS.hint`
    "Posted before goods receipts: its stock entered when it was posted (or when its container was offloaded).", "No -
    stock in on posting" (`legacyReceipt` on `PurchaseHeaderCard`) and the Containers card's "Received when the invoice
    was posted: no containers needed." An **older "Shipped in containers" invoice** (mode 2) is not legacy: its
    containers may still be travelling and are received with goods receipts, so it shows "Received so far: {r} of {q}
    pcs." and "Yes - received with its containers"; only when the server gives the hint as the reason for "Receive
    goods…" (every container offloaded the old way) does it add the gray hint and the card's "Shipped in containers:
    the goods entered the stock when these containers were offloaded." Decide from the loaded invoice's
    `usesGoodsReceipts` and `receiptMode`, never from today's date.
  - **Cancel** says what it does (`CancelReasonModal description`): on a supplier invoice that brought no stock of its
    own (`usesGoodsReceipts`, or mode 2) "Cancelling makes the amount no longer payable and leaves the invoice in place
    as a record. The stock does not change: goods already received go back to the order price (goods without an order
    keep their cost at receipt), and the difference is booked to the stock value and the cost of sales. It cannot be
    undone."; on an order "Cancelling leaves the order in place as a record: it no longer counts as incoming stock, and
    nothing can be received or invoiced against it. The stock does not change. It cannot be undone."; an old local
    invoice keeps the default (its cancel reverses its stock rows).
  - **Receive goods…** opens the shared `ReceiveGoodsModal` (source `order` or `invoice`) on an approved order (action
    bar, and a row action on the order list; `orderAbilities.receiveGoods` above) and on a posted invoice, disabled
    with `invoiceReceiveReason`: "Post the invoice first: goods are received against a posted invoice, or from the
    order.", "Every piece of this invoice is already received.", "This invoice's goods travel in containers: they are
    received with their containers.", or the old invoice's hint. The server's `canReceive` / `receiveBlockedReason`
    come first.
  - **Received, Invoiced, Short: three different numbers.** On an order line, **Invoiced** is `receivedQuantityBase`
    (the old name: it has always meant invoiced by posted invoices), **Received** is `goodsReceivedBase` (posted goods
    receipts, plus what came in before them) and **Short** is `goodsShortBase` (settled short: received less with a
    reason, or "Nothing more will come"). Never show `receivedQuantityBase` under the word "Received" on an order.
    On an invoice line, Received is the line's `receivedQuantityBase` (the receipt pieces matched to it). An order is
    done when Invoiced ≥ ordered and Received + Short ≥ ordered. `PurchaseLinesGrid receipts="order"` shows the three
    on an approved order, `receipts="invoice"` shows Received on a posted invoice; the order's progress card
    adds Received ("66 / 150 pcs (+4 short)"). The other figures of a line (`toReceiveBase`, `inContainersBase`,
    `inDraftReceiptsBase`, `outstandingBase`) are the server's: never recompute them.
  - **"Cost of received goods"** (`InvoiceReceiptCostCard`): the invoice's `costAdjustments`, with the sentence "Cost of
    received goods adjusted: +120.00 USD (stock 80.00, cost of sales 40.00)" above the detail.
  - **Linked Documents** lists the document's `goodsReceipts` under "Goods receipts" (links only with
    `purchase.goodsreceipts.view`).

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
  / Cost column is the unit cost; a multi-warehouse file becomes one mixed-warehouse document through
  `purchaseDocumentsApi.importCreate`.
- **Summary** (`SalesTotals` reused): subtotal, discount, grand total in the document currency and the
  "≈ … USD" line at the document rate. **Linked Documents** (`LinkedDocumentsCard`): the source and every
  document created from this one, each with its status (a linked order's from its `invoicingStatus`) — a
  cancelled invoice under an order brings the order back to Partially posted or Saved.
- **Lifecycle**: Draft → Posted → Cancelled for invoices and returns. **Orders (script 77)**: Draft → (Waiting for
  approval) → approved → Cancelled, and an approved order SHOWS how far its POSTED invoices cover it:
  **Saved** (blue, none yet), **Partially posted** (orange, invoiced < ordered), **Posted** (green, everything
  ordered). The API keeps the status `'Posted'` for all three (every "is it approved?" test reads it) and sends
  `invoicingStatus` 0 / 1 / 2 beside it, on the document, the list rows, the linked documents, the shortage plan's
  orders and the item's orders. Never compare an order's status with 'Saved' or 'PartiallyPosted': show it with
  `purchaseStatusLabel(status, documentTypeCode, invoicingStatus)` / `purchaseStatusColour(…)` (`purchaseKind.ts`),
  and test "approved" with `status === 'Posted'` (`isApprovedOrder`). Draft invoices do not count, and purchase
  returns do not lower it (they never lowered the order's invoiced counters). Goods receipts never change it.
  **There is no Closed any more**: no Close Order, no closed banner; the orders closed before script 77 were brought
  back (the pieces given up by a close by hand were settled short, so what they still expect did not change). Pieces
  that will never come are settled with "Nothing more will come" on a goods receipt. The document page shows the
  status as a badge in its header, and the Saved / Partially posted / Posted banner above. Confirmations say what posting does per kind — an order is *confirmed* and its quantities count as incoming
  until they are received; an invoice becomes payable and moves no stock (goods enter with goods receipts); a return
  removes stock at the invoice cost. View mode offers Export, **Receive goods…** (approved order, posted invoice;
  needs `purchase.goodsreceipts.create`), **Create Purchase Invoice** (open order, needs
  `purchase.invoices.create`), **Create Purchase Return** (posted invoice, needs `purchase.returns.create`),
  Cancel Document, Back. Posted and cancelled documents are read-only text.
- **List**: filters (search, branch, supplier, status - `purchaseStatusFilters(kind)`: orders Draft / Waiting for
  approval / Saved / Partially posted / Posted / Cancelled, sent as `status` Posted + `invoicingStatus` 0 / 1 / 2 for
  the three stages; invoices and returns Draft / Posted / Cancelled - dates, and the checkbox
  "To receive" on orders / "Not fully received" on invoices, sent as `toReceive` / `notFullyReceived`), a Source
  column that links to the order / invoice, on orders a **Received** (`receivedPercent`, goods receipts) and an
  **Invoiced** (`invoicedPercent`) progress bar, each a share of the ordered quantity, on invoices a **Received** bar
  (`receivedBase` ÷ `quantityBase`) - the figure and its meaning on hover, the share in the CSV export - bulk Post /
  Delete on ticked drafts, row actions gated by permission and status including "Receive goods…" (orders; disabled
  "Everything ordered is already received." at 100 % received) / Create invoice (disabled "Everything ordered is
  already invoiced." at 100 % invoiced: a Posted order) / Create return. The Status column, its funnel and the CSV
  show the words (Saved, Partially posted, Waiting for approval), not the API's names. The percentages are rounded, so these are
  hints: the dialogs check the document itself (`CreateInvoiceFromOrderModal` says "Everything ordered is already
  invoiced." or "The rest of this order is already in draft invoices: post or delete them first." and disables
  Create). The invoice list shows the readers who post invoices a blue banner, once (closing it is
  remembered in `localStorage`, guarded): "Since {switch date}, posting a supplier invoice no longer adds stock:
  receive the goods with Receive goods…" (the date from `GET api/purchase/goods-receipts/switch`).
- **Charges card (invoices)**: one **"+ Add charge"** in every status, and what it adds depends on the invoice:
  - **local draft**: the invoice's own charges (`PurchaseChargesGrid`, saved with the draft; `purchase.invoices.create`);
  - **local posted** (not "Shipped in containers": such an invoice counts as imported even before a line is linked -
    the late charges API refuses it with 67012's sentence, as the database does): `PostedInvoiceChargesCard`. It lists
    the charges posted with the invoice (badge
    "With the invoice", read-only) and the **late charges** (badge "Late" plus the adjustment status and
    number). "+ Add charge" opens `LateChargeModal`, which saves a draft late charge into the invoice's
    open landed cost adjustment (`src/api/purchase/lateCharges.ts`, `purchase.landedcosts.create`).
    Draft ones can be edited and deleted. **"Post late charges (n)"** (`purchase.landedcosts.post`)
    posts that adjustment and shows each line's landed cost per unit, before and after. The page then
    refreshes quietly (`refreshQuietly`), without the page-wide loader, so the result stays on screen;
  - **imported** (draft or posted): the container charge dialog (`NewChargeModal`) with the invoice's
    containers preselected, split By pieces (`containers.charges.create`). Its drafts show a
    "Post it in Container Charges" link.

  There is no "New landed cost adjustment" action on the invoice any more: "+ Add charge" replaces it.
- **Shipped in containers (invoices, script 43)**: a switch in the header is the invoice's receipt mode. It says
  **how the goods arrive**, never when the stock moves (no invoice moves stock since goods receipts).
  - On: its goods travel in containers and come in with their containers' goods receipts. The switch's description
    is "Its goods travel in containers and are received with them."; read-only it says "Yes - received with its
    containers". `ShippedInvoiceContainersCard` says "Shipped in containers: the goods enter the stock when their
    containers' goods receipts are posted." Receive goods… on such an invoice starts every line at 0, with the orange
    alert: pieces are received there only when they came without a container. A line not linked to a container is
    still matched to the goods of its order's containers when they are received.
  - Off: the goods are received with Receive goods… ("No - received with Receive goods…"; the card: "Received with
    Receive goods…: no containers needed.").
  - Before goods receipts off meant stock in on posting: an old local invoice keeps that text in the header and the
    card (`LEGACY_INVOICE_TEXTS`, `ShippedInvoiceContainersCard legacy`). An older shipped one reads like a new one,
    except a card whose containers were all offloaded the old way (above).
  - An invoice shipped in containers has no charges of its own and no landed cost adjustment (67012): its charges are
    the containers'.
  - It is disabled with a tooltip while lines are linked, and on an invoice that is not from an order.
  - An invoice created from an order with containers starts on.
  - While it is on, `ShippedInvoiceContainersCard` replaces the side card "where are my goods"
    (`InvoiceContainersCard`). Per item it shows invoiced, pieces per container (or an orange link to set the
    Container unit), containers needed "2.5 (2 full + 42 pcs)", linked, and not linked (orange).
  - Its linked containers can be unlinked while Draft or Confirmed.
  - Its buttons:
    - **Link containers…** (`LinkContainersModal`): candidates grouped by container; containers that started
      moving are never offered;
    - **Add container…**: `AddContainerModal` with `invoice`;
    - **Auto-plan…**: `AutoPlanModal` with `invoice`.
  - Both dialogs keep the order's form and call `src/api/purchase/invoiceContainers.ts`, which creates and
    links in one transaction.
  - Linking rewrites the invoice's lines, so the card refuses while the page has unsaved changes.
  - The lines are grouped by container, the rest under "Not in a container yet".
- **One item per supplier invoice (script 45, optional since script 63)**: an invoice of one item holds one item,
  over any number of lines; an invoice of several items holds any.
  - The setting **Purchase.OneItemPerInvoice** (Configuration > Settings > General, public, on by default) is the
    default. Each invoice keeps the mode it was created with: `oneItemOnly` on the purchase document (an older
    invoice follows the setting). A new invoice sends `oneItemOnly` = what the page applied (the setting); an
    update never sends it. Read the setting with `useOneItemPerInvoice()` (`components/purchase/onePerItem.ts`): it
    is on while loading or unreadable, and `known` says whether it was really read. **The browser never sends its
    guess**: while the setting is not known, every request carries null for the mode (`oneItemOnly`, `onePerItem`;
    `onePerItemToSend()`), and the server applies the setting it has.
  - "Create Purchase Invoice" (`CreateInvoiceFromOrderModal`, order page and order list) and "Create Invoice from
    Containers…" have a **One invoice per item** Switch, starting from the setting and chosen for this creation
    (`onePerItem` in the request; null = the setting, sent while the reader has not flipped it and the setting is not
    known; when it could not be read, the switch's description says the server's setting decides). The preview says
    "One invoice per item: n invoices will be created (codes)", or off "One invoice with n items" ("One invoice per
    order: …" for lines of several orders).
    Both take the exporter's ref. and the commercial invoice no., copied to every invoice. One invoice opens as
    before; several are listed in `CreatedInvoicesModal` (Open links, "Go to the order's invoices"; `onePerItem`
    false shows Lines instead of Item).
  - **The two dialogs are built the same way** (script 86): Document Date (`DatePickerInput`, not in the future,
    today by default), the two references, then a grid of what can still be invoiced, each row ticked with its
    available quantity in pcs - a `NumberInput` (`max` = available, "Max n" and Create disabled above it) the reader
    may lower, or untick the row - then the switch and its line. "Create Invoice from Containers…" groups the
    container lines by container (Item, Order, Loaded, Invoiced, In drafts, Available; `containersApi.invoiceCandidates`);
    "Create Purchase Invoice" heads its grid with the order (number, supplier, its Saved / Partially posted / Posted
    badge) and lists the order lines (#, Item, Warehouse, Ordered, Invoiced, In drafts, Available;
    `purchaseDocumentsApi.invoiceCandidates`, which leaves out the lines with nothing available) and sends the ticked
    rows as `lines` [{ sourceLineId, quantityBase }] to `create-invoice`. Both draw 200 rows at a time
    (`useShownRows`).
  - On an invoice of one item with a line, the item select offers only that item (`PurchaseLinesGrid`
    `onlyItemId`) and the quick search refuses another, with `ONE_ITEM_HINT`. Such a draft holding several items
    (made before) shows an orange Alert and **Split by item**, which lists the invoices in the same modal. An
    invoice of several items shows its lines normally; **Split by item** is an optional action in its action bar
    (each resulting invoice then holds one item).
  - The order's Linked Documents card ticks its draft invoices and posts them with **Post selected** (`post-many`,
    one refusal does not stop the others, results in `BulkResultsModal`).
  - The invoice list has an Item column: code - name for an invoice of one item, "n items" for one of several
    (an orange badge on a draft whose row says `oneItemOnly` true with `itemCount` > 1: one item, saved with several
    before that rule, to split); its search matches the item code.
  - The Excel import follows the open invoice's mode: the wizard gets `onePerItem` = its `oneItemOnly`, and the page
    sends the same `onePerItem` to `import-create`, so the server creates what the wizard announced whatever the
    setting (a new invoice whose setting is not known sends null). On an invoice of one item, a file of several
    items, or of another item than the open invoice's, becomes new invoices, one per item; the result lists each with
    an Open link. On an invoice of several items the rows are appended (a file of several warehouses becomes one new
    invoice of every item).
- **API**: `src/api/purchase/documents.ts` — one module for the three kinds; every 403 from it names the
  permission that was missing (`code: FORBIDDEN`).

## Goods receipts

Purchase › **Goods Receipts** (scripts 64-65) is the only way supplier goods enter the stock: a posted supplier invoice
no longer moves stock, it adjusts the cost of goods already received. A **family of its own** (no prices, currency or
approval), not a fourth `PurchaseKind`: `src/api/purchase/goodsReceipts.ts` (`goodsReceiptsApi`, every route of
`api/purchase/goods-receipts`), the pieces in `src/components/purchase/goodsReceipts/` (the shared sentences in
`goodsReceiptModel.ts`), the pages `GoodsReceiptsPage` / `GoodsReceiptPage` / `GoodsReceiptPrintPage`
(`src/pages/purchase/`), links through `routes.goodsReceipts / goodsReceipt(id) / goodsReceiptPrint(id) /
newGoodsReceipt(supplierId)`. Permissions `purchase.goodsreceipts.view / create / post / cancel / delete`
(`PERMISSIONS.goodsReceipts*`; never "receipts" alone: `sales.receipts.*` is customer payments). Status is a code
(`GOODS_RECEIPT_STATUSES`: 1 Draft gray, 2 Posted green, 3 Cancelled red; `toGoodsReceiptStatus` also reads the
name); a receipt has one source, `sourceKind` Container / Order / Invoice / Manual. **The goods are not in stock until
the receipt is posted**: every draft says so ("The goods are not in stock until this receipt is posted.").

- **The menu count** (`countOf: 'draftGoodsReceipts'`, icon `inbox`, after Approvals) is the drafts waiting to be
  posted: `draftCount` of `GET …/waiting`, read by `useGoodsReceiptsWaiting()` the way the approvals count is read (one
  reading for the whole app, every minute and on focus, only for a reader with the view permission; hidden at 0).
  Anything that creates, posts, deletes or cancels a receipt calls `refreshGoodsReceiptsWaiting()`, so the count moves
  at once. It is how the warehouse learns that a Delivery made drafts.
- **The list** (`GoodsReceiptsPage`, "Goods entering the stock: from containers, orders and invoices.")
  - Opens on Status = Draft when drafts exist, until the reader picks a Status themselves: that choice is remembered in
    `localStorage` (`inventory_shipment.goodsReceipts.status`, read and written in try/catch). Clear Filters goes back
    to every status.
  - Filters: search ("Number, container, order, invoice or item"), Status, Source, Branch, Supplier, Warehouse, dates,
    "With differences", "Received not invoiced".
  - Columns: Number ("Assigned on posting" in gray on a draft), Date, Status, Source ("Container KTG-2026-0031",
    "Order PO-…", "Invoice PINV-…", "Manual", with a violet **Auto** badge when a Delivery made it), Supplier ("Several
    suppliers" on a mixed container), Warehouse (an orange "to choose" on a draft without one), Received (pcs), Short
    (pcs, red when above 0), Value (USD).
  - The totals row of the search is the line under the grid: "Received not invoiced: {n} pcs, {value} USD at the order
    price." (month-end).
  - Row actions View, Print, Post (draft), Delete (draft), Cancel… (posted), each by permission. **Post and Cancel…
    read the receipt first** (`goodsReceiptsApi.get`; the list carries no `canPost` / `canCancel`, too costly over a
    search of thousands): when `canPost` / `canCancel` is false, a dialog "{GRN-… | draft #n} cannot be {posted |
    cancelled}" shows the server's `postBlockedReason` / `cancelBlockedReason` with "Open the receipt" and "Close",
    instead of the dialog (never a refusal after a cancel reason was typed); otherwise Post asks `postConfirmFor` on
    the receipt read, as the page does, and Cancel… sends the row version just read. Bulk Post
    (`post-many`) and Delete (one `DELETE` per draft, with its row version) show `BulkResultsModal`; deleting
    automatic drafts warns that their containers then wait without a receipt.
  - Empty: "No goods receipts yet. They are created when a container's delivery is completed, with Receive goods… on
    an order, an invoice or a container, or with + New."
- **"+ New"** (create permission) opens `NewGoodsReceiptModal`, "Where do the goods come from?":
  - "From a purchase order…": the supplier, then its orders with something to receive (the `documents` of
    `GET …/receivable?supplierId=`), then `ReceiveGoodsModal`;
  - "From a container…": `GET …/receivable-containers` (status 2-5 and no draft or posted receipt, delivered ones
    first); the draft is created and opened. The create permission is enough (no `containers.view` needed);
  - "Without an order": a supplier first, then `/purchase/goods-receipts/new?supplierId=`, with the hint "For stock
    that does not come from a supplier (opening balance, correction, found goods), use Inventory › Inventory In."
- **The page** (`GoodsReceiptPage`) decides from the receipt it loads.
  - A container's lines are its load lines (none added or removed): received 0 to loaded, a reason code
    (`VARIANCE_REASONS`: Short-shipped, Damaged, Missing, Wrongly counted at loading, Other) and a note when they
    differ, one "Receive into" for the whole container (warehouses of its branch). An order's or an invoice's lines take
    a warehouse each and "Nothing more will come" (its reason fields appear when ticked); "Receive into" sets every
    line. A line of 0 needs "Nothing more will come" (a line of an order) or more than 0: the page refuses it before
    saving with the server's sentence ("Line {n} ({item}): the received quantity must be more than 0, or tick "Nothing
    more will come" to settle the rest of the order line." / "…must be more than 0."), and the server never drops a
    line, so "Line N" is the N-th row on screen. Such a line can be left out of the draft with its trash icon ("Remove
    line: its pieces stay to receive"). Only a receipt without an order adds lines ("+ Add line") and types its unit
    cost (default: the item's last cost).
  - Alerts: the blue automatic-draft one ("Created automatically when MOV-… (Delivery, Kasumbalesa → Kolwezi) was
    completed on {date}. Proposed warehouse: LUB-WH (from the container). Check the warehouse and the received
    quantities, then post."; the "Proposed warehouse" sentence only while the saved draft still holds the container's
    own warehouse, of its branch), the orange "Choose the warehouse the goods are received into: the container's warehouse
    is not set or does not belong to branch {branch}.", the orange "KTG-… has not left the supplier…" of a container
    still Confirmed, and the gray draft hint.
  - Post, Cancel… and Delete are disabled with the API's `postBlockedReason` / `cancelBlockedReason` /
    `deleteBlockedReason` (the same sentences SQL refuses with). With unsaved changes Post saves first and judges the
    saved receipt. Post asks `postConfirmFor(receipt)` (`postConfirmMessage`): "Post this goods receipt? {n} pcs enter
    {warehouse} at {value} USD, the item costs are updated and the number is assigned. Pieces not invoiced yet are
    valued at the order price; their cost is adjusted when the invoice is posted." - the last sentence only when a
    line has an order or a container (a receipt without an order has its cost typed) - and notifies "Posted: GRN-…". Delete of an automatic draft
    asks "Delete this draft goods receipt? KTG-… then waits without a receipt: create it again with Receive goods… on
    the container." Cancel… is `CancelReasonModal` titled "Cancel goods receipt", reason required, with
    `cancelDescription` ("…The stock it brought is taken out again and the item costs are replayed." + "Container
    {ref} goes back to its delivery status and can be received again." for a container).
  - Posted: the green banner "Received into {warehouse} on {date} by {user}. The stock and the item costs were
    updated; this receipt can no longer be edited."; cancelled: the red one with the reason.
  - "Date received" is a `DateInput` read by the theme's `parseTypedDate` (no `dateParser` of its own) and stored with
    `isoDate(next)` (see **Dates**); the server refuses a future date or one before the container's Delivery.
  - `/new` and `/:id` share one route group (the page checks the create permission for `/new`) so the first save does
    not remount the page. At 390 px the lines are cards: Item, Expected, Received, Difference and Reason first, the
    cost below.
  - Files are the **Documents card** (`DocumentAttachmentsCard`, kind `GRN`, `goodsReceiptsApi.files`) below the
    lines, with "Documents (n)" and "Add document…" in the action bar, as on every document (no drawer). "Print" opens
    the print page; "Export" downloads `{number}.xlsx` (`GRN-draft-{id}.xlsx` for a draft); both are disabled on a
    receipt never saved ("Save the draft first").
- **How the cost is shown.** A receipt is valued at the order price until an invoice covers its pieces, and the cost
  then moves by itself; the screens say which:
  - each line's "Unit cost" carries a badge from `COST_SOURCE_LABELS` ("Order price", "Invoice", "Order + invoice",
    "Typed") and, posted, "{n} of {r} pcs invoiced"; the summary card's "Value at cost" says on a draft "Estimate: the
    cost is set when the receipt is posted.";
  - a posted receipt with changes shows the **"Cost adjustments"** card (`GoodsReceiptCostAdjustmentsCard`): Date,
    Cause (`costCauseLabel`: "Invoice PINV-… posted", "Invoice … cancelled", "Landed cost adjustment …", "… cancelled",
    "Goods receipt … posted", "Goods receipt … cancelled", "Sold before receipt"), Item, Received, "Unit cost before →
    after", Amount, "To stock", "To cost of sales", a Total, and the hint `COST_ADJUSTMENTS_HINT` ("The part still in
    stock changes the average cost; the part already sold goes to the cost of sales. A difference of exchange rate
    between the order and the invoice is part of the cost.");
  - the invoice shows the same events as "Cost of received goods", and its post confirmation estimates them first
    (**Purchase documents**);
  - Stock Valuation says "Goods received but not invoiced yet are valued at the order price; their cost moves when the
    invoice is posted."; Sales Profit's COGS adjustments include them (by item, family, brand, branch or month, never
    per invoice).
- **`ReceiveGoodsModal`** (`source: { kind: 'order' | 'invoice', id, documentNumber }`) is the one "Receive goods -
  {document no.}" dialog for an order and an invoice. `GET …/receivable` answers `{ kind, documents, container, lines }`.
  - Columns: Item, Ordered (or Invoiced), Received, Short, In containers, In draft receipts, To receive, **Receive
    now**, "Nothing more will come" (+ reason), Warehouse; fields "Date received", "Delivery note no.".
  - **Receive now starts at each line's `defaultReceiveBase`**: To receive, or **0 when the goods travel in
    containers**. Then the orange Alert shows (a document is `shippedInContainers`): "This order is shipped in
    containers: its goods are received with their containers. Receive pieces here only if they arrived without a
    container." (or "This invoice is…"). Never default those pieces to To receive: they would be received twice.
  - Hints "Goods in containers are received with their container." and "Pieces not invoiced yet are valued at the
    order price; the invoice adjusts their cost when it is posted."
  - An order with nothing left to receive outside containers (its `documents[0]` has `toReceiveBase` and
    `maxOutsideBase` 0) shows rule 14's sentence instead of the lines, the one the order page's disabled button gives:
    "Everything still to receive travels in containers: it is received with its containers." (`inContainersBase` > 0)
    or "Everything ordered is already received.", and both buttons are disabled.
  - "Create draft" / "Create and post" (post permission); then the receipt opens (for a reader with
    `purchase.goodsreceipts.view`; without it the host page stays) with "Draft goods receipt created" or
    "Posted: GRN-…". A from-* answer whose posting was refused keeps the draft and carries `postRefusal`: its
    `message` is shown as a warning. The limits are the server's and its refusal is shown as it comes.
- **Automatic drafts.** Completing a Delivery-stage movement drafts one receipt per container, and the answer becomes
  one notification naming the drafts made and the containers left out: see **Containers and movements** below.
- **The print page** (outside the shell, like the receipt voucher; `window.print()` once loaded) has no costs. A draft
  prints as the count sheet ("DRAFT - not posted", the received, difference and reason boxes left blank for the pen),
  with "Received by" and "Delivered by / driver".
- **The stock statement** links `GRN` movements to the receipt and, beside it, `sourceReference` to what it names
  (`sourceContainerId`, else `sourcePurchaseOrderId`, else `sourceInvoiceId`): "GRN-BR-002-000001 · KTG-2026-0031".
  Every document link, the movement's own included, needs that page's view permission (`documentRoute(m,
  hasPermission)`); without it the number is plain text. The page itself needs only the item's view.
- **Sales**: before a sales invoice is posted, a short item held by a draft goods receipt adds "A goods receipt is
  waiting to be posted: GRN draft of KTG-2026-0031." to the out-of-stock warning (**Sales invoice page**).

### Containers and movements (the offload is retired)

A container's goods enter the stock with a goods receipt; posting it makes the container **Offloaded** (the status keeps
its name). The container and the movement DTOs carry the open receipt as `goodsReceiptId / goodsReceiptNumber /
goodsReceiptStatus` (a cancelled one is no receipt: the container can be received again); read them through
`containerReceiptOf()` (`src/components/logistics/containerReceipt.ts`, which also holds the sentences below) and show
them with `ContainerReceiptCell` (the GRN number, or a gray "Draft" badge, linked with `goodsReceiptsView`, else text).

- **Container page.** No receipt and status 1-5: **"Receive goods…"** (`purchase.goodsreceipts.create`), disabled on a
  draft container with "Confirm the container first."; `?receive=1` opens it (the old `?offload=1` too). It opens
  `ReceiveContainerModal` (the former `OffloadModal`): "Receive goods - KTG-…", "Receive into" (an active warehouse of
  the container's branch, the container's own one first), "Date received" (`isoDate(next)`, not in the future; "Delivered
  {date}: not before."), per line Loaded / Received / Difference and a reason (`VARIANCE_REASONS` code + optional note,
  required when they differ), the orange Alert of a container still Confirmed, "Create draft" / "Create and post" (post
  permission) → `goodsReceiptsApi.fromContainer`, then the receipt opens (with `goodsReceiptsView`; without it the
  container page reads itself again). The checks it makes first are the server's own
  sentences (63000); the server's refusal is shown as it comes.
  - A **draft** receipt: "Open goods receipt (draft)" and the blue Alert "Goods receipt draft created on {date}. The goods
    are not in stock until it is posted. Changing the container's warehouse does not change the draft."
  - A **posted** one: the green banner "Received by {GRN-…} into {warehouse} on {date} by {user}. The container is
    read-only." (the number linked) replaces "Offloaded into …", and **"Cancel goods receipt…"** opens the receipt's own
    cancel dialog (`cancelDescription`), disabled with the receipt's `cancelBlockedReason`. Containers offloaded before
    goods receipts keep "Offloaded into …" and "Cancel Offload".
  - The page reads the receipt itself (`goodsReceiptsApi.get`, with `goodsReceiptsView`) for those dates, names and
    reasons; without the permission it says what the container knows.
  - While a receipt exists (draft or posted) the loaded lines and the branch are fixed (rule 21: "fixed by the draft goods
    receipt"); the header stays editable until the receipt is posted. **Cancel** stays visible on status 1-5 (cancel
    permission) and is disabled with the 69019 sentence `receiptBlocksCancelText`: "Container KTG-… has {goods receipt
    GRN-… | a draft goods receipt}. Delete the draft (or cancel the receipt) first." "Delivered" shows the end of the
    latest completed Delivery-stage movement (`deliveredDate`), where the free time stops counting.
  - "Warehouse (offloading destination)" here and "Offloading warehouse" in Auto-plan say "The goods receipt proposes
    this warehouse."
  - **Close** is on every Offloaded container (close permission) and disabled while `closeBlockedReason` says why: the
    refusal Close itself gives (`logistics.fn_Container_CloseBlock`), draft charges first ("The container still has
    draft charges. Post or delete them before closing it."), then rule 20 ("Line {n} ({item}): {r} received but {i}
    invoiced by posted invoices. Post the supplier invoices before closing the container."). `canClose` is true only
    when nothing blocks it.
- **Containers list.** A "Goods receipt" column (and CSV column); the Status filter has a group "Goods receipt" with
  **"Delivered, not received"** (`deliveredNotReceived=true` instead of a status); the row menu offers "Receive goods"
  (status 2-5, no receipt, create permission) or "Goods receipt" (open it, view permission). Its "Cancel" item is there
  on status 1-5 and, while a receipt exists, disabled with the same 69019 sentence written under its label (a disabled
  menu item cannot carry a tooltip); its "Close" item is there on every Offloaded container, disabled the same way with
  `closeBlockedReason`. The order and PI filters load their lists only with `purchase.orders.view` /
  `purchase.invoices.view` (without it they offer nothing, and no refused request reaches the console).
- **"Add container…"** (`AddContainerModal`): the column "Outside containers" is `invoicedDirectBase`, the larger of
  what the order line invoiced and what it received + holds on draft goods receipts outside containers (Ordered −
  Loaded elsewhere − Outside containers = what may go here); its tooltip gives the parts, "Invoiced {a} · received {b} ·
  on draft receipts {c} pcs (the larger counts)".
- **Movement page.** Completing a movement of the **Delivery** stage: the Complete dialog says "The containers arrive at
  the warehouse: a draft goods receipt is created for each of them. The stock changes only when the warehouse posts it."
  and lists each container ("KTG-… → draft goods receipt into LUB-WH", "→ draft, warehouse to choose (LUB, the
  container's, has warehouses under it)", "→ no receipt: it already has GRN-…"), from `warehouseCode` /
  `warehouseInBranch` / `warehouseNote` (the server's reason, shown as it comes) and the receipt fields of
  `MovementDto.containers`. The answer's `goodsReceipts` (`MovementReceiptResultDto[]`) becomes one notification,
  `showDeliveryResult` (`deliveryNotification.tsx`): "Draft goods receipts created: KTG-… (warehouse to choose), KTG-….
  Not created: KTG-… already has GRN-…." with, under the first sentence, why a container's own warehouse was not taken,
  once per reason ("KTG-…: choose the warehouse (LUB, the container's, has warehouses under it: …).", in orange; read
  from the row's `message` by `warehouseToChooseReason`, nothing on an older server) - the created ones linked (the
  notifications sit outside the router: the link navigates through
  the page's `navigate`); when the whole call failed, the answer's `warnings` are shown on their own (the movement is
  completed whatever happened to the drafts). Cancelling a **completed** Delivery (`DeliveryCancelDrafts`, inside
  `CancelReasonModal`'s new `children`) lists the automatic drafts deleted with it (`autoDraftOfThisMovement` on the
  movement's containers) and names the edited ones (`goodsReceiptUpdatedAtUtc / ByName`: "GRN draft of KTG-… was edited
  by {user} on {date}: the received quantities and reasons typed there are lost."). The Containers card has a "Receipt"
  column. After **Start, Complete or Cancel** the page drops the places it had judged (`show(dto, true)`) and bumps the
  card's `reloadToken`: the candidates and the places are read again, so the Place column says where the containers
  are now (a completed movement shows their current location), as a reload would.
- **Status badges in the container page's tables** (Invoices, Charges, the Receipt cell, the FOB source on Loaded
  items) keep their whole label with `WHOLE_BADGE` (`movementContainers.ts`): a Mantine badge's label hides its
  overflow, so a narrow column cut "Posted" to "P…" and "Received" to "Rec…" with no tooltip. On the Charges card the
  status and "after receipt" wrap under each other, and the table's minimum width (760) lets the Status column show
  at 1440 px without scrolling.
- **Wording** that named the offload now names the receipt: "after receipt" badges on charges, "The goods are received:
  the item costs will be adjusted", the FOB source "Received", "Received" on the tracking board, "Received {date} into
  {warehouse} (GRN-…)" on the order's Containers card, "not yet received" in Shortages.

## Shortage plans

`/inventory/shortages` (list, `ShortagesPage`), `/inventory/shortages/new` and `/:id` (`ShortageDocumentPage`)
and `/:id/print` (`ShortagePrintPage`) are the customer's shortage study as a **saved planning document**,
numbered `SHR-2026-000001` (the year is part of the number and the sequence restarts every year — *Year in
number* on the document type). Permissions: `inventory.shortages.view / create / post / delete`; creating the
purchase order needs `purchase.orders.create`. The caption is always **"Lead Time (Month)"**, never "Planning
Period". The pieces live in `src/components/shortages/`.

### The formulas (`shortageMath.ts` — the same ones the database uses)

Per line, in **base units** (only Required Qty is in the purchase unit, shown as the input's suffix):

| Cell | Formula |
|---|---|
| Stock + Transit | Current Inventory + Transit + Transfers in (the header's tooltip says so) |
| Total Expected Stock | Current Inventory + Transit + Transfers in + Outstanding Order |
| Expected Monthly Sales | the **busiest month** of the last *Months of history* (default 3): the history cut into one-month blocks counted back from today, the net sales (sales less returns) of the block that sold the most, in the warehouse and every warehouse under it (script 85; it was the average before); **overridable per line** |
| Expected Requirement | Expected Monthly Sales × Lead Time (Month) |
| Shortage Qty | max(0, Requirement − Total Expected Stock), rounded up — red when > 0 |
| Coverage (months) | Total Expected Stock ÷ Expected Monthly Sales — red when < Lead Time, "—" when nothing sells |
| Required Qty | typed; defaults to the shortage rounded up to whole purchase units |
| Container Requirement | Required Qty × packing ÷ PC per Container (the item's *PC per Container*, overridable per line) |

The live figures come from `inventory.fn_Shortage_Live` (last changed by script 85, the busiest month; script 65
brought goods receipts), for the plan's warehouse and every warehouse under it:

- **Transit** = pieces loaded in containers that have left the supplier (In Transit, At Port, Cleared: statuses 3-5)
  and are not received yet, counted on the warehouse of their order line.
- **Transfers in** (script 90, `fn_Shortage_Live` re-created) = goods on the way to the warehouse (its tree) from
  other warehouses: dispatched by transfer orders to it, not received or written off yet. A column after Transit on
  the plan, in Load items and on paper, with the tooltip "Goods on the way to this warehouse from other warehouses
  (transfer orders), not received yet." (`TRANSFERS_IN_HINT`); `derive()` adds it to Stock + Transit. Transfers OUT
  are not demand: counting them would buy twice. A plan saved before script 90 has 0 there, so its figures are
  unchanged.
- **Outstanding Order** = max(0, what approved orders still bring − Transit). What an order still brings is its
  lines' **outstanding** (`outstandingBase`, the same number as the item's "On order"): on an approved order ordered −
  received − settled short, never below 0. Posted
  supplier invoices **without an order** whose goods come with goods receipts add invoiced − received.
- "Received" here is goods receipts (plus what came in before them), never "invoiced": a posted invoice no longer
  ends what is on the way, its goods receipt does. Pieces settled short (received less with a reason, or "Nothing
  more will come") are not on the way any more.

Summary card: items, total shortage, total required, containers (the sum, 7.35), containers rounded (8) and
utilization (91.88 %, with a bar).

### Draft vs posted

- **A draft is a working sheet.** Current inventory, transit, outstanding order and the computed monthly sales
  are the server's and are never edited; the planner types three things — a manual monthly sales figure (the
  computed value stays greyed as the placeholder; a **manual** badge and a reset icon appear once overridden),
  a required quantity (it *follows the suggestion* until typed; "Reset to suggested" hands it back) and a PC per
  container. `derive()` recomputes every other cell as they are typed.
- **The figures are never sent.** A save carries the items and the three typed values; the procedure takes the
  live figures itself, so **the API's values win after every save**. **Recalculate** (saved drafts only; with
  unsaved changes it asks to save first) refreshes the live figures and keeps the three typed values.
- **Load items** opens `LoadItemsDrawer`: `GET calculate` with the header's warehouse, lead time and history,
  filters that apply as they change (family tree, brand, search, *Only shortages* and *Only this supplier's
  items*, both on by default), every short row pre-ticked, "Add selected (n)". Items already on the plan cannot
  be ticked, and any that slip through are skipped with a notify.
- Changing the warehouse or the months of history under existing lines shows a yellow alert: the lines were
  counted with the old settings until the next save.
- **Posted is a photograph.** "Save & Post" confirms with *"Post this shortage plan? The figures will be frozen
  as a historical snapshot."* A posted plan is read-only text, shows the banner "Posted by X on Y - historical
  snapshot, values are not recalculated", and its summary shows the **stored** totals. Stock can move as much
  as it likes afterwards; the plan does not.
- The lines grid is the shared `DataTable` with client-side sort. **The order is frozen while you type** — it is
  taken when a header is clicked or lines are added/removed — so a row never moves out from under the cursor.
  Nineteen columns scroll inside the card; "#" and Item are sticky (`.shortage-lines` in `app.css`; on a phone
  only a narrowed Item column sticks).
- Errors: `Line N:` lands on line N (red row + tooltip + notify); NO_LINES, NOTHING_TO_ORDER and the rest are a
  notify; CONCURRENCY and NOT_DRAFT also reload. Unsaved-changes guard on both exits, as every document page.
- View-only users get the same page as read-only text: no New, Load items, Recalculate, Save, Post or Delete.

### Purchase order creation

**Create Purchase Order** is disabled on a draft with the tooltip "Post the plan first" (`DocumentAction.disabledReason`)
and live on a posted plan: confirm → `POST {id}/create-purchase-order` → a notify naming the PO → the PO draft
opens. The order takes the plan's supplier and branch and every line with a Required Qty above zero, in the
purchase unit; NOTHING_TO_ORDER when there is none. Each line goes to the plan's warehouse when it is at the bottom
of the tree. For a plan made for a parent warehouse (script 62) each line goes to the item's default warehouse when it
is an active warehouse at the bottom of the plan's tree, else to the first of those (the plan's branch first, then by
code); the order's header takes its first line's warehouse and its Notes say so (script 89; before, the purchase
validation refused the parent). A tree without an active warehouse at the bottom is refused with the server's
VALIDATION message, shown as it comes. The PO shows a **"Source: Shortage SHR-…" chip**
linking back, and the plan's **Purchase orders** card lists every order made from it (number, date, status,
amount); the audit trail shows Created / Updated / Recalculated / Posted / POCreated.

**Mark as shipped** (the order's shipped quantities, `purchaseDocumentsApi.markShipped`) is no longer what the plans
read as Transit: since the containers, Transit is the containers' (above). The order's lines grid still shows a
recorded shipped quantity as **In transit**; it moves no stock and changes no plan.

### Print and export

Print goes to `/:id/print`, a route **outside the shell** — there is no navigation to hide, `@media print`
only drops the two buttons (`.no-print`), the page is A4 landscape, and `window.print()` opens once the saved
plan has loaded (a draft with unsaved changes is asked to save first). Export downloads `Shortage_<number>.xlsx`.
Both are on the list's row actions and on the document.

## Import container charges from Excel

**Import charges from Excel…** in the Containers page header (`ContainersPage`; shown with
`containers.charges.create`, hidden without it) opens **`ImportContainerChargesWizard`**
(`src/components/logistics/`). Every call of the feature is in `src/api/logistics/containerChargeImport.ts`
(`api/logistics/container-charges/import`: `GET template`, `POST validate` multipart, `POST` the import,
`POST error-report`), so aligning it with the API is one file.

- **One row = one charge on one container**: the row's whole amount on that container, divided over its items by
  the row's allocation method (the charge type's when blank; Manual is refused). There is no split over several
  containers here; that is **Add charge**.
- **The same three steps and rules as `ImportInvoiceItemsWizard`**, in a component of its own: .xlsx up to 5 MB
  (the API's limit) checked before the upload, chosen by drag and drop, a click in the drop zone, or its
  **Choose a file…** button (the way in from the keyboard); the server judges every row (Valid / Warning / Error) and keeps nothing; the wizard
  holds the judged rows (the import is sent them back as they came, with the file name), and **Download the error
  report** posts them back too. A Warning (a duplicate, a late charge…) is imported as its own charge, never merged.
  The reader's today goes with the file (`today`): it is what a blank Charge Date means.
- **Step 2** shows every row: Container (ref, no. and status; the file's text in red when it matched nothing),
  Charge Type, Date ("today" under a blank one), Amount (with "≈ 1,630.43 USD" and "rate 0.92 of the date"
  under another currency), Provider (with "Inv. {no.}", and "One group with row 3" when the rows of one provider
  invoice share a charge group), Allocation ("the type's default" under a blank one), Status, Message. "Continue
  with {n} charges"; "Choose another file" starts again.
- **Step 3** says what will be created (charges, containers, charge groups, totals per currency ≈ base). The
  **Post the charges** switch (off by default) is offered only with `containers.charges.post`, which the server
  checks again; without it a line says the charges stay drafts. The button reads "Import {n} charges", or
  "Import {n}, skip {m}" when rows have errors.
- **Each row is imported on its own.** The result lists every row with a link to its container: Posted, Draft,
  "Draft, not posted" (outcome Draft with a message when posting was asked: the draft stays) or Refused (outcome
  Failed), with the API's reason as it came. **Download the refused rows** (shown only when a row was refused) is
  the error report of the Refused rows only, with their reasons, to correct and import again. A "Draft, not
  posted" row is never in it: its charge exists, and importing it again would add a second one (the duplicate
  check is only a warning); the result says to post it from the container or Logistics › Container Charges. The
  Containers list reloads as soon as one charge was created.
- The dialog is 1280 px wide and full screen below 768 px; its tables scroll sideways inside it.

## Charge types & landed cost

The money that turns a supplier's price into what the goods really cost.

### Charge Types (US-MD-008)

`/purchase/charge-types` (`ChargeTypesPage` + `ChargeTypeFormModal`, permission
`purchase.chargetypes.manage`) defines the charge kinds: code, name, **allocation method**
(By Item Value / By Quantity / By Weight / By Volume (CBM) / Manual — `allocationMethodLabel()` in
`src/api/purchase/chargeTypes.ts` owns the wording), whether it is **included in the landed cost**,
and whether it is a **recoverable tax**. The last two cannot both be true: switching Recoverable Tax
on forces Include in Landed Cost off and disables it ("A recoverable tax is never part of the item
cost"), and the table, the procedure and the request DTO all say so.

**Delete is only ever offered for a type nothing has used** (`usageCount === 0`, surfaced as
`canDelete`). A used one shows the disabled icon with "Used in N transactions - deactivate instead",
because deleting it would take the history of every charge line with it.

### The Charges tab

`PurchaseChargesGrid` (`src/components/purchase/`) is the same grid on a **draft purchase invoice**
and on a **landed cost adjustment**; `purchaseCharges.ts` holds the row shape and the arithmetic.

- **Every charge is two numbers**: what was billed, in the currency it was billed in, and
  `amount ÷ rate` in the base currency — the only one goods can be costed in. The second is derived
  and read-only; a reader who disagrees changes the rate. Picking a currency looks its rate up for
  the document date (`GET api/purchase/rate`).
- Picking a **charge type fills in** the allocation method and the "in landed cost" flag; both stay
  editable per charge, and the flag is copied at save time so a later change to the type cannot
  restate a posted invoice.
- A charge **not in the landed cost is greyed and badged "not in cost"** — it is still recorded and
  paid, it simply does not make the goods worth more.
- **Manual** opens an allocation panel under the row: one line per invoice line, a "Spread by
  quantity" shortcut, and a running **Remaining** that must reach zero. The page blocks the save
  while it does not; the server refuses it too ("Charge N: manual allocations (250.00) must equal
  the charge amount in base currency (300.00)"), and that sentence is what the row shows.
- A manual split points at **line ids**, so only lines the server has already saved can carry one.
- Footer: **Total charges** and **of which landed**.

**The charges are saved apart from the lines.** "Save Draft" saves the lines first
(`POST/PUT api/purchase/documents`), then the charges against the version that came back
(`PUT api/purchase/documents/{id}/charges`) — a new invoice has no line ids until its lines exist.
`Charge N:` errors land on charge N, exactly as `Line N:` errors land on line N.

**Allocation happens at posting**, not at typing: `allocatedBase` is null on a draft. A posted
invoice's lines then carry **FOB**, **Charges** and **Landed cost** per base unit, and the page adds
a **Landed cost** card (goods + charges = total landed cost).

### Landed Cost Adjustments

`/purchase/landed-cost-adjustments` (list + document, permissions `purchase.landedcosts.*`) is the
freight bill that arrives three weeks after the goods. **It moves value, not stock**, which is why it
is a document with its own Draft → Posted → Cancelled life rather than an edit to the invoice.

- The **invoice is chosen once** (posted purchase invoices only) and is read-only afterwards: every
  figure hangs off it. A posted invoice offers **"New landed cost adjustment"**, which pre-selects
  itself through `?invoiceId=`.
- Posting spreads the charges over the invoice lines and **splits each one**: the quantity still in
  stock raises the inventory value (and the item's average cost), the quantity already sold becomes
  a **COGS adjustment** in the period. The Split table shows allocated, extra per unit, remaining,
  both portions and the landed cost before and after, under a banner naming who posted it.
- On an invoice that **uses goods receipts** (posted since the switch, script 65) the split is over the pieces
  received so far, and the company's stock decides the stock part (the goods receipts' cost adjustments, cause
  "Landed cost adjustment …"); pieces not received yet simply take the new invoice cost when they arrive. A "Shipped
  in containers" invoice takes no adjustment (67012): its charges are the containers'.
- On an invoice posted before goods receipts the quantity still in stock is worked out per item on the company's stock
  (every warehouse) since script 89; it was each line's warehouse. The Split table's Remaining is the line's share of
  the item's pieces still held, rounded so that the lines add up.
- Cancelling writes the reversal and rebuilds the item costs.

## Sales profit

`sales.profit.view` is its own permission: **a price is everybody's business, a margin is not.**
Without it the API returns every cost and margin field as `null` — so the pages draw nothing at all
rather than a row of dashes, which would leak the permission as a shrug.

- **On a posted sales invoice**, `SalesInvoiceProfitCard` shows Net Sales / COGS / Gross Profit /
  GP % and the same four per line. Every figure was **frozen at posting**: cost of sales is what the
  goods were worth the moment they left, so the same invoice read next year says the same thing.
- **"Create Return"** on a posted invoice (needs `sales.invoices.create`) makes an SRET draft with
  the remaining quantities, the invoice's prices and its **original** COGS. There is no returns page
  yet, so the page names the draft and stays where it is.
- `/sales/profit` (`SalesProfitPage`) groups by Invoice / Item / Family / Brand / Client / Salesman /
  Branch / Month / All, with summary cards, a totals row and Export to Excel. The **COGS adjustments**
  column appears only for the groupings a landed cost adjustment can be attributed to
  (`showsCogsAdjustments()`): an adjustment knows its item and its date, never its invoice.
- `/inventory/valuation` (`StockValuationPage`, `inventory.items.view`) is on hand × the item's
  moving average cost, per warehouse or company-wide. The totals come from the API, not from summing
  the page.
- **Item Definition** shows FOB Purchase Cost, Last Cost (landed), Average Cost and Inventory Value
  with a tooltip each (they differ by one word), and the Purchasing section carries **Weight (kg)**
  and **Volume (CBM)** per base unit — a charge allocated by weight or volume is refused for an item
  that has none.

## Numbers

Every quantity and amount the app shows goes through `formatNumber` / `formatMoney`
(`src/components/format.ts`): thousands separators and fixed decimals in the en-US shape — 14020800 reads
**14,020,800.00**, whatever the browser locale. `money()` in `documentKind.ts` is the same thing with the
currency code. A `NumberInput` that holds a quantity or an amount carries `thousandSeparator=","`.
Counts (items, rows) go through `formatNumber` too; a bare `{value}` of a number in JSX is a bug.

## Dates

A typed date is read **day first**, and strictly, in every `DateInput`: the people using the app write 05/10/2026
for 5 October. The theme gives every `DateInput` the one parser, `parseTypedDate` (`src/components/typedDate.ts`);
a field never passes its own `dateParser`, and its `valueFormat` (`"DD/MM/YYYY"`, a few `"DD MMM YYYY"`) only says
how the date is shown. Mantine's own parser ignored the format (dayjs has no `customParseFormat` here, so
`dayjs(text, format)` ignores the format too: never parse with it) and fell back to `new Date(text)`, which read
05/10/2026 as 10 May and turned half-typed text into dates of 2001.

- **Accepted:** day, month, year with `/`, `-`, `.` or a space (the same one twice), one or two digits for the day
  and the month: `5/10/2026`, `05.10.2026`, `5 10 2026`; a two-digit year is 20YY (`5-10-26`); an English month name
  of three letters or more instead of the number, any case: `5 Oct 2026`, `05-oct-26`, `5 October 2026`; year first,
  as pasted, `YYYY-MM-DD` with two digits for the month and the day (any of the four separators): `2026-10-05`.
- **Refused** (null) - everything else: a day the month does not have (31/02/2026, 00/10/2026), month 13, text, no
  year, a year outside 1900-2099, a year first with one-digit parts (`2026-1-5`). The field then keeps the last date
  it read and shows it again on blur (an empty field stays empty).
- **No half-typed text is a date.** Mantine parses at every key and keeps the last result that was not null, so the
  beginning of a longer text must never parse: otherwise 29/02/2027 (no such day) would stop at "29/02/20" and save
  29 February 2020. So the two-digit years **19 and 20 are refused** (type 2019 / 2020 in full): every accepted
  four-digit year starts with them. Keep this in mind before accepting a new shape.
- It returns `"YYYY-MM-DD"`, the string a click in the calendar gives, so a page's `onChange` handles both alike.
- **Keep that string as it is: never `new Date(next)`.** `new Date('2026-10-05')` is midnight UTC, still 4 October
  west of Greenwich, so a page that rebuilt the day from it saved the day before there (a typed date and a pick
  alike). Store it with `isoDate(next)` (`documentKind.ts`, which takes the string or a Date) or `String(next)`, and
  give the field back the string (`value={filters.dateFrom}`) or `fromIsoDate(...)`, a Date at local midnight.
- `DatePickerInput` and `MonthPickerInput` are picked from a calendar, never typed: nothing to parse.
- Shown outside an input, a document date reads `DD/MM/YYYY` through `dateLabel`; a moment goes through
  `formatDateTime` (see `format.ts`): **`DD/MM/YYYY HH:mm`, day first and 24-hour, in the reader's local time**
  ("2026-10-11T22:35:40Z" reads "12/10/2026 01:35" at UTC+3), whatever the browser's language - never
  `toLocaleString()`, which printed "10/12/2026, 1:35:40 AM" in an en-US browser next to a typed "12/10/2026". The
  print pages use the same helper (`stamp()` is it with "—" when empty).
- A stored reason ends its sentence: `reasonSentence(reason)` (`format.ts`) gives " Reason: {reason}." with the full
  stop added when the reason has none, for the banners that go on after it ("Cancelled by … on …. Reason: Damaged in
  transit. …").

## Document pages

Inventory In and Inventory Out are the first **document family** (BIVAC Out is a third kind on the same
pages: see **A document type that limits its items**). Purchase and Sales will be the same
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
| `AuditTrail` | What has happened to the document, five entries then the rest on asking. Its badges show readable names for the API's action codes ("CostAdjusted" reads "Cost adjusted", "FileAdded" "File added"): a map (`ACTION_LABELS`) and, for a code not in it, the code split into words. |
| `DocumentActionBar` | The actions, sticky, collapsing to a menu below 768 px. A disabled action's `disabledReason` is a wrapped tooltip (280 px) on a wide screen and its own dimmed line under the label in the menu, which never grows wider than the screen (`maw="calc(100vw - 32px)"`): a reason on the label's line pushed the menu past a phone's edge and cut it off. Below 768 px the big button is the action marked `filled`, else the last one shown; `pinnedOnPhone` keeps an action beside it as a button, and `menuWhenDisabled` sends an action into the menu while it is disabled (a big greyed button says nothing on a phone, which has no tooltip: a completed movement's "Cancel…"), the action before it then taking the big button. |
| `DocumentAttachmentsCard` | The paperwork behind the document: the "Documents" card below the lines (see **Attachments (documents on every page)**). |
| `CancelReasonModal` | Asks why a posted document is being cancelled. `withDate: { minDate?, label? }` also asks the date it counts on (script 84; `label` names the field when it is not a cancellation's, "Reversal date" of a transfer, script 90). |

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

1. Add a `DocumentKind` for it (title, route, colour, direction, five permission codes, and optionally
   the Reference No. placeholder). Rules about cost, numbering, the reason and which items a line may
   hold belong to the document **type** (Configurations › Document Types), not to the kind.
2. Add the permission codes to `src/navigation.ts` and the menu entries.
3. Add three routes in `src/App.tsx` pointing at `StockDocumentsPage` / `StockDocumentPage` — or at a
   family-specific page that reuses the same components when its header needs more fields.
4. Add the code to `StockDocumentTypeCode`, to `AttachmentDocumentKind` (`src/api/documentFiles.ts`) and to
   the item statement's links (`ItemStockMovementsPage.tsx`).

## A document type that limits its items

**BIVAC Out** (`BIV_OUT`, script 66; Inventory › BIVAC Out, routes `/inventory/bivac-out`, `/new`, `/:id`) is an
Inventory Out of its own: the same `StockDocumentsPage` / `StockDocumentPage` with the `BIVAC_OUT` kind (grape
accent, `inventory.bivacout.view / create / post / cancel / delete`, Reference No. placeholder "BIVAC certificate
or container no."). Numbers `BIV-<branch>-000001` are given at the first save, no reason is required, and the
units leave stock at the average cost like any Out. There is no link to a shipment: the BIVAC certificate or the
container number goes in Reference No., and the certificate can be attached. Its lines may hold **only items
with "BIVAC Item" ticked** in Item Definition.

- **The rule belongs to the type, not to the page.** `DocumentTypeDto.bivacItemsOnly`
  (`inventory.DocumentTypes.BivacItemsOnly`) says it. The page reads it through `useDocumentTypes()` and never
  compares the code with `'BIV_OUT'`, so another type given the flag behaves the same with no change here.
  Configurations › Document Types shows it read-only: a "BIVAC items only" column, and the line "BIVAC items only:
  Yes: every line must be an item with "BIVAC Item" ticked." in the edit dialog of a type that has it. The
  script that creates the type sets it.
- **Both pickers are narrowed.**
  - The line Item dropdown loads `itemsApi.lookup(true, undefined, undefined, false, true)`
    (`GET api/inventory/items/lookup?bivacOnly=true`). Its placeholder is "Choose a BIVAC item", and when nothing
    matches it says "No BIVAC item matches. Tick "BIVAC Item" in Inventory › Item Definition to add one."
  - The quick search (`<QuickItemSearch bivacOnly />`) sends `isBivac: true` to the item search. A code that
    matches no BIVAC item gives "No BIVAC item matches {term}."
  - A gray hint stands beside the quick search: "Only BIVAC items. Tick "BIVAC Item" in Inventory › Item
    Definition to add one."
- **The item list waits for the type.** The page loads it once the configuration has answered (cached after the
  first document page); the quick search stays disabled until then. If the configuration cannot be loaded (or the
  kind's row is missing), the page says so and offers no items, so a BIVAC Out never offers other items: a red
  Alert above the lines ("The document types could not be loaded.", or "The {kind} settings could not be loaded.
  Reload the page."), and the quick search, Save Draft and Save & Post disabled with the same text as tooltip.
  Inventory In / Out show the same error in that case instead of guessing their rules. A list loaded for another
  filter is never offered while the right one loads.
- **A line's own item stays visible on its own line only (never offered on other lines).** `DocumentLinesGrid`
  gives the row whose item is missing from the list (made inactive, or unticked since the draft was saved) that
  item as an extra option, first. The cell never goes blank, and the server's refusal points at a code the reader
  can see, but no other line can pick it.
- **The server still decides.**
  - Save and Post refuse any other item with 62000: "Line 2: BAT-12V is not a BIVAC item. A BIVAC Out holds BIVAC
    items only." It lands on line 2, like every `Line N:` message.
  - The Excel import (`ImportInvoiceItemsWizard`, unchanged) checks the rows on the server: such a row is an Error,
    "BAT-12V is not a BIVAC item.". "One document per warehouse" stays Inventory In only.
- **The item lists have no row limit.** Every page loads `/items/lookup` once and searches it in the browser.
  The procedure used to return 20 rows by default, which silently cut every line dropdown. Since script 66 it
  returns every matching item, unless a caller sends `top`. An item dropdown shows at most 100 matches at a time
  (`limit={100}` on the line Item select of `DocumentLinesGrid`, `SalesInvoiceLinesGrid` and `PurchaseLinesGrid`),
  and typing narrows them; the options are built once per list (`useMemo`), not on every render.
- **Around the document.** `BIV_OUT` is an `AttachmentDocumentKind`, and script 66 copied Inventory Out's "Used
  for" rows to it, so an administrator can add a "BIVAC certificate" type in Master Data › Attachment Types. The
  item statement (`ItemStockMovementsPage`) links BIV_OUT movements to `/inventory/bivac-out/:id`.

## Attachments (documents on every page)

Every place that keeps files shows them the way the container page always did (prompt 40; scripts 52, 55 and 67):
purchase orders, invoices and returns, sales invoices and returns, Inventory In / Out / BIVAC Out, customer receipts,
supplier payments, containers (and their movements and charges) and item definitions. Landed cost adjustments have
no documents: the provider's invoice of a late charge goes on the purchase invoice. An item's **picture**
(`ItemImageCard`, `itemsApi.addImage`) is not a document: JPEG, PNG or WebP up to 5 MB, no type, unchanged.

- **One list: `AttachmentsPanel`** (`src/components/attachments/`). Each file shows its type badge ("Purchase ›
  Proforma Invoice"), its name and size, the date written on it, the note, who added it and when, with Download,
  Edit and Delete, and an "Every type" filter above the list. **Table or cards by the width the panel really gets**
  (`useElementSize` on the panel, not the screen): a table from 1,000 px (`TABLE_WIDTH`; once shown it stays down to
  960, so a page scrollbar coming and going cannot flip it), one small card per file below - the type badge, the name
  on its own line, "date · size · who · when", the note, and Download / Edit / Delete on the right. At 1440 px that gives
  the table on document pages and the item's tab (about 1,130 px) and the cards in the left column of a container page
  and in a movement's Documents tab (about 740 px, where the table squeezed names to a few letters a line and hid
  Delete behind a scroll), and on a phone. `layout="cards"` asks for the cards whatever the width (the charge drawer).
  A long name wraps between its words: `FileName` puts a `<wbr>` after every "_" and "." (a 90-character name takes
  two lines of a card at 1440 px instead of breaking after "TEST-" and then mid-word), and the audit trail wraps the
  name in "Attachment added: ..." rather than widening the page. Where it sits:
  - document pages: `DocumentAttachmentsCard` (`src/components/documents/`), a **"Documents" card on the page**, below
    the lines (and the charges), above the audit trail. The supplier payment numbers it "4 · Documents". No drawer;
  - containers: `ContainerDocumentsCard`, grouped General / each movement / each charge;
  - Logistics › Movements › the **Documents** tab: `MovementDocumentsCard` on the panel, one row per stored file with
    "On KTG-…" links to the containers holding it;
  - the container charge drawer: the panel without its card, `layout="cards"`;
  - Item Definition › the **Documents** tab: kind `ITEM`, `itemsApi.files` (the shared `documentFilesApi`).
- **One popup to add, one to edit.** `AttachmentUploadDialog` ("Add document", button "Upload") and
  `AttachmentEditDialog` ("Edit document"): File ("PDF, image or Office file, up to 20 MB"), Attachment type
  (required, "Pick a type"), Document date ("Date on the document"), Note; the edit can also replace the file
  ("Replace file (optional)"). Containers add "Link to a movement" ("General - not tied to a movement") and "Also
  attach to"; a charge's upload says "Filed under this charge on N containers." instead. The edit on a container
  page offers "Link to a movement" too (cleared = General; `movementId` is sent only when it changed, and the server
  refuses a movement one of the file's containers is not on); a charge's file stays with its charge.
- **Nothing is uploaded without a type.** "Add document…" (the card's button, and the action bar of a document
  page), dropping a file on the drop zone ("Drop a file here, or click to choose one") or clicking it all open the
  popup, with the file filled in. A page opens it through the panel's `openUpload` counter; once that upload is in,
  the card scrolls into view.
- **The types offered are the kind's**: only those whose "Used for" (Master Data › Attachment Types) names the kind
  (`attachmentTypesApi.forKind`): `CONTAINER`, `ITEM`, `PO`, `PINV`, `PRET`, `SO`, `SINV`, `SRET`, `RCPT`, `PAY`,
  `INV_IN`, `INV_OUT`, `BIV_OUT`, `GRN` (goods receipts). With none: "No attachment type is used for
  this kind of document: add one in Master Data › Attachment Types." Missing type: "Choose the attachment type."
- **20 MB, PDF, image or Office files**, through `attachmentRules.ts` (`ATTACHMENT_ACCEPT`, `ATTACHMENT_HINT`,
  `attachmentFileError`): "{file} cannot be attached: PDF, image or Office file, up to 20 MB." / "The file is {n}
  MB; the limit is 20 MB." The API checks it again (`AttachmentRules`). SQL messages are shown as they come.
- **"Other" asks for a type.** Files from before types existed (and the old item files, script 67) are typed "Other
  › Other": an orange badge and an orange **"Choose a type"** button that opens the edit, which starts with no type
  picked and says 'Still typed "Other": choose what this file is.'.
- **The action bar of a document page** (PO, PINV, PRET, goods receipt, sales invoice / return, Inventory In / Out /
  BIVAC Out, receipt, payment): **"Documents (n)"** scrolls to the card; **"Add document…"** (with the create permission) opens
  the popup. On a draft never saved it is disabled with "Save the draft first to attach documents.", which the card
  says too; a reversed receipt / payment: "This receipt is reversed: its documents stay as they are." / "This
  payment is reversed: …". A new item's tab says "Save the item first to attach documents."
- **A file changes only the files.** After an upload, an edit or a delete the page reads the document again and
  takes only its `files` (the count) and `audit` (`filesChanged`), never the header and lines being typed: a file
  does not touch the document's row, so its RowVersion still holds. The item page re-counts its documents for the
  tab's badge; the charge drawer lists the charge's files from a fresh read of the charge.
- **Who may add, edit and delete** (without it: download only). Nothing ever requires a file to post.

  | Place | Permission | Status |
  |---|---|---|
  | Purchase order / invoice / return | `purchase.orders / invoices / returns.create` | any status |
  | Sales invoice / return | `sales.invoices.create` | any status |
  | Inventory In / Out / BIVAC Out | `inventory.stockin / stockout / bivacout.create` | any status |
  | Goods receipt | `purchase.goodsreceipts.create` | any status |
  | Customer receipt / supplier payment | `sales.receipts.create` / `purchase.payments.create` | not once Reversed (SQL 71005 / 73005) |
  | Container, movement, charge | `containers.attachments.manage` | a movement needs containers; no new file on a cancelled charge |
  | Item definition | `inventory.items.edit` | view mode too, like a posted document |

  The panel's `canAdd` covers a new file (the drop zone, "Add document…", `openUpload`); `canEdit` (default
  `canAdd`) covers Edit and "Choose a type". A cancelled charge passes `canAdd` false and `canEdit` with the
  permission alone: its files can still be retyped, edited and deleted, and the drawer says "This charge is cancelled:
  no new document can be added." instead of "An upload goes on every container of the group (N containers)."
- **Shared container files.** One upload for several containers is one stored file ("shared with N containers").
  Deleting asks how far ("Only this container" / "All containers"; on a movement "This movement's containers" /
  "All containers"); a container's edit asks the same when the file is shared. A movement's or a charge's file is
  always edited on every container holding it.
- **Inside another form.** The item's Documents tab sits inside the item's `<form>`. A popup's form is rendered in a
  portal but its submit still bubbles up the React tree, so the item form's `onSubmit` ignores a submit whose target
  is not itself, and does nothing in view mode. Do the same wherever the panel lands inside a form.

## Supplier payments: a purchase invoice split by container (script 73)

A **Purchase Invoice Payment** pays an invoice whose lines are linked to containers (Create Invoice from Containers,
Link containers) container by container.

- **Rows of an invoice** come with the open documents (`containers` on each invoice): one per container, and one
  **"Unlinked items"** row (`containerId` null, key `0`) naming the items of its lines in no container. Amounts are in
  the invoice's currency.
- **Two rows or more** (`needsSplit` in `paymentModel.ts`): an expand arrow on the invoice row opens a table of the rows
  (Container Ref., Container No., Items, Container PI Amount, Previously Paid, Outstanding, Allocate Amount, Payment
  Status: Pending red, Partially Paid orange, Fully Paid green). It opens by itself once the invoice is allocated.
- **The invoice amount and the rows never disagree:** typing the invoice amount (or ticking it, or "Allocate oldest
  first") spreads it over the rows in order, each up to what it still owes, "Unlinked items" last; typing or ticking a row
  makes the invoice amount their sum. **Distribute** re-spreads on demand.
- **One container and nothing else:** no rows to type; the server records that container itself.
- The request sends `containers` (every row, 0 where nothing goes) only for an invoice with two rows or more. The
  server is the authority: posting is refused (73008) until the rows add up, and a row above what it owes is refused
  (73009). The Paid documents card shows each invoice's split under it.

## Lists of any length (script 78: any number of containers)

The owner: "the system and the purchase orders and invoices must accept any number of containers". So:

- **No preloaded page as a dropdown.** A `Select` filled with "the 200 newest" (or the first 50 parties) hid
  everything after it, and typing only filtered what was loaded. Orders, invoices, containers, movements and parties
  are picked with `SearchSelect` / `SearchMultiSelect`: the Containers page PO / PI filters, the movement card's order
  and supplier filters, New charge's movement and containers, the Container Charges filters, the Forwarder of
  Auto-plan and Add Container.
- **A list a bulk action works on is whole.** The order's Containers card, a movement's containers and the movement's
  candidates read EVERY page with `fetchAllPages(..., { maxRows: Infinity, pageSize: WHOLE_LIST_PAGE_SIZE })`: their
  procedures take pages of up to 5,000 and work every row out before they page, so one big page is far cheaper than
  many small ones. "Select every container" and "Tick every container of the list" then reach all of them.
- **A preset selection is read in one call:** `containersApi.lookup({ ids })` (New charge opened from 2,000 ticked
  containers), never one GET per container.
- **A list the server cuts says so:** "From a container…" lists 200 and reads "Showing 200 of N containers…" from the
  answer's `totalCount`.
- **The Containers page** still holds at most 5,000 rows (`fetchAllPages`' default) with its "Showing the newest rows
  only" notice: its filters (order, invoice, status…) narrow on the server, and a grid of tens of thousands of rows in
  the browser would be slow for every reader to buy little.
- **A server-searched filter asks the server for what it offers**: `loadPurchaseOrders` sends `status: 'Posted'` (every
  approved order: Saved, Partially posted, Posted) rather than dropping drafts from a page of the newest orders, which
  came back empty when the newest were drafts.
- **A message about many containers names the first 10, then "and N more"**: the notification after a Delivery
  (`showDeliveryResult`, with "Open Goods Receipts" past 10 drafts) and the server's summary of it.
- Imports send what they read in one call up to the API's limit and in parts above it (`matchAll` for a movement's
  container numbers: 10,000 a call).
- **Long lists are DRAWN in steps of 200** (`useShownRows` + `ShownRowsFooter`: "Showing 200 of 1,049 containers. Show
  200 more · Show all"): the Auto-plan proposal, the order's Containers card, the movement's list, the invoice's linked
  containers, "Apply to other containers…" and the purchase document lines. Only the drawing is cut: every row stays loaded, so totals, Save, Post,
  "Select every container" and the bulk actions take them all. A row with a problem, the one being edited and a line
  just added always show. (Measured: Propose of 1,049 containers 7.9 s → 2.0 s in the dev build.)
- **No portal or Select per row of a long grid.** A Mantine `Select` searches the whole page for its option list when it
  mounts (the list is closed, so it walks every element), and a `Tooltip` mounts its portal while closed (another walk):
  one of each per row made a 300-line invoice take 16 s to appear in the production build and a 2,205-line one minutes.
  Rows use `LazySelect` (`components/ui/LazySelect.tsx`: a plain input until focused, then the real Select, open) and
  tooltips with `{ withinPortal: false, floatingStrategy: 'fixed' }` (`ROW_TOOLTIP` in `PurchaseLinesGrid`). Both
  invoices now appear in under 7 s (production build, API included).

### The Auto-plan and Add Container defaults

`useContainerOrderDefaults(orderId)` (`components/logistics/containerDefaults.ts`, `GET …/containers/order-defaults/{id}`)
gives what both dialogs fill in by themselves. Both show "Supplier: SUP-0001 - TVS Motor Company (from the order)"
read-only (`OrderSupplierLine`: a container's goods come from its order lines, so its supplier is never typed). The
**Forwarder** starts as the forwarder of the order's most recent container, else the order's supplier, with a hint
saying which; the **Country of origin** as the supplier's country. Both stay editable and clearable: the picks are
held as `undefined` until the reader changes them, so the defaults arriving later never overwrite a choice.

## A container's next step (scripts 80 and 81: ship from the container, Next step everywhere)

The owner: "I cannot start the shipment of a specific container in the containers page or any other place; make shipment
more user friendly and flexible". So every container has **one action whose label is its next step**, worked out by the
server (`nextStepKind`, `nextStepBlockedReason`, the movement in progress or planned and the proposed next leg, on
`ContainerShipState`: the list row and the container carry the same columns) and worded in one place,
`components/logistics/nextStep.ts`. Phase 1 (script 80) gave the button; phase 2 (script 81) gives it one dialog for
every step, the proposal, many containers at once and the to-do list.

| The container (`nextStepKind`) | The label | What it opens |
|---|---|---|
| never moved (`Ship`) | "Start shipment…" | `NextStepModal`: the proposed first leg (Sea freight, port of loading → port of destination) |
| its next planned movement waits (`StartPlanned`) | "Start Inland transport…" (the type's name) | `NextStepModal`: that movement's start date |
| a movement in progress carries it (`Complete`) | by the stage of its type: "Arrived at Dar es Salaam…" (Sea, Transit), "Cleared customs at Kasumbalesa…", "Crossed the border at Kasumbalesa…", "Left the port of Beira…", "Loaded at the supplier…", "Delivered to Lubumbashi…" | `NextStepModal`: the date named by the stage, "Then start …" |
| its last leg is completed (`NextLeg`) | the proposed leg: "Inland transport to Kasumbalesa…", for a stay "Customs clearance at Kasumbalesa…", nothing to propose "Next leg from Dar es Salaam…" | `NextStepModal`: the new leg, filled in |
| delivered, not received (`Receive` / `OpenReceipt`) | "Receive goods…" / "Open goods receipt (draft)" | the goods receipt dialogs, with their own rules and permissions |
| received, closed or cancelled (`Done`) | "Next step…", disabled: "Received into Main Warehouse: the journey is over." / "This container is cancelled." (the row's entry reads "Next step: journey over") | - |

- **One hook runs it everywhere**: `useNextStep(onDone, origin)` (`components/logistics/useNextStep.tsx`; `origin` is
  `'container'` on the container's page, `'containers'` on the list) gives `action(container)` (null when the reader may
  not take the step: `containers.movements.manage` for a movement, `purchase.goodsreceipts.create` to receive, `.view` to
  open the draft - the entry is then hidden), `run(container)` and the `dialogs` to render. The container page puts it in
  the action bar **next to Save** (disabled "Save your changes first." while the form has unsaved edits; once delivered
  the page's own "Receive goods…" / "Open goods receipt (draft)" are the step); the Containers list puts it **first in the
  row's "…" menu** as "Next step: {label}", its reason under the label like Close and Cancel, and leaves out the receipt
  entry that would say the same thing twice.
- **On a narrow screen (below 75em) the Route card repeats the step** (`ContainerRouteTimeline`'s `step`): the card is
  the top of the page there and the action bar its bottom, a whole page of scrolling away (6,400 px on a phone). The
  card's button is the same label, reason and dialog; a disabled one says its reason under the buttons (a phone shows no
  tooltip). A delivered container's step is its goods receipt: the card then opens with "Open goods receipt (draft)" or
  "Receive goods…" (green, the page's own rules and permissions), before "Add to a movement…" and "New movement for
  this container", and the action bar keeps that button beside Save instead of folding it into "More actions".
- **The order's and the invoice's Containers cards have a row "…" menu (script 82)**, `ContainerRowMenu`: "Next step:
  {label}" first, then "Open container" (see **Row menus of the order's and the invoice's Containers cards** below). The
  Tracking board has no row menu: its rows open the container. The Shipments board's cards carry the step themselves.
- **Start and Complete from the movement side stay one dialog**, `MovementStatusModal`, on the movement page and a row of
  the Movements list ("Start…" / "Complete…"). Its title and date field follow the same words (`completeWords`): "Arrived
  at Dar es Salaam - KTG-…", "Clearance date".

### The Next step dialog (one container)

`NextStepModal` reads `GET …/containers/{id}/next-step` when it opens and applies the step with `POST
…/containers/next-step` (one group of one container). The server takes the movement's own Complete / Start, so a
Delivery still drafts its goods receipts after the commit, and saves a new leg with the movement procedures, so every
rule of phase 1 holds. A refusal is shown in the dialog as it comes, and the dialog stays open.

- **A new leg** (title "Inland transport to Kasumbalesa - KTG-2026-0031"): "Now at Dar es Salaam since 12/10/2026 (end
  of MOV-2026-000046)." / "Not moved yet: leaves from its port of loading Chennai."; the fields are `NextLegFields`
  (shared with the bulk dialog's "Edit…"): Movement type grouped by stage, the proposal by default, with where it came
  from under it - "Suggested: the usual next leg from Dar es Salaam (5 earlier legs)", "Suggested from the container's
  ports", "Suggested from the stages", "Choose the To", and "Choose the type" when the usual type of the next stage is
  inactive (the container still moves on: the reader picks a type); changing the type proposes the To again (`retypeLeg`); From
  read-only ("A container leaves from where it is."); To grouped Sea ports / Border posts / Inland places, replaced by "at
  Kasumbalesa" for a stay; "Start now" / "Plan only"; Start date (today, not after it when starting, not before the end of
  the previous leg); ETA; Carrier (`SearchSelect`); Vehicle / vessel; Reference; Notes; for a sea leg Voyage, B/L No.,
  B/L date prefilled from the container and "Copy vessel, voyage, B/L and ETA to the container" (on). Alerts: blue for
  a draft (confirmed first; a reader without `containers.confirm` can only plan it), yellow without a container number,
  orange when the container never moved and has typed dates ("The dispatch and arrival dates typed on this container
  will be replaced by the movements' dates."). Button "Start Inland transport" / "Plan Inland transport", "Start
  shipment" / "Plan shipment" for the first leg.
- **A leg in progress** (title "Arrived at Dar es Salaam - KTG-2026-0031"): "MOV-2026-000046 Sea freight: Chennai → Dar es
  Salaam, started 20/09/2026, ETA 12/10/2026."; the date named by the stage ("Arrival date", "Clearance date", "Crossing
  date", "Departure date", "Delivery date"), today, not before the start, not in the future; when it carries others,
  **"Which containers?"** (script 82, see **Only part of a movement arrived** below) - "All 12 containers of MOV-…" with
  "All 12 containers of MOV-… arrive too: …", or "Only KTG-…: it leaves MOV-… and gets its own movement";
  **"Then start …"** for the leg the server proposes after it -
  ticked by default for a stay at the arrival place or the leg after Customs / Border, unticked for a leg that moves, off
  with a hint when there is no To to propose, absent when the container's next leg is already planned. A Delivery shows `DeliveryCompletePreview` and "Then open the draft goods
  receipt" instead. Buttons "Record arrival", "Record clearance", "Record crossing", "Record departure", "Record
  delivery", "Record loading". **The Then leg is a second step on the server**: refused, the arrival stays and the
  notification says "Arrival recorded; Customs clearance was not started: {reason}. Use Next step…" - and when someone
  planned the next leg meanwhile, which one: "…the next leg was not started: its next leg MOV-2026-000058 (Customs
  clearance) is already planned. Start it with Next step…".
- **No port of loading** (never moved, none on the container: any From fits it): "Not moved yet, and no port of loading:
  choose where it leaves from.", the From is a field (required) and is sent as `fromPlaceId`.
- **Every new leg sends `expectedPlaceId`** (the place the dialog was opened at; the bulk dialog sends its group's From):
  moved since by someone else, the server refuses it ("KTG-… is now at Kasumbalesa: open Next step… again.") instead of
  making a leg from the new place to the To chosen for the old one.
- **Not a movement** (a draft goods receipt waits, goods to receive, journey over: the movement page's "Continue: Next
  step…" can open the dialog on such a container): the dialog says what comes next and offers "Open goods receipt
  (draft)" / "Open the container", with nothing to submit.
- **A planned leg**: its start date; "It also carries KTG-…, KTG-… (2 more): they start with it."; the refusal Start
  would give, in red, with the button off.
- **The notification is the server's sentence** ("KTG-2026-0031: arrived at Dar es Salaam on 17/10/2026
  (MOV-2026-000046). Now At Port. Then Customs clearance at Kasumbalesa started on 17/10/2026 (MOV-2026-000047).") with
  "Open MOV-…" links that carry the way back, then the Delivery's draft goods receipts (`showDeliveryResult`) and the
  warnings, each on its own.

### Many containers: the bulk dialog

The selection bar's "Next step…" (the Containers list and the order's Containers card: the shared `ContainerSelectionBar`)
replaces "Start shipment…". It is disabled with "None of the ticked containers can move on: {first reason}."
(`nextStepRefusal`) when nothing qualifies; one ticked container opens `NextStepModal`, several `NextStepBulkModal`:

- **One preview call** (`POST …/next-step/preview`) groups the ticked containers by step, movement, type, From and To:
  containers at different places fall into separate groups by themselves. Title "Next step - 300 containers".
- **The groups table**, one row each: a checkbox (included), the step ("Arrived at Dar es Salaam", "Inland transport to
  Kasumbalesa") with where the proposal came from, the movement ("MOV-…", "new" for a new leg), From → To, the count
  (click it for the refs), "Orders / suppliers" for information, and for a new leg "One movement for the group" / "One
  per container" (the server's default: one for Sea, Port, Origin and transshipment, one per container for road legs),
  whose hint follows the stage (`onePerContainerHint`: "each truck arrives on its own day" on a road leg, "each container
  is cleared on its own day" for Customs, "crosses" for Border, "is delivered" for Delivery), and "Edit…" (`NextLegFields` without the date, plus a Truck
  no. / ETA table per container when one per container). A Complete group where only part of the movement is ticked
  offers "Complete MOV-… for all its 30 containers" / "Only the 20 ticked (they get their own movement)" (script 82), or,
  when the ticked cannot arrive alone, says "MOV-… is completed for all its 30 containers: the 10 not ticked arrive too."
  with the server's reason; it carries "Then start …" when the server proposes a next leg. Under the step, the group's
  notes: "{n} drafts: confirmed first.", for a new leg "{n}
  without a container number: the shipment can start without it." (the dialog for one container's yellow alert), "{n}
  with typed dates: …". A group that cannot go as it stands (date before its earliest, no To, no type) says why in red
  and holds the button: "Choose the movement type. Use Edit…" (the ellipsis ends the sentence). A group changed with
  Edit… is worded as changed everywhere, its row and its result ("Border crossing at Kasumbalesa", not "Next leg from
  Kasumbalesa").
- **One date at the top** for every step, and "New legs: Start now / Plan only".
- **"Cannot move on (n)"**, grouped by the server's reason with counts and the first refs. A delivered container is
  "Delivered: its goods are received next (Receive goods…)", or, when its draft goods receipt already waits, "A draft
  goods receipt waits: Open goods receipt (draft)" (Receive goods… would refuse it). A missing proposal is never a
  reason: such containers form a group whose type is chosen with Edit….
- **"Apply to 285 containers (4 steps)"**: each group runs alone (one refusal never stops the others) and is all or
  nothing inside. A group going one movement per container is sent in parts of 50 ("Moving on: 150 of 300"), each part
  all or nothing; a group that is one movement is sent whole, so a movement is never cut in two. A Complete or a Start is
  never split either: its first part would complete the movement for everyone.
- **The results** are `BulkResultsModal` (first column "Step"): OK or "Refused" (the API's code, NEXT_STEP_CHANGED,
  is for the program: it is only the badge's tooltip, in every bulk result), the server's sentence (it
  names the MOV numbers made), the draft goods receipt note, the warnings. Closing it unticks the containers that moved
  and keeps the refused ones ticked.

### The Next step column and the movement page

- **The Containers list has a "Next step" column** (the label without "…", a gray reason when the step is blocked) whose
  funnel (`NextStepFilterPopover`, one value with "(All)") and the advanced filter "Next step" are two ways into the
  server's `nextStep` parameter: "Start shipment" / "Start planned leg" / "Arrival due" / "Next leg to plan" / "Receive
  goods". It is the logistics to-do list, so it works on every container, not only the rows loaded; the column's own
  meta is `filterable: false` so the browser does not filter it a second time. The phase 1 Movement column ("Planned:
  MOV-…") stays.
- **After a Complete on the movement page** (not a Delivery: its goods are received next), a notification offers
  "Continue: Next step…" for its containers: the bulk dialog, or the container's own dialog when it carries one.
- **"Cancel…" says why before the click (script 83).** The movement's `canCancel` and `cancelBlockedReason` are the
  server's (`fn_Movement_CancelBlock`: the refusals of the Cancel itself, in its words): a later leg of one of its
  containers ("MOV-… is not the last leg of KTG-…: cancel MOV-… first."), a container already received or closed
  ("Container KTG-… is already offloaded: its route can no longer change."). The movement page keeps "Cancel…" on every
  movement that is not cancelled, disabled with that reason (a tooltip on a wide screen; the dimmed line under its label
  in a phone's "More actions" menu), so its dialog - the reason, the split-undo sentence, a Delivery's drafts - opens
  only when the Cancel will go through. A refusal that still comes (someone changed the movement meanwhile) is shown as
  it comes. The Movements list offers no Cancel: a list row's `canCancel` is the status alone.

### The locked From

**A container leaves from where it is**: the To of its latest movement, else its port of loading (`placeId` /
`placeName`). Wherever a leg is made for known containers, the From is that place and is **not editable**: a read-only
field with the hint `FROM_LOCKED_HINT`, "A container leaves from where it is." - in the Next step dialogs (one container,
and each group of the bulk dialog, where containers at another place fall into a group of their own) and in the movement
form opened from one container (`/logistics/movements/new?containerId=12&from=container/12`).
Two exceptions: **Loading at the supplier** ends at the port of loading, so its To is locked instead and its From is
free; a container with no place at all (never moved, no port of loading) gets a free From. A **stay** (Port, Customs,
Border) starts with To = From. Every place picker is grouped **Sea ports / Border posts / Inland places**
(`placeOptionGroups`), so a border post is never taken for the sea port of the same town.

**Back follows the way in**: a movement page opened with `?from=container/12` returns to that container (its Back and
its breadcrumb), one opened with `?from=containers` (the list's "Next leg…") returns to the Containers list, one opened
with `?from=shipments` (a card of the Shipments board, script 82) returns to the board, and all keep the parameter when a
new movement is saved. `useNextStep(onDone, origin)` takes `'container'` (its page, and its row on an order's or an
invoice's Containers card), `'containers'` or `'shipments'`. Every way into a movement from a container carries
it: "New movement
for this container", the MOV-… links of the route card (`ContainerRouteTimeline`'s `returnQuery`, "?from=container/12" by
default - the board's drawer passes "?from=shipments") and the "Open MOV-…" links in the notification after a Next step
(`NextStepModal`'s `returnQuery`; the selection bar passes its own, `ContainerSelectionBar`'s `returnQuery` -
"?from=shipments" on the board), and the movement page's own dialogs keep the page's (`MovementStatusModal`'s
`returnQuery`: its "Open MOV-…" after a split; the "Open MOV-…" after a split undone). A link without it goes back to the
Movements list.

**The start date of a movement in progress stays a fact**: the movement page lets it be changed after Start, so its
field shows the Start dialog's two refusals before the Save - after today, and before `startNotBefore` (which the API
also gives for a movement in progress) - and the Save refuses both as well (70000 / 70018).

## The Shipments board (script 82: Logistics › Shipments)

The owner: "make shipment more user friendly and flexible". Phase 3 of the container-first design: **every container on
its way, in one column by stage**, each card with its next step. Route `/logistics/shipments`
(`pages/logistics/ShipmentsBoardPage.tsx`), first in the Logistics menu (icon `board`), permission
`containers.shipments.view` (`PERMISSIONS.shipmentsView`); the pieces are in `components/logistics/shipments/`
(`shipmentBoard.ts` the arithmetic, `ShipmentCard`, `ShipmentColumn`, `ShipmentDrawer`, `ShipmentsList`), the API in
`api/logistics/shipments.ts` (`GET api/logistics/shipments/board`).

- **The column, the group and their order are the server's** (`phase`, `groupKey`, `groupLabel`, `groupOrder`, decided by
  `logistics.fn_Container_BoardPhase` from the same movements as the next step), never worked out here:
  `boardColumns(columns, cards)` only gathers the cards it placed. Columns, left to right, with their titles as the server
  gives them: "At supplier", "At sea", "At port", "On the road", "At border / customs", "Delivered, to receive", and with
  "Show received (30 days)" "Received (30 days)". Each header: the title, "22 containers · 1,848 pcs" (`columnFigures`) and
  "Select all ({n})"; the Received column is read-only ("Read-only: received in the last 30 days.": no boxes, no step).
- **Groups fold** (the chevron; kept across reloads), each with its own "Select all": a ship "MOV-2026-000046 · MSC Aurora
  V.123 · Chennai → Dar es Salaam · ETA 20/10/2026 (84)" (one tick takes the whole ship; its movement number a link,
  `GroupLabel`), a road leg "Dar es Salaam → Kasumbalesa (12)", a place "Dar es Salaam (120)", "No port of loading (2)",
  a warehouse; the containers followed by typed dates at sea in "Followed by typed dates", after the ships.
- **A card** (`ShipmentCard`): ref (a button: the drawer from the keyboard), "MSKU1234565 · 40HC", "84 pcs
  TVS-APACHE-160" / "2 items, 120 pcs" (`itemsText`), the supplier on one line (the whole name on hover), the order on
  its own line (a link only for the container's own and only order, with `purchase.orders.view`), where it is
  (`WhereLine`: the leg's "MOV-… · T 123 ABC · ETA 03/10/2026" in red when late, a stay "MOV-… Customs clearance since
  04/10/2026", "Since 28/09/2026", "Not moved yet", "Followed by typed dates" (`followedByTypedDates`: no leg yet, in
  the column of the status its typed dates gave it), "Delivered 08/10/2026", "Received …"; nothing on a ship's cards,
  whose group says it), the badges (`CardBadges`: red "Late" and "Free time over" with the last free day on hover,
  "Draft", "No container no.", "Cleared" in At border / customs, "GRN draft" linked to the draft with
  `purchase.goodsreceipts.view`, the GRN number once received), "Planned next: MOV-… Inland transport → Kasumbalesa"
  (`PlannedNext`) and **"Next step: {label}"** (`NextStepLink`): phase 2's `useNextStep(reload, 'shipments')`, hidden
  without the right to take it - and without `containers.view`, whose next-step read the dialog needs (then the List
  shows the step's words, not a link) - dimmed with its reason in words when blocked. Every MOV number of the board -
  the cards, a ship's group header, the List's Place or leg - is a link only with `containers.movements.view`, carrying
  `?from=shipments`. Clicking a card (not its box, links or step) opens the drawer.
- **The drawer** (`ShipmentDrawer`, full screen on a phone): the card's facts, the container's own `ContainerRouteTimeline`
  (read when it opens: today's route; `canManage` false, its step button in the card's header; its MOV links carry
  `?from=shipments`, its `returnQuery`, so Back on that movement returns to the board) and "Open container".
  Taking the step closes the drawer first, so the step's dialog is the only one on screen. Without `containers.view` it
  says what the card says, offers no step and no page, and says why: "Its route, its next step and its page need the
  View Containers permission."
- **Filters on the server** (`useGridQuery`, no Apply): Search ("Ref, container no., B/L, vessel or order no.", typed),
  Supplier and Purchase order (`SearchSelect`, the order only with its view permission), Branch, Place (grouped Sea ports /
  Border posts / Inland places), and the switches "Late only", "With a planned leg", "Show received (30 days)"; Clear
  Filters.
- **The selection is ids**, ticked on cards, a group or a column, held by the page and **narrowed at every settled answer
  to the cards still on the board** (in the render that brings it). It is the Containers list's own
  `ContainerSelectionBar` (Confirm, "Container numbers…", "Next step…", "Add charge…", Delete, Clear): a card is a
  container row (`api` fills an absent `containerNo` with null for it). After any action the board reads itself again.
  One ticked container opens its own Next step dialog and two or more the bulk dialog; both read with `containers.view`
  (the container's step; the movement types the bulk dialog builds new legs from - without them it never finished
  loading): without it "Next step…" waits (dimmed) with "Next step… needs the View Containers permission."
- **50 cards a column**, then "Showing 50 of 66 containers. Show 16 more · Show all" (`CARDS_STEP`, `drawColumn`). Only
  the drawing is cut: every group header is drawn (its "Select all" reaches the whole group), the column's "Select all"
  every container in it, a group cut short says "{n} more in this group: Show 16 more below." (the button's own count,
  at most 50), and a folded group draws nothing and uses none of the limit.
- **"Board" / "List"** (a `SegmentedControl` in the header, the choice kept in `localStorage`
  `inventory_shipment.shipments.view`, guarded): the List is the same rows and selection in one `DataTable` with an engine
  (`storeKey` `logistics.shipments`, 50 a page up to 500, every column sorting and filtering in the browser) - Container
  Ref., Container No., Stage, Place or leg (the group's words, a ship's movement number linked), Next step (the label
  alone, a link), Badges, Supplier, Order No., Qty - for 300 containers or more; a row opens the same drawer.
- **Wide (62em and up): the columns side by side**, `flex: 1 0 184px` - six fit at 1440 px with the menu open - each body
  scrolling on its own (`max(360px, calc(100dvh - 380px))`) so its header stays in view; a seventh column (Received)
  scrolls sideways **inside the board**, never the page. The body is a plain scrolling `div`, not Mantine's `ScrollArea`,
  whose content is laid out as a table: long lines did not wrap and were cut at the column's edge.
- **Below 62em one column at a time**, picked from a row of pill tabs with the counts ("At sea 22") that scrolls inside
  itself; the page never scrolls sideways (390 px). Each count keeps its whole number (`WHOLE_BADGE` on the tab's badge:
  squeezed into the tab, a count of 10 or more drew an empty pill). The column then has no inner scroll: the page
  scrolls.
- **Refresh**: the "Refresh" button ("Updated HH:mm" beside it), after every action, and a minute after the last answer -
  looked at every 15 s and when the tab comes back - **only while the tab is visible and no dialog is open** (a Mantine
  Modal or Drawer on screen: `[role="dialog"][aria-modal="true"]`), so nothing is read again under the reader's feet. The
  selection survives it.
- **No drag-and-drop, on purpose**: every move writes a movement with its dates, so every move goes through the Next step
  dialogs.
- **The answer carries only what the board, the List and the drawer read, without its empty fields** (5,000 cards are
  3.6 MB of JSON; they were 11.9 MB, 45% of it nulls): an absent field reads as null - test with `??` or truthiness,
  never `=== null`.

### Only part of a movement arrived (script 82: the split choice in three dialogs)

A movement in progress can be completed for **some** of its containers: those get their own movement - a copy with the
same header and start date, already in progress - which is completed (a Delivery drafts only their goods receipts); the
others stay on it, in progress. The server says whether a container can leave its movement and why not (`canSplitOff` /
`splitOffBlockedReason` on the next step, the preview's rows and the movement's containers; `splitPossible` /
`splitBlockedReason` on a preview group); the dialogs show it before the click and send the choice. **"All" stays the
default everywhere.**

- **`NextStepModal`**, a Complete of a movement that carries other containers: "Which containers?" - "All 12 containers of
  MOV-2026-000046" (the default, with the orange "…arrive too: …") / "Only KTG-2026-0031: it leaves MOV-2026-000046 and
  gets its own movement" (disabled, the server's reason as its description, when it cannot). Chosen, a blue line says "the
  11 others stay on MOV-…, in progress", the Delivery preview names this container only, and the group goes with
  `splitOff: true`; the Then leg works as after any arrival.
- **`NextStepBulkModal`**, a Complete group where only part of the movement is ticked: "Complete MOV-… for all its 30
  containers" (default) / "Only the 20 ticked (they get their own movement)" ("Only the ticked one (it gets its own
  movement)" for one); chosen, the row's Movements cell says what happens to the movements - "A new movement, completed;
  MOV-2026-000046 stays in progress with the 10 others" ("…with the other container" for one), never "Completed", which
  read as if MOV-… itself were completed; its result row reads "{step} (only the ticked)". When the ticked cannot arrive alone the phase 2
  sentence stays ("…the 10 not ticked arrive too.", "the one not ticked arrives too.") with "Only the ticked cannot
  arrive on their own: {reason}" ("Only the ticked one cannot arrive on its own: {reason}").
- **The movement page's Complete dialog** (`MovementStatusModal` with `allowSplit`, a movement in progress carrying
  several): the switch "Only some containers arrived" turns on a checklist of its containers (ticked = arrived, a
  container that cannot leave disabled with its reason), "Arrived: 2 of 12", and the button "Complete 2 of 12
  containers" (`POST …/movements/{id}/complete-some`). None ticked: "Tick the containers that arrived."; every one:
  "Every container of MOV-… is ticked: complete the movement itself (turn off "Only some containers arrived")." - the
  button waits. While the switch is on the dialog is the movement's: its title is "Complete MOV-…" (never the container
  it was opened from) and "All 12 containers of MOV-… arrive too" is not said. After it the page reads its movement
  again (the others, still in progress) and offers "Continue: Next step…" for the ones that arrived. The page's buttons
  that open these dialogs read "Start…", "Complete…" and "Cancel…". On a phone (36em and below) the dialog does not
  focus its date when it opens: the calendar that focus opens covered the switch and the checklist above the date, where
  a tap picked a day instead.
- **The notifications are the server's**: "KTG-2026-0031: arrived at Dar es Salaam on 17/10/2026 with MOV-2026-000052
  (split off MOV-2026-000046). Now At Port. The 11 others are still on MOV-2026-000046." with "Open MOV-…", then the
  Delivery's draft goods receipts (`showDeliveryResult`). **Split but not completed** (`ok` false with
  `splitFromMovementId`, rare: the date is checked before anything is split) is **a warning, never a failure**: an orange
  notification "MOV-… was split off MOV-… but not completed: {reason}. Complete it on its page." with that movement's link
  (the host reloads); in the bulk results the row reads "Refused" with that sentence in orange, and its containers stay
  ticked - so does the container of the selection bar's one-container step (`NextStepModal` calls `onDone(false)`). A
  refusal before the split is the usual error, in the dialog. No answer at all from `complete-some` (a server error, a
  lost connection: no 4xx) is never read as "nothing split": an orange notification says it is not known whether the
  ticked containers left the movement, and the page reads its movement again (`onSplitDone(null)`). The API answers
  every split it committed, even when the completion failed for no business reason ("…but not completed: the database
  did not answer (see the API log)."); `movementId` / `movementNo` name the new movement when it could not be read
  back.
- **The movement page** shows "Split from" with the original movement linked (`splitFromMovementId`), and its history
  (`history`: "Split off" in orange, "Split from" in violet, "Split undone" in orange, with their details) among the
  stamps in the Activity card.
- **Cancelling a split-off movement undoes the split** (the server's rule: its containers go back onto the movement they
  were split from). Its **Cancel dialog says it first**, in an orange Alert above the reason (`splitUndoText`,
  `components/logistics/splitUndo.ts`, from the movement's `splitUndo…`: that movement's number, status, end date, To
  and stage, and the dialog's own containers): "Cancelling MOV-2026-000073 puts KTG-2026-0030 and KTG-2026-0031 back on
  MOV-2026-000044, which is still in progress." / "…, which arrived at Dar es Salaam on 17/10/2026: they arrive with it."
  (by the stage: "cleared customs at …: they are cleared with it", "…reached Lubumbashi on …: KTG-… is delivered
  with it, without a draft goods receipt. Use Receive goods… on it") / "…, which is cancelled: they go back to where they
  were before it." - above a Delivery's own list of the draft goods receipts deleted with it. **The notification after
  it is the server's** (`splitUndone.message`, green, with "Open MOV-…" that keeps the page's way back), worked out when
  the cancel ran - that movement may have moved on while the dialog was open. The cancelled record's red Alert adds the
  line "Split undone: KTG-… back on MOV-…" from its history (it has no container left).

### Row menus of the order's and the invoice's Containers cards (script 82)

`ContainerRowMenu` (`components/logistics/`) is the "…" `ActionIcon` at the end of each container row of
`OrderContainersCard` and `ShippedInvoiceContainersCard` (the first row of a container on the invoice, beside Unlink):
"Next step: {label}" first - phase 2's dialog through `useNextStep(…, 'container')`, read from the container list row
(the order's list, or `containersApi.list({ purchaseDocumentId })` for the invoice, every page, with `containers.view`);
hidden without the right to take it, disabled with its reason under the label (a disabled menu item has no tooltip) -
then "Open container". **A click on the menu is the menu's**: it stops there and never reaches the row. After a step the
card reads its containers again (the order's host reloads the order; the invoice's card its summary and its rows). The
order card's Ref. never wraps and its Status badge keeps its whole word (`WHOLE_BADGE`) beside the extra column.

## Item Definition: the sticky item header, Previous / Next, Note and Link (script 87)

- **The whole page header is frozen** under the app's fixed header (`top: var(--app-shell-header-offset, 64px)`,
  `zIndex: 3`, the page's own `CONTENT_BG` stretched over the page padding, a thin line under it): breadcrumbs, the
  code with its Active / Inactive and BIVAC badges (`PageHeader`'s `titleExtra`), "{name} · {family} · {brand}", and
  the actions. `PageHeader truncateTitle` keeps the code and the name on one line each, cut with an ellipsis. Nothing
  above the page may clip overflow, or `position: sticky` stops working.
- **Previous / Next sit first among the actions**, before Edit Item, in view mode only: moving away from half-typed
  changes is what Cancel / Save is for. Below 576 px the header keeps one row of buttons: the arrows without their
  words (the target code is their tooltip / `aria-label`), Edit Item, and a compact "…" (`MoreActionsMenu compact`)
  that also holds Copy Item and Back to list.
- **An item opens at the top** (`window.scrollTo(0, 0)` in a layout effect, once per item): the router keeps the
  window's scroll, so an item opened from far down the list used to open half-way down.
- **Previous / Next follow the list the reader came from** (`pages/inventory/itemSequence.ts`): `ItemsPage` writes its
  filtered, sorted rows (id, code, active) to sessionStorage on every change; the item page steps to the nearest
  ACTIVE row either side, disabled at both ends (no wrap-around). An item that list does not hold (opened from a link,
  a document, a new tab) steps through every active item by code, placed by its own code, so an inactive item still
  finds its neighbours. Activate / Deactivate / Delete on the item page update the remembered list.
- **Note**: a textarea (2,000 characters, counter) right under the Description (same column, a 2 px gap in edit mode),
  shown read-only with its line breaks (`Field multiline`).
- **Link**: beside the Default Warehouse, with its "Open link" button; `type="url"`, checked when leaving the field and on Save: an absolute `http://` / `https://` address with a
  host and no spaces (`isWebAddress`; the API and `inventory.usp_Item_SetNotes` refuse the rest). "Open link" is
  disabled while the field is empty or invalid and opens a new tab with `noopener,noreferrer`; in view mode the address
  is also a plain link with `rel="noopener noreferrer"`.

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
- [ ] A page routed outside `AppShell` (a print page, a public page) renders `<TestingMarker />` first (see
      **Environments (Production / Testing)**).
- [ ] `npm run typecheck`, `npm run lint`, `npm run build` all clean; no `any`, no TODOs, no mock data.
