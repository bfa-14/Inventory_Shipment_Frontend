import { useCallback, useMemo, useState } from 'react'
import { Alert, Button, Paper, Select, Text, TextInput, Tooltip } from '@mantine/core'
import { IconFilterOff, IconPlus, IconRefresh, IconSearch, IconTableExport } from '@tabler/icons-react'
import { fetchAllPages, type AllRows } from '../../api/fetchAllPages'
import { ApiError } from '../../api/http'
import { brandsApi } from '../../api/masterdata/brands'
import type { BrandDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { formatDateTime } from '../../components/format'
import { downloadCsv } from '../../components/masterdata/csv'
import { columnFilter } from '../../components/ui/columnFilter'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { triStateFilter, triStateQuery, useGridFilters, type ColumnText } from '../../components/ui/gridFilters'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { FilterBar } from '../../components/ui/FilterBar'
import { MoreActionsMenu } from '../../components/ui/MoreActionsMenu'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'
import { BrandFormModal } from './BrandFormModal'

/** The filters the reader edits. Paging and sorting are the grid's own, held by useGridQuery. */
interface Filters {
  search: string
  isActive: string | null
}

const NO_FILTERS: Filters = { search: '', isActive: null }

type Dialog = { kind: 'create' } | { kind: 'edit'; brand: BrandDto } | null

export function BrandsPage() {
  const { hasPermission } = useAuth()
  const [dialog, setDialog] = useState<Dialog>(null)

  const canCreate = hasPermission(PERMISSIONS.brandsCreate)
  const canEdit = hasPermission(PERMISSIONS.brandsEdit)
  const canDelete = hasPermission(PERMISSIONS.brandsDelete)

  /**
   * The grid's whole query. No Apply button: the search box settles 350ms after the last keystroke,
   * every other control lands at once, and the hook guarantees one request per settled state with
   * the newest one winning.
   *
   * The filter bar and the Status funnel are two ways into the SAME filter, and both go through
   * `setFilter`, so a header reading "Active" over a bar reading "All" is not a state that exists.
   */
  const grid = useGridQuery<Filters, BrandDto, AllRows<BrandDto>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'brandCode', direction: 'asc' },
    // The whole table comes back in one go, so turning a page or re-sorting must not ask again.
    paging: 'client',
    errorMessage: 'The brands could not be loaded.',
    fetcher: useCallback(
      ({ filters, signal }) =>
        fetchAllPages((page, pageSize) =>
          brandsApi.search(
            {
              search: filters.search.trim() || undefined,
              isActive: filters.isActive === null ? undefined : filters.isActive === 'true',
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
  const load = grid.reload
  const rows = useMemo(() => data?.items ?? [], [data])

  // A filter that leaves three rows must not strand the reader on page 4 of the old result.
  const columnFilters = useGridFilters(COLUMN_TEXT, () => grid.setPage(1))
  const { apply: applyColumnFilters, options: columnOptions } = columnFilters

  /** What the funnels left - the rows this page then sorts, pages, counts and exports. */
  const narrowed = useMemo(() => applyColumnFilters(rows), [rows, applyColumnFilters])

  const sortKey = grid.sortStatus.columnAccessor as keyof BrandDto
  const sortDirection = grid.sortStatus.direction

  const sorted = useMemo(() => {
    const ordered = [...narrowed].sort((a, b) => compareRows(a, b, sortKey))
    if (sortDirection === 'desc') ordered.reverse()
    return ordered
  }, [narrowed, sortKey, sortDirection])

  const records = sorted.slice((grid.page - 1) * grid.pageSize, grid.page * grid.pageSize)

  /** The tick lists come from EVERY brand, not from the rows surviving the filters. */
  const values = useMemo(
    () => ({
      brandCode: columnOptions(rows, 'brandCode'),
      brandName: columnOptions(rows, 'brandName'),
    }),
    [rows, columnOptions],
  )

  function exportCsv() {
    downloadCsv(
      'brands.csv',
      ['Brand Code', 'Brand Name', 'Description', 'Status', 'Created'],
      // What the reader is looking at, funnels and all - not the whole table behind them.
      sorted.map((b) => [
        b.brandCode,
        b.brandName,
        b.description ?? '',
        b.isActive ? 'Active' : 'Inactive',
        formatDateTime(b.createdAtUtc),
      ]),
    )
  }

  async function afterSave(message: string) {
    setDialog(null)
    notify.success(message)
    await load()
  }

  async function handleDelete(brand: BrandDto) {
    const confirmed = await confirm({
      title: 'Delete brand',
      message: `Delete brand ${brand.brandCode} - ${brand.brandName}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!confirmed) return

    try {
      await brandsApi.remove(brand.id)
      await afterSave('Brand deleted successfully.')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REFERENCED') {
        const deactivate = await confirm({
          title: 'Brand cannot be deleted',
          message: err.messages[0] as string,
          confirmLabel: 'Deactivate instead',
        })
        if (deactivate) await setStatus(brand, false)
        return
      }
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The brand could not be deleted.')
    }
  }

  async function setStatus(brand: BrandDto, isActive: boolean) {
    try {
      await brandsApi.setStatus(brand.id, isActive)
      await afterSave(isActive ? 'Brand activated.' : 'Brand deactivated.')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONCURRENCY') {
        notify.error(err.messages[0] as string)
        await load()
        return
      }
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The brand could not be updated.')
    }
  }

  async function handleToggleStatus(brand: BrandDto) {
    const activating = !brand.isActive
    const confirmed = await confirm({
      title: activating ? 'Activate brand' : 'Deactivate brand',
      message: activating
        ? `Activate ${brand.brandCode} - ${brand.brandName}?`
        : `Deactivate ${brand.brandCode} - ${brand.brandName}? It will no longer be selectable.`,
      confirmLabel: activating ? 'Activate' : 'Deactivate',
    })
    if (confirmed) await setStatus(brand, activating)
  }

  const columns: DataTableColumn<BrandDto>[] = [
    rowNumberColumn<BrandDto>(grid.page, grid.pageSize),
    /* These three now carry their own funnel. The page holds the whole table, so each is matched
       here against the text its own cell shows - which the filter bar's search box could never do,
       being one parameter over code OR name, and never over Description at all. */
    {
      accessor: 'brandCode',
      title: 'Brand Code',
      sortable: true,
      width: 150,
      ...columnFilter({ ...columnFilters.bind('brandCode'), label: 'Brand Code', options: values.brandCode }),
    },
    {
      accessor: 'brandName',
      title: 'Brand Name',
      sortable: true,
      width: 220,
      ...columnFilter({ ...columnFilters.bind('brandName'), label: 'Brand Name', options: values.brandName }),
    },
    {
      accessor: 'description',
      title: 'Description',
      sortable: true,
      // No tick list: a description is prose, so the list would be one entry per row.
      ...columnFilter({ ...columnFilters.bind('description'), label: 'Description' }),
      // No width: it takes whatever the fixed columns leave, so the grid fits a laptop.
      render: (brand) =>
        brand.description ? (
          <Tooltip label={brand.description} multiline w={300} withArrow position="top-start">
            <Text fz="sm" lineClamp={1}>
              {brand.description}
            </Text>
          </Tooltip>
        ) : (
          <Text c="dimmed">—</Text>
        ),
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
      render: (b) => <StatusBadge active={b.isActive} />,
    },
    {
      accessor: 'createdAtUtc',
      title: 'Created',
      sortable: true,
      width: 180,
      // No tick list: every row is a different instant, so the list would be one entry per row.
      ...columnFilter({ ...columnFilters.bind('createdAtUtc'), label: 'Created' }),
      render: (b) => formatDateTime(b.createdAtUtc),
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 130,
      textAlign: 'right',
      render: (brand) => (
        <RowActions
          label={brand.brandCode}
          edit={{ visible: canEdit, onClick: () => setDialog({ kind: 'edit', brand }) }}
          toggleStatus={{
            visible: canEdit,
            active: brand.isActive,
            onClick: () => void handleToggleStatus(brand),
          }}
          remove={{ visible: canDelete, onClick: () => void handleDelete(brand) }}
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
        title="Brands"
        subtitle="View and manage the brands items can be assigned to."
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
                New Brand
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar>
        <FilterBar.Col span={7}>
          <TextInput
            placeholder="Search by brand code or name..."
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

        <FilterBar.Col span={3}>
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
        <Alert color="red" mb="md" title="Could not load brands">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        <DataTable<BrandDto>
          storeKey="masterdata.brands"
          records={records}
          // The footer totals what the filters left, never just the page on screen.
          summaryRecords={narrowed}
          columns={columns}
          // What the funnels left, which is what the footer must count.
          totalRecords={narrowed.length}
          filters={{ activeCount: columnFilters.activeCount, clearAll: columnFilters.clearAll }}
          page={grid.page}
          recordsPerPage={grid.pageSize}
          onPageChange={grid.setPage}
          onRecordsPerPageChange={grid.setPageSize}
          sortStatus={grid.sortStatus}
          onSortStatusChange={grid.setSortStatus}
          fetching={loading}
          // Enter on the selected row does what its pencil does.
          onRowActivate={canEdit ? ({ record }) => setDialog({ kind: 'edit', brand: record }) : undefined}
          noRecordsText={
            filtered ? 'No brands found. Try clearing the filters to see every brand.' : 'No brands found.'
          }
        />
      </Paper>

      {dialog ? (
        <BrandFormModal
          mode={dialog.kind}
          brand={dialog.kind === 'edit' ? dialog.brand : undefined}
          onClose={() => setDialog(null)}
          onSaved={() =>
            void afterSave(dialog.kind === 'create' ? 'Brand created successfully.' : 'Brand updated successfully.')
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

/** The words the Status funnel offers - the labels above, as the cells print them. */
const STATUS_VALUES = ['Active', 'Inactive']

/** What each column SHOWS for a brand - the text its header filter matches and its funnel lists. */
const COLUMN_TEXT: Record<string, ColumnText<BrandDto>> = {
  brandCode: (b) => b.brandCode,
  brandName: (b) => b.brandName,
  description: (b) => b.description ?? '',
  isActive: (b) => (b.isActive ? 'Active' : 'Inactive'),
  createdAtUtc: (b) => formatDateTime(b.createdAtUtc),
}

/** Sorts on whatever column was clicked: flags with Inactive first, the rest as text. */
function compareRows(a: BrandDto, b: BrandDto, key: keyof BrandDto): number {
  const left = a[key]
  const right = b[key]
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right)
  return String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true })
}
