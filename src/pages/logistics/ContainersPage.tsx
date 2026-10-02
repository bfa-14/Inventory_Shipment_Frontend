import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { routes } from '../../routes'
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Collapse,
  Group,
  Menu,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { DateInput, MonthPickerInput } from '@mantine/dates'
import {
  IconAdjustmentsHorizontal,
  IconBan,
  IconDots,
  IconEye,
  IconFileSpreadsheet,
  IconFilterOff,
  IconLock,
  IconPencil,
  IconPlus,
  IconPrinter,
  IconTableExport,
  IconTrash,
  IconTruckDelivery,
} from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { fetchAllPages, type AllRows } from '../../api/fetchAllPages'
import { itemsApi } from '../../api/inventory/items'
import {
  CONTAINER_STATUSES,
  containersApi,
  containerStatusColour,
  INVOICING_STATUSES,
  type ContainerListDto,
  type ContainerStatusCode,
} from '../../api/logistics/containers'
import { partiesApi } from '../../api/masterdata/parties'
import { portLabel, portsApi, type PortLookupDto } from '../../api/masterdata/ports'
import { purchaseDocumentsApi } from '../../api/purchase/documents'
import type { ItemLookupDto, PartyLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { CancelReasonModal } from '../../components/documents/CancelReasonModal'
import { ContainerSelectionBar } from '../../components/logistics/ContainerSelectionBar'
import { refreshSelection } from '../../components/logistics/containerSelection'
import { dateLabel, isoDate } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import { downloadCsv } from '../../components/masterdata/csv'
import { supplierLabel } from '../../components/purchase/purchaseKind'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
import { FilterBar } from '../../components/ui/FilterBar'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'

export const CONTAINERS_ROUTE = '/logistics/containers'

interface Filters {
  containerNo: string
  containerRef: string
  supplierId: string | null
  status: string | null
  /** 'YYYY-MM-01' of the picked month. */
  orderMonth: string | null
  // advanced
  purchaseOrderId: string | null
  purchaseDocumentId: string | null
  commercialInvoiceNo: string
  itemId: string | null
  blNo: string
  portId: string | null
  dateFrom: string | null
  dateTo: string | null
}

const NO_FILTERS: Filters = {
  containerNo: '',
  containerRef: '',
  supplierId: null,
  status: null,
  orderMonth: null,
  purchaseOrderId: null,
  purchaseDocumentId: null,
  commercialInvoiceNo: '',
  itemId: null,
  blNo: '',
  portId: null,
  dateFrom: null,
  dateTo: null,
}

const ADVANCED: (keyof Filters)[] = ['purchaseOrderId', 'purchaseDocumentId', 'commercialInvoiceNo', 'itemId', 'blNo', 'portId', 'dateFrom', 'dateTo']

/**
 * What each column IS, for the grid engine. The order month reads "Sep-2026" but SORTS and filters by
 * the order date behind it, so the months run in time and not in the alphabet.
 */
const GRID_COLUMNS: GridColumnMeta<ContainerListDto>[] = [
  { accessor: 'containerRef', summary: 'count' },
  { accessor: 'containerNo', text: (r) => r.containerNo ?? '' },
  { accessor: 'orderMonth', kind: 'date', value: (r) => r.orderDate, text: (r) => r.orderMonth },
  { accessor: 'orderNumbers', text: (r) => r.orderNumbers ?? '' },
  { accessor: 'supplierNames', text: (r) => r.supplierNames ?? '' },
  { accessor: 'invoiceNumbers', text: (r) => r.invoiceNumbers ?? '' },
  { accessor: 'commercialInvoiceNos', text: (r) => r.commercialInvoiceNos ?? '' },
  { accessor: 'invoicingStatus', kind: 'list', text: (r) => INVOICING_STATUSES[r.invoicingStatus]?.label ?? '' },
  { accessor: 'itemSummary', text: (r) => r.itemSummary ?? '' },
  { accessor: 'totalQtyBase', kind: 'number', summary: 'sum' },
  { accessor: 'chargesPostedBase', kind: 'number', summary: 'sum', text: (r) => formatNumber(r.chargesPostedBase, 2) },
  { accessor: 'currentMovementNo', text: (r) => r.currentMovementNo ?? '' },
  { accessor: 'blNo', text: (r) => r.blNo ?? '' },
  { accessor: 'dispatchDate', kind: 'date' },
  { accessor: 'eta', kind: 'date' },
  { accessor: 'currentLocation', text: (r) => r.currentLocation ?? '' },
  { accessor: 'status', kind: 'list', text: (r) => r.statusName },
]

/** 'YYYY-MM-..' -> 202609 */
function monthKey(value: string | null): number | undefined {
  if (!value) return undefined
  const [year, month] = value.split('-').map(Number)
  return year * 100 + month
}

/**
 * The containers, one row per box: where it is, what it carries and for whom. Order, supplier, PI
 * and item columns are the server's summaries ("PO-… +1", "Mixed - 3 items") because one container
 * carries several orders and invoices. Invoicing is by POSTED invoices (what the offload needs); the
 * movement is the one in progress, else the last completed. A red badge flags a container whose free
 * time at the port is used up.
 */
export function ContainersPage() {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()

  const canCreate = hasPermission(PERMISSIONS.containersCreate)
  const canOffload = hasPermission(PERMISSIONS.containersOffload)
  const canClose = hasPermission(PERMISSIONS.containersClose)
  const canCancel = hasPermission(PERMISSIONS.containersCancel)
  const canDelete = hasPermission(PERMISSIONS.containersDelete)

  const [suppliers, setSuppliers] = useState<PartyLookupDto[]>([])
  const [ports, setPorts] = useState<PortLookupDto[]>([])
  const [items, setItems] = useState<ItemLookupDto[]>([])
  const [invoices, setInvoices] = useState<{ value: string; label: string }[]>([])
  const [orders, setOrders] = useState<{ value: string; label: string }[]>([])
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [cancelling, setCancelling] = useState<ContainerListDto | null>(null)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [selected, setSelected] = useState<ContainerListDto[]>([])

  const grid = useGridQuery<Filters, ContainerListDto, AllRows<ContainerListDto>>({
    initialFilters: NO_FILTERS,
    debounced: ['containerNo', 'containerRef', 'commercialInvoiceNo', 'blNo'],
    initialSort: { columnAccessor: 'orderMonth', direction: 'desc' },
    // The list is loaded whole (newest first, up to the grid's cap) and the grid does the rest.
    paging: 'client',
    errorMessage: 'The containers could not be loaded.',
    fetcher: useCallback(
      ({ filters, signal }) =>
        fetchAllPages((page, pageSize) =>
          containersApi.list(
            {
              containerNo: filters.containerNo.trim() || undefined,
              containerRef: filters.containerRef.trim() || undefined,
              supplierId: filters.supplierId === null ? undefined : Number(filters.supplierId),
              status: filters.status === null ? undefined : (Number(filters.status) as ContainerStatusCode),
              orderMonthKey: monthKey(filters.orderMonth),
              purchaseOrderId: filters.purchaseOrderId === null ? undefined : Number(filters.purchaseOrderId),
              purchaseDocumentId: filters.purchaseDocumentId === null ? undefined : Number(filters.purchaseDocumentId),
              commercialInvoiceNo: filters.commercialInvoiceNo.trim() || undefined,
              itemId: filters.itemId === null ? undefined : Number(filters.itemId),
              blNo: filters.blNo.trim() || undefined,
              portId: filters.portId === null ? undefined : Number(filters.portId),
              dateFrom: filters.dateFrom ?? undefined,
              dateTo: filters.dateTo ?? undefined,
              sortBy: 'OrderDate',
              sortDir: 'desc',
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
  // The ticked rows as they are now: a reload after a bulk action brings their new status.
  const selectedRows = refreshSelection(selected, data?.items ?? [])
  const rows = useMemo(() => data?.items ?? [], [data])

  /* THE ENGINE HOLDS THE LOADED CONTAINERS AND ANSWERS FOR EVERY COLUMN: typed filters, multi-column
     sort, paging, footer totals over all the filtered rows, CSV. The filters above the grid still
     narrow what is loaded from the server; the column filters then narrow that. */
  const engine = useDataGrid({
    rows,
    columns: GRID_COLUMNS,
    storeKey: 'logistics.containers',
    sort: [{ accessor: 'orderMonth', direction: 'desc' }],
  })

  useEffect(() => {
    partiesApi.lookup({ partyType: 'Supplier', activeOnly: false }).then(setSuppliers).catch(() => {})
    portsApi.lookup(false).then(setPorts).catch(() => {})
    itemsApi.lookup(false).then(setItems).catch(() => {})
    // The PI filter needs the invoice list, which is the invoices' own permission: without it the
    // filter simply offers nothing rather than failing the page.
    purchaseDocumentsApi
      .list({ documentTypeCode: 'PINV', pageSize: 200, sortBy: 'DocumentDate', sortDir: 'desc' })
      .then((result) =>
        setInvoices(
          result.items
            .filter((i) => i.documentNumber)
            .map((i) => ({ value: String(i.id), label: `${i.documentNumber} - ${i.supplierName}` })),
        ),
      )
      .catch(() => {})
    // Same for the orders filter: the orders' own permission.
    purchaseDocumentsApi
      .list({ documentTypeCode: 'PO', pageSize: 200, sortBy: 'DocumentDate', sortDir: 'desc' })
      .then((result) =>
        setOrders(
          result.items
            .filter((o) => o.documentNumber && o.status !== 'Draft' && o.status !== 'Cancelled')
            .map((o) => ({ value: String(o.id), label: `${o.documentNumber} - ${o.supplierName}` })),
        ),
      )
      .catch(() => {})
  }, [])

  // The advanced panel opens by itself when one of its filters is in use, so a filter is never hidden.
  const advancedActive = ADVANCED.some((key) => filters[key] !== NO_FILTERS[key])
  const advancedShown = advancedOpen || advancedActive

  const supplierOptions = useMemo(() => suppliers.map((s) => ({ value: String(s.id), label: supplierLabel(s) })), [suppliers])
  const portOptions = useMemo(() => ports.map((p) => ({ value: String(p.id), label: portLabel(p) })), [ports])
  const itemOptions = useMemo(() => items.map((i) => ({ value: String(i.id), label: `${i.itemCode} - ${i.itemName}` })), [items])

  async function exportOne(row: ContainerListDto) {
    try {
      await containersApi.exportToExcel(row.id, row.containerRef)
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The container could not be exported.')
    }
  }

  async function close(row: ContainerListDto) {
    const go = await confirm({
      title: `Close ${row.containerRef}`,
      message: 'Close this offloaded container? It becomes a closed record and can no longer be reversed.',
      confirmLabel: 'Close container',
    })
    if (!go) return
    try {
      await containersApi.close(row.id, row.rowVersion)
      notify.success(`${row.containerRef} closed.`)
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The container could not be closed.')
    }
  }

  async function cancelContainer(reason: string) {
    const row = cancelling
    if (!row) return
    setCancelBusy(true)
    try {
      await containersApi.cancel(row.id, reason, row.rowVersion)
      notify.success(`${row.containerRef} cancelled.`)
      setCancelling(null)
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The container could not be cancelled.')
    } finally {
      setCancelBusy(false)
    }
  }

  async function remove(row: ContainerListDto) {
    const go = await confirm({
      title: 'Delete container',
      message: `Delete draft ${row.containerRef}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!go) return
    try {
      await containersApi.remove(row.id)
      notify.success('Container deleted.')
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The container could not be deleted.')
    }
  }

  function exportList() {
    downloadCsv(
      'containers.csv',
      ['Container Ref.', 'Container No.', 'Order Month', 'Order No.', 'Supplier', 'PI No.', 'Commercial Invoice No.', 'Invoicing',
        'Model / Item', 'Qty', 'Charges', 'Movement', 'B/L No.', 'Dispatch Date', 'ETA', 'Current Location', 'Status'],
      engine.rows.map((r) => [
        r.containerRef, r.containerNo ?? '', r.orderMonth, r.orderNumbers ?? '', r.supplierNames ?? '', r.invoiceNumbers ?? '',
        r.commercialInvoiceNos ?? '', INVOICING_STATUSES[r.invoicingStatus]?.label ?? '', r.itemSummary ?? '', String(r.totalQtyBase),
        formatNumber(r.chargesPostedBase, 2), r.currentMovementNo ?? '', r.blNo ?? '', dateLabel(r.dispatchDate), dateLabel(r.eta),
        r.currentLocation ?? '', r.statusName,
      ]),
    )
  }

  const dash = <Text fz="sm" c="dimmed">—</Text>
  const text = (value: string | null) => (value ? <Text fz="sm" style={{ whiteSpace: 'nowrap' }}>{value}</Text> : dash)

  const columns: DataTableColumn<ContainerListDto>[] = [
    rowNumberColumn<ContainerListDto>(engine.page, engine.pageSize),
    {
      accessor: 'containerRef',
      title: 'Container Ref.',
      width: 140,
      render: (row) => (
        <Anchor component={Link} to={`${CONTAINERS_ROUTE}/${row.id}`} fz="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>
          {row.containerRef}
        </Anchor>
      ),
    },
    { accessor: 'containerNo', title: 'Container No.', width: 135, render: (row) => text(row.containerNo) },
    { accessor: 'orderMonth', title: 'Order Month', width: 130, render: (row) => text(row.orderMonth) },
    {
      accessor: 'orderNumbers',
      title: 'Order No.',
      width: 175,
      render: (row) =>
        // A link only when the order of the lines IS the container's own order: purchaseOrderId is the
        // order the container was created from, and the list does not carry the id of another one.
        row.purchaseOrderId && row.orderCount === 1 && row.orderNumbers === row.purchaseOrderNumber ? (
          <Anchor component={Link} to={routes.purchaseOrder(row.purchaseOrderId)} fz="sm" style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
            {row.orderNumbers}
          </Anchor>
        ) : (
          text(row.orderNumbers)
        ),
    },
    { accessor: 'supplierNames', title: 'Supplier', width: 170, render: (row) => text(row.supplierNames) },
    { accessor: 'invoiceNumbers', title: 'PI No.', width: 175, render: (row) => text(row.invoiceNumbers) },
    { accessor: 'commercialInvoiceNos', title: 'Commercial Invoice No.', width: 190, render: (row) => text(row.commercialInvoiceNos) },
    {
      accessor: 'invoicingStatus',
      title: 'Invoicing',
      width: 140,
      render: (row) => {
        const state = INVOICING_STATUSES[row.invoicingStatus]
        return (
          <Tooltip label={`${formatNumber(row.invoicedQtyBase)} of ${formatNumber(row.totalQtyBase)} pcs in posted invoices`} withArrow>
            <Badge size="sm" variant="light" color={state.colour}>
              {state.label}
            </Badge>
          </Tooltip>
        )
      },
    },
    { accessor: 'itemSummary', title: 'Model / Item', width: 160, render: (row) => text(row.itemSummary) },
    {
      accessor: 'totalQtyBase',
      title: 'Qty',
      width: 80,
      textAlign: 'right',
      render: (row) => formatNumber(row.totalQtyBase),
    },
    {
      accessor: 'chargesPostedBase',
      title: 'Charges',
      width: 110,
      textAlign: 'right',
      render: (row) => (row.chargesPostedBase ? formatNumber(row.chargesPostedBase, 2) : dash),
    },
    {
      accessor: 'currentMovementNo',
      title: 'Movement',
      width: 160,
      render: (row) =>
        row.currentMovementId ? (
          <Anchor component={Link} to={`/logistics/movements/${row.currentMovementId}`} fz="sm" style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
            {row.currentMovementNo}
          </Anchor>
        ) : (
          dash
        ),
    },
    { accessor: 'blNo', title: 'B/L No.', width: 110, render: (row) => text(row.blNo) },
    { accessor: 'dispatchDate', title: 'Dispatch Date', width: 140, render: (row) => dateLabel(row.dispatchDate) },
    { accessor: 'eta', title: 'ETA', width: 105, render: (row) => dateLabel(row.eta) },
    {
      accessor: 'currentLocation',
      title: 'Current Location',
      width: 190,
      render: (row) => (
        <Stack gap={2}>
          {text(row.currentLocation)}
          {row.isFreeTimeOver ? (
            <Tooltip
              label={`Last free day ${dateLabel(row.lastFreeDay)} - ${formatNumber(row.daysAtPort)} days at port`}
              withArrow
            >
              <Badge color="red" variant="filled" size="xs" w="fit-content">
                Free time over
              </Badge>
            </Tooltip>
          ) : null}
        </Stack>
      ),
    },
    {
      accessor: 'status',
      title: 'Status',
      width: 120,
      render: (row) => (
        <Badge color={containerStatusColour(row.status)} variant={row.status === 7 ? 'filled' : 'light'} style={{ whiteSpace: 'nowrap' }}>
          {row.statusName}
        </Badge>
      ),
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 120,
      textAlign: 'right',
      render: (row) => {
        const more = [
          { key: 'offload', show: canOffload && row.canOffload, label: 'Offload', icon: <IconTruckDelivery size={16} />, onClick: () => void navigate(`${CONTAINERS_ROUTE}/${row.id}?offload=1`) },
          { key: 'close', show: canClose && row.canClose, label: 'Close', icon: <IconLock size={16} />, onClick: () => void close(row) },
          { key: 'cancel', show: canCancel && row.canCancel, label: 'Cancel', icon: <IconBan size={16} />, color: 'red', onClick: () => setCancelling(row) },
          { key: 'delete', show: canDelete && row.canDelete, label: 'Delete', icon: <IconTrash size={16} />, color: 'red', onClick: () => void remove(row) },
          { key: 'export', show: true, label: 'Export', icon: <IconFileSpreadsheet size={16} />, onClick: () => void exportOne(row) },
        ].filter((a) => a.show)

        return (
          <Group gap={4} justify="flex-end" wrap="nowrap">
            <Tooltip label="View" withArrow>
              <ActionIcon variant="subtle" aria-label={`View ${row.containerRef}`} onClick={() => void navigate(`${CONTAINERS_ROUTE}/${row.id}`)}>
                <IconEye size={16} />
              </ActionIcon>
            </Tooltip>
            {canCreate && row.canEdit ? (
              <Tooltip label="Edit" withArrow>
                <ActionIcon variant="subtle" aria-label={`Edit ${row.containerRef}`} onClick={() => void navigate(`${CONTAINERS_ROUTE}/${row.id}`)}>
                  <IconPencil size={16} />
                </ActionIcon>
              </Tooltip>
            ) : null}
            <Menu position="bottom-end" shadow="md" withinPortal>
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" aria-label={`More actions for ${row.containerRef}`}>
                  <IconDots size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {more.map((action) => (
                  <Menu.Item key={action.key} leftSection={action.icon} color={action.color} onClick={action.onClick}>
                    {action.label}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          </Group>
        )
      },
    },
  ]

  return (
    <div>
      <PageHeader
        title="Containers"
        subtitle="Import shipments from the purchase order to the warehouse."
        actions={
          <>
            <Button variant="default" leftSection={<IconTableExport size={16} />} onClick={exportList} disabled={(data?.items.length ?? 0) === 0}>
              Export
            </Button>
            <Button variant="default" leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>
              Print
            </Button>
            {canCreate ? (
              <Button leftSection={<IconPlus size={16} />} onClick={() => void navigate(`${CONTAINERS_ROUTE}/new`)}>
                New Container
              </Button>
            ) : null}
          </>
        }
      />

      <div className="no-print">
        <FilterBar>
          <FilterBar.Col span={2}>
            <TextInput label="Container No." placeholder="MSKU..." value={filters.containerNo} onChange={(e) => setFilter('containerNo', e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') grid.commitFilters() }} />
          </FilterBar.Col>
          <FilterBar.Col span={2}>
            <TextInput label="Container Ref." placeholder="KTG-..." value={filters.containerRef} onChange={(e) => setFilter('containerRef', e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') grid.commitFilters() }} />
          </FilterBar.Col>
          <FilterBar.Col span={3}>
            <Select label="Supplier" placeholder="All suppliers" data={supplierOptions} value={filters.supplierId} onChange={(next) => setFilter('supplierId', next)} clearable searchable nothingFoundMessage="No supplier matches" />
          </FilterBar.Col>
          <FilterBar.Col span={2}>
            <Select label="Status" placeholder="All" data={CONTAINER_STATUSES.map((s) => ({ value: String(s.value), label: s.label }))} value={filters.status} onChange={(next) => setFilter('status', next)} clearable />
          </FilterBar.Col>
          <FilterBar.Col span={2}>
            <MonthPickerInput label="Order Month" placeholder="Any" valueFormat="MMM YYYY" value={filters.orderMonth} onChange={(next) => setFilter('orderMonth', next ? String(next).slice(0, 10) : null)} clearable />
          </FilterBar.Col>
          <FilterBar.Col span={1}>
            <Tooltip label={advancedShown ? 'Hide advanced filters' : 'Advanced filters'} withArrow>
              <ActionIcon
                variant={advancedActive ? 'light' : 'default'}
                size={36}
                aria-label="Advanced filters"
                aria-expanded={advancedShown}
                onClick={() => setAdvancedOpen((open) => !open)}
                disabled={advancedActive}
              >
                <IconAdjustmentsHorizontal size={18} />
              </ActionIcon>
            </Tooltip>
          </FilterBar.Col>
        </FilterBar>

        <Collapse expanded={advancedShown}>
          <FilterBar>
            <FilterBar.Col span={3}>
              <Select label="Purchase order" placeholder="Any order" data={orders} value={filters.purchaseOrderId} onChange={(next) => setFilter('purchaseOrderId', next)} clearable searchable nothingFoundMessage="No order matches" />
            </FilterBar.Col>
            <FilterBar.Col span={3}>
              <Select label="PI No." placeholder="Any invoice" data={invoices} value={filters.purchaseDocumentId} onChange={(next) => setFilter('purchaseDocumentId', next)} clearable searchable nothingFoundMessage="No invoice matches" />
            </FilterBar.Col>
            <FilterBar.Col span={3}>
              <TextInput label="Commercial Invoice No." value={filters.commercialInvoiceNo} onChange={(e) => setFilter('commercialInvoiceNo', e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') grid.commitFilters() }} />
            </FilterBar.Col>
            <FilterBar.Col span={3}>
              <Select label="Model / Item" placeholder="Any item" data={itemOptions} value={filters.itemId} onChange={(next) => setFilter('itemId', next)} clearable searchable nothingFoundMessage="No item matches" />
            </FilterBar.Col>
            <FilterBar.Col span={3}>
              <TextInput label="B/L No." value={filters.blNo} onChange={(e) => setFilter('blNo', e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') grid.commitFilters() }} />
            </FilterBar.Col>
            <FilterBar.Col span={3}>
              <Select label="Location / Port" placeholder="Any port" data={portOptions} value={filters.portId} onChange={(next) => setFilter('portId', next)} clearable searchable />
            </FilterBar.Col>
            <FilterBar.Col span={2}>
              <DateInput label="Order date from" placeholder="Any" valueFormat="DD/MM/YYYY" value={filters.dateFrom} onChange={(next) => setFilter('dateFrom', next ? isoDate(new Date(next)) : null)} clearable />
            </FilterBar.Col>
            <FilterBar.Col span={2}>
              <DateInput label="Order date to" placeholder="Any" valueFormat="DD/MM/YYYY" value={filters.dateTo} onChange={(next) => setFilter('dateTo', next ? isoDate(new Date(next)) : null)} clearable />
            </FilterBar.Col>
            <FilterBar.Col span={2}>
              <Button variant="default" leftSection={<IconFilterOff size={16} />} onClick={grid.clearFilters} disabled={grid.isDefault}>
                Clear Filters
              </Button>
            </FilterBar.Col>
          </FilterBar>
        </Collapse>

        {!advancedShown && !grid.isDefault ? (
          <Group justify="flex-end" mb="sm" mt={-8}>
            <Button variant="subtle" size="xs" leftSection={<IconFilterOff size={14} />} onClick={grid.clearFilters}>
              Clear Filters
            </Button>
          </Group>
        ) : null}
      </div>

      {error ? (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      ) : null}

      {data?.truncated ? (
        <Alert color="yellow" mb="md" title="Showing the newest rows only">
          There are more containers than the grid loads at once. Narrow the list with the filters above (dates, status, customer) to see the rest.
        </Alert>
      ) : null}

      <ContainerSelectionBar rows={data?.items ?? []} selected={selectedRows} onSelectedChange={setSelected} onChanged={load} />

      <Paper radius="lg" withBorder>
        <DataTable<ContainerListDto>
          storeKey="logistics.containers"
          engine={engine}
          exportFileName="containers"
          selectedRecords={selectedRows}
          onSelectedRecordsChange={setSelected}
          columns={columns}
          fetching={loading}
          noRecordsText={grid.isDefault ? 'No containers yet.' : 'No containers match these filters.'}
          pinLastColumn
          onRowClick={({ record }) => void navigate(`${CONTAINERS_ROUTE}/${record.id}`)}
        />
      </Paper>

      <CancelReasonModal
        opened={cancelling !== null}
        onClose={() => setCancelling(null)}
        documentLabel={cancelling?.containerRef ?? ''}
        busy={cancelBusy}
        onConfirm={(reason) => void cancelContainer(reason)}
        confirmLabel="Cancel container"
        description="The container is cancelled and its invoices are free to load elsewhere. No stock moves."
      />
    </div>
  )
}
