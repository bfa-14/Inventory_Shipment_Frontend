import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Paper, Select, Text, TextInput } from '@mantine/core'
import { IconFilterOff, IconPlus, IconRefresh, IconSearch, IconTableExport } from '@tabler/icons-react'
import { fetchAllPages, type AllRows } from '../../api/fetchAllPages'
import { ApiError } from '../../api/http'
import { currenciesApi } from '../../api/masterdata/currencies'
import { priceListsApi } from '../../api/masterdata/priceLists'
import type { CurrencyLookupDto, PriceListDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { currencyLabel } from '../../components/format'
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
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'
import { PriceListFormModal } from './PriceListFormModal'

/** The filters the reader edits. Paging and sorting are the grid's own, held by useGridQuery. */
interface Filters {
  search: string
  currencyId: string | null
  isActive: string | null
}

const NO_FILTERS: Filters = { search: '', currencyId: null, isActive: null }

type Dialog = { kind: 'create' } | { kind: 'edit'; priceList: PriceListDto } | null

/** "USD - US Dollar", as the grid prints a price list's currency. */
function priceListCurrency(priceList: PriceListDto): string {
  return `${priceList.currencyCode} - ${priceList.currencyName}`
}

export function PriceListsPage() {
  const { hasPermission } = useAuth()

  const [currencies, setCurrencies] = useState<CurrencyLookupDto[]>([])
  const [dialog, setDialog] = useState<Dialog>(null)

  const canCreate = hasPermission(PERMISSIONS.priceListsCreate)
  const canEdit = hasPermission(PERMISSIONS.priceListsEdit)
  const canDelete = hasPermission(PERMISSIONS.priceListsDelete)

  /**
   * The grid's whole query. No Apply button: the search box settles 350ms after the last keystroke,
   * every other control lands at once, and the hook guarantees one request per settled state with
   * the newest one winning.
   *
   * The filter bar and the column funnels are two ways into the SAME filter, and both go through
   * `setFilter`, so a header reading "Active" over a bar reading "All" is not a state that exists.
   */
  const grid = useGridQuery<Filters, PriceListDto, AllRows<PriceListDto>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'priceListCode', direction: 'asc' },
    // The whole table comes back in one go, so turning a page or re-sorting must not ask again.
    paging: 'client',
    errorMessage: 'The price lists could not be loaded.',
    fetcher: useCallback(
      ({ filters, signal }) =>
        fetchAllPages((page, pageSize) =>
          priceListsApi.search(
            {
              search: filters.search.trim() || undefined,
              currencyId: filters.currencyId === null ? undefined : Number(filters.currencyId),
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
    storeKey: 'masterdata.priceLists',
    sort: [{ accessor: 'priceListCode', direction: 'asc' }],
  })

  // A filter that leaves three rows must not strand the reader on page 4 of the old result.

  // Every currency, including inactive ones, so lists priced in a deactivated currency can still
  // be filtered out of the grid.
  useEffect(() => {
    currenciesApi
      .lookup(false)
      .then(setCurrencies)
      .catch(() => {
        // Not fatal: the filter simply offers no currencies until the next reload.
      })
  }, [])

  function exportCsv() {
    downloadCsv(
      'price-lists.csv',
      ['Price List Code', 'Price List Name', 'Currency', 'Prices', 'Description', 'Status'],
      // What the reader is looking at, funnels and all - not the whole table behind them.
      engine.rows.map((p) => [
        p.priceListCode,
        p.priceListName,
        priceListCurrency(p),
        String(p.priceCount),
        p.description ?? '',
        p.isActive ? 'Active' : 'Inactive',
      ]),
    )
  }

  async function afterSave(message: string) {
    setDialog(null)
    notify.success(message)
    await load()
  }

  async function handleDelete(priceList: PriceListDto) {
    const confirmed = await confirm({
      title: 'Delete price list',
      message: `Delete price list ${priceList.priceListCode} - ${priceList.priceListName}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!confirmed) return

    try {
      await priceListsApi.remove(priceList.id)
      await afterSave('Price list deleted successfully.')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REFERENCED') {
        const deactivate = await confirm({
          title: 'Price list cannot be deleted',
          message:
            'This price list cannot be deleted because it contains prices or is referenced. You may deactivate it instead.',
          confirmLabel: 'Deactivate instead',
        })
        if (deactivate) await setStatus(priceList, false)
        return
      }
      notify.error(
        err instanceof ApiError ? (err.messages[0] as string) : 'The price list could not be deleted.',
      )
    }
  }

  async function setStatus(priceList: PriceListDto, isActive: boolean) {
    try {
      await priceListsApi.setStatus(priceList.id, isActive)
      await afterSave(isActive ? 'Price list activated.' : 'Price list deactivated.')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONCURRENCY') {
        notify.error(err.messages[0] as string)
        await load()
        return
      }
      notify.error(
        err instanceof ApiError ? (err.messages[0] as string) : 'The price list could not be updated.',
      )
    }
  }

  async function handleToggleStatus(priceList: PriceListDto) {
    const activating = !priceList.isActive
    const confirmed = await confirm({
      title: activating ? 'Activate price list' : 'Deactivate price list',
      message: activating
        ? `Activate ${priceList.priceListCode} - ${priceList.priceListName}?`
        : `Deactivate ${priceList.priceListCode} - ${priceList.priceListName}? It will no longer be selectable.`,
      confirmLabel: activating ? 'Activate' : 'Deactivate',
    })
    if (confirmed) await setStatus(priceList, activating)
  }

  const columns: DataTableColumn<PriceListDto>[] = [
    rowNumberColumn<PriceListDto>(engine.page, engine.pageSize),
    {
      accessor: 'priceListCode',
      title: 'Price List Code',
      width: 170,
      render: (p) => (
        <Text fz="sm" fw={600}>
          {p.priceListCode}
        </Text>
      ),
    },
    {
      accessor: 'priceListName',
      title: 'Price List Name',
    },
    {
      accessor: 'currencyCode',
      title: 'Currency',
      width: 220,
      render: (p) => <Text fz="sm">{priceListCurrency(p)}</Text>,
    },
    {
      accessor: 'isActive',
      title: 'Status',
      width: 150,
      render: (p) => <StatusBadge active={p.isActive} />,
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 130,
      textAlign: 'right',
      // Delete stays enabled on a list that holds prices: the API answers REFERENCED and the reader
      // is then offered "Deactivate instead", which is the way out of that dead end.
      render: (priceList) => (
        <RowActions
          label={priceList.priceListCode}
          edit={{ visible: canEdit, onClick: () => setDialog({ kind: 'edit', priceList }) }}
          toggleStatus={{
            visible: canEdit,
            active: priceList.isActive,
            onClick: () => void handleToggleStatus(priceList),
          }}
          remove={{ visible: canDelete, onClick: () => void handleDelete(priceList) }}
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
        title="Price Lists"
        subtitle="View and manage price lists."
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
                New Price List
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar>
        <FilterBar.Col span={5}>
          <TextInput
            placeholder="Search by price list code or name..."
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

        <FilterBar.Col span={3}>
          <Select
            label="Currency"
            placeholder="All"
            searchable
            clearable
            nothingFoundMessage="No currency found"
            data={currencies.map((c) => ({ value: String(c.id), label: currencyLabel(c) }))}
            value={filters.currencyId}
            onChange={(value) => setFilter('currencyId', value)}
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
        <Alert color="red" mb="md" title="Could not load price lists">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        <DataTable<PriceListDto>
          storeKey="masterdata.priceLists"
          engine={engine}
          exportFileName="price-lists"
          columns={columns}
          fetching={loading}
          noRecordsText={
            filtered
              ? 'No price lists found. Try clearing the filters to see every price list.'
              : 'No price lists found.'
          }
        />
      </Paper>

      {dialog ? (
        <PriceListFormModal
          mode={dialog.kind}
          priceList={dialog.kind === 'edit' ? dialog.priceList : undefined}
          onClose={() => setDialog(null)}
          onSaved={() =>
            void afterSave(
              dialog.kind === 'create' ? 'Price list created successfully.' : 'Price list updated successfully.',
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

/**
 * What each column IS, for the grid engine: its kind (so a number compares as a number and a date
 * as a date), and what it shows. How a cell LOOKS stays in the column definitions below.
 */
const GRID_COLUMNS: GridColumnMeta<PriceListDto>[] = [
  { accessor: 'priceListCode', summary: 'count' },
  { accessor: 'priceListName' },
  { accessor: 'currencyCode', text: priceListCurrency },
  { accessor: 'isActive', kind: 'boolean', text: (p) => (p.isActive ? 'Active' : 'Inactive') },
]

