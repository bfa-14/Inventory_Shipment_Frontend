import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Alert, Button, Grid, Group, Loader, Paper, Stack, Title } from '@mantine/core'
import { IconArrowBackUp, IconPlus, IconTrash } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { itemsApi } from '../../api/inventory/items'
import { inventoryLookupsApi } from '../../api/inventory/stockDocuments'
import { branchesApi } from '../../api/masterdata/branches'
import { currenciesApi } from '../../api/masterdata/currencies'
import { partiesApi } from '../../api/masterdata/parties'
import { priceListsApi } from '../../api/masterdata/priceLists'
import { cashBankAccountsApi, type CashBankAccountLookupDto } from '../../api/masterdata/cashBankAccounts'
import { paymentMethodsApi, type PaymentMethodLookupDto } from '../../api/masterdata/paymentMethods'
import { unitPricesApi } from '../../api/masterdata/unitPrices'
import { warehousesApi } from '../../api/masterdata/warehouses'
import {
  salesInvoicesApi,
  type RateResolutionDto,
  type SalesInvoiceDto,
  type SaveSalesInvoiceRequest,
} from '../../api/sales/invoices'
import type { BranchLookupDto, CurrencyLookupDto, ItemListDto, ItemLookupDto, ItemUnitDto, PartyLookupDto, PriceListLookupDto, WarehouseLookupDto } from '../../api/types'
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
import { SalesPaymentCard } from '../../components/sales/SalesPaymentCard'
import { EMPTY_PAYMENT, type SalesPaymentErrors, type SalesPaymentForm } from '../../components/sales/salesPayment'
import { SalesInvoiceProfitCard } from '../../components/sales/SalesInvoiceProfitCard'
import { SalesTotals } from '../../components/sales/SalesTotals'
import { decideOutOfStock } from '../../components/sales/outOfStock'
import { confirm } from '../../components/ui/confirm'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { pricingOf, useDocumentTypes } from '../../hooks/useDocumentTypes'
import { PERMISSIONS } from '../../navigation'

const ROUTE = '/sales/invoices'
const TYPE = 'SINV'

let keySeed = 0
const nextKey = () => `inv-${++keySeed}`

