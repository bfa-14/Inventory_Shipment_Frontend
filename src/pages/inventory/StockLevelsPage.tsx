import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Checkbox,
  CloseButton,
  Group,
  Menu,
  Pagination,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import {
  IconArrowsExchange,
  IconClock,
  IconDots,
  IconEye,
  IconFileExport,
  IconFileImport,
  IconFilterOff,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { useNavigate, useSearchParams } from 'react-router'
import { ApiError } from '../../api/http'
import {
  stockLevelsApi,
  type CompanyStockLevelListResult,
  type CompanyStockLevelQuery,
  type CompanyStockLevelRowDto,
  type StockLevelListResult,
  type StockLevelQuery,
  type StockLevelRowDto,
  type StockLevelStatus,
} from '../../api/inventory/stockLevels'
import { branchesApi } from '../../api/masterdata/branches'
import { brandsApi } from '../../api/masterdata/brands'
import { itemFamiliesApi } from '../../api/masterdata/itemFamilies'
import { warehousesApi } from '../../api/masterdata/warehouses'
import type { BranchLookupDto, BrandLookupDto, ItemFamilyLookupDto, WarehouseLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { formatNumber } from '../../components/format'
import { CreateTransferFromLevelsModal } from '../../components/stockLevels/CreateTransferFromLevelsModal'
import { ImportStockLevelsWizard } from '../../components/stockLevels/ImportStockLevelsWizard'
import { StockLevelBadge } from '../../components/stockLevels/StockLevelBadge'
import { StockLevelFormModal } from '../../components/stockLevels/StockLevelFormModal'
import { StockLevelHistoryModal } from '../../components/stockLevels/StockLevelHistoryModal'
import {
  COMPANY_STOCK_LEVEL_STATUS,
  inactiveWarehouseText,
  LEVEL_COLUMN_HINTS,
  levelPhoneLine,
  levelText,
  levelWarehouseText,
  removeLevelQuestion,
  stockLevelStatusInfo,
  updatedText,
} from '../../components/stockLevels/stockLevelStatus'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'
import { routes } from '../../routes'
import { brandLabel, familyOptions, warehouseOptions } from './lookups'

/* ══ the filters, and what a link may preset ═══════════════════════════════════════════════════ */

type View = 'warehouse' | 'company'

/** 'All' = every level (the default); NoLevel = the pairs without a level that hold stock or are on a released transfer. */
type LevelStatusFilter = 'All' | StockLevelStatus

interface WarehouseFilters {
  search: string
  branchId: string | null
  warehouseId: string | null
  itemFamilyId: string | null
  brandId: string | null
  status: LevelStatusFilter
  activeItemsOnly: boolean
  includeInactiveWarehouses: boolean
  /** The "Item: {code}" chip: one item's levels (the company view's "3 warehouses", a link). */
  itemId: number | null
  /** The chip's words when known; never sent. */
  itemCode: string | null
}

const WAREHOUSE_DEFAULTS: WarehouseFilters = {
  search: '',
  branchId: null,
  warehouseId: null,
  itemFamilyId: null,
  brandId: null,
  status: 'All',
  activeItemsOnly: true,
  includeInactiveWarehouses: false,
  itemId: null,
  itemCode: null,
}

interface CompanyFilters {
  search: string
  branchId: string | null
  itemFamilyId: string | null
  brandId: string | null
  status: 'All' | 'BelowMin'
  activeItemsOnly: boolean
}

const COMPANY_DEFAULTS: CompanyFilters = {
  search: '',
  branchId: null,
  itemFamilyId: null,
  brandId: null,
  status: 'All',
  activeItemsOnly: true,
}

const LEVEL_STATUS_DATA: { value: LevelStatusFilter; label: string }[] = [
  { value: 'BelowMin', label: 'Below Min' },
  { value: 'Covered', label: 'Below Min, covered' },
  { value: 'AboveMax', label: 'Above Max' },
  { value: 'Ok', label: 'OK' },
  { value: 'All', label: 'Every level' },
  { value: 'NoLevel', label: 'Without a level' },
]

const COMPANY_STATUS_DATA: { value: CompanyFilters['status']; label: string }[] = [
  { value: 'BelowMin', label: 'Below Min' },
  { value: 'All', label: 'Every item with a company Min or Max' },
]

const LEVEL_STATUSES = new Set<string>(['BelowMin', 'Covered', 'AboveMax', 'Ok', 'NoLevel'])

/** A positive whole number from the address, else null. */
function idParam(params: URLSearchParams, key: string): number | null {
  const value = Number(params.get(key))
  return Number.isInteger(value) && value > 0 ? value : null
}

/**
 * THE ADDRESS, READ ONCE WHEN THE PAGE OPENS (`view, status, branchId, warehouseId, itemId`): the Dashboard's two lines,
 * a link of the transfer order. It presets the view it names; the other view starts with its defaults.
 */
function fromAddress(params: URLSearchParams): { view: View; warehouse: WarehouseFilters; company: CompanyFilters } {
  const view: View = params.get('view') === 'company' ? 'company' : 'warehouse'
  const status = params.get('status') ?? ''
  const branchId = idParam(params, 'branchId')
  if (view === 'company') {
    return {
      view,
      warehouse: WAREHOUSE_DEFAULTS,
      company: {
        ...COMPANY_DEFAULTS,
        status: status === 'BelowMin' ? 'BelowMin' : 'All',
        branchId: branchId === null ? null : String(branchId),
      },
    }
  }
  const warehouseId = idParam(params, 'warehouseId')
  return {
    view,
    company: COMPANY_DEFAULTS,
    warehouse: {
      ...WAREHOUSE_DEFAULTS,
      status: LEVEL_STATUSES.has(status) ? (status as StockLevelStatus) : 'All',
      branchId: branchId === null ? null : String(branchId),
      warehouseId: warehouseId === null ? null : String(warehouseId),
      itemId: idParam(params, 'itemId'),
    },
  }
}

const idOrUndefined = (value: string | null) => (value === null ? undefined : Number(value))

function warehouseQuery(f: WarehouseFilters): StockLevelQuery {
  return {
    search: f.search.trim() || undefined,
    branchId: idOrUndefined(f.branchId),
    warehouseId: idOrUndefined(f.warehouseId),
    itemFamilyId: idOrUndefined(f.itemFamilyId),
    brandId: idOrUndefined(f.brandId),
    itemId: f.itemId ?? undefined,
    status: f.status === 'All' ? undefined : f.status,
    activeItemsOnly: f.activeItemsOnly,
    includeInactiveWarehouses: f.includeInactiveWarehouses,
  }
}

function companyQuery(f: CompanyFilters): CompanyStockLevelQuery {
  return {
    search: f.search.trim() || undefined,
    branchId: idOrUndefined(f.branchId),
    itemFamilyId: idOrUndefined(f.itemFamilyId),
    brandId: idOrUndefined(f.brandId),
    status: f.status === 'All' ? undefined : f.status,
    activeItemsOnly: f.activeItemsOnly,
  }
}

/** Flat records: a shallow compare tells whether the reader narrowed anything. */
function same<T extends object>(a: T, b: T): boolean {
  return (Object.keys(a) as (keyof T)[]).every((key) => a[key] === b[key])
}

/** The lists the filter bars pick from, read once for both views. */
interface Lookups {
  branches: BranchLookupDto[]
  warehouses: WarehouseLookupDto[]
  families: ItemFamilyLookupDto[]
  brands: BrandLookupDto[]
}

/* ══ the page ═══════════════════════════════════════════════════════════════════════════════════ */

/**
 * INVENTORY › STOCK LEVELS (script 91): each warehouse's own Min / Max and where it stands - on hand, and what released
 * transfer orders bring or take - and, in a second view, the company's Minimum / Maximum Quantity of Item Definition
 * against the stock (the Dashboard's figure, "Items below their minimum" opens it).
 *
 * THE GRID ENGINE OF STOCK VALUATION: the server answers each view with one flat list and its own totals (the tiles), the
 * page sorts, pages and filters the columns itself. The filter bar narrows what the server sends; filters apply as they
 * are edited (no Apply button).
 *
 * EVERY FIGURE IS THE SERVER'S (inventory.fn_StockPosition): Projected = On hand + On the way in + To come in − To go
 * out, released transfer orders only; the status the first that applies (stockLevelStatus.ts). Setting, removing and
 * importing need Edit Stock Levels; "Create transfer order…" from ticked rows needs Create Transfer Orders as well.
 */
export function StockLevelsPage() {
  const [params] = useSearchParams()
  const { hasPermission } = useAuth()
  const phone = useMediaQuery('(max-width: 48em)')
  const canEdit = hasPermission(PERMISSIONS.stockLevelsEdit)

  // Read once at mount: a link presets the view and its filters; the reader takes over from there.
  const [start] = useState(() => fromAddress(params))
  const [view, setView] = useState<View>(start.view)
  /* Each view's filters as the reader left them, so switching views keeps them (each view remounts with its own). */
  const [warehouseFilters, setWarehouseFilters] = useState<WarehouseFilters>(start.warehouse)
  const [companyFilters, setCompanyFilters] = useState<CompanyFilters>(start.company)
  /** Bumped to remount the Per warehouse view on purpose (the company view's "3 warehouses"). */
  const [warehouseMount, setWarehouseMount] = useState(0)
  /** Bumped after a change made here (Add levels…, the import): the Per warehouse view reads again. */
  const [reloadKey, setReloadKey] = useState(0)

  const [lookups, setLookups] = useState<Lookups>({ branches: [], warehouses: [], families: [], brands: [] })
  const [dialog, setDialog] = useState<'add' | 'import' | null>(null)

  useEffect(() => {
    void Promise.allSettled([
      branchesApi.lookup(true),
      // Every warehouse, inactive ones too ("Inactive warehouses too"), parents included: a parent shows its leaves.
      warehousesApi.lookup(false),
      itemFamiliesApi.lookup(true),
      brandsApi.lookup(true),
    ]).then(([branches, warehouses, families, brands]) => {
      setLookups({
        branches: branches.status === 'fulfilled' ? branches.value : [],
        warehouses: warehouses.status === 'fulfilled' ? warehouses.value.filter((w) => w.isTransit !== true) : [],
        families: families.status === 'fulfilled' ? families.value : [],
        brands: brands.status === 'fulfilled' ? brands.value : [],
      })
    })
  }, [])

  async function exportToExcel() {
    try {
      await stockLevelsApi.exportToExcel(warehouseQuery(warehouseFilters))
    } catch (err) {
      notify.error(err instanceof ApiError ? err.messages.join(' ') : 'The stock levels could not be exported.')
    }
  }

  /** The company view's "3 warehouses": Per warehouse, with that item's levels only. */
  function openWarehouses(row: CompanyStockLevelRowDto) {
    setWarehouseFilters({ ...WAREHOUSE_DEFAULTS, itemId: row.itemId, itemCode: row.itemCode })
    setWarehouseMount((n) => n + 1)
    setView('warehouse')
  }

  const actions = (
    <>
      {canEdit ? (
        <Button variant="default" leftSection={<IconPlus size={16} />} onClick={() => setDialog('add')} data-levels-add>
          Add levels…
        </Button>
      ) : null}
      {canEdit ? (
        <Button
          variant="default"
          leftSection={<IconFileImport size={16} />}
          onClick={() => setDialog('import')}
          data-levels-import
        >
          Import from Excel…
        </Button>
      ) : null}
      {view === 'warehouse' ? (
        <Button
          variant="default"
          leftSection={<IconFileExport size={16} />}
          onClick={() => void exportToExcel()}
          data-levels-export
        >
          Export to Excel
        </Button>
      ) : null}
    </>
  )

  return (
    <div>
      <PageHeader
        title="Stock Levels"
        subtitle="Each warehouse's Min / Max and where it stands: on hand, and what released transfer orders bring or take."
        actions={actions}
      />

      {/* Below 48em the control takes the whole row, each option as wide as its label (the Dashboard's rule). */}
      <Box mb="md">
        <SegmentedControl
          value={view}
          onChange={(next) => setView(next as View)}
          data={[
            { value: 'warehouse', label: 'Per warehouse' },
            { value: 'company', label: 'Company (Item Definition)' },
          ]}
          fullWidth={phone}
          size={phone ? 'xs' : 'sm'}
          w={phone ? '100%' : undefined}
          styles={phone ? { control: { flex: '1 1 auto', minWidth: 0 } } : undefined}
          data-levels-view
        />
      </Box>

      {view === 'warehouse' ? (
        <PerWarehouseView
          key={`warehouse-${warehouseMount}`}
          initial={warehouseFilters}
          onFilters={setWarehouseFilters}
          lookups={lookups}
          reloadKey={reloadKey}
          phone={phone ?? false}
        />
      ) : (
        <CompanyView
          initial={companyFilters}
          onFilters={setCompanyFilters}
          lookups={lookups}
          reloadKey={reloadKey}
          onOpenWarehouses={openWarehouses}
          phone={phone ?? false}
        />
      )}

      {dialog === 'add' ? (
        <StockLevelFormModal
          opened
          item={null}
          source="StockLevels"
          onClose={() => setDialog(null)}
          onSaved={() => setReloadKey((n) => n + 1)}
        />
      ) : null}
      {dialog === 'import' ? (
        <ImportStockLevelsWizard
          opened
          onClose={() => setDialog(null)}
          onImported={() => setReloadKey((n) => n + 1)}
        />
      ) : null}
    </div>
  )
}

/* ══ the tiles ══════════════════════════════════════════════════════════════════════════════════ */

/** A clickable figure above the grid: it sets the status filter. Dashes until the figures are in. */
function Tile({
  label,
  value,
  colour,
  active,
  onClick,
}: {
  label: string
  value: number | null
  colour?: string
  active: boolean
  onClick(): void
}) {
  return (
    <UnstyledButton onClick={onClick} aria-pressed={active} data-levels-tile={label}>
      <Paper
        radius="lg"
        p="md"
        withBorder
        style={active ? { borderColor: `var(--mantine-color-${colour ?? 'brand'}-5)`, borderWidth: 2 } : undefined}
      >
        <Text size="sm" c="dimmed">
          {label}
        </Text>
        <Text fw={700} fz="lg" c={colour ? `${colour}.7` : undefined}>
          {value === null ? '—' : formatNumber(value)}
        </Text>
      </Paper>
    </UnstyledButton>
  )
}

/** A column caption that explains itself on hover; the chooser and the CSV read the caption's text. */
function hinted(caption: string, hint: string): ReactNode {
  return (
    <Tooltip label={hint} withArrow multiline w={280}>
      <span>{caption}</span>
    </Tooltip>
  )
}

/* ══ Per warehouse ══════════════════════════════════════════════════════════════════════════════ */

/** A level row with the one key the grid, its ticks and its marked row go by (item and warehouse). */
type LevelRow = StockLevelRowDto & { key: string }

interface LevelData {
  rows: LevelRow[]
  totals: StockLevelListResult['totals']
}

const NO_LEVEL_ROWS: LevelRow[] = []

const num = (value: number | null) => (value === null ? '' : formatNumber(value))

const LEVEL_COLUMNS: GridColumnMeta<LevelRow>[] = [
  { accessor: 'itemCode', summary: 'count' },
  { accessor: 'itemName' },
  { accessor: 'warehouseCode', text: (r) => levelWarehouseText(r) },
  { accessor: 'onHandBase', kind: 'number', summary: 'sum', text: (r) => formatNumber(r.onHandBase) },
  { accessor: 'inOnTheWayBase', kind: 'number', text: (r) => formatNumber(r.inOnTheWayBase) },
  { accessor: 'inToDispatchBase', kind: 'number', text: (r) => formatNumber(r.inToDispatchBase) },
  { accessor: 'outToDispatchBase', kind: 'number', text: (r) => formatNumber(r.outToDispatchBase) },
  { accessor: 'projectedBase', kind: 'number', text: (r) => formatNumber(r.projectedBase) },
  { accessor: 'minQuantityBase', kind: 'number', text: (r) => num(r.minQuantityBase) },
  { accessor: 'maxQuantityBase', kind: 'number', text: (r) => num(r.maxQuantityBase) },
  { accessor: 'toReachMaxBase', kind: 'number', summary: 'sum', text: (r) => formatNumber(r.toReachMaxBase) },
  { accessor: 'status', kind: 'list', text: (r) => stockLevelStatusInfo(r.status).label },
  { accessor: 'updatedAtUtc', text: (r) => updatedText(r) },
]

type RowDialog =
  | { kind: 'level'; row: LevelRow }
  | { kind: 'history'; row: LevelRow }
  | { kind: 'transfer'; rows: LevelRow[] }
  | null

interface PerWarehouseViewProps {
  initial: WarehouseFilters
  onFilters(filters: WarehouseFilters): void
  lookups: Lookups
  reloadKey: number
  phone: boolean
}

function PerWarehouseView({ initial, onFilters, lookups, reloadKey, phone }: PerWarehouseViewProps) {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const canEdit = hasPermission(PERMISSIONS.stockLevelsEdit)
  // "Create transfer order…" needs Create Transfer Orders AND View Stock Levels (this page's own): the ticks too.
  const canTick = hasPermission(PERMISSIONS.transfersCreate)
  const canOpenItem = hasPermission(PERMISSIONS.itemsView)

  const grid = useGridQuery<WarehouseFilters, LevelRow, LevelData>({
    initialFilters: initial,
    debounced: ['search'],
    initialSort: { columnAccessor: 'itemCode', direction: 'asc' },
    paging: 'client',
    errorMessage: 'The stock levels could not be loaded.',
    fetcher: useCallback(
      async ({ filters, signal }) => {
        const result = await stockLevelsApi.list(warehouseQuery(filters), signal)
        return { totals: result.totals, rows: result.rows.map((r) => ({ ...r, key: `${r.itemId}-${r.warehouseId}` })) }
      },
      [],
    ),
  })
  const { filters, setFilter, data, loading, error, reload } = grid
  const rows = data?.rows ?? NO_LEVEL_ROWS

  // The parent keeps the filters, so a switch to the company view and back finds them as they were.
  useEffect(() => onFilters(filters), [filters, onFilters])

  // A change made outside the grid (Add levels…, the import): read again - not at mount, which reads anyway.
  const mountedReloadKey = useRef(reloadKey)
  useEffect(() => {
    if (reloadKey !== mountedReloadKey.current) reload()
  }, [reloadKey, reload])

  // The server keeps its order (Below Min, covered, Above Max, OK, then item and warehouse): no sort to start with.
  const engine = useDataGrid({ rows, columns: LEVEL_COLUMNS, storeKey: 'inventory.stockLevels', pageSize: 50 })

  const [selected, setSelected] = useState<LevelRow[]>([])
  const [dialog, setDialog] = useState<RowDialog>(null)

  /** The ticked rows as they are NOW (a reload replaces the objects): what the bar and the dialog read. */
  const ticked = useMemo(() => {
    const keys = new Set(selected.map((r) => r.key))
    return rows.filter((r) => keys.has(r.key) && r.hasLevel)
  }, [selected, rows])
  const destinations = new Set(ticked.map((r) => r.warehouseId))
  const oneDestination = destinations.size === 1

  const unfiltered = same(filters, WAREHOUSE_DEFAULTS)

  function clearAll() {
    for (const key of Object.keys(WAREHOUSE_DEFAULTS) as (keyof WarehouseFilters)[]) {
      setFilter(key, WAREHOUSE_DEFAULTS[key] as never)
    }
  }

  async function removeLevel(row: LevelRow) {
    const go = await confirm({
      title: 'Remove stock level',
      message: removeLevelQuestion(row.itemCode, row.warehouseCode),
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!go) return
    try {
      await stockLevelsApi.remove(row.itemId, row.warehouseId, row.rowVersion, 'StockLevels')
      notify.success('Stock level removed.')
    } catch (err) {
      notify.error(err instanceof ApiError ? err.messages.join(' ') : 'The stock level could not be removed.')
    } finally {
      reload()
    }
  }

  const itemChip =
    filters.itemId === null
      ? null
      : (filters.itemCode ?? rows.find((r) => r.itemId === filters.itemId)?.itemCode ?? `#${filters.itemId}`)

  const familyData = useMemo(() => familyOptions(lookups.families), [lookups.families])
  const warehouseData = useMemo(() => warehouseOptions(lookups.warehouses), [lookups.warehouses])

  /** The row's "…" menu: a disabled entry says why under its label (a disabled menu item carries no tooltip). */
  const rowMenu = (row: LevelRow) => {
    const inactive = !row.warehouseIsActive
    return (
      <Menu position="bottom-end" shadow="md" withinPortal>
        <Menu.Target>
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label={`More actions for ${row.itemCode} at ${row.warehouseCode}`}
            data-level-row-menu={row.key}
          >
            <IconDots size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
          {canEdit ? (
            <Menu.Item
              leftSection={row.hasLevel ? <IconPencil size={16} /> : <IconPlus size={16} />}
              disabled={inactive}
              onClick={() => setDialog({ kind: 'level', row })}
            >
              {row.hasLevel ? 'Set level…' : 'Add level…'}
              {inactive ? (
                <Text fz="xs" c="dimmed" maw={260} style={{ whiteSpace: 'normal' }}>
                  {inactiveWarehouseText(row.warehouseCode)}
                </Text>
              ) : null}
            </Menu.Item>
          ) : null}
          {canEdit && row.hasLevel ? (
            <Menu.Item leftSection={<IconTrash size={16} />} color="red" onClick={() => void removeLevel(row)}>
              Remove level
            </Menu.Item>
          ) : null}
          <Menu.Item leftSection={<IconClock size={16} />} onClick={() => setDialog({ kind: 'history', row })}>
            History
          </Menu.Item>
          {canOpenItem ? (
            <Menu.Item leftSection={<IconEye size={16} />} onClick={() => void navigate(`/inventory/items/${row.itemId}`)}>
              Open item
            </Menu.Item>
          ) : null}
        </Menu.Dropdown>
      </Menu>
    )
  }

  const warehouseCell = (row: LevelRow) => (
    <Box>
      <Text fz="sm">{levelWarehouseText(row)}</Text>
      <Group gap={6} wrap="wrap">
        {row.branchName || row.branchCode ? (
          <Text fz="xs" c="dimmed">
            {row.branchName ?? row.branchCode}
          </Text>
        ) : null}
        {!row.warehouseIsActive ? (
          <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>
            inactive
          </Badge>
        ) : null}
      </Group>
    </Box>
  )

  const quantity = (value: number | null, dimZero = false) =>
    value === null ? (
      <Text span fz="sm" c="dimmed">
        —
      </Text>
    ) : (
      <Text span fz="sm" c={dimZero && value === 0 ? 'dimmed' : undefined}>
        {formatNumber(value)}
      </Text>
    )

  const columns: DataTableColumn<LevelRow>[] = [
    { accessor: 'itemCode', title: 'Item Code', width: 150 },
    {
      accessor: 'itemName',
      title: 'Item',
      width: 200,
      render: (row) => (
        <Box>
          <Text fz="sm" fw={500}>
            {row.itemName}
          </Text>
          {!row.itemIsActive ? (
            <Badge size="xs" variant="light" color="gray">
              inactive
            </Badge>
          ) : null}
        </Box>
      ),
    },
    { accessor: 'warehouseCode', title: 'Warehouse', width: 230, render: warehouseCell },
    { accessor: 'onHandBase', title: 'On hand', width: 100, textAlign: 'right', render: (r) => quantity(r.onHandBase) },
    {
      accessor: 'inOnTheWayBase',
      title: hinted('On the way in', LEVEL_COLUMN_HINTS.inOnTheWay),
      width: 120,
      textAlign: 'right',
      render: (r) => quantity(r.inOnTheWayBase, true),
    },
    {
      accessor: 'inToDispatchBase',
      title: hinted('To come in', LEVEL_COLUMN_HINTS.toComeIn),
      width: 110,
      textAlign: 'right',
      render: (r) => quantity(r.inToDispatchBase, true),
    },
    {
      accessor: 'outToDispatchBase',
      title: hinted('To go out', LEVEL_COLUMN_HINTS.toGoOut),
      width: 110,
      textAlign: 'right',
      render: (r) => quantity(r.outToDispatchBase, true),
    },
    {
      accessor: 'projectedBase',
      title: hinted('Projected', LEVEL_COLUMN_HINTS.projected),
      width: 110,
      textAlign: 'right',
      render: (r) => (
        <Text span fz="sm" fw={r.status === 'BelowMin' ? 700 : 500} c={r.status === 'BelowMin' ? 'red' : undefined}>
          {formatNumber(r.projectedBase)}
        </Text>
      ),
    },
    { accessor: 'minQuantityBase', title: 'Min', width: 90, textAlign: 'right', render: (r) => quantity(r.minQuantityBase) },
    { accessor: 'maxQuantityBase', title: 'Max', width: 90, textAlign: 'right', render: (r) => quantity(r.maxQuantityBase) },
    {
      accessor: 'toReachMaxBase',
      title: hinted('To reach Max', LEVEL_COLUMN_HINTS.toReachMax),
      width: 120,
      textAlign: 'right',
      render: (r) => quantity(r.toReachMaxBase, true),
    },
    { accessor: 'status', title: 'Status', width: 160, render: (r) => <StockLevelBadge status={r.status} /> },
    {
      accessor: 'updatedAtUtc',
      title: 'Updated',
      width: 190,
      render: (r) => (
        <Text fz="xs" c="dimmed">
          {updatedText(r)}
        </Text>
      ),
    },
    { accessor: 'actions', title: '', width: 56, textAlign: 'right', render: rowMenu },
  ]

  const totals = data?.totals ?? null
  const setStatus = (status: LevelStatusFilter) => setFilter('status', status)

  return (
    <>
      <FilterBar>
        <FilterBar.Col span={3}>
          <TextInput
            label="Search"
            placeholder="Item code, name or barcode"
            leftSection={<IconSearch size={16} />}
            value={filters.search}
            onChange={(event) => setFilter('search', event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') grid.commitFilters()
            }}
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="Branch"
            placeholder="All branches"
            data={lookups.branches.map((b) => ({ value: String(b.id), label: b.branchName }))}
            value={filters.branchId}
            onChange={(next) => setFilter('branchId', next)}
            clearable
            searchable
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select
            label="Warehouse"
            placeholder="All warehouses"
            description="A parent shows the warehouses under it."
            data={warehouseData}
            value={filters.warehouseId}
            onChange={(next) => setFilter('warehouseId', next)}
            clearable
            searchable
            nothingFoundMessage="No warehouse matches"
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="Family"
            placeholder="All families"
            data={familyData}
            value={filters.itemFamilyId}
            onChange={(next) => setFilter('itemFamilyId', next)}
            clearable
            searchable
            nothingFoundMessage="No family matches"
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="Brand"
            placeholder="All brands"
            data={lookups.brands.map((b) => ({ value: String(b.id), label: brandLabel(b) }))}
            value={filters.brandId}
            onChange={(next) => setFilter('brandId', next)}
            clearable
            searchable
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select
            label="Status"
            data={LEVEL_STATUS_DATA}
            value={filters.status}
            onChange={(next) => setFilter('status', (next ?? 'All') as LevelStatusFilter)}
            allowDeselect={false}
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Switch
            label="Active items only"
            checked={filters.activeItemsOnly}
            onChange={(event) => setFilter('activeItemsOnly', event.currentTarget.checked)}
            pb={8}
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Switch
            label="Inactive warehouses too"
            checked={filters.includeInactiveWarehouses}
            onChange={(event) => setFilter('includeInactiveWarehouses', event.currentTarget.checked)}
            pb={8}
          />
        </FilterBar.Col>
        {itemChip !== null ? (
          <FilterBar.Col span={3}>
            {/* One item's levels (the company view's "3 warehouses", a link): the X shows every item again. */}
            <Group
              gap={4}
              wrap="nowrap"
              pl="sm"
              pr={4}
              py={4}
              mb={4}
              bg="var(--mantine-color-brand-0)"
              style={{ borderRadius: 999, width: 'fit-content', maxWidth: '100%' }}
              data-levels-item-chip
            >
              <Text fz="sm" fw={600} c="brand.7" style={{ overflowWrap: 'anywhere' }}>
                Item: {itemChip}
              </Text>
              <CloseButton
                size="sm"
                aria-label="Show every item"
                onClick={() => {
                  setFilter('itemId', null)
                  setFilter('itemCode', null)
                }}
              />
            </Group>
          </FilterBar.Col>
        ) : null}
        <FilterBar.Col span={2}>
          <Button variant="default" leftSection={<IconFilterOff size={16} />} onClick={clearAll} disabled={unfiltered}>
            Clear Filters
          </Button>
        </FilterBar.Col>
      </FilterBar>

      {error ? (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      ) : null}

      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md" mb="md">
        <Tile label="Levels" value={totals?.levels ?? null} active={filters.status === 'All'} onClick={() => setStatus('All')} />
        <Tile
          label="Below Min"
          value={totals?.belowMin ?? null}
          colour="red"
          active={filters.status === 'BelowMin'}
          onClick={() => setStatus('BelowMin')}
        />
        <Tile
          label="Below Min, covered by transfers"
          value={totals?.covered ?? null}
          colour="orange"
          active={filters.status === 'Covered'}
          onClick={() => setStatus('Covered')}
        />
        <Tile
          label="Above Max"
          value={totals?.aboveMax ?? null}
          colour="blue"
          active={filters.status === 'AboveMax'}
          onClick={() => setStatus('AboveMax')}
        />
      </SimpleGrid>

      {canTick && ticked.length > 0 ? (
        <Paper radius="lg" p="xs" withBorder mb="xs" bg="var(--mantine-color-blue-0)" data-levels-selection>
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Text fz="sm" fw={600} px="xs">
              {formatNumber(ticked.length)} ticked
            </Text>
            <Group gap="xs">
              {oneDestination ? (
                <Button
                  size="xs"
                  leftSection={<IconArrowsExchange size={14} />}
                  onClick={() => setDialog({ kind: 'transfer', rows: ticked })}
                  data-levels-create-transfer
                >
                  Create transfer order…
                </Button>
              ) : (
                <Stack gap={2} align="flex-end">
                  <Tooltip
                    label="Tick rows of one warehouse: a transfer order goes to one warehouse."
                    withArrow
                    multiline
                    w={280}
                    disabled={phone}
                  >
                    <Button size="xs" leftSection={<IconArrowsExchange size={14} />} data-disabled data-levels-create-transfer>
                      Create transfer order…
                    </Button>
                  </Tooltip>
                  {phone ? (
                    <Text fz="xs" c="dimmed" ta="right">
                      Tick rows of one warehouse: a transfer order goes to one warehouse.
                    </Text>
                  ) : null}
                </Stack>
              )}
              <Button size="xs" variant="subtle" leftSection={<IconX size={14} />} onClick={() => setSelected([])}>
                Clear
              </Button>
            </Group>
          </Group>
        </Paper>
      ) : null}

      {phone ? (
        /* A phone: one card per row - the item and the warehouse, the figures on one line, the badge, the menu. */
        <Stack gap="sm">
          {!loading && engine.total === 0 ? (
            <Text c="dimmed" ta="center" py="md">
              {unfiltered
                ? 'No stock level yet. Set them on Item Definition, or import them with Import from Excel….'
                : 'No stock level matches these filters.'}
            </Text>
          ) : null}
          {engine.pageRows.map((row) => {
            const isTicked = selected.some((r) => r.key === row.key)
            return (
              <Paper key={row.key} withBorder radius="md" p="sm" data-level-card={row.key}>
                <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
                  <Group gap="xs" wrap="nowrap" align="flex-start" style={{ minWidth: 0 }}>
                    {canTick ? (
                      <Checkbox
                        mt={2}
                        aria-label={`Tick ${row.itemCode} at ${row.warehouseCode}`}
                        checked={isTicked}
                        disabled={!row.hasLevel}
                        onChange={(event) => {
                          const on = event.currentTarget.checked
                          setSelected((current) =>
                            on ? [...current.filter((r) => r.key !== row.key), row] : current.filter((r) => r.key !== row.key),
                          )
                        }}
                      />
                    ) : null}
                    <Box style={{ minWidth: 0 }}>
                      <Text fz="sm" fw={600} style={{ overflowWrap: 'anywhere' }}>
                        {row.itemCode} · {row.warehouseCode}
                      </Text>
                      <Text fz="sm" c={row.status === 'BelowMin' ? 'red' : undefined}>
                        {levelPhoneLine(row, false)}
                      </Text>
                      <Text fz="xs" c="dimmed">
                        {row.itemName}
                      </Text>
                      {/* The badge on a line of its own: beside the figures a phone squeezed it to "Be…". */}
                      <Box mt={4}>
                        <StockLevelBadge status={row.status} />
                      </Box>
                    </Box>
                  </Group>
                  {rowMenu(row)}
                </Group>
              </Paper>
            )
          })}
          {engine.total > engine.pageSize ? (
            <Group justify="center">
              <Pagination
                total={Math.ceil(engine.total / engine.pageSize)}
                value={engine.page}
                onChange={engine.setPage}
                size="sm"
              />
            </Group>
          ) : null}
        </Stack>
      ) : (
        <Paper radius="lg" withBorder>
          <DataTable<LevelRow>
            storeKey="inventory.stockLevels"
            engine={engine}
            exportFileName="stock-levels"
            columns={columns}
            idAccessor="key"
            fetching={loading}
            pinLastColumn
            noRecordsText={
              unfiltered
                ? 'No stock level yet. Set them on Item Definition, or import them with Import from Excel….'
                : 'No stock level matches these filters.'
            }
            {...(canTick
              ? {
                  selectedRecords: selected,
                  onSelectedRecordsChange: setSelected,
                  // A pair without a level has nothing to fill: it cannot be ticked.
                  isRecordSelectable: (row: LevelRow) => row.hasLevel,
                }
              : {})}
          />
        </Paper>
      )}

      {dialog?.kind === 'level' ? (
        <StockLevelFormModal
          opened
          item={{ id: dialog.row.itemId, itemCode: dialog.row.itemCode }}
          warehouse={{ id: dialog.row.warehouseId, code: dialog.row.warehouseCode, name: dialog.row.warehouseName }}
          existing={[dialog.row]}
          source="StockLevels"
          onClose={() => setDialog(null)}
          onSaved={reload}
          onStale={reload}
        />
      ) : null}
      {dialog?.kind === 'history' ? (
        <StockLevelHistoryModal
          opened
          itemId={dialog.row.itemId}
          itemCode={dialog.row.itemCode}
          warehouseId={dialog.row.warehouseId}
          warehouseCode={dialog.row.warehouseCode}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'transfer' && dialog.rows.length > 0 ? (
        <CreateTransferFromLevelsModal
          opened
          to={{
            id: dialog.rows[0]!.warehouseId,
            code: dialog.rows[0]!.warehouseCode,
            name: dialog.rows[0]!.warehouseName,
          }}
          rows={dialog.rows}
          onClose={() => setDialog(null)}
          onCreated={(result) => {
            setDialog(null)
            setSelected([])
            void navigate(routes.transferOrder(result.orderId))
          }}
        />
      ) : null}
    </>
  )
}

/* ══ Company (Item Definition) ══════════════════════════════════════════════════════════════════ */

const NO_COMPANY_ROWS: CompanyStockLevelRowDto[] = []

const COMPANY_COLUMNS: GridColumnMeta<CompanyStockLevelRowDto>[] = [
  { accessor: 'itemCode', summary: 'count' },
  { accessor: 'itemName' },
  { accessor: 'itemFamilyName', kind: 'list', text: (r) => r.itemFamilyName ?? '' },
  { accessor: 'brandName', kind: 'list', text: (r) => r.brandName ?? '' },
  { accessor: 'onHandBase', kind: 'number', summary: 'sum', text: (r) => formatNumber(r.onHandBase) },
  { accessor: 'minQuantity', kind: 'number', text: (r) => formatNumber(r.minQuantity) },
  { accessor: 'maxQuantity', kind: 'number', text: (r) => num(r.maxQuantity) },
  { accessor: 'missingBase', kind: 'number', summary: 'sum', text: (r) => formatNumber(r.missingBase) },
  { accessor: 'status', kind: 'list', text: (r) => COMPANY_STOCK_LEVEL_STATUS[r.status]?.label ?? r.status },
  { accessor: 'warehouseLevelCount', kind: 'number', text: (r) => warehousesText(r.warehouseLevelCount) },
]

/** "3 warehouses", "1 warehouse", "None". */
function warehousesText(count: number): string {
  if (count === 0) return 'None'
  return `${formatNumber(count)} warehouse${count === 1 ? '' : 's'}`
}

interface CompanyViewProps {
  initial: CompanyFilters
  onFilters(filters: CompanyFilters): void
  lookups: Lookups
  /** Bumped after Add levels… or an import: the "Warehouse levels" counts are read again. */
  reloadKey: number
  onOpenWarehouses(row: CompanyStockLevelRowDto): void
  phone: boolean
}

function CompanyView({ initial, onFilters, lookups, reloadKey, onOpenWarehouses, phone }: CompanyViewProps) {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const canOpenItem = hasPermission(PERMISSIONS.itemsView)

  const grid = useGridQuery<CompanyFilters, CompanyStockLevelRowDto, CompanyStockLevelListResult>({
    initialFilters: initial,
    debounced: ['search'],
    initialSort: { columnAccessor: 'itemCode', direction: 'asc' },
    paging: 'client',
    errorMessage: 'The company stock levels could not be loaded.',
    fetcher: useCallback(({ filters, signal }) => stockLevelsApi.company(companyQuery(filters), signal), []),
  })
  const { filters, setFilter, data, loading, error, reload } = grid
  const rows = data?.rows ?? NO_COMPANY_ROWS

  useEffect(() => onFilters(filters), [filters, onFilters])

  const mountedReloadKey = useRef(reloadKey)
  useEffect(() => {
    if (reloadKey !== mountedReloadKey.current) reload()
  }, [reloadKey, reload])

  // The server's order: Below Min first by what is missing, then the item code.
  const engine = useDataGrid({ rows, columns: COMPANY_COLUMNS, storeKey: 'inventory.stockLevels.company', pageSize: 50 })

  const unfiltered = same(filters, COMPANY_DEFAULTS)
  function clearAll() {
    for (const key of Object.keys(COMPANY_DEFAULTS) as (keyof CompanyFilters)[]) {
      setFilter(key, COMPANY_DEFAULTS[key] as never)
    }
  }

  const familyData = useMemo(() => familyOptions(lookups.families), [lookups.families])
  const scope = data ? (data.scope.branchId === null ? 'the company' : (data.scope.branchName ?? 'the branch')) : null

  const levelsCell = (row: CompanyStockLevelRowDto) =>
    row.warehouseLevelCount > 0 ? (
      <Anchor component="button" type="button" fz="sm" onClick={() => onOpenWarehouses(row)} data-company-levels={row.itemCode}>
        {warehousesText(row.warehouseLevelCount)}
      </Anchor>
    ) : (
      <Text span fz="sm" c="dimmed">
        None
      </Text>
    )

  const rowMenu = (row: CompanyStockLevelRowDto) =>
    canOpenItem ? (
      <Menu position="bottom-end" shadow="md" withinPortal>
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" aria-label={`More actions for ${row.itemCode}`}>
            <IconDots size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<IconEye size={16} />} onClick={() => void navigate(`/inventory/items/${row.itemId}`)}>
            Open item
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    ) : null

  const companyBadge = (row: CompanyStockLevelRowDto) => <StockLevelBadge status={row.status} />

  const columns: DataTableColumn<CompanyStockLevelRowDto>[] = [
    { accessor: 'itemCode', title: 'Item Code', width: 150 },
    {
      accessor: 'itemName',
      title: 'Item',
      render: (row) => (
        <Text fz="sm" fw={500}>
          {row.itemName}
        </Text>
      ),
    },
    { accessor: 'itemFamilyName', title: 'Family', width: 160, render: (r) => r.itemFamilyName ?? '—' },
    { accessor: 'brandName', title: 'Brand', width: 120, render: (r) => r.brandName ?? '—' },
    { accessor: 'onHandBase', title: 'On hand', width: 100, textAlign: 'right', render: (r) => formatNumber(r.onHandBase) },
    {
      accessor: 'minQuantity',
      title: 'Minimum Quantity',
      width: 140,
      textAlign: 'right',
      render: (r) => formatNumber(r.minQuantity),
    },
    {
      accessor: 'maxQuantity',
      title: 'Maximum Quantity',
      width: 140,
      textAlign: 'right',
      render: (r) => (r.maxQuantity === null ? '—' : formatNumber(r.maxQuantity)),
    },
    {
      accessor: 'missingBase',
      title: 'Missing',
      width: 100,
      textAlign: 'right',
      render: (r) => (
        <Text span fz="sm" fw={r.missingBase > 0 ? 700 : undefined} c={r.missingBase > 0 ? 'red' : 'dimmed'}>
          {formatNumber(r.missingBase)}
        </Text>
      ),
    },
    { accessor: 'status', title: 'Status', width: 120, render: companyBadge },
    { accessor: 'warehouseLevelCount', title: 'Warehouse levels', width: 150, render: levelsCell },
    { accessor: 'actions', title: '', width: 56, textAlign: 'right', render: rowMenu },
  ]

  return (
    <>
      <FilterBar>
        <FilterBar.Col span={3}>
          <TextInput
            label="Search"
            placeholder="Item code, name or barcode"
            leftSection={<IconSearch size={16} />}
            value={filters.search}
            onChange={(event) => setFilter('search', event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') grid.commitFilters()
            }}
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="Branch"
            placeholder="All branches"
            data={lookups.branches.map((b) => ({ value: String(b.id), label: b.branchName }))}
            value={filters.branchId}
            onChange={(next) => setFilter('branchId', next)}
            clearable
            searchable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="Family"
            placeholder="All families"
            data={familyData}
            value={filters.itemFamilyId}
            onChange={(next) => setFilter('itemFamilyId', next)}
            clearable
            searchable
            nothingFoundMessage="No family matches"
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="Brand"
            placeholder="All brands"
            data={lookups.brands.map((b) => ({ value: String(b.id), label: brandLabel(b) }))}
            value={filters.brandId}
            onChange={(next) => setFilter('brandId', next)}
            clearable
            searchable
          />
        </FilterBar.Col>
        <FilterBar.Col span={4}>
          <Select
            label="Status"
            data={COMPANY_STATUS_DATA}
            value={filters.status}
            onChange={(next) => setFilter('status', (next ?? 'All') as CompanyFilters['status'])}
            allowDeselect={false}
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Switch
            label="Active items only"
            checked={filters.activeItemsOnly}
            onChange={(event) => setFilter('activeItemsOnly', event.currentTarget.checked)}
            pb={8}
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Button variant="default" leftSection={<IconFilterOff size={16} />} onClick={clearAll} disabled={unfiltered}>
            Clear Filters
          </Button>
        </FilterBar.Col>
      </FilterBar>

      <Text fz="sm" c="dimmed" mb="sm" data-company-levels-hint>
        The company&apos;s Minimum / Maximum Quantity of Item Definition, against the stock of {scope ?? '…'} - every
        warehouse, goods on the way to it included: the Dashboard&apos;s figure. For one warehouse&apos;s own levels, use Per
        warehouse.
      </Text>

      {error ? (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      ) : null}

      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md" mb="md">
        <Tile
          label="Items with a company Min or Max"
          value={data?.totals.items ?? null}
          active={filters.status === 'All'}
          onClick={() => setFilter('status', 'All')}
        />
        <Tile
          label="Below their minimum"
          value={data?.totals.belowMin ?? null}
          colour="red"
          active={filters.status === 'BelowMin'}
          onClick={() => setFilter('status', 'BelowMin')}
        />
      </SimpleGrid>

      {phone ? (
        <Stack gap="sm">
          {!loading && engine.total === 0 ? (
            <Text c="dimmed" ta="center" py="md">
              {unfiltered ? 'No item has a company Minimum or Maximum Quantity.' : 'No item matches these filters.'}
            </Text>
          ) : null}
          {engine.pageRows.map((row) => (
            <Paper key={row.itemId} withBorder radius="md" p="sm" data-company-level-card={row.itemCode}>
              <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
                <Box style={{ minWidth: 0 }}>
                  <Text fz="sm" fw={600} style={{ overflowWrap: 'anywhere' }}>
                    {row.itemCode}
                  </Text>
                  <Text fz="sm" c={row.status === 'BelowMin' ? 'red' : undefined}>
                    On hand {formatNumber(row.onHandBase)} · {levelText(row.minQuantity, row.maxQuantity)}
                    {row.missingBase > 0 ? ` · Missing ${formatNumber(row.missingBase)}` : ''}
                  </Text>
                  <Text fz="xs" c="dimmed">
                    {row.itemName}
                  </Text>
                  <Group gap="sm" mt={4} wrap="wrap">
                    {companyBadge(row)}
                    {levelsCell(row)}
                  </Group>
                </Box>
                {rowMenu(row)}
              </Group>
            </Paper>
          ))}
          {engine.total > engine.pageSize ? (
            <Group justify="center">
              <Pagination
                total={Math.ceil(engine.total / engine.pageSize)}
                value={engine.page}
                onChange={engine.setPage}
                size="sm"
              />
            </Group>
          ) : null}
        </Stack>
      ) : (
        <Paper radius="lg" withBorder>
          <DataTable<CompanyStockLevelRowDto>
            storeKey="inventory.stockLevels.company"
            engine={engine}
            exportFileName="company-stock-levels"
            columns={columns}
            idAccessor="itemId"
            fetching={loading}
            pinLastColumn
            noRecordsText={
              unfiltered ? 'No item has a company Minimum or Maximum Quantity.' : 'No item matches these filters.'
            }
          />
        </Paper>
      )}
    </>
  )
}
