import { useCallback, useMemo, useState } from 'react'
import { Alert, Button, Paper, Select, Text, TextInput } from '@mantine/core'
import { IconFilterOff, IconPlus, IconSearch } from '@tabler/icons-react'
import { fetchAllPages, type AllRows } from '../../api/fetchAllPages'
import { ApiError } from '../../api/http'
import { appliesToLabel, ATTACHMENT_CATEGORIES, attachmentTypesApi, type AttachmentTypeDto } from '../../api/masterdata/attachmentTypes'
import { useAuth } from '../../auth/useAuth'
import { formatNumber } from '../../components/format'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'
import { AttachmentTypeFormModal } from './AttachmentTypeFormModal'

interface Filters {
  search: string
  category: string | null
  isActive: string | null
}

const NO_FILTERS: Filters = { search: '', category: null, isActive: null }

/**
 * What each column IS, for the grid engine: its kind (so a number compares as a number), what it
 * shows, and whether the footer totals it. How a cell LOOKS stays in the column definitions below.
 */
const GRID_COLUMNS: GridColumnMeta<AttachmentTypeDto>[] = [
  { accessor: 'category', summary: 'count' },
  { accessor: 'subType' },
  { accessor: 'appliesTo', kind: 'list', text: (r) => appliesToLabel(r.appliesTo) },
  { accessor: 'sortOrder', kind: 'number', text: (r) => formatNumber(r.sortOrder) },
  { accessor: 'isActive', kind: 'boolean', text: (r) => (r.isActive ? 'Active' : 'Inactive') },
]

type Dialog = { kind: 'create' } | { kind: 'edit'; attachmentType: AttachmentTypeDto } | null

