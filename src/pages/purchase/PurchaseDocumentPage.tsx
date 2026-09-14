import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Alert, Button, Grid, Group, Loader, Paper, Stack, Title } from '@mantine/core'
import { IconArrowBackUp, IconFileInvoice, IconLock, IconPlus, IconTrash } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { itemsApi } from '../../api/inventory/items'
import { inventoryLookupsApi } from '../../api/inventory/stockDocuments'
import { branchesApi } from '../../api/masterdata/branches'
import { currenciesApi } from '../../api/masterdata/currencies'
import { partiesApi } from '../../api/masterdata/parties'
import { warehousesApi } from '../../api/masterdata/warehouses'
import {
  purchaseDocumentsApi,
  type PurchaseDocumentDto,
  type PurchaseRateResolutionDto,
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
import { CloseOrderModal } from '../../components/purchase/CloseOrderModal'
import { LinkedDocumentsCard } from '../../components/purchase/LinkedDocumentsCard'
import { PurchaseHeaderCard, type PurchaseHeader, type PurchaseHeaderErrors } from '../../components/purchase/PurchaseHeaderCard'
import { PURCHASE_INVOICE, PURCHASE_RETURN, type PurchaseKind } from '../../components/purchase/purchaseKind'
import { defaultPurchasePrice, lineMaximum, purchaseUnitOf } from '../../components/purchase/purchaseLines'
import { PurchaseLinesGrid, type PurchaseLine } from '../../components/purchase/PurchaseLinesGrid'
import { ImportInvoiceItemsWizard, type ImportedLine } from '../../components/sales/ImportInvoiceItemsWizard'
import { SalesTotals } from '../../components/sales/SalesTotals'
import { confirm } from '../../components/ui/confirm'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { pricingOf, useDocumentTypes } from '../../hooks/useDocumentTypes'
import { PERMISSIONS } from '../../navigation'

let keySeed = 0
const nextKey = () => `pur-${++keySeed}`

function emptyLine(): PurchaseLine {
  return {
    key: nextKey(), id: null, itemId: null, itemCode: '', itemName: '', itemUnitId: null, unitTypeName: '', packingFormula: 1,
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
  const { hasPermission } = useAuth()

  const documentId = id && id !== 'new' ? Number(id) : null
  const isNew = documentId === null

  const canCreate = hasPermission(kind.permissions.create)
  const canPost = hasPermission(kind.permissions.post)
  const canCancelDoc = hasPermission(kind.permissions.cancel)
  const canImport = hasPermission(PERMISSIONS.invoicesImport)
  const canCreateInvoice = kind.code === 'PO' && hasPermission(PURCHASE_INVOICE.permissions.create)
  const canCreateReturn = kind.code === 'PINV' && hasPermission(PURCHASE_RETURN.permissions.create)

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
  const [suppliers, setSuppliers] = useState<PartyLookupDto[]>([])
  const [currencies, setCurrencies] = useState<CurrencyLookupDto[]>([])
  const [items, setItems] = useState<ItemLookupDto[]>([])

  const [header, setHeader] = useState<PurchaseHeader>({
    documentDate: isoDate(new Date()), expectedDate: null, branchId: null, warehouseId: null, supplierId: null,
    currencyId: null, rateType: 1, exchangeRate: null, supplierReference: '', notes: '',
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

  const dirty = useRef(false)
  const markDirty = () => {
    dirty.current = true
  }

  const status = document?.status ?? 'Draft'
  const readOnly = !isNew && status !== 'Draft'
  const editable = !readOnly && (isNew ? canCreate : canCreate && document?.canEdit === true)
  const fromSource = document?.sourceDocumentId != null

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
      setLines((current) =>
        current.map((line) =>
          line.sourceLineId !== null && remaining.has(line.sourceLineId)
            ? { ...line, sourceRemainingBase: remaining.get(line.sourceLineId) ?? null }
            : line,
        ),
      )
    } catch {
      /* The cap is a courtesy; the server enforces it either way. */
    }
  }, [])

  const applyDocument = useCallback((doc: PurchaseDocumentDto) => {
    setDocument(doc)
    setHeader({
      documentDate: doc.documentDate.slice(0, 10),
      expectedDate: doc.expectedDate ? doc.expectedDate.slice(0, 10) : null,
      branchId: String(doc.branchId),
      warehouseId: String(doc.warehouseId),
      supplierId: String(doc.supplierId),
      currencyId: String(doc.currencyId),
      rateType: doc.rateType,
      exchangeRate: doc.exchangeRate,
      supplierReference: doc.supplierReference ?? '',
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
      })),
    )
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
        setLoadError(`This is a ${doc.documentTypeName.toLowerCase()}, not a ${kind.title.toLowerCase()}.`)
        return
      }
      applyDocument(doc)
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : `The ${kind.noun} could not be loaded.`)
    } finally {
      setLoading(false)
    }
  }, [documentId, applyDocument, kind.code, kind.title, kind.noun])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (header.branchId === null) return
    let cancelled = false
    warehousesApi
      .lookup(true, Number(header.branchId))
      .then((rows) => {
        if (cancelled) return
        setWarehouses(rows)
        setHeader((current) => {
          if (current.warehouseId !== null) return current
          const main = rows.find((w) => w.isMainWarehouse) ?? rows[0]
          return main ? { ...current, warehouseId: String(main.id) } : current
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
    if (next.branchId !== undefined) setWarehouses([])
    setErrors({})
    setHeader((current) => ({ ...current, ...next }))
  }

  /* ── pricing and stock ────────────────────────────────────────────────────────────────────── */

  const refreshOnHand = useCallback(
    async (key: string, itemId: number) => {
      if (!header.warehouseId) return
      try {
        const { onHandBase } = await inventoryLookupsApi.onHand(itemId, Number(header.warehouseId))
        setLines((current) => current.map((l) => (l.key === key ? { ...l, onHandBase } : l)))
      } catch {}
    },
    [header.warehouseId],
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
        void refreshOnHand(key, details.id)
        focusWhenDrawn(`[data-line-qty="${key}"] input`)
      } catch (error) {
        notify.error(error instanceof ApiError ? error.message : 'The item could not be loaded.')
      }
    },
    [refreshOnHand, header.exchangeRate],
  )

  const addScanned = useCallback(
    async (item: ItemListDto) => {
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
        { ...emptyLine(), key, itemId: details.id, itemCode: details.itemCode, itemName: details.itemName, units: details.units, itemUnitId: unit.id, unitTypeName: unit.unitTypeName, packingFormula: unit.packingFormula, unitPrice: defaultPurchasePrice(details.lastCost, unit.packingFormula, header.exchangeRate) },
      ])
      void refreshOnHand(key, details.id)
      focusWhenDrawn(`[data-line-qty="${key}"] input`)
    },
    [lines, patchLine, refreshOnHand, header.exchangeRate],
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

  function addEmptyLine() {
    markDirty()
    setLines((current) => [...current, emptyLine()])
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
      ...emptyLine(),
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
    for (const line of added) if (line.itemId !== null) void refreshOnHand(line.key, line.itemId)
  }

  /* ── totals ───────────────────────────────────────────────────────────────────────────────── */

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
    if (!header.warehouseId) next.warehouseId = 'Choose a warehouse.'
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
      warehouseId: Number(header.warehouseId),
      supplierId: Number(header.supplierId),
      currencyId: Number(header.currencyId),
      rateType: header.rateType,
      exchangeRate: isBaseCurrency ? null : header.exchangeRate,
      supplierReference: header.supplierReference.trim() || null,
      notes: header.notes.trim() || null,
      sourceDocumentId: document?.sourceDocumentId ?? null,
      rowVersion: document?.rowVersion ?? null,
      lines: lines.map((line, index) => ({
        lineNo: index + 1,
        itemId: line.itemId!,
        itemUnitId: line.itemUnitId!,
        warehouseId: Number(header.warehouseId),
        expiryDate: line.expiryDate,
        quantity: line.quantity,
        unitPrice: priceEditable ? line.unitPrice : null,
        discountPercent: line.discountPercent,
        importRowNumber: line.importRowNumber,
        notes: line.notes.trim() || null,
        sourceLineId: line.sourceLineId,
      })),
    }
  }

  function showApiError(error: unknown) {
    if (!(error instanceof ApiError)) {
      notify.error(`The ${kind.noun} could not be saved.`)
      return
    }
    setLines((current) => current.map((line) => ({ ...line, error: undefined })))
    const match = /^Line (\d+):/.exec(error.message)
    if ((error.code === 'VALIDATION' || error.code === 'SOURCE_INVALID' || error.code === 'NO_PRICE') && match) {
      const index = Number(match[1]) - 1
      setLines((current) => current.map((line, i) => (i === index ? { ...line, error: error.message } : line)))
    } else if (error.code === 'INSUFFICIENT_STOCK') {
      const stock = /^Insufficient stock for (\S+) in/.exec(error.message)
      if (stock) {
        setLines((current) => current.map((line) => (line.itemCode === stock[1] ? { ...line, error: error.message } : line)))
        for (const line of lines) if (line.itemCode === stock[1] && line.itemId) void refreshOnHand(line.key, line.itemId)
      }
    }
    notify.error(error.message)
    if (error.code === 'CONCURRENCY') void reload()
  }

  async function saveDraft(): Promise<PurchaseDocumentDto | null> {
    if (!validate()) return null
    setSaving(true)
    try {
      const saved = documentId === null ? await purchaseDocumentsApi.create(toRequest()) : await purchaseDocumentsApi.update(documentId, toRequest())
      applyDocument(saved)
      notify.success(documentId === null ? 'Draft created.' : 'Draft saved.')
      if (documentId === null) navigate(`${kind.route}/${saved.id}`, { replace: true })
      return saved
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
    const target = kind.code === 'PO' ? PURCHASE_INVOICE : PURCHASE_RETURN
    const go = await confirm({
      title: `Create ${target.title.toLowerCase()}`,
      message: kind.code === 'PO'
        ? `Create a purchase invoice draft from ${document.documentNumber} with everything that remains to receive?`
        : `Create a purchase return draft from ${document.documentNumber} with everything that can still be returned?`,
      confirmLabel: 'Create',
    })
    if (!go) return
    setSaving(true)
    try {
      const created = kind.code === 'PO' ? await purchaseDocumentsApi.createInvoice(document.id) : await purchaseDocumentsApi.createReturn(document.id)
      notify.success(`${target.title} draft created.`)
      void navigate(`${target.route}/${created.id}`)
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
  const canImportHere = editable && canImport && !fromSource && header.branchId !== null && header.warehouseId !== null
  const source = document && document.sourceDocumentId !== null
    ? { id: document.sourceDocumentId, documentNumber: document.sourceDocumentNumber, documentTypeCode: document.sourceDocumentTypeCode ?? (kind.code === 'PRET' ? 'PINV' : 'PO') }
    : null

  const actions: DocumentAction[] = readOnly
    ? [
        { key: 'attachments', label: `Attachments (${document?.files.length ?? 0})`, icon: DocumentIcons.attachments, onClick: () => setAttachmentsOpen(true) },
        { key: 'export', label: 'Export to Excel', icon: DocumentIcons.exportFile, onClick: () => void exportToExcel() },
        { key: 'create-invoice', label: 'Create Purchase Invoice', icon: <IconFileInvoice size={16} />, variant: 'filled', colour: 'green', visible: canCreateInvoice && document?.canCreateInvoice === true, loading: saving, onClick: () => void createFromThis() },
        { key: 'create-return', label: 'Create Purchase Return', icon: <IconArrowBackUp size={16} />, variant: 'filled', colour: 'orange', visible: canCreateReturn && document?.canCreateReturn === true, loading: saving, onClick: () => void createFromThis() },
        { key: 'close', label: 'Close Order', icon: <IconLock size={16} />, colour: 'teal', visible: kind.code === 'PO' && canPost && document?.canClose === true, onClick: () => setCloseOpen(true) },
        { key: 'cancel-doc', label: 'Cancel Document', icon: DocumentIcons.cancel, colour: 'red', visible: canCancelDoc && document?.canCancel === true, onClick: () => setCancelOpen(true) },
        { key: 'back', label: 'Back', icon: DocumentIcons.back, onClick: () => void navigate(kind.route) },
      ]
    : [
        { key: 'attachments', label: `Attachments (${document?.files.length ?? 0})`, icon: DocumentIcons.attachments, onClick: () => setAttachmentsOpen(true) },
        { key: 'import', label: 'Import from Excel', icon: DocumentIcons.import, visible: canImportHere, onClick: () => setImportOpen(true) },
        { key: 'save', label: 'Save Draft', icon: DocumentIcons.save, visible: editable, loading: saving, onClick: () => void saveDraft() },
        { key: 'cancel', label: 'Cancel', icon: DocumentIcons.cancel, onClick: () => void leave() },
        { key: 'post', label: kind.code === 'PO' ? 'Save & Confirm' : 'Save & Post', icon: DocumentIcons.post, variant: 'filled', colour: kind.colour, visible: editable && canPost, loading: saving, onClick: () => void saveAndPost() },
      ]

  return (
    <Stack>
      <PageHeader title={isNew ? `New ${kind.title}` : `${kind.title} ${documentLabel}`} />

      <DocumentActionBar actions={actions} />

      {document && status === 'Posted' && (
        <Alert color={kind.colour} title={`${kind.code === 'PO' ? 'Confirmed' : 'Posted'} — ${document.documentNumber}`}>
          {kind.code === 'PO' ? 'Confirmed' : 'Posted'} by {document.postedByName ?? 'unknown'} on {stamp(document.postedAtUtc)}. {kind.postedBanner}
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

      <PurchaseHeaderCard
        kind={kind}
        value={header}
        onChange={changeHeader}
        branches={branches}
        warehouses={warehouses}
        suppliers={suppliers}
        currencies={currencies}
        rate={rate}
        rateLoading={rateLoading}
        documentNumber={document?.documentNumber ?? null}
        numberOnPost={documentType?.numberOnPost ?? kind.code !== 'PO'}
        source={source}
        isNew={isNew}
        readOnly={!editable}
        errors={errors}
        disabled={saving}
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
          onItemChosen={(key, itemId) => void chooseItem(key, itemId)}
          onUnitChosen={(key, unit) => void unitChosen(key, unit)}
          onUnitsNeeded={(key) => void loadUnits(key)}
          currencyCode={currencyCode}
          decimalPlaces={decimalPlaces}
          priceEditable={priceEditable}
          warnOnOverdraw={kind.code === 'PRET'}
          linesFromSource={fromSource}
          readOnly={!editable}
        />
      </Paper>

      <Grid>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <AuditTrail entries={document?.audit ?? []} />
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
            <LinkedDocumentsCard linked={document?.linked ?? []} />
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

      <CloseOrderModal opened={closeOpen} onClose={() => setCloseOpen(false)} documentLabel={documentLabel} busy={closeBusy} onConfirm={(reason) => void closeOrder(reason)} />

      {canImportHere && (
        <ImportInvoiceItemsWizard
          opened={importOpen}
          onClose={() => setImportOpen(false)}
          header={{
            branchId: Number(header.branchId),
            warehouseId: Number(header.warehouseId),
            warehouseCode: warehouses.find((w) => String(w.id) === header.warehouseId)?.warehouseCode,
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
          documentRoute={(docId) => `${kind.route}/${docId}`}
          onDocumentsCreated={(created) => {
            dirty.current = false
            void navigate(kind.route, { state: { highlight: created.documents.map((d) => d.id) } })
          }}
          onSwitchWarehouse={(warehouseId) => {
            markDirty()
            setHeader((current) => ({ ...current, warehouseId: String(warehouseId) }))
          }}
        />
      )}

      {editable && kind.code === 'PRET' && lines.some((l) => l.onHandBase !== null && l.quantity * (l.packingFormula || 1) > l.onHandBase) && (
        <Alert color="orange">
          {formatNumber(lines.filter((l) => l.onHandBase !== null && l.quantity * (l.packingFormula || 1) > l.onHandBase).length)} line(s) return more than the stock on hand in {warehouses.find((w) => String(w.id) === header.warehouseId)?.warehouseName ?? document?.warehouseName ?? 'the warehouse'}. The posting will be refused unless the quantities are reduced.
        </Alert>
      )}
    </Stack>
  )
}
