import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Alert, Box, Button, Group, Paper, Select, Text, TextInput } from '@mantine/core'
import {
  IconBuildingWarehouse,
  IconChevronDown,
  IconChevronRight,
  IconFilterOff,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTableExport,
} from '@tabler/icons-react'
import { fetchAllPages, type AllRows } from '../../api/fetchAllPages'
import { ApiError } from '../../api/http'
import { branchesApi } from '../../api/masterdata/branches'
import { warehousesApi } from '../../api/masterdata/warehouses'
import type { BranchLookupDto, WarehouseDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { branchLabel } from '../../components/format'
import { downloadCsv } from '../../components/masterdata/csv'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { columnFilter } from '../../components/ui/columnFilter'
import { triStateFilter, triStateQuery, useGridFilters, type ColumnText } from '../../components/ui/gridFilters'
import { FilterBar } from '../../components/ui/FilterBar'
import { MoreActionsMenu } from '../../components/ui/MoreActionsMenu'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { MainFlag, StatusBadge } from '../../components/ui/StatusBadge'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'
import { WarehouseFormModal } from './WarehouseFormModal'

/* ── the branch tree ──────────────────────────────────────────────────────────────────────────────
   A warehouse has no parent warehouse - the only hierarchy in the table is the branch it belongs
   to - so the tree is exactly two deep: a branch, and the warehouses standing in it. That is the
   same shape the Item Families page draws, with the depth fixed at two instead of arbitrary.
   ─────────────────────────────────────────────────────────────────────────────────────────────── */

const EXPANDED_KEY = 'inventory_shipment.warehouses.expanded'

/** Pixels of indent for a warehouse under its branch - the only thing that makes the nesting read. */
const INDENT = 26

/**
 * A row of the grid: either a branch heading or a warehouse standing in one.
 *
 * The branch rows are carried in the same list as the warehouses so the grid stays one flat table -
 * mantine-datatable draws rows, not trees - and are told apart by `isBranch`. Their `id` is the
 * branch id NEGATED, which cannot collide with a warehouse id and keeps row selection and the
 * keyboard honest without a second id space.
 */
type TreeRow = WarehouseDto & {
  isBranch: boolean
  branchRowId: number
  /** How many warehouses stand in this branch, for the heading's count. */
  childCount: number
}

function branchRowFor(warehouse: WarehouseDto, childCount: number): TreeRow {
  return {
    ...warehouse,
    id: -warehouse.branchId,
    isBranch: true,
    branchRowId: warehouse.branchId,
    childCount,
  }
}

/**
 * The rows the grid draws, top to bottom: each branch that still has warehouses, followed by its
 * warehouses when it is open.
 *
 * SORTING HAPPENS INSIDE A BRANCH, never across the whole list. A sort that reordered every
 * warehouse by name would scatter them out of the branches they belong to, which is the one thing
 * the tree exists to show. The branches themselves keep their own order, by code.
 */
function buildTree(
  warehouses: WarehouseDto[],
  isOpen: (branchId: number) => boolean,
  compare: (a: WarehouseDto, b: WarehouseDto) => number,
): TreeRow[] {
  const byBranch = new Map<number, WarehouseDto[]>()
  for (const warehouse of warehouses) {
    const existing = byBranch.get(warehouse.branchId)
    if (existing) existing.push(warehouse)
    else byBranch.set(warehouse.branchId, [warehouse])
  }

  const branches = [...byBranch.entries()].sort(([, a], [, b]) =>
    a[0].branchCode.localeCompare(b[0].branchCode, undefined, { numeric: true }),
  )

  const rows: TreeRow[] = []
  for (const [branchId, group] of branches) {
    rows.push(branchRowFor(group[0], group.length))
    if (!isOpen(branchId)) continue
    for (const warehouse of [...group].sort(compare)) {
      rows.push({ ...warehouse, isBranch: false, branchRowId: branchId, childCount: 0 })
    }
  }
  return rows
}

function readExpanded(): Set<number> | null {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return new Set(parsed.filter((id): id is number => typeof id === 'number'))
  } catch {
    // A browser that refuses storage still gets a working tree, just a forgetful one.
    return null
  }
}

function writeExpanded(ids: Set<number>): void {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...ids]))
  } catch {
    // Same again: the tree works, it just will not remember what was open.
  }
}