/** What a container file is - "Shipping / Bill of Lading" - so the paperwork can be sorted and found. */
export function AttachmentTypesPage() {
  const { hasPermission } = useAuth()
  const [dialog, setDialog] = useState<Dialog>(null)
  const canManage = hasPermission(PERMISSIONS.attachmentTypesManage)

  const grid = useGridQuery<Filters, AttachmentTypeDto, AllRows<AttachmentTypeDto>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'sortOrder', direction: 'asc' },
    // The whole table comes back in one go, so turning a page or re-sorting must not ask again.
    paging: 'client',
    errorMessage: 'The attachment types could not be loaded.',
    fetcher: useCallback(
      ({ filters, signal }) =>
        fetchAllPages((page, pageSize) =>
          attachmentTypesApi.list(
            {
              search: filters.search.trim() || undefined,
              category: filters.category ?? undefined,
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
  const rows = useMemo(() => data?.items ?? [], [data])

  /* THE ENGINE HOLDS THE WHOLE TABLE AND ANSWERS FOR EVERY COLUMN: filter, multi-column sort, paging,
     footer totals over all the filtered rows, CSV. The bar above the grid still narrows what is
     loaded; the grid's own column filters narrow what is loaded. */
  const engine = useDataGrid({
    rows,
    columns: GRID_COLUMNS,
    storeKey: 'masterdata.attachmentTypes',
    sort: [{ accessor: 'sortOrder', direction: 'asc' }],
  })
  const load = grid.reload

  async function afterSave(message: string) {
    setDialog(null)
    notify.success(message)
    await load()
  }

  const label = (row: AttachmentTypeDto) => `${row.category} / ${row.subType}`

  async function handleToggleStatus(row: AttachmentTypeDto) {
    const activating = !row.isActive
    const go = await confirm({
      title: activating ? 'Activate attachment type' : 'Deactivate attachment type',
      message: activating ? `Activate ${label(row)}?` : `Deactivate ${label(row)}? It will no longer be offered when a file is attached.`,
      confirmLabel: activating ? 'Activate' : 'Deactivate',
    })
    if (!go) return
    try {
      await attachmentTypesApi.setActive(row.id, activating, row.rowVersion)
      await afterSave(activating ? 'Attachment type activated.' : 'Attachment type deactivated.')
    } catch (err) {
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The attachment type could not be updated.')
      if (err instanceof ApiError && err.code === 'CONCURRENCY') await load()
    }
  }

  async function handleDelete(row: AttachmentTypeDto) {
    const go = await confirm({
      title: 'Delete attachment type',
      message: `Delete ${label(row)}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!go) return
    try {
      await attachmentTypesApi.remove(row.id)
      await afterSave('Attachment type deleted successfully.')
    } catch (err) {
      // IN_USE: files are filed under it; the server's sentence says to deactivate it instead.
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The attachment type could not be deleted.')
    }
  }

  const columns: DataTableColumn<AttachmentTypeDto>[] = [
    rowNumberColumn<AttachmentTypeDto>(engine.page, engine.pageSize),
    {
      accessor: 'category',
      title: 'Category',
      width: 180,
      render: (row) => <Text fw={600} fz="sm">{row.category}</Text>,
    },
    {
      accessor: 'subType',
      title: 'Sub Type',
    },
    {
      accessor: 'appliesTo',
      title: 'Used on',
      width: 130,
      render: (row) => appliesToLabel(row.appliesTo),
    },
    {
      accessor: 'sortOrder',
      title: 'Sort Order',
      width: 120,
      textAlign: 'right',
      render: (row) => formatNumber(row.sortOrder),
    },
    {
      accessor: 'isActive',
      title: 'Status',
      width: 120,
      render: (row) => <StatusBadge active={row.isActive} />,
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 130,
      textAlign: 'right',
      render: (row) => (
        <RowActions
          label={label(row)}
          edit={{ visible: canManage, onClick: () => setDialog({ kind: 'edit', attachmentType: row }) }}
          toggleStatus={{ visible: canManage, active: row.isActive, onClick: () => void handleToggleStatus(row) }}
          remove={{ visible: canManage, onClick: () => void handleDelete(row) }}
        />
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Attachment Types"
        subtitle="The kinds of document a container file or a customer receipt can be filed as."
        actions={
          canManage ? (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setDialog({ kind: 'create' })}>
              New Attachment Type
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <FilterBar.Col span={5}>
          <TextInput
            placeholder="Category or sub type"
            leftSection={<IconSearch size={16} />}
            label="Search"
            value={filters.search}
            onChange={(e) => setFilter('search', e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') grid.commitFilters()
            }}
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select label="Category" placeholder="All categories" data={ATTACHMENT_CATEGORIES} value={filters.category} onChange={(value) => setFilter('category', value)} clearable />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select label="Status" placeholder="All" data={STATUS_OPTIONS} value={filters.isActive} onChange={(value) => setFilter('isActive', value)} clearable />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Button variant="default" leftSection={<IconFilterOff size={16} />} onClick={grid.clearFilters} disabled={grid.isDefault}>
            Clear Filters
          </Button>
        </FilterBar.Col>
      </FilterBar>

      {error ? (
        <Alert color="red" mb="md" title="Could not load attachment types">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        <DataTable<AttachmentTypeDto>
          storeKey="masterdata.attachmentTypes"
          engine={engine}
          exportFileName="attachment-types"
          columns={columns}
          fetching={loading}
          onRowActivate={canManage ? ({ record }) => setDialog({ kind: 'edit', attachmentType: record }) : undefined}
          noRecordsText={grid.isDefault ? 'No attachment types yet.' : 'No attachment types found. Try clearing the filters.'}
        />
      </Paper>

      {dialog ? (
        <AttachmentTypeFormModal
          mode={dialog.kind}
          attachmentType={dialog.kind === 'edit' ? dialog.attachmentType : undefined}
          onClose={() => setDialog(null)}
          onSaved={() =>
            void afterSave(dialog.kind === 'create' ? 'Attachment type created successfully.' : 'Attachment type updated successfully.')
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

