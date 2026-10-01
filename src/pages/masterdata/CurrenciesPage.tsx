import { useCallback, useMemo, useState } from 'react'
import { Alert, Badge, Button, Paper, Select, TextInput } from '@mantine/core'
import { IconFilterOff, IconPlus, IconRefresh, IconSearch, IconTableExport } from '@tabler/icons-react'
import { fetchAllPages, type AllRows } from '../../api/fetchAllPages'
import { ApiError } from '../../api/http'
import { currenciesApi } from '../../api/masterdata/currencies'
import type { CurrencyDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { formatDateTime } from '../../components/format'
import { downloadCsv } from '../../components/masterdata/csv'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
import { MoreActionsMenu } from '../../components/ui/MoreActionsMenu'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'
import { CurrencyFormModal } from './CurrencyFormModal'

/** The filters the reader edits. Paging and sorting are the grid's own, held by useGridQuery. */
interface Filters {
  search: string
  isActive: string | null
  isBaseCurrency: string | null
}

const NO_FILTERS: Filters = { search: '', isActive: null, isBaseCurrency: null }

type Dialog = { kind: 'create' } | { kind: 'edit'; currency: CurrencyDto } | null

export function CurrenciesPage() {
  const { hasPermission } = useAuth()
  const [dialog, setDialog] = useState<Dialog>(null)

  const canCreate = hasPermission(PERMISSIONS.currenciesCreate)
  const canEdit = hasPermission(PERMISSIONS.currenciesEdit)
  const canDelete = hasPermission(PERMISSIONS.currenciesDelete)

  /**
   * The grid's whole query. No Apply button: the search box settles 350ms after the last keystroke,
   * every other control lands at once, and the hook guarantees one request per settled state with
   * the newest one winning.
   */
  const grid = useGridQuery<Filters, CurrencyDto, AllRows<CurrencyDto>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'currencyCode', direction: 'asc' },
    // The whole table comes back in one go, so turning a page or re-sorting must not ask again.
    paging: 'client',
    errorMessage: 'The currencies could not be loaded.',
    fetcher: useCallback(
      ({ filters, signal }) =>
        fetchAllPages((page, pageSize) =>
          currenciesApi.search(
            {
              search: filters.search.trim() || undefined,
              isActive: filters.isActive === null ? undefined : filters.isActive === 'true',
              isBaseCurrency: filters.isBaseCurrency === null ? undefined : filters.isBaseCurrency === 'true',
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

  /* THE ENGINE HOLDS THE WHOLE TABLE AND ANSWERS FOR EVERY COLUMN: typed filters, multi-column sort,
     paging, footer totals over all the filtered rows, CSV. The bar above the grid still narrows what
     is loaded from the server; the column filters then narrow what was loaded. */
  const engine = useDataGrid({
    rows,
    columns: GRID_COLUMNS,
    storeKey: 'masterdata.currencies',
    sort: [{ accessor: 'currencyCode', direction: 'asc' }],
  })

  // A filter that leaves three rows must not strand the reader on page 4 of the old result.
  const load = grid.reload

  function exportCsv() {
    downloadCsv(
      'currencies.csv',
      ['Code', 'Name', 'Symbol', 'Decimals', 'Base Currency', 'Status'],
      // What the reader is looking at, funnels and all - not the whole table behind them.
      engine.rows.map((c) => [
        c.currencyCode,
        c.currencyName,
        c.symbol ?? '',
        String(c.decimalPlaces),
        c.isBaseCurrency ? 'Yes' : 'No',
        c.isActive ? 'Active' : 'Inactive',
      ]),
    )
  }

  async function afterSave(message: string) {
    setDialog(null)
    notify.success(message)
    await load()
  }

  async function handleDelete(currency: CurrencyDto) {
    const confirmed = await confirm({
      title: 'Delete currency',
      message: `Delete ${currency.currencyCode} - ${currency.currencyName}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!confirmed) return

    try {
      await currenciesApi.remove(currency.id)
      await afterSave('Currency deleted successfully.')
    } catch (err) {
      // Exchange rates (and later prices, invoices...) point at the currency: offer the way out
      // the API itself suggests rather than a dead end.
      if (err instanceof ApiError && err.code === 'REFERENCED') {
        const deactivate = await confirm({
          title: 'Currency cannot be deleted',
          message: err.messages[0] as string,
          confirmLabel: 'Deactivate instead',
        })
        if (deactivate) await setStatus(currency, false)
        return
      }
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The currency could not be deleted.')
    }
  }

  async function setStatus(currency: CurrencyDto, isActive: boolean) {
    try {
      await currenciesApi.setStatus(currency.id, isActive)
      await afterSave(isActive ? 'Currency activated.' : 'Currency deactivated.')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONCURRENCY') {
        notify.error(err.messages.join(' '))
        await load()
        return
      }
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The currency could not be updated.')
    }
  }

  async function handleToggleStatus(currency: CurrencyDto) {
    const activating = !currency.isActive
    const confirmed = await confirm({
      title: activating ? 'Activate currency' : 'Deactivate currency',
      message: activating
        ? `Activate ${currency.currencyCode} - ${currency.currencyName}?`
        : `Deactivate ${currency.currencyCode} - ${currency.currencyName}? It will no longer be selectable and no new rates can be entered for it.`,
      confirmLabel: activating ? 'Activate' : 'Deactivate',
    })
    if (confirmed) await setStatus(currency, activating)
  }

  const columns: DataTableColumn<CurrencyDto>[] = [
    rowNumberColumn<CurrencyDto>(engine.page, engine.pageSize),
    /* Code, Name and Symbol carry no header filter: this grid pages on the server and the search
       endpoint takes one free-text parameter matching code OR name, so a per-column box here could
       only narrow by something other than the column it sits on. The search box in the filter bar
       is that parameter, under its own name. Decimals has no server filter at all. */
    {
      accessor: 'currencyCode',
      title: 'Code',
      width: 110,
    },
    {
      accessor: 'currencyName',
      title: 'Name',
    },
    {
      accessor: 'symbol',
      title: 'Symbol',
      width: 100,
      render: (c) => c.symbol ?? '-',
    },
    {
      accessor: 'decimalPlaces',
      title: 'Decimals',
      width: 120,
      textAlign: 'right',
    },
    {
      accessor: 'isBaseCurrency',
      title: 'Base',
      width: 130,
      render: (c) => (c.isBaseCurrency ? <Badge variant="light">Base</Badge> : '-'),
    },
    {
      accessor: 'isActive',
      title: 'Status',
      width: 140,
      render: (c) => <StatusBadge active={c.isActive} />,
    },
    {
      accessor: 'createdAtUtc',
      title: 'Created',
      width: 180,
      // No tick list: every row is a different instant, so the list would be one entry per row.
      render: (c) => formatDateTime(c.createdAtUtc),
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 130,
      textAlign: 'right',
      render: (currency) => (
        <RowActions
          label={currency.currencyCode}
          edit={{ visible: canEdit, onClick: () => setDialog({ kind: 'edit', currency }) }}
          toggleStatus={{
            visible: canEdit,
            active: currency.isActive,
            disabled: currency.isBaseCurrency && currency.isActive,
            disabledReason: 'The base currency cannot be deactivated',
            onClick: () => void handleToggleStatus(currency),
          }}
          remove={{
            visible: canDelete,
            disabled: currency.isBaseCurrency,
            disabledReason: 'The base currency cannot be deleted',
            onClick: () => void handleDelete(currency),
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
        title="Currencies"
        subtitle="View and manage the currencies amounts are recorded in."
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
                New Currency
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar>
        <FilterBar.Col span={5}>
          <TextInput
            placeholder="Search by currency code or name..."
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
            label="Base currency"
            placeholder="All"
            data={BASE_OPTIONS}
            value={filters.isBaseCurrency}
            onChange={(value) => setFilter('isBaseCurrency', value)}
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
        <Alert color="red" mb="md" title="Could not load currencies">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        <DataTable<CurrencyDto>
          storeKey="masterdata.currencies"
          engine={engine}
          exportFileName="currencies"
          columns={columns}
          fetching={loading}
          // Enter on the selected row does what its pencil does.
          onRowActivate={canEdit ? ({ record }) => setDialog({ kind: 'edit', currency: record }) : undefined}
          noRecordsText={
            filtered ? 'No currencies found. Try clearing the filters to see every currency.' : 'No currencies found.'
          }
        />
      </Paper>

      {dialog ? (
        <CurrencyFormModal
          mode={dialog.kind}
          currency={dialog.kind === 'edit' ? dialog.currency : undefined}
          onClose={() => setDialog(null)}
          onSaved={() =>
            void afterSave(
              dialog.kind === 'create' ? 'Currency created successfully.' : 'Currency updated successfully.',
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

const BASE_OPTIONS = [
  { value: 'true', label: 'Base only' },
  { value: 'false', label: 'Non-base' },
]

/**
 * What each column IS, for the grid engine: its kind (so a number compares as a number and a date
 * as a date), and what it shows. How a cell LOOKS stays in the column definitions below.
 */
const GRID_COLUMNS: GridColumnMeta<CurrencyDto>[] = [
  { accessor: 'currencyCode', summary: 'count' },
  { accessor: 'currencyName' },
  { accessor: 'symbol', text: (c) => c.symbol ?? '-' },
  { accessor: 'decimalPlaces', kind: 'number', text: (c) => String(c.decimalPlaces) },
  { accessor: 'isBaseCurrency', kind: 'boolean', text: (c) => (c.isBaseCurrency ? 'Base' : 'Not base') },
  { accessor: 'isActive', kind: 'boolean', text: (c) => (c.isActive ? 'Active' : 'Inactive') },
  { accessor: 'createdAtUtc', kind: 'date', text: (c) => formatDateTime(c.createdAtUtc) },
]