/** The filters the reader edits. Paging and sorting are the grid's own, held by useGridQuery. */
interface Filters {
  search: string
  branchId: string | null
  isActive: string | null
  isMainWarehouse: string | null
}

const NO_FILTERS: Filters = { search: '', branchId: null, isActive: null, isMainWarehouse: null }

type Dialog = { kind: 'create' } | { kind: 'edit'; warehouse: WarehouseDto } | null

export function WarehousesPage() {
  const { hasPermission } = useAuth()

  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [dialog, setDialog] = useState<Dialog>(null)

  const canCreate = hasPermission(PERMISSIONS.warehousesCreate)
  const canEdit = hasPermission(PERMISSIONS.warehousesEdit)
  const canDelete = hasPermission(PERMISSIONS.warehousesDelete)

  /**
   * The grid's whole query. No Apply button: the search box settles 350ms after the last keystroke,
   * every other control lands at once, and the hook guarantees one request per settled state with
   * the newest one winning.
   *
   * The filter bar and the column funnels are two ways into the SAME filter, and both go through
   * `setFilter`, so a header reading "Active" over a bar reading "All" is not a state that exists.
   */
  const grid = useGridQuery<Filters, WarehouseDto, AllRows<WarehouseDto>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'warehouseCode', direction: 'asc' },
    // The whole table comes back in one go, so turning a page or re-sorting must not ask again.
    paging: 'client',
    errorMessage: 'The warehouses could not be loaded.',
    fetcher: useCallback(
      ({ filters, signal }) =>
        fetchAllPages((page, pageSize) =>
          warehousesApi.search(
            {
              search: filters.search.trim() || undefined,
              branchId: filters.branchId === null ? undefined : Number(filters.branchId),
              isActive: filters.isActive === null ? undefined : filters.isActive === 'true',
              isMainWarehouse:
                filters.isMainWarehouse === null ? undefined : filters.isMainWarehouse === 'true',
              page,
              pageSize,
            },
            signal,
          ),
        ),
      [],
    ),
  })

  const { filters, setFilter, data, loading, error } = grid
  const rows = useMemo(() => data?.items ?? [], [data])

  // A filter that leaves three rows must not strand the reader on page 4 of the old result.
  const columnFilters = useGridFilters(COLUMN_TEXT, () => grid.setPage(1))
  const { apply: applyColumnFilters, options: columnOptions } = columnFilters

  /** What the funnels left - the rows this page then sorts, pages, counts and exports. */
  const narrowed = useMemo(() => applyColumnFilters(rows), [rows, applyColumnFilters])

  const sortKey = grid.sortStatus.columnAccessor as keyof WarehouseDto
  const sortDirection = grid.sortStatus.direction

  /** Nothing stored yet: open every branch on the first visit, so the tree does not read as empty. */
  const [storedExpanded] = useState(readExpanded)
  const [expanded, setExpanded] = useState<Set<number>>(() => storedExpanded ?? new Set())
  const seeded = useRef(storedExpanded !== null)

  useEffect(() => {
    if (seeded.current) writeExpanded(expanded)
  }, [expanded])

  // Branches only appear once their warehouses have loaded, so the first seeding waits for them.
  useEffect(() => {
    if (seeded.current || rows.length === 0) return
    seeded.current = true
    setExpanded(new Set(rows.map((w) => w.branchId)))
  }, [rows])

  const records = useMemo(
    () =>
      buildTree(
        narrowed,
        (branchId) => expanded.has(branchId),
        (a, b) => (sortDirection === 'desc' ? -1 : 1) * compareRows(a, b, sortKey),
      ),
    [narrowed, expanded, sortKey, sortDirection],
  )

  function toggleBranch(branchId: number) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(branchId)) next.delete(branchId)
      else next.add(branchId)
      return next
    })
  }

  /** The tick lists come from EVERY warehouse, not from the rows surviving the filters. */
  const values = useMemo(
    () => ({
      warehouseCode: columnOptions(rows, 'warehouseCode'),
      warehouseName: columnOptions(rows, 'warehouseName'),
      address: columnOptions(rows, 'address'),
    }),
    [rows, columnOptions],
  )
  const load = grid.reload

  // Every branch, including inactive ones, so rows on a deactivated branch can still be filtered.
  useEffect(() => {
    branchesApi
      .lookup(false)
      .then(setBranches)
      .catch(() => {
        // Not fatal: the filter simply offers no branches until the next reload.
      })
  }, [])


  function exportCsv() {
    downloadCsv(
      'warehouses.csv',
      ['Warehouse Code', 'Warehouse Name', 'Branch / Site', 'Address', 'Is Main Warehouse', 'Status'],
      // The warehouses the funnels left, in the order the tree shows them. The branch headings are
      // structure rather than records, so they are left out; each row names its branch anyway.
      records
        .filter((row) => !row.isBranch)
        .map((w) => [
          w.warehouseCode,
          w.warehouseName,
          `${w.branchCode} - ${w.branchName}`,
          w.address ?? '',
          w.isMainWarehouse ? 'Yes' : 'No',
          w.isActive ? 'Active' : 'Inactive',
        ]),
    )
  }

  async function afterSave(message: string) {
    setDialog(null)
    notify.success(message)
    await load()
  }

  async function setStatus(warehouse: WarehouseDto, isActive: boolean) {
    try {
      await warehousesApi.setStatus(warehouse.id, isActive)
      await afterSave(isActive ? 'Warehouse activated.' : 'Warehouse deactivated.')
    } catch (err) {
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The warehouse could not be updated.')
    }
  }

  async function handleDelete(warehouse: WarehouseDto) {
    const confirmed = await confirm({
      title: 'Delete warehouse',
      message: `Delete warehouse ${warehouse.warehouseCode} - ${warehouse.warehouseName}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!confirmed) return

    try {
      await warehousesApi.remove(warehouse.id)
      await afterSave('Warehouse deleted successfully.')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REFERENCED') {
        const deactivate = await confirm({
          title: 'Warehouse cannot be deleted',
          message: err.messages[0] as string,
          confirmLabel: 'Deactivate instead',
        })
        if (deactivate) await setStatus(warehouse, false)
        return
      }
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The warehouse could not be deleted.')
    }
  }

  async function handleToggleStatus(warehouse: WarehouseDto) {
    const activating = !warehouse.isActive
    const confirmed = await confirm({
      title: activating ? 'Activate warehouse' : 'Deactivate warehouse',
      message: activating
        ? `Activate ${warehouse.warehouseCode} - ${warehouse.warehouseName}?`
        : `Deactivate ${warehouse.warehouseCode} - ${warehouse.warehouseName}? It will no longer be selectable.`,
      confirmLabel: activating ? 'Activate' : 'Deactivate',
    })
    if (confirmed) await setStatus(warehouse, activating)
  }

  /* The Branch funnel picks ONE branch, because the endpoint filters by a single branchId - see
     the `single` note on ColumnFilter. Its options carry the branch code as well as the name, which
     the cell has no room for, so two branches sharing a name stay tellable apart. */
  const branchOptions = branches.map(branchLabel)
  const filteredBranch = branches.find((b) => String(b.id) === filters.branchId)

  const columns: DataTableColumn<TreeRow>[] = [
    /* These three now carry their own funnel. The page holds the whole table, so each is matched
       here against the text its own cell shows - which the filter bar's search box could never do,
       being one parameter over code OR name. */
    {
      accessor: 'warehouseCode',
      title: 'Warehouse Code',
      sortable: true,
      // Wide enough that an indented code still clears its chevron before the column ends.
      width: 300,
      ...columnFilter({
        ...columnFilters.bind('warehouseCode'),
        label: 'Warehouse Code',
        options: values.warehouseCode,
      }),
      render: (row) =>
        row.isBranch ? (
          <Group gap={6} wrap="nowrap">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-label={`${expanded.has(row.branchRowId) ? 'Collapse' : 'Expand'} ${row.branchName}`}
              onClick={() => toggleBranch(row.branchRowId)}
            >
              {expanded.has(row.branchRowId) ? <IconChevronDown size={15} /> : <IconChevronRight size={15} />}
            </ActionIcon>
            <Text fz="sm" fw={600}>
              {row.branchCode} - {row.branchName}
            </Text>
            <Text fz="xs" c="dimmed">
              ({row.childCount})
            </Text>
          </Group>
        ) : (
          <Group gap={6} wrap="nowrap" style={{ paddingLeft: INDENT }}>
            {/* Keeps every code on the same left edge, under the branch's chevron. */}
            <Box w={18} />
            <IconBuildingWarehouse size={16} color="var(--mantine-color-gray-5)" />
            <Text fz="sm">{row.warehouseCode}</Text>
          </Group>
        ),
    },
    {
      accessor: 'warehouseName',
      title: 'Warehouse Name',
      sortable: true,
      ...columnFilter({
        ...columnFilters.bind('warehouseName'),
        label: 'Warehouse Name',
        options: values.warehouseName,
      }),
      // A branch heading names itself in the first column; repeating it here would read as a row.
      render: (row) => (row.isBranch ? '' : row.warehouseName),
    },
    {
      accessor: 'branchName',
      title: 'Branch / Site',
      sortable: true,
      ...columnFilter({
        label: 'Branch / Site',
        value: filteredBranch ? { values: [branchLabel(filteredBranch)] } : undefined,
        onApply: (next) => {
          const picked = next?.values?.[0]
          const branch = picked ? branches.find((b) => branchLabel(b) === picked) : undefined
          setFilter('branchId', branch ? String(branch.id) : null)
        },
        options: branchOptions,
        withText: false,
        single: true,
      }),
      render: (row) =>
        row.isBranch ? '' : <Text fz="sm" title={row.branchCode}>{row.branchName}</Text>,
    },
    {
      accessor: 'address',
      title: 'Address',
      sortable: true,
      ...columnFilter({ ...columnFilters.bind('address'), label: 'Address', options: values.address }),
      render: (row) => (row.isBranch ? '' : (row.address ?? '-')),
    },
    {
      accessor: 'isMainWarehouse',
      title: 'Is Main Warehouse',
      sortable: true,
      width: 205,
      ...columnFilter({
        label: 'Is Main Warehouse',
        value: triStateFilter(filters.isMainWarehouse, 'Yes', 'No'),
        onApply: (next) => setFilter('isMainWarehouse', triStateQuery(next, 'Yes')),
        options: YES_NO_VALUES,
        withText: false,
      }),
      render: (row) => (row.isBranch ? '' : <MainFlag isMain={row.isMainWarehouse} />),
    },
    {
      accessor: 'isActive',
      title: 'Status',
      sortable: true,
      width: 150,
      ...columnFilter({
        label: 'Status',
        value: triStateFilter(filters.isActive, 'Active', 'Inactive'),
        onApply: (next) => setFilter('isActive', triStateQuery(next, 'Active')),
        options: STATUS_VALUES,
        withText: false,
      }),
      render: (row) => (row.isBranch ? '' : <StatusBadge active={row.isActive} />),
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 130,
      textAlign: 'right',
      // A branch heading is not a record: there is nothing here to edit, deactivate or delete.
      render: (warehouse) =>
        warehouse.isBranch ? null : (
        <RowActions
          label={warehouse.warehouseCode}
          edit={{ visible: canEdit, onClick: () => setDialog({ kind: 'edit', warehouse }) }}
          toggleStatus={{
            visible: canEdit,
            active: warehouse.isActive,
            disabled: warehouse.isMainWarehouse && warehouse.isActive,
            disabledReason: 'The main warehouse cannot be deactivated',
            onClick: () => void handleToggleStatus(warehouse),
          }}
          remove={{
            visible: canDelete,
            disabled: warehouse.isMainWarehouse,
            disabledReason: 'The main warehouse cannot be deleted',
            onClick: () => void handleDelete(warehouse),
          }}
        />
        ),
    },
  ]

  // "Filtered" for the empty-state wording: it should say "try clearing the filters" only when
  // there are filters to clear.
  const filtered = !grid.isDefault

  return (
    <>
      <PageHeader
        title="Warehouses"
        subtitle="View and manage warehouses."
        actions={
          <>
            <MoreActionsMenu
              actions={[
                { label: 'Refresh', icon: <IconRefresh size={16} />, onClick: () => void load() },
                { label: 'Export CSV', icon: <IconTableExport size={16} />, onClick: exportCsv },
              ]}
            />
            {canCreate ? (
              <Button leftSection={<IconPlus size={16} />} onClick={() => setDialog({ kind: 'create' })}>
                New Warehouse
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar>
        <FilterBar.Col span={3}>
          <TextInput
            placeholder="Search by warehouse code or name..."
            leftSection={<IconSearch size={16} />}
            label="Search"
            value={filters.search}
            onChange={(e) => setFilter('search', e.currentTarget.value)}
            // Enter sends what is typed now instead of waiting out the debounce.
            onKeyDown={(e) => {
              if (e.key === 'Enter') grid.commitFilters()
            }}
          />
        </FilterBar.Col>

        <FilterBar.Col span={3}>
          <Select
            label="Branch / Site"
            placeholder="All"
            searchable
            clearable
            nothingFoundMessage="No branch found"
            data={branches.map((b) => ({ value: String(b.id), label: branchLabel(b) }))}
            value={filters.branchId}
            onChange={(value) => setFilter('branchId', value)}
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <Select
            label="Status"
            placeholder="All"
            data={STATUS_OPTIONS}
            value={filters.isActive}
            onChange={(value) => setFilter('isActive', value)}
            clearable
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <Select
            label="Is Main Warehouse"
            placeholder="All"
            data={YES_NO_OPTIONS}
            value={filters.isMainWarehouse}
            onChange={(value) => setFilter('isMainWarehouse', value)}
            clearable
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <Button
            variant="default"
            leftSection={<IconFilterOff size={16} />}
            onClick={grid.clearFilters}
            disabled={grid.isDefault}
          >
            Clear Filters
          </Button>
        </FilterBar.Col>
      </FilterBar>

      {error ? (
        <Alert color="red" mb="md" title="Could not load warehouses">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        {/* No paging: a page break would cut a branch from the warehouses standing in it, and page 2
            would be a list of warehouses with no branch above them. The table is small and already
            loads in full, so every row is here. */}
        <DataTable<TreeRow>
          storeKey="masterdata.warehouses"
          records={records}
          // The footer totals the WAREHOUSES the filters left - the branch headings are structure,
          // not records, and counting them would inflate every figure.
          summaryRecords={narrowed as TreeRow[]}
          columns={columns}
          filters={{ activeCount: columnFilters.activeCount, clearAll: columnFilters.clearAll }}
          sortStatus={grid.sortStatus}
          onSortStatusChange={grid.setSortStatus}
          fetching={loading}
          // Enter on the selected row does what its pencil does - and a branch heading opens instead.
          onRowActivate={({ record }) => {
            if (record.isBranch) toggleBranch(record.branchRowId)
            else if (canEdit) setDialog({ kind: 'edit', warehouse: record })
          }}
          noRecordsText={
            filtered ? 'No warehouses found. Try clearing the filters to see every warehouse.' : 'No warehouses found.'
          }
        />
      </Paper>

      {dialog ? (
        <WarehouseFormModal
          mode={dialog.kind}
          warehouse={dialog.kind === 'edit' ? dialog.warehouse : undefined}
          onClose={() => setDialog(null)}
          onSaved={() =>
            void afterSave(
              dialog.kind === 'create' ? 'Warehouse created successfully.' : 'Warehouse updated successfully.',
            )
          }
        />
      ) : null}
    </>
  )
}

const STATUS_OPTIONS = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
]

/** The words the header funnels offer - the labels below, as the cells print them. */
const STATUS_VALUES = ['Active', 'Inactive']
const YES_NO_VALUES = ['Yes', 'No']

const YES_NO_OPTIONS = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
]


/** What each column SHOWS - the text its header filter matches and its funnel lists. */
const COLUMN_TEXT: Record<string, ColumnText<WarehouseDto>> = {
  warehouseCode: (w) => w.warehouseCode,
  warehouseName: (w) => w.warehouseName,
  branchName: (w) => w.branchName,
  address: (w) => w.address ?? '',
  isMainWarehouse: (w) => (w.isMainWarehouse ? 'Yes' : 'No'),
  isActive: (w) => (w.isActive ? 'Active' : 'Inactive'),
}

/** Sorts on whatever column was clicked: flags with the false side first, the rest as text. */
function compareRows(a: WarehouseDto, b: WarehouseDto, key: keyof WarehouseDto): number {
  const left = a[key]
  const right = b[key]
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right)
  return String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true })
}
