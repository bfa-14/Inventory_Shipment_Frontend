import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Alert, Button, Grid, Group, Loader, Paper, Stack, Title } from '@mantine/core'
import { IconArrowBackUp, IconPlus, IconTrash } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { itemsApi } from '../../api/inventory/items'
import { inventoryLookupsApi } from '../../api/inventory/stockDocuments'
import { branchesApi } from '../../api/masterdata/branches'
import { partiesApi } from '../../api/masterdata/parties'
import { priceListsApi } from '../../api/masterdata/priceLists'
import { unitPricesApi } from '../../api/masterdata/unitPrices'
import { warehousesApi } from '../../api/masterdata/warehouses'
import {
  salesInvoicesApi,
  type RateResolutionDto,
  type SalesInvoiceDto,
  type SaveSalesInvoiceRequest,
} from '../../api/sales/invoices'
import type { BranchLookupDto, ItemListDto, ItemLookupDto, ItemUnitDto, PartyLookupDto, PriceListLookupDto, WarehouseLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { AttachmentsDrawer } from '../../components/documents/AttachmentsDrawer'
import { AuditTrail } from '../../components/documents/AuditTrail'
import { CancelReasonModal } from '../../components/documents/CancelReasonModal'
import { DocumentActionBar, type DocumentAction } from '../../components/documents/DocumentActionBar'
import { DocumentIcons } from '../../components/documents/documentIcons'
import { isoDate, stamp } from '../../components/documents/documentKind'
import { QuickItemSearch } from '../../components/documents/QuickItemSearch'
import { formatNumber } from '../../components/format'
import { ImportInvoiceItemsWizard, type ImportedLine } from '../../components/sales/ImportInvoiceItemsWizard'
import { SalesInvoiceHeaderCard, type SalesInvoiceHeader, type SalesInvoiceHeaderErrors } from '../../components/sales/SalesInvoiceHeaderCard'
import { SalesInvoiceLinesGrid, type InvoiceLine } from '../../components/sales/SalesInvoiceLinesGrid'
import { SalesInvoiceProfitCard } from '../../components/sales/SalesInvoiceProfitCard'
import { SalesTotals } from '../../components/sales/SalesTotals'
import { confirm } from '../../components/ui/confirm'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { pricingOf, useDocumentTypes } from '../../hooks/useDocumentTypes'
import { PERMISSIONS } from '../../navigation'

const ROUTE = '/sales/invoices'
const TYPE = 'SINV'

let keySeed = 0
const nextKey = () => `inv-${++keySeed}`

function emptyLine(): InvoiceLine {
  return {
    key: nextKey(), id: null, itemId: null, itemCode: '', itemName: '', itemUnitId: null, unitTypeName: '', packingFormula: 1,
    units: [], quantity: 1, unitPrice: null, systemPrice: null, priceSource: 'PriceList', discountPercent: 0, expiryDate: null,
    notes: '', onHandBase: null, importRowNumber: null,
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
 * One sales invoice: create it, edit it while it is a draft, read it once it is posted.
 *
 * THE INVENTORY IN PAGE'S SHAPE WITH PRICES ON IT. Same three modes decided by the status, same
 * header-lines-summary skeleton, same server-owned rules. What is the invoice's own: a client, a
 * price list and a rate on the header; a price on every line that comes from the list unless the
 * reader holds the override permission; and a stock check that turns a line red before the server
 * refuses it.
 *
 * A LINE WITHOUT A PRICE CANNOT BE SAVED. The list has none for that unit; the row says so in red
 * and the save is blocked with the same NO_PRICE wording the server would use — a round trip saved,
 * and the same sentence either way.
 */
export function SalesInvoicePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, hasPermission } = useAuth()

  const invoiceId = id && id !== 'new' ? Number(id) : null
  const isNew = invoiceId === null

  const canCreate = hasPermission(PERMISSIONS.invoicesCreate)
  const canPost = hasPermission(PERMISSIONS.invoicesPost)
  const canCancelDoc = hasPermission(PERMISSIONS.invoicesCancel)
  /* A margin is its own permission. Without it the API sends the cost fields as null, and the page
     draws nothing rather than a card full of dashes. */
  const canSeeProfit = hasPermission(PERMISSIONS.salesProfitView)
  const canImport = hasPermission(PERMISSIONS.invoicesImport)
  const canOverridePrice = hasPermission(PERMISSIONS.invoicesPriceOverride)

  const { byCode } = useDocumentTypes()
  const documentType = byCode(TYPE)
  const pricing = pricingOf(documentType, { mode: 'priceList', editable: true })
  /* PRICE LIST PRICING IS EDITABLE ONLY WITH THE OVERRIDE; a type configured to Cost follows its own flag. */
  const priceEditable = pricing.mode === 'priceList' ? pricing.editable && canOverridePrice : pricing.editable

  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [invoice, setInvoice] = useState<SalesInvoiceDto | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseLookupDto[]>([])
  const [priceLists, setPriceLists] = useState<PriceListLookupDto[]>([])
  const [clients, setClients] = useState<PartyLookupDto[]>([])
  const [salesmen, setSalesmen] = useState<PartyLookupDto[]>([])
  const [items, setItems] = useState<ItemLookupDto[]>([])

  const [header, setHeader] = useState<SalesInvoiceHeader>({
    documentDate: isoDate(new Date()), dueDate: null, branchId: null, warehouseId: null, clientId: null, salesmanId: null,
    priceListId: null, rateType: 1, exchangeRate: null, referenceNo: '', notes: '',
  })
  const [errors, setErrors] = useState<SalesInvoiceHeaderErrors>({})
  const [lines, setLines] = useState<InvoiceLine[]>([])

  const [rate, setRate] = useState<RateResolutionDto | null>(null)
  const [rateFor, setRateFor] = useState('')
  /** True once the reader changed the price list, the type or the date: the next lookup may overwrite the rate. */
  const rateDirty = useRef(false)
  const priceListTouched = useRef(false)

  const [attachmentsOpen, setAttachmentsOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  const draftReference = useRef(`SINV-DRAFT-${Date.now().toString(36).toUpperCase()}`)

  const dirty = useRef(false)
  const markDirty = () => {
    dirty.current = true
  }

  const status = invoice?.status ?? 'Draft'
  const readOnly = !isNew && status !== 'Draft'
  const editable = !readOnly && (isNew ? canCreate : canCreate && invoice?.canEdit === true)

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
    priceListsApi.lookup().then(setPriceLists).catch(() => notify.error('Price lists could not be loaded.'))
    partiesApi
      .lookup({ partyType: 'Client' })
      .then((rows) => {
        setClients(rows)
        if (!isNew || rows.length !== 1) return
        const only = rows[0]
        setHeader((current) => {
          if (current.clientId !== null) return current
          const next = { ...current, clientId: String(only.id) }
          if (only.defaultPriceListId !== null && !priceListTouched.current) next.priceListId = String(only.defaultPriceListId)
          return next
        })
      })
      .catch(() => notify.error('Clients could not be loaded.'))
    partiesApi
      .lookup({ partyType: 'Salesman' })
      .then((rows) => {
        setSalesmen(rows)
        if (!isNew) return
        const mine = user ? rows.find((s) => s.userId === user.id) : undefined
        if (mine) setHeader((current) => (current.salesmanId === null ? { ...current, salesmanId: String(mine.id) } : current))
      })
      .catch(() => {})
    itemsApi.lookup().then(setItems).catch(() => {})
    // isNew comes from the route and the user from the session; neither changes without a remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyInvoice = useCallback((doc: SalesInvoiceDto) => {
    setInvoice(doc)
    setHeader({
      documentDate: doc.documentDate.slice(0, 10),
      dueDate: doc.dueDate ? doc.dueDate.slice(0, 10) : null,
      branchId: String(doc.branchId),
      warehouseId: String(doc.warehouseId),
      clientId: String(doc.clientId),
      salesmanId: doc.salesmanId === null ? null : String(doc.salesmanId),
      priceListId: String(doc.priceListId),
      rateType: doc.rateType,
      exchangeRate: doc.exchangeRate,
      referenceNo: doc.referenceNo ?? '',
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
        systemPrice: line.systemPrice,
        priceSource: line.priceSource === 'Manual' ? 'Manual' : 'PriceList',
        discountPercent: line.discountPercent,
        expiryDate: line.expiryDate ? line.expiryDate.slice(0, 10) : null,
        notes: line.notes ?? '',
        onHandBase: line.onHandBase,
        importRowNumber: line.importRowNumber,
      })),
    )
    priceListTouched.current = true
    rateDirty.current = false
    dirty.current = false
  }, [])

  const reload = useCallback(async () => {
    if (invoiceId === null) return
    setLoading(true)
    try {
      applyInvoice(await salesInvoicesApi.get(invoiceId))
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : 'The invoice could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [invoiceId, applyInvoice])

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

  /* The rate follows the price list, the type and the date — but overwrites a loaded invoice's own
     rate only once the reader changed one of the three. */
  const rateKey = header.priceListId ? `${header.priceListId}|${header.rateType}|${header.documentDate}` : ''
  useEffect(() => {
    if (!header.priceListId) return
    const key = `${header.priceListId}|${header.rateType}|${header.documentDate}`
    const controller = new AbortController()
    salesInvoicesApi
      .rate(Number(header.priceListId), header.rateType, header.documentDate || null, controller.signal)
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
  }, [header.priceListId, header.rateType, header.documentDate])

  const rateLoading = rateKey !== '' && rateFor !== rateKey
  const priceList = priceLists.find((p) => String(p.id) === header.priceListId) ?? null
  const currencyCode = invoice?.currencyCode ?? rate?.currencyCode ?? priceList?.currencyCode ?? 'USD'
  const decimalPlaces = invoice?.decimalPlaces ?? rate?.decimalPlaces ?? priceList?.decimalPlaces ?? 2
  const isBaseCurrency = invoice ? invoice.isBaseCurrency : (rate?.isBaseCurrency ?? true)

  /* ── header ───────────────────────────────────────────────────────────────────────────────── */

  function changeHeader(patch: Partial<SalesInvoiceHeader>) {
    markDirty()
    const next = { ...patch }
    if (next.priceListId !== undefined) priceListTouched.current = true
    if (next.clientId && !priceListTouched.current) {
      const client = clients.find((c) => String(c.id) === next.clientId)
      if (client && client.defaultPriceListId !== null) next.priceListId = String(client.defaultPriceListId)
    }
    if (next.priceListId !== undefined || next.rateType !== undefined || next.documentDate !== undefined) rateDirty.current = true
    if (next.branchId !== undefined) setWarehouses([])
    setErrors({})
    setHeader((current) => ({ ...current, ...next }))
    // A new price list re-prices every line; the lines are re-resolved when they are next touched or saved.
    if (next.priceListId !== undefined && next.priceListId !== header.priceListId) void repriceAll(next.priceListId)
  }

  /* ── pricing and stock ────────────────────────────────────────────────────────────────────── */

  const resolvePrice = useCallback(
    async (itemUnitId: number, priceListId: string | null = header.priceListId) => {
      if (!priceListId) return null
      try {
        const answer = await unitPricesApi.resolve(itemUnitId, Number(priceListId), header.branchId ? Number(header.branchId) : null)
        return answer.price
      } catch {
        return null
      }
    },
    [header.priceListId, header.branchId],
  )

  async function repriceAll(priceListId: string | null) {
    for (const line of lines) {
      if (line.itemUnitId === null) continue
      const price = await resolvePrice(line.itemUnitId, priceListId)
      setLines((current) =>
        current.map((l) =>
          l.key === line.key && l.priceSource !== 'Manual' ? { ...l, unitPrice: price, systemPrice: price } : { ...l, systemPrice: l.key === line.key ? price : l.systemPrice },
        ),
      )
    }
  }

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

  const patchLine = useCallback((key: string, patch: Partial<InvoiceLine>) => {
    markDirty()
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch, error: undefined } : line)))
  }, [])

  /** The unit a sale defaults to: the sales unit, else the base unit. */
  const defaultUnit = (units: ItemUnitDto[]) => units.find((u) => u.isSalesUnit) ?? units.find((u) => u.isBaseUnit) ?? units[0]

  async function priceLine(key: string, unit: ItemUnitDto) {
    const price = await resolvePrice(unit.id)
    setLines((current) =>
      current.map((l) => (l.key === key ? { ...l, itemUnitId: unit.id, unitTypeName: unit.unitTypeName, packingFormula: unit.packingFormula, unitPrice: price, systemPrice: price, priceSource: 'PriceList' } : l)),
    )
  }

  const chooseItem = useCallback(
    async (key: string, itemId: number) => {
      markDirty()
      try {
        const details = await itemsApi.get(itemId)
        const unit = defaultUnit(details.units)
        setLines((current) =>
          current.map((line) =>
            line.key === key
              ? { ...line, itemId: details.id, itemCode: details.itemCode, itemName: details.itemName, units: details.units, itemUnitId: unit?.id ?? null, unitTypeName: unit?.unitTypeName ?? '', packingFormula: unit?.packingFormula ?? 1, unitPrice: null, systemPrice: null, priceSource: 'PriceList', onHandBase: null, error: undefined }
              : line,
          ),
        )
        if (unit) await priceLine(key, unit)
        void refreshOnHand(key, details.id)
        focusWhenDrawn(`[data-line-qty="${key}"] input`)
      } catch (error) {
        notify.error(error instanceof ApiError ? error.message : 'The item could not be loaded.')
      }
    },
    // priceLine reads the header through resolvePrice
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshOnHand, resolvePrice],
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
      const unit = defaultUnit(details.units)
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
      setLines((current) => [...current, { ...emptyLine(), key, itemId: details.id, itemCode: details.itemCode, itemName: details.itemName, units: details.units, itemUnitId: unit.id, unitTypeName: unit.unitTypeName, packingFormula: unit.packingFormula }])
      await priceLine(key, unit)
      void refreshOnHand(key, details.id)
      focusWhenDrawn(`[data-line-qty="${key}"] input`)
    },
    // priceLine reads the header through resolvePrice
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, patchLine, refreshOnHand, resolvePrice],
  )

  async function loadUnits(key: string) {
    const line = lines.find((l) => l.key === key)
    if (!line?.itemId) return
    try {
      const details = await itemsApi.get(line.itemId)
      setLines((current) => current.map((l) => (l.key === key ? { ...l, units: details.units } : l)))
    } catch {}
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
    const go = await confirm({ title: 'Clear all lines', message: `Remove all ${lines.length} line(s) from this invoice?`, confirmLabel: 'Clear', danger: true })
    if (go) {
      markDirty()
      setLines([])
    }
  }

  function appendImported(imported: ImportedLine[]) {
    markDirty()
    const added: InvoiceLine[] = imported.map((line) => ({
      ...emptyLine(),
      itemId: line.itemId,
      itemCode: line.itemCode,
      itemName: line.itemName,
      itemUnitId: line.itemUnitId,
      unitTypeName: line.unitTypeName,
      packingFormula: line.packingFormula,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      // The wizard's price is the list's unless the file carried an honoured manual one.
      systemPrice: line.priceSource === 'Manual' ? null : line.unitPrice,
      priceSource: line.priceSource === 'Manual' ? 'Manual' : 'PriceList',
      discountPercent: line.discountPercent,
      expiryDate: line.expiryDate,
      notes: line.notes ?? '',
      importRowNumber: line.importRowNumber,
    }))
    setLines((current) => [...current, ...added])
    notify.success(`${imported.length} line(s) imported.`)
    // On hand for the new rows: one lookup per line, in the header's warehouse.
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
    const next: SalesInvoiceHeaderErrors = {}
    if (!header.documentDate) next.documentDate = 'Choose a date.'
    if (!header.branchId) next.branchId = 'Choose a branch.'
    if (!header.warehouseId) next.warehouseId = 'Choose a warehouse.'
    if (!header.clientId) next.clientId = 'Choose a client.'
    if (!header.priceListId) next.priceListId = 'Choose a price list.'
    if (header.priceListId && !isBaseCurrency && header.exchangeRate === null) next.exchangeRate = 'Enter an exchange rate.'
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
    const unpriced = lines.findIndex((l) => l.unitPrice === null)
    if (unpriced >= 0) {
      const line = lines[unpriced]
      const message = `Line ${unpriced + 1}: no selling price for ${line.itemCode} (${line.unitTypeName}) in price list ${priceList?.priceListName ?? ''}. Add the price or enter a manual price (requires the price override permission).`
      setLines((current) => current.map((l, i) => (i === unpriced ? { ...l, error: message } : l)))
      notify.error(message)
      return false
    }
    return true
  }

  function toRequest(): SaveSalesInvoiceRequest {
    return {
      documentDate: header.documentDate,
      dueDate: header.dueDate,
      branchId: Number(header.branchId),
      warehouseId: Number(header.warehouseId),
      clientId: Number(header.clientId),
      salesmanId: header.salesmanId === null ? null : Number(header.salesmanId),
      priceListId: Number(header.priceListId),
      rateType: header.rateType,
      exchangeRate: isBaseCurrency ? null : header.exchangeRate,
      referenceNo: header.referenceNo.trim() || null,
      notes: header.notes.trim() || null,
      draftReference: isNew ? draftReference.current : null,
      rowVersion: invoice?.rowVersion ?? null,
      lines: lines.map((line, index) => ({
        lineNo: index + 1,
        itemId: line.itemId!,
        itemUnitId: line.itemUnitId!,
        warehouseId: Number(header.warehouseId),
        expiryDate: line.expiryDate,
        quantity: line.quantity,
        // Only a real override goes up; a list price echoed back would be recorded as one.
        unitPrice: priceEditable && line.priceSource === 'Manual' ? line.unitPrice : null,
        discountPercent: line.discountPercent,
        importRowNumber: line.importRowNumber,
        notes: line.notes.trim() || null,
      })),
    }
  }

  function showApiError(error: unknown) {
    if (!(error instanceof ApiError)) {
      notify.error('The invoice could not be saved.')
      return
    }
    setLines((current) => current.map((line) => ({ ...line, error: undefined })))
    const match = /^Line (\d+):/.exec(error.message)
    if ((error.code === 'VALIDATION' || error.code === 'NO_PRICE') && match) {
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

  async function saveDraft(): Promise<SalesInvoiceDto | null> {
    if (!validate()) return null
    setSaving(true)
    try {
      const saved = invoiceId === null ? await salesInvoicesApi.create(toRequest()) : await salesInvoicesApi.update(invoiceId, toRequest())
      applyInvoice(saved)
      notify.success(invoiceId === null ? 'Draft created.' : 'Draft saved.')
      if (invoiceId === null) navigate(`${ROUTE}/${saved.id}`, { replace: true })
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
    const go = await confirm({
      title: 'Post this invoice?',
      message: `Post this invoice? Stock will be removed from ${saved.warehouseName} and the number assigned.`,
      confirmLabel: 'Post',
    })
    if (!go) return
    setSaving(true)
    try {
      applyInvoice(await salesInvoicesApi.post(saved.id, saved.rowVersion))
      notify.success('Invoice posted.')
    } catch (error) {
      showApiError(error)
    } finally {
      setSaving(false)
    }
  }

  /**
   * The return of a posted invoice: the remaining quantities at the invoice's own prices and its
   * ORIGINAL cost of sales, so giving goods back reverses the margin that was booked.
   *
   * THERE IS NO RETURNS PAGE YET, so the draft is made and its number is said rather than opened.
   */
  async function createReturn() {
    if (!invoice) return
    const go = await confirm({
      title: 'Create return',
      message: `Create a sales return draft from ${invoice.documentNumber}, with everything that has not already come back?`,
      confirmLabel: 'Create',
    })
    if (!go) return

    setSaving(true)
    try {
      const created = await salesInvoicesApi.createReturn(invoice.id)
      notify.success(`Return draft ${created.documentNumber ?? `#${created.id}`} created (SRET). It is numbered when it is posted.`)
      await reload()
    } catch (error) {
      showApiError(error)
    } finally {
      setSaving(false)
    }
  }

  async function cancelInvoice(reason: string) {
    if (!invoice) return
    setCancelBusy(true)
    try {
      applyInvoice(await salesInvoicesApi.cancel(invoice.id, reason, invoice.rowVersion))
      notify.success('Invoice cancelled.')
      setCancelOpen(false)
    } catch (error) {
      showApiError(error)
    } finally {
      setCancelBusy(false)
    }
  }

  async function leave() {
    if (dirty.current) {
      const go = await confirm({ title: 'Leave without saving?', message: 'This invoice has changes that have not been saved. Leaving now discards them.', confirmLabel: 'Discard', danger: true })
      if (!go) return
    }
    void navigate(ROUTE)
  }

  async function exportToExcel() {
    if (!invoice) return
    try {
      await salesInvoicesApi.exportToExcel(invoice.id, `${invoice.documentNumber ?? `draft-${invoice.id}`}.xlsx`)
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The invoice could not be exported.')
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
        <PageHeader title="Sales Invoice" />
        <Alert color="red">{loadError}</Alert>
        <Group>
          <Button variant="default" onClick={() => void navigate(ROUTE)}>
            Back to Sales Invoices
          </Button>
        </Group>
      </Stack>
    )
  }

  const warehouseName = warehouses.find((w) => String(w.id) === header.warehouseId)?.warehouseName ?? invoice?.warehouseName ?? ''
  const canImportHere = editable && canImport && header.branchId !== null && header.warehouseId !== null && header.priceListId !== null

  const actions: DocumentAction[] = readOnly
    ? [
        { key: 'attachments', label: `Attachments (${invoice?.files.length ?? 0})`, icon: DocumentIcons.attachments, onClick: () => setAttachmentsOpen(true) },
        { key: 'export', label: 'Export to Excel', icon: DocumentIcons.exportFile, onClick: () => void exportToExcel() },
        { key: 'create-return', label: 'Create Return', icon: <IconArrowBackUp size={16} />, colour: 'orange', visible: canCreate && invoice?.canCreateReturn === true, loading: saving, onClick: () => void createReturn() },
        { key: 'cancel-doc', label: 'Cancel Invoice', icon: DocumentIcons.cancel, colour: 'red', visible: canCancelDoc && invoice?.canCancel === true, onClick: () => setCancelOpen(true) },
        { key: 'back', label: 'Back', icon: DocumentIcons.back, onClick: () => void navigate(ROUTE) },
      ]
    : [
        { key: 'attachments', label: `Attachments (${invoice?.files.length ?? 0})`, icon: DocumentIcons.attachments, onClick: () => setAttachmentsOpen(true) },
        { key: 'import', label: 'Import from Excel', icon: DocumentIcons.import, visible: canImportHere, onClick: () => setImportOpen(true) },
        { key: 'save', label: 'Save Draft', icon: DocumentIcons.save, visible: editable, loading: saving, onClick: () => void saveDraft() },
        { key: 'cancel', label: 'Cancel', icon: DocumentIcons.cancel, onClick: () => void leave() },
        { key: 'post', label: 'Save & Post', icon: DocumentIcons.post, variant: 'filled', visible: editable && canPost, loading: saving, onClick: () => void saveAndPost() },
      ]

  return (
    <Stack>
      <PageHeader title={isNew ? 'New Sales Invoice' : `Sales Invoice ${invoice?.documentNumber ?? `draft #${invoice?.id}`}`} />

      <DocumentActionBar actions={actions} />

      {invoice && status === 'Posted' && (
        <Alert color="green" title={`Posted — ${invoice.documentNumber}`}>
          Posted by {invoice.postedByName ?? 'unknown'} on {stamp(invoice.postedAtUtc)}. Stock has been removed and this invoice can no longer be edited.
        </Alert>
      )}
      {invoice && status === 'Cancelled' && (
        <Alert color="red" title={`Cancelled — ${invoice.documentNumber ?? 'draft'}`}>
          Cancelled by {invoice.cancelledByName ?? 'unknown'} on {stamp(invoice.cancelledAtUtc)}.{invoice.cancelReason ? ` Reason: ${invoice.cancelReason}` : ''}
        </Alert>
      )}

      <SalesInvoiceHeaderCard
        value={header}
        onChange={changeHeader}
        branches={branches}
        warehouses={warehouses}
        priceLists={priceLists}
        clients={clients}
        salesmen={salesmen}
        rate={rate}
        rateLoading={rateLoading}
        documentNumber={invoice?.documentNumber ?? null}
        isNew={isNew}
        readOnly={!editable}
        errors={errors}
        disabled={saving}
      />

      <Paper radius="lg" p="md" withBorder>
        <Group justify="space-between" align="flex-end" mb="sm" wrap="wrap">
          <Title order={5}>Invoice Lines</Title>
          <Group gap="xs">
            {editable && (
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
            {invoice && (
              <Button variant="default" onClick={() => void exportToExcel()}>
                Export to Excel
              </Button>
            )}
          </Group>
        </Group>

        {editable && (
          <Group mb="md" align="flex-end">
            <QuickItemSearch onPick={(item) => void addScanned(item)} />
          </Group>
        )}

        <SalesInvoiceLinesGrid
          lines={lines}
          onChange={patchLine}
          onRemove={removeLine}
          onAdd={addEmptyLine}
          items={items}
          onItemChosen={(key, itemId) => void chooseItem(key, itemId)}
          onUnitChosen={(key, unit) => {
            markDirty()
            void priceLine(key, unit)
          }}
          onUnitsNeeded={(key) => void loadUnits(key)}
          currencyCode={currencyCode}
          decimalPlaces={decimalPlaces}
          priceListName={priceList?.priceListName ?? invoice?.priceListName ?? 'the price list'}
          priceEditable={priceEditable}
          readOnly={!editable}
        />
      </Paper>

      <Grid>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <AuditTrail entries={invoice?.audit ?? []} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <SalesTotals
            title="Summary"
            totalItems={totals.items}
            totalQuantity={totals.quantity}
            subtotal={totals.subtotal}
            totalDiscount={totals.discount}
            totalAmount={totals.total}
            currencyCode={currencyCode}
            decimalPlaces={decimalPlaces}
            baseCurrencyCode={invoice?.baseCurrencyCode ?? rate?.baseCurrencyCode}
            exchangeRate={header.exchangeRate}
            isBaseCurrency={isBaseCurrency}
          />
        </Grid.Col>
      </Grid>

      {/* Only a posted invoice has a frozen cost to show, and only a holder of sales.profit.view sees it. */}
      {invoice && canSeeProfit && invoice.totalCostBase !== null && (
        <SalesInvoiceProfitCard invoice={invoice} baseCurrencyCode={invoice.baseCurrencyCode ?? 'USD'} />
      )}

      <AttachmentsDrawer
        opened={attachmentsOpen}
        onClose={() => setAttachmentsOpen(false)}
        documentId={invoice?.id ?? null}
        files={invoice?.files ?? []}
        onChanged={() => void reload()}
        canEdit={canCreate}
        api={salesInvoicesApi}
      />

      <CancelReasonModal opened={cancelOpen} onClose={() => setCancelOpen(false)} documentLabel={invoice?.documentNumber ?? `draft #${invoice?.id}`} busy={cancelBusy} onConfirm={(reason) => void cancelInvoice(reason)} />

      {canImportHere && (
        <ImportInvoiceItemsWizard
          opened={importOpen}
          onClose={() => setImportOpen(false)}
          header={{
            branchId: Number(header.branchId),
            warehouseId: Number(header.warehouseId),
            warehouseCode: warehouses.find((w) => String(w.id) === header.warehouseId)?.warehouseCode,
            priceListId: Number(header.priceListId),
            currencyCode,
            decimalPlaces,
          }}
          documentTypeCode={TYPE}
          mode="invoice"
          checkStock
          draftReference={invoice ? `SINV-${invoice.id}` : draftReference.current}
          onImported={appendImported}
          importCreate={(imported, postImmediately) =>
            salesInvoicesApi.importCreate({
              documentDate: header.documentDate,
              dueDate: header.dueDate,
              branchId: Number(header.branchId),
              clientId: Number(header.clientId),
              salesmanId: header.salesmanId === null ? null : Number(header.salesmanId),
              priceListId: Number(header.priceListId),
              rateType: header.rateType,
              exchangeRate: isBaseCurrency ? null : header.exchangeRate,
              referenceNo: header.referenceNo.trim() || null,
              notes: header.notes.trim() || null,
              draftReference: draftReference.current,
              postImmediately,
              lines: imported.map((line) => ({
                warehouseId: line.warehouseId,
                itemId: line.itemId,
                itemUnitId: line.itemUnitId,
                quantity: line.quantity,
                unitPrice: line.priceSource === 'Manual' ? line.unitPrice : null,
                discountPercent: line.discountPercent,
                expiryDate: line.expiryDate,
                notes: line.notes,
                importRowNumber: line.importRowNumber,
              })),
            })
          }
          documentRoute={(docId) => `${ROUTE}/${docId}`}
          onDocumentsCreated={(created) => {
            dirty.current = false
            void navigate(ROUTE, { state: { highlight: created.documents.map((d) => d.id) } })
          }}
          onSwitchWarehouse={(warehouseId) => {
            markDirty()
            setHeader((current) => ({ ...current, warehouseId: String(warehouseId) }))
          }}
        />
      )}

      {/* The count of lines whose stock is short, said once above the grid rather than only per row. */}
      {editable && lines.some((l) => l.onHandBase !== null && l.quantity * (l.packingFormula || 1) > l.onHandBase) && (
        <Alert color="orange">
          {formatNumber(lines.filter((l) => l.onHandBase !== null && l.quantity * (l.packingFormula || 1) > l.onHandBase).length)} line(s) ask for more than the stock on hand in {warehouseName}. The posting will be refused unless the quantities are reduced.
        </Alert>
      )}
    </Stack>
  )
}
