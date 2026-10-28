import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Alert, Badge, Button, Checkbox, Group, Loader, Paper, Select, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconArrowBackUp, IconEye, IconFilterOff, IconPrinter, IconSearch, IconSend } from '@tabler/icons-react'
import type { BulkActionItemResult, BulkActionResult } from '../../api/documents'
import { ApiError } from '../../api/http'
import { branchesApi } from '../../api/masterdata/branches'
import { partiesApi } from '../../api/masterdata/parties'
import { warehousesApi } from '../../api/masterdata/warehouses'
import {
  GOODS_RECEIPT_SOURCES,
  GOODS_RECEIPT_STATUSES,
  goodsReceiptsApi,
  goodsReceiptStatusColour,
  goodsReceiptStatusLabel,
  type GoodsReceiptDto,
  type GoodsReceiptListItemDto,
  type GoodsReceiptSourceKind,
  type GoodsReceiptStatusCode,
  type GoodsReceiptTotalsDto,
} from '../../api/purchase/goodsReceipts'
import type { BranchLookupDto, PartyLookupDto, WarehouseLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { BulkActionsBar } from '../../components/documents/BulkActionsBar'
import { BulkResultsModal } from '../../components/documents/BulkResultsModal'
import { CancelReasonModal } from '../../components/documents/CancelReasonModal'
import { dateLabel, isoDate } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import {
  cancelDescription,
  deleteDraftMessage,
  postConfirmFor,
  receiptLabel,
  sourceText,
  supplierText,
} from '../../components/purchase/goodsReceipts/goodsReceiptModel'
import { NewGoodsReceiptModal } from '../../components/purchase/goodsReceipts/NewGoodsReceiptModal'
import { ReceiveGoodsModal, type ReceiveGoodsSource } from '../../components/purchase/goodsReceipts/ReceiveGoodsModal'
import { partyLabel } from '../../components/sales/salesLines'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { useBulkSelection } from '../../hooks/useBulkSelection'
import { refreshGoodsReceiptsWaiting } from '../../hooks/useGoodsReceiptsWaiting'
import { useGridQuery } from '../../hooks/useGridQuery'
import { useSeesItemCosts } from '../../hooks/useSeesItemCosts'
import { PERMISSIONS } from '../../navigation'
import { routes } from '../../routes'

interface Filters {
  search: string
  status: string | null
  sourceKind: string | null
  branchId: string | null
  supplierId: string | null
  warehouseId: string | null
  dateFrom: string | null
  dateTo: string | null
  withDifferences: boolean
  receivedNotInvoiced: boolean
}

const NO_FILTERS: Filters = {
  search: '',
  status: null,
  sourceKind: null,
  branchId: null,
  supplierId: null,
  warehouseId: null,
  dateFrom: null,
  dateTo: null,
  withDifferences: false,
  receivedNotInvoiced: false,
}

/** The reader's last Status choice on this list ('all', or a status code), kept in this browser only. */
const STATUS_KEY = 'inventory_shipment.goodsReceipts.status'

/** What was stored: undefined when nothing was (or the browser refuses storage), null for "All", else the code. */
function readStoredStatus(): string | null | undefined {
  try {
    const stored = localStorage.getItem(STATUS_KEY)
    if (stored === null) return undefined
    if (stored === 'all') return null
    return ['1', '2', '3'].includes(stored) ? stored : undefined
  } catch {
    return undefined
  }
}

function storeStatus(status: string | null) {
  try {
    localStorage.setItem(STATUS_KEY, status ?? 'all')
  } catch {
    // A browser that refuses storage still works; the list simply opens as it would the first time.
  }
}

const STATUS_DATA = GOODS_RECEIPT_STATUSES.map((s) => ({ value: String(s.value), label: s.label }))
const SOURCE_DATA = GOODS_RECEIPT_SOURCES.map((s) => ({ value: s.value, label: s.label }))

/** What each column IS, for the grid engine; how a cell LOOKS stays in the column definitions. */
const GRID_COLUMNS: GridColumnMeta<GoodsReceiptListItemDto>[] = [
  // Counted on what the cell shows, so a draft (no number yet) counts too.
  { accessor: 'documentNumber', summary: 'count', value: (r) => r.documentNumber ?? 'Assigned on posting', text: (r) => r.documentNumber ?? 'Assigned on posting' },
  { accessor: 'documentDate', kind: 'date' },
  { accessor: 'status', kind: 'list', value: (r) => r.status, text: (r) => goodsReceiptStatusLabel(r.status) },
  { accessor: 'sourceKind', kind: 'list', text: (r) => sourceText(r) },
  { accessor: 'supplierName', kind: 'list', text: (r) => supplierText(r) },
  { accessor: 'warehouseName', kind: 'list', text: (r) => r.warehouseCode ?? 'to choose' },
  { accessor: 'receivedBase', kind: 'number', summary: 'sum', text: (r) => formatNumber(r.receivedBase) },
  { accessor: 'shortBase', kind: 'number', summary: 'sum', text: (r) => formatNumber(r.shortBase) },
  { accessor: 'valueBase', kind: 'number', summary: 'sum', text: (r) => formatNumber(r.valueBase, 2) },
]

const EMPTY_TEXT =
  "No goods receipts yet. They are created when a container's delivery is completed, with Receive goods… on an order, an invoice or a container, or with + New."

/**
 * Purchase › Goods Receipts: every receipt, the goods entering the stock (spec 5.2).
 *
 * WHEN DRAFTS WAIT, THE LIST OPENS ON THEM: their goods are not in stock until they are posted. The reader's own Status
 * choice wins once made, remembered in this browser; the first visit opens on Draft when there are drafts, else on all.
 */
export function GoodsReceiptsPage() {
  const [initialStatus, setInitialStatus] = useState<string | null | undefined>(() => readStoredStatus())

  useEffect(() => {
    if (initialStatus !== undefined) return
    let cancelled = false
    goodsReceiptsApi
      .waiting()
      .then((count) => {
        if (!cancelled) setInitialStatus(count > 0 ? '1' : null)
      })
      .catch(() => {
        if (!cancelled) setInitialStatus(null)
      })
    return () => {
      cancelled = true
    }
  }, [initialStatus])

  if (initialStatus === undefined) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    )
  }
  return <GoodsReceiptsList initialStatus={initialStatus} />
}

