import { useCallback, useMemo, useState } from 'react'
import { Alert, Button, Paper, Select, Text, TextInput } from '@mantine/core'
import { IconFilterOff, IconPlus, IconSearch } from '@tabler/icons-react'
import { fetchAllPages, type AllRows } from '../../api/fetchAllPages'
import { ApiError } from '../../api/http'
import { paymentMethodsApi, type PaymentMethodDto } from '../../api/masterdata/paymentMethods'
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
import { PaymentMethodFormModal } from './PaymentMethodFormModal'

interface Filters {
  search: string
  isActive: string | null
}

const NO_FILTERS: Filters = { search: '', isActive: null }

/** An empty description reads as a dash, and its funnel has to match the dash the reader sees. */
const DASH = '—'

/**
 * What each column IS, for the grid engine: its kind (so a number compares as a number and a date
 * as a date), and what it shows. How a cell LOOKS stays in the column definitions below.
 */
const GRID_COLUMNS: GridColumnMeta<PaymentMethodDto>[] = [
  { accessor: 'methodCode', summary: 'count' },
  { accessor: 'methodName' },
  { accessor: 'description', text: (r) => r.description ?? DASH },
  { accessor: 'isActive', kind: 'boolean', text: (r) => (r.isActive ? 'Active' : 'Inactive') },
]

type Dialog = { kind: 'create' } | { kind: 'edit'; paymentMethod: PaymentMethodDto } | null

/**
 * The payment methods a customer receipt line is paid by. They are rows like any other: Cash, Bank
 * Transfer and Cheque are only what the system starts with.
 */
export function PaymentMethodsPage() {
  const { hasPermission } = useAuth()
  const [dialog, setDialog] = useState<Dialog>(null)
  const canManage = hasPermission(PERMISSIONS.paymentMethodsManage)

  const grid = useGridQuery<Filters, PaymentMethodDto, AllRows<PaymentMethodDto>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'methodCode', direction: 'asc' },
    // The whole table comes back in one go, so turning a page or re-sorting must not ask again.
    paging: 'client',
    errorMessage: 'The payment methods could not be loaded.',
    fetcher: useCallback(
      ({ filters, signal }) =>
        fetchAllPages((page, pageSize) =>
          paymentMethodsApi.list(
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

  /* THE ENGINE HOLDS THE WHOLE TABLE AND ANSWERS FOR EVERY COLUMN: typed filters, multi-column sort,
     paging, footer totals over all the filtered rows, CSV. The bar above the grid still narrows what
     is loaded from the server; the column filters then narrow what was loaded. */
  const engine = useDataGrid({
    rows,
    columns: GRID_COLUMNS,
    storeKey: 'masterdata.paymentMethods',
    sort: [{ accessor: 'methodCode', direction: 'asc' }],
  })

  // A filter that leaves three rows must not strand the reader on page 4 of the old result.

  async function afterSave(message: string) {
    setDialog(null)
    notify.success(message)
    await load()
  }

  async function handleToggleStatus(row: PaymentMethodDto) {
    const activating = !row.isActive
    const go = await confirm({
      title: activating ? 'Activate payment method' : 'Deactivate payment method',
      message: activating
        ? `Activate ${row.methodCode} - ${row.methodName}?`
        : `Deactivate ${row.methodCode} - ${row.methodName}? It will no longer be offered on a new receipt line.`,
      confirmLabel: activating ? 'Activate' : 'Deactivate',
    })
    if (!go) return
    try {
      await paymentMethodsApi.setActive(row.id, activating, row.rowVersion)
      await afterSave(activating ? 'Payment method activated.' : 'Payment method deactivated.')
    } catch (err) {
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The payment method could not be updated.')
      if (err instanceof ApiError && err.code === 'CONCURRENCY') await load()
    }
  }

  async function handleDelete(row: PaymentMethodDto) {
    const go = await confirm({
      title: 'Delete payment method',
      message: `Delete payment method ${row.methodCode} - ${row.methodName}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!go) return
    try {
      await paymentMethodsApi.remove(row.id)
      await afterSave('Payment method deleted successfully.')
    } catch (err) {
      // IN_USE included: the server's sentence already says to deactivate it instead.
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The payment method could not be deleted.')
    }
  }

  const columns: DataTableColumn<PaymentMethodDto>[] = [
    rowNumberColumn<PaymentMethodDto>(engine.page, engine.pageSize),
    {
      accessor: 'methodCode',
      title: 'Method Code',
      width: 140,
      render: (row) => <Text fw={600} fz="sm">{row.methodCode}</Text>,
    },
    {
      accessor: 'methodName',
      title: 'Method Name',
    },
    {
      accessor: 'description',
      title: 'Description',
      render: (row) => (row.description ? <Text fz="sm">{row.description}</Text> : <Text c="dimmed">{DASH}</Text>),
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
          label={row.methodCode}
          edit={{ visible: canManage, onClick: () => setDialog({ kind: 'edit', paymentMethod: row }) }}
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
        title="Payment Methods"
        subtitle="The ways a customer pays: cash, transfer, cheque and so on."
        actions={
          canManage ? (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setDialog({ kind: 'create' })}>
              New Payment Method
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <FilterBar.Col span={6}>
          <TextInput
            placeholder="Method code or name"
            leftSection={<IconSearch size={16} />}
            label="Search"
            value={filters.search}
            onChange={(e) => setFilter('search', e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') grid.commitFilters()
            }}
          />
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
        <Alert color="red" mb="md" title="Could not load payment methods">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        <DataTable<PaymentMethodDto>
          storeKey="masterdata.paymentMethods"
          engine={engine}
          exportFileName="payment-methods"
          columns={columns}
          fetching={loading}
          onRowActivate={canManage ? ({ record }) => setDialog({ kind: 'edit', paymentMethod: record }) : undefined}
          noRecordsText={
            grid.isDefault ? 'No payment methods yet.' : 'No payment methods found. Try clearing the filters.'
          }
        />
      </Paper>

      {dialog ? (
        <PaymentMethodFormModal
          mode={dialog.kind}
          paymentMethod={dialog.kind === 'edit' ? dialog.paymentMethod : undefined}
          onClose={() => setDialog(null)}
          onSaved={() =>
            void afterSave(dialog.kind === 'create' ? 'Payment method created successfully.' : 'Payment method updated successfully.')
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
