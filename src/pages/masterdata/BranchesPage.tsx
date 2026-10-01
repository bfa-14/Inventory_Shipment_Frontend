import { useCallback, useMemo, useState } from 'react'
import { Alert, Button, Paper, Select, TextInput } from '@mantine/core'
import { IconFilterOff, IconPlus, IconRefresh, IconSearch, IconTableExport } from '@tabler/icons-react'
import { fetchAllPages, type AllRows } from '../../api/fetchAllPages'
import { ApiError } from '../../api/http'
import { branchesApi } from '../../api/masterdata/branches'
import type { BranchDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { downloadCsv } from '../../components/masterdata/csv'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { FilterBar } from '../../components/ui/FilterBar'
import { MoreActionsMenu } from '../../components/ui/MoreActionsMenu'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { MainFlag, StatusBadge } from '../../components/ui/StatusBadge'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'
import { BranchFormModal } from './BranchFormModal'

/** The filters the reader edits. Paging and sorting are the grid's own, held by useGridQuery. */
interface Filters {
  search: string
  isActive: string | null
  isMainBranch: string | null
}

const NO_FILTERS: Filters = { search: '', isActive: null, isMainBranch: null }

type Dialog = { kind: 'create' } | { kind: 'edit'; branch: BranchDto } | null

export function BranchesPage() {
  const { hasPermission } = useAuth()
  const [dialog, setDialog] = useState<Dialog>(null)

  const canCreate = hasPermission(PERMISSIONS.branchesCreate)
  const canEdit = hasPermission(PERMISSIONS.branchesEdit)
  const canDelete = hasPermission(PERMISSIONS.branchesDelete)

  /**
   * The grid's whole query. No Apply button: the search box settles 350ms after the last keystroke,
   * every other control lands at once, and the hook guarantees one request per settled state with
   * the newest one winning.
   *
   * The filter bar and the column funnels are two ways into the SAME filter, and both go through
   * `setFilter`, so a header reading "Active" over a bar reading "All" is not a state that exists.
   */
  const grid = useGridQuery<Filters, BranchDto, AllRows<BranchDto>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'branchCode', direction: 'asc' },
    // The whole table comes back in one go, so turning a page or re-sorting must not ask again.
    paging: 'client',
    errorMessage: 'The branches could not be loaded.',
    fetcher: useCallback(
      ({ filters, signal }) =>
        fetchAllPages((page, pageSize) =>
          branchesApi.search(
            {
              search: filters.search.trim() || undefined,
              isActive: filters.isActive === null ? undefined : filters.isActive === 'true',
              isMainBranch: filters.isMainBranch === null ? undefined : filters.isMainBranch === 'true',
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

  /* THE ENGINE HOLDS THE WHOLE TABLE AND ANSWERS FOR EVERY COLUMN: typed filters, multi-column sort,
     paging, footer totals over all the filtered rows, CSV. The bar above the grid still narrows what
     is loaded from the server; the column filters then narrow what was loaded. */
  const engine = useDataGrid({
    rows,
    columns: GRID_COLUMNS,
    storeKey: 'masterdata.branches',
    sort: [{ accessor: 'branchCode', direction: 'asc' }],
  })

  // A filter that leaves three rows must not strand the reader on page 4 of the old result.

  function exportCsv() {
    downloadCsv(
      'branches.csv',
      ['Branch Code', 'Branch Name', 'Address', 'Is Main Branch', 'Status'],
      // What the reader is looking at, funnels and all - not the whole table behind them.
      engine.rows.map((b) => [
        b.branchCode,
        b.branchName,
        b.address ?? '',
        b.isMainBranch ? 'Yes' : 'No',
        b.isActive ? 'Active' : 'Inactive',
      ]),
    )
  }

  async function afterSave(message: string) {
    setDialog(null)
    notify.success(message)
    await load()
  }

  async function handleDelete(branch: BranchDto) {
    const confirmed = await confirm({
      title: 'Delete branch',
      message: `Delete branch ${branch.branchCode} - ${branch.branchName}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!confirmed) return

    try {
      await branchesApi.remove(branch.id)
      await afterSave('Branch deleted successfully.')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REFERENCED') {
        const deactivate = await confirm({
          title: 'Branch cannot be deleted',
          message: err.messages[0] as string,
          confirmLabel: 'Deactivate instead',
        })
        if (deactivate) await setStatus(branch, false)
        return
      }
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The branch could not be deleted.')
    }
  }

  async function setStatus(branch: BranchDto, isActive: boolean) {
    try {
      await branchesApi.setStatus(branch.id, isActive)
      await afterSave(isActive ? 'Branch activated.' : 'Branch deactivated.')
    } catch (err) {
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The branch could not be updated.')
    }
  }

  async function handleToggleStatus(branch: BranchDto) {
    const activating = !branch.isActive
    const confirmed = await confirm({
      title: activating ? 'Activate branch' : 'Deactivate branch',
      message: activating
        ? `Activate ${branch.branchCode} - ${branch.branchName}?`
        : `Deactivate ${branch.branchCode} - ${branch.branchName}? It will no longer be selectable.`,
      confirmLabel: activating ? 'Activate' : 'Deactivate',
    })
    if (confirmed) await setStatus(branch, activating)
  }

  const columns: DataTableColumn<BranchDto>[] = [
    rowNumberColumn<BranchDto>(engine.page, engine.pageSize),
    /* These three now carry their own funnel. The page holds the whole table, so each one is
       matched here against the text its own cell shows - which is what the search box in the filter
       bar could never do, being one parameter over code OR name. */
    {
      accessor: 'branchCode',
      title: 'Branch Code',
      width: 150,
    },
    {
      accessor: 'branchName',
      title: 'Branch Name',
    },
    {
      accessor: 'address',
      title: 'Address',
      render: (b) => b.address ?? '-',
    },
    {
      accessor: 'isMainBranch',
      title: 'Is Main Branch',
      width: 190,
      render: (b) => <MainFlag isMain={b.isMainBranch} />,
    },
    {
      accessor: 'isActive',
      title: 'Status',
      width: 150,
      render: (b) => <StatusBadge active={b.isActive} />,
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 130,
      textAlign: 'right',
      render: (branch) => (
        <RowActions
          label={branch.branchCode}
          edit={{ visible: canEdit, onClick: () => setDialog({ kind: 'edit', branch }) }}
          toggleStatus={{
            visible: canEdit,
            active: branch.isActive,
            disabled: branch.isMainBranch && branch.isActive,
            disabledReason: 'The main branch cannot be deactivated',
            onClick: () => void handleToggleStatus(branch),
          }}
          remove={{
            visible: canDelete,
            disabled: branch.isMainBranch,
            disabledReason: 'The main branch cannot be deleted',
            onClick: () => void handleDelete(branch),
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
        title="Branches / Sites"
        subtitle="View and manage company branches / sites."
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
                New Branch
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar>
        <FilterBar.Col span={5}>
          <TextInput
            placeholder="Search by branch code or name..."
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

        <FilterBar.Col span={2}>
          <Select
            label="Is Main Branch"
            placeholder="All"
            data={YES_NO_OPTIONS}
            value={filters.isMainBranch}
            onChange={(value) => setFilter('isMainBranch', value)}
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
        <Alert color="red" mb="md" title="Could not load branches">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        <DataTable<BranchDto>
          storeKey="masterdata.branches"
          engine={engine}
          exportFileName="branches"
          columns={columns}
          fetching={loading}
          // Enter on the selected row does what its pencil does.
          onRowActivate={canEdit ? ({ record }) => setDialog({ kind: 'edit', branch: record }) : undefined}
          noRecordsText={
            filtered ? 'No branches found. Try clearing the filters to see every branch.' : 'No branches found.'
          }
        />
      </Paper>

      {dialog ? (
        <BranchFormModal
          mode={dialog.kind}
          branch={dialog.kind === 'edit' ? dialog.branch : undefined}
          onClose={() => setDialog(null)}
          onSaved={() =>
            void afterSave(dialog.kind === 'create' ? 'Branch created successfully.' : 'Branch updated successfully.')
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

const YES_NO_OPTIONS = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
]


/**
 * What each column SHOWS for a branch - the text its header filter matches. The table is small
 * enough to hold in full, so these are matched here rather than by the search procedure, and every
 * column can answer a funnel instead of only the three the procedure takes parameters for.
 */
/**
 * What each column IS, for the grid engine: its kind (so a number compares as a number and a date
 * as a date), and what it shows. How a cell LOOKS stays in the column definitions below.
 */
const GRID_COLUMNS: GridColumnMeta<BranchDto>[] = [
  { accessor: 'branchCode', summary: 'count' },
  { accessor: 'branchName' },
  { accessor: 'address', text: (b) => b.address ?? '' },
  { accessor: 'isMainBranch', kind: 'boolean', text: (b) => (b.isMainBranch ? 'Yes' : 'No') },
  { accessor: 'isActive', kind: 'boolean', text: (b) => (b.isActive ? 'Active' : 'Inactive') },
]

