import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Alert, Button, Grid, Group, Loader, Paper, Progress, SimpleGrid, Stack, Tabs, Text, Title } from '@mantine/core'
import {
  IconArrowBackUp,
  IconBox,
  IconBoxMultiple,
  IconCheck,
  IconFileInvoice,
  IconLock,
  IconMail,
  IconPlus,
  IconRefresh,
  IconSend,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { containersApi, type ContainerListDto } from '../../api/logistics/containers'
import { itemsApi } from '../../api/inventory/items'
import { approvalsApi, type PurchaseOrderApprovalDto } from '../../api/purchase/approvals'
import { chargeTypesApi, type ChargeTypeLookupDto } from '../../api/purchase/chargeTypes'
import { inventoryLookupsApi } from '../../api/inventory/stockDocuments'
import { branchesApi } from '../../api/masterdata/branches'
import { currenciesApi } from '../../api/masterdata/currencies'
import { partiesApi } from '../../api/masterdata/parties'
import { warehousesApi } from '../../api/masterdata/warehouses'
import {
  purchaseDocumentsApi,
  type CreatedPurchaseInvoiceDto,
  type PurchaseDocumentDto,
  type PurchaseRateResolutionDto,
  type ReceiptMode,
  type SavePurchaseDocumentRequest,
} from '../../api/purchase/documents'
import type { BranchLookupDto, CurrencyLookupDto, ItemListDto, ItemLookupDto, ItemUnitDto, PartyLookupDto, WarehouseLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { AttachmentsDrawer } from '../../components/documents/AttachmentsDrawer'
import { AuditTrail } from '../../components/documents/AuditTrail'
import { CancelReasonModal } from '../../components/documents/CancelReasonModal'
import { DocumentActionBar, type DocumentAction } from '../../components/documents/DocumentActionBar'
import { DocumentIcons } from '../../components/documents/documentIcons'
import { isoDate, stamp } from '../../components/documents/documentKind'
import { QuickItemSearch } from '../../components/documents/QuickItemSearch'
import { formatNumber } from '../../components/format'
import { AddContainerModal } from '../../components/logistics/AddContainerModal'
import { AutoPlanModal } from '../../components/logistics/AutoPlanModal'
import { InvoiceFromContainersModal } from '../../components/logistics/InvoiceFromContainersModal'
import { NewChargeModal } from '../../components/logistics/NewChargeModal'
import { announceApproved } from '../../components/purchase/approvalNotices'
import { ApprovalTimeline } from '../../components/purchase/ApprovalTimeline'
import { CloseOrderModal } from '../../components/purchase/CloseOrderModal'
import { LinkedDocumentsCard } from '../../components/purchase/LinkedDocumentsCard'
import { CreateInvoiceFromOrderModal } from '../../components/purchase/CreateInvoiceFromOrderModal'
import { CreatedInvoicesModal } from '../../components/purchase/CreatedInvoicesModal'
import { ONE_ITEM_HINT } from '../../components/purchase/onePerItem'
import { OrderActionButton } from '../../components/purchase/OrderActionButton'
import { newOrderAbilities, orderAbilities, type OrderAbility } from '../../components/purchase/orderAbilities'
import { OrderApprovalCard } from '../../components/purchase/OrderApprovalCard'
import { InvoiceContainerChargesCard } from '../../components/purchase/InvoiceContainerChargesCard'
import { InvoiceContainersCard } from '../../components/purchase/InvoiceContainersCard'
import { ShippedInvoiceContainersCard } from '../../components/purchase/ShippedInvoiceContainersCard'
import { OrderContainersCard } from '../../components/purchase/OrderContainersCard'
import { PostedInvoiceChargesCard } from '../../components/purchase/PostedInvoiceChargesCard'
import { PurchaseChargesGrid } from '../../components/purchase/PurchaseChargesGrid'
import {
  chargeFromDto,
  chargeTotals,
  emptyCharge,
  isUnallocated,
  toChargeRequests,
  toManualAllocations,
  type AllocationTarget,
  type ChargeLine,
} from '../../components/purchase/purchaseCharges'
import { PurchaseHeaderCard, type PurchaseHeader, type PurchaseHeaderErrors } from '../../components/purchase/PurchaseHeaderCard'
import { PURCHASE_INVOICE, PURCHASE_RETURN, type PurchaseKind } from '../../components/purchase/purchaseKind'
import { defaultPurchasePrice, lineMaximum, purchaseUnitOf } from '../../components/purchase/purchaseLines'
import { PurchaseLinesGrid, type PurchaseLine } from '../../components/purchase/PurchaseLinesGrid'
import { SendToSupplierModal } from '../../components/purchase/SendToSupplierModal'
import { ImportInvoiceItemsWizard, type ImportedLine } from '../../components/sales/ImportInvoiceItemsWizard'
import { SalesTotals } from '../../components/sales/SalesTotals'
import { confirm } from '../../components/ui/confirm'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { refreshApprovalsMe, useApprovalsMe } from '../../hooks/useApprovalsMe'
import { pricingOf, useDocumentTypes } from '../../hooks/useDocumentTypes'
import { PERMISSIONS } from '../../navigation'
import { routes } from '../../routes'

let keySeed = 0
const nextKey = () => `pur-${++keySeed}`

function emptyLine(warehouseId: number | null): PurchaseLine {
  return {
    key: nextKey(), id: null, itemId: null, itemCode: '', itemName: '', itemUnitId: null, unitTypeName: '', packingFormula: 1,
    warehouseId,
    units: [], quantity: 1, unitPrice: null, discountPercent: 0, expiryDate: null, notes: '', onHandBase: null,
    importRowNumber: null, sourceLineId: null, sourceRemainingBase: null,
  }
}

/** Focuses an input a state change is about to draw; a few short retries because React commits on its own schedule. */
function focusWhenDrawn(selector: string, attempt = 0) {
  const input = document.querySelector<HTMLInputElement>(selector)
  if (input) {
    input.focus()
    input.select()
    return
  }
  if (attempt < 10) window.setTimeout(() => focusWhenDrawn(selector, attempt + 1), 40)
}

/**
 * One purchase document — an order, an invoice or a return — decided by `kind`.
 *
 * THE SALES INVOICE PAGE IN COST MODE, WITH A CHAIN. Same three modes decided by the status, same
 * header-lines-summary skeleton, same server-owned rules. What is the family's own: a supplier
 * whose currency the document takes; a cost on every line, defaulted from the item's last cost
 * at the document rate and typed over freely; and a source — an invoice made from an order, a
 * return from an invoice — that fixes the supplier and the branch and caps every line at what
 * remains on its source line, which the row shows as "Remaining: n" before the server refuses more.
 */
export function PurchaseDocumentPage({ kind }: { kind: PurchaseKind }) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { hasPermission, user } = useAuth()
  /* The approval rules and the reader's rights: what a NEW order offers (Create & approve, Create & send…). */
  const approvalsMe = useApprovalsMe()

  const documentId = id && id !== 'new' ? Number(id) : null
  const isNew = documentId === null

  const canCreate = hasPermission(kind.permissions.create)
  const canPost = hasPermission(kind.permissions.post)
  const canCancelDoc = hasPermission(kind.permissions.cancel)
  const canImport = hasPermission(PERMISSIONS.invoicesImport)
  /* "Add charge" on an invoice: its own charges on a draft (the create permission, through `editable`),
     a late charge (landed cost adjustment) on a posted local one, a container charge on an import. */
  const canViewLateCharges = hasPermission(PERMISSIONS.landedCostsView)
  const canAddLateCharge = hasPermission(PERMISSIONS.landedCostsCreate)
  const canPostLateCharges = hasPermission(PERMISSIONS.landedCostsPost)
  const canAddContainerCharge = hasPermission(PERMISSIONS.containerChargesCreate)
  const canCreateReturn = kind.code === 'PINV' && hasPermission(PURCHASE_RETURN.permissions.create)
  const canOverCapacity = hasPermission(PERMISSIONS.containersOverCapacity)
  const canConfirmContainers = hasPermission(PERMISSIONS.containersConfirm)

  const { byCode } = useDocumentTypes()
  const documentType = byCode(kind.code)
  const pricing = pricingOf(documentType, { mode: 'cost', editable: true })
  const priceEditable = pricing.mode === 'none' ? false : pricing.editable

  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [document, setDocument] = useState<PurchaseDocumentDto | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseLookupDto[]>([])
  /**
   * The warehouse a NEW line starts in — not the document's.
   *
   * The warehouse belongs to each line now; the branch's main warehouse seeds new rows so the
   * ordinary single-warehouse document still needs no picking, and the row's cell overrides it.
   */
  const [defaultWarehouseId, setDefaultWarehouseId] = useState<number | null>(null)
  const [suppliers, setSuppliers] = useState<PartyLookupDto[]>([])
  const [currencies, setCurrencies] = useState<CurrencyLookupDto[]>([])
  const [items, setItems] = useState<ItemLookupDto[]>([])

  const [header, setHeader] = useState<PurchaseHeader>({
    documentDate: isoDate(new Date()), expectedDate: null, branchId: null, supplierId: null,
    currencyId: null, rateType: 1, exchangeRate: null, supplierReference: '', exporterReference: '', commercialInvoiceNo: '',
    receiptMode: '1', notes: '',
  })
  const [errors, setErrors] = useState<PurchaseHeaderErrors>({})
  const [lines, setLines] = useState<PurchaseLine[]>([])

  const [rate, setRate] = useState<PurchaseRateResolutionDto | null>(null)
  const [rateFor, setRateFor] = useState('')
  /** True once the reader changed the currency, the type or the date: the next lookup may overwrite the rate. */
  const rateDirty = useRef(false)
  const currencyTouched = useRef(false)

  const [attachmentsOpen, setAttachmentsOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const [closeBusy, setCloseBusy] = useState(false)
  /* An order shipped in containers: Add Container and the invoice made from its containers. */
  const [addContainerOpen, setAddContainerOpen] = useState(false)
  const [autoPlanOpen, setAutoPlanOpen] = useState(false)
  /* The containers ticked on the order's Containers card: kept here, the card unmounts while the order reloads. */
  const [containerSelection, setContainerSelection] = useState<ContainerListDto[]>([])
  const [invoiceFromContainersOpen, setInvoiceFromContainersOpen] = useState(false)
  /* "Create Purchase Invoice" on an order: one draft per item, so a dialog says how many first. */
  const [createInvoiceOpen, setCreateInvoiceOpen] = useState(false)
  /** Several invoices made at once — one per item, or a split — listed rather than one of them opened. */
  const [createdInvoices, setCreatedInvoices] = useState<CreatedPurchaseInvoiceDto[] | null>(null)
  const [splitting, setSplitting] = useState(false)
  const [invoiceCandidates, setInvoiceCandidates] = useState(0)
  /* An imported invoice's "Add charge": the container charge dialog, on the invoice's containers. */
  const [containerChargeOpen, setContainerChargeOpen] = useState(false)

  /* AN ORDER'S APPROVAL, as the server answers it for this reader: who may decide, what waits, the
     history. Read again after every change of the order — every approval action ends in one. */
  const [approval, setApproval] = useState<PurchaseOrderApprovalDto | null>(null)
  const [approvalFailed, setApprovalFailed] = useState(false)
  const [approvalBusy, setApprovalBusy] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [supplierOpen, setSupplierOpen] = useState(false)

  /* THE CHARGES ARE THEIR OWN DOCUMENT HALF: the lines are the supplier's bill, the charges are
     everybody else's, and the API saves them with two different calls. Only a purchase invoice has
     them; an order commits nothing and a return gives goods back at the cost they came in at. */
  const [charges, setCharges] = useState<ChargeLine[]>([])
  const [chargeTypes, setChargeTypes] = useState<ChargeTypeLookupDto[]>([])

  const dirty = useRef(false)
  const markDirty = () => {
    dirty.current = true
  }

  const baseCode = document?.baseCurrencyCode ?? rate?.baseCurrencyCode ?? 'USD'
  const status = document?.status ?? 'Draft'
  /** Only a purchase invoice carries charges: an order commits nothing, a return gives goods back at cost. */
  const hasCharges = kind.code === PURCHASE_INVOICE.code
  const readOnly = !isNew && status !== 'Draft'
  /** An invoice made from containers: lines grouped by container, charges on the containers, exporter ref. required. */
  const containerBound = kind.code === 'PINV' && document?.isContainerBound === true
  /* "Shipped in containers" (script 43): the switch as the reader has it now, and as it is saved. An invoice of an
     order shipped in containers is received at the offload of the containers it is linked to, now or later. */
  const shipped = kind.code === 'PINV' && header.receiptMode === '2'
  const savedShipped = kind.code === 'PINV' && document?.shippedInContainers === true
  const showShippedCard = kind.code === 'PINV' && document != null && document.sourceDocumentId !== null && (shipped || savedShipped)
  const editable = !readOnly && (isNew ? canCreate : canCreate && document?.canEdit === true)
  const fromSource = document?.sourceDocumentId != null
  /* A SUPPLIER INVOICE HOLDS ONE ITEM: the item of its first line, which every other line must share. */
  const invoiceItemId = kind.code === 'PINV' ? (lines.find((line) => line.itemId !== null)?.itemId ?? null) : null
  /* A draft saved with several items before that rule: it is split before it can be posted. */
  const savedItemCount = kind.code === 'PINV' && document ? new Set(document.lines.map((line) => line.itemId)).size : 0

  /* ── loading ──────────────────────────────────────────────────────────────────────────────── */

  useEffect(() => {
    branchesApi
      .lookup()
      .then((rows) => {
        setBranches(rows)
        if (!isNew || rows.length === 0) return
        const main = rows.find((b) => b.isMainBranch) ?? rows[0]
        setHeader((current) => (current.branchId === null ? { ...current, branchId: String(main.id) } : current))
      })
      .catch(() => notify.error('Branches could not be loaded.'))
    currenciesApi.lookup().then(setCurrencies).catch(() => notify.error('Currencies could not be loaded.'))
    partiesApi.lookup({ partyType: 'Supplier' }).then(setSuppliers).catch(() => notify.error('Suppliers could not be loaded.'))
    itemsApi.lookup().then(setItems).catch(() => {})
    if (kind.code === PURCHASE_INVOICE.code) {
      chargeTypesApi.lookup().then(setChargeTypes).catch(() => notify.error('Charge types could not be loaded.'))
    }
    // isNew comes from the route; it does not change without a remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * The source's lines, for the cap on each of ours. Read once per source, because "remaining" on
   * the source is what the SERVER will compare with — our own draft's quantities are not in it yet.
   */
  const loadSourceRemaining = useCallback(async (doc: PurchaseDocumentDto) => {
    if (doc.sourceDocumentId === null) return
    try {
      const source = await purchaseDocumentsApi.get(doc.sourceDocumentId)
      const remaining = new Map(source.lines.map((l) => [l.id, l.remainingBase]))
      /* An invoice from containers is also capped by its CONTAINER line: loaded − invoiced elsewhere,
         i.e. what is still available on it plus what this draft already holds. */
      const containerCap = new Map<number, number>()
      if (doc.isContainerBound) {
        const candidates = await containersApi.invoiceCandidates({ purchaseOrderId: doc.sourceDocumentId, includeAll: true })
        for (const c of candidates) containerCap.set(c.containerLineId, c.availableBase)
      }
      setLines((current) =>
        current.map((line) => {
          const fromSourceLine = line.sourceLineId !== null && remaining.has(line.sourceLineId) ? (remaining.get(line.sourceLineId) ?? null) : null
          const fromContainer = line.containerLineId != null && containerCap.has(line.containerLineId)
            ? (containerCap.get(line.containerLineId) ?? 0) + (line.savedQuantityBase ?? 0)
            : null
          const caps = [fromSourceLine, fromContainer].filter((cap): cap is number => cap !== null)
          return caps.length === 0 ? line : { ...line, sourceRemainingBase: Math.min(...caps) }
        }),
      )
    } catch {
      /* The cap is a courtesy; the server enforces it either way. */
    }
  }, [])

  /**
   * The manual splits, re-pointed at the ids a save produced.
   *
   * SAVING REPLACES THE LINES, so every line comes back with a NEW id and a split captured against
   * the old ones would be refused ("a manual allocation refers to a line that does not belong to
   * the invoice"). The lines keep their order, so position is what carries a split across a save.
   */
  const remapAllocations = useCallback(
    (allocations: Record<number, number>, oldIds: number[], newIds: number[]): Record<number, number> => {
      const byPosition = new Map(oldIds.map((id, index) => [id, newIds[index]]))
      const out: Record<number, number> = {}
      for (const [lineId, amount] of Object.entries(allocations)) {
        const next = byPosition.get(Number(lineId))
        if (next !== undefined) out[next] = amount
      }
      return out
    },
    [],
  )

  const applyDocument = useCallback((doc: PurchaseDocumentDto, keepAllocations?: Map<number, Record<number, number>>) => {
    setDocument(doc)
    setHeader({
      documentDate: doc.documentDate.slice(0, 10),
      expectedDate: doc.expectedDate ? doc.expectedDate.slice(0, 10) : null,
      branchId: String(doc.branchId),
      supplierId: String(doc.supplierId),
      currencyId: String(doc.currencyId),
      rateType: doc.rateType,
      exchangeRate: doc.exchangeRate,
      supplierReference: doc.supplierReference ?? '',
      exporterReference: doc.exporterReference ?? '',
      commercialInvoiceNo: doc.commercialInvoiceNo ?? '',
      receiptMode: doc.receiptMode === 2 ? '2' : '1',
      notes: doc.notes ?? '',
    })
    setLines(
      doc.lines.map((line) => ({
        key: nextKey(),
        id: line.id,
        itemId: line.itemId,
        itemCode: line.itemCode,
        itemName: line.itemName,
        itemUnitId: line.itemUnitId,
        warehouseId: line.warehouseId,
        unitTypeName: line.unitTypeName,
        packingFormula: line.packingFormula,
        units: [],
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountPercent: line.discountPercent,
        expiryDate: line.expiryDate ? line.expiryDate.slice(0, 10) : null,
        notes: line.notes ?? '',
        onHandBase: line.onHandBase,
        importRowNumber: line.importRowNumber,
        sourceLineId: line.sourceLineId,
        sourceRemainingBase: null,
        containerLineId: line.containerLineId,
        containerId: line.containerId,
        containerRef: line.containerRef,
        containerNo: line.containerNo,
        containerStatus: line.containerStatus,
        estimatedLandedCostBase: line.estimatedLandedCostBase,
        savedQuantityBase: line.quantityBase,
        transitBase: line.transitBase,
        fobCostBase: line.fobCostBase,
        allocatedChargesBase: line.allocatedChargesBase,
        landedCostBase: line.landedCostBase,
      })),
    )
    /* The server stores a manual split but its read does not return it per line, so the page keeps
       what the reader typed — re-pointed at the new ids — rather than blanking the panel. */
    setCharges(doc.charges.filter((c) => c.documentKind === 'PINV').map((c) => chargeFromDto(c, keepAllocations?.get(c.lineNumber) ?? {})))
    currencyTouched.current = true
    rateDirty.current = false
    dirty.current = false
    if (doc.status === 'Draft') void loadSourceRemaining(doc)
  }, [loadSourceRemaining])

  const reload = useCallback(async () => {
    if (documentId === null) return
    setLoading(true)
    try {
      const doc = await purchaseDocumentsApi.get(documentId)
      if (doc.documentTypeCode !== kind.code) {
        // THE DOCUMENT DECIDES, NOT THE URL: an order opened under another kind's route moves to its own.
        void navigate(routes.purchaseDocument(doc.documentTypeCode, doc.id), { replace: true })
        return
      }
      applyDocument(doc)
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : `The ${kind.noun} could not be loaded.`)
    } finally {
      setLoading(false)
    }
  }, [documentId, applyDocument, kind.code, kind.noun, navigate])

  useEffect(() => {
    void reload()
  }, [reload])

  /**
   * The document again WITHOUT the page-wide loader. A charge added or posted changes the costs and
   * the charge cards, not the page — and the full reload would unmount the card holding the result
   * of a posting the reader is still looking at.
   */
  const refreshQuietly = useCallback(async () => {
    if (documentId === null) return
    try {
      applyDocument(await purchaseDocumentsApi.get(documentId))
    } catch {
      /* The figures stay as they were; the next full load says what went wrong. */
    }
  }, [documentId, applyDocument])

  const loadApproval = useCallback(async (orderId: number) => {
    try {
      setApproval(await approvalsApi.get(orderId))
      setApprovalFailed(false)
    } catch {
      /* Without it the page offers the plain posting, and the server refuses it with its own sentence
         if the order needs approval after all. */
      setApprovalFailed(true)
    }
  }, [])

  useEffect(() => {
    if (kind.code !== 'PO' || !document) return
    void loadApproval(document.id)
  }, [kind.code, document, loadApproval])

  /* An approved order with containers: is anything loaded and not yet invoiced? That is what offers
     "Create Invoice from Containers…". */
  useEffect(() => {
    if (kind.code !== 'PO' || !document || document.containerCount === 0) {
      setInvoiceCandidates(0)
      return
    }
    let live = true
    containersApi
      .invoiceCandidates({ purchaseOrderId: document.id })
      .then((rows) => live && setInvoiceCandidates(rows.length))
      .catch(() => live && setInvoiceCandidates(0))
    return () => {
      live = false
    }
  }, [kind.code, document])

  useEffect(() => {
    if (header.branchId === null) return
    let cancelled = false
    warehousesApi
      .lookup(true, Number(header.branchId))
      .then((rows) => {
        if (cancelled) return
        setWarehouses(rows)
        setDefaultWarehouseId((current) => {
          if (current !== null) return current
          const main = rows.find((w) => w.isMainWarehouse) ?? rows[0]
          return main ? main.id : null
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [header.branchId])

  /* The rate follows the currency, the type and the date — but overwrites a loaded document's own
     rate only once the reader changed one of the three. */
  const rateKey = header.currencyId ? `${header.currencyId}|${header.rateType}|${header.documentDate}` : ''
  useEffect(() => {
    if (!header.currencyId) return
    const key = `${header.currencyId}|${header.rateType}|${header.documentDate}`
    const controller = new AbortController()
    purchaseDocumentsApi
      .rate(Number(header.currencyId), header.rateType, header.documentDate || null, controller.signal)
      .then((answer) => {
        setRate(answer)
        setRateFor(key)
        setHeader((current) =>
          rateDirty.current || current.exchangeRate === null
            ? { ...current, exchangeRate: answer.isBaseCurrency ? 1 : answer.rate }
            : current,
        )
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setRate(null)
        setRateFor(key)
        notify.error(error instanceof ApiError ? error.message : 'The exchange rate could not be looked up.')
      })
    return () => controller.abort()
  }, [header.currencyId, header.rateType, header.documentDate])

  const rateLoading = rateKey !== '' && rateFor !== rateKey
  const currency = currencies.find((c) => String(c.id) === header.currencyId) ?? null
  const currencyCode = document?.currencyCode ?? rate?.currencyCode ?? currency?.currencyCode ?? 'USD'
  const decimalPlaces = document?.decimalPlaces ?? rate?.decimalPlaces ?? currency?.decimalPlaces ?? 2
  const isBaseCurrency = document ? document.isBaseCurrency : (rate?.isBaseCurrency ?? currency?.isBaseCurrency ?? true)

  /* ── header ───────────────────────────────────────────────────────────────────────────────── */

  function changeHeader(patch: Partial<PurchaseHeader>) {
    markDirty()
    const next = { ...patch }
    if (next.currencyId !== undefined) currencyTouched.current = true
    /* THE SUPPLIER SETS THE CURRENCY, until the reader picks one: their own, else the base currency. */
    if (next.supplierId && !currencyTouched.current) {
      const supplier = suppliers.find((s) => String(s.id) === next.supplierId)
      const base = currencies.find((c) => c.isBaseCurrency)
      const chosen = supplier?.defaultCurrencyId ?? base?.id ?? null
      if (chosen !== null) next.currencyId = String(chosen)
    }
    if (next.currencyId !== undefined || next.rateType !== undefined || next.documentDate !== undefined) rateDirty.current = true
    /* A BRANCH CHANGE INVALIDATES EVERY LINE'S WAREHOUSE: warehouses belong to one branch, so
       a row still holding the old one would be refused on save. Clearing them shows the gap. */
    if (next.branchId !== undefined) {
      setWarehouses([])
      setDefaultWarehouseId(null)
      setLines((current) => current.map((line) => ({ ...line, warehouseId: null, onHandBase: null })))
    }
    setErrors({})
    setHeader((current) => ({ ...current, ...next }))
  }

  /* ── pricing and stock ────────────────────────────────────────────────────────────────────── */

  const refreshOnHand = useCallback(
    /* THE WAREHOUSE IS THE CALLER'S, not the header's: every row may receive into a different one,
       so a lookup that read one shared warehouse would show the wrong stock on most rows. */
    async (key: string, itemId: number, warehouseId: number | null) => {
      if (warehouseId === null) return
      try {
        const { onHandBase } = await inventoryLookupsApi.onHand(itemId, warehouseId)
        setLines((current) => current.map((l) => (l.key === key ? { ...l, onHandBase } : l)))
      } catch {}
    },
    [],
  )

  const patchLine = useCallback((key: string, patch: Partial<PurchaseLine>) => {
    markDirty()
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch, error: undefined } : line)))
  }, [])

  /** The line takes the unit and the cost that goes with it: last cost × packing × rate. */
  function priceLine(key: string, unit: ItemUnitDto, lastCost: number | null) {
    const price = defaultPurchasePrice(lastCost, unit.packingFormula, header.exchangeRate)
    setLines((current) =>
      current.map((l) => (l.key === key ? { ...l, itemUnitId: unit.id, unitTypeName: unit.unitTypeName, packingFormula: unit.packingFormula, unitPrice: price } : l)),
    )
  }

  const chooseItem = useCallback(
    async (key: string, itemId: number) => {
      markDirty()
      try {
        const details = await itemsApi.get(itemId)
        const unit = purchaseUnitOf(details.units)
        setLines((current) =>
          current.map((line) =>
            line.key === key
              ? { ...line, itemId: details.id, itemCode: details.itemCode, itemName: details.itemName, units: details.units, itemUnitId: unit?.id ?? null, unitTypeName: unit?.unitTypeName ?? '', packingFormula: unit?.packingFormula ?? 1, unitPrice: unit ? defaultPurchasePrice(details.lastCost, unit.packingFormula, header.exchangeRate) : null, onHandBase: null, error: undefined }
              : line,
          ),
        )
        void refreshOnHand(key, details.id, lines.find((l) => l.key === key)?.warehouseId ?? defaultWarehouseId)
        focusWhenDrawn(`[data-line-qty="${key}"] input`)
      } catch (error) {
        notify.error(error instanceof ApiError ? error.message : 'The item could not be loaded.')
      }
    },
    [refreshOnHand, header.exchangeRate, lines, defaultWarehouseId],
  )

  const addScanned = useCallback(
    async (item: ItemListDto) => {
      const held = kind.code === 'PINV' ? (lines.find((line) => line.itemId !== null)?.itemId ?? null) : null
      if (held !== null && held !== item.id) {
        notify.error(ONE_ITEM_HINT)
        return
      }
      markDirty()
      let details
      try {
        details = await itemsApi.get(item.id)
      } catch (error) {
        notify.error(error instanceof ApiError ? error.message : 'The item could not be loaded.')
        return
      }
      const unit = purchaseUnitOf(details.units)
      if (!unit) {
        notify.error(`${details.itemCode} has no units configured.`)
        return
      }
      const existing = lines.find((l) => l.itemId === details.id && l.itemUnitId === unit.id)
      if (existing) {
        patchLine(existing.key, { quantity: existing.quantity + 1 })
        focusWhenDrawn(`[data-line-qty="${existing.key}"] input`)
        return
      }
      const key = nextKey()
      setLines((current) => [
        ...current,
        { ...emptyLine(defaultWarehouseId), key, itemId: details.id, itemCode: details.itemCode, itemName: details.itemName, units: details.units, itemUnitId: unit.id, unitTypeName: unit.unitTypeName, packingFormula: unit.packingFormula, unitPrice: defaultPurchasePrice(details.lastCost, unit.packingFormula, header.exchangeRate) },
      ])
      void refreshOnHand(key, details.id, defaultWarehouseId)
      focusWhenDrawn(`[data-line-qty="${key}"] input`)
    },
    [kind.code, lines, patchLine, refreshOnHand, header.exchangeRate, defaultWarehouseId],
  )

  async function loadUnits(key: string) {
    const line = lines.find((l) => l.key === key)
    if (!line?.itemId) return
    try {
      const details = await itemsApi.get(line.itemId)
      setLines((current) => current.map((l) => (l.key === key ? { ...l, units: details.units } : l)))
    } catch {}
  }

  async function unitChosen(key: string, unit: ItemUnitDto) {
    markDirty()
    const line = lines.find((l) => l.key === key)
    let lastCost: number | null = null
    if (line?.itemId) {
      try {
        lastCost = (await itemsApi.get(line.itemId)).lastCost
      } catch {}
    }
    priceLine(key, unit, lastCost)
  }

  const patchCharge = useCallback((key: string, patch: Partial<ChargeLine>) => {
    markDirty()
    setCharges((current) => current.map((line) => (line.key === key ? { ...line, ...patch, error: undefined } : line)))
  }, [])

  function addCharge() {
    markDirty()
    // A new charge starts in the invoice's own currency at the invoice's rate: most of them are.
    setCharges((current) => [
      ...current,
      { ...emptyCharge(header.currencyId === null ? null : Number(header.currencyId)), exchangeRate: header.exchangeRate },
    ])
  }

  function removeCharge(key: string) {
    markDirty()
    setCharges((current) => current.filter((line) => line.key !== key))
  }

  /** A charge in another currency takes that currency's rate for the document date, looked up once. */
  const chargeCurrencyChosen = useCallback(
    async (key: string, currencyId: number) => {
      try {
        const answer = await purchaseDocumentsApi.rate(currencyId, 1, header.documentDate || null)
        setCharges((current) =>
          current.map((line) =>
            line.key === key ? { ...line, exchangeRate: answer.isBaseCurrency ? 1 : answer.rate } : line,
          ),
        )
      } catch {
        /* No rate to be found: the reader types one, and the server refuses a charge without it. */
      }
    },
    [header.documentDate],
  )

  function addEmptyLine() {
    markDirty()
    setLines((current) => [...current, emptyLine(defaultWarehouseId)])
    focusWhenDrawn(`[data-line-item="${lines.length}"] input`)
  }

  function removeLine(key: string) {
    markDirty()
    setLines((current) => current.filter((line) => line.key !== key))
  }

  async function clearLines() {
    const go = await confirm({ title: 'Clear all lines', message: `Remove all ${lines.length} line(s) from this ${kind.noun}?`, confirmLabel: 'Clear', danger: true })
    if (go) {
      markDirty()
      setLines([])
    }
  }

  function appendImported(imported: ImportedLine[]) {
    markDirty()
    const added: PurchaseLine[] = imported.map((line) => ({
      ...emptyLine(line.warehouseId ?? defaultWarehouseId),
      itemId: line.itemId,
      itemCode: line.itemCode,
      itemName: line.itemName,
      itemUnitId: line.itemUnitId,
      unitTypeName: line.unitTypeName,
      packingFormula: line.packingFormula,
      quantity: line.quantity,
      // In cost mode the wizard's price column IS the unit cost; a blank one is the item's last cost.
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent,
      expiryDate: line.expiryDate,
      notes: line.notes ?? '',
      importRowNumber: line.importRowNumber,
    }))
    setLines((current) => [...current, ...added])
    notify.success(`${imported.length} line(s) imported.`)
    for (const line of added) if (line.itemId !== null) void refreshOnHand(line.key, line.itemId, line.warehouseId)
  }

  /* ── totals ───────────────────────────────────────────────────────────────────────────────── */

  /* A manual split points at LINE IDS, so only lines the server has already saved can carry one —
     a line typed a moment ago has no id yet, and the page says so rather than sending a null. */
  const allocationTargets: AllocationTarget[] = useMemo(
    () =>
      (document?.lines ?? []).map((line) => ({
        id: line.id,
        lineNo: line.lineNo,
        itemCode: line.itemCode,
        itemName: line.itemName,
        quantityBase: line.quantityBase,
      })),
    [document],
  )

  const chargeSummary = useMemo(() => chargeTotals(charges), [charges])

  const totals = useMemo(() => {
    let quantity = 0, subtotal = 0, discount = 0
    for (const line of lines) {
      quantity += line.quantity * (line.packingFormula || 1)
      const gross = line.quantity * (line.unitPrice ?? 0)
      subtotal += gross
      discount += gross * (line.discountPercent / 100)
    }
    return { items: lines.length, quantity, subtotal, discount, total: subtotal - discount }
  }, [lines])

  /* ── saving ───────────────────────────────────────────────────────────────────────────────── */

  function validate(): boolean {
    const next: PurchaseHeaderErrors = {}
    if (!header.documentDate) next.documentDate = 'Choose a date.'
    if (!header.branchId) next.branchId = 'Choose a branch.'
    if (!header.supplierId) next.supplierId = 'Choose a supplier.'
    if (!header.currencyId) next.currencyId = 'Choose a currency.'
    if (header.currencyId && !isBaseCurrency && header.exchangeRate === null) next.exchangeRate = 'Enter an exchange rate.'
    setErrors(next)
    if (Object.keys(next).length > 0) {
      notify.error('Some header fields still need filling in.')
      return false
    }
    if (lines.length === 0) {
      notify.error('Add at least one line before saving.')
      return false
    }
    const bad = lines.findIndex((l) => !l.itemId || !l.itemUnitId || l.quantity < 1)
    if (bad >= 0) {
      notify.error(`Line ${bad + 1} needs an item, a unit and a quantity of at least 1.`)
      return false
    }
    const unallocated = charges.findIndex(isUnallocated)
    if (unallocated >= 0) {
      notify.error(`Charge ${unallocated + 1} is allocated manually and has not been fully allocated yet.`)
      return false
    }

    const incompleteCharge = charges.findIndex((c) => c.chargeTypeId === null || c.amount === null || c.amount <= 0)
    if (incompleteCharge >= 0) {
      notify.error(`Charge ${incompleteCharge + 1} needs a charge type and an amount above zero.`)
      return false
    }

    const over = lines.findIndex((l) => {
      const max = lineMaximum(l)
      return max !== null && l.quantity > max
    })
    if (over >= 0) {
      const line = lines[over]
      const message = `Line ${over + 1}: ${line.itemCode} - only ${formatNumber(lineMaximum(line) ?? 0)} remain on the source line.`
      setLines((current) => current.map((l, i) => (i === over ? { ...l, error: message } : l)))
      notify.error(message)
      return false
    }
    return true
  }

  function toRequest(): SavePurchaseDocumentRequest {
    return {
      documentTypeCode: kind.code,
      documentDate: header.documentDate,
      expectedDate: header.expectedDate,
      branchId: Number(header.branchId),
      // Omitted on purpose: the warehouse is a LINE's now, and the server keeps the first one.
      warehouseId: null,
      supplierId: Number(header.supplierId),
      currencyId: Number(header.currencyId),
      rateType: header.rateType,
      exchangeRate: isBaseCurrency ? null : header.exchangeRate,
      supplierReference: header.supplierReference.trim() || null,
      ...(kind.code === 'PINV'
        ? {
            exporterReference: header.exporterReference.trim() || null,
            commercialInvoiceNo: header.commercialInvoiceNo.trim() || null,
            receiptMode: Number(header.receiptMode) as ReceiptMode,
            shippedInContainers: header.receiptMode === '2',
          }
        : {}),
      notes: header.notes.trim() || null,
      sourceDocumentId: document?.sourceDocumentId ?? null,
      rowVersion: document?.rowVersion ?? null,
      lines: lines.map((line, index) => ({
        lineNo: index + 1,
        itemId: line.itemId!,
        itemUnitId: line.itemUnitId!,
        warehouseId: line.warehouseId!,
        expiryDate: line.expiryDate,
        quantity: line.quantity,
        unitPrice: priceEditable ? line.unitPrice : null,
        discountPercent: line.discountPercent,
        importRowNumber: line.importRowNumber,
        notes: line.notes.trim() || null,
        sourceLineId: line.sourceLineId,
        // Every line of an invoice from containers goes back with its container line, or the server refuses the save.
        containerLineId: line.containerLineId ?? null,
      })),
    }
  }

  function showApiError(error: unknown) {
    if (!(error instanceof ApiError)) {
      notify.error(`The ${kind.noun} could not be saved.`)
      return
    }
    setLines((current) => current.map((line) => ({ ...line, error: undefined })))
    setCharges((current) => current.map((line) => ({ ...line, error: undefined })))

    // The charges are numbered apart from the lines, and the server says which it judged.
    const chargeMatch = /^Charge (\d+):/.exec(error.message)
    if (chargeMatch) {
      const index = Number(chargeMatch[1]) - 1
      setCharges((current) => current.map((line, i) => (i === index ? { ...line, error: error.message } : line)))
    }

    const match = /^Line (\d+):/.exec(error.message)
    if ((error.code === 'VALIDATION' || error.code === 'SOURCE_INVALID' || error.code === 'NO_PRICE') && match) {
      const index = Number(match[1]) - 1
      setLines((current) => current.map((line, i) => (i === index ? { ...line, error: error.message } : line)))
    } else if (error.code === 'INSUFFICIENT_STOCK') {
      const stock = /^Insufficient stock for (\S+) in/.exec(error.message)
      if (stock) {
        setLines((current) => current.map((line) => (line.itemCode === stock[1] ? { ...line, error: error.message } : line)))
        for (const line of lines) if (line.itemCode === stock[1] && line.itemId) void refreshOnHand(line.key, line.itemId, line.warehouseId)
      }
    }
    if (error.code === 'EXPORTER_REFERENCE_REQUIRED') setErrors((current) => ({ ...current, exporterReference: error.message }))
    notify.error(error.message)
    if (error.code === 'CONCURRENCY') void reload()
  }

  async function saveDraft(): Promise<PurchaseDocumentDto | null> {
    if (!validate()) return null
    setSaving(true)
    try {
      const oldLineIds = allocationTargets.map((t) => t.id)
      const saved = documentId === null ? await purchaseDocumentsApi.create(toRequest()) : await purchaseDocumentsApi.update(documentId, toRequest())
      const newLineIds = saved.lines.map((l) => l.id)

      /* THE LINES FIRST, THEN THE CHARGES. A manual allocation points at line ids, and a new
         invoice has none until its lines are saved — so the charges go in a second call, against
         the version the first one just produced and the ids it just handed out. */
      const remapped = charges.map((charge) => ({
        ...charge,
        allocations: remapAllocations(charge.allocations, oldLineIds, newLineIds),
      }))

      const withCharges = hasCharges && !saved.isContainerBound ? await purchaseDocumentsApi.setCharges(saved.id, {
        charges: toChargeRequests(remapped),
        manualAllocations: toManualAllocations(remapped),
        rowVersion: saved.rowVersion,
      }) : saved

      applyDocument(withCharges, new Map(remapped.map((c, index) => [index + 1, c.allocations])))
      notify.success(documentId === null ? 'Draft created.' : 'Draft saved.')
      if (documentId === null) navigate(routes.purchaseDocument(kind.code, withCharges.id), { replace: true })
      return withCharges
    } catch (error) {
      showApiError(error)
      return null
    } finally {
      setSaving(false)
    }
  }

  async function saveAndPost() {
    const saved = await saveDraft()
    if (!saved) return
    // The save re-reads the source for the caps; let that finish before posting rather than have
    // the read and the posting fight over the same order rows at the same moment.
    await loadSourceRemaining(saved)
    const go = await confirm({
      title: `${kind.postVerb} this ${kind.noun}?`,
      message: kind.postConfirm(saved.warehouseName),
      confirmLabel: kind.postVerb,
    })
    if (!go) return
    setSaving(true)
    try {
      applyDocument(await purchaseDocumentsApi.post(saved.id, saved.rowVersion))
      notify.success(kind.code === 'PO' ? 'Purchase order confirmed.' : `${kind.title} posted.`)
    } catch (error) {
      showApiError(error)
    } finally {
      setSaving(false)
    }
  }

  async function cancelDocument(reason: string) {
    if (!document) return
    setCancelBusy(true)
    try {
      applyDocument(await purchaseDocumentsApi.cancel(document.id, reason, document.rowVersion))
      notify.success(`${kind.title} cancelled.`)
      setCancelOpen(false)
    } catch (error) {
      showApiError(error)
    } finally {
      setCancelBusy(false)
    }
  }

  async function closeOrder(reason: string | null) {
    if (!document) return
    setCloseBusy(true)
    try {
      applyDocument(await purchaseDocumentsApi.close(document.id, reason, document.rowVersion))
      notify.success('Purchase order closed.')
      setCloseOpen(false)
    } catch (error) {
      showApiError(error)
    } finally {
      setCloseBusy(false)
    }
  }

  async function createFromThis() {
    if (!document) return
    if (kind.code === 'PO') {
      setCreateInvoiceOpen(true)
      return
    }
    const target = PURCHASE_RETURN
    const go = await confirm({
      title: `Create ${target.title.toLowerCase()}`,
      message: `Create a purchase return draft from ${document.documentNumber} with everything that can still be returned?`,
      confirmLabel: 'Create',
    })
    if (!go) return
    setSaving(true)
    try {
      const created = await purchaseDocumentsApi.createReturn(document.id)
      notify.success(`${target.title} draft created.`)
      void navigate(routes.purchaseDocument(target.code, created.id))
    } catch (error) {
      showApiError(error)
    } finally {
      setSaving(false)
    }
  }

  /**
   * A draft invoice holding several items (saved before one item per invoice) into one invoice per item.
   * It works on the SAVED invoice, so unsaved changes are saved or discarded first.
   */
  async function splitByItem() {
    if (!document) return
    if (dirty.current) {
      notify.error('Save or discard your changes first: Split by item works on the saved invoice.')
      return
    }
    const go = await confirm({
      title: 'Split by item',
      message: `Split ${documentLabel} into ${savedItemCount} invoices, one per item? The item of its first line stays on it; every other item moves to a new draft invoice with the same header.`,
      confirmLabel: 'Split by item',
    })
    if (!go) return
    setSplitting(true)
    try {
      const answer = await purchaseDocumentsApi.splitByItem(document.id, document.rowVersion)
      notify.success(`Split into ${answer.invoices.length} invoices, one per item.`)
      setCreatedInvoices(answer.invoices)
      await refreshQuietly()
    } catch (error) {
      showApiError(error)
    } finally {
      setSplitting(false)
    }
  }

  /** "Go to the order's invoices": on the order, its Linked Documents card; on an invoice, its order. */
  function goToOrderInvoices() {
    setCreatedInvoices(null)
    if (kind.code === 'PO') {
      window.document.querySelector('[data-linked-documents]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } else if (document?.sourceDocumentId != null) {
      void navigate(routes.purchaseOrder(document.sourceDocumentId))
    }
  }

  /* ── approval (orders) ────────────────────────────────────────────────────────────────────── */

  /** Unsaved changes go in first: what is sent or approved is what the reader sees. */
  async function savedOrder(): Promise<PurchaseDocumentDto | null> {
    if (!document) return null
    return editable && dirty.current ? saveDraft() : document
  }

  /** After any approval action: the order (which reloads its approval) and the menu badge. */
  function afterApproval() {
    void refreshQuietly()
    void refreshApprovalsMe()
  }

  function approvalRefused(error: unknown) {
    notify.error(error instanceof ApiError ? error.message : 'The approval could not be updated.')
    // The order moved under the reader (decided elsewhere, a link expired, changed meanwhile): show what is true now.
    if (error instanceof ApiError && (error.status === 409 || error.status === 410)) afterApproval()
  }

  async function runApproval(action: () => Promise<void>) {
    setApprovalBusy(true)
    try {
      await action()
      afterApproval()
    } catch (error) {
      approvalRefused(error)
    } finally {
      setApprovalBusy(false)
    }
  }

  async function sendForApproval() {
    const order = await savedOrder()
    if (!order) return
    await runApproval(async () => notify.success((await approvalsApi.sendForApproval(order.id, order.rowVersion)).message))
  }

  async function approveNow() {
    const order = await savedOrder()
    if (!order) return
    const go = await confirm({ title: 'Approve and post', message: 'Approve and post this order now?', confirmLabel: 'Approve & post' })
    if (!go) return
    await runApproval(async () => announceApproved(await approvalsApi.approveNow(order.id, order.rowVersion)))
  }

  async function approveOrder() {
    if (!document) return
    // As on the Approvals page: approving posts the order and emails it - one click is not enough for that.
    const go = await confirm({
      title: 'Approve purchase order',
      message: 'Approve this order? It will be posted and sent to the supplier.',
      confirmLabel: 'Approve',
    })
    if (!go) return
    await runApproval(async () => announceApproved(await approvalsApi.approve(document.id, document.rowVersion)))
  }

  async function rejectOrder(reason: string) {
    if (!document) return
    await runApproval(async () => {
      await approvalsApi.reject(document.id, reason, document.rowVersion)
      notify.success('Rejected: the order is a draft again.')
      setRejectOpen(false)
    })
  }

  async function resendApproval() {
    if (!document) return
    await runApproval(async () => notify.success((await approvalsApi.resend(document.id, document.rowVersion)).message))
  }

  async function withdrawApproval() {
    if (!document) return
    const go = await confirm({
      title: 'Withdraw the request',
      message: 'The order becomes a draft again and the links already emailed stop working.',
      confirmLabel: 'Withdraw',
      danger: true,
    })
    if (!go) return
    await runApproval(async () => {
      await approvalsApi.withdraw(document.id, document.rowVersion)
      notify.success('Request withdrawn: the order is a draft again.')
    })
  }

  async function sendToSupplier(payload: { to: string; cc: string | null; message: string | null }) {
    if (!document) return
    setApprovalBusy(true)
    try {
      const result = await approvalsApi.sendToSupplier(document.id, payload)
      if (result.sent) notify.success(result.message)
      else notify.warning(result.message)
      setSupplierOpen(false)
      void loadApproval(document.id)
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The email could not be queued.')
    } finally {
      setApprovalBusy(false)
    }
  }

  /** A NEW order sent for approval in one call — or posted at once when it needs none. A refusal keeps the draft. */
  async function createAndSend() {
    if (!validate()) return
    setSaving(true)
    try {
      const result = await approvalsApi.createAndSend(toRequest())
      dirty.current = false
      if (result.posted || result.approvalRequested) notify.success(result.message)
      else notify.warning(result.message)
      void refreshApprovalsMe()
      void navigate(routes.purchaseOrder(result.id), { replace: true })
    } catch (error) {
      showApiError(error)
    } finally {
      setSaving(false)
    }
  }

  /** A NEW order approved at once by its in-app approver author (or posted when it needs no approval). */
  async function createAndApprove() {
    if (!validate()) return
    setSaving(true)
    try {
      const result = await approvalsApi.createAndApprove(toRequest())
      dirty.current = false
      if (result.approved || result.posted) notify.success(result.message)
      else notify.warning(result.message)
      // What went wrong with the follow-up emails (the supplier has no address...), as after approve-now.
      for (const warning of result.warnings) notify.warning(warning)
      void refreshApprovalsMe()
      void navigate(routes.purchaseOrder(result.id), { replace: true })
    } catch (error) {
      showApiError(error)
    } finally {
      setSaving(false)
    }
  }

  async function leave() {
    if (dirty.current) {
      const go = await confirm({ title: 'Leave without saving?', message: `This ${kind.noun} has changes that have not been saved. Leaving now discards them.`, confirmLabel: 'Discard', danger: true })
      if (!go) return
    }
    void navigate(kind.route)
  }

  async function exportToExcel() {
    if (!document) return
    try {
      await purchaseDocumentsApi.exportToExcel(document.id, `${document.documentNumber ?? `draft-${document.id}`}.xlsx`)
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : `The ${kind.noun} could not be exported.`)
    }
  }

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  /* ── render ───────────────────────────────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    )
  }

  if (loadError) {
    return (
      <Stack>
        <PageHeader title={kind.title} />
        <Alert color="red">{loadError}</Alert>
        <Group>
          <Button variant="default" onClick={() => void navigate(kind.route)}>
            Back to {kind.plural}
          </Button>
        </Group>
      </Stack>
    )
  }

  const documentLabel = document?.documentNumber ?? `draft #${document?.id}`
  const canImportHere = editable && canImport && !fromSource && header.branchId !== null && defaultWarehouseId !== null
  const source = document && document.sourceDocumentId !== null
    ? { id: document.sourceDocumentId, documentNumber: document.sourceDocumentNumber, documentTypeCode: document.sourceDocumentTypeCode ?? (kind.code === 'PRET' ? 'PINV' : 'PO') }
    : null

  /* An order: what can be done on it and why not — computed once, read by every order button. */
  const abilities =
    kind.code === 'PO' && document
      ? orderAbilities(document, hasPermission, invoiceCandidates, approval ? { state: approval.state, userId: user?.id ?? null } : null, editable)
      : null
  /* Until the approval answers, a draft order offers neither the posting nor the request: one of them is about to be wrong. */
  const approvalKnown = approval !== null || approvalFailed
  const creating = kind.code === 'PO' && isNew ? newOrderAbilities(approvalsMe, hasPermission) : null
  const approvalState = kind.code === 'PO' && document ? (approval?.state ?? null) : null
  const orderAction = (ability: OrderAbility | undefined) => ({
    visible: ability?.visible === true,
    disabled: ability?.blockedBy != null,
    disabledReason: ability?.blockedBy ?? undefined,
  })

  const actions: DocumentAction[] = readOnly
    ? [
        { key: 'attachments', label: `Attachments (${document?.files.length ?? 0})`, icon: DocumentIcons.attachments, onClick: () => setAttachmentsOpen(true) },
        { key: 'export', label: 'Export to Excel', icon: DocumentIcons.exportFile, onClick: () => void exportToExcel() },
        { key: 'send-supplier', label: 'Send to supplier...', icon: <IconMail size={16} />, colour: 'indigo', ...orderAction(abilities?.sendToSupplier), onClick: () => setSupplierOpen(true) },
        { key: 'create-invoice', label: 'Create Purchase Invoice', icon: <IconFileInvoice size={16} />, variant: 'filled', colour: 'green', ...orderAction(abilities?.createInvoice), loading: saving, onClick: () => void createFromThis() },
        { key: 'create-return', label: 'Create Purchase Return', icon: <IconArrowBackUp size={16} />, variant: 'filled', colour: 'orange', visible: canCreateReturn && document?.canCreateReturn === true, loading: saving, onClick: () => void createFromThis() },
        { key: 'close', label: 'Close Order', icon: <IconLock size={16} />, colour: 'teal', ...orderAction(abilities?.closeOrder), onClick: () => setCloseOpen(true) },
        { key: 'cancel-doc', label: 'Cancel Document', icon: DocumentIcons.cancel, colour: 'red', visible: canCancelDoc && document?.canCancel === true, onClick: () => setCancelOpen(true) },
        { key: 'back', label: 'Back', icon: DocumentIcons.back, onClick: () => void navigate(kind.route) },
      ]
    : [
        { key: 'attachments', label: `Attachments (${document?.files.length ?? 0})`, icon: DocumentIcons.attachments, onClick: () => setAttachmentsOpen(true) },
        { key: 'import', label: 'Import from Excel', icon: DocumentIcons.import, visible: canImportHere, onClick: () => setImportOpen(true) },
        // A saved draft order shows what comes after its approval, disabled, with the reason.
        { key: 'create-invoice', label: 'Create Purchase Invoice', icon: <IconFileInvoice size={16} />, colour: 'green', ...orderAction(abilities?.createInvoice), onClick: () => void createFromThis() },
        { key: 'close', label: 'Close Order', icon: <IconLock size={16} />, colour: 'teal', ...orderAction(abilities?.closeOrder), onClick: () => setCloseOpen(true) },
        { key: 'save', label: 'Save Draft', icon: DocumentIcons.save, visible: editable, loading: saving, onClick: () => void saveDraft() },
        { key: 'cancel', label: 'Cancel', icon: DocumentIcons.cancel, onClick: () => void leave() },
        ...(creating
          ? ([
              /* A NEW ORDER, as the approval rules say it may be created (newOrderAbilities). */
              { key: 'create-post', label: 'Create & post', icon: DocumentIcons.post, variant: 'filled', colour: kind.colour, ...orderAction(creating.createAndPost), loading: saving, onClick: () => void saveAndPost() },
              { key: 'create-send', label: 'Create & send for approval', icon: <IconSend size={16} />, variant: creating.createAndApprove.visible ? 'default' : 'filled', colour: kind.colour, ...orderAction(creating.createAndSend), loading: saving, onClick: () => void createAndSend() },
              { key: 'create-approve', label: 'Create & approve', icon: <IconCheck size={16} />, variant: 'filled', colour: 'green', ...orderAction(creating.createAndApprove), loading: saving, onClick: () => void createAndApprove() },
            ] satisfies DocumentAction[])
          : kind.code === 'PO'
            ? ([
                /* A SAVED DRAFT ORDER: posted as it is, or through its approval (orderAbilities). */
                { key: 'post', label: 'Save & Confirm', icon: DocumentIcons.post, variant: 'filled', colour: kind.colour, visible: approvalKnown && abilities?.post.visible === true, loading: saving, onClick: () => void saveAndPost() },
                { key: 'send-approval', label: 'Send for approval', icon: <IconSend size={16} />, variant: abilities?.approveDirect.visible ? 'default' : 'filled', colour: kind.colour, ...orderAction(abilities?.sendForApproval), loading: saving || approvalBusy, onClick: () => void sendForApproval() },
                { key: 'approve-now', label: 'Approve & post', icon: <IconCheck size={16} />, variant: 'filled', colour: 'green', ...orderAction(abilities?.approveDirect), loading: saving || approvalBusy, onClick: () => void approveNow() },
              ] satisfies DocumentAction[])
            : [{ key: 'post', label: 'Save & Post', icon: DocumentIcons.post, variant: 'filled', colour: kind.colour, visible: editable && canPost, loading: saving, onClick: () => void saveAndPost() } satisfies DocumentAction]),
      ]

  return (
    <Stack>
      <PageHeader title={isNew ? `New ${kind.title}` : `${kind.title} ${documentLabel}`} />

      <DocumentActionBar actions={actions} />

      {/* A rejected order is a draft again: why, first, so the author knows what to change before sending it again. */}
      {approvalState?.status === 'Draft' && approvalState.lastRejectReason && (
        <Alert color="red" icon={<IconX size={18} />} data-rejected-banner>
          Rejected by {approvalState.lastRejectedByName ?? 'an approver'} on {stamp(approvalState.lastRejectedAtUtc)}: {approvalState.lastRejectReason}
        </Alert>
      )}

      {document && status === 'PendingApproval' && approval && (
        <OrderApprovalCard
          state={approval.state}
          approvers={approval.approvers}
          actions={
            <Group gap="xs">
              <OrderActionButton ability={abilities?.approve ?? { visible: false, blockedBy: null }} color="green" leftSection={<IconCheck size={16} />} loading={approvalBusy} onClick={() => void approveOrder()} data-approve>
                Approve
              </OrderActionButton>
              <OrderActionButton ability={abilities?.reject ?? { visible: false, blockedBy: null }} color="red" variant="light" leftSection={<IconX size={16} />} disabled={approvalBusy} onClick={() => setRejectOpen(true)} data-reject>
                Reject...
              </OrderActionButton>
              <OrderActionButton ability={abilities?.resendApproval ?? { visible: false, blockedBy: null }} variant="default" leftSection={<IconRefresh size={16} />} disabled={approvalBusy} onClick={() => void resendApproval()} hint="New links to the approvers, and a new email.">
                Send again
              </OrderActionButton>
              <OrderActionButton ability={abilities?.withdrawApproval ?? { visible: false, blockedBy: null }} variant="default" color="orange" leftSection={<IconArrowBackUp size={16} />} disabled={approvalBusy} onClick={() => void withdrawApproval()}>
                Withdraw
              </OrderActionButton>
            </Group>
          }
        />
      )}

      {document && status === 'Posted' && (
        <Alert color={kind.colour} title={`${kind.code === 'PO' ? 'Confirmed' : 'Posted'} — ${document.documentNumber}`}>
          {kind.code === 'PO' ? 'Confirmed' : 'Posted'} by {document.postedByName ?? 'unknown'} on {stamp(document.postedAtUtc)}.{' '}
          {kind.code === 'PINV' && document.receiptMode === 2
            ? 'The item costs are set; the stock enters when the containers carrying it are offloaded. This invoice can no longer be edited.'
            : kind.postedBanner}
          {approvalState?.sentToSupplierAtUtc ? ` Sent to the supplier on ${stamp(approvalState.sentToSupplierAtUtc)}.` : ''}
        </Alert>
      )}
      {approvalState?.supplierNotEmailed && (status === 'Posted' || status === 'Closed') && (
        <Alert color="orange" title="Not sent to the supplier" data-supplier-not-emailed>
          Not sent to the supplier: no email address. Add it to the supplier, then use Send to supplier.
        </Alert>
      )}
      {document && status === 'Closed' && (
        <Alert color="teal" title={`Closed — ${document.documentNumber}`}>
          Closed by {document.closedByName ?? 'unknown'} on {stamp(document.closedAtUtc)}.{document.closeReason ? ` Reason: ${document.closeReason}` : ''} Nothing more will be received against this order.
        </Alert>
      )}
      {document && status === 'Cancelled' && (
        <Alert color="red" title={`Cancelled — ${document.documentNumber ?? 'draft'}`}>
          Cancelled by {document.cancelledByName ?? 'unknown'} on {stamp(document.cancelledAtUtc)}.{document.cancelReason ? ` Reason: ${document.cancelReason}` : ''}
        </Alert>
      )}
      {kind.code === 'PINV' && document && status === 'Draft' && savedItemCount > 1 && (
        <Alert color="orange" title={`This invoice holds ${savedItemCount} items: split it before posting`} data-multi-item-invoice>
          <Group justify="space-between" align="center" wrap="wrap" gap="sm">
            <Text fz="sm">
              A supplier invoice holds one item. Split by item keeps the item of the first line on this invoice and moves every
              other item to a new draft invoice with the same header.
            </Text>
            {editable && (
              <Button size="xs" color="orange" loading={splitting} onClick={() => void splitByItem()} data-split-by-item>
                Split by item
              </Button>
            )}
          </Group>
        </Alert>
      )}

      {kind.code === 'PO' && document && document.status !== 'Draft' && document.orderedBase !== null ? (
        <Paper radius="lg" p="md" withBorder data-order-progress>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
            <div>
              <Group justify="space-between" mb={4}>
                <Text fz="sm" fw={600}>Invoiced</Text>
                <Text fz="sm">
                  {formatNumber(document.invoicedBase)} / {formatNumber(document.orderedBase)} pcs
                  {document.inDraftInvoicesBase > 0 ? ` (+${formatNumber(document.inDraftInvoicesBase)} in drafts)` : ''}
                </Text>
              </Group>
              <Progress value={document.orderedBase ? ((document.invoicedBase ?? 0) * 100) / document.orderedBase : 0} color="green" radius="xl" />
            </div>
            <div>
              <Group justify="space-between" mb={4}>
                <Text fz="sm" fw={600}>Loaded in containers</Text>
                <Text fz="sm" data-loaded-in-containers>
                  {formatNumber(document.loadedBase ?? 0)} / {formatNumber(document.orderedBase)} pcs
                </Text>
              </Group>
              <Progress value={document.orderedBase ? ((document.loadedBase ?? 0) * 100) / document.orderedBase : 0} color="indigo" radius="xl" />
            </div>
          </SimpleGrid>
        </Paper>
      ) : null}

      <PurchaseHeaderCard
        kind={kind}
        value={header}
        onChange={changeHeader}
        branches={branches}
        suppliers={suppliers}
        currencies={currencies}
        rate={rate}
        rateLoading={rateLoading}
        documentNumber={document?.documentNumber ?? null}
        numberOnPost={documentType?.numberOnPost ?? kind.code !== 'PO'}
        source={source}
        sourceShortage={document?.sourceShortageId != null ? { id: document.sourceShortageId, documentNumber: document.sourceShortageNumber } : null}
        isNew={isNew}
        readOnly={!editable}
        errors={errors}
        disabled={saving}
        shippedLockedReason={
          document?.lines.some((line) => line.containerLineId != null)
            ? 'Unlink the containers before switching off Shipped in containers.'
            : !shipped && (document?.sourceDocumentId ?? null) === null
              ? 'Only an invoice created from a purchase order can be shipped in containers.'
              : null
        }
        exporterRequired={containerBound || shipped}
      />

      <Paper radius="lg" p="md" withBorder>
        <Group justify="space-between" align="flex-end" mb="sm" wrap="wrap">
          <Title order={5}>{kind.title} Lines</Title>
          <Group gap="xs">
            {editable && !fromSource && (
              <>
                <Button variant="default" leftSection={<IconPlus size={16} />} onClick={addEmptyLine}>
                  Add Item
                </Button>
                <Button variant="default" leftSection={DocumentIcons.import} disabled={!canImportHere} onClick={() => setImportOpen(true)}>
                  Import from Excel
                </Button>
                <Button variant="default" color="red" leftSection={<IconTrash size={16} />} disabled={lines.length === 0} onClick={() => void clearLines()}>
                  Clear All Lines
                </Button>
              </>
            )}
            {document && (
              <Button variant="default" onClick={() => void exportToExcel()}>
                Export to Excel
              </Button>
            )}
          </Group>
        </Group>

        {containerBound && (
          <Text fz="sm" c="dimmed" mb="sm">
            Made from containers: the items come from the container lines. Quantities, prices and discounts can change; items cannot be added.
          </Text>
        )}
        {editable && !fromSource && (
          <Group mb="md" align="flex-end">
            <QuickItemSearch onPick={(item) => void addScanned(item)} />
          </Group>
        )}

        <PurchaseLinesGrid
          lines={lines}
          onChange={patchLine}
          onRemove={removeLine}
          onAdd={addEmptyLine}
          items={items}
          warehouses={warehouses.map((w) => ({ value: String(w.id), label: w.warehouseName }))}
          onItemChosen={(key, itemId) => void chooseItem(key, itemId)}
          onUnitChosen={(key, unit) => void unitChosen(key, unit)}
          onUnitsNeeded={(key) => void loadUnits(key)}
          currencyCode={currencyCode}
          decimalPlaces={decimalPlaces}
          priceEditable={priceEditable}
          warnOnOverdraw={kind.code === 'PRET'}
          linesFromSource={fromSource}
          showTransit={kind.code === 'PO'}
          showCosts={hasCharges && readOnly && !containerBound}
          groupByContainer={containerBound || savedShipped}
          showEstimatedLanded={containerBound}
          allowAdd={!containerBound}
          onlyItemId={invoiceItemId}
          baseCurrencyCode={baseCode}
          readOnly={!editable}
        />
        {editable && kind.code === 'PINV' && !fromSource && invoiceItemId !== null && (
          <Text fz="xs" c="dimmed" mt="xs" data-one-item-hint>
            {ONE_ITEM_HINT}
          </Text>
        )}
      </Paper>

      {/* EVERY ORDER shows its Containers card to a reader who may see containers; the buttons say
          why they cannot be pressed (orderAbilities) rather than appearing on some orders only. */}
      {abilities && document && abilities.showContainers && (
        <OrderContainersCard
          purchaseOrderId={document.id}
          containers={document.containers}
          selected={containerSelection}
          onSelectedChange={setContainerSelection}
          onChanged={() => void reload()}
          emptyText={
            abilities.addContainer.visible && abilities.addContainer.blockedBy === null
              ? undefined
              : 'No container on this order yet.'
          }
          actions={
            <>
              <OrderActionButton ability={abilities.addContainer} size="xs" leftSection={<IconBox size={14} />} onClick={() => setAddContainerOpen(true)} data-add-container>
                Add Container…
              </OrderActionButton>
              <OrderActionButton
                ability={abilities.autoPlan}
                size="xs"
                variant="light"
                leftSection={<IconBoxMultiple size={14} />}
                onClick={() => setAutoPlanOpen(true)}
                data-auto-plan
              >
                Auto-plan containers…
              </OrderActionButton>
              <OrderActionButton
                ability={abilities.invoiceFromContainers}
                size="xs"
                color="green"
                leftSection={<IconFileInvoice size={14} />}
                onClick={() => setInvoiceFromContainersOpen(true)}
                hint="This order is shipped in containers: invoices are created from its containers."
                data-invoice-from-containers
              >
                Create Invoice from Containers…
              </OrderActionButton>
            </>
          }
        />
      )}

      {showShippedCard && document && (
        <ShippedInvoiceContainersCard
          invoice={document}
          pendingSwitch={!savedShipped}
          canLink={hasPermission(PURCHASE_INVOICE.permissions.create) && (status === 'Draft' || (status === 'Posted' && savedShipped))}
          canAddContainers={hasPermission(PERMISSIONS.containersCreate)}
          canOverCapacity={canOverCapacity}
          canConfirmContainers={canConfirmContainers}
          ensureSaved={() => {
            if (!dirty.current) return true
            notify.info('Save the invoice first: linking containers rewrites its lines.')
            return false
          }}
          onChanged={() => void refreshQuietly()}
        />
      )}

      {containerBound && document && (
        <InvoiceContainerChargesCard
          charges={document.charges}
          totalBase={document.containerChargesBase}
          baseCurrencyCode={baseCode}
          actions={
            canAddContainerCharge && document.containers.length > 0 ? (
              <Button variant="default" leftSection={<IconPlus size={16} />} onClick={() => setContainerChargeOpen(true)} data-add-charge>
                Add charge
              </Button>
            ) : null
          }
        />
      )}

      {/* A posted local invoice: its own charges, read-only, and the late ones (landed cost adjustments). */}
      {hasCharges && !containerBound && !savedShipped && document && status === 'Posted' && (
        <PostedInvoiceChargesCard
          invoiceId={document.id}
          invoiceDate={document.documentDate}
          invoiceCharges={document.charges.filter((c) => c.documentKind === 'PINV')}
          chargeTypes={chargeTypes}
          providers={suppliers}
          currencies={currencies}
          baseCurrencyCode={baseCode}
          canView={canViewLateCharges}
          canAdd={canAddLateCharge}
          canPost={canPostLateCharges}
          onPosted={() => void refreshQuietly()}
        />
      )}

      {hasCharges && !containerBound && status !== 'Posted' && (shipped ? charges.length > 0 : editable || charges.length > 0 || (document?.charges.length ?? 0) > 0) && (
        <PurchaseChargesGrid
          lines={editable ? charges : (document?.charges ?? []).map((c) => chargeFromDto(c))}
          onChange={patchCharge}
          onRemove={removeCharge}
          onAdd={addCharge}
          chargeTypes={chargeTypes}
          providers={suppliers}
          currencies={currencies}
          targets={allocationTargets}
          baseCurrencyCode={document?.baseCurrencyCode ?? rate?.baseCurrencyCode ?? 'USD'}
          onCurrencyChosen={(key, currencyId) => void chargeCurrencyChosen(key, currencyId)}
          readOnly={!editable}
        />
      )}

      <Grid>
        <Grid.Col span={{ base: 12, md: 7 }}>
          {kind.code === 'PO' && document ? (
            <Tabs defaultValue="activity" keepMounted={false}>
              <Tabs.List mb="sm">
                <Tabs.Tab value="activity">Activity</Tabs.Tab>
                <Tabs.Tab value="approval" data-approval-tab>
                  Approval{approval && approval.history.length > 0 ? ` (${approval.history.length})` : ''}
                </Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="activity">
                <AuditTrail entries={document.audit} />
              </Tabs.Panel>
              <Tabs.Panel value="approval">
                <Paper radius="lg" p="md" withBorder>
                  <Title order={5} mb="sm">
                    Approval
                  </Title>
                  {approval || !approvalFailed ? (
                    <ApprovalTimeline events={approval?.history ?? []} />
                  ) : (
                    <Text size="sm" c="red">
                      The approval history could not be loaded.
                    </Text>
                  )}
                </Paper>
              </Tabs.Panel>
            </Tabs>
          ) : (
            <AuditTrail entries={document?.audit ?? []} />
          )}
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Stack>
            <SalesTotals
              title="Summary"
              totalItems={totals.items}
              totalQuantity={totals.quantity}
              subtotal={totals.subtotal}
              totalDiscount={totals.discount}
              totalAmount={totals.total}
              currencyCode={currencyCode}
              decimalPlaces={decimalPlaces}
              baseCurrencyCode={document?.baseCurrencyCode ?? rate?.baseCurrencyCode}
              exchangeRate={header.exchangeRate}
              isBaseCurrency={isBaseCurrency}
            />

            {/* WHAT THE GOODS REALLY COST, beside what the supplier charged. A draft shows what the
                typed charges would add; a posted invoice shows what was actually allocated, which
                includes the charges that arrived later on an adjustment. */}
            {hasCharges && (chargeSummary.total > 0 || (document?.totalChargesBase ?? 0) > 0) && (
              <Paper radius="lg" p="md" withBorder data-landed-summary>
                <Title order={5} mb="sm">Landed cost</Title>
                <Stack gap={6}>
                  <Group justify="space-between">
                    <Text fz="sm" c="dimmed">Goods ({baseCode})</Text>
                    <Text fz="sm">{formatNumber(document?.totalAmountBase ?? totals.total / (header.exchangeRate || 1), 2)}</Text>
                  </Group>
                  <Group justify="space-between">
                    <Text fz="sm" c="dimmed">Total charges ({baseCode})</Text>
                    <Text fz="sm">{formatNumber(readOnly ? (document?.totalChargesBase ?? 0) : chargeSummary.landed, 2)}</Text>
                  </Group>
                  <Group justify="space-between">
                    <Text fw={700}>Total landed cost ({baseCode})</Text>
                    <Text fw={700} data-total-landed>
                      {formatNumber(
                        readOnly
                          ? (document?.totalLandedCostBase ?? 0)
                          : (document?.totalAmountBase ?? totals.total / (header.exchangeRate || 1)) + chargeSummary.landed,
                        2,
                      )}
                    </Text>
                  </Group>
                  {chargeSummary.total !== chargeSummary.landed && !readOnly && (
                    <Text fz="xs" c="dimmed">
                      {formatNumber(chargeSummary.total - chargeSummary.landed, 2)} {baseCode} of charges are recorded but do not reach the item cost.
                    </Text>
                  )}
                </Stack>
              </Paper>
            )}

            <LinkedDocumentsCard
              linked={document?.linked ?? []}
              canPostInvoices={kind.code === 'PO' && hasPermission(PURCHASE_INVOICE.permissions.post)}
              onPosted={() => void refreshQuietly()}
            />
            {kind.code === 'PINV' && document && !showShippedCard ? <InvoiceContainersCard containers={document.containers} /> : null}
          </Stack>
        </Grid.Col>
      </Grid>

      <AttachmentsDrawer
        opened={attachmentsOpen}
        onClose={() => setAttachmentsOpen(false)}
        documentId={document?.id ?? null}
        files={document?.files ?? []}
        onChanged={() => void reload()}
        canEdit={canCreate}
        api={purchaseDocumentsApi}
      />

      <CancelReasonModal opened={cancelOpen} onClose={() => setCancelOpen(false)} documentLabel={documentLabel} busy={cancelBusy} onConfirm={(reason) => void cancelDocument(reason)} />


      {kind.code === 'PO' && document && addContainerOpen && (
        <AddContainerModal
          opened
          onClose={() => setAddContainerOpen(false)}
          order={{ id: document.id, documentNumber: document.documentNumber, branchId: document.branchId, warehouseId: document.warehouseId }}
          canOverCapacity={canOverCapacity}
          onSaved={(container, open) => {
            setAddContainerOpen(false)
            if (open) void navigate(`/logistics/containers/${container.id}`)
            else void reload()
          }}
        />
      )}

      {kind.code === 'PO' && document && autoPlanOpen && (
        <AutoPlanModal
          order={{ id: document.id, documentNumber: document.documentNumber, branchId: document.branchId, warehouseId: document.warehouseId }}
          canOverCapacity={canOverCapacity}
          canConfirm={canConfirmContainers}
          onClose={() => setAutoPlanOpen(false)}
          onCreated={() => {
            setAutoPlanOpen(false)
            void reload()
          }}
        />
      )}

      {containerBound && document && (
        <NewChargeModal
          opened={containerChargeOpen}
          onClose={() => setContainerChargeOpen(false)}
          presetContainerIds={document.containers.map((c) => c.id)}
          presetSplitRule="Pieces"
          onCreated={() => void refreshQuietly()}
        />
      )}

      {kind.code === 'PO' && document && invoiceFromContainersOpen && (
        <InvoiceFromContainersModal
          opened
          onClose={() => setInvoiceFromContainersOpen(false)}
          purchaseOrderId={document.id}
          onCreated={(invoices) => {
            setInvoiceFromContainersOpen(false)
            if (invoices.length === 1) {
              void navigate(routes.purchaseInvoice(invoices[0].id))
            } else {
              setCreatedInvoices(invoices)
              void refreshQuietly()
            }
          }}
        />
      )}

      {kind.code === 'PO' && document && createInvoiceOpen && (
        <CreateInvoiceFromOrderModal
          order={document}
          orderId={document.id}
          onClose={() => setCreateInvoiceOpen(false)}
          onCreated={(created) => {
            setCreateInvoiceOpen(false)
            notify.success(`${created.message}.`)
            if (created.invoices.length === 1) {
              void navigate(routes.purchaseInvoice(created.firstId))
            } else {
              setCreatedInvoices(created.invoices)
              void refreshQuietly()
            }
          }}
        />
      )}

      {document && createdInvoices && (
        <CreatedInvoicesModal
          opened
          invoices={createdInvoices}
          currencyCode={document.currencyCode}
          onClose={() => setCreatedInvoices(null)}
          onGoToOrder={kind.code === 'PO' || document.sourceDocumentId != null ? goToOrderInvoices : undefined}
        />
      )}

      {kind.code === 'PO' && document && (
        <>
          <CancelReasonModal
            opened={rejectOpen}
            onClose={() => setRejectOpen(false)}
            documentLabel={documentLabel}
            title={`Reject ${documentLabel}`}
            description="The order goes back to its author as a draft, with your reason. They can change it and send it again."
            placeholder="Why is this order rejected?"
            confirmLabel="Reject"
            busy={approvalBusy}
            onConfirm={(reason) => void rejectOrder(reason)}
          />
          <SendToSupplierModal
            opened={supplierOpen}
            onClose={() => setSupplierOpen(false)}
            documentLabel={`${documentLabel} of ${document.supplierName}`}
            supplierEmail={approval?.state.supplierEmail ?? document.supplierEmail}
            busy={approvalBusy}
            onSend={(payload) => void sendToSupplier(payload)}
          />
        </>
      )}

      <CloseOrderModal opened={closeOpen} onClose={() => setCloseOpen(false)} documentLabel={documentLabel} busy={closeBusy} onConfirm={(reason) => void closeOrder(reason)} />

      {canImportHere && (
        <ImportInvoiceItemsWizard
          opened={importOpen}
          onClose={() => setImportOpen(false)}
          header={{
            branchId: Number(header.branchId),
            warehouseId: defaultWarehouseId!,
            warehouseCode: warehouses.find((w) => w.id === defaultWarehouseId)?.warehouseCode,
            priceListId: null,
            currencyCode,
            decimalPlaces,
          }}
          documentTypeCode={kind.code}
          mode="stock"
          onImported={appendImported}
          importCreate={(imported, postImmediately) =>
            purchaseDocumentsApi.importCreate({
              documentTypeCode: kind.code,
              documentDate: header.documentDate,
              expectedDate: header.expectedDate,
              branchId: Number(header.branchId),
              supplierId: Number(header.supplierId),
              currencyId: header.currencyId === null ? null : Number(header.currencyId),
              rateType: header.rateType,
              exchangeRate: isBaseCurrency ? null : header.exchangeRate,
              supplierReference: header.supplierReference.trim() || null,
              notes: header.notes.trim() || null,
              postImmediately,
              lines: imported.map((line) => ({
                warehouseId: line.warehouseId,
                itemId: line.itemId,
                itemUnitId: line.itemUnitId,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                discountPercent: line.discountPercent,
                expiryDate: line.expiryDate,
                notes: line.notes,
                importRowNumber: line.importRowNumber,
              })),
            })
          }
          documentRoute={(docId) => routes.purchaseDocument(kind.code, docId)}
          onePerItem={kind.code === 'PINV'}
          heldItemId={invoiceItemId}
          onDocumentsCreated={(created) => {
            dirty.current = false
            void navigate(kind.route, { state: { highlight: created.documents.map((d) => d.id) } })
          }}
          onSwitchWarehouse={(warehouseId) => {
            /* The document has no warehouse of its own to switch any more, so this moves the LINES
               and the seed for new rows — which is what "the file is for another warehouse" meant. */
            markDirty()
            setDefaultWarehouseId(warehouseId)
            setLines((current) => current.map((line) => ({ ...line, warehouseId, onHandBase: null })))
          }}
        />
      )}

      {editable && kind.code === 'PRET' && lines.some((l) => l.onHandBase !== null && l.quantity * (l.packingFormula || 1) > l.onHandBase) && (
        <Alert color="orange">
          {/* NO WAREHOUSE IS NAMED HERE any more: each line has its own, so one name would be wrong
              for most of the rows it is counting. The Warehouse column on the row says which. */}
          {formatNumber(lines.filter((l) => l.onHandBase !== null && l.quantity * (l.packingFormula || 1) > l.onHandBase).length)} line(s) return more than the stock on hand in their warehouse. The posting will be refused unless the quantities are reduced.
        </Alert>
      )}
    </Stack>
  )
}
