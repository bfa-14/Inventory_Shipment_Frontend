import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Group, Paper, Select, TextInput } from '@mantine/core'
import { IconFilter, IconPlus, IconRefresh, IconSearch, IconTableExport } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { branchesApi } from '../../api/masterdata/branches'
import type { BranchDto, BranchSortBy, PagedResult } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { downloadCsv } from '../../components/masterdata/csv'
import { columnFilter } from '../../components/ui/columnFilter'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn, type DataTableSortStatus } from '../../components/ui/DataTable'
import { triStateFilter, triStateQuery } from '../../components/ui/gridFilters'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { FilterBar } from '../../components/ui/FilterBar'
import { MoreActionsMenu } from '../../components/ui/MoreActionsMenu'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { MainFlag, StatusBadge } from '../../components/ui/StatusBadge'
import { PAGE_SIZE_DEFAULT } from '../../config'
import { PERMISSIONS } from '../../navigation'
import { BranchFormModal } from './BranchFormModal'

/** Everything that decides which rows the API returns. */
interface Query {
  search: string
  isActive: string | null
  isMainBranch: string | null
  sortBy: BranchSortBy
  sortDir: 'asc' | 'desc'
  page: number
  pageSize: number
}

const DEFAULT_QUERY: Query = {
  search: '',
  isActive: null,
  isMainBranch: null,
  sortBy: 'BranchCode',
  sortDir: 'asc',
  page: 1,
  pageSize: PAGE_SIZE_DEFAULT,
}

type Dialog = { kind: 'create' } | { kind: 'edit'; branch: BranchDto } | null

