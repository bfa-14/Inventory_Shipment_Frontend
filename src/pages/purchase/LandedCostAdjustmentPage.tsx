import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { routes } from '../../routes'
import { Alert, Anchor, Badge, Button, Grid, Group, Loader, Paper, Select, SimpleGrid, Stack, Table, Text, Textarea, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconSend, IconTrash, IconX } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { currenciesApi } from '../../api/masterdata/currencies'
import { partiesApi } from '../../api/masterdata/parties'
import { chargeTypesApi, type ChargeTypeLookupDto } from '../../api/purchase/chargeTypes'
import { purchaseDocumentsApi, type PurchaseDocumentDto, type PurchaseDocumentListDto } from '../../api/purchase/documents'
import {
  landedCostAdjustmentsApi,
  LANDED_COST_STATUS_COLOURS,
  type LandedCostAdjustmentDto,
  type SaveLandedCostAdjustmentRequest,
} from '../../api/purchase/landedCostAdjustments'
import type { CurrencyLookupDto, PartyLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { CancelReasonModal } from '../../components/documents/CancelReasonModal'
import { DocumentActionBar, type DocumentAction } from '../../components/documents/DocumentActionBar'
import { DocumentIcons } from '../../components/documents/documentIcons'
import { dateLabel, fromIsoDate, isoDate, stamp } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import { PurchaseChargesGrid } from '../../components/purchase/PurchaseChargesGrid'
import {
  chargeFromDto,
  emptyCharge,
  isUnallocated,
  toChargeRequests,
  toManualAllocations,
  type AllocationTarget,
  type ChargeLine,
} from '../../components/purchase/purchaseCharges'
import { confirm } from '../../components/ui/confirm'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { PERMISSIONS } from '../../navigation'
import { LANDED_COSTS_ROUTE } from './LandedCostAdjustmentsPage'

/**
 * One landed cost adjustment: the charges that arrived after the goods, and where they landed.
 *
 * THE INVOICE IS CHOSEN ONCE. Every figure — which lines exist, how much is still in stock, what
 * the landed cost was before — hangs off it, so the server refuses to move an adjustment to
 * another invoice and the field is read-only the moment the draft exists.
 *
 * THE SPLIT IS THE ANSWER, and it only exists after posting: the page cannot compute it, because
 * "still in stock" is a question about the ledger now, not about this document.
 */
export function LandedCostAdjustmentPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { hasPermission } = useAuth()

  const documentId = id && id !== 'new' ? Number(id) : null
  const isNew = documentId === null

  const canCreate = hasPermission(PERMISSIONS.landedCostsCreate)
  const canPost = hasPermission(PERMISSIONS.landedCostsPost)
  const canCancel = hasPermission(PERMISSIONS.landedCostsCancel)
  const canDelete = hasPermission(PERMISSIONS.landedCostsDelete)

  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [document, setDocument] = useState<LandedCostAdjustmentDto | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [chargeTypes, setChargeTypes] = useState<ChargeTypeLookupDto[]>([])
  const [providers, setProviders] = useState<PartyLookupDto[]>([])
  const [currencies, setCurrencies] = useState<CurrencyLookupDto[]>([])
  const [invoices, setInvoices] = useState<PurchaseDocumentListDto[]>([])

  /** The invoice the charges are spread over, read whole so the allocation grid has its lines. */
  const [loadedInvoice, setLoadedInvoice] = useState<PurchaseDocumentDto | null>(null)
  /* Only a NEW adjustment has an invoice to choose; a saved one carries its own, and the server
     refuses to move it. Keeping the choice separate from the document means loading a document
     does not write state that another effect watches — the render derives it instead. */
  const [chosenInvoiceId, setChosenInvoiceId] = useState<string | null>(searchParams.get('invoiceId'))
  const [documentDate, setDocumentDate] = useState(isoDate(new Date()))
  const [notes, setNotes] = useState('')
  const [charges, setCharges] = useState<ChargeLine[]>([])
  const [errors, setErrors] = useState<{ invoiceId?: string; documentDate?: string }>({})
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)

  const dirty = useRef(false)
  const markDirty = () => {
    dirty.current = true
  }

  const invoiceId = document ? String(document.sourceInvoiceId) : chosenInvoiceId
  const status = document?.status ?? 'Draft'
  const posted = status === 'Posted'
  const cancelled = status === 'Cancelled'
  const editable = !posted && !cancelled && canCreate && (isNew || document?.canEdit === true)
  const baseCurrency = currencies.find((c) => c.isBaseCurrency)
  const baseCurrencyCode = baseCurrency?.currencyCode ?? 'USD'

  /* ── loading ──────────────────────────────────────────────────────────────────────────────── */

  useEffect(() => {
    chargeTypesApi.lookup().then(setChargeTypes).catch(() => notify.error('Charge types could not be loaded.'))
    partiesApi.lookup({ partyType: 'Supplier', activeOnly: false }).then(setProviders).catch(() => {})
    currenciesApi.lookup().then(setCurrencies).catch(() => notify.error('Currencies could not be loaded.'))
    // Only POSTED invoices can carry an adjustment; a draft's lines are still moving.
    purchaseDocumentsApi
      .list({ documentTypeCode: 'PINV', status: 'Posted', pageSize: 200, sortBy: 'DocumentDate', sortDir: 'desc' })
      .then((page) => setInvoices(page.items))
      .catch(() => {})
  }, [])

  const applyDocument = useCallback((doc: LandedCostAdjustmentDto) => {
    setDocument(doc)
    setDocumentDate(doc.documentDate.slice(0, 10))
    setNotes(doc.notes ?? '')
    setCharges(doc.charges.map((c) => chargeFromDto(c)))
    setErrors({})
    dirty.current = false
  }, [])

  /**
   * The adjustment and the invoice it belongs to, in ONE pass.
   *
   * THE INVOICE IS NOT A SECOND EFFECT. Reading the adjustment is what says which invoice it is
   * about, so an effect watching that answer would fire a second round of loading every time the
   * document changed — a cascade. Loading both here keeps one entry point and one spinner; the
   * invoice's lines are what a manual split is spread over and what the preview shows.
   *
   * No setLoading(true): the page starts loading for an existing document, and a re-read after a
   * refused save keeps the figures on screen rather than blanking them for a moment.
   */
  const reload = useCallback(async () => {
    // Nothing chosen and nothing saved: there is nothing to fetch, and a state write here would
    // only re-render to say what the render already knows (the derived invoice is null).
    if (documentId === null && chosenInvoiceId === null) return

    try {
      let invoiceToLoad = documentId === null ? Number(chosenInvoiceId) : 0
      if (documentId !== null) {
        const doc = await landedCostAdjustmentsApi.get(documentId)
        applyDocument(doc)
        invoiceToLoad = doc.sourceInvoiceId
      }

      setLoadedInvoice(await purchaseDocumentsApi.get(invoiceToLoad))
      setLoadError(null)
    } catch (error) {
      // A missing invoice is not a missing adjustment: the page still draws, without the preview.
      if (documentId !== null) {
        setLoadError(error instanceof ApiError ? error.message : 'The adjustment could not be loaded.')
      }
    } finally {
      setLoading(false)
    }
  }, [documentId, chosenInvoiceId, applyDocument])

  useEffect(() => {
    /* set-state-in-effect: the rule's advice is to derive during render, which a network read
       cannot do — loading the document IS the outside system this effect synchronises with, and
       every write below happens after an await. Same shape as the other document pages. */
    // oxlint-disable-next-line react/set-state-in-effect
    void reload()
  }, [reload])

  /* Derived rather than cleared in the effect: a stale invoice must not survive a change of
     invoice for the frame before the next read answers, and clearing state inside an effect
     costs a second render to say something the render already knows. */
  const invoice = invoiceId !== null && loadedInvoice?.id === Number(invoiceId) ? loadedInvoice : null

  /* A saved adjustment stores its manual allocations server-side, but the Get does not return them
     per line. Reading the charge's own allocated total is enough for a posted document (read-only);
     a draft's manual cells are re-typed if the reader reopens it, and the page says so. */

  /* ── charges ──────────────────────────────────────────────────────────────────────────────── */

  const patchCharge = useCallback((key: string, patch: Partial<ChargeLine>) => {
    markDirty()
    setCharges((current) => current.map((line) => (line.key === key ? { ...line, ...patch, error: undefined } : line)))
  }, [])

  function addCharge() {
    markDirty()
    // An adjustment is settled in the base currency unless the reader says otherwise.
    setCharges((current) => [...current, { ...emptyCharge(baseCurrency?.id ?? null), exchangeRate: 1 }])
  }

  function removeCharge(key: string) {
    markDirty()
    setCharges((current) => current.filter((line) => line.key !== key))
  }

  const targets: AllocationTarget[] = useMemo(
    () =>
      (invoice?.lines ?? []).map((line) => ({
        id: line.id,
        lineNo: line.lineNo,
        itemCode: line.itemCode,
        itemName: line.itemName,
        quantityBase: line.quantityBase,
      })),
    [invoice],
  )

  /* ── saving ───────────────────────────────────────────────────────────────────────────────── */

  function validate(): boolean {
    const next: { invoiceId?: string; documentDate?: string } = {}
    if (invoiceId === null) next.invoiceId = 'Choose the purchase invoice the charges belong to.'
    if (!documentDate) next.documentDate = 'Choose a date.'
    setErrors(next)
    if (Object.keys(next).length > 0) {
      notify.error('Some header fields still need filling in.')
      return false
    }

    if (charges.length === 0) {
      notify.error('Add at least one charge before saving.')
      return false
    }

    const incomplete = charges.findIndex((c) => c.chargeTypeId === null || c.amount === null || c.amount <= 0)
    if (incomplete >= 0) {
      notify.error(`Charge ${incomplete + 1} needs a charge type and an amount above zero.`)
      return false
    }

    const unallocated = charges.findIndex(isUnallocated)
    if (unallocated >= 0) {
      notify.error(`Charge ${unallocated + 1} is allocated manually and has not been fully allocated yet.`)
      return false
    }

    return true
  }

  function toRequest(): SaveLandedCostAdjustmentRequest {
    return {
      sourceInvoiceId: Number(invoiceId),
      documentDate,
      notes: notes.trim() || null,
      charges: toChargeRequests(charges),
      manualAllocations: toManualAllocations(charges),
      rowVersion: document?.rowVersion ?? null,
    }
  }

  function showApiError(error: unknown, fallback: string) {
    if (!(error instanceof ApiError)) {
      notify.error(fallback)
      return
    }

    setCharges((current) => current.map((line) => ({ ...line, error: undefined })))
    const match = /^Charge (\d+):/.exec(error.message)
    if ((error.code === 'CHARGE_ALLOCATION' || error.code === 'VALIDATION') && match) {
      const index = Number(match[1]) - 1
      setCharges((current) => current.map((line, i) => (i === index ? { ...line, error: error.message } : line)))
    }

    notify.error(error.message)
    if (error.code === 'CONCURRENCY' || error.code === 'NOT_DRAFT') void reload()
  }

  async function saveDraft(): Promise<LandedCostAdjustmentDto | null> {
    if (!validate()) return null
    setSaving(true)
    try {
      const saved = documentId === null
        ? await landedCostAdjustmentsApi.create(toRequest())
        : await landedCostAdjustmentsApi.update(documentId, toRequest())

      applyDocument(saved)
      notify.success(documentId === null ? `Draft ${saved.documentNumber} created.` : 'Draft saved.')
      if (documentId === null) void navigate(`${LANDED_COSTS_ROUTE}/${saved.id}`, { replace: true })
      return saved
    } catch (error) {
      showApiError(error, 'The adjustment could not be saved.')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function saveAndPost() {
    const saved = await saveDraft()
    if (!saved) return

    const go = await confirm({
      title: 'Post this adjustment?',
      message: 'Post this adjustment? Item costs will be updated.',
      confirmLabel: 'Post',
    })
    if (!go) return

    setSaving(true)
    try {
      applyDocument(await landedCostAdjustmentsApi.post(saved.id, saved.rowVersion))
      notify.success('Adjustment posted. Item costs updated.')
    } catch (error) {
      showApiError(error, 'The adjustment could not be posted.')
    } finally {
      setSaving(false)
    }
  }

  async function cancelAdjustment(reason: string) {
    if (!document) return
    setCancelBusy(true)
    try {
      applyDocument(await landedCostAdjustmentsApi.cancel(document.id, reason, document.rowVersion))
      notify.success('Adjustment cancelled. Item costs were put back.')
      setCancelOpen(false)
    } catch (error) {
      showApiError(error, 'The adjustment could not be cancelled.')
    } finally {
      setCancelBusy(false)
    }
  }

  async function remove() {
    if (!document) return
    const go = await confirm({
      title: 'Delete draft',
      message: `Delete ${document.documentNumber}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!go) return

    setSaving(true)
    try {
      await landedCostAdjustmentsApi.remove(document.id)
      dirty.current = false
      notify.success('Draft deleted.')
      void navigate(LANDED_COSTS_ROUTE)
    } catch (error) {
      showApiError(error, 'The draft could not be deleted.')
    } finally {
      setSaving(false)
    }
  }

  async function exportToExcel() {
    if (!document) return
    try {
      await landedCostAdjustmentsApi.exportToExcel(document.id, document.documentNumber)
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The adjustment could not be exported.')
    }
  }

  async function leave() {
    if (dirty.current) {
      const go = await confirm({
        title: 'Leave without saving?',
        message: 'This adjustment has changes that have not been saved. Leaving now discards them.',
        confirmLabel: 'Discard',
        danger: true,
      })
      if (!go) return
    }
    void navigate(LANDED_COSTS_ROUTE)
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
        <PageHeader title="Landed Cost Adjustment" />
        <Alert color="red">{loadError}</Alert>
        <Group>
          <Button variant="default" onClick={() => void navigate(LANDED_COSTS_ROUTE)}>Back to the list</Button>
        </Group>
      </Stack>
    )
  }

  const field = (label: string, value: string) => (
    <div>
      <Text size="sm" c="dimmed">{label}</Text>
      <Text fw={500}>{value || '—'}</Text>
    </div>
  )

  const actions: DocumentAction[] = editable
    ? [
        { key: 'save', label: 'Save Draft', icon: DocumentIcons.save, loading: saving, onClick: () => void saveDraft() },
        { key: 'post', label: 'Save & Post', icon: <IconSend size={16} />, variant: 'filled', colour: 'green', visible: canPost, loading: saving, onClick: () => void saveAndPost() },
        { key: 'delete', label: 'Delete', icon: <IconTrash size={16} />, colour: 'red', visible: canDelete && document?.canDelete === true, disabled: saving, onClick: () => void remove() },
        { key: 'export', label: 'Export to Excel', icon: DocumentIcons.exportFile, visible: document !== null, onClick: () => void exportToExcel() },
        { key: 'back', label: 'Back', icon: DocumentIcons.back, onClick: () => void leave() },
      ]
    : [
        { key: 'export', label: 'Export to Excel', icon: DocumentIcons.exportFile, visible: document !== null, onClick: () => void exportToExcel() },
        { key: 'cancel-doc', label: 'Cancel Adjustment', icon: <IconX size={16} />, colour: 'red', visible: canCancel && document?.canCancel === true, onClick: () => setCancelOpen(true) },
        { key: 'back', label: 'Back', icon: DocumentIcons.back, onClick: () => void navigate(LANDED_COSTS_ROUTE) },
      ]

  return (
    <Stack>
      <PageHeader
        title={isNew ? 'New Landed Cost Adjustment' : `Landed Cost Adjustment ${document?.documentNumber ?? ''}`}
        subtitle={document?.sourceInvoiceNumber ? `On purchase invoice ${document.sourceInvoiceNumber}` : undefined}
      />

      <DocumentActionBar actions={actions} />

      {document && posted && (
        <Alert color="green" title={`Posted — ${document.documentNumber}`} data-lca-posted-banner>
          Posted by {document.postedByName ?? 'unknown'} on {stamp(document.postedAtUtc)} - item average costs updated.
        </Alert>
      )}

      {document && cancelled && (
        <Alert color="red" title={`Cancelled — ${document.documentNumber}`}>
          Cancelled on {stamp(document.cancelledAtUtc)}.{document.cancelReason ? ` Reason: ${document.cancelReason}` : ''} The item costs were put back.
        </Alert>
      )}

      <Paper radius="lg" p="md" withBorder>
        <Group justify="space-between" align="center" mb="sm" wrap="wrap">
          <Title order={5}>Adjustment</Title>
          <Badge size="lg" variant="light" color={LANDED_COST_STATUS_COLOURS[status] ?? 'gray'} data-lca-status>{status}</Badge>
        </Group>

        <Grid>
          <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
            {field('Number', document?.documentNumber ?? 'Assigned on save')}
          </Grid.Col>

          <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
            {editable ? (
              <DateInput
                label="Date"
                withAsterisk
                value={fromIsoDate(documentDate)}
                maxDate={new Date()}
                onChange={(next) => {
                  markDirty()
                  setDocumentDate(next ? isoDate(new Date(next)) : '')
                }}
                error={errors.documentDate}
                valueFormat="DD/MM/YYYY"
                disabled={saving}
              />
            ) : (
              field('Date', dateLabel(documentDate))
            )}
          </Grid.Col>

          <Grid.Col span={{ base: 12, sm: 6, lg: 6 }}>
            {/* THE INVOICE IS FIXED ONCE THE DRAFT EXISTS: every figure hangs off it, and the
                server refuses to move an adjustment to another invoice. */}
            {editable && isNew ? (
              <InvoiceSelect
                invoices={invoices}
                value={invoiceId}
                error={errors.invoiceId}
                disabled={saving}
                onChange={(next) => {
                  markDirty()
                  setChosenInvoiceId(next)
                  // A manual split points at the old invoice's line ids; another invoice's lines are not those.
                  setCharges((current) => current.map((c) => ({ ...c, allocations: {} })))
                }}
              />
            ) : (
              <div>
                <Text size="sm" c="dimmed">Purchase Invoice</Text>
                {invoiceId === null ? (
                  <Text fw={500}>—</Text>
                ) : (
                  <Anchor component={Link} to={routes.purchaseInvoice(Number(invoiceId))} fw={500}>
                    {document?.sourceInvoiceNumber ?? invoice?.documentNumber ?? `#${invoiceId}`}
                  </Anchor>
                )}
              </div>
            )}
          </Grid.Col>

          <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>{field('Supplier', document?.supplierName ?? invoice?.supplierName ?? '')}</Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>{field('Branch', document?.branchName ?? invoice?.branchName ?? '')}</Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>{field('Warehouse', document?.warehouseName ?? invoice?.warehouseName ?? '')}</Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>{field('Created By', document?.createdByName ?? '')}</Grid.Col>

          <Grid.Col span={12}>
            {editable ? (
              <Textarea
                label="Notes"
                placeholder="Which bill this is, and why it arrived late"
                value={notes}
                onChange={(event) => {
                  markDirty()
                  setNotes(event.currentTarget.value)
                }}
                maxLength={1000}
                autosize
                minRows={1}
                disabled={saving}
              />
            ) : (
              field('Notes', notes)
            )}
          </Grid.Col>
        </Grid>
      </Paper>

      <PurchaseChargesGrid
        lines={charges}
        onChange={patchCharge}
        onRemove={removeCharge}
        onAdd={addCharge}
        chargeTypes={chargeTypes}
        providers={providers}
        currencies={currencies}
        targets={targets}
        baseCurrencyCode={baseCurrencyCode}
        readOnly={!editable}
      />

      {invoice && (
        <Paper radius="lg" p="md" withBorder>
          <Title order={5} mb="sm">Invoice lines</Title>
          <Text fz="xs" c="dimmed" mb="sm">
            What the invoice received, and what is on the shelf now. The split below follows these quantities.
          </Text>
          <Table.ScrollContainer minWidth={760}>
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={50}>#</Table.Th>
                  <Table.Th>Item</Table.Th>
                  <Table.Th w={110} ta="right">Received</Table.Th>
                  <Table.Th w={110} ta="right">Returned</Table.Th>
                  <Table.Th w={130} ta="right">On hand now</Table.Th>
                  <Table.Th w={150} ta="right">Landed cost</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {invoice.lines.map((line) => (
                  <Table.Tr key={line.id}>
                    <Table.Td>{line.lineNo}</Table.Td>
                    <Table.Td>
                      <Text fz="sm" fw={500}>{line.itemCode}</Text>
                      <Text fz="xs" c="dimmed" lineClamp={1}>{line.itemName}</Text>
                    </Table.Td>
                    <Table.Td ta="right">{formatNumber(line.quantityBase)}</Table.Td>
                    <Table.Td ta="right">{formatNumber(line.returnedQuantityBase)}</Table.Td>
                    <Table.Td ta="right">{formatNumber(line.onHandBase)}</Table.Td>
                    <Table.Td ta="right">{formatNumber(line.landedCostBase, 2)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}

      {document && document.lines.length > 0 && (
        <Paper radius="lg" p="md" withBorder data-lca-split>
          <Title order={5} mb="sm">Split</Title>
          <Text fz="xs" c="dimmed" mb="sm">
            What each line took, and where it went: stock still on the shelf is worth more, goods already sold land in the period's cost of sales.
          </Text>

          <Table.ScrollContainer minWidth={1100}>
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={50}>#</Table.Th>
                  <Table.Th>Item</Table.Th>
                  <Table.Th w={110} ta="right">Allocated</Table.Th>
                  <Table.Th w={120} ta="right">Extra per unit</Table.Th>
                  <Table.Th w={110} ta="right">Remaining</Table.Th>
                  <Table.Th w={140} ta="right">Inventory portion</Table.Th>
                  <Table.Th w={130} ta="right">COGS portion</Table.Th>
                  <Table.Th w={130} ta="right">Landed before</Table.Th>
                  <Table.Th w={130} ta="right">Landed after</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {document.lines.map((line) => (
                  <Table.Tr key={line.id}>
                    <Table.Td>{line.lineNo}</Table.Td>
                    <Table.Td>
                      <Text fz="sm" fw={500}>{line.itemCode}</Text>
                      <Text fz="xs" c="dimmed" lineClamp={1}>{line.itemName}</Text>
                    </Table.Td>
                    <Table.Td ta="right">{formatNumber(line.allocatedBase, 2)}</Table.Td>
                    <Table.Td ta="right">{formatNumber(line.extraPerBaseUnit, 4)}</Table.Td>
                    <Table.Td ta="right">{formatNumber(line.remainingBase)}</Table.Td>
                    <Table.Td ta="right"><Text fz="sm" fw={500} c="teal">{formatNumber(line.inventoryPortionBase, 2)}</Text></Table.Td>
                    <Table.Td ta="right"><Text fz="sm" fw={500} c="orange">{formatNumber(line.cogsPortionBase, 2)}</Text></Table.Td>
                    <Table.Td ta="right">{formatNumber(line.landedCostBefore, 2)}</Table.Td>
                    <Table.Td ta="right"><Text fz="sm" fw={600}>{formatNumber(line.landedCostAfter, 2)}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>

          <SimpleGrid cols={{ base: 1, sm: 3 }} mt="md">
            <div>
              <Text size="sm" c="dimmed">Total charges ({baseCurrencyCode})</Text>
              <Text fw={700} fz="lg">{formatNumber(document.totalChargesBase, 2)}</Text>
            </div>
            <div>
              <Text size="sm" c="dimmed">Inventory portion</Text>
              <Text fw={700} fz="lg" c="teal">{formatNumber(document.inventoryPortionBase, 2)}</Text>
            </div>
            <div>
              <Text size="sm" c="dimmed">COGS portion</Text>
              <Text fw={700} fz="lg" c="orange">{formatNumber(document.cogsPortionBase, 2)}</Text>
            </div>
          </SimpleGrid>
        </Paper>
      )}

      <CancelReasonModal
        opened={cancelOpen}
        onClose={() => setCancelOpen(false)}
        documentLabel={document?.documentNumber ?? ''}
        busy={cancelBusy}
        onConfirm={(reason) => void cancelAdjustment(reason)}
      />
    </Stack>
  )
}

/** The posted invoices to choose from: number, supplier and date, because a number alone is not recognisable. */
function InvoiceSelect({
  invoices,
  value,
  error,
  disabled,
  onChange,
}: {
  invoices: PurchaseDocumentListDto[]
  value: string | null
  error?: string
  disabled: boolean
  onChange: (next: string | null) => void
}) {
  const options = invoices.map((invoice) => ({
    value: String(invoice.id),
    label: `${invoice.documentNumber ?? `#${invoice.id}`} - ${invoice.supplierName} - ${dateLabel(invoice.documentDate)}`,
  }))

  return (
    <Select
      label="Purchase Invoice"
      withAsterisk
      description="Posted purchase invoices only: a draft's lines are still moving."
      placeholder={options.length === 0 ? 'No posted purchase invoice yet' : 'Search by number or supplier'}
      data={options}
      value={value}
      onChange={onChange}
      error={error}
      disabled={disabled || options.length === 0}
      searchable
      nothingFoundMessage="No invoice matches"
    />
  )
}
