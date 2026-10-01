import { useCallback, useMemo, useState } from 'react'
import { Alert, Badge, Button, Paper, Select, Text, TextInput } from '@mantine/core'
import { IconFilterOff, IconPlus, IconSearch } from '@tabler/icons-react'
import { fetchAllPages, type AllRows } from '../../api/fetchAllPages'
import { ApiError } from '../../api/http'
import {
  CASH_BANK_ACCOUNT_TYPES,
  cashBankAccountsApi,
  type CashBankAccountDto,
} from '../../api/masterdata/cashBankAccounts'
import { useAuth } from '../../auth/useAuth'
import { formatNumber } from '../../components/format'
import { columnFilter } from '../../components/ui/columnFilter'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { useGridFilters, type ColumnText } from '../../components/ui/gridFilters'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'
import { CashBankAccountFormModal } from './CashBankAccountFormModal'

interface Filters {
  search: string
  accountType: string | null
  isActive: string | null
}

const NO_FILTERS: Filters = { search: '', accountType: null, isActive: null }

/** The closed set the Status funnel offers, whatever the loaded rows happen to contain. */
const STATUS_VALUES = ['Active', 'Inactive']
const TYPE_VALUES = CASH_BANK_ACCOUNT_TYPES.map((t) => t.label)

/** An account with no branch is usable everywhere, and the funnel has to match the words the reader sees. */
const ALL_BRANCHES = 'All branches'

/** What each column SHOWS - the text its header filter matches and its funnel lists. */
const COLUMN_TEXT: Record<string, ColumnText<CashBankAccountDto>> = {
  accountCode: (r) => r.accountCode,
  accountName: (r) => r.accountName,
  accountType: (r) => r.accountType,
  currencyCode: (r) => r.currencyCode,
  branchName: (r) => r.branchName ?? ALL_BRANCHES,
  isActive: (r) => (r.isActive ? 'Active' : 'Inactive'),
}

/** Sorts on whatever column was clicked: flags with Inactive first, text naturally. */
function compareRows(a: CashBankAccountDto, b: CashBankAccountDto, key: keyof CashBankAccountDto): number {
  const left = key === 'branchName' ? (a.branchName ?? ALL_BRANCHES) : a[key]
  const right = key === 'branchName' ? (b.branchName ?? ALL_BRANCHES) : b[key]
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right)
  return String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true })
}

type Dialog = { kind: 'create' } | { kind: 'edit'; account: CashBankAccountDto } | null

/**
 * The cash boxes and bank accounts a customer receipt is paid into. An account holds ONE currency,
 * and that is what lets a receipt line be checked: the money it records must have gone into an
 * account of the same currency.
 */
