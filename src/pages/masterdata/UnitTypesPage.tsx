import { useCallback, useState } from 'react'
import { Alert, Button, Paper, Select, TextInput } from '@mantine/core'
import { IconFilterOff, IconPlus, IconRefresh, IconSearch, IconTableExport } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { unitTypesApi } from '../../api/masterdata/unitTypes'
import type { UnitTypeDto, UnitTypeSortBy } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { formatDateTime } from '../../components/format'
import { downloadCsv } from '../../components/masterdata/csv'
import { columnFilter } from '../../components/ui/columnFilter'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { triStateFilter, triStateQuery } from '../../components/ui/gridFilters'
import { MoreActionsMenu } from '../../components/ui/MoreActionsMenu'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'
import { UnitTypeFormModal } from './UnitTypeFormModal'

/** The filters the reader edits. Paging and sorting are the grid's own, held by useGridQuery. */
interface Filters {
  search: string
  isActive: string | null
}

const NO_FILTERS: Filters = { search: '', isActive: null }

type Dialog = { kind: 'create' } | { kind: 'edit'; unitType: UnitTypeDto } | null

export function UnitTypesPage() {
  const { hasPermission } = useAuth()
  const [dialog, setDialog] = useState<Dialog>(null)

  const canCreate = hasPermission(PERMISSIONS.unitTypesCreate)
  const canEdit = hasPermission(PERMISSIONS.unitTypesEdit)
  const canDelete = hasPermission(PERMISSIONS.unitTypesDelete)

  const grid = useGridQuery<Filters, UnitTypeDto, Awaited<ReturnType<typeof unitTypesApi.search>>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'unitTypeName', direction: 'asc' },
    errorMessage: 'The unit types could not be loaded.',
    fetcher: useCallback(
      ({ filters, page, pageSize, sortStatus, signal }) =>
        unitTypesApi.search(
          {
            search: filters.search.trim() || undefined,
            isActive: filters.isActive === null ? undefined : filters.isActive === 'true',
            sortBy: ACCESSOR_TO_SORT[sortStatus.columnAccessor as string] ?? 'UnitTypeName',
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
      'unit-types.csv',
      ['Name', 'Status', 'Created'],
      (data?.items ?? []).map((u) => [
        u.unitTypeName,
        u.isActive ? 'Active' : 'Inactive',
        formatDateTime(u.createdAtUtc),
      ]),
    )
  }

  async function afterSave(message: string) {
    setDialog(null)
    notify.success(message)
    await load()
  }

  async function handleDelete(unitType: UnitTypeDto) {
    const confirmed = await confirm({
      title: 'Delete unit type',
      message: `Delete unit type ${unitType.unitTypeName}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!confirmed) return

    try {
      await unitTypesApi.remove(unitType.id)
      await afterSave('Unit type deleted successfully.')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REFERENCED') {
        const deactivate = await confirm({
          title: 'Unit type cannot be deleted',
          message: err.messages[0] as string,
          confirmLabel: 'Deactivate instead',
        })
        if (deactivate) await setStatus(unitType, false)
        return
      }
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The unit type could not be deleted.')
    }
  }

  async function setStatus(unitType: UnitTypeDto, isActive: boolean) {
    try {
      await unitTypesApi.setStatus(unitType.id, isActive)
      await afterSave(isActive ? 'Unit type activated.' : 'Unit type deactivated.')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONCURRENCY') {
        notify.error(err.messages[0] as string)
        await load()
        return
      }
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The unit type could not be updated.')
    }
  }

  async function handleToggleStatus(unitType: UnitTypeDto) {
    const activating = !unitType.isActive
    const confirmed = await confirm({
      title: activating ? 'Activate unit type' : 'Deactivate unit type',
      message: activating
        ? `Activate ${unitType.unitTypeName}?`
        : `Deactivate ${unitType.unitTypeName}? It will no longer be offered when an item's packaging is defined.`,
      confirmLabel: activating ? 'Activate' : 'Deactivate',
    })
    if (confirmed) await setStatus(unitType, activating)
  }

  const columns: DataTableColumn<UnitTypeDto>[] = [
    rowNumberColumn<UnitTypeDto>(grid.page, grid.pageSize),
    /* Name carries no header funnel: this grid pages on the server and the search endpoint takes one
       free-text parameter, which the filter bar's search box already is. */
    { accessor: 'unitTypeName', title: 'Name', sortable: true },
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
      render: (u) => <StatusBadge active={u.isActive} />,
    },
    {
      accessor: 'createdAtUtc',
      title: 'Created',
      sortable: true,
      width: 180,
      render: (u) => formatDateTime(u.createdAtUtc),
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 130,
      textAlign: 'right',
      render: (unitType) => (
        <RowActions
          label={unitType.unitTypeName}
          edit={{ visible: canEdit, onClick: () => setDialog({ kind: 'edit', unitType }) }}
          toggleStatus={{
            visible: canEdit,
            active: unitType.isActive,
            onClick: () => void handleToggleStatus(unitType),
          }}
          remove={{ visible: canDelete, onClick: () => void handleDelete(unitType) }}
        />
      ),
    },
  ]

  const filtered = !grid.isDefault

  return (
    <>
      <PageHeader
        title="Unit Types"
        subtitle="The units of measure an item can be packed in - PC, Box, Pallet, Container."
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
                New Unit Type
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar>
        <FilterBar.Col span={7}>
          <TextInput
            placeholder="Search by name..."
            leftSection={<IconSearch size={16} />}
            aria-label="Search unit types"
            value={filters.search}
            onChange={(e) => setFilter('search', e.currentTarget.value)}
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
        <Alert color="red" mb="md" title="Could not load unit types">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        <DataTable<UnitTypeDto>
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
          // Enter on the selected row does what its pencil does.
          onRowActivate={canEdit ? ({ record }) => setDialog({ kind: 'edit', unitType: record }) : undefined}
          noRecordsText={
            filtered ? 'No unit types found. Try clearing the filters to see every unit type.' : 'No unit types found.'
          }
        />
      </Paper>

      {dialog ? (
        <UnitTypeFormModal
          mode={dialog.kind}
          unitType={dialog.kind === 'edit' ? dialog.unitType : undefined}
          onClose={() => setDialog(null)}
          onSaved={() =>
            void afterSave(
              dialog.kind === 'create' ? 'Unit type created successfully.' : 'Unit type updated successfully.',
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

/** The words the Status funnel offers - the labels above, as the cells print them. */
const STATUS_VALUES = ['Active', 'Inactive']

const ACCESSOR_TO_SORT: Record<string, UnitTypeSortBy> = {
  unitTypeName: 'UnitTypeName',
  isActive: 'IsActive',
  createdAtUtc: 'CreatedAtUtc',
}
