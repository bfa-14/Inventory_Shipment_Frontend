import { useCallback, useState } from 'react'
import { Alert, Button, Paper, Select, Text, TextInput, Tooltip } from '@mantine/core'
import { IconFilterOff, IconPlus, IconRefresh, IconSearch, IconTableExport } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { brandsApi } from '../../api/masterdata/brands'
import type { BrandDto, BrandSortBy } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { formatDateTime } from '../../components/format'
import { downloadCsv } from '../../components/masterdata/csv'
import { columnFilter } from '../../components/ui/columnFilter'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { triStateFilter, triStateQuery } from '../../components/ui/gridFilters'
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
  const grid = useGridQuery<Filters, BrandDto, Awaited<ReturnType<typeof brandsApi.search>>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'brandCode', direction: 'asc' },
    errorMessage: 'The brands could not be loaded.',
    fetcher: useCallback(
      ({ filters, page, pageSize, sortStatus, signal }) =>
        brandsApi.search(
          {
            search: filters.search.trim() || undefined,
            isActive: filters.isActive === null ? undefined : filters.isActive === 'true',
            sortBy: ACCESSOR_TO_SORT[sortStatus.columnAccessor as string] ?? 'BrandCode',
            sortDir: sortStatus.direction,
            page,
            pageSize,
          },
          signal,
        ),
      [],
    ),
  })

  const { filters, setFilter, data, loading, error } = grid
  const load = grid.reload

  function exportCsv() {
    downloadCsv(
      'brands.csv',
      ['Brand Code', 'Brand Name', 'Description', 'Status', 'Created'],
      (data?.items ?? []).map((b) => [
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
    /* Brand Code, Brand Name and Description carry no header filter: this grid pages on the server
       and the search endpoint takes one free-text parameter that matches code OR name, so a
       per-column box here could only narrow by something other than the column it sits on. The
       search box in the filter bar is that parameter, under its own name. Description is not a
       search parameter at all. See docs/frontend-conventions.md. */
    { accessor: 'brandCode', title: 'Brand Code', sortable: true, width: 150 },
    { accessor: 'brandName', title: 'Brand Name', sortable: true, width: 220 },
    {
      accessor: 'description',
      title: 'Description',
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
            aria-label="Search brands"
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
            aria-label="Status"
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
          records={data?.items ?? []}
          columns={columns}
          totalRecords={data?.totalCount ?? 0}
          page={grid.page}
          recordsPerPage={grid.pageSize}
          onPageChange={grid.setPage}
          onRecordsPerPageChange={grid.setPageSize}
          sortStatus={grid.sortStatus}
          onSortStatusChange={grid.setSortStatus}
          fetching={loading}
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

const ACCESSOR_TO_SORT: Record<string, BrandSortBy> = {
  brandCode: 'BrandCode',
  brandName: 'BrandName',
  isActive: 'IsActive',
  createdAtUtc: 'CreatedAtUtc',
}