export function CashBankAccountsPage() {
  const { hasPermission } = useAuth()
  const [dialog, setDialog] = useState<Dialog>(null)
  const canManage = hasPermission(PERMISSIONS.cashBankAccountsManage)

  const grid = useGridQuery<Filters, CashBankAccountDto, AllRows<CashBankAccountDto>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'accountCode', direction: 'asc' },
    // The whole table comes back in one go, so turning a page or re-sorting must not ask again.
    paging: 'client',
    errorMessage: 'The cash / bank accounts could not be loaded.',
    fetcher: useCallback(
      ({ filters, signal }) =>
        fetchAllPages((page, pageSize) =>
          cashBankAccountsApi.list(
            {
              search: filters.search.trim() || undefined,
              accountType: filters.accountType === null ? undefined : (filters.accountType as 'Cash' | 'Bank'),
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

  /** What the funnels left - the rows this page then sorts, pages and counts. */
  const narrowed = useMemo(() => applyColumnFilters(rows), [rows, applyColumnFilters])

  const sortKey = grid.sortStatus.columnAccessor as keyof CashBankAccountDto
  const sortDirection = grid.sortStatus.direction

  const sorted = useMemo(() => {
    const ordered = [...narrowed].sort((a, b) => compareRows(a, b, sortKey))
    if (sortDirection === 'desc') ordered.reverse()
    return ordered
  }, [narrowed, sortKey, sortDirection])

  const records = sorted.slice((grid.page - 1) * grid.pageSize, grid.page * grid.pageSize)

  /** The tick lists come from EVERY row, not from the ones surviving the filters. */
  const values = useMemo(
    () => ({
      accountCode: columnOptions(rows, 'accountCode'),
      accountName: columnOptions(rows, 'accountName'),
      currencyCode: columnOptions(rows, 'currencyCode'),
      branchName: columnOptions(rows, 'branchName'),
    }),
    [rows, columnOptions],
  )

  async function afterSave(message: string) {
    setDialog(null)
    notify.success(message)
    await load()
  }

  async function handleToggleStatus(row: CashBankAccountDto) {
    const activating = !row.isActive
    const go = await confirm({
      title: activating ? 'Activate account' : 'Deactivate account',
      message: activating
        ? `Activate ${row.accountCode} - ${row.accountName}?`
        : `Deactivate ${row.accountCode} - ${row.accountName}? It will no longer be offered on a new receipt line.`,
      confirmLabel: activating ? 'Activate' : 'Deactivate',
    })
    if (!go) return
    try {
      await cashBankAccountsApi.setActive(row.id, activating, row.rowVersion)
      await afterSave(activating ? 'Account activated.' : 'Account deactivated.')
    } catch (err) {
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The account could not be updated.')
      if (err instanceof ApiError && err.code === 'CONCURRENCY') await load()
    }
  }

  async function handleDelete(row: CashBankAccountDto) {
    const go = await confirm({
      title: 'Delete account',
      message: `Delete account ${row.accountCode} - ${row.accountName}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!go) return
    try {
      await cashBankAccountsApi.remove(row.id)
      await afterSave('Account deleted successfully.')
    } catch (err) {
      // IN_USE included: the server's sentence already says to deactivate it instead.
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The account could not be deleted.')
    }
  }

  const columns: DataTableColumn<CashBankAccountDto>[] = [
    rowNumberColumn<CashBankAccountDto>(grid.page, grid.pageSize),
    {
      accessor: 'accountCode',
      title: 'Account Code',
      sortable: true,
      width: 150,
      ...columnFilter({ ...columnFilters.bind('accountCode'), label: 'Account Code', options: values.accountCode }),
      render: (row) => <Text fw={600} fz="sm">{row.accountCode}</Text>,
    },
    {
      accessor: 'accountName',
      title: 'Account Name',
      sortable: true,
      ...columnFilter({ ...columnFilters.bind('accountName'), label: 'Account Name', options: values.accountName }),
    },
    {
      accessor: 'accountType',
      title: 'Type',
      sortable: true,
      width: 110,
      ...columnFilter({ ...columnFilters.bind('accountType'), label: 'Type', options: TYPE_VALUES, withText: false }),
      render: (row) => (
        <Badge variant="light" color={row.accountType === 'Bank' ? 'blue' : 'gray'}>
          {row.accountType}
        </Badge>
      ),
    },
    {
      accessor: 'currencyCode',
      title: 'Currency',
      sortable: true,
      width: 110,
      ...columnFilter({ ...columnFilters.bind('currencyCode'), label: 'Currency', options: values.currencyCode, withText: false }),
    },
    {
      accessor: 'branchName',
      title: 'Branch',
      sortable: true,
      width: 180,
      ...columnFilter({ ...columnFilters.bind('branchName'), label: 'Branch', options: values.branchName, withText: false }),
      render: (row) => (row.branchName ? <Text fz="sm">{row.branchName}</Text> : <Text c="dimmed" fz="sm">{ALL_BRANCHES}</Text>),
    },
    {
      accessor: 'isActive',
      title: 'Status',
      sortable: true,
      width: 120,
      ...columnFilter({ ...columnFilters.bind('isActive'), label: 'Status', options: STATUS_VALUES, withText: false }),
      render: (row) => <StatusBadge active={row.isActive} />,
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 130,
      textAlign: 'right',
      render: (row) => (
        <RowActions
          label={row.accountCode}
          edit={{ visible: canManage, onClick: () => setDialog({ kind: 'edit', account: row }) }}
          toggleStatus={{ visible: canManage, active: row.isActive, onClick: () => void handleToggleStatus(row) }}
          remove={{
            visible: canManage,
            disabled: row.usedCount > 0,
            disabledReason: `Used by ${formatNumber(row.usedCount)} receipt line(s) - deactivate instead`,
            onClick: () => void handleDelete(row),
          }}
        />
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Cash / Bank Accounts"
        subtitle="Where received money goes. Each account holds one currency."
        actions={
          canManage ? (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setDialog({ kind: 'create' })}>
              New Account
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <FilterBar.Col span={4}>
          <TextInput
            placeholder="Account code or name"
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
          <Select label="Type" placeholder="All" data={CASH_BANK_ACCOUNT_TYPES} value={filters.accountType} onChange={(value) => setFilter('accountType', value)} clearable />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select label="Status" placeholder="All" data={STATUS_OPTIONS} value={filters.isActive} onChange={(value) => setFilter('isActive', value)} clearable />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Button variant="default" leftSection={<IconFilterOff size={16} />} onClick={grid.clearFilters} disabled={grid.isDefault}>
            Clear Filters
          </Button>
        </FilterBar.Col>
      </FilterBar>

      {error ? (
        <Alert color="red" mb="md" title="Could not load accounts">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        <DataTable<CashBankAccountDto>
          storeKey="masterdata.cashBankAccounts"
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
          onRowActivate={canManage ? ({ record }) => setDialog({ kind: 'edit', account: record }) : undefined}
          noRecordsText={
            grid.isDefault ? 'No cash / bank accounts yet.' : 'No accounts found. Try clearing the filters.'
          }
        />
      </Paper>

      {dialog ? (
        <CashBankAccountFormModal
          mode={dialog.kind}
          account={dialog.kind === 'edit' ? dialog.account : undefined}
          onClose={() => setDialog(null)}
          onSaved={() =>
            void afterSave(dialog.kind === 'create' ? 'Account created successfully.' : 'Account updated successfully.')
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
