import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { routes } from '../../routes'
import { Alert, Anchor, Badge, Button, Checkbox, Group, Paper, Progress, Select, Text, TextInput, Tooltip } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconArrowBackUp, IconEye, IconFileInvoice, IconFilterOff, IconInfoCircle, IconPackageImport, IconPlus, IconSearch, IconSend } from '@tabler/icons-react'
import type { BulkActionResult } from '../../api/documents'
import { ApiError } from '../../api/http'
import { fetchAllPages, type AllRows } from '../../api/fetchAllPages'
import { branchesApi } from '../../api/masterdata/branches'
import { partiesApi } from '../../api/masterdata/parties'
import { purchaseDocumentsApi, type CreatedPurchaseInvoiceDto, type PurchaseDocumentListDto, type PurchaseDocumentStatus } from '../../api/purchase/documents'
import type { BranchLookupDto, PartyLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { BulkActionsBar } from '../../components/documents/BulkActionsBar'
import { BulkResultsModal } from '../../components/documents/BulkResultsModal'
import { CancelReasonModal } from '../../components/documents/CancelReasonModal'
import { dateLabel, isoDate } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import { CreatedInvoicesModal } from '../../components/purchase/CreatedInvoicesModal'
import { CreateInvoiceFromOrderModal } from '../../components/purchase/CreateInvoiceFromOrderModal'
import { ReceiveGoodsModal, type ReceiveGoodsSource } from '../../components/purchase/goodsReceipts/ReceiveGoodsModal'
import {
  PURCHASE_INVOICE,
  PURCHASE_ORDER,
  PURCHASE_RETURN,
  PURCHASE_STATUS_COLOURS,
  PURCHASE_STATUSES,
  purchaseStatusLabel,
  supplierLabel,
  type PurchaseKind,
} from '../../components/purchase/purchaseKind'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
import { FilterBar } from '../../components/ui/FilterBar'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { useBulkSelection } from '../../hooks/useBulkSelection'
import { PERMISSIONS } from '../../navigation'
import { paymentStatusColour, paymentStatusLabel } from '../../components/sales/paymentStatus'
import { useGridQuery } from '../../hooks/useGridQuery'

interface Filters {
  search: string
  branchId: string | null
  supplierId: string | null
  status: string | null
  dateFrom: string | null
  dateTo: string | null
  /** Orders "To receive" / invoices "Not fully received" (goods receipts). */
  toReceive: boolean
}

const NO_FILTERS: Filters = { search: '', branchId: null, supplierId: null, status: null, dateFrom: null, dateTo: null, toReceive: false }

/** The invoice list's banner, once per viewer: remembered in this browser, per user, when it is closed. */
const switchBannerKey = (userId: number | undefined) => `inventory_shipment.purchaseInvoices.goodsReceiptsBannerClosed.${userId ?? 0}`

function bannerClosed(userId: number | undefined): boolean {
  try {
    return window.localStorage.getItem(switchBannerKey(userId)) === '1'
  } catch {
    return false
  }
}

function closeBanner(userId: number | undefined): void {
  try {
    window.localStorage.setItem(switchBannerKey(userId), '1')
  } catch {
    /* Storage refused (a private window): the banner comes back next time, which is harmless. */
  }
}

/** An invoice's received share of its invoiced pieces, 0–100; null before the API sends the figures (or on a draft). */
function invoiceReceivedPercent(row: PurchaseDocumentListDto): number | null {
  if (row.status === 'Draft' || row.receivedBase == null || !row.quantityBase) return null
  return Math.min(100, (row.receivedBase * 100) / row.quantityBase)
}

/** "45%" for the grid's text and CSV; blank when there is no figure. */
function percentText(value: number | null | undefined): string {
  return value == null ? '' : `${formatNumber(value, 0)}%`
}

/** "FC 750,000.00 CDF" — the symbol and the code, because a symbol alone is ambiguous across currencies. */
function documentTotal(row: PurchaseDocumentListDto): string {
  return `${row.currencySymbol ? `${row.currencySymbol} ` : ''}${formatNumber(row.totalAmount, row.decimalPlaces)} ${row.currencyCode}`
}

/**
 * What each column IS, for the grid engine. A total in the document's own currency cannot be added
 * across a list that mixes currencies, so the footer sums the BASE-currency column instead.
 */
const GRID_COLUMNS: GridColumnMeta<PurchaseDocumentListDto>[] = [
  { accessor: 'documentNumber', summary: 'count', text: (r) => r.documentNumber ?? 'DRAFT' },
  { accessor: 'documentDate', kind: 'date' },
  { accessor: 'supplierName' },
  { accessor: 'exporterReference', text: (r) => r.exporterReference ?? '' },
  { accessor: 'itemCode', text: itemText },
  { accessor: 'branchName' },
  { accessor: 'warehouseName' },
  { accessor: 'sourceDocumentNumber', text: (r) => r.sourceDocumentNumber ?? '' },
  { accessor: 'totalItems', kind: 'number' },
  { accessor: 'totalAmount', kind: 'number', text: documentTotal },
  { accessor: 'totalAmountBase', kind: 'number', summary: 'sum', text: (r) => formatNumber(r.totalAmountBase, 2) },
  /* Orders: received (goods receipts) and invoiced, each a share of the ordered quantity; invoices: received of invoiced. */
  { accessor: 'receivedPercent', kind: 'number', text: (r) => percentText(r.receivedPercent) },
  { accessor: 'invoicedPercent', kind: 'number', value: (r) => r.invoicedPercent ?? null, text: (r) => percentText(r.invoicedPercent) },
  { accessor: 'invoiceReceived', kind: 'number', value: invoiceReceivedPercent, text: (r) => percentText(invoiceReceivedPercent(r)) },
  { accessor: 'status', kind: 'list' },
  { accessor: 'paymentStatus', kind: 'list', text: (r) => (r.paymentStatus ? paymentStatusLabel(r.paymentStatus) : '') },
  { accessor: 'outstandingAmount', kind: 'number', text: (r) => (r.outstandingAmount === null ? '' : formatNumber(r.outstandingAmount, r.decimalPlaces)) },
]

/** A supplier invoice's item, "code - name"; "3 items" for an invoice of several items (script 63). */
function itemText(row: PurchaseDocumentListDto): string {
  if ((row.itemCount ?? 0) > 1) return `${formatNumber(row.itemCount)} items`
  return row.itemCode ? `${row.itemCode} - ${row.itemName ?? ''}` : ''
}

/** What the kind was made from: an invoice comes from an order, a return from an invoice, an order from nothing. */
function sourceKindOf(kind: PurchaseKind): PurchaseKind | null {
  if (kind.code === 'PINV') return PURCHASE_ORDER
  if (kind.code === 'PRET') return PURCHASE_INVOICE
  return null
}

/**
 * The grid layout (hidden columns, widths, page size, footer totals) is remembered PER KIND: orders, invoices and
 * returns have different columns, and one key shared by the three mixed them up - the column order saved by the first
 * list opened put the other lists' own columns after Actions.
 */
function gridStoreKey(kind: PurchaseKind): string {
  return `purchase.purchaseDocuments.${kind.code}`
}

/** The key the three lists shared before. */
const SHARED_STORE_KEY = 'purchase.purchaseDocuments'

/**
 * Once per kind, the reader's choices saved under the shared key (hidden columns, widths, page size, totals) are
 * copied to the kind's own key, so nobody loses them; the column order is not copied (the grid keeps the page's).
 * Storage refused: nothing to copy.
 */
function adoptSharedLayout(storeKey: string): void {
  try {
    for (const suffix of ['-columns-toggle', '-columns-width', '-grid', '-summaries']) {
      const shared = localStorage.getItem(SHARED_STORE_KEY + suffix)
      if (shared !== null && localStorage.getItem(storeKey + suffix) === null) localStorage.setItem(storeKey + suffix, shared)
    }
  } catch {
    // Storage blocked: the list starts from its defaults.
  }
}

/**
 * Every document of one purchase kind: the same list the sales invoices have — filters that apply
 * as they are typed, bulk post / delete on the ticked drafts, row actions gated by permission and
 * status — with the purchase family's own columns: the supplier, the source document, a total in
 * the document currency and, on orders, how much has been received.
 *
 * ONE LIST PER KIND, REMOUNTED WHEN THE KIND CHANGES: the three routes render this same component, so going from
 * Orders to Invoices would otherwise keep the Orders list's state - its filters, its banner, its grid layout.
 */
export function PurchaseDocumentsPage({ kind }: { kind: PurchaseKind }) {
  return <PurchaseDocumentsList key={kind.code} kind={kind} />
}

function PurchaseDocumentsList({ kind }: { kind: PurchaseKind }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { hasPermission, user } = useAuth()

  const highlight = ((location.state as { highlight?: number[] } | null)?.highlight) ?? []

  const canCreate = hasPermission(kind.permissions.create)
  const canPost = hasPermission(kind.permissions.post)
  const canCancel = hasPermission(kind.permissions.cancel)
  const canDelete = hasPermission(kind.permissions.delete)
  const canCreateInvoice = kind.code === 'PO' && hasPermission(PURCHASE_INVOICE.permissions.create)
  const canCreateReturn = kind.code === 'PINV' && hasPermission(PURCHASE_RETURN.permissions.create)
  /* Goods receipts: "Receive goods" on an approved order's row. */
  const canReceiveGoods = kind.code === 'PO' && hasPermission(PERMISSIONS.goodsReceiptsCreate)
  const sourceKind = sourceKindOf(kind)
  /* The kind's own grid key (the list remounts per kind); what was saved under the shared key is copied first, before
     the grid reads it. */
  const [storeKey] = useState(() => {
    const key = gridStoreKey(kind)
    adoptSharedLayout(key)
    return key
  })

  /* SINCE GOODS RECEIPTS, posting an invoice adds no stock: said once to the people who post invoices, until they close
     it (remembered in this browser). The date is the server's; without it the sentence goes without a date. */
  const [switchBanner, setSwitchBanner] = useState(() => kind.code === 'PINV' && canPost && !bannerClosed(user?.id))
  const [switchedAt, setSwitchedAt] = useState<string | null>(null)
  useEffect(() => {
    if (!switchBanner) return
    const controller = new AbortController()
    purchaseDocumentsApi
      .goodsReceiptsSwitch(controller.signal)
      .then((answer) => setSwitchedAt(answer.switchedAtUtc ?? null))
      .catch(() => {
        /* No date: the banner says the rule without it. */
      })
    return () => controller.abort()
  }, [switchBanner])

  const [receiving, setReceiving] = useState<ReceiveGoodsSource | null>(null)

  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [suppliers, setSuppliers] = useState<PartyLookupDto[]>([])

  const [cancelling, setCancelling] = useState<PurchaseDocumentListDto | null>(null)
  const [cancelBusy, setCancelBusy] = useState(false)

  const selection = useBulkSelection<PurchaseDocumentListDto>()
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkResult, setBulkResult] = useState<{ title: string; successLabel: string; result: BulkActionResult } | null>(null)
  /* "Create invoice" on an order row: one draft per item, so a dialog says how many first, and lists them after. */
  const [invoiceFrom, setInvoiceFrom] = useState<PurchaseDocumentListDto | null>(null)
  const [createdInvoices, setCreatedInvoices] = useState<{ orderId: number; currencyCode: string; invoices: CreatedPurchaseInvoiceDto[] } | null>(null)

  const grid = useGridQuery<Filters, PurchaseDocumentListDto, AllRows<PurchaseDocumentListDto>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'documentDate', direction: 'desc' },
    // The list is loaded whole (newest first, up to the grid's cap) and the grid does the rest.
    paging: 'client',
    errorMessage: `The ${kind.plural.toLowerCase()} could not be loaded.`,
    fetcher: useCallback(
      ({ filters, signal }) =>
        fetchAllPages((page, pageSize) =>
          purchaseDocumentsApi.list(
            {
              documentTypeCode: kind.code,
              search: filters.search.trim() || undefined,
              branchId: filters.branchId === null ? undefined : Number(filters.branchId),
              supplierId: filters.supplierId === null ? undefined : Number(filters.supplierId),
              status: (filters.status as PurchaseDocumentStatus | null) ?? undefined,
              dateFrom: filters.dateFrom ?? undefined,
              dateTo: filters.dateTo ?? undefined,
              toReceive: kind.code === 'PO' && filters.toReceive ? true : undefined,
              notFullyReceived: kind.code === 'PINV' && filters.toReceive ? true : undefined,
              sortBy: 'DocumentDate',
              sortDir: 'desc',
              page,
              pageSize,
            },
            signal,
          ),
        ),
      [kind.code],
    ),
  })

  const { filters, setFilter, data, loading, error } = grid
  const load = grid.reload
  const rows = useMemo(() => data?.items ?? [], [data])

  /* THE ENGINE HOLDS THE LOADED DOCUMENTS AND ANSWERS FOR EVERY COLUMN: typed filters, multi-column
     sort, paging, footer totals over all the filtered rows, CSV. The bar above the grid still narrows
     what is loaded from the server; the column filters then narrow that. */
  const engine = useDataGrid({
    rows,
    columns: GRID_COLUMNS,
    storeKey,
    sort: [{ accessor: 'documentDate', direction: 'desc' }],
  })

  useEffect(() => {
    branchesApi.lookup(false).then(setBranches).catch(() => {})
    partiesApi.lookup({ partyType: 'Supplier', activeOnly: false }).then(setSuppliers).catch(() => {})
  }, [])

  const label = (row: PurchaseDocumentListDto) => row.documentNumber ?? `draft #${row.id}`
  const selectable = (row: PurchaseDocumentListDto) => row.status === 'Draft' && (canPost || canDelete)

  async function post(row: PurchaseDocumentListDto) {
    const go = await confirm({
      title: `${kind.postVerb} ${label(row)}`,
      message: kind.postConfirm(row.warehouseName),
      confirmLabel: kind.postVerb,
    })
    if (!go) return
    try {
      const result = await purchaseDocumentsApi.post(row.id, row.rowVersion)
      notify.success(`${kind.title} ${kind.postVerb.toLowerCase()}ed.`.replace('Confirmed', 'confirmed').replace('confirmed.', 'confirmed.'))
      // What the posting did besides (an invoice: the cost of goods already received adjusted), in the server's words.
      if (result.message) notify.info(result.message)
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : `The ${kind.noun} could not be ${kind.postVerb.toLowerCase()}ed.`)
    }
  }

  async function cancelDocument(reason: string) {
    const row = cancelling
    if (!row) return
    setCancelBusy(true)
    try {
      await purchaseDocumentsApi.cancel(row.id, reason, row.rowVersion)
      notify.success(`${kind.title} cancelled.`)
      setCancelling(null)
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : `The ${kind.noun} could not be cancelled.`)
    } finally {
      setCancelBusy(false)
    }
  }

  async function remove(row: PurchaseDocumentListDto) {
    const go = await confirm({ title: 'Delete draft', message: `Delete ${label(row)}? This cannot be undone.`, confirmLabel: 'Delete', danger: true })
    if (!go) return
    try {
      await purchaseDocumentsApi.remove(row.id)
      notify.success('Draft deleted.')
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The draft could not be deleted.')
    }
  }

  async function createFrom(row: PurchaseDocumentListDto) {
    if (kind.code === 'PO') {
      setInvoiceFrom(row)
      return
    }
    const target = PURCHASE_RETURN
    const go = await confirm({
      title: `Create ${target.title.toLowerCase()}`,
      message: `Create a purchase return draft from ${label(row)} with everything that can still be returned?`,
      confirmLabel: 'Create',
    })
    if (!go) return
    try {
      const created = await purchaseDocumentsApi.createReturn(row.id)
      notify.success(`${target.title} draft created.`)
      void navigate(routes.purchaseDocument(target.code, created.id))
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : `The ${target.noun} could not be created.`)
    }
  }

  async function bulkPost() {
    const ids = selection.ids
    const go = await confirm({
      title: `${kind.postVerb} ${ids.length} ${kind.noun}(s)`,
      message: `${kind.postVerb} the ${ids.length} selected draft(s)? Each is handled on its own: one refusal does not stop the others.`,
      confirmLabel: `${kind.postVerb} selected`,
    })
    if (!go) return
    setBulkBusy(true)
    try {
      const result = await purchaseDocumentsApi.bulkPost(ids)
      setBulkResult({ title: `${kind.postVerb} selected`, successLabel: kind.code === 'PO' ? 'Confirmed' : 'Posted', result })
      selection.removeIds(result.results.filter((r) => r.ok).map((r) => r.id))
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : `The ${kind.plural.toLowerCase()} could not be posted.`)
    } finally {
      setBulkBusy(false)
    }
  }

  async function bulkDelete() {
    const ids = selection.ids
    const go = await confirm({ title: `Delete ${ids.length} draft(s)`, message: `Delete the ${ids.length} selected draft(s)? This cannot be undone.`, confirmLabel: 'Delete selected', danger: true })
    if (!go) return
    setBulkBusy(true)
    try {
      const result = await purchaseDocumentsApi.bulkDelete(ids)
      setBulkResult({ title: 'Delete selected', successLabel: 'Deleted', result })
      selection.removeIds(result.results.filter((r) => r.ok).map((r) => r.id))
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The drafts could not be deleted.')
    } finally {
      setBulkBusy(false)
    }
  }

  const columns: DataTableColumn<PurchaseDocumentListDto>[] = [
    rowNumberColumn<PurchaseDocumentListDto>(engine.page, engine.pageSize),
    {
      accessor: 'documentNumber',
      title: `${kind.title} No.`,
      width: 190,
      render: (row) =>
        row.documentNumber ? (
          <Text fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>{row.documentNumber}</Text>
        ) : (
          <Badge color="gray" variant="light">DRAFT</Badge>
        ),
    },
    { accessor: 'documentDate', title: 'Date', width: 110, render: (row) => dateLabel(row.documentDate) },
    {
      accessor: 'supplierName',
      title: 'Supplier',
      render: (row) => (
        <div>
          <Text fz="sm" fw={500}>{row.supplierName}</Text>
          <Text fz="xs" c="dimmed">{row.supplierCode}</Text>
        </div>
      ),
    },
    ...(kind.code === 'PINV'
      ? [
          {
            accessor: 'exporterReference',
            title: 'Exporter Ref.',
            width: 150,
            // Hidden on a phone: a reference nobody scans on a narrow screen costs the supplier its width.
            visibleMediaQuery: (theme) => `(min-width: ${theme.breakpoints.sm})`,
            render: (row) => row.exporterReference ?? <Text fz="sm" c="dimmed">—</Text>,
          } as DataTableColumn<PurchaseDocumentListDto>,
          {
            accessor: 'itemCode',
            title: 'Item',
            width: 230,
            /* ONE ITEM: "code - name". SEVERAL ITEMS: "3 items" — an invoice made to hold several, or (orange) an invoice
               of one item saved with several before that rule, which is split before posting. */
            render: (row) =>
              (row.itemCount ?? 0) > 1 ? (
                row.oneItemOnly === true && row.status === 'Draft' ? (
                  <Tooltip label="An invoice of one item made before that rule: split it before posting.">
                    <Badge color="orange" variant="light" size="sm" data-item-count={row.itemCount}>
                      {itemText(row)}
                    </Badge>
                  </Tooltip>
                ) : (
                  <Text fz="sm" data-item-count={row.itemCount}>
                    {itemText(row)}
                  </Text>
                )
              ) : row.itemCode ? (
                <Text fz="sm" lineClamp={1} style={{ minWidth: 0 }}>{itemText(row)}</Text>
              ) : (
                <Text fz="sm" c="dimmed">—</Text>
              ),
          } as DataTableColumn<PurchaseDocumentListDto>,
        ]
      : []),
    { accessor: 'branchName', title: 'Branch' },
    { accessor: 'warehouseName', title: 'Warehouse' },
    ...(sourceKind
      ? [
          {
            accessor: 'sourceDocumentNumber',
            title: 'Source',
            width: 170,
            render: (row) =>
              row.sourceDocumentId === null ? (
                <Text fz="sm" c="dimmed">—</Text>
              ) : (
                <Anchor component={Link} to={routes.purchaseDocument(sourceKind.code, row.sourceDocumentId)} fz="sm" onClick={(event) => event.stopPropagation()}>
                  {row.sourceDocumentNumber ?? `draft #${row.sourceDocumentId}`}
                </Anchor>
              ),
          } as DataTableColumn<PurchaseDocumentListDto>,
        ]
      : []),
    { accessor: 'totalItems', title: 'Items', width: 70, textAlign: 'right', render: (row) => formatNumber(row.totalItems) },
    { accessor: 'totalAmount', title: 'Total', width: 170, textAlign: 'right', render: (row) => <Text fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>{documentTotal(row)}</Text> },
    { accessor: 'totalAmountBase', title: 'Total (base)', width: 130, textAlign: 'right', render: (row) => formatNumber(row.totalAmountBase, 2) },
    ...(kind.code === 'PO'
      ? [
          {
            accessor: 'receivedPercent',
            title: 'Received',
            width: 130,
            render: (row) =>
              progressCell(row.status === 'Draft' ? null : row.receivedPercent, 'Received', 'teal', '% of the ordered quantity received (goods receipts)'),
          } as DataTableColumn<PurchaseDocumentListDto>,
          {
            accessor: 'invoicedPercent',
            title: 'Invoiced',
            width: 130,
            render: (row) => progressCell(row.status === 'Draft' ? null : (row.invoicedPercent ?? null), 'Invoiced', 'green', '% of the ordered quantity invoiced'),
          } as DataTableColumn<PurchaseDocumentListDto>,
        ]
      : []),
    ...(kind.code === 'PINV'
      ? [
          {
            accessor: 'invoiceReceived',
            title: 'Received',
            width: 130,
            render: (row) => progressCell(invoiceReceivedPercent(row), 'Received', 'teal', '% of the invoiced quantity received (goods receipts)'),
          } as DataTableColumn<PurchaseDocumentListDto>,
        ]
      : []),
    {
      accessor: 'status',
      title: 'Status',
      width: 110,
      render: (row) => <Badge color={PURCHASE_STATUS_COLOURS[row.status] ?? 'gray'} variant="light">{purchaseStatusLabel(row.status)}</Badge>,
    },
    ...(kind.code === 'PINV'
      ? [
          {
            accessor: 'paymentStatus',
            title: 'Payment',
            width: 130,
            // What supplier payments have settled: a posted invoice only.
            render: (row) =>
              row.paymentStatus ? <Badge color={paymentStatusColour(row.paymentStatus)} variant="light">{paymentStatusLabel(row.paymentStatus)}</Badge> : <Text fz="sm" c="dimmed">—</Text>,
          } as DataTableColumn<PurchaseDocumentListDto>,
          {
            accessor: 'outstandingAmount',
            title: 'Outstanding',
            width: 150,
            textAlign: 'right',
            render: (row) =>
              row.outstandingAmount === null ? <Text fz="sm" c="dimmed">—</Text> : <Text fz="sm" style={{ whiteSpace: 'nowrap' }}>{formatNumber(row.outstandingAmount, row.decimalPlaces)} {row.currencyCode}</Text>,
          } as DataTableColumn<PurchaseDocumentListDto>,
        ]
      : []),
    {
      accessor: 'actions',
      title: 'Actions',
      width: 200,
      textAlign: 'right',
      render: (row) => (
        <RowActions
          label={label(row)}
          edit={{ visible: canCreate && row.status === 'Draft', onClick: () => void navigate(routes.purchaseDocument(kind.code, row.id)) }}
          custom={[
            { icon: <IconEye size={16} />, tooltip: 'View', onClick: () => void navigate(routes.purchaseDocument(kind.code, row.id)) },
            { icon: <IconSend size={16} />, tooltip: kind.postVerb, visible: canPost && row.status === 'Draft', onClick: () => void post(row) },
            {
              icon: <IconPackageImport size={16} />,
              tooltip: 'Receive goods…',
              color: 'teal',
              // An approved order, open or closed (a closed one may still have invoiced goods to receive). A hint only:
              // the percentages are rounded, and the dialog says why when the rest travels in containers (rule 14).
              // An order closed by hand expects only what was invoiced, so it is done once that is received.
              visible: canReceiveGoods && (row.status === 'Posted' || row.status === 'Closed'),
              disabled:
                (row.receivedPercent ?? 0) >= 100 ||
                (row.status === 'Closed' && (row.invoicedPercent ?? 0) <= (row.receivedPercent ?? 0)),
              disabledReason: 'Everything ordered is already received.',
              onClick: () => setReceiving({ kind: 'order', id: row.id, documentNumber: row.documentNumber }),
            },
            {
              icon: <IconFileInvoice size={16} />,
              tooltip: 'Create invoice',
              color: 'green',
              // Since goods receipts a fully invoiced order stays open until its goods are received: nothing is left to
              // invoice on it (a hint from the rounded percentage; the dialog checks the order's own lines).
              visible: canCreateInvoice && row.status === 'Posted',
              disabled: (row.invoicedPercent ?? 0) >= 100,
              disabledReason: 'Everything ordered is already invoiced.',
              onClick: () => void createFrom(row),
            },
            { icon: <IconArrowBackUp size={16} />, tooltip: 'Create return', color: 'orange', visible: canCreateReturn && row.status === 'Posted', onClick: () => void createFrom(row) },
            { icon: <IconFilterOff size={16} />, tooltip: `Cancel ${kind.noun}`, color: 'red', visible: canCancel && (row.status === 'Posted' || row.status === 'Closed'), onClick: () => setCancelling(row) },
          ]}
          remove={{ visible: canDelete && row.status === 'Draft', onClick: () => void remove(row) }}
        />
      ),
    },
  ]

  /**
   * A share as a short bar and its figure, its meaning on hover ("45.0% of the ordered quantity invoiced"); a dash when
   * there is none (a draft, or no figure from the API yet).
   */
  function progressCell(value: number | null, label: string, colour: string, meaning: string) {
    if (value === null) return <Text fz="sm" c="dimmed">—</Text>
    return (
      <Tooltip label={`${formatNumber(value, 1)}${meaning}`} withArrow>
        <Group gap={6} wrap="nowrap">
          <Progress value={value} size="sm" w={70} color={value >= 100 ? 'teal' : colour} aria-label={label} />
          <Text fz="xs" style={{ whiteSpace: 'nowrap' }}>{formatNumber(value, 0)}%</Text>
        </Group>
      </Tooltip>
    )
  }

  return (
    <div>
      <PageHeader
        title={kind.plural}
        actions={
          canCreate ? (
            <Button leftSection={<IconPlus size={16} />} color={kind.colour} onClick={() => void navigate(`${kind.route}/new`)}>
              New {kind.title}
            </Button>
          ) : undefined
        }
      />

      <FilterBar>
        <FilterBar.Col span={3}>
          <TextInput label="Search" placeholder={kind.code === 'PINV' ? 'Number, supplier, exporter ref., commercial invoice no., item code' : 'Number, supplier reference or supplier'} leftSection={<IconSearch size={16} />} value={filters.search} onChange={(event) => setFilter('search', event.currentTarget.value)} />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select label="Branch" placeholder="All branches" data={branches.map((b) => ({ value: String(b.id), label: b.branchName }))} value={filters.branchId} onChange={(next) => setFilter('branchId', next)} clearable searchable />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select label="Supplier" placeholder="All suppliers" data={suppliers.map((s) => ({ value: String(s.id), label: supplierLabel(s) }))} value={filters.supplierId} onChange={(next) => setFilter('supplierId', next)} clearable searchable />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select label="Status" placeholder="All" data={PURCHASE_STATUSES.map((value) => ({ value, label: purchaseStatusLabel(value) }))} value={filters.status} onChange={(next) => setFilter('status', next)} clearable />
        </FilterBar.Col>
        <FilterBar.Col span={1}>
          <DateInput label="From" placeholder="Any" valueFormat="DD/MM/YYYY" value={filters.dateFrom} onChange={(next) => setFilter('dateFrom', next ? isoDate(next) : null)} clearable />
        </FilterBar.Col>
        <FilterBar.Col span={1}>
          <DateInput label="To" placeholder="Any" valueFormat="DD/MM/YYYY" value={filters.dateTo} onChange={(next) => setFilter('dateTo', next ? isoDate(next) : null)} clearable />
        </FilterBar.Col>
        {kind.code !== 'PRET' && (
          <FilterBar.Col span={2}>
            {/* Goods receipts: an approved order with something still to receive; a posted invoice not all received. */}
            <Checkbox
              mb={8}
              label={kind.code === 'PO' ? 'To receive' : 'Not fully received'}
              checked={filters.toReceive}
              onChange={(event) => setFilter('toReceive', event.currentTarget.checked)}
              data-to-receive-filter
            />
          </FilterBar.Col>
        )}
      </FilterBar>

      {switchBanner && (
        <Alert
          color="blue"
          icon={<IconInfoCircle size={18} />}
          mb="md"
          withCloseButton
          closeButtonLabel="Close"
          onClose={() => {
            closeBanner(user?.id)
            setSwitchBanner(false)
          }}
          data-goods-receipts-banner
        >
          {switchedAt
            ? `Since ${dateLabel(isoDate(new Date(switchedAt)))}, posting a supplier invoice no longer adds stock: receive the goods with Receive goods…`
            : 'Posting a supplier invoice no longer adds stock: receive the goods with Receive goods…'}
        </Alert>
      )}

      {error && (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      )}

      {data?.truncated ? (
        <Alert color="yellow" mb="md" title="Showing the newest rows only">
          There are more documents than the grid loads at once. Narrow the list with the filters above (dates, status, customer) to see the rest.
        </Alert>
      ) : null}

      <BulkActionsBar count={selection.ids.length} canPost={canPost} canDelete={canDelete} busy={bulkBusy} onPost={() => void bulkPost()} onDelete={() => void bulkDelete()} onClear={selection.clear} />

      <Paper radius="lg" withBorder>
        <DataTable
          storeKey={storeKey}
          engine={engine}
          exportFileName="purchase-documents"
          columns={columns}
          selectedRecords={selection.selected}
          onSelectedRecordsChange={selection.setSelected}
          isRecordSelectable={selectable}
          rowClassName={(row) => (highlight.includes(row.id) ? 'app-grid__row--highlight' : undefined)}
          fetching={loading}
          noRecordsText={`No ${kind.plural.toLowerCase()} yet.`}
          onRowClick={({ record }) => void navigate(routes.purchaseDocument(kind.code, record.id))}
        />
      </Paper>

      <BulkResultsModal opened={bulkResult !== null} title={bulkResult?.title ?? ''} successLabel={bulkResult?.successLabel ?? ''} result={bulkResult?.result ?? null} labelOf={(item) => `draft #${item.id}`} onClose={() => setBulkResult(null)} />

      {invoiceFrom ? (
        <CreateInvoiceFromOrderModal
          orderId={invoiceFrom.id}
          onClose={() => setInvoiceFrom(null)}
          onCreated={(created) => {
            const order = invoiceFrom
            setInvoiceFrom(null)
            notify.success(`${created.message}.`)
            if (created.invoices.length === 1) void navigate(routes.purchaseInvoice(created.firstId))
            else {
              setCreatedInvoices({ orderId: order.id, currencyCode: order.currencyCode, invoices: created.invoices })
              void load()
            }
          }}
        />
      ) : null}

      {createdInvoices ? (
        <CreatedInvoicesModal
          opened
          invoices={createdInvoices.invoices}
          currencyCode={createdInvoices.currencyCode}
          onClose={() => setCreatedInvoices(null)}
          onGoToOrder={() => void navigate(routes.purchaseOrder(createdInvoices.orderId))}
        />
      ) : null}

      <ReceiveGoodsModal opened={receiving !== null} source={receiving} onClose={() => setReceiving(null)} />

      <CancelReasonModal opened={cancelling !== null} onClose={() => setCancelling(null)} documentLabel={cancelling ? label(cancelling) : ''} busy={cancelBusy} onConfirm={(reason) => void cancelDocument(reason)} />
    </div>
  )
}