function GoodsReceiptsList({ initialStatus }: { initialStatus: string | null }) {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()

  const canCreate = hasPermission(PERMISSIONS.goodsReceiptsCreate)
  const canPost = hasPermission(PERMISSIONS.goodsReceiptsPost)
  const canCancel = hasPermission(PERMISSIONS.goodsReceiptsCancel)
  const canDelete = hasPermission(PERMISSIONS.goodsReceiptsDelete)
  /* (94) A receipt's value is its goods at their cost: without View item costs the Value column is not drawn (so it is
     neither sorted, filtered nor exported) and the month-end line gives the pieces only. The server sends both null. */
  const seesCosts = useSeesItemCosts()

  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [suppliers, setSuppliers] = useState<PartyLookupDto[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseLookupDto[]>([])

  const [chooserOpen, setChooserOpen] = useState(false)
  const [receiving, setReceiving] = useState<ReceiveGoodsSource | null>(null)
  const [cancelling, setCancelling] = useState<GoodsReceiptListItemDto | null>(null)
  /** The row whose receipt is being read before its Post or Cancel… (one at a time). */
  const [checkingId, setCheckingId] = useState<number | null>(null)
  const [cancelBusy, setCancelBusy] = useState(false)

  const selection = useBulkSelection<GoodsReceiptListItemDto>()
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkResult, setBulkResult] = useState<{ title: string; successLabel: string; result: BulkActionResult } | null>(null)

  /** The totals row of the last search: received not invoiced, in pieces and at the order price. */
  const [totals, setTotals] = useState<GoodsReceiptTotalsDto | null>(null)

  const grid = useGridQuery<Filters, GoodsReceiptListItemDto, { items: GoodsReceiptListItemDto[]; truncated: boolean }>({
    initialFilters: { ...NO_FILTERS, status: initialStatus },
    debounced: ['search'],
    initialSort: { columnAccessor: 'documentDate', direction: 'desc' },
    // Loaded whole (newest first, up to the grid's cap), the grid does the rest; the first page brings the totals.
    paging: 'client',
    errorMessage: 'The goods receipts could not be loaded.',
    fetcher: useCallback(async ({ filters, signal }) => {
      const query = {
        search: filters.search.trim() || undefined,
        status: filters.status === null ? undefined : (Number(filters.status) as GoodsReceiptStatusCode),
        sourceKind: (filters.sourceKind as GoodsReceiptSourceKind | null) ?? undefined,
        branchId: filters.branchId === null ? undefined : Number(filters.branchId),
        supplierId: filters.supplierId === null ? undefined : Number(filters.supplierId),
        warehouseId: filters.warehouseId === null ? undefined : Number(filters.warehouseId),
        dateFrom: filters.dateFrom ?? undefined,
        dateTo: filters.dateTo ?? undefined,
        withDifferences: filters.withDifferences || undefined,
        receivedNotInvoiced: filters.receivedNotInvoiced || undefined,
        sortBy: 'DocumentDate',
        sortDir: 'desc' as const,
      }
      const PAGE = 200
      const MAX = 5000
      const first = await goodsReceiptsApi.list({ ...query, page: 1, pageSize: PAGE }, signal)
      setTotals(first.totals)
      const items = [...first.items]
      const wanted = Math.min(first.totalCount, MAX)
      for (let page = 2; items.length < wanted; page++) {
        const next = await goodsReceiptsApi.list({ ...query, page, pageSize: PAGE }, signal)
        if (next.items.length === 0) break
        items.push(...next.items)
      }
      return { items, truncated: first.totalCount > MAX }
    }, []),
  })

  const { filters, setFilter, data, loading, error } = grid
  const load = grid.reload
  const rows = useMemo(() => data?.items ?? [], [data])
  const unfiltered = Object.entries(NO_FILTERS).every(([key, value]) => filters[key as keyof Filters] === value)

  const engine = useDataGrid({
    rows,
    columns: GRID_COLUMNS,
    storeKey: 'purchase.goodsReceipts',
    sort: [{ accessor: 'documentDate', direction: 'desc' }],
  })

  useEffect(() => {
    branchesApi.lookup(false).then(setBranches).catch(() => {})
    partiesApi.lookup({ partyType: 'Supplier', activeOnly: false }).then(setSuppliers).catch(() => {})
    warehousesApi.lookup(false).then(setWarehouses).catch(() => {})
  }, [])

  const warehouseData = useMemo(
    () =>
      warehouses
        .filter((w) => filters.branchId === null || w.branchId === Number(filters.branchId))
        .map((w) => ({ value: String(w.id), label: `${w.warehouseCode} - ${w.warehouseName}` })),
    [warehouses, filters.branchId],
  )

  function chooseStatus(next: string | null) {
    storeStatus(next)
    setFilter('status', next)
  }

  function chooseBranch(next: string | null) {
    setFilter('branchId', next)
    setFilter('warehouseId', null)
  }

  /** Clear Filters: every filter back to "all", the Status one included (and remembered as such). */
  function clearFilters() {
    storeStatus(null)
    for (const [key, value] of Object.entries(NO_FILTERS) as [keyof Filters, Filters[keyof Filters]][]) setFilter(key, value as never)
  }

  /** Only a draft can be posted or deleted, and only by a reader who may do one of the two. */
  const selectable = (row: GoodsReceiptListItemDto) => row.status === 1 && (canPost || canDelete)

  /* ── row actions ──────────────────────────────────────────────────────────────────────────── */

  /**
   * THE ROW READS THE RECEIPT BEFORE IT ASKS, as the receipt page does. The list carries no canPost / canCancel (judging
   * every row of a search of thousands would weigh on it), so a click reads the receipt first: when it cannot be posted
   * or cancelled, the reason is shown instead of the dialog - not after the reader has typed a cancel reason.
   */
  async function readForAction(row: GoodsReceiptListItemDto): Promise<GoodsReceiptDto | null> {
    if (checkingId !== null) return null
    setCheckingId(row.id)
    try {
      const receipt = await goodsReceiptsApi.get(row.id)
      // Changed since the list was read (posted, cancelled): the row follows.
      if (receipt.status !== row.status) load()
      return receipt
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The goods receipt could not be read.')
      return null
    } finally {
      setCheckingId(null)
    }
  }

  /** The server's reason, in a dialog that can open the receipt. */
  async function showRefusal(receipt: GoodsReceiptDto, title: string, reason: string) {
    const open = await confirm({ title, message: reason, confirmLabel: 'Open the receipt', cancelLabel: 'Close' })
    if (open) void navigate(routes.goodsReceipt(receipt.id))
  }

  async function post(row: GoodsReceiptListItemDto) {
    const receipt = await readForAction(row)
    if (!receipt) return
    if (!receipt.canPost) {
      await showRefusal(receipt, `${receiptLabel(receipt)} cannot be posted`, receipt.postBlockedReason ?? 'This goods receipt cannot be posted.')
      return
    }
    const go = await confirm({
      title: 'Post goods receipt',
      message: postConfirmFor(receipt, warehouses, seesCosts),
      confirmLabel: 'Post',
    })
    if (!go) return
    try {
      const posted = await goodsReceiptsApi.post(receipt.id, receipt.rowVersion)
      notify.success(`Posted: ${posted.documentNumber ?? ''}`.trim())
      void refreshGoodsReceiptsWaiting()
      load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The goods receipt could not be posted.')
    }
  }

  async function remove(row: GoodsReceiptListItemDto) {
    const go = await confirm({ title: 'Delete draft', message: deleteDraftMessage(row), confirmLabel: 'Delete', danger: true })
    if (!go) return
    try {
      await goodsReceiptsApi.remove(row.id, row.rowVersion)
      notify.success('Draft deleted.')
      void refreshGoodsReceiptsWaiting()
      load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The draft could not be deleted.')
    }
  }

  async function startCancel(row: GoodsReceiptListItemDto) {
    const receipt = await readForAction(row)
    if (!receipt) return
    if (!receipt.canCancel) {
      await showRefusal(receipt, `${receiptLabel(receipt)} cannot be cancelled`, receipt.cancelBlockedReason ?? 'This goods receipt cannot be cancelled.')
      return
    }
    // The dialog cancels what was just read: its row version, number and container.
    setCancelling({ ...row, rowVersion: receipt.rowVersion, documentNumber: receipt.documentNumber, containerRef: receipt.containerRef })
  }

  async function cancelReceipt(reason: string) {
    const row = cancelling
    if (!row) return
    setCancelBusy(true)
    try {
      await goodsReceiptsApi.cancel(row.id, reason, row.rowVersion)
      notify.success('Goods receipt cancelled.')
      setCancelling(null)
      load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The goods receipt could not be cancelled.')
    } finally {
      setCancelBusy(false)
    }
  }

  /* ── bulk ─────────────────────────────────────────────────────────────────────────────────── */

  async function bulkPost() {
    const ids = selection.ids
    const go = await confirm({
      title: `Post ${formatNumber(ids.length)} goods receipt(s)`,
      message: `Post the ${formatNumber(ids.length)} selected draft(s)? Each is posted on its own: one refusal does not stop the others. The goods enter the stock, the item costs are updated and the numbers are assigned.`,
      confirmLabel: 'Post selected',
    })
    if (!go) return
    setBulkBusy(true)
    try {
      const results = await goodsReceiptsApi.postMany(ids)
      const result = summarise(results)
      setBulkResult({ title: 'Post selected', successLabel: 'Posted', result })
      selection.removeIds(results.filter((r) => r.ok).map((r) => r.id))
      void refreshGoodsReceiptsWaiting()
      load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The goods receipts could not be posted.')
    } finally {
      setBulkBusy(false)
    }
  }

  /** One DELETE per draft, in order, each with its own row version: one refusal does not stop the others. */
  async function bulkDelete() {
    const chosen = selection.selected
    const go = await confirm({
      title: `Delete ${formatNumber(chosen.length)} draft(s)`,
      message: `Delete the ${formatNumber(chosen.length)} selected draft(s)? This cannot be undone.${
        chosen.some((r) => r.isAuto) ? ' The containers of automatic drafts then wait without a receipt: create it again with Receive goods… on the container.' : ''
      }`,
      confirmLabel: 'Delete selected',
      danger: true,
    })
    if (!go) return
    setBulkBusy(true)
    const results: BulkActionItemResult[] = []
    for (const row of chosen) {
      try {
        await goodsReceiptsApi.remove(row.id, row.rowVersion)
        results.push({ id: row.id, documentNumber: null, ok: true, code: null, message: null })
      } catch (err) {
        results.push({
          id: row.id,
          documentNumber: row.documentNumber,
          ok: false,
          code: err instanceof ApiError ? (err.code ?? null) : null,
          message: err instanceof ApiError ? err.message : 'The draft could not be deleted.',
        })
      }
    }
    setBulkResult({ title: 'Delete selected', successLabel: 'Deleted', result: summarise(results) })
    selection.removeIds(results.filter((r) => r.ok).map((r) => r.id))
    void refreshGoodsReceiptsWaiting()
    setBulkBusy(false)
    load()
  }

  /* ── columns ──────────────────────────────────────────────────────────────────────────────── */

  const columns: DataTableColumn<GoodsReceiptListItemDto>[] = [
    rowNumberColumn<GoodsReceiptListItemDto>(engine.page, engine.pageSize),
    {
      accessor: 'documentNumber',
      title: 'Number',
      width: 175,
      render: (row) =>
        row.documentNumber ? (
          <Text fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>
            {row.documentNumber}
          </Text>
        ) : (
          <Text fz="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
            Assigned on posting
          </Text>
        ),
    },
    { accessor: 'documentDate', title: 'Date', width: 105, render: (row) => dateLabel(row.documentDate) },
    {
      accessor: 'status',
      title: 'Status',
      width: 105,
      render: (row) => (
        <Badge color={goodsReceiptStatusColour(row.status)} variant="light">
          {goodsReceiptStatusLabel(row.status)}
        </Badge>
      ),
    },
    {
      accessor: 'sourceKind',
      title: 'Source',
      width: 235,
      render: (row) => (
        <Group gap={6} wrap="nowrap">
          <Text fz="sm" style={{ whiteSpace: 'nowrap' }}>
            {sourceText(row)}
          </Text>
          {row.isAuto && (
            <Badge size="xs" variant="light" color="violet">
              Auto
            </Badge>
          )}
        </Group>
      ),
    },
    {
      accessor: 'supplierName',
      title: 'Supplier',
      width: 190,
      // The name is what is read; the code is one hover away.
      render: (row) => (
        <Text fz="sm" title={supplierText(row)} lineClamp={2}>
          {row.supplierName ?? supplierText(row)}
        </Text>
      ),
    },
    {
      accessor: 'warehouseName',
      title: 'Warehouse',
      width: 125,
      render: (row) =>
        row.warehouseCode ? (
          <Text fz="sm">{row.warehouseCode}</Text>
        ) : row.status === 1 ? (
          <Badge size="sm" variant="light" color="orange">
            to choose
          </Badge>
        ) : (
          '—'
        ),
    },
    { accessor: 'receivedBase', title: 'Received (pcs)', width: 140, textAlign: 'right', render: (row) => formatNumber(row.receivedBase) },
    {
      accessor: 'shortBase',
      title: 'Short (pcs)',
      width: 120,
      textAlign: 'right',
      render: (row) => (
        <Text fz="sm" c={row.shortBase > 0 ? 'red' : undefined} fw={row.shortBase > 0 ? 600 : undefined}>
          {formatNumber(row.shortBase)}
        </Text>
      ),
    },
    ...(seesCosts
      ? [
          {
            accessor: 'valueBase',
            title: 'Value (USD)',
            width: 135,
            textAlign: 'right',
            render: (row: GoodsReceiptListItemDto) => formatNumber(row.valueBase, 2),
          } satisfies DataTableColumn<GoodsReceiptListItemDto>,
        ]
      : []),
    {
      accessor: 'actions',
      title: 'Actions',
      width: 150,
      textAlign: 'right',
      render: (row) => (
        <RowActions
          label={receiptLabel(row)}
          custom={[
            { icon: <IconEye size={16} />, tooltip: 'View', onClick: () => void navigate(routes.goodsReceipt(row.id)) },
            { icon: <IconPrinter size={16} />, tooltip: 'Print', onClick: () => void navigate(routes.goodsReceiptPrint(row.id)) },
            { icon: <IconSend size={16} />, tooltip: 'Post', visible: canPost && row.status === 1, disabled: checkingId !== null, onClick: () => void post(row) },
            {
              icon: <IconArrowBackUp size={16} />,
              tooltip: 'Cancel…',
              color: 'orange',
              visible: canCancel && row.status === 2,
              disabled: checkingId !== null,
              onClick: () => void startCancel(row),
            },
          ]}
          remove={{ visible: canDelete && row.status === 1, onClick: () => void remove(row) }}
        />
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Goods Receipts"
        subtitle="Goods entering the stock: from containers, orders and invoices."
        actions={
          canCreate ? (
            <Button onClick={() => setChooserOpen(true)} data-new-goods-receipt>
              + New
            </Button>
          ) : undefined
        }
      />

      <FilterBar>
        <FilterBar.Col span={3}>
          <TextInput
            label="Search"
            placeholder="Number, container, order, invoice or item"
            leftSection={<IconSearch size={16} />}
            value={filters.search}
            onChange={(event) => setFilter('search', event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') grid.commitFilters()
            }}
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select label="Status" placeholder="All" data={STATUS_DATA} value={filters.status} onChange={chooseStatus} clearable />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select label="Source" placeholder="All" data={SOURCE_DATA} value={filters.sourceKind} onChange={(next) => setFilter('sourceKind', next)} clearable />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="Branch"
            placeholder="All branches"
            data={branches.map((b) => ({ value: String(b.id), label: b.branchName }))}
            value={filters.branchId}
            onChange={chooseBranch}
            clearable
            searchable
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select
            label="Supplier"
            placeholder="All suppliers"
            data={suppliers.map((s) => ({ value: String(s.id), label: partyLabel(s) }))}
            value={filters.supplierId}
            onChange={(next) => setFilter('supplierId', next)}
            clearable
            searchable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="Warehouse"
            placeholder="All warehouses"
            data={warehouseData}
            value={filters.warehouseId}
            onChange={(next) => setFilter('warehouseId', next)}
            clearable
            searchable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput
            label="Date from"
            placeholder="Any"
            valueFormat="DD/MM/YYYY"
            value={filters.dateFrom}
            onChange={(next) => setFilter('dateFrom', next ? isoDate(next) : null)}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput
            label="Date to"
            placeholder="Any"
            valueFormat="DD/MM/YYYY"
            value={filters.dateTo}
            onChange={(next) => setFilter('dateTo', next ? isoDate(next) : null)}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Checkbox
            label="With differences"
            checked={filters.withDifferences}
            onChange={(event) => setFilter('withDifferences', event.currentTarget.checked)}
            pb={8}
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Checkbox
            label="Received not invoiced"
            checked={filters.receivedNotInvoiced}
            onChange={(event) => setFilter('receivedNotInvoiced', event.currentTarget.checked)}
            pb={8}
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Button variant="default" leftSection={<IconFilterOff size={16} />} onClick={clearFilters} disabled={unfiltered}>
            Clear Filters
          </Button>
        </FilterBar.Col>
      </FilterBar>

      {error && (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      )}

      {data?.truncated ? (
        <Alert color="yellow" mb="md" title="Showing the newest rows only">
          There are more goods receipts than the grid loads at once. Narrow the list with the filters above (dates, status, supplier) to see the rest.
        </Alert>
      ) : null}

      <BulkActionsBar
        count={selection.ids.length}
        canPost={canPost}
        canDelete={canDelete}
        busy={bulkBusy}
        onPost={() => void bulkPost()}
        onDelete={() => void bulkDelete()}
        onClear={selection.clear}
      />

      <Paper radius="lg" withBorder>
        <DataTable
          storeKey="purchase.goodsReceipts"
          engine={engine}
          exportFileName="goods-receipts"
          columns={columns}
          selectedRecords={selection.selected}
          onSelectedRecordsChange={selection.setSelected}
          isRecordSelectable={selectable}
          fetching={loading}
          noRecordsText={unfiltered ? EMPTY_TEXT : 'No goods receipts match these filters.'}
          onRowClick={({ record }) => void navigate(routes.goodsReceipt(record.id))}
          pinLastColumn
        />
      </Paper>

      {totals && (
        <Text size="sm" mt="xs" c="dimmed" data-received-not-invoiced>
          {seesCosts
            ? `Received not invoiced: ${formatNumber(totals.receivedNotInvoicedBase)} pcs, ${formatNumber(totals.receivedNotInvoicedValueBase, 2)} USD at the order price.`
            : `Received not invoiced: ${formatNumber(totals.receivedNotInvoicedBase)} pcs.`}
        </Text>
      )}

      <BulkResultsModal
        opened={bulkResult !== null}
        title={bulkResult?.title ?? ''}
        successLabel={bulkResult?.successLabel ?? ''}
        result={bulkResult?.result ?? null}
        labelOf={(item) => `draft #${item.id}`}
        onClose={() => setBulkResult(null)}
      />

      <CancelReasonModal
        opened={cancelling !== null}
        onClose={() => setCancelling(null)}
        documentLabel={cancelling ? receiptLabel(cancelling) : ''}
        busy={cancelBusy}
        title="Cancel goods receipt"
        confirmLabel="Cancel goods receipt"
        description={cancelDescription(cancelling?.documentNumber ?? null, cancelling?.containerRef ?? null)}
        onConfirm={(reason) => void cancelReceipt(reason)}
      />

      <NewGoodsReceiptModal
        opened={chooserOpen}
        onClose={() => setChooserOpen(false)}
        onPickOrder={(order) => {
          setChooserOpen(false)
          setReceiving(order)
        }}
      />

      <ReceiveGoodsModal opened={receiving !== null} source={receiving} onClose={() => setReceiving(null)} />
    </div>
  )
}

/** A bulk answer as the results modal reads it: counts and one row per document, in the order sent. */
function summarise(results: BulkActionItemResult[]): BulkActionResult {
  const succeeded = results.filter((r) => r.ok).length
  return { requested: results.length, succeeded, failed: results.length - succeeded, results }
}
