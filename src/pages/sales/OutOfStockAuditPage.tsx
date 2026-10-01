import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Alert, Anchor, Badge, Paper, Select, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconSearch } from '@tabler/icons-react'
import { fetchAllPages, type AllRows } from '../../api/fetchAllPages'
import { warehousesApi } from '../../api/masterdata/warehouses'
import { outOfStockAuditApi, type OutOfStockAuditDto } from '../../api/sales/outOfStockAudit'
import type { WarehouseLookupDto } from '../../api/types'
import { isoDate } from '../../components/documents/documentKind'
import { formatDateTime, formatNumber } from '../../components/format'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
import { PageHeader } from '../../components/ui/PageHeader'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { useGridQuery } from '../../hooks/useGridQuery'

interface Filters {
  search: string
  warehouseId: string | null
  dateFrom: string | null
  dateTo: string | null
}

const NO_FILTERS: Filters = { search: '', warehouseId: null, dateFrom: null, dateTo: null }

/**
 * What each column IS, for the grid engine. Quantities are in base units (pieces) and add up: the footer
 * says how many pieces were sold below zero in all. "Stock after" is a balance, so it has no total.
 */
const GRID_COLUMNS: GridColumnMeta<OutOfStockAuditDto>[] = [
  { accessor: 'soldAtUtc', kind: 'date', text: (r) => formatDateTime(r.soldAtUtc), summary: 'count' },
  { accessor: 'documentNumber' },
  { accessor: 'itemCode', text: (r) => `${r.itemCode} - ${r.itemName}` },
  { accessor: 'warehouseName', kind: 'list', text: (r) => `${r.warehouseName} (${r.warehouseCode})` },
  { accessor: 'quantitySold', kind: 'number', summary: 'sum' },
  { accessor: 'stockBefore', kind: 'number' },
  { accessor: 'inventoryAfter', kind: 'number' },
  { accessor: 'policySource', kind: 'list', text: (r) => (r.policySource === 'Warehouse' ? 'Warehouse setting' : 'Global setting') },
  { accessor: 'userName', kind: 'list', text: (r) => r.userName ?? '' },
  { accessor: 'invoiceStatus', kind: 'list' },
]

/**
 * Every sale a user confirmed below zero stock: what was sold, from which warehouse, how far below zero
 * it went, who confirmed it and which setting allowed it. Read-only - the rows are written by the
 * invoice post, in the same transaction as the sale, and are never edited.
 *
 * A CANCELLED INVOICE KEEPS ITS ROW. The sale was confirmed and then undone, and a reader asking "who
 * allowed this?" wants to see both facts, so the invoice's status is a column rather than a reason to hide.
 */
