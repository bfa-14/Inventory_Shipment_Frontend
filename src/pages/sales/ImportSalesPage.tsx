import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Grid, Group, Paper, Stack, Text, Title, Tooltip } from '@mantine/core'
import {
  IconCheck,
  IconFileExport,
  IconFileImport,
  IconRefresh,
  IconTrash,
  IconTruckDelivery,
} from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { inventoryLookupsApi } from '../../api/inventory/stockDocuments'
import { branchesApi } from '../../api/masterdata/branches'
import { cashBankAccountsApi, type CashBankAccountLookupDto } from '../../api/masterdata/cashBankAccounts'
import { partiesApi } from '../../api/masterdata/parties'
import { paymentMethodsApi, type PaymentMethodLookupDto } from '../../api/masterdata/paymentMethods'
import { priceListsApi } from '../../api/masterdata/priceLists'
import { warehousesApi } from '../../api/masterdata/warehouses'
import {
  salesInvoicesApi,
  type ImportPostResult,
  type RateResolutionDto,
  type SaveSalesInvoiceRequest,
} from '../../api/sales/invoices'
import type { BranchLookupDto, PartyLookupDto, PriceListLookupDto, WarehouseLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { DocumentActionBar, type DocumentAction } from '../../components/documents/DocumentActionBar'
import { isoDate } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import {
  ImportInvoiceItemsWizard,
  type ImportedLine,
} from '../../components/sales/ImportInvoiceItemsWizard'
import {
  SalesImportHeaderCard,
  type SalesImportHeader,
  type SalesImportHeaderErrors,
} from '../../components/sales/SalesImportHeaderCard'
import { SalesLinesGrid, type SalesLine } from '../../components/sales/SalesLinesGrid'
import { SalesPaymentCard } from '../../components/sales/SalesPaymentCard'
import { EMPTY_PAYMENT, type SalesPaymentErrors, type SalesPaymentForm } from '../../components/sales/salesPayment'
import { SalesTotals } from '../../components/sales/SalesTotals'
import { mergeImported, stockKey } from '../../components/sales/salesLines'
import { confirmOutOfStock, parseOutOfStockMessage, type OutOfStockRow } from '../../components/sales/outOfStock'
import { confirm } from '../../components/ui/confirm'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { PERMISSIONS } from '../../navigation'

/** The wizard's draft reference: new for every batch of lines, stable while they sit on the page. */
const newDraftReference = () => `IMPORT-${Date.now().toString(36).toUpperCase()}`

/** Those header fields whose change makes the lines stale: they were validated against the old values. */
const HEADER_KEYS_THAT_INVALIDATE_LINES: (keyof SalesImportHeader)[] = ['branchId', 'warehouseId', 'priceListId']

/**
 * Import Sales from Excel: validate a file against master data AND the stock on hand, look at the
 * lines, then post them to stock as a sales invoice — in one call.
 *
 * THERE IS NO DRAFT ON THIS PAGE, and that is the shape of the feature rather than a shortcut. The
 * lines live in the browser until the reader presses Post; the server then saves and posts them
 * together, and deletes the draft itself if the posting is refused. What the reader sees is a file,
 * a grid and a posted invoice number — never an invoice they have to go and find.
 *
 * THE STOCK IS CHECKED THREE TIMES, each time closer to the truth. The wizard's preview marks rows
 * that would overdraw the shelf; the grid re-runs the same running total as quantities are edited;
 * and the server refuses the posting if the shelf moved in between. The first two save a round
 * trip; only the third is a rule.
 *
 * THE SERVER'S SENTENCES ARE SHOWN UNCHANGED. "Line 2: no selling price…" goes on line 2 and in a
 * notify; "Insufficient stock for TVS-AP160 in wh-002: …" highlights every line of that item and
 * warehouse and refreshes their on-hand figure, because the figure the page had is the one that
 * was wrong.
 */
export function ImportSalesPage() {
  const { user, hasPermission } = useAuth()

  const canPost = hasPermission(PERMISSIONS.invoicesPost)
  const canCreate = hasPermission(PERMISSIONS.invoicesCreate)
  const canOverridePrice = hasPermission(PERMISSIONS.invoicesPriceOverride)

  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseLookupDto[]>([])
  const [priceLists, setPriceLists] = useState<PriceListLookupDto[]>([])
  const [clients, setClients] = useState<PartyLookupDto[]>([])
  const [salesmen, setSalesmen] = useState<PartyLookupDto[]>([])

  const [header, setHeader] = useState<SalesImportHeader>({
    branchId: null,
    warehouseId: null,
    priceListId: null,
    clientId: null,
    salesmanId: null,
    documentDate: isoDate(new Date()),
    rateType: 1,
    exchangeRate: null,
    referenceNo: '',
    notes: '',
  })
  const [errors, setErrors] = useState<SalesImportHeaderErrors>({})
  /* HOW THE CUSTOMER PAYS: the invoice this import makes is posted at once, so a Cash import also
     makes and posts its receipt in the same step, exactly like posting a Cash invoice. */
  const [payment, setPayment] = useState<SalesPaymentForm>(EMPTY_PAYMENT)
  const [paymentErrors, setPaymentErrors] = useState<SalesPaymentErrors>({})
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodLookupDto[]>([])
  const [cashAccounts, setCashAccounts] = useState<CashBankAccountLookupDto[]>([])

  /** Set once the reader picks a price list by hand; a client's default no longer overrides it. */
  const priceListTouched = useRef(false)

  const [rate, setRate] = useState<RateResolutionDto | null>(null)
  /** Which price list / type / date the rate above answers, so a stale answer reads as loading. */
  const [rateFor, setRateFor] = useState<string>('')

  const [lines, setLines] = useState<SalesLine[]>([])
  /** The server's "Line N:" refusals, by line key. Cleared on the next attempt. */
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({})

  /** Stock per item + warehouse. A ref for the fetch bookkeeping, a state for the render. */
  const onHandRef = useRef<Record<string, number | null>>({})
  const [onHand, setOnHand] = useState<Record<string, number | null>>({})

  const [wizardOpen, setWizardOpen] = useState(false)
  const draftReference = useRef(newDraftReference())

  const [posting, setPosting] = useState(false)
  const [result, setResult] = useState<ImportPostResult | null>(null)

  /* ── lookups and defaults ─────────────────────────────────────────────────────────────────── */

  useEffect(() => {
    /* THE DEFAULTS ARE CHOSEN WHERE THE DATA ARRIVES. The main branch, the only client when there
       is one, and the salesman who is the signed-in user are each decided in the fetch that brings
       them — not in an effect watching the lists, which would be a second render deciding what the
       first already knew. */
    paymentMethodsApi.lookup(false).then(setPaymentMethods).catch(() => {})
    cashBankAccountsApi.lookup({ activeOnly: false }).then(setCashAccounts).catch(() => {})
    branchesApi
      .lookup()
      .then((rows) => {
        setBranches(rows)
        const main = rows.find((b) => b.isMainBranch) ?? rows[0]
        if (main) setHeader((current) => (current.branchId === null ? { ...current, branchId: String(main.id) } : current))
      })
      .catch(() => notify.error('Branches could not be loaded.'))

    priceListsApi
      .lookup()
      .then(setPriceLists)
      .catch(() => notify.error('Price lists could not be loaded.'))

    partiesApi
      .lookup({ partyType: 'Client' })
      .then((rows) => {
        setClients(rows)
        if (rows.length !== 1) return
        const only = rows[0]
        setHeader((current) => {
          if (current.clientId !== null) return current
          const next = { ...current, clientId: String(only.id) }
          if (only.defaultPriceListId !== null && !priceListTouched.current) {
            next.priceListId = String(only.defaultPriceListId)
          }
          return next
        })
      })
      .catch(() => notify.error('Clients could not be loaded.'))

    partiesApi
      .lookup({ partyType: 'Salesman' })
      .then((rows) => {
        setSalesmen(rows)
        const mine = user ? rows.find((s) => s.userId === user.id) : undefined
        if (mine) setHeader((current) => (current.salesmanId === null ? { ...current, salesmanId: String(mine.id) } : current))
      })
      .catch(() => {
        /* the Salesman select is then empty; it is optional */
      })
    // The user is fixed for the life of the page; a sign-out unmounts it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Only the fetch lives here; the list is emptied by whatever changed the branch. */
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
      .catch(() => {
        /* the warehouse select is then empty and the page refuses to import, which is correct */
      })

    return () => {
      cancelled = true
    }
  }, [header.branchId])

  /* The rate follows the price list, the type and the date. Its answer carries the key it was
     asked for, so an answer to an earlier question is never mistaken for the current one. */
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
        setHeader((current) => ({ ...current, exchangeRate: answer.isBaseCurrency ? 1 : answer.rate }))
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
  const currencyCode = rate?.currencyCode ?? priceList?.currencyCode ?? 'USD'
  const decimalPlaces = rate?.decimalPlaces ?? priceList?.decimalPlaces ?? 2

  /* ── header changes ───────────────────────────────────────────────────────────────────────── */

  /**
   * Applies a header change — after asking, when it would make the imported lines stale.
   *
   * THE LINES WERE VALIDATED AGAINST THE OLD HEADER: their prices came from that price list, their
   * warehouses were checked against that branch. Keeping them under a new one would post lines the
   * server never judged, so they go — but only once the reader has said so.
   */
  async function changeHeader(patch: Partial<SalesImportHeader>) {
    const next = { ...patch }

    if (next.priceListId !== undefined) priceListTouched.current = true

    // A client with a default price list pre-fills it, unless the reader already chose one.
    if (next.clientId && !priceListTouched.current) {
      const client = clients.find((c) => String(c.id) === next.clientId)
      if (client && client.defaultPriceListId !== null) {
        next.priceListId = String(client.defaultPriceListId)
      }
    }

    const invalidates = HEADER_KEYS_THAT_INVALIDATE_LINES.some(
      (key) => next[key] !== undefined && next[key] !== header[key],
    )

    if (invalidates && lines.length > 0 && result === null) {
      const go = await confirm({
        title: 'Clear the imported lines?',
        message: `The ${lines.length} line(s) were validated against the current branch, warehouse and price list. Changing it clears them — import the file again afterwards.`,
        confirmLabel: 'Clear lines',
        danger: true,
      })
      if (!go) return
      setLines([])
      setLineErrors({})
      draftReference.current = newDraftReference()
    }

    if (next.branchId !== undefined) setWarehouses([])
    if (next.priceListId !== undefined && next.priceListId !== header.priceListId) {
      // The old rate belongs to the old currency; until the lookup answers there is none.
      next.exchangeRate = null
    }

    setErrors({})
    setHeader((current) => ({ ...current, ...next }))
  }

  /* ── stock ────────────────────────────────────────────────────────────────────────────────── */

  /**
   * Reads the stock for a set of item + warehouse pairs, once each unless forced.
   *
   * CACHED PER PAIR, NOT PER LINE: three lines of the same item in the same warehouse are one
   * question, and the answer is what all three are checked against together.
   */
  const loadOnHand = useCallback(async (pairs: { itemId: number; warehouseId: number }[], force = false) => {
    const wanted = new Map<string, { itemId: number; warehouseId: number }>()
    for (const pair of pairs) {
      const key = stockKey(pair.itemId, pair.warehouseId)
      if (force || !(key in onHandRef.current)) wanted.set(key, pair)
    }
    if (wanted.size === 0) return

    await Promise.all(
      [...wanted].map(async ([key, pair]) => {
        try {
          const { onHandBase } = await inventoryLookupsApi.onHand(pair.itemId, pair.warehouseId)
          onHandRef.current[key] = onHandBase
        } catch {
          // The column shows a dash and the check is skipped for that pair; the server still
          // refuses an overdraw on posting.
          onHandRef.current[key] = null
        }
      }),
    )
    setOnHand({ ...onHandRef.current })
  }, [])

  const onHandFor = useCallback(
    (line: SalesLine) => onHand[stockKey(line.itemId, line.warehouseId)],
    [onHand],
  )

  /**
   * The running check: for each item + warehouse, the base units taken so far down the grid,
   * against the shelf. The row that crosses the line is the one marked — the same rule, in the
   * same order, as the server's validation, so the two agree about which row is at fault.
   */
  const stockErrors = useMemo(() => {
    const running: Record<string, number> = {}
    const found: Record<string, string> = {}
    for (const line of lines) {
      // A line still being retyped (quantity 0) takes nothing from the shelf and is refused below instead.
      if (line.quantity < 1) continue
      const key = stockKey(line.itemId, line.warehouseId)
      running[key] = (running[key] ?? 0) + line.quantity * (line.packingFormula || 1)
      const available = onHand[key]
      if (typeof available === 'number' && running[key] > available) {
        found[line.key] = `Insufficient stock: available ${formatNumber(available)}, required ${formatNumber(running[key])}`
      }
    }
    return found
  }, [lines, onHand])

  /** Lines whose quantity box is empty or zero. Not posted, and said so on the row. */
  const quantityErrors = useMemo(() => {
    const found: Record<string, string> = {}
    for (const line of lines) if (line.quantity < 1) found[line.key] = 'Quantity must be at least 1.'
    return found
  }, [lines])

  const stockErrorCount = Object.keys(stockErrors).length
  const quantityErrorCount = Object.keys(quantityErrors).length
  const rowErrors = useMemo(
    () => ({ ...stockErrors, ...quantityErrors, ...lineErrors }),
    [stockErrors, quantityErrors, lineErrors],
  )

  /* ── lines ────────────────────────────────────────────────────────────────────────────────── */

  function appendImported(imported: ImportedLine[]) {
    setLines((current) => mergeImported(current, imported))
    setLineErrors({})
    void loadOnHand(imported.map((l) => ({ itemId: l.itemId, warehouseId: l.warehouseId })))
    notify.success(`${imported.length} line(s) imported.`)
  }

  const patchLine = useCallback((key: string, patch: Partial<SalesLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
    setLineErrors((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }, [])

  const removeLine = useCallback((key: string) => {
    setLines((current) => current.filter((line) => line.key !== key))
  }, [])

  async function clearLines() {
    const go = await confirm({
      title: 'Clear all lines',
      message: `Remove all ${lines.length} imported line(s)? Nothing has been posted.`,
      confirmLabel: 'Clear',
      danger: true,
    })
    if (!go) return
    setLines([])
    setLineErrors({})
    draftReference.current = newDraftReference()
  }

  const totals = useMemo(() => {
    let quantity = 0
    let subtotal = 0
    let discount = 0
    for (const line of lines) {
      quantity += line.quantity * (line.packingFormula || 1)
      const gross = line.quantity * (line.unitPrice ?? 0)
      subtotal += gross
      discount += gross * (line.discountPercent / 100)
    }
    return { items: lines.length, quantity, subtotal, discount, total: subtotal - discount }
  }, [lines])

  /* ── posting ──────────────────────────────────────────────────────────────────────────────── */

  const headerComplete =
    header.branchId !== null
    && header.warehouseId !== null
    && header.priceListId !== null
    && header.clientId !== null
    && header.documentDate !== ''

  const canImport = header.branchId !== null && header.warehouseId !== null && header.priceListId !== null

  const rateMissing = header.priceListId !== null && !(rate?.isBaseCurrency === true) && header.exchangeRate === null

  function changePayment(patch: Partial<SalesPaymentForm>) {
    setPaymentErrors({})
    setPayment((current) => {
      const next = { ...current, ...patch }
      if (patch.paymentType === 2) return { ...next, receiptMethodId: null, receiptAccountId: null, paymentReference: '' }
      return next
    })
  }

  const paymentIncomplete =
    payment.paymentType === null
      ? 'Choose a Payment Type (Cash or On Account).'
      : payment.paymentType === 1 && (!payment.receiptMethodId || !payment.receiptAccountId)
        ? 'A Cash import needs a receipt method and a cash / bank account.'
        : null

  /** Why the Post button is disabled, or null when it is not. The tooltip and the guard share it. */
  const postBlockedBy: string | null = !canCreate
    ? 'Posting also needs the sales.invoices.create permission.'
    : paymentIncomplete !== null
      ? paymentIncomplete
    : lines.length === 0
      ? 'Import some lines first.'
      : quantityErrorCount > 0
        ? `${quantityErrorCount} line(s) need a quantity of at least 1.`
      : !headerComplete
        ? 'Fill in the branch, warehouse, price list, client and date first.'
        : rateLoading
          ? 'Looking up the exchange rate…'
          : rateMissing
            ? 'Enter an exchange rate.'
            : stockErrorCount > 0
              ? `${stockErrorCount} line(s) exceed the stock on hand.`
              : null

  function validateHeader(): boolean {
    const next: SalesImportHeaderErrors = {}
    if (!header.branchId) next.branchId = 'Choose a branch.'
    if (!header.warehouseId) next.warehouseId = 'Choose a warehouse.'
    if (!header.priceListId) next.priceListId = 'Choose a price list.'
    if (!header.clientId) next.clientId = 'Choose a client.'
    if (!header.documentDate) next.documentDate = 'Choose a date.'
    if (rateMissing) next.exchangeRate = 'Enter an exchange rate.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function toRequest(): SaveSalesInvoiceRequest {
    return {
      documentDate: header.documentDate,
      branchId: Number(header.branchId),
      warehouseId: Number(header.warehouseId),
      clientId: Number(header.clientId),
      salesmanId: header.salesmanId === null ? null : Number(header.salesmanId),
      priceListId: Number(header.priceListId),
      rateType: header.rateType,
      exchangeRate: rate?.isBaseCurrency ? null : header.exchangeRate,
      referenceNo: header.referenceNo.trim() || null,
      notes: header.notes.trim() || null,
      draftReference: draftReference.current,
      paymentType: payment.paymentType,
      receiptMethodId: payment.paymentType === 1 && payment.receiptMethodId ? Number(payment.receiptMethodId) : null,
      receiptAccountId: payment.paymentType === 1 && payment.receiptAccountId ? Number(payment.receiptAccountId) : null,
      paymentReference: payment.paymentType === 1 ? payment.paymentReference.trim() || null : null,
      lines: lines.map((line, index) => ({
        lineNo: index + 1,
        itemId: line.itemId,
        itemUnitId: line.itemUnitId,
        // The Excel import has no Specification column; the line is saved without one.
        specification: null,
        warehouseId: line.warehouseId,
        expiryDate: line.expiryDate,
        quantity: line.quantity,
        // Only a real manual price goes up; a list price echoed back would be recorded as an override.
        unitPrice: canOverridePrice && (line.priceEdited || line.priceSource === 'Manual') ? line.unitPrice : null,
        discountPercent: line.discountPercent,
        importRowNumber: line.importRowNumber,
        notes: line.notes.trim() || null,
      })),
    }
  }

  /**
   * Puts a refusal where it belongs: on the line it names, and in a notify because the line may be
   * scrolled away. An INSUFFICIENT_STOCK refusal also refreshes the on-hand of the lines it names —
   * the figure on screen is the one the server just proved wrong.
   */
  function showApiError(error: unknown) {
    if (!(error instanceof ApiError)) {
      notify.error('The lines could not be posted.')
      return
    }

    const next: Record<string, string> = {}
    const lineMatch = /^Line (\d+):/.exec(error.message)

    if ((error.code === 'VALIDATION' || error.code === 'NO_PRICE') && lineMatch) {
      const line = lines[Number(lineMatch[1]) - 1]
      if (line) next[line.key] = error.message
    } else if (error.code === 'INSUFFICIENT_STOCK') {
      const stockMatch = /^Insufficient stock for (\S+) in (\S+):/.exec(error.message)
      const named = stockMatch
        ? lines.filter((l) => l.itemCode === stockMatch[1] && l.warehouseCode === stockMatch[2])
        : []
      for (const line of named) next[line.key] = error.message
      void loadOnHand(named.map((l) => ({ itemId: l.itemId, warehouseId: l.warehouseId })), true)
    }

    setLineErrors(next)
    notify.error(error.message)
  }

  async function postToStock() {
    if (!validateHeader()) {
      notify.error('Some header fields still need filling in.')
      return
    }
    if (postBlockedBy !== null) {
      if (paymentIncomplete !== null) {
        setPaymentErrors(payment.paymentType === null ? { paymentType: paymentIncomplete } : { receiptAccountId: paymentIncomplete })
      }
      notify.error(postBlockedBy)
      return
    }

    const warehouseNames = [...new Set(lines.map((l) => l.warehouseCode))]
      .map((code) => warehouses.find((w) => w.warehouseCode === code)?.warehouseName ?? code)
      .join(', ')

    const go = await confirm({
      title: 'Post to Stock',
      message: `Post ${lines.length} line(s) to stock? A sales invoice will be created and posted, and the stock of ${warehouseNames} will be reduced${payment.paymentType === 1 ? ', and a receipt for the full total created and posted' : ''}. This cannot be undone here.`,
      confirmLabel: 'Post to Stock',
    })
    if (!go) return

    setPosting(true)
    try {
      let posted
      try {
        posted = await salesInvoicesApi.importPost(toRequest())
      } catch (error) {
        /* An out-of-stock sale the policy allows is refused until the user confirms. There is no invoice to
           ask about yet (this call saves and posts in one go), so the warning is built from what the server
           said, with the names this page already knows; Proceed sends the same lines again, confirmed. */
        if (!(error instanceof ApiError) || error.code !== 'OUT_OF_STOCK_CONFIRM') throw error
        const rows: OutOfStockRow[] = parseOutOfStockMessage(error.message).map((row) => ({
          ...row,
          itemName: lines.find((l) => l.itemCode === row.itemCode)?.itemName,
          warehouseName: warehouses.find((w) => w.warehouseCode === row.warehouseCode)?.warehouseName,
        }))
        if (rows.length === 0 || !(await confirmOutOfStock(rows))) return
        posted = await salesInvoicesApi.importPost({ ...toRequest(), acknowledgeOutOfStock: true })
      }
      setResult(posted)
      setLineErrors({})
      notify.success(`Posted ${posted.documentNumber} — ${posted.movementsWritten} line(s) written to the stock movements.`)
      // The shelf moved; the next import must see the new figures.
      void loadOnHand(lines.map((l) => ({ itemId: l.itemId, warehouseId: l.warehouseId })), true)
    } catch (error) {
      showApiError(error)
    } finally {
      setPosting(false)
    }
  }

  function startNewImport() {
    setLines([])
    setLineErrors({})
    setResult(null)
    draftReference.current = newDraftReference()
  }

  async function exportToExcel() {
    if (!result) return
    try {
      await salesInvoicesApi.exportToExcel(result.id, `${result.documentNumber}.xlsx`)
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The invoice could not be exported.')
    }
  }

  /* ── the unsaved-lines guard ──────────────────────────────────────────────────────────────── */

  const unposted = lines.length > 0 && result === null

  /* The browser's own guard, for a tab close or a reload. The message is the browser's — modern
     ones ignore custom text — but the prompt itself is what stops a file's worth of lines from
     vanishing under a stray refresh. In-app navigation is guarded by the sidebar's own confirm. */
  useEffect(() => {
    if (!unposted) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Imported lines are not posted yet.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unposted])

  /* ── render ───────────────────────────────────────────────────────────────────────────────── */

  const actions: DocumentAction[] = [
    {
      key: 'import',
      label: 'Import from Excel',
      icon: <IconFileImport size={16} />,
      visible: result === null,
      disabled: !canImport || posting,
      onClick: () => setWizardOpen(true),
    },
    {
      key: 'clear',
      label: 'Clear all',
      icon: <IconTrash size={16} />,
      colour: 'red',
      visible: result === null,
      disabled: lines.length === 0 || posting,
      onClick: () => void clearLines(),
    },
    {
      key: 'post',
      label: 'Post to Stock',
      icon: <IconTruckDelivery size={16} />,
      variant: 'filled',
      visible: canPost && result === null,
      disabled: postBlockedBy !== null || posting,
      loading: posting,
      onClick: () => void postToStock(),
    },
  ]

  return (
    <Stack>
      <PageHeader
        title="Import Sales from Excel"
        subtitle="Validate a file against the stock on hand, check the lines, and post them to stock as a sales invoice."
      />

      <DocumentActionBar actions={actions} />

      <SalesImportHeaderCard
        value={header}
        onChange={(patch) => void changeHeader(patch)}
        branches={branches}
        warehouses={warehouses}
        priceLists={priceLists}
        clients={clients}
        salesmen={salesmen}
        rate={rate}
        rateLoading={rateLoading}
        errors={errors}
        disabled={posting || result !== null}
      />

      {result === null && (
        <SalesPaymentCard
          value={payment}
          onChange={changePayment}
          methods={paymentMethods}
          accounts={cashAccounts}
          currencyId={rate?.currencyId ?? null}
          currencyCode={rate?.currencyCode ?? priceList?.currencyCode ?? 'USD'}
          branchId={header.branchId === null ? null : Number(header.branchId)}
          readOnly={false}
          disabled={posting}
          errors={paymentErrors}
          paymentStatus={null}
          paidAmount={null}
          outstandingAmount={null}
          totalAmount={null}
          decimalPlaces={2}
          receiptId={null}
          receiptNumber={null}
          receiptStatus={null}
          methodName={null}
          accountLabel={null}
        />
      )}

      {result ? (
        <Paper radius="lg" p="md" withBorder>
          <Stack>
            <Alert color="green" title={`Posted ${result.documentNumber}`} icon={<IconCheck size={18} />}>
              Posted {result.documentNumber} — {formatNumber(result.movementsWritten)} line(s) written to the
              stock movements.
            </Alert>

            <Grid>
              <Grid.Col span={{ base: 12, md: 7 }}>
                <Stack gap="xs">
                  <Text size="sm">
                    The stock of the lines' warehouses has been reduced and the invoice is posted. Item
                    Definition shows the new on-hand figures.
                  </Text>
                  <Group gap="sm">
                    <Button leftSection={<IconRefresh size={16} />} onClick={startNewImport}>
                      Start a new import
                    </Button>
                    <Button
                      variant="default"
                      leftSection={<IconFileExport size={16} />}
                      onClick={() => void exportToExcel()}
                    >
                      Export to Excel
                    </Button>
                  </Group>
                </Stack>
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 5 }}>
                <SalesTotals
                  title={`Totals of ${result.documentNumber}`}
                  totalItems={result.totalItems}
                  totalQuantity={result.totalQuantity}
                  subtotal={result.subtotal}
                  totalDiscount={result.totalDiscount}
                  totalAmount={result.totalAmount}
                  currencyCode={result.currencyCode}
                  decimalPlaces={result.decimalPlaces}
                  baseCurrencyCode={result.baseCurrencyCode}
                  exchangeRate={result.exchangeRate}
                  isBaseCurrency={result.currencyCode === (result.baseCurrencyCode ?? 'USD')}
                />
              </Grid.Col>
            </Grid>
          </Stack>
        </Paper>
      ) : (
        <>
          <Paper radius="lg" p="md" withBorder>
            <Group justify="space-between" align="flex-end" mb="sm" wrap="wrap">
              <div>
                <Title order={5}>Lines</Title>
                {stockErrorCount > 0 && (
                  <Text size="sm" c="red" fw={500}>
                    {formatNumber(stockErrorCount)} line(s) exceed the stock on hand.
                  </Text>
                )}
              </div>

              <Tooltip
                label="Choose a branch, a warehouse and a price list first"
                disabled={canImport}
                withArrow
              >
                {/* The span keeps the tooltip alive over a disabled button, which fires no events. */}
                <span>
                  <Button
                    leftSection={<IconFileImport size={16} />}
                    disabled={!canImport || posting}
                    onClick={() => setWizardOpen(true)}
                  >
                    Import from Excel
                  </Button>
                </span>
              </Tooltip>
            </Group>

            <SalesLinesGrid
              lines={lines}
              onChange={patchLine}
              onRemove={removeLine}
              onHandFor={onHandFor}
              errors={rowErrors}
              currencyCode={currencyCode}
              decimalPlaces={decimalPlaces}
              canOverridePrice={canOverridePrice}
              disabled={posting}
            />
          </Paper>

          <Grid>
            <Grid.Col span={{ base: 12, md: 7 }} />
            <Grid.Col span={{ base: 12, md: 5 }}>
              <SalesTotals
                totalItems={totals.items}
                totalQuantity={totals.quantity}
                subtotal={totals.subtotal}
                totalDiscount={totals.discount}
                totalAmount={totals.total}
                currencyCode={currencyCode}
                decimalPlaces={decimalPlaces}
                baseCurrencyCode={rate?.baseCurrencyCode}
                exchangeRate={header.exchangeRate}
                isBaseCurrency={rate?.isBaseCurrency ?? true}
              />
            </Grid.Col>
          </Grid>
        </>
      )}

      {canImport && (
        <ImportInvoiceItemsWizard
          opened={wizardOpen}
          onClose={() => setWizardOpen(false)}
          header={{
            branchId: Number(header.branchId),
            warehouseId: Number(header.warehouseId),
            priceListId: Number(header.priceListId),
            currencyCode,
            decimalPlaces,
          }}
          documentTypeCode="SINV"
          mode="invoice"
          checkStock
          draftReference={draftReference.current}
          onImported={appendImported}
        />
      )}
    </Stack>
  )
}

