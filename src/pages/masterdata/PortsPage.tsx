import { useCallback, useState } from 'react'
import { Alert, Badge, Button, Paper, Select, Text, TextInput } from '@mantine/core'
import { IconFilterOff, IconPlus, IconSearch } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { PORT_KINDS, portsApi, type PortDto, type PortKind } from '../../api/masterdata/ports'
import { useAuth } from '../../auth/useAuth'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { findCountry } from '../../data/countries'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'
import { PortFormModal } from './PortFormModal'

interface Filters {
  search: string
  kind: string | null
  isActive: string | null
}

const NO_FILTERS: Filters = { search: '', kind: null, isActive: null }

type Dialog = { kind: 'create' } | { kind: 'edit'; port: PortDto } | null

const KIND_COLOURS: Record<PortKind, string> = { Sea: 'blue', Inland: 'teal', Border: 'orange', Air: 'grape' }

/** Sea ports, border posts and inland places: the stops of a container's route. */
export function PortsPage() {
  const { hasPermission } = useAuth()
  const [dialog, setDialog] = useState<Dialog>(null)
  const canManage = hasPermission(PERMISSIONS.portsManage)

  const grid = useGridQuery<Filters, PortDto, Awaited<ReturnType<typeof portsApi.list>>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'portCode', direction: 'asc' },
    paging: 'server',
    errorMessage: 'The ports could not be loaded.',
    fetcher: useCallback(
      ({ filters, page, pageSize, sortStatus, signal }) =>
        portsApi.list(
          {
            search: filters.search.trim() || undefined,
            kind: (filters.kind as PortKind | null) ?? undefined,
            isActive: filters.isActive === null ? undefined : filters.isActive === 'true',
            sortBy: ACCESSOR_TO_SORT[sortStatus.columnAccessor as string] ?? 'PortCode',
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

  async function handleToggleStatus(row: PortDto) {
    const activating = !row.isActive
    const go = await confirm({
      title: activating ? 'Activate port' : 'Deactivate port',
      message: activating
        ? `Activate ${row.portCode} - ${row.portName}?`
        : `Deactivate ${row.portCode} - ${row.portName}? It will no longer be offered on a container.`,
      confirmLabel: activating ? 'Activate' : 'Deactivate',
    })
    if (!go) return
    try {
      await portsApi.setActive(row.id, activating, row.rowVersion)
      await afterSave(activating ? 'Port activated.' : 'Port deactivated.')
    } catch (err) {
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The port could not be updated.')
      if (err instanceof ApiError && err.code === 'CONCURRENCY') await load()
    }
  }

  async function handleDelete(row: PortDto) {
    const go = await confirm({
      title: 'Delete port',
      message: `Delete port ${row.portCode} - ${row.portName}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!go) return
    try {
      await portsApi.remove(row.id)
      await afterSave('Port deleted successfully.')
    } catch (err) {
      // IN_USE: the server's sentence says the port is used by containers and to deactivate it instead.
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The port could not be deleted.')
    }
  }

  const columns: DataTableColumn<PortDto>[] = [
    rowNumberColumn<PortDto>(grid.page, grid.pageSize),
    { accessor: 'portCode', title: 'Port Code', sortable: true, width: 120, render: (row) => <Text fw={600} fz="sm">{row.portCode}</Text> },
    { accessor: 'portName', title: 'Port Name', sortable: true },
    {
      accessor: 'countryCode',
      title: 'Country',
      sortable: true,
      width: 200,
      render: (row) => {
        if (!row.countryCode) return <Text c="dimmed">—</Text>
        const country = findCountry(row.countryCode)
        return country ? `${country.name} (${country.code})` : row.countryCode
      },
    },
    {
      accessor: 'kind',
      title: 'Kind',
      sortable: true,
      width: 110,
      render: (row) => <Badge variant="light" color={KIND_COLOURS[row.kind] ?? 'gray'}>{row.kind}</Badge>,
    },
    { accessor: 'isActive', title: 'Status', sortable: true, width: 120, render: (row) => <StatusBadge active={row.isActive} /> },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 130,
      textAlign: 'right',
      render: (row) => (
        <RowActions
          label={row.portCode}
          edit={{ visible: canManage, onClick: () => setDialog({ kind: 'edit', port: row }) }}
          toggleStatus={{ visible: canManage, active: row.isActive, onClick: () => void handleToggleStatus(row) }}
          remove={{ visible: canManage, onClick: () => void handleDelete(row) }}
        />
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Ports"
        subtitle="Sea ports, border posts and inland places a container passes through."
        actions={
          canManage ? (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setDialog({ kind: 'create' })}>
              New Port
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <FilterBar.Col span={5}>
          <TextInput
            placeholder="Port code or name"
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
          <Select aria-label="Kind" placeholder="All kinds" data={PORT_KINDS} value={filters.kind} onChange={(value) => setFilter('kind', value)} clearable />
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
        <Alert color="red" mb="md" title="Could not load ports">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        <DataTable<PortDto>
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
          onRowActivate={canManage ? ({ record }) => setDialog({ kind: 'edit', port: record }) : undefined}
          noRecordsText={grid.isDefault ? 'No ports yet.' : 'No ports found. Try clearing the filters.'}
        />
      </Paper>

      {dialog ? (
        <PortFormModal
          mode={dialog.kind}
          port={dialog.kind === 'edit' ? dialog.port : undefined}
          onClose={() => setDialog(null)}
          onSaved={() => void afterSave(dialog.kind === 'create' ? 'Port created successfully.' : 'Port updated successfully.')}
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
  portCode: 'PortCode',
  portName: 'PortName',
  countryCode: 'CountryCode',
  kind: 'Kind',
  isActive: 'IsActive',
}
