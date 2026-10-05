import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Alert, Anchor, Button, Group, Loader, Stack } from '@mantine/core'
import { IconPrinter } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { attachmentTypesApi, type AttachmentTypeLookupDto } from '../../api/masterdata/attachmentTypes'
import { branchesApi } from '../../api/masterdata/branches'
import { cashBankAccountsApi, type CashBankAccountLookupDto } from '../../api/masterdata/cashBankAccounts'
import { currenciesApi } from '../../api/masterdata/currencies'
import { partiesApi } from '../../api/masterdata/parties'
import { paymentMethodsApi, type PaymentMethodLookupDto } from '../../api/masterdata/paymentMethods'
import {
  receiptsApi,
  type OpenInvoiceDto,
  type ReceiptAllocationDto,
  type ReceiptDto,
  type SaveReceiptRequest,
} from '../../api/sales/receipts'
import type { BranchLookupDto, CurrencyLookupDto, PartyLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { AuditTrail } from '../../components/documents/AuditTrail'
import { CancelReasonModal } from '../../components/documents/CancelReasonModal'
import { DocumentActionBar, type DocumentAction } from '../../components/documents/DocumentActionBar'
import { DocumentIcons } from '../../components/documents/documentIcons'
import { dateLabel, isoDate, stamp } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import { ReceiptAllocationsCard } from '../../components/sales/receipt/ReceiptAllocationsCard'
import { ReceiptAppliedCard } from '../../components/sales/receipt/ReceiptAppliedCard'
import { ReceiptAttachmentsCard } from '../../components/sales/receipt/ReceiptAttachmentsCard'
import { ReceiptHeaderCard, type ReceiptHeaderErrors } from '../../components/sales/receipt/ReceiptHeaderCard'
import { ReceiptLinesCard } from '../../components/sales/receipt/ReceiptLinesCard'
import {
  isBalanced,
  round,
  toBase,
  type ReceiptHeaderForm,
  type ReceiptLineForm,
} from '../../components/sales/receipt/receiptModel'
import { confirm } from '../../components/ui/confirm'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { PERMISSIONS } from '../../navigation'

const ROUTE = '/sales/receipts'

let keySeed = 0
const nextKey = () => `rl-${++keySeed}`

const EMPTY_HEADER: ReceiptHeaderForm = {
  receiptDate: isoDate(new Date()),
  clientId: null,
  branchId: null,
  paymentType: 1,
  currencyId: null,
  amount: null,
  exchangeRate: null,
  notes: '',
}

/**
 * One customer receipt: typed as a draft, posted, and afterwards read — or reversed.
 *
 * THREE MODES, DECIDED BY THE STATUS. A new or Draft receipt is editable; a Posted one is a record
 * (with two things still allowed on it: attachments, and applying leftover credit to invoices); a
 * Reversed one is a record and nothing else.
 *
 * THE SERVER OWNS THE RULES. The banners say "short by 40.00" while somebody types, and the Post
 * button stays pressable on an unbalanced receipt on purpose: the answer to pressing it is the
 * server's UNBALANCED message, so the wording a cashier reads is the wording the audit would show.
 */
export function ReceiptPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { hasPermission } = useAuth()

  const receiptId = id && id !== 'new' ? Number(id) : null
  const isNew = receiptId === null

  const canCreate = hasPermission(PERMISSIONS.receiptsCreate)
  const canPost = hasPermission(PERMISSIONS.receiptsPost)
  const canReverse = hasPermission(PERMISSIONS.receiptsReverse)
  const canAllocate = hasPermission(PERMISSIONS.receiptsAllocate)

  const [loading, setLoading] = useState(!isNew)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [receipt, setReceipt] = useState<ReceiptDto | null>(null)

  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [clients, setClients] = useState<PartyLookupDto[]>([])
  const [currencies, setCurrencies] = useState<CurrencyLookupDto[]>([])
  const [methods, setMethods] = useState<PaymentMethodLookupDto[]>([])
  const [accounts, setAccounts] = useState<CashBankAccountLookupDto[]>([])
  const [attachmentTypes, setAttachmentTypes] = useState<AttachmentTypeLookupDto[]>([])

  const [header, setHeader] = useState<ReceiptHeaderForm>(EMPTY_HEADER)
  const [errors, setErrors] = useState<ReceiptHeaderErrors>({})
  const [lines, setLines] = useState<ReceiptLineForm[]>([])
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  /** Invoice id → amount typed, in the INVOICE's currency. */
  const [allocAmounts, setAllocAmounts] = useState<Record<number, number | null>>({})
  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceDto[]>([])
  const [invoicesLoading, setInvoicesLoading] = useState(false)

  const [rateLoading, setRateLoading] = useState(false)
  const [rateDate, setRateDate] = useState<string | null>(null)
  const rateSeq = useRef(0)
  /** True once the reader typed the header rate (or it was loaded from a saved receipt): a date change then leaves it alone. */
  const headerRateEdited = useRef(false)
  const dirty = useRef(false)
  const attachmentsRef = useRef<HTMLDivElement>(null)

  const [reverseOpen, setReverseOpen] = useState(false)
  const [reverseBusy, setReverseBusy] = useState(false)

  const status = receipt?.status ?? null
  const editable = isNew || status === 'Draft'
  const baseCurrency = currencies.find((c) => c.isBaseCurrency)
  const baseCurrencyCode = receipt?.baseCurrencyCode ?? baseCurrency?.currencyCode ?? 'USD'
  const headerCurrency = currencies.find((c) => String(c.id) === header.currencyId)
  const headerIsBase = headerCurrency?.isBaseCurrency === true
  const clientId = header.clientId === null ? null : Number(header.clientId)

  /** A posted Free Receipt with credit left can still be applied to invoices. */
  const canApplyLater = status === 'Posted' && receipt?.paymentType === 1 && (receipt?.unappliedBase ?? 0) > 0.005 && canAllocate
  const showAllocationEditor = (editable && header.paymentType === 2) || canApplyLater
  const needInvoices = showAllocationEditor && clientId !== null

  const markDirty = () => {
    dirty.current = true
  }

  /* ── loading ──────────────────────────────────────────────────────────────────────────────── */

  const applyReceipt = useCallback((doc: ReceiptDto) => {
    setReceipt(doc)
    headerRateEdited.current = true
    setRateDate(null)
    setHeader({
      receiptDate: doc.receiptDate.slice(0, 10),
      clientId: String(doc.clientId),
      branchId: String(doc.branchId),
      paymentType: doc.paymentType,
      currencyId: String(doc.currencyId),
      amount: doc.amount,
      exchangeRate: doc.exchangeRate,
      notes: doc.notes ?? '',
    })
    setLines(
      doc.lines.map((line) => ({
        key: nextKey(),
        paymentMethodId: String(line.paymentMethodId),
        currencyId: String(line.currencyId),
        amount: line.amount,
        exchangeRate: line.exchangeRate,
        rateEdited: true,
        cashBankAccountId: String(line.cashBankAccountId),
        reference: line.reference ?? '',
      })),
    )
    // Only a draft's allocations are being edited; on a posted receipt they are history, shown in their own card.
    const amounts: Record<number, number | null> = {}
    if (doc.status === 'Draft') for (const a of doc.allocations) if (a.isLive) amounts[a.salesDocumentId] = a.amountInvoiceCurrency
    setAllocAmounts(amounts)
    dirty.current = false
  }, [])

  const reload = useCallback(async () => {
    if (receiptId === null) return
    try {
      applyReceipt(await receiptsApi.get(receiptId))
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The receipt could not be refreshed.')
    }
  }, [receiptId, applyReceipt])

  useEffect(() => {
    if (receiptId === null) return
    let cancelled = false
    receiptsApi
      .get(receiptId)
      .then((doc) => {
        if (!cancelled) applyReceipt(doc)
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof ApiError && error.status === 404 ? 'This receipt does not exist.' : 'The receipt could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [receiptId, applyReceipt])

  useEffect(() => {
    branchesApi
      .lookup(false)
      .then((rows) => {
        setBranches(rows)
        if (!isNew) return
        const main = rows.find((b) => b.isActive && b.isMainBranch) ?? rows.find((b) => b.isActive)
        if (main) setHeader((current) => (current.branchId === null ? { ...current, branchId: String(main.id) } : current))
      })
      .catch(() => notify.error('Branches could not be loaded.'))
    partiesApi.lookup({ partyType: 'Client', activeOnly: false }).then(setClients).catch(() => notify.error('Customers could not be loaded.'))
    currenciesApi
      .lookup(false)
      .then((rows) => {
        setCurrencies(rows)
        if (!isNew) return
        const base = rows.find((c) => c.isBaseCurrency)
        if (base) setHeader((current) => (current.currencyId === null ? { ...current, currencyId: String(base.id), exchangeRate: 1 } : current))
      })
      .catch(() => notify.error('Currencies could not be loaded.'))
    paymentMethodsApi.lookup(false).then(setMethods).catch(() => notify.error('Payment methods could not be loaded.'))
    cashBankAccountsApi.lookup({ activeOnly: false }).then(setAccounts).catch(() => notify.error('Cash and bank accounts could not be loaded.'))
    attachmentTypesApi.lookup(true, undefined, 'Receipt').then(setAttachmentTypes).catch(() => {})
    // isNew comes from the route; it does not change without a remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The customer's unpaid invoices, whenever there is somewhere to allocate them.
  useEffect(() => {
    if (!needInvoices || clientId === null) {
      setOpenInvoices([])
      return
    }
    const controller = new AbortController()
    setInvoicesLoading(true)
    receiptsApi
      .openInvoices(clientId, controller.signal)
      .then(setOpenInvoices)
      .catch((error) => {
        if (!controller.signal.aborted) notify.error(error instanceof ApiError ? error.message : 'The customer’s invoices could not be loaded.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setInvoicesLoading(false)
      })
    return () => controller.abort()
  }, [needInvoices, clientId, receipt?.rowVersion])

  /* ── rates ────────────────────────────────────────────────────────────────────────────────── */

  async function lookupRate(currencyId: string, date: string): Promise<{ rate: number | null; note: string | null } | null> {
    try {
      const r = await receiptsApi.rate(Number(currencyId), date)
      const asOf = r.rateDate ? r.rateDate.slice(0, 10) : null
      return { rate: r.rate, note: asOf && asOf !== date ? dateLabel(asOf) : null }
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The exchange rate could not be looked up.')
      return null
    }
  }

  async function refreshHeaderRate(currencyId: string | null, date: string) {
    if (!currencyId) return
    const currency = currencies.find((c) => String(c.id) === currencyId)
    if (currency?.isBaseCurrency) {
      setHeader((current) => ({ ...current, exchangeRate: 1 }))
      setRateDate(null)
      return
    }
    const seq = ++rateSeq.current
    setRateLoading(true)
    const found = await lookupRate(currencyId, date)
    if (seq !== rateSeq.current) return
    setRateLoading(false)
    if (!found) return
    setHeader((current) => (current.currencyId === currencyId && !headerRateEdited.current ? { ...current, exchangeRate: found.rate } : current))
    setRateDate(found.note)
    if (found.rate === null) notify.info(`No exchange rate is defined for ${currency?.currencyCode ?? 'this currency'} on ${dateLabel(date)}. Enter one.`)
  }

  async function refreshLineRate(key: string, currencyId: string, date: string) {
    const currency = currencies.find((c) => String(c.id) === currencyId)
    if (currency?.isBaseCurrency) {
      setLines((current) => current.map((l) => (l.key === key ? { ...l, exchangeRate: 1 } : l)))
      return
    }
    const found = await lookupRate(currencyId, date)
    if (!found) return
    setLines((current) => current.map((l) => (l.key === key && l.currencyId === currencyId && !l.rateEdited ? { ...l, exchangeRate: found.rate } : l)))
    if (found.rate === null) notify.info(`No exchange rate is defined for ${currency?.currencyCode ?? 'this currency'} on ${dateLabel(date)}. Enter one.`)
  }

  function changeHeader(patch: Partial<ReceiptHeaderForm>) {
    markDirty()
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch) as (keyof ReceiptHeaderForm)[]) delete next[key]
      return next
    })
    const next = { ...header, ...patch }
    setHeader(next)

    if ('currencyId' in patch) {
      headerRateEdited.current = false
      void refreshHeaderRate(next.currencyId, next.receiptDate)
    } else if ('receiptDate' in patch) {
      void refreshHeaderRate(next.currencyId, next.receiptDate)
      // A line's rate follows the date unless the reader typed it.
      for (const line of lines) if (line.currencyId && !line.rateEdited) void refreshLineRate(line.key, line.currencyId, next.receiptDate)
    }
    if ('clientId' in patch) setAllocAmounts({})
  }

  /* ── totals ───────────────────────────────────────────────────────────────────────────────── */

  const headerRate = headerIsBase ? 1 : header.exchangeRate
  const headerBase = toBase(header.amount, headerRate)

  const linesBase = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const currency = currencies.find((c) => String(c.id) === line.currencyId)
        return sum + toBase(line.amount, currency?.isBaseCurrency ? 1 : line.exchangeRate)
      }, 0),
    [lines, currencies],
  )

  /* ── payment lines ────────────────────────────────────────────────────────────────────────── */

  function addLine() {
    markDirty()
    const remainingBase = Math.max(0, headerBase - linesBase)
    const currency = headerCurrency
    const rate = headerIsBase ? 1 : header.exchangeRate
    setLines((current) => [
      ...current,
      {
        key: nextKey(),
        paymentMethodId: null,
        currencyId: header.currencyId,
        // The rest of what the header says came in, in the header's currency: usually exactly the amount to type.
        amount: remainingBase > 0 && rate ? round(remainingBase * rate, currency?.decimalPlaces ?? 2) : null,
        exchangeRate: rate,
        rateEdited: false,
        cashBankAccountId: null,
        reference: '',
      },
    ])
  }

  function patchLine(key: string, patch: Partial<ReceiptLineForm>) {
    markDirty()
    setRowErrors({})
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function chooseLineCurrency(key: string, currencyId: string | null) {
    markDirty()
    setRowErrors({})
    const currency = currencies.find((c) => String(c.id) === currencyId)
    setLines((current) =>
      current.map((l) => {
        if (l.key !== key) return l
        const account = accounts.find((a) => String(a.id) === l.cashBankAccountId)
        // An account holds one currency: one that no longer fits is cleared, not left on the wrong row.
        const keep = account !== undefined && String(account.currencyId) === currencyId
        const sameAsHeader = currencyId !== null && currencyId === header.currencyId && header.exchangeRate !== null
        return {
          ...l,
          currencyId,
          cashBankAccountId: keep ? l.cashBankAccountId : null,
          exchangeRate: currency?.isBaseCurrency ? 1 : sameAsHeader ? header.exchangeRate : null,
          rateEdited: false,
        }
      }),
    )
    const sameAsHeader = currencyId !== null && currencyId === header.currencyId && header.exchangeRate !== null
    if (currencyId && !currency?.isBaseCurrency && !sameAsHeader) void refreshLineRate(key, currencyId, header.receiptDate)
  }

  function removeLine(key: string) {
    markDirty()
    setRowErrors({})
    setLines((current) => current.filter((l) => l.key !== key))
  }

  /* ── saving ───────────────────────────────────────────────────────────────────────────────── */

  function validate(): { ok: boolean; completeLines: ReceiptLineForm[] } {
    const next: ReceiptHeaderErrors = {}
    if (!header.receiptDate) next.receiptDate = 'Choose a date.'
    if (!header.clientId) next.clientId = 'Choose a customer.'
    if (!header.branchId) next.branchId = 'Choose a branch.'
    if (!header.currencyId) next.currencyId = 'Choose a currency.'
    if (header.amount === null || header.amount <= 0) next.amount = 'Enter the amount received.'
    if (header.currencyId && !headerIsBase && (header.exchangeRate === null || header.exchangeRate <= 0)) next.exchangeRate = 'Enter an exchange rate.'
    setErrors(next)

    // A row nobody touched is not an error; it is dropped.
    const meaningful = lines.filter((l) => l.paymentMethodId || l.currencyId || l.amount !== null || l.cashBankAccountId || l.reference.trim())
    const problems: Record<string, string> = {}
    meaningful.forEach((line, index) => {
      const currency = currencies.find((c) => String(c.id) === line.currencyId)
      const missing: string[] = []
      if (!line.paymentMethodId) missing.push('a method')
      if (!line.currencyId) missing.push('a currency')
      if (line.amount === null || line.amount <= 0) missing.push('an amount')
      if (line.currencyId && !currency?.isBaseCurrency && (line.exchangeRate === null || line.exchangeRate <= 0)) missing.push('a rate')
      if (!line.cashBankAccountId) missing.push('a cash or bank account')
      if (missing.length > 0) problems[line.key] = `Payment line ${index + 1} needs ${missing.join(', ')}.`
    })
    setRowErrors(problems)

    if (Object.keys(next).length > 0) {
      notify.error('Some header fields still need filling in.')
      return { ok: false, completeLines: meaningful }
    }
    if (Object.keys(problems).length > 0) {
      notify.error('Some payment lines are incomplete.')
      return { ok: false, completeLines: meaningful }
    }
    return { ok: true, completeLines: meaningful }
  }

  function toRequest(completeLines: ReceiptLineForm[]): SaveReceiptRequest {
    return {
      receiptDate: header.receiptDate,
      clientId: Number(header.clientId),
      branchId: Number(header.branchId),
      paymentType: header.paymentType,
      currencyId: Number(header.currencyId),
      amount: header.amount!,
      exchangeRate: headerIsBase ? null : header.exchangeRate,
      notes: header.notes.trim() || null,
      lines: completeLines.map((line) => {
        const currency = currencies.find((c) => String(c.id) === line.currencyId)
        return {
          paymentMethodId: Number(line.paymentMethodId),
          currencyId: Number(line.currencyId),
          amount: line.amount!,
          exchangeRate: currency?.isBaseCurrency ? null : line.exchangeRate,
          cashBankAccountId: Number(line.cashBankAccountId),
          reference: line.reference.trim() || null,
        }
      }),
      // A Free Receipt names no invoices; the server refuses any it is sent.
      allocations:
        header.paymentType === 2
          ? Object.entries(allocAmounts)
              .filter(([, amount]) => amount !== null && amount > 0)
              .map(([invoiceId, amount]) => ({ salesDocumentId: Number(invoiceId), amount: amount! }))
          : [],
      rowVersion: receipt?.rowVersion ?? null,
    }
  }

  function showApiError(error: unknown, fallback: string) {
    notify.error(error instanceof ApiError ? error.message : fallback)
    if (error instanceof ApiError && error.code === 'CONCURRENCY') void reload()
  }

  async function saveDraft(): Promise<ReceiptDto | null> {
    const { ok, completeLines } = validate()
    if (!ok) return null
    setSaving(true)
    try {
      const request = toRequest(completeLines)
      const saved = receiptId === null ? await receiptsApi.create(request) : await receiptsApi.update(receiptId, request)
      applyReceipt(saved)
      notify.success(receiptId === null ? `Draft ${saved.receiptNumber ?? ''} created.` : 'Draft saved.')
      if (receiptId === null) void navigate(`${ROUTE}/${saved.id}`, { replace: true })
      return saved
    } catch (error) {
      showApiError(error, 'The receipt could not be saved.')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function saveAndPost() {
    const saved = await saveDraft()
    if (!saved) return

    /* THE SAVED RECEIPT'S OWN TOTALS, checked before the question rather than after it: asking
       "Post this receipt?" and then answering "it cannot be posted" is worse than saying so up front.
       The server still decides — this only spares the cashier a confirmation that cannot succeed. */
    const base = saved.baseCurrencyCode ?? baseCurrencyCode
    if (!isBalanced(saved.amountBase, saved.linesBase)) {
      notify.error(`Not posted: the payment lines come to ${formatNumber(saved.linesBase, 2)} ${base} but the receipt is ${formatNumber(saved.amountBase, 2)} ${base}. The draft is saved.`)
      return
    }
    if (saved.paymentType === 2 && !isBalanced(saved.amountBase, saved.allocatedBase)) {
      notify.error(`Not posted: ${formatNumber(saved.allocatedBase, 2)} ${base} is allocated to invoices but the receipt is ${formatNumber(saved.amountBase, 2)} ${base}. The draft is saved.`)
      return
    }
    const go = await confirm({
      title: 'Post this receipt?',
      message: `Post ${saved.receiptNumber ?? 'this receipt'} for ${formatNumber(saved.amount, saved.decimalPlaces)} ${saved.currencyCode}? Once posted it can no longer be edited or deleted, only reversed.`,
      confirmLabel: 'Post Receipt',
    })
    if (!go) return
    setSaving(true)
    try {
      applyReceipt(await receiptsApi.post(saved.id, saved.rowVersion))
      notify.success('Receipt posted.')
    } catch (error) {
      showApiError(error, 'The receipt could not be posted.')
    } finally {
      setSaving(false)
    }
  }

  async function reverse(reason: string) {
    if (!receipt) return
    setReverseBusy(true)
    try {
      applyReceipt(await receiptsApi.reverse(receipt.id, reason, receipt.rowVersion))
      notify.success('Receipt reversed.')
      setReverseOpen(false)
    } catch (error) {
      showApiError(error, 'The receipt could not be reversed.')
    } finally {
      setReverseBusy(false)
    }
  }

  async function applyCredit() {
    if (!receipt) return
    const entries = Object.entries(allocAmounts)
      .filter(([, amount]) => amount !== null && amount > 0)
      .map(([invoiceId, amount]) => ({ salesDocumentId: Number(invoiceId), amount: amount! }))
    if (entries.length === 0) {
      notify.error('Enter an amount against at least one invoice.')
      return
    }
    setSaving(true)
    try {
      applyReceipt(await receiptsApi.allocate(receipt.id, entries, receipt.rowVersion))
      notify.success('Credit applied to the invoices.')
    } catch (error) {
      showApiError(error, 'The credit could not be applied.')
    } finally {
      setSaving(false)
    }
  }

  async function takeBack(allocation: ReceiptAllocationDto) {
    if (!receipt) return
    const go = await confirm({
      title: 'Take allocation back',
      message: `Remove the allocation to ${allocation.invoiceNumber}? The invoice becomes outstanding again and the credit returns to this receipt.`,
      confirmLabel: 'Take back',
      danger: true,
    })
    if (!go) return
    try {
      applyReceipt(await receiptsApi.deallocate(receipt.id, allocation.id))
      notify.success('Allocation removed.')
    } catch (error) {
      showApiError(error, 'The allocation could not be removed.')
    }
  }

  async function leave() {
    if (dirty.current) {
      const go = await confirm({ title: 'Leave without saving?', message: 'This receipt has changes that have not been saved. Leaving now discards them.', confirmLabel: 'Discard', danger: true })
      if (!go) return
    }
    void navigate(ROUTE)
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
        <PageHeader title="Receipt" />
        <Alert color="red">{loadError}</Alert>
        <Group>
          <Button variant="default" onClick={() => void navigate(ROUTE)}>Back to Receipts</Button>
        </Group>
      </Stack>
    )
  }

  const scrollToAttachments = () => attachmentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  /* THE PRINT VIEW SHOWS THE SAVED RECEIPT, so unsaved edits are said before they go missing on paper. */
  const print: DocumentAction = {
    key: 'print',
    label: 'Print',
    icon: <IconPrinter size={16} />,
    disabled: isNew,
    disabledReason: 'Save the draft first',
    onClick: () => {
      if (receipt === null) return
      if (dirty.current) {
        notify.info('Save the draft first: the print view shows the saved receipt.')
        return
      }
      void navigate(`${ROUTE}/${receipt.id}/print`)
    },
  }
  const addAttachment: DocumentAction = {
    key: 'attachment',
    label: 'Add Attachment',
    icon: DocumentIcons.attachments,
    visible: canCreate,
    disabled: isNew,
    disabledReason: 'Save the draft first',
    onClick: scrollToAttachments,
  }

  const actions: DocumentAction[] = editable
    ? [
        print,
        addAttachment,
        { key: 'cancel', label: 'Cancel', icon: DocumentIcons.cancel, onClick: () => void leave() },
        { key: 'save', label: 'Save Draft', icon: DocumentIcons.save, visible: canCreate, loading: saving, onClick: () => void saveDraft() },
        { key: 'post', label: 'Post Receipt', icon: DocumentIcons.post, variant: 'filled', visible: canCreate && canPost, loading: saving, onClick: () => void saveAndPost() },
      ]
    : [
        print,
        addAttachment,
        {
          key: 'reverse',
          label: 'Reverse Receipt',
          icon: DocumentIcons.cancel,
          colour: 'red',
          visible: canReverse && status === 'Posted',
          // A Cash invoice's receipt is part of the invoice: it is undone by cancelling the invoice.
          disabled: receipt?.sourceSalesDocumentId != null,
          disabledReason: receipt?.sourceInvoiceNumber ? `Created by invoice ${receipt.sourceInvoiceNumber}: cancel that invoice to reverse it` : undefined,
          onClick: () => setReverseOpen(true),
        },
        { key: 'back', label: 'Back', icon: DocumentIcons.back, onClick: () => void navigate(ROUTE) },
      ]

  const title = isNew ? 'New Receipt' : `Receipt ${receipt?.receiptNumber ?? `draft #${receipt?.id}`}`
  const headerBalanced = isBalanced(headerBase, linesBase)

  return (
    <Stack>
      <PageHeader title={title} />

      <DocumentActionBar actions={actions} />

      {receipt && status === 'Posted' && (
        <Alert color="green" title={`Posted — ${receipt.receiptNumber}`}>
          Posted by {receipt.postedByName ?? 'unknown'} on {stamp(receipt.postedAtUtc)}. It can no longer be edited or deleted{receipt.sourceSalesDocumentId === null ? '; it can be reversed' : ''}.
          {receipt.paymentType === 1 && receipt.unappliedBase > 0.005
            ? ` ${formatNumber(receipt.unappliedBase, 2)} ${baseCurrencyCode} of this receipt is not yet applied to any invoice.`
            : ''}
        </Alert>
      )}
      {receipt && receipt.sourceSalesDocumentId !== null && (
        <Alert color="teal" variant="light" title="Created automatically by a Cash invoice">
          This receipt was made when invoice{' '}
          <Anchor component={Link} to={`/sales/invoices/${receipt.sourceSalesDocumentId}`} fw={600}>{receipt.sourceInvoiceNumber}</Anchor>{' '}
          was posted. It cannot be edited or reversed on its own; cancelling that invoice reverses it.
        </Alert>
      )}
      {receipt && status === 'Reversed' && (
        <Alert color="orange" title={`Reversed — ${receipt.receiptNumber}`}>
          Reversed by {receipt.reversedByName ?? 'unknown'} on {stamp(receipt.reversedAtUtc)}.{receipt.reverseReason ? ` Reason: ${receipt.reverseReason}` : ''}
        </Alert>
      )}
      {editable && !isNew && !headerBalanced && header.amount !== null && (
        <Alert color="yellow" variant="light">
          This draft is not balanced yet, so it cannot be posted. See the banners under the payment lines and allocations.
        </Alert>
      )}

      <ReceiptHeaderCard
        value={header}
        onChange={changeHeader}
        onRateEdited={() => {
          headerRateEdited.current = true
        }}
        branches={branches}
        clients={clients}
        currencies={currencies}
        receiptNumber={receipt?.receiptNumber ?? null}
        status={status}
        baseCurrencyCode={baseCurrencyCode}
        rateLoading={rateLoading}
        rateDate={rateDate}
        isBaseCurrency={headerIsBase}
        readOnly={!editable}
        disabled={saving}
        errors={errors}
      />

      <ReceiptLinesCard
        lines={lines}
        onChange={patchLine}
        onCurrencyChosen={chooseLineCurrency}
        onAdd={addLine}
        onRemove={removeLine}
        methods={methods}
        accounts={accounts}
        currencies={currencies}
        branchId={header.branchId === null ? null : Number(header.branchId)}
        baseCurrencyCode={baseCurrencyCode}
        headerBase={headerBase}
        linesBase={linesBase}
        readOnly={!editable}
        rowErrors={rowErrors}
      />

      {editable && header.paymentType === 2 && (
        <ReceiptAllocationsCard
          title="Invoice Allocation"
          intro="Choose the invoices this receipt pays. Amounts are in each invoice’s own currency, and together they must equal the receipt amount."
          invoices={openInvoices}
          loading={invoicesLoading}
          hasClient={clientId !== null}
          amounts={allocAmounts}
          onChange={(invoiceId, amount) => {
            markDirty()
            setAllocAmounts((current) => ({ ...current, [invoiceId]: amount }))
          }}
          onFill={(amounts) => {
            markDirty()
            setAllocAmounts(amounts)
          }}
          targetBase={headerBase}
          baseCurrencyCode={baseCurrencyCode}
          readOnly={false}
        />
      )}

      {canApplyLater && receipt && (
        <ReceiptAllocationsCard
          title="Apply credit to invoices"
          intro={`${formatNumber(receipt.unappliedBase, 2)} ${baseCurrencyCode} of this receipt has not been applied. Apply all or part of it to this customer’s unpaid invoices.`}
          invoices={openInvoices}
          loading={invoicesLoading}
          hasClient
          amounts={allocAmounts}
          onChange={(invoiceId, amount) => setAllocAmounts((current) => ({ ...current, [invoiceId]: amount }))}
          onFill={setAllocAmounts}
          targetBase={receipt.unappliedBase}
          baseCurrencyCode={baseCurrencyCode}
          readOnly={false}
          partialOk
          action={
            <Button loading={saving} onClick={() => void applyCredit()}>
              Apply allocation
            </Button>
          }
        />
      )}

      {receipt && (
        <ReceiptAppliedCard
          allocations={receipt.allocations}
          baseCurrencyCode={baseCurrencyCode}
          canRemove={status === 'Posted' && receipt.paymentType === 1 && canAllocate}
          onRemove={(allocation) => void takeBack(allocation)}
        />
      )}

      <div ref={attachmentsRef}>
        <ReceiptAttachmentsCard
          receiptId={receipt?.id ?? null}
          files={receipt?.files ?? []}
          types={attachmentTypes}
          canAdd={canCreate && status !== 'Reversed'}
          canRemove={canCreate && status !== 'Reversed'}
          canEdit={canCreate && status !== 'Reversed'}
          onChanged={() => void reload()}
        />
      </div>

      <AuditTrail entries={receipt?.audit ?? []} />

      <CancelReasonModal
        opened={reverseOpen}
        onClose={() => setReverseOpen(false)}
        documentLabel={receipt?.receiptNumber ?? `draft #${receipt?.id}`}
        busy={reverseBusy}
        title={`Reverse ${receipt?.receiptNumber ?? `draft #${receipt?.id}`}`}
        placeholder="Why is this being reversed?"
        confirmLabel="Reverse receipt"
        description="Reversing undoes the payment: any invoice it paid becomes outstanding again. The receipt stays in place as a record. It cannot be undone."
        onConfirm={(reason) => void reverse(reason)}
      />
    </Stack>
  )
}
