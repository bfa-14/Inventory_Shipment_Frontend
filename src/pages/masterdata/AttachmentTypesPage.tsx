import { useCallback, useState } from 'react'
import { Alert, Button, Paper, Select, Text, TextInput } from '@mantine/core'
import { IconFilterOff, IconPlus, IconSearch } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { ATTACHMENT_CATEGORIES, attachmentTypesApi, type AttachmentTypeDto } from '../../api/masterdata/attachmentTypes'
import { useAuth } from '../../auth/useAuth'
import { formatNumber } from '../../components/format'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
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

type Dialog = { kind: 'create' } | { kind: 'edit'; attachmentType: AttachmentTypeDto } | null

/** What a container file is - "Shipping / Bill of Lading" - so the paperwork can be sorted and found. */
export function AttachmentTypesPage() {
  const { hasPermission } = useAuth()
  const [dialog, setDialog] = useState<Dialog>(null)
  const canManage = hasPermission(PERMISSIONS.attachmentTypesManage)

  const grid = useGridQuery<Filters, AttachmentTypeDto, Awaited<ReturnType<typeof attachmentTypesApi.list>>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'sortOrder', direction: 'asc' },
    paging: 'server',
    errorMessage: 'The attachment types could not be loaded.',
    fetcher: useCallback(
      ({ filters, page, pageSize, sortStatus, signal }) =>
        attachmentTypesApi.list(
          {
            search: filters.search.trim() || undefined,
            category: filters.category ?? undefined,
            isActive: filters.isActive === null ? undefined : filters.isActive === 'true',
            sortBy: ACCESSOR_TO_SORT[sortStatus.columnAccessor as string] ?? 'SortOrder',
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
    rowNumberColumn<AttachmentTypeDto>(grid.page, grid.pageSize),
    { accessor: 'category', title: 'Category', sortable: true, width: 180, render: (row) => <Text fw={600} fz="sm">{row.category}</Text> },
    { accessor: 'subType', title: 'Sub Type', sortable: true },
    { accessor: 'sortOrder', title: 'Sort Order', sortable: true, width: 120, textAlign: 'right', render: (row) => formatNumber(row.sortOrder) },
    { accessor: 'isActive', title: 'Status', sortable: true, width: 120, render: (row) => <StatusBadge active={row.isActive} /> },
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
        subtitle="The kinds of document a container file can be filed as."
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
            aria-label="Search"
            value={filters.search}
            onChange={(e) => setFilter('search', e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') grid.commitFilters()
            }}
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select aria-label="Category" placeholder="All categories" data={ATTACHMENT_CATEGORIES} value={filters.category} onChange={(value) => setFilter('category', value)} clearable />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select aria-label="Status" placeholder="All" data={STATUS_OPTIONS} value={filters.isActive} onChange={(value) => setFilter('isActive', value)} clearable />
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

const ACCESSOR_TO_SORT: Record<string, string> = {
  sortOrder: 'SortOrder',
  category: 'Category',
  subType: 'SubType',
  isActive: 'IsActive',
}