export function BranchesPage() {
  const { hasPermission } = useAuth()

  const [query, setQuery] = useState<Query>(DEFAULT_QUERY)
  // The filter inputs are only copied into `query` when the user applies them.
  const [draftSearch, setDraftSearch] = useState('')
  const [draftActive, setDraftActive] = useState<string | null>(null)
  const [draftMain, setDraftMain] = useState<string | null>(null)

  const [data, setData] = useState<PagedResult<BranchDto> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)

  const canCreate = hasPermission(PERMISSIONS.branchesCreate)
  const canEdit = hasPermission(PERMISSIONS.branchesEdit)
  const canDelete = hasPermission(PERMISSIONS.branchesDelete)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const page = await branchesApi.search({
        search: query.search || undefined,
        isActive: query.isActive === null ? undefined : query.isActive === 'true',
        isMainBranch: query.isMainBranch === null ? undefined : query.isMainBranch === 'true',
        sortBy: query.sortBy,
        sortDir: query.sortDir,
        page: query.page,
        pageSize: query.pageSize,
      })
      setData(page)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.messages.join(' ') : 'The branches could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    // Fetching the page is exactly the "synchronize with an external system" case; load() flips the
    // loading flag before it awaits so the grid shows its spinner straight away.
    // eslint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  function applyFilters() {
    setQuery((q) => ({ ...q, search: draftSearch.trim(), isActive: draftActive, isMainBranch: draftMain, page: 1 }))
  }

  function clearFilters() {
    setDraftSearch('')
    setDraftActive(null)
    setDraftMain(null)
    setQuery(DEFAULT_QUERY)
  }

  /**
   * The column funnels and the filter bar's dropdowns are two ways into the SAME query parameter,
   * so a funnel moves the bar's control with it - a header reading "Active" above a bar reading
   * "All" would be two controls disagreeing about one filter.
   *
   * A funnel applies straight away, where the bar still waits for its Filter button: the popover has
   * its own OK, and asking for a second confirmation of a confirmed choice is one click too many.
   */
  function applyStatus(value: string | null) {
    setDraftActive(value)
    setQuery((q) => ({ ...q, isActive: value, page: 1 }))
  }

  function applyMain(value: string | null) {
    setDraftMain(value)
    setQuery((q) => ({ ...q, isMainBranch: value, page: 1 }))
  }

  function exportCsv() {
    downloadCsv(
      'branches.csv',
      ['Branch Code', 'Branch Name', 'Address', 'Is Main Branch', 'Status'],
      (data?.items ?? []).map((b) => [
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
    rowNumberColumn<BranchDto>(query.page, query.pageSize),
    /* Branch Code, Branch Name and Address carry no header filter: this grid pages on the server and
       the search endpoint takes one free-text parameter that matches code OR name, so a per-column
       box here could only narrow by something other than the column it sits on. The search box in
       the filter bar is that parameter, under its own name. See docs/frontend-conventions.md. */
    { accessor: 'branchCode', title: 'Branch Code', sortable: true, width: 150 },
    { accessor: 'branchName', title: 'Branch Name', sortable: true },
    {
      accessor: 'address',
      title: 'Address',
      sortable: true,
      render: (b) => b.address ?? '-',
    },
    {
      accessor: 'isMainBranch',
      title: 'Is Main Branch',
      sortable: true,
      width: 190,
      ...columnFilter({
        label: 'Is Main Branch',
        value: triStateFilter(query.isMainBranch, 'Yes', 'No'),
        onApply: (next) => applyMain(triStateQuery(next, 'Yes')),
        options: YES_NO_VALUES,
        withText: false,
      }),
      render: (b) => <MainFlag isMain={b.isMainBranch} />,
    },
    {
      accessor: 'isActive',
      title: 'Status',
      sortable: true,
      width: 150,
      ...columnFilter({
        label: 'Status',
        value: triStateFilter(query.isActive, 'Active', 'Inactive'),
        onApply: (next) => applyStatus(triStateQuery(next, 'Active')),
        options: STATUS_VALUES,
        withText: false,
      }),
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

  const sortStatus: DataTableSortStatus<BranchDto> = {
    columnAccessor: SORT_TO_ACCESSOR[query.sortBy] ?? 'branchCode',
    direction: query.sortDir,
  }

  const filtered = query.search !== '' || query.isActive !== null || query.isMainBranch !== null

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
        <FilterBar.Col span={4}>
          <TextInput
            placeholder="Search by branch code or name..."
            leftSection={<IconSearch size={16} />}
            aria-label="Search branches"
            value={draftSearch}
            onChange={(e) => setDraftSearch(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyFilters()
            }}
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <Select
            aria-label="Status"
            placeholder="All"
            data={STATUS_OPTIONS}
            value={draftActive}
            onChange={setDraftActive}
            clearable
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <Select
            aria-label="Is Main Branch"
            placeholder="All"
            data={YES_NO_OPTIONS}
            value={draftMain}
            onChange={setDraftMain}
            clearable
          />
        </FilterBar.Col>

        <FilterBar.Col span={4}>
          <Group gap="sm">
            <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={clearFilters}>
              Clear Filters
            </Button>
            <Button variant="default" leftSection={<IconFilter size={16} />} onClick={applyFilters}>
              Filter
            </Button>
          </Group>
        </FilterBar.Col>
      </FilterBar>

      {error ? (
        <Alert color="red" mb="md" title="Could not load branches">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        <DataTable<BranchDto>
          records={data?.items ?? []}
          columns={columns}
          totalRecords={data?.totalCount ?? 0}
          page={query.page}
          recordsPerPage={query.pageSize}
          onPageChange={(page) => setQuery((q) => ({ ...q, page }))}
          onRecordsPerPageChange={(pageSize) => setQuery((q) => ({ ...q, pageSize, page: 1 }))}
          sortStatus={sortStatus}
          onSortStatusChange={(status) =>
            setQuery((q) => ({
              ...q,
              sortBy: ACCESSOR_TO_SORT[status.columnAccessor as string] ?? q.sortBy,
              sortDir: status.direction,
              page: 1,
            }))
          }
          fetching={loading}
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

/** The words the two header funnels offer - the labels above, as the cells print them. */
const STATUS_VALUES = ['Active', 'Inactive']
const YES_NO_VALUES = ['Yes', 'No']

/** The grid sorts by DTO field; the API sorts by its own column names. */
const SORT_TO_ACCESSOR: Record<BranchSortBy, string> = {
  BranchCode: 'branchCode',
  BranchName: 'branchName',
  Address: 'address',
  IsMainBranch: 'isMainBranch',
  IsActive: 'isActive',
  CreatedAtUtc: 'createdAtUtc',
}

const ACCESSOR_TO_SORT: Record<string, BranchSortBy> = {
  branchCode: 'BranchCode',
  branchName: 'BranchName',
  address: 'Address',
  isMainBranch: 'IsMainBranch',
  isActive: 'IsActive',
  createdAtUtc: 'CreatedAtUtc',
}
