import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Paper, Select, SimpleGrid, Text } from '@mantine/core'
import { IconFileExport } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import {
  inventoryValuationApi,
  type InventoryValuationResult,
  type InventoryValuationRowDto,
} from '../../api/inventory/valuation'
import { warehousesApi } from '../../api/masterdata/warehouses'
import type { WarehouseLookupDto } from '../../api/types'
import { money } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { useGridQuery } from '../../hooks/useGridQuery'
import { warehouseLabel } from './lookups'

/** No warehouse is the company-wide view - what the API means by sending no warehouseId. */
interface Filters {
  warehouseId: string | null
}

const NO_FILTERS: Filters = { warehouseId: null }

const NO_ROWS: InventoryValuationRowDto[] = []

/** Sorts on whatever column was clicked: numbers numerically, codes and names as text. */
function compareRows(a: InventoryValuationRowDto, b: InventoryValuationRowDto, key: keyof InventoryValuationRowDto): number {
  const left = a[key]
  const right = b[key]
  if (typeof left === 'number' || typeof right === 'number') {
    return (typeof left === 'number' ? left : 0) - (typeof right === 'number' ? right : 0)
  }
  return String(left ?? '').localeCompare(String(right ?? ''))
}

/**
 * What the stock is worth: on hand × the item's moving average cost.
 *
 * The endpoint answers with one flat list and its own totals, so the page sorts and pages the rows
 * itself and shows the server's figures rather than re-adding them: the reader's page of fifty rows
 * is not what the warehouse is worth.
 */
export function StockValuationPage() {
  const [warehouses, setWarehouses] = useState<WarehouseLookupDto[]>([])

  const grid = useGridQuery<Filters, InventoryValuationRowDto, InventoryValuationResult>({
    initialFilters: NO_FILTERS,
    initialSort: { columnAccessor: 'inventoryValue', direction: 'desc' },
    // One flat list: turning a page or re-sorting must not ask the server for rows it already sent.
    paging: 'client',
    errorMessage: 'The stock valuation could not be loaded.',
    fetcher: useCallback(
      ({ filters: applied, signal }) =>
        inventoryValuationApi.get(applied.warehouseId === null ? undefined : Number(applied.warehouseId), signal),
      [],
    ),
  })

  const { filters, setFilter, data, loading, error } = grid
  const rows = data?.items ?? NO_ROWS

  useEffect(() => {
    // Inactive warehouses are offered too: stock sitting in one still has to be valued.
    warehousesApi.lookup(false).then(setWarehouses).catch(() => {})
  }, [])

  const sortKey = grid.sortStatus.columnAccessor as keyof InventoryValuationRowDto
  const sortDirection = grid.sortStatus.direction

  const sorted = useMemo(() => {
    const ordered = [...rows].sort((a, b) => compareRows(a, b, sortKey))
    if (sortDirection === 'desc') ordered.reverse()
    return ordered
  }, [rows, sortKey, sortDirection])

  const records = sorted.slice((grid.page - 1) * grid.pageSize, grid.page * grid.pageSize)

  async function exportToExcel() {
    try {
      await inventoryValuationApi.exportToExcel(filters.warehouseId === null ? undefined : Number(filters.warehouseId))
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The stock valuation could not be exported.')
    }
  }

  const columns: DataTableColumn<InventoryValuationRowDto>[] = [
    { accessor: 'itemCode', title: 'Item Code', sortable: true, width: 140 },
    {
      accessor: 'itemName',
      title: 'Item',
      sortable: true,
      render: (row) => (
        <Text fz="sm" fw={500}>
          {row.itemName}
        </Text>
      ),
    },
    // The company-wide view is the same quantities added across warehouses, so the API sends no
    // warehouse on those rows - a column of dashes is worse than no column.
    ...(filters.warehouseId !== null
      ? [
          {
            accessor: 'warehouseName',
            title: 'Warehouse',
            sortable: true,
            width: 200,
            render: (row: InventoryValuationRowDto) =>
              row.warehouseName === null ? '—' : `${row.warehouseCode ?? ''} - ${row.warehouseName}`,
          } satisfies DataTableColumn<InventoryValuationRowDto>,
        ]
      : []),
    {
      accessor: 'onHandBase',
      title: 'On Hand',
      sortable: true,
      width: 110,
      textAlign: 'right',
      render: (row) => (
        <Text fz="sm" c={row.onHandBase > 0 ? undefined : 'dimmed'}>
          {formatNumber(row.onHandBase)}
        </Text>
      ),
    },
    {
      accessor: 'averageCost',
      title: 'Average Cost (USD)',
      sortable: true,
      width: 150,
      textAlign: 'right',
      render: (row) => (
        <Text fz="sm" c={row.averageCost === null ? 'dimmed' : undefined}>
          {row.averageCost === null ? '—' : formatNumber(row.averageCost, 2)}
        </Text>
      ),
    },
    {
      accessor: 'inventoryValue',
      title: 'Inventory Value (USD)',
      sortable: true,
      width: 170,
      textAlign: 'right',
      render: (row) => (
        <Text fz="sm" fw={500}>
          {formatNumber(row.inventoryValue, 2)}
        </Text>
      ),
    },
  ]

  const stat = (label: string, value: string, hint: string) => (
    <Paper radius="lg" p="md" withBorder>
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text fw={700} fz="lg">
        {value}
      </Text>
      <Text size="xs" c="dimmed">
        {hint}
      </Text>
    </Paper>
  )

  return (
    <div>
      <PageHeader
        title="Stock Valuation"
        subtitle="What the stock on hand is worth: on hand × the item's moving average cost."
        actions={
          <Button variant="default" leftSection={<IconFileExport size={16} />} onClick={() => void exportToExcel()}>
            Export to Excel
          </Button>
        }
      />

      <FilterBar>
        <FilterBar.Col span={4}>
          <Select
            label="Warehouse"
            placeholder="All warehouses"
            data={warehouses.map((w) => ({ value: String(w.id), label: warehouseLabel(w) }))}
            value={filters.warehouseId}
            onChange={(next) => setFilter('warehouseId', next)}
            clearable
            searchable
          />
        </FilterBar.Col>
      </FilterBar>

      {error && (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md" mb="md">
        {stat('Items with stock', formatNumber(data?.itemsWithStock), 'a zero-stock item is listed but is not a line of inventory')}
        {stat('Total on hand', formatNumber(data?.totalOnHandBase), 'base units')}
        {/* Dashes rather than a zero until the figures are in: "0.00 USD" reads as an answer. */}
        {stat('Total inventory value', data ? money(data.totalInventoryValue) : '—', data?.warehouseName ?? 'all warehouses')}
      </SimpleGrid>

      <Paper radius="lg" withBorder>
        <DataTable
          records={records}
          columns={columns}
          idAccessor="itemId"
          totalRecords={rows.length}
          page={grid.page}
          recordsPerPage={grid.pageSize}
          onPageChange={grid.setPage}
          onRecordsPerPageChange={grid.setPageSize}
          sortStatus={grid.sortStatus}
          onSortStatusChange={grid.setSortStatus}
          fetching={loading}
          noRecordsText="No stock to value."
        />
      </Paper>
    </div>
  )
}
