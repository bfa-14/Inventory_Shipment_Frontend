import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Alert, Button, Group, Loader, SegmentedControl, Stack, Text } from '@mantine/core'
import { IconPrinter } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { attachmentTypesApi, type AttachmentTypeLookupDto } from '../../api/masterdata/attachmentTypes'
import { branchesApi } from '../../api/masterdata/branches'
import { cashBankAccountsApi, type CashBankAccountLookupDto } from '../../api/masterdata/cashBankAccounts'
import { currenciesApi } from '../../api/masterdata/currencies'
import { partiesApi } from '../../api/masterdata/parties'
import { paymentMethodsApi, type PaymentMethodLookupDto } from '../../api/masterdata/paymentMethods'
import {
  kindOfType,
  paymentsApi,
  type OpenPayableDocumentDto,
  type PayableKind,
  type PaymentAllocationDto,
  type PaymentDto,
  type PaymentLineDto,
  type SavePaymentAllocation,
  type SavePaymentRequest,
} from '../../api/purchase/payments'
import type { BranchLookupDto, CurrencyLookupDto, PartyLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { AuditTrail } from '../../components/documents/AuditTrail'
import { CancelReasonModal } from '../../components/documents/CancelReasonModal'
import { DocumentActionBar, type DocumentAction } from '../../components/documents/DocumentActionBar'
import { DocumentIcons } from '../../components/documents/documentIcons'
import { dateLabel, isoDate, stamp } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import { PaymentAllocationsCard } from '../../components/purchase/payment/PaymentAllocationsCard'
import { PaymentAppliedCard } from '../../components/purchase/payment/PaymentAppliedCard'
import { PaymentAttachmentsCard } from '../../components/purchase/payment/PaymentAttachmentsCard'
import { PaymentHeaderCard, type PaymentHeaderErrors } from '../../components/purchase/payment/PaymentHeaderCard'
import { PaymentLinesCard } from '../../components/purchase/payment/PaymentLinesCard'
import {
  docKey,
  isBalanced,
  PAYMENTS_ROUTE,
  round,
  toPayment,
  type AllocationEntry,
  type PaymentHeaderForm,
  type PaymentLineForm,
} from '../../components/purchase/payment/paymentModel'
import { confirm } from '../../components/ui/confirm'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { PERMISSIONS } from '../../navigation'

let keySeed = 0
const nextKey = () => `pl-${++keySeed}`

const EMPTY_HEADER: PaymentHeaderForm = {
  paymentDate: isoDate(new Date()),
  payeeId: null,
  branchId: null,
  paymentType: 1,
  currencyId: null,
  amount: null,
  exchangeRate: null,
  reference: '',
  notes: '',
}

/**
 * One supplier payment (US-PAY-001): typed as a draft, posted, and afterwards read - or reversed.
 *
 * THREE MODES, DECIDED BY THE STATUS. A new or Draft payment is editable; a Posted one is a record (still
 * allowing attachments, the cheque clearance status and - for a Free Payment - allocating its advance);
 * a Reversed one is a record and nothing else.
 *
 * THE PAYMENT TYPE DECIDES THE ALLOCATION SECTION: hidden for a Free Payment, purchase invoices for a
 * Purchase Invoice Payment, container charges for a Container Charge Payment. Changing the type or the
 * payee asks before clearing allocations that no longer fit.
 *
 * POST PAYMENT STAYS DISABLED until the payment details - and the allocation, when there is one - equal
 * the Payment Amount in the payment currency; the server checks the same, so its message is the last word.
 */
export function PaymentPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { hasPermission } = useAuth()

  const paymentId = id && id !== 'new' ? Number(id) : null
  const isNew = paymentId === null

  const canCreate = hasPermission(PERMISSIONS.paymentsCreate)
  const canPost = hasPermission(PERMISSIONS.paymentsPost)
  const canReverse = hasPermission(PERMISSIONS.paymentsReverse)
  const canAllocate = hasPermission(PERMISSIONS.paymentsAllocate)

  const [loading, setLoading] = useState(!isNew)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [payment, setPayment] = useState<PaymentDto | null>(null)

  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [payees, setPayees] = useState<PartyLookupDto[]>([])
  const [currencies, setCurrencies] = useState<CurrencyLookupDto[]>([])
  const [methods, setMethods] = useState<PaymentMethodLookupDto[]>([])
  const [accounts, setAccounts] = useState<CashBankAccountLookupDto[]>([])
  const [attachmentTypes, setAttachmentTypes] = useState<AttachmentTypeLookupDto[]>([])

  const [header, setHeader] = useState<PaymentHeaderForm>(EMPTY_HEADER)
  const [errors, setErrors] = useState<PaymentHeaderErrors>({})
  const [lines, setLines] = useState<PaymentLineForm[]>([])
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  /** docKey → amount (document currency) and rate to the payment currency. */
  const [entries, setEntries] = useState<Record<string, AllocationEntry>>({})
  const [documents, setDocuments] = useState<OpenPayableDocumentDto[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(false)
  /** A posted Free Payment allocated later: which kind of document, until its first allocation decides. */
  const [laterKind, setLaterKind] = useState<PayableKind>('PINV')

  const [rateLoading, setRateLoading] = useState(false)
  const [rateDate, setRateDate] = useState<string | null>(null)
  const rateSeq = useRef(0)
  const headerRateEdited = useRef(false)
  const dirty = useRef(false)
  const attachmentsRef = useRef<HTMLDivElement>(null)

  const [reverseOpen, setReverseOpen] = useState(false)
  const [reverseBusy, setReverseBusy] = useState(false)

  const status = payment?.status ?? null
  const editable = isNew || status === 'Draft'
  const baseCurrency = currencies.find((c) => c.isBaseCurrency)
  const baseCurrencyCode = payment?.baseCurrencyCode ?? baseCurrency?.currencyCode ?? 'USD'
  const headerCurrency = currencies.find((c) => String(c.id) === header.currencyId)
  const headerIsBase = headerCurrency?.isBaseCurrency === true
  const headerRate = headerIsBase ? 1 : header.exchangeRate
  const paymentCurrencyCode = headerCurrency?.currencyCode ?? payment?.currencyCode ?? ''
  const payeeId = header.payeeId === null ? null : Number(header.payeeId)

  /** A posted Free Payment with an advance left can still be applied to documents. */
  const canApplyLater = status === 'Posted' && payment?.paymentType === 1 && (payment?.unappliedAmount ?? 0) > 0.005 && canAllocate
  const editKind = editable ? kindOfType(header.paymentType) : null
  const activeKind: PayableKind | null = editKind ?? (canApplyLater ? (payment?.allocationKind ?? laterKind) : null)

  const markDirty = () => {
    dirty.current = true
  }

  /* ── loading ──────────────────────────────────────────────────────────────────────────────── */

  const applyPayment = useCallback((doc: PaymentDto) => {
    setPayment(doc)
    headerRateEdited.current = true
    setRateDate(null)
    setHeader({
      paymentDate: doc.paymentDate.slice(0, 10),
      payeeId: String(doc.payeeId),
      branchId: String(doc.branchId),
      paymentType: doc.paymentType,
      currencyId: String(doc.currencyId),
      amount: doc.amount,
      exchangeRate: doc.exchangeRate,
      reference: doc.reference ?? '',
      notes: doc.notes ?? '',
    })
    setLines(
      doc.lines.map((line) => ({
        key: nextKey(),
        paymentMethodId: String(line.paymentMethodId),
        currencyId: String(line.currencyId),
        amount: line.amount,
        rateToPayment: line.rateToPayment,
        rateEdited: true,
        cashBankAccountId: String(line.cashBankAccountId),
        reference: line.reference ?? '',
        chequeNo: line.chequeNo ?? '',
        chequeDate: line.chequeDate ? line.chequeDate.slice(0, 10) : null,
        chequeDueDate: line.chequeDueDate ? line.chequeDueDate.slice(0, 10) : null,
      })),
    )
    // Only a draft's allocations are being edited; on a posted payment they are history, shown in their own card.
    const next: Record<string, AllocationEntry> = {}
    if (doc.status === 'Draft') for (const a of doc.allocations) if (a.isLive) next[docKey(a.documentKind, a.documentId)] = { amount: a.amountDocCurrency, rateToPayment: a.rateToPayment }
    setEntries(next)
    dirty.current = false
  }, [])

  const reload = useCallback(async () => {
    if (paymentId === null) return
    try {
      applyPayment(await paymentsApi.get(paymentId))
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The payment could not be refreshed.')
    }
  }, [paymentId, applyPayment])

  useEffect(() => {
    if (paymentId === null) return
    let cancelled = false
    paymentsApi
      .get(paymentId)
      .then((doc) => {
        if (!cancelled) applyPayment(doc)
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof ApiError && error.status === 404 ? 'This payment does not exist.' : 'The payment could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [paymentId, applyPayment])

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
    partiesApi.lookup({ partyType: 'Supplier', activeOnly: false }).then(setPayees).catch(() => notify.error('Suppliers could not be loaded.'))
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
    attachmentTypesApi.lookup(true, undefined, 'Payment').then(setAttachmentTypes).catch(() => {})
    // isNew comes from the route; it does not change without a remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The payee's open documents of the kind the payment allocates, with the rates the rows pre-fill.
  useEffect(() => {
    if (activeKind === null || payeeId === null) {
      setDocuments([])
      return
    }
    const controller = new AbortController()
    setDocumentsLoading(true)
    paymentsApi
      .openDocuments(
        payeeId,
        activeKind,
        { currencyId: header.currencyId === null ? null : Number(header.currencyId), rate: headerRate, date: editable ? header.paymentDate : null },
        controller.signal,
      )
      .then(setDocuments)
      .catch((error) => {
        if (!controller.signal.aborted) notify.error(error instanceof ApiError ? error.message : 'The payee’s documents could not be loaded.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setDocumentsLoading(false)
      })
    return () => controller.abort()
  }, [activeKind, payeeId, header.currencyId, headerRate, header.paymentDate, editable, payment?.rowVersion])

  /* ── rates ────────────────────────────────────────────────────────────────────────────────── */

  /** The official rate of a currency on a date (units per 1 base), or null; it never throws. */
  async function officialRate(currencyId: string, date: string): Promise<{ rate: number | null } | null> {
    try {
      const r = await paymentsApi.rate(Number(currencyId), Number(currencyId), null, date)
      return { rate: r.fromRate }
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
    const found = await officialRate(currencyId, date)
    if (seq !== rateSeq.current) return
    setRateLoading(false)
    if (!found) return
    setHeader((current) => (current.currencyId === currencyId && !headerRateEdited.current ? { ...current, exchangeRate: found.rate } : current))
    setRateDate(null)
    if (found.rate === null) notify.info(`No exchange rate is defined for ${currency?.currencyCode ?? 'this currency'} on ${dateLabel(date)}. Enter one.`)
  }

  /** A line's multiplier to the payment currency, unless the reader typed it. */
  async function refreshLineRate(key: string, lineCurrencyId: string, paymentCurrencyId: string | null, paymentRate: number | null, date: string) {
    if (!paymentCurrencyId) return
    if (lineCurrencyId === paymentCurrencyId) {
      setLines((current) => current.map((l) => (l.key === key ? { ...l, rateToPayment: 1 } : l)))
      return
    }
    try {
      const r = await paymentsApi.rate(Number(lineCurrencyId), Number(paymentCurrencyId), paymentRate, date)
      setLines((current) => current.map((l) => (l.key === key && l.currencyId === lineCurrencyId && !l.rateEdited ? { ...l, rateToPayment: r.rateToPayment === null ? null : round(r.rateToPayment, 10) } : l)))
      if (r.rateToPayment === null) notify.info('No exchange rate is defined for one of the line currencies on that date. Enter the rate on the line.')
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The exchange rate could not be looked up.')
    }
  }

  function refreshAllLineRates(next: PaymentHeaderForm, nextRate: number | null) {
    for (const line of lines) if (line.currencyId && !line.rateEdited) void refreshLineRate(line.key, line.currencyId, next.currencyId, nextRate, next.paymentDate)
  }

  async function changeHeader(patch: Partial<PaymentHeaderForm>) {
    /* CHANGING THE PAYEE OR THE TYPE CLEARS ALLOCATIONS THAT NO LONGER FIT - after asking. Another payee's
       documents, or invoices on a charge payment, would be refused by the server anyway. */
    const hasAllocations = Object.values(entries).some((e) => e.amount)
    const typeChangesKind = 'paymentType' in patch && kindOfType(patch.paymentType!) !== kindOfType(header.paymentType)
    const payeeChanges = 'payeeId' in patch && patch.payeeId !== header.payeeId
    if (hasAllocations && (typeChangesKind || payeeChanges)) {
      const go = await confirm({
        title: payeeChanges ? 'Change the payee?' : 'Change the payment type?',
        message: 'The documents already allocated in this payment will be cleared, because they do not belong to the new choice.',
        confirmLabel: 'Change and clear',
        danger: true,
      })
      if (!go) return
      setEntries({})
    }

    markDirty()
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch) as (keyof PaymentHeaderForm)[]) delete next[key]
      return next
    })
    const next = { ...header, ...patch }
    setHeader(next)

    if ('currencyId' in patch) {
      headerRateEdited.current = false
      // The multipliers all change with the payment currency: the typed ones too, since they named the old currency.
      setLines((current) => current.map((l) => ({ ...l, rateEdited: false, rateToPayment: l.currencyId === next.currencyId ? 1 : null })))
      setEntries((current) => Object.fromEntries(Object.entries(current).map(([k, e]) => [k, { ...e, rateToPayment: null }])))
      const currency = currencies.find((c) => String(c.id) === next.currencyId)
      const nextRate = currency?.isBaseCurrency ? 1 : null
      void refreshHeaderRate(next.currencyId, next.paymentDate)
      for (const line of lines) if (line.currencyId && line.currencyId !== next.currencyId) void refreshLineRate(line.key, line.currencyId, next.currencyId, nextRate, next.paymentDate)
    } else if ('paymentDate' in patch) {
      void refreshHeaderRate(next.currencyId, next.paymentDate)
      refreshAllLineRates(next, headerRate)
    } else if ('exchangeRate' in patch) {
      refreshAllLineRates(next, patch.exchangeRate ?? null)
      setEntries((current) => Object.fromEntries(Object.entries(current).map(([k, e]) => [k, { ...e, rateToPayment: null }])))
    }
  }

  /* ── totals ───────────────────────────────────────────────────────────────────────────────── */

  const lineRate = useCallback((line: PaymentLineForm) => (line.currencyId !== null && line.currencyId === header.currencyId ? 1 : line.rateToPayment), [header.currencyId])
  const linesTotal = useMemo(() => lines.reduce((sum, line) => sum + toPayment(line.amount, lineRate(line)), 0), [lines, lineRate])

  const entryRate = useCallback(
    (doc: OpenPayableDocumentDto, entry: AllocationEntry | undefined) =>
      String(doc.currencyId) === header.currencyId ? 1 : (entry?.rateToPayment ?? doc.defaultRateToPayment),
    [header.currencyId],
  )
  const allocatedTotal = useMemo(
    () =>
      documents.reduce((sum, doc) => {
        const entry = entries[docKey(doc.documentKind, doc.documentId)]
        return sum + toPayment(entry?.amount ?? null, entryRate(doc, entry))
      }, 0),
    [documents, entries, entryRate],
  )

  /* ── payment lines ────────────────────────────────────────────────────────────────────────── */

  function addLine() {
    markDirty()
    const remaining = header.amount !== null ? Math.max(0, round(header.amount - linesTotal, 2)) : 0
    setLines((current) => [
      ...current,
      {
        key: nextKey(),
        paymentMethodId: null,
        currencyId: header.currencyId,
        // The rest of the Payment Amount, in its own currency: usually exactly what is left to type.
        amount: remaining > 0 ? remaining : null,
        rateToPayment: 1,
        rateEdited: false,
        cashBankAccountId: null,
        reference: '',
        chequeNo: '',
        chequeDate: null,
        chequeDueDate: null,
      },
    ])
  }

  function patchLine(key: string, patch: Partial<PaymentLineForm>) {
    markDirty()
    setRowErrors({})
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function chooseLineCurrency(key: string, currencyId: string | null) {
    markDirty()
    setRowErrors({})
    setLines((current) =>
      current.map((l) => {
        if (l.key !== key) return l
        const account = accounts.find((a) => String(a.id) === l.cashBankAccountId)
        // An account holds one currency: one that no longer fits is cleared, not left on the wrong row.
        const keep = account !== undefined && String(account.currencyId) === currencyId
        return { ...l, currencyId, cashBankAccountId: keep ? l.cashBankAccountId : null, rateToPayment: currencyId === header.currencyId ? 1 : null, rateEdited: false }
      }),
    )
    if (currencyId && currencyId !== header.currencyId) void refreshLineRate(key, currencyId, header.currencyId, headerRate, header.paymentDate)
  }

  function removeLine(key: string) {
    markDirty()
    setRowErrors({})
    setLines((current) => current.filter((l) => l.key !== key))
  }

  /* ── saving ───────────────────────────────────────────────────────────────────────────────── */

  const isChequeLine = (line: PaymentLineForm) => methods.find((m) => String(m.id) === line.paymentMethodId)?.methodCode === 'CHQ'

  function validate(): { ok: boolean; completeLines: PaymentLineForm[] } {
    const next: PaymentHeaderErrors = {}
    if (!header.paymentDate) next.paymentDate = 'Choose a date.'
    if (!header.payeeId) next.payeeId = 'Choose the payee.'
    if (!header.branchId) next.branchId = 'Choose a branch.'
    if (!header.currencyId) next.currencyId = 'Choose a currency.'
    if (header.amount === null || header.amount <= 0) next.amount = 'Enter the payment amount.'
    if (header.currencyId && !headerIsBase && (header.exchangeRate === null || header.exchangeRate <= 0)) next.exchangeRate = 'Enter an exchange rate.'
    setErrors(next)

    // A row nobody touched is not an error; it is dropped.
    const meaningful = lines.filter((l) => l.paymentMethodId || l.amount !== null || l.cashBankAccountId || l.reference.trim() || l.chequeNo.trim())
    const problems: Record<string, string> = {}
    meaningful.forEach((line, index) => {
      const missing: string[] = []
      if (!line.paymentMethodId) missing.push('a payment method')
      if (!line.currencyId) missing.push('a currency')
      if (line.amount === null || line.amount <= 0) missing.push('an amount')
      if (line.currencyId && line.currencyId !== header.currencyId && (line.rateToPayment === null || line.rateToPayment <= 0)) missing.push('an exchange rate')
      if (!line.cashBankAccountId) missing.push('a cash or bank account')
      if (isChequeLine(line) && !line.chequeNo.trim()) missing.push('a cheque number')
      if (isChequeLine(line) && !line.chequeDate) missing.push('a cheque date')
      if (missing.length > 0) problems[line.key] = `Payment line ${index + 1} needs ${missing.join(', ')}.`
    })
    setRowErrors(problems)

    if (Object.keys(next).length > 0) {
      notify.error('Some payment information still needs filling in.')
      return { ok: false, completeLines: meaningful }
    }
    if (Object.keys(problems).length > 0) {
      notify.error('Some payment lines are incomplete.')
      return { ok: false, completeLines: meaningful }
    }
    return { ok: true, completeLines: meaningful }
  }

  /** What is typed for the documents of the active kind, as the API takes it. */
  function allocationRequests(kind: PayableKind | null): SavePaymentAllocation[] {
    if (kind === null) return []
    return documents
      .map((doc) => ({ doc, entry: entries[docKey(doc.documentKind, doc.documentId)] }))
      .filter(({ entry }) => entry?.amount !== null && entry?.amount !== undefined && entry.amount > 0)
      .map(({ doc, entry }) => ({
        documentKind: kind,
        documentId: doc.documentId,
        amount: entry!.amount!,
        rateToPayment: String(doc.currencyId) === header.currencyId ? null : entryRate(doc, entry),
      }))
  }

  function toRequest(completeLines: PaymentLineForm[]): SavePaymentRequest {
    return {
      paymentDate: header.paymentDate,
      payeeId: Number(header.payeeId),
      branchId: Number(header.branchId),
      paymentType: header.paymentType,
      currencyId: Number(header.currencyId),
      amount: header.amount!,
      exchangeRate: headerIsBase ? null : header.exchangeRate,
      reference: header.reference.trim() || null,
      notes: header.notes.trim() || null,
      lines: completeLines.map((line) => {
        const cheque = isChequeLine(line)
        return {
          paymentMethodId: Number(line.paymentMethodId),
          currencyId: Number(line.currencyId),
          amount: line.amount!,
          rateToPayment: line.currencyId === header.currencyId ? null : line.rateToPayment,
          cashBankAccountId: Number(line.cashBankAccountId),
          reference: line.reference.trim() || null,
          chequeNo: cheque ? line.chequeNo.trim() || null : null,
          chequeDate: cheque ? line.chequeDate : null,
          chequeDueDate: cheque ? line.chequeDueDate : null,
        }
      }),
      // A Free Payment names no documents; the server refuses any it is sent.
      allocations: allocationRequests(kindOfType(header.paymentType)),
      rowVersion: payment?.rowVersion ?? null,
    }
  }

  function showApiError(error: unknown, fallback: string) {
    notify.error(error instanceof ApiError ? error.message : fallback)
    if (error instanceof ApiError && error.code === 'CONCURRENCY') void reload()
  }

  async function saveDraft(): Promise<PaymentDto | null> {
    const { ok, completeLines } = validate()
    if (!ok) return null
    setSaving(true)
    try {
      const request = toRequest(completeLines)
      const saved = paymentId === null ? await paymentsApi.create(request) : await paymentsApi.update(paymentId, request)
      applyPayment(saved)
      notify.success(paymentId === null ? `Draft ${saved.paymentNumber ?? ''} created.` : 'Draft saved.')
      if (paymentId === null) void navigate(`${PAYMENTS_ROUTE}/${saved.id}`, { replace: true })
      return saved
    } catch (error) {
      showApiError(error, 'The payment could not be saved.')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function saveAndPost() {
    const saved = await saveDraft()
    if (!saved) return
    // The saved payment's own totals, checked before the question: the server still decides.
    if (!isBalanced(saved.amount, saved.linesTotal)) {
      notify.error('Unbalanced Payment — Payment Details Total does not match the Payment Amount. The draft is saved.')
      return
    }
    if (saved.paymentType !== 1 && !isBalanced(saved.amount, saved.allocatedTotal)) {
      notify.error('Unbalanced Allocation — Total allocated amount must equal the Payment Amount. The draft is saved.')
      return
    }
    const go = await confirm({
      title: 'Post this payment?',
      message: `Post ${saved.paymentNumber ?? 'this payment'} for ${formatNumber(saved.amount, saved.decimalPlaces)} ${saved.currencyCode} to ${saved.payeeName}? ${
        saved.paymentType === 1 ? 'It becomes an unapplied advance to the payee.' : 'The allocated documents are paid by it.'
      } Once posted it can no longer be edited or deleted, only reversed.`,
      confirmLabel: 'Post Payment',
    })
    if (!go) return
    setSaving(true)
    try {
      applyPayment(await paymentsApi.post(saved.id, saved.rowVersion))
      notify.success('Payment posted.')
    } catch (error) {
      showApiError(error, 'The payment could not be posted.')
    } finally {
      setSaving(false)
    }
  }

  async function reverse(reason: string) {
    if (!payment) return
    setReverseBusy(true)
    try {
      applyPayment(await paymentsApi.reverse(payment.id, reason, payment.rowVersion))
      notify.success('Payment reversed.')
      setReverseOpen(false)
    } catch (error) {
      showApiError(error, 'The payment could not be reversed.')
    } finally {
      setReverseBusy(false)
    }
  }

  async function applyAdvance() {
    if (!payment || activeKind === null) return
    const requests = allocationRequests(activeKind)
    if (requests.length === 0) {
      notify.error('Enter an amount against at least one document.')
      return
    }
    setSaving(true)
    try {
      applyPayment(await paymentsApi.allocate(payment.id, requests, payment.rowVersion))
      notify.success('Advance applied to the documents.')
    } catch (error) {
      showApiError(error, 'The advance could not be applied.')
    } finally {
      setSaving(false)
    }
  }

  async function takeBack(allocation: PaymentAllocationDto) {
    if (!payment) return
    const go = await confirm({
      title: 'Take allocation back',
      message: `Remove the allocation to ${allocation.documentNumber}? It becomes outstanding again and the amount returns to this payment's advance.`,
      confirmLabel: 'Take back',
      danger: true,
    })
    if (!go) return
    try {
      applyPayment(await paymentsApi.deallocate(payment.id, allocation.id))
      notify.success('Allocation removed.')
    } catch (error) {
      showApiError(error, 'The allocation could not be removed.')
    }
  }

  async function setClearance(line: PaymentLineDto, clearanceStatus: number) {
    if (!payment) return
    try {
      applyPayment(await paymentsApi.setChequeStatus(payment.id, line.id, clearanceStatus))
      notify.success('Cheque status saved.')
    } catch (error) {
      showApiError(error, 'The cheque status could not be saved.')
    }
  }

  async function leave() {
    if (dirty.current) {
      const go = await confirm({ title: 'Leave without saving?', message: 'This payment has changes that have not been saved. Leaving now discards them.', confirmLabel: 'Discard', danger: true })
      if (!go) return
    }
    void navigate(PAYMENTS_ROUTE)
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
        <PageHeader title="Payment" />
        <Alert color="red">{loadError}</Alert>
        <Group>
          <Button variant="default" onClick={() => void navigate(PAYMENTS_ROUTE)}>Back to Payment List</Button>
        </Group>
      </Stack>
    )
  }

  /* WHY POST IS DISABLED, said on the button: the details, and the allocation when there is one, must
     equal the Payment Amount. */
  const detailsBalanced = header.amount !== null && lines.length > 0 && isBalanced(header.amount, linesTotal)
  const allocationBalanced = header.paymentType === 1 || (header.amount !== null && isBalanced(header.amount, allocatedTotal))
  const postBlockedReason =
    lines.length === 0
      ? 'Add at least one payment line'
      : !detailsBalanced
        ? 'Unbalanced Payment: the payment details must equal the Payment Amount'
        : !allocationBalanced
          ? 'Unbalanced Allocation: the allocated amount must equal the Payment Amount'
          : undefined

  const scrollToAttachments = () => attachmentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const print: DocumentAction = {
    key: 'print',
    label: 'Print',
    icon: <IconPrinter size={16} />,
    disabled: isNew,
    disabledReason: 'Save the draft first',
    onClick: () => {
      if (payment === null) return
      if (dirty.current) {
        notify.info('Save the draft first: the print view shows the saved payment.')
        return
      }
      void navigate(`${PAYMENTS_ROUTE}/${payment.id}/print`)
    },
  }
  const attachmentAction: DocumentAction = {
    key: 'attachment',
    label: editable ? 'Add Attachment' : 'View Attachments',
    icon: DocumentIcons.attachments,
    disabled: isNew,
    disabledReason: 'Save the draft first',
    onClick: scrollToAttachments,
  }

  const actions: DocumentAction[] = editable
    ? [
        { key: 'cancel', label: 'Cancel', icon: DocumentIcons.cancel, onClick: () => void leave() },
        print,
        attachmentAction,
        { key: 'save', label: 'Save Draft', icon: DocumentIcons.save, visible: canCreate, loading: saving, onClick: () => void saveDraft() },
        {
          key: 'post',
          label: 'Post Payment',
          icon: DocumentIcons.post,
          variant: 'filled',
          visible: canCreate && canPost,
          loading: saving,
          disabled: postBlockedReason !== undefined,
          disabledReason: postBlockedReason,
          onClick: () => void saveAndPost(),
        },
      ]
    : [
        print,
        attachmentAction,
        { key: 'reverse', label: 'Reverse', icon: DocumentIcons.cancel, colour: 'red', visible: canReverse && status === 'Posted', onClick: () => setReverseOpen(true) },
        { key: 'back', label: 'Back', icon: DocumentIcons.back, onClick: () => void navigate(PAYMENTS_ROUTE) },
      ]

  const title = isNew ? 'New Payment' : `Payment ${payment?.paymentNumber ?? `draft #${payment?.id}`}`

  return (
    <Stack>
      <PageHeader title={title} subtitle="Record a payment to a supplier or service provider." />

      <DocumentActionBar actions={actions} />

      {payment && status === 'Posted' && (
        <Alert color="green" title={`Posted — ${payment.paymentNumber}`}>
          Posted by {payment.postedByName ?? 'unknown'} on {stamp(payment.postedAtUtc)}. It can no longer be edited or deleted; it can be reversed.
          {payment.paymentType === 1 && (
            <Text size="sm" mt={4}>
              Free Payment {formatNumber(payment.amount, payment.decimalPlaces)} {payment.currencyCode} · Allocated {formatNumber(payment.allocatedTotal, 2)} · Unapplied advance{' '}
              <b>{formatNumber(payment.unappliedAmount, 2)} {payment.currencyCode}</b>
            </Text>
          )}
        </Alert>
      )}
      {payment && status === 'Reversed' && (
        <Alert color="orange" title={`Reversed — ${payment.paymentNumber}`}>
          Reversed by {payment.reversedByName ?? 'unknown'} on {stamp(payment.reversedAtUtc)}.{payment.reverseReason ? ` Reason: ${payment.reverseReason}` : ''}
        </Alert>
      )}

      <PaymentHeaderCard
        value={header}
        onChange={(patch) => void changeHeader(patch)}
        onRateEdited={() => {
          headerRateEdited.current = true
        }}
        branches={branches}
        payees={payees}
        currencies={currencies}
        paymentNumber={payment?.paymentNumber ?? null}
        status={status}
        baseCurrencyCode={baseCurrencyCode}
        rateLoading={rateLoading}
        rateDate={rateDate}
        isBaseCurrency={headerIsBase}
        readOnly={!editable}
        disabled={saving}
        errors={errors}
      />

      <PaymentLinesCard
        lines={lines}
        onChange={patchLine}
        onCurrencyChosen={chooseLineCurrency}
        onAdd={addLine}
        onRemove={removeLine}
        methods={methods}
        accounts={accounts}
        currencies={currencies}
        branchId={header.branchId === null ? null : Number(header.branchId)}
        paymentCurrencyId={header.currencyId}
        paymentCurrencyCode={paymentCurrencyCode}
        headerAmount={header.amount}
        readOnly={!editable}
        rowErrors={rowErrors}
        savedLines={payment?.lines}
        onClearance={status === 'Posted' && canPost ? (line, value) => void setClearance(line, value) : undefined}
      />

      {editable && editKind !== null && (
        <PaymentAllocationsCard
          kind={editKind}
          documents={documents}
          loading={documentsLoading}
          hasPayee={payeeId !== null}
          entries={entries}
          onChange={(key, entry) => {
            markDirty()
            setEntries((current) => {
              const next = { ...current }
              if (entry === null) delete next[key]
              else next[key] = entry
              return next
            })
          }}
          onFill={(next) => {
            markDirty()
            setEntries(next)
          }}
          target={header.amount ?? 0}
          paymentCurrencyId={header.currencyId}
          paymentCurrencyCode={paymentCurrencyCode}
        />
      )}

      {canApplyLater && payment && activeKind !== null && (
        <PaymentAllocationsCard
          kind={activeKind}
          title="Allocate the advance"
          intro={`${formatNumber(payment.unappliedAmount, 2)} ${payment.currencyCode} of this payment is an unapplied advance. Allocate all or part of it to this payee's purchase invoices or container charges - never both.`}
          documents={documents}
          loading={documentsLoading}
          hasPayee
          entries={entries}
          onChange={(key, entry) =>
            setEntries((current) => {
              const next = { ...current }
              if (entry === null) delete next[key]
              else next[key] = entry
              return next
            })
          }
          onFill={setEntries}
          target={payment.unappliedAmount}
          paymentCurrencyId={header.currencyId}
          paymentCurrencyCode={paymentCurrencyCode}
          partialOk
          action={
            <Group gap="xs">
              {payment.allocationKind === null && (
                <SegmentedControl
                  size="xs"
                  value={laterKind}
                  onChange={(next) => {
                    setLaterKind(next as PayableKind)
                    setEntries({})
                  }}
                  data={[
                    { value: 'PINV', label: 'Purchase invoices' },
                    { value: 'CHARGE', label: 'Container charges' },
                  ]}
                />
              )}
              <Button loading={saving} onClick={() => void applyAdvance()}>
                Apply allocation
              </Button>
            </Group>
          }
        />
      )}

      {payment && (
        <PaymentAppliedCard
          allocations={payment.allocations}
          paymentCurrencyCode={payment.currencyCode}
          canRemove={status === 'Posted' && payment.paymentType === 1 && canAllocate}
          onRemove={(allocation) => void takeBack(allocation)}
        />
      )}

      <div ref={attachmentsRef}>
        <PaymentAttachmentsCard
          paymentId={payment?.id ?? null}
          files={payment?.files ?? []}
          types={attachmentTypes}
          canAdd={canCreate && status !== 'Reversed'}
          canRemove={canCreate && status !== 'Reversed'}
          canEdit={canCreate && status !== 'Reversed'}
          onChanged={() => void reload()}
        />
      </div>

      <AuditTrail entries={payment?.audit ?? []} />

      <CancelReasonModal
        opened={reverseOpen}
        onClose={() => setReverseOpen(false)}
        documentLabel={payment?.paymentNumber ?? `draft #${payment?.id}`}
        busy={reverseBusy}
        title={`Reverse ${payment?.paymentNumber ?? `draft #${payment?.id}`}`}
        placeholder="Why is this being reversed?"
        confirmLabel="Reverse payment"
        description="Reversing undoes the payment: the invoices or charges it paid owe the money again, and its advance is withdrawn. The payment stays in place as a record. It cannot be undone."
        onConfirm={(reason) => void reverse(reason)}
      />
    </Stack>
  )
}