function emptyLine(warehouseId: number | null): InvoiceLine {
  return {
    key: nextKey(), id: null, itemId: null, itemCode: '', itemName: '', itemUnitId: null, unitTypeName: '', packingFormula: 1,
    specification: null,
    specifications: [],
    warehouseId,
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
  /**
   * The warehouse a NEW line starts in — not the invoice's.
   *
   * The warehouse belongs to each line now, but picking one on every row would be a step backwards
   * for the ordinary invoice that ships from a single warehouse. The branch's main warehouse seeds
   * new rows and the row's own cell overrides it.
   */
  const [defaultWarehouseId, setDefaultWarehouseId] = useState<number | null>(null)
  const [priceLists, setPriceLists] = useState<PriceListLookupDto[]>([])
  const [clients, setClients] = useState<PartyLookupDto[]>([])
  const [salesmen, setSalesmen] = useState<PartyLookupDto[]>([])
  const [items, setItems] = useState<ItemLookupDto[]>([])
  const [currencies, setCurrencies] = useState<CurrencyLookupDto[]>([])

  const [header, setHeader] = useState<SalesInvoiceHeader>({
    documentDate: isoDate(new Date()), dueDate: null, branchId: null, clientId: null, salesmanId: null,
    priceListId: null, currencyId: null, rateType: 1, exchangeRate: null, referenceNo: '', notes: '',
  })
  const [errors, setErrors] = useState<SalesInvoiceHeaderErrors>({})
  /* HOW THE CUSTOMER PAYS lives beside the header, not in it: it is its own card and its own rule
     (Cash makes a receipt when posted), and the header card is shared with nothing that has one. */
  const [payment, setPayment] = useState<SalesPaymentForm>(EMPTY_PAYMENT)
  const [paymentErrors, setPaymentErrors] = useState<SalesPaymentErrors>({})
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodLookupDto[]>([])
  const [cashAccounts, setCashAccounts] = useState<CashBankAccountLookupDto[]>([])
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
    // SALES UNITS ONLY: an item with nothing sellable cannot be put on an invoice.
    itemsApi.lookup(true, undefined, undefined, true).then(setItems).catch(() => {})
    currenciesApi.lookup().then(setCurrencies).catch(() => notify.error('Currencies could not be loaded.'))
    paymentMethodsApi.lookup(false).then(setPaymentMethods).catch(() => notify.error('Payment methods could not be loaded.'))
    cashBankAccountsApi.lookup({ activeOnly: false }).then(setCashAccounts).catch(() => notify.error('Cash and bank accounts could not be loaded.'))
    // isNew comes from the route and the user from the session; neither changes without a remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyInvoice = useCallback((doc: SalesInvoiceDto) => {
    setInvoice(doc)
    setHeader({
      documentDate: doc.documentDate.slice(0, 10),
      dueDate: doc.dueDate ? doc.dueDate.slice(0, 10) : null,
      branchId: String(doc.branchId),
      clientId: String(doc.clientId),
      salesmanId: doc.salesmanId === null ? null : String(doc.salesmanId),
      priceListId: String(doc.priceListId),
      // The saved invoice always names its currency; it may or may not be the price list's.
      currencyId: String(doc.currencyId),
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
        warehouseId: line.warehouseId,
        specification: line.specification ?? null,
        // Filled in by loadUnits when the row's units arrive; the saved value shows meanwhile.
        specifications: [],
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
    setPayment({
      paymentType: doc.paymentType,
      receiptMethodId: doc.receiptMethodId === null ? null : String(doc.receiptMethodId),
      receiptAccountId: doc.receiptAccountId === null ? null : String(doc.receiptAccountId),
      paymentReference: doc.paymentReference ?? '',
    })
    priceListTouched.current = true
    rateDirty.current = false
    dirty.current = false

    /* THE SUGGESTIONS FOLLOW, ONE CALL PER DISTINCT ITEM. A reopened draft must offer the same list
       a fresh row does, or the box would look emptier on the invoice that has been saved. The
       saved text already shows without them; this only fills what the dropdown proposes. */
    const items = [...new Set(doc.lines.map((l) => l.itemId))]
    for (const itemId of items) {
      salesInvoicesApi
        .itemSpecifications(itemId)
        .then((rows) =>
          setLines((current) =>
            current.map((l) => (l.itemId === itemId ? { ...l, specifications: rows } : l)),
          ),
        )
        .catch(() => {})
    }
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

  /* A LINE MAY SHIP FROM A WAREHOUSE OF ANY BRANCH, so every active warehouse is offered on the lines.
     Only the seed for new rows follows the header: the branch's main warehouse. */
  useEffect(() => {
    let cancelled = false
    warehousesApi
      .lookup(true)
      .then((rows) => {
        if (!cancelled) setWarehouses(rows)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (header.branchId === null) return
    setDefaultWarehouseId((current) => {
      if (current !== null) return current
      const own = warehouses.filter((w) => w.branchId === Number(header.branchId))
      const main = own.find((w) => w.isMainWarehouse) ?? own[0]
      return main ? main.id : null
    })
  }, [header.branchId, warehouses])

  /* The rate follows the price list, the type and the date — but overwrites a loaded invoice's own
     rate only once the reader changed one of the three. */
  const rateKey = header.priceListId ? `${header.priceListId}|${header.rateType}|${header.documentDate}|${header.currencyId ?? ''}` : ''
  useEffect(() => {
    if (!header.priceListId) return
    const key = `${header.priceListId}|${header.rateType}|${header.documentDate}|${header.currencyId ?? ''}`
    const controller = new AbortController()
    salesInvoicesApi
      .rate(Number(header.priceListId), header.rateType, header.documentDate || null, controller.signal, header.currencyId ? Number(header.currencyId) : null)
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
  }, [header.priceListId, header.rateType, header.documentDate, header.currencyId])

  const rateLoading = rateKey !== '' && rateFor !== rateKey
  const priceList = priceLists.find((p) => String(p.id) === header.priceListId) ?? null
  const currencyCode = invoice?.currencyCode ?? rate?.currencyCode ?? priceList?.currencyCode ?? 'USD'
  const decimalPlaces = invoice?.decimalPlaces ?? rate?.decimalPlaces ?? priceList?.decimalPlaces ?? 2
  const isBaseCurrency = invoice ? invoice.isBaseCurrency : (rate?.isBaseCurrency ?? true)
  /** The currency the invoice is billed in, as an id: what a cash account has to hold. */
  const invoiceCurrencyId = invoice?.currencyId ?? rate?.currencyId ?? null

  function changePayment(patch: Partial<SalesPaymentForm>) {
    markDirty()
    setPaymentErrors({})
    setPayment((current) => {
      const next = { ...current, ...patch }
      // On Account carries no method, account or reference: they would only be dropped on save anyway.
      if (patch.paymentType === 2) return { ...next, receiptMethodId: null, receiptAccountId: null, paymentReference: '' }
      return next
    })
  }

  // An account that no longer fits the invoice's currency or branch is cleared, not left for the server to refuse.
  useEffect(() => {
    if (payment.receiptAccountId === null || !editable || invoiceCurrencyId === null) return
    const account = cashAccounts.find((a) => String(a.id) === payment.receiptAccountId)
    const branch = header.branchId === null ? null : Number(header.branchId)
    if (account && (account.currencyId !== invoiceCurrencyId || (account.branchId !== null && branch !== null && account.branchId !== branch))) {
      setPayment((current) => ({ ...current, receiptAccountId: null }))
    }
  }, [invoiceCurrencyId, header.branchId, payment.receiptAccountId, cashAccounts, editable])

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
    /* A branch change keeps the lines' warehouses (a line may use any branch's); only the seed for
       new rows moves to the new branch's main warehouse. */
    if (next.branchId !== undefined) setDefaultWarehouseId(null)
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
    /* THE WAREHOUSE IS THE CALLER'S, not the header's: every row may ship from a different one, so
       a lookup that read one shared warehouse would put the wrong stock against most rows. */
    async (key: string, itemId: number, warehouseId: number | null) => {
      if (warehouseId === null) return
      try {
        const { onHandBase } = await inventoryLookupsApi.onHand(itemId, warehouseId)
        setLines((current) => current.map((l) => (l.key === key ? { ...l, onHandBase } : l)))
      } catch {}
    },
    [],
  )

  const patchLine = useCallback((key: string, patch: Partial<InvoiceLine>) => {
    markDirty()
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch, error: undefined } : line)))
  }, [])

  /**
   * The units an invoice line may offer: the ones marked as sales units.
   *
   * KEEPS THE UNIT THE LINE ALREADY HOLDS, whatever its flag. A saved invoice may carry a unit that
   * has since been taken off sale, and dropping it from the list would blank the Unit cell on a
   * document nobody is allowed to change — the same trap the item picker has with inactive items.
   * A unit kept this way is the only non-sales one in the list, and only on that line.
   */
  /**
   * Fills a row's Specification suggestions from what other invoices called the same item.
   *
   * FETCHED PER ITEM, NOT HELD FOR THE PAGE. The list is small, it only changes when somebody
   * invoices that item, and a row without an item has nothing to ask about. A failure is silent:
   * the cell is free text, so losing the suggestions costs the reader nothing but convenience.
   */
  const loadSpecifications = useCallback(async (key: string, itemId: number) => {
    try {
      const rows = await salesInvoicesApi.itemSpecifications(itemId)
      setLines((current) => current.map((l) => (l.key === key ? { ...l, specifications: rows } : l)))
    } catch {}
  }, [])

  const sellableUnits = (units: ItemUnitDto[], keepId?: number | null) =>
    units.filter((u) => u.isSalesUnit || (keepId != null && u.id === keepId))

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
              ? { ...line, itemId: details.id, itemCode: details.itemCode, itemName: details.itemName, units: sellableUnits(details.units, unit?.id), itemUnitId: unit?.id ?? null, unitTypeName: unit?.unitTypeName ?? '', packingFormula: unit?.packingFormula ?? 1, unitPrice: null, systemPrice: null, priceSource: 'PriceList', onHandBase: null, error: undefined }
              : line,
          ),
        )
        if (unit) await priceLine(key, unit)
        void refreshOnHand(key, details.id, lines.find((l) => l.key === key)?.warehouseId ?? defaultWarehouseId)
        void loadSpecifications(key, details.id)
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
      /* A SCAN CAN REACH AN ITEM THE PICKER HIDES. The Item list is filtered to what may be sold,
         but a barcode goes straight to the item, so the same rule is enforced here — otherwise a
         scan would be the way round it. */
      if (!unit.isSalesUnit) {
        notify.error(`${details.itemCode} has no unit marked as a sales unit, so it cannot be sold.`)
        return
      }
      /*
       * THE MATCH HAPPENS INSIDE THE UPDATER, not against `lines`.
       *
       * This function awaits the item before it can look for a row to add to, and a barcode scanner
       * fires faster than that: two scans of the same code both read the lines as they were BEFORE
       * either had added anything, both found nothing, and both appended — the duplicate row. Only
       * the updater is handed the current lines, so only there can the second scan see the first.
       *
       * SAME ITEM, SAME UNIT, SAME WAREHOUSE, SAME PRICE. The warehouse is a line's own now, so two
       * rows for one item in two warehouses are two different things. A row somebody has priced by
       * hand is left alone as well: a scan re-applies the list price, and quietly adding to an
       * overridden row would sell the extra unit at a price nobody chose for it.
       */
      const key = nextKey()
      let addedTo: string | null = null

      setLines((current) => {
        const existing = current.find(
          (l) => l.itemId === details.id
            && l.itemUnitId === unit.id
            && l.warehouseId === defaultWarehouseId
            && l.priceSource !== 'Manual',
        )
        if (existing) {
          addedTo = existing.key
          return current.map((l) =>
            l.key === existing.key ? { ...l, quantity: l.quantity + 1, error: undefined } : l,
          )
        }
        return [...current, { ...emptyLine(defaultWarehouseId), key, itemId: details.id, itemCode: details.itemCode, itemName: details.itemName, units: sellableUnits(details.units, unit.id), itemUnitId: unit.id, unitTypeName: unit.unitTypeName, packingFormula: unit.packingFormula }]
      })

      // A row that was added to already has its price and its stock; only a new one needs them.
      if (addedTo !== null) {
        focusWhenDrawn(`[data-line-qty="${addedTo}"] input`)
        return
      }

      await priceLine(key, unit)
      void refreshOnHand(key, details.id, defaultWarehouseId)
      void loadSpecifications(key, details.id)
      focusWhenDrawn(`[data-line-qty="${key}"] input`)
    },
    // priceLine reads the header through resolvePrice
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defaultWarehouseId, patchLine, refreshOnHand, resolvePrice],
  )

  async function loadUnits(key: string) {
    const line = lines.find((l) => l.key === key)
    if (!line?.itemId) return
    try {
      const details = await itemsApi.get(line.itemId)
      setLines((current) => current.map((l) => (l.key === key ? { ...l, units: sellableUnits(details.units, l.itemUnitId) } : l)))
    } catch {}
  }

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
    const go = await confirm({ title: 'Clear all lines', message: `Remove all ${lines.length} line(s) from this invoice?`, confirmLabel: 'Clear', danger: true })
    if (go) {
      markDirty()
      setLines([])
    }
  }

  function appendImported(imported: ImportedLine[]) {
    markDirty()
    const added: InvoiceLine[] = imported.map((line) => ({
      ...emptyLine(line.warehouseId ?? defaultWarehouseId),
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
    // On hand for the new rows: one lookup per line, each in that LINE's warehouse.
    for (const line of added) if (line.itemId !== null) void refreshOnHand(line.key, line.itemId, line.warehouseId)
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

  /** What posting needs beyond a savable draft: a Payment Type, and for Cash the method and account. */
  function validatePaymentForPosting(): boolean {
    const next: SalesPaymentErrors = {}
    if (payment.paymentType === null) next.paymentType = 'Choose Cash or On Account.'
    if (payment.paymentType === 1) {
      if (!payment.receiptMethodId) next.receiptMethodId = 'Choose how the money is received.'
      if (!payment.receiptAccountId) next.receiptAccountId = 'Choose the cash / bank account.'
    }
    setPaymentErrors(next)
    if (Object.keys(next).length > 0) {
      notify.error('Complete the Payment section before posting.')
      return false
    }
    return true
  }

  function toRequest(): SaveSalesInvoiceRequest {
    return {
      documentDate: header.documentDate,
      dueDate: header.dueDate,
      branchId: Number(header.branchId),
      // Omitted on purpose: the warehouse is a LINE's now, and the server keeps the first one.
      warehouseId: null,
      clientId: Number(header.clientId),
      salesmanId: header.salesmanId === null ? null : Number(header.salesmanId),
      priceListId: Number(header.priceListId),
      // Null follows the price list's currency, which is what an untouched header means.
      currencyId: header.currencyId ? Number(header.currencyId) : null,
      rateType: header.rateType,
      exchangeRate: isBaseCurrency ? null : header.exchangeRate,
      referenceNo: header.referenceNo.trim() || null,
      notes: header.notes.trim() || null,
      paymentType: payment.paymentType,
      receiptMethodId: payment.paymentType === 1 && payment.receiptMethodId ? Number(payment.receiptMethodId) : null,
      receiptAccountId: payment.paymentType === 1 && payment.receiptAccountId ? Number(payment.receiptAccountId) : null,
      paymentReference: payment.paymentType === 1 ? payment.paymentReference.trim() || null : null,
      draftReference: isNew ? draftReference.current : null,
      rowVersion: invoice?.rowVersion ?? null,
      lines: lines.map((line, index) => ({
        lineNo: index + 1,
        itemId: line.itemId!,
        itemUnitId: line.itemUnitId!,
        specification: line.specification,
        warehouseId: line.warehouseId!,
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
        for (const line of lines) if (line.itemCode === stock[1] && line.itemId) void refreshOnHand(line.key, line.itemId, line.warehouseId)
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
    // Asked for BEFORE saving: a draft can be saved half-filled, but nobody should reach the post question without a type.
    if (!validatePaymentForPosting()) return
    const saved = await saveDraft()
    if (!saved) return
    const cash = saved.paymentType === 1
    const go = await confirm({
      title: cash ? 'Post this invoice and take the payment?' : 'Post this invoice?',
      message: cash
        ? `Post this invoice? Stock will be removed from ${saved.warehouseName}, the number assigned, and a receipt for ${formatNumber(saved.totalAmount, saved.decimalPlaces)} ${saved.currencyCode} created and posted into ${saved.receiptAccountCode ?? 'the chosen account'}. The invoice will be Fully Paid.`
        : `Post this invoice? Stock will be removed from ${saved.warehouseName} and the number assigned. It stays unpaid until receipts are allocated to it.`,
      confirmLabel: cash ? 'Post and receive' : 'Post',
    })
    if (!go) return
    setSaving(true)
    try {
      /* THE OUT-OF-STOCK GATE. Asked of the server now, so the warning names the real figures and a refusal
         is explained before anything is attempted. The warning is shown even where the setting allows the sale. */
      const decision = await decideOutOfStock(saved.id)
      if (!decision.proceed) return
      applyInvoice(await salesInvoicesApi.post(saved.id, saved.rowVersion, decision.acknowledge))
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

  const canImportHere = editable && canImport && header.branchId !== null && defaultWarehouseId !== null && header.priceListId !== null

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
        priceLists={priceLists}
        clients={clients}
        currencies={currencies}
        salesmen={salesmen}
        rate={rate}
        rateLoading={rateLoading}
        documentNumber={invoice?.documentNumber ?? null}
        isNew={isNew}
        readOnly={!editable}
        errors={errors}
        disabled={saving}
      />

      {/* Paid / outstanding come from live allocations on posted receipts, never from a column on the invoice. */}
      <SalesPaymentCard
        value={payment}
        onChange={changePayment}
        methods={paymentMethods}
        accounts={cashAccounts}
        currencyId={invoiceCurrencyId}
        currencyCode={currencyCode}
        branchId={header.branchId === null ? null : Number(header.branchId)}
        readOnly={!editable}
        disabled={saving}
        errors={paymentErrors}
        paymentStatus={invoice?.paymentStatus ?? null}
        paidAmount={invoice?.paidAmount ?? null}
        outstandingAmount={invoice?.outstandingAmount ?? null}
        totalAmount={invoice?.totalAmount ?? null}
        decimalPlaces={decimalPlaces}
        receiptId={invoice?.receiptId ?? null}
        receiptNumber={invoice?.receiptNumber ?? null}
        receiptStatus={invoice?.receiptStatus ?? null}
        methodName={invoice?.receiptMethodName ?? null}
        accountLabel={invoice?.receiptAccountCode ? `${invoice.receiptAccountCode} - ${invoice.receiptAccountName ?? ''}` : null}
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
          warehouses={warehouses.map((w) => ({ value: String(w.id), label: `${w.warehouseName} (${w.branchName})` }))}
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
        documentKind={invoice?.documentTypeCode === 'SRET' ? 'SRET' : invoice?.documentTypeCode === 'SO' ? 'SO' : TYPE}
        onChanged={() => void reload()}
        canEdit={canCreate}
        api={salesInvoicesApi.files}
      />

      <CancelReasonModal
        opened={cancelOpen}
        onClose={() => setCancelOpen(false)}
        documentLabel={invoice?.documentNumber ?? `draft #${invoice?.id}`}
        busy={cancelBusy}
        onConfirm={(reason) => void cancelInvoice(reason)}
        description={
          invoice?.receiptStatus === 'Posted'
            ? `Cancelling writes the opposite stock movements AND reverses this cash sale's receipt ${invoice.receiptNumber ?? ''}, with the same reason. The invoice and the receipt stay in place as a record. It cannot be undone.`
            : undefined
        }
      />

      {canImportHere && (
        <ImportInvoiceItemsWizard
          opened={importOpen}
          onClose={() => setImportOpen(false)}
          header={{
            branchId: Number(header.branchId),
            warehouseId: defaultWarehouseId!,
            warehouseCode: warehouses.find((w) => w.id === defaultWarehouseId)?.warehouseCode,
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
              paymentType: payment.paymentType,
              receiptMethodId: payment.paymentType === 1 && payment.receiptMethodId ? Number(payment.receiptMethodId) : null,
              receiptAccountId: payment.paymentType === 1 && payment.receiptAccountId ? Number(payment.receiptAccountId) : null,
              paymentReference: payment.paymentType === 1 ? payment.paymentReference.trim() || null : null,
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
            /* The invoice has no warehouse of its own to switch any more, so this moves the LINES
               and the seed for new rows — which is what "the file is for another warehouse" meant. */
            markDirty()
            setDefaultWarehouseId(warehouseId)
            setLines((current) => current.map((line) => ({ ...line, warehouseId, onHandBase: null })))
          }}
        />
      )}

      {/* The count of lines whose stock is short, said once above the grid rather than only per row. */}
      {editable && lines.some((l) => l.onHandBase !== null && l.quantity * (l.packingFormula || 1) > l.onHandBase) && (
        <Alert color="orange">
          {/* NO WAREHOUSE IS NAMED HERE any more: each line has its own, so one name would be wrong
              for most of the rows it is counting. The Warehouse column on the row says which. */}
          {formatNumber(lines.filter((l) => l.onHandBase !== null && l.quantity * (l.packingFormula || 1) > l.onHandBase).length)} line(s) ask for more than the stock on hand in their warehouse. Posting will ask you to confirm if selling out-of-stock items is allowed there, and will be refused if it is not.
        </Alert>
      )}
    </Stack>
  )
}