export function OutOfStockAuditPage() {
  const navigate = useNavigate()
  const [warehouses, setWarehouses] = useState<WarehouseLookupDto[]>([])

  const grid = useGridQuery<Filters, OutOfStockAuditDto, AllRows<OutOfStockAuditDto>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'soldAtUtc', direction: 'desc' },
    // The log is loaded whole (newest first, up to the grid's cap) and the grid does the rest.
    paging: 'client',
    errorMessage: 'The out-of-stock log could not be loaded.',
    fetcher: useCallback(
      ({ filters, signal }) =>
        fetchAllPages((page, pageSize) =>
          outOfStockAuditApi.list(
            {
              search: filters.search.trim() || undefined,
              warehouseId: filters.warehouseId === null ? undefined : Number(filters.warehouseId),
              dateFrom: filters.dateFrom ?? undefined,
              dateTo: filters.dateTo ?? undefined,
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

  const engine = useDataGrid({
    rows,
    columns: GRID_COLUMNS,
    storeKey: 'sales.outOfStockAudit',
    sort: [{ accessor: 'soldAtUtc', direction: 'desc' }],
  })

  useEffect(() => {
    warehousesApi.lookup(false).then(setWarehouses).catch(() => {})
  }, [])

  const columns: DataTableColumn<OutOfStockAuditDto>[] = [
    rowNumberColumn<OutOfStockAuditDto>(engine.page, engine.pageSize),
    {
      accessor: 'soldAtUtc',
      title: 'Date / time',
      width: 170,
      render: (r) => formatDateTime(r.soldAtUtc),
    },
    {
      accessor: 'documentNumber',
      title: 'Invoice',
      width: 170,
      render: (r) => (
        <Anchor component={Link} to={`/sales/invoices/${r.salesDocumentId}`} fz="sm" fw={600} onClick={(event) => event.stopPropagation()}>
          {r.documentNumber}
        </Anchor>
      ),
    },
    {
      accessor: 'itemCode',
      title: 'Item',
      render: (r) => (
        <div>
          <Text fz="sm" fw={600} lineClamp={1}>
            {r.itemName}
          </Text>
          <Text fz="xs" c="dimmed">
            {r.itemCode}
          </Text>
        </div>
      ),
    },
    {
      accessor: 'warehouseName',
      title: 'Warehouse',
      width: 170,
      render: (r) => (
        <Text fz="sm" title={r.warehouseCode}>
          {r.warehouseName}
        </Text>
      ),
    },
    {
      accessor: 'quantitySold',
      title: 'Qty sold',
      width: 100,
      textAlign: 'right',
      render: (r) => formatNumber(r.quantitySold),
    },
    {
      accessor: 'stockBefore',
      title: 'Stock before',
      width: 110,
      textAlign: 'right',
      render: (r) => formatNumber(r.stockBefore),
    },
    {
      accessor: 'inventoryAfter',
      title: 'Stock after',
      width: 110,
      textAlign: 'right',
      render: (r) => (
        <Text fz="sm" fw={600} c={r.inventoryAfter < 0 ? 'red' : undefined}>
          {formatNumber(r.inventoryAfter)}
        </Text>
      ),
    },
    {
      accessor: 'policySource',
      title: 'Allowed by',
      width: 150,
      render: (r) => (
        <Badge variant="light" color={r.policySource === 'Warehouse' ? 'violet' : 'blue'}>
          {r.policySource === 'Warehouse' ? 'Warehouse setting' : 'Global setting'}
        </Badge>
      ),
    },
    {
      accessor: 'userName',
      title: 'Confirmed by',
      width: 160,
      render: (r) => r.userName ?? '-',
    },
    {
      accessor: 'invoiceStatus',
      title: 'Invoice status',
      width: 130,
      render: (r) => (
        <Badge variant="light" color={r.invoiceStatus === 'Cancelled' ? 'gray' : 'green'}>
          {r.invoiceStatus}
        </Badge>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Out-of-Stock Sales"
        subtitle="Every sale confirmed below zero stock: what was sold, from where, who confirmed it and which setting allowed it."
      />

      <FilterBar>
        <FilterBar.Col span={4}>
          <TextInput
            label="Search"
            placeholder="Item code, item name or invoice number"
            leftSection={<IconSearch size={16} />}
            value={filters.search}
            onChange={(event) => setFilter('search', event.currentTarget.value)}
          />
        </FilterBar.Col>
        <FilterBar.Col span={4}>
          <Select
            label="Warehouse"
            placeholder="All warehouses"
            data={warehouses.map((w) => ({ value: String(w.id), label: `${w.warehouseName} (${w.warehouseCode})` }))}
            value={filters.warehouseId}
            onChange={(next) => setFilter('warehouseId', next)}
            clearable
            searchable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput
            label="From"
            placeholder="Any"
            valueFormat="DD/MM/YYYY"
            value={filters.dateFrom ? new Date(filters.dateFrom) : null}
            onChange={(next) => setFilter('dateFrom', next ? isoDate(new Date(next)) : null)}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput
            label="To"
            placeholder="Any"
            valueFormat="DD/MM/YYYY"
            value={filters.dateTo ? new Date(filters.dateTo) : null}
            onChange={(next) => setFilter('dateTo', next ? isoDate(new Date(next)) : null)}
            clearable
          />
        </FilterBar.Col>
      </FilterBar>

      {error && (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      )}

      {data?.truncated ? (
        <Alert color="yellow" mb="md" title="Showing the newest rows only">
          There are more entries than the grid loads at once. Narrow the list with the filters above (dates, warehouse) to see the rest.
        </Alert>
      ) : null}

      <Paper radius="lg" withBorder>
        <DataTable
          storeKey="sales.outOfStockAudit"
          engine={engine}
          exportFileName="out-of-stock-sales"
          columns={columns}
          fetching={loading}
          noRecordsText="No out-of-stock sales have been confirmed."
          onRowClick={({ record }) => void navigate(`/sales/invoices/${record.salesDocumentId}`)}
        />
      </Paper>
    </div>
  )
}
