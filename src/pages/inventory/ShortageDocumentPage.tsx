import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Alert, Badge, Button, Grid, Group, Loader, Paper, Stack, Text, Title, Tooltip } from '@mantine/core'
import { IconCalculator, IconDownload, IconPrinter, IconShoppingCart, IconTrash } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { shortagesApi, type SaveShortageDocumentRequest, type ShortageDocumentDto, type ShortageLiveRowDto } from '../../api/inventory/shortages'
import { brandsApi } from '../../api/masterdata/brands'
import { branchesApi } from '../../api/masterdata/branches'
import { itemFamiliesApi } from '../../api/masterdata/itemFamilies'
import { partiesApi } from '../../api/masterdata/parties'
import { warehousesApi } from '../../api/masterdata/warehouses'
import type { BranchLookupDto, BrandLookupDto, ItemFamilyLookupDto, PartyLookupDto, WarehouseLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { AuditTrail } from '../../components/documents/AuditTrail'
import { DocumentActionBar, type DocumentAction } from '../../components/documents/DocumentActionBar'
import { DocumentIcons } from '../../components/documents/documentIcons'
import { dateLabel, isoDate, stamp } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import { PURCHASE_ORDER, PURCHASE_STATUS_COLOURS, supplierLabel } from '../../components/purchase/purchaseKind'
import { LoadItemsDrawer } from '../../components/shortages/LoadItemsDrawer'
import { ShortageHeaderCard, type ShortageHeader, type ShortageHeaderErrors } from '../../components/shortages/ShortageHeaderCard'
import { ShortageLinesGrid } from '../../components/shortages/ShortageLinesGrid'
import { derive, lineFromDto, lineFromLiveRow, SHORTAGES_ROUTE, totalsOf, type ShortageLine } from '../../components/shortages/shortageMath'
import { ShortagePurchaseOrdersCard } from '../../components/shortages/ShortagePurchaseOrdersCard'
import { ShortageSummaryCard } from '../../components/shortages/ShortageSummaryCard'
import { confirm } from '../../components/ui/confirm'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { PERMISSIONS } from '../../navigation'

const DEFAULT_LEAD_TIME = 6
const DEFAULT_HISTORY = 3

/**
 * One shortage plan — the customer's study as a saved document.
 *
 * DRAFT IS A WORKING SHEET, POSTED IS A PHOTOGRAPH. A draft is edited, recalculated and deleted; its
 * figures are the live ones of its last save or recalculation, and between the two the grid works
 * the derived cells out itself as the planner types (the API's values win on the next save).
 * Posting freezes every figure: a posted plan shows what was true when it was posted, whatever
 * the stock has done since, and that is what purchase orders are created from.
 *
 * THE FIGURES ARE NEVER SENT. A save carries the items and the three things a planner types —
 * required quantity, manual monthly sales, PC per container. The server takes the rest itself.
 */
export function ShortageDocumentPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { hasPermission, user } = useAuth()

  const documentId = id && id !== 'new' ? Number(id) : null
  const isNew = documentId === null

  const canCreate = hasPermission(PERMISSIONS.shortagesCreate)
  const canPost = hasPermission(PERMISSIONS.shortagesPost)
  const canDelete = hasPermission(PERMISSIONS.shortagesDelete)
  const canOrder = hasPermission(PERMISSIONS.purchaseOrdersCreate)

  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [document, setDocument] = useState<ShortageDocumentDto | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseLookupDto[]>([])
  const [suppliers, setSuppliers] = useState<PartyLookupDto[]>([])
  const [families, setFamilies] = useState<ItemFamilyLookupDto[]>([])
  const [brands, setBrands] = useState<BrandLookupDto[]>([])

  const [header, setHeader] = useState<ShortageHeader>({
    description: '', documentDate: isoDate(new Date()), warehouseId: null, branchId: null, supplierId: null,
    leadTimeMonths: DEFAULT_LEAD_TIME, monthsOfHistory: DEFAULT_HISTORY, notes: '',
  })
  const [errors, setErrors] = useState<ShortageHeaderErrors>({})
  const [lines, setLines] = useState<ShortageLine[]>([])
  const [loadOpen, setLoadOpen] = useState(false)
  /** The warehouse or the history changed under lines that were counted with the old ones. */
  const [figuresStale, setFiguresStale] = useState(false)

  /** True once the reader picked a branch: a warehouse change then no longer moves it. */
  const branchTouched = useRef(false)
  const dirty = useRef(false)
  const markDirty = () => {
    dirty.current = true
  }

  const status = document?.status ?? 'Draft'
  const posted = status === 'Posted'
  const editable = !posted && canCreate && (isNew || document?.canEdit === true)
  const leadTime = header.leadTimeMonths ?? 0

  /* ── loading ──────────────────────────────────────────────────────────────────────────────── */

  useEffect(() => {
    branchesApi.lookup(false).then(setBranches).catch(() => notify.error('Branches could not be loaded.'))
    partiesApi.lookup({ partyType: 'Supplier', activeOnly: false }).then(setSuppliers).catch(() => notify.error('Suppliers could not be loaded.'))
    itemFamiliesApi.lookup().then(setFamilies).catch(() => {})
    brandsApi.lookup().then(setBrands).catch(() => {})
    warehousesApi
      .lookup(false)
      .then((rows) => {
        setWarehouses(rows)
        if (!isNew) return
        // A new plan opens on the main warehouse and that warehouse's branch.
        const main = rows.find((w) => w.isMainWarehouse && w.isActive) ?? rows.find((w) => w.isActive)
        if (main) setHeader((current) => (current.warehouseId === null ? { ...current, warehouseId: String(main.id), branchId: current.branchId ?? String(main.branchId) } : current))
      })
      .catch(() => notify.error('Warehouses could not be loaded.'))
    // isNew comes from the route; it does not change without a remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyDocument = useCallback((doc: ShortageDocumentDto) => {
    setDocument(doc)
    setHeader({
      description: doc.description,
      documentDate: doc.documentDate.slice(0, 10),
      warehouseId: String(doc.warehouseId),
      branchId: String(doc.branchId),
      supplierId: String(doc.supplierId),
      leadTimeMonths: doc.leadTimeMonths,
      monthsOfHistory: doc.monthsOfHistory,
      notes: doc.notes ?? '',
    })
    setLines(doc.lines.map((line) => lineFromDto(line, doc.status === 'Draft')))
    setErrors({})
    setFiguresStale(false)
    branchTouched.current = true
    dirty.current = false
  }, [])

  const reload = useCallback(async () => {
    if (documentId === null) return
    setLoading(true)
    try {
      applyDocument(await shortagesApi.get(documentId))
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : 'The shortage plan could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [documentId, applyDocument])

  useEffect(() => {
    void reload()
  }, [reload])

  /* ── header and lines ─────────────────────────────────────────────────────────────────────── */

  function changeHeader(patch: Partial<ShortageHeader>) {
    markDirty()
    const next = { ...patch }
    if (next.branchId !== undefined) branchTouched.current = true
    /* THE WAREHOUSE BRINGS ITS BRANCH, until the reader picks one: the order usually belongs where the stock is. */
    if (next.warehouseId && !branchTouched.current) {
      const warehouse = warehouses.find((w) => String(w.id) === next.warehouseId)
      if (warehouse) next.branchId = String(warehouse.branchId)
    }
    if (lines.length > 0 && ((next.warehouseId !== undefined && next.warehouseId !== header.warehouseId) || (next.monthsOfHistory !== undefined && next.monthsOfHistory !== header.monthsOfHistory))) {
      setFiguresStale(true)
    }
    setErrors({})
    setHeader((current) => ({ ...current, ...next }))
  }

  const patchLine = useCallback((key: string, patch: Partial<ShortageLine>) => {
    markDirty()
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch, error: undefined } : line)),
    )
  }, [])

  /* A quantity nobody typed FOLLOWS THE SUGGESTION: override the monthly sales or change the lead
     time and the required quantity moves with the shortage — until the planner types one. */
  const shownLines = useMemo(
    () =>
      lines.map((line) => {
        if (line.requiredManual || !editable) return line
        const suggested = derive(line, leadTime).suggestedRequiredQty
        return suggested === line.requiredQty ? line : { ...line, requiredQty: suggested }
      }),
    [lines, leadTime, editable],
  )

  function removeLine(key: string) {
    markDirty()
    setLines((current) => current.filter((line) => line.key !== key))
  }

  const existingItemIds = useMemo(() => new Set(lines.map((line) => line.itemId)), [lines])

  /** The orders this plan actually produced: a cancelled one ordered nothing. */
  const livePurchaseOrders = useMemo(
    () => (document?.purchaseOrders ?? []).filter((order) => order.status !== 'Cancelled'),
    [document],
  )

  function addLoaded(rows: ShortageLiveRowDto[]) {
    const fresh = rows.filter((row) => !existingItemIds.has(row.itemId))
    const skipped = rows.length - fresh.length
    if (fresh.length > 0) {
      markDirty()
      setLines((current) => [...current, ...fresh.map(lineFromLiveRow)])
      notify.success(`${formatNumber(fresh.length)} item(s) added.`)
    }
    if (skipped > 0) notify.info(`${formatNumber(skipped)} item(s) skipped: already on the plan.`)
  }

  const totals = useMemo(() => totalsOf(shownLines, leadTime), [shownLines, leadTime])

  /* ── saving ───────────────────────────────────────────────────────────────────────────────── */

  function validate(): boolean {
    const next: ShortageHeaderErrors = {}
    if (!header.description.trim()) next.description = 'Say what this plan is for.'
    if (!header.documentDate) next.documentDate = 'Choose a date.'
    if (!header.warehouseId) next.warehouseId = 'Choose a warehouse.'
    if (!header.branchId) next.branchId = 'Choose a branch.'
    if (!header.supplierId) next.supplierId = 'Choose a supplier.'
    if (header.leadTimeMonths === null || header.leadTimeMonths <= 0) next.leadTimeMonths = 'Enter a lead time above zero.'
    if (header.monthsOfHistory === null || header.monthsOfHistory < 1 || header.monthsOfHistory > 36) next.monthsOfHistory = 'Between 1 and 36.'
    setErrors(next)
    if (Object.keys(next).length > 0) {
      notify.error('Some header fields still need filling in.')
      return false
    }
    return true
  }

  function toRequest(): SaveShortageDocumentRequest {
    return {
      description: header.description.trim(),
      documentDate: header.documentDate,
      branchId: Number(header.branchId),
      warehouseId: Number(header.warehouseId),
      supplierId: Number(header.supplierId),
      leadTimeMonths: header.leadTimeMonths ?? DEFAULT_LEAD_TIME,
      monthsOfHistory: header.monthsOfHistory ?? DEFAULT_HISTORY,
      notes: header.notes.trim() || null,
      rowVersion: document?.rowVersion ?? null,
      // What is on the screen is what is saved: the quantity shown, typed or suggested.
      lines: shownLines.map((line, index) => ({
        lineNo: index + 1,
        itemId: line.itemId,
        requiredQty: line.requiredQty,
        expectedMonthlySalesManual: line.expectedMonthlySalesManual,
        pcPerContainer: line.pcPerContainer,
        notes: line.notes.trim() || null,
      })),
    }
  }

  function showApiError(error: unknown, fallback: string) {
    if (!(error instanceof ApiError)) {
      notify.error(fallback)
      return
    }
    setLines((current) => current.map((line) => ({ ...line, error: undefined })))
    const match = /^Line (\d+):/.exec(error.message)
    if (error.code === 'VALIDATION' && match) {
      const index = Number(match[1]) - 1
      setLines((current) => current.map((line, i) => (i === index ? { ...line, error: error.message } : line)))
    }
    notify.error(error.message)
    // Somebody else saved or posted it: what is on the screen is no longer the document.
    if (error.code === 'CONCURRENCY' || error.code === 'NOT_DRAFT') void reload()
  }

  async function saveDraft(): Promise<ShortageDocumentDto | null> {
    if (!validate()) return null
    setSaving(true)
    try {
      const saved = documentId === null ? await shortagesApi.create(toRequest()) : await shortagesApi.update(documentId, toRequest())
      applyDocument(saved)
      notify.success(documentId === null ? `Draft ${saved.documentNumber} created.` : 'Draft saved.')
      if (documentId === null) void navigate(`${SHORTAGES_ROUTE}/${saved.id}`, { replace: true })
      return saved
    } catch (error) {
      showApiError(error, 'The shortage plan could not be saved.')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function saveAndPost() {
    if (lines.length === 0) {
      notify.error('The plan has no lines. Load items before posting.')
      return
    }
    const saved = await saveDraft()
    if (!saved) return
    const go = await confirm({
      title: 'Post this shortage plan?',
      message: 'Post this shortage plan? The figures will be frozen as a historical snapshot.',
      confirmLabel: 'Post',
    })
    if (!go) return
    setSaving(true)
    try {
      applyDocument(await shortagesApi.post(saved.id, saved.rowVersion))
      notify.success(`Shortage plan ${saved.documentNumber} posted.`)
    } catch (error) {
      showApiError(error, 'The shortage plan could not be posted.')
    } finally {
      setSaving(false)
    }
  }

  async function recalculate() {
    if (!document) return
    let current: ShortageDocumentDto | null = document
    if (dirty.current) {
      const go = await confirm({
        title: 'Save your changes first?',
        message: 'Recalculate refreshes the SAVED draft with the live figures. Save your changes, then recalculate?',
        confirmLabel: 'Save & recalculate',
      })
      if (!go) return
      current = await saveDraft()
      if (!current) return
    }
    setSaving(true)
    try {
      applyDocument(await shortagesApi.recalculate(current.id, current.rowVersion))
      notify.success('Live figures refreshed. Required quantities, manual sales and PC per container were kept.')
    } catch (error) {
      showApiError(error, 'The shortage plan could not be recalculated.')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!document) return
    const go = await confirm({ title: 'Delete draft', message: `Delete ${document.documentNumber}? This cannot be undone.`, confirmLabel: 'Delete', danger: true })
    if (!go) return
    setSaving(true)
    try {
      await shortagesApi.remove(document.id)
      dirty.current = false
      notify.success('Draft deleted.')
      void navigate(SHORTAGES_ROUTE)
    } catch (error) {
      showApiError(error, 'The draft could not be deleted.')
    } finally {
      setSaving(false)
    }
  }

  /**
   * The plan becomes a purchase order — and says so when it already has one.
   *
   * NOTHING STOPS A SECOND ORDER, and nothing should: a plan split across two suppliers, or a first
   * order cancelled at the supplier's end, are ordinary. What is not ordinary is ordering the same
   * quantities twice by accident, so the orders this plan already produced are listed IN the
   * question rather than left for the reader to remember. A cancelled order is not listed: it
   * ordered nothing, and naming it would argue against a second order for no reason.
   */
  async function createPurchaseOrder() {
    if (!document) return

    const existing = livePurchaseOrders
    const go = await confirm({
      title: existing.length > 0 ? 'Create another purchase order' : 'Create purchase order',
      message:
        existing.length > 0 ? (
          <Stack gap="xs">
            <Text size="sm">
              This plan already has a purchase order. Create another one with the same quantities?
            </Text>
            <Stack gap={6}>
              {existing.map((order) => (
                <Group key={order.id} gap="xs" wrap="nowrap">
                  <Text size="sm" fw={500}>
                    {/* An order is numbered on saving, but a draft that has not been may still exist. */}
                    {order.documentNumber ?? `Draft, created ${dateLabel(order.createdAtUtc)}`}
                  </Text>
                  <Badge size="sm" variant="light" color={PURCHASE_STATUS_COLOURS[order.status] ?? 'gray'}>
                    {order.status}
                  </Badge>
                </Group>
              ))}
            </Stack>
          </Stack>
        ) : (
          `Create a purchase order draft for ${document.supplierName} from ${document.documentNumber}, with every line that has a required quantity?`
        ),
      confirmLabel: existing.length > 0 ? 'Create another' : 'Create',
    })
    if (!go) return
    setSaving(true)
    try {
      const order = await shortagesApi.createPurchaseOrder(document.id)
      notify.success(`Purchase order ${order.documentNumber ?? `draft #${order.id}`} created from ${document.documentNumber}.`)
      void navigate(`${PURCHASE_ORDER.route}/${order.id}`)
    } catch (error) {
      showApiError(error, 'The purchase order could not be created.')
    } finally {
      setSaving(false)
    }
  }

  async function exportToExcel() {
    if (!document) return
    try {
      await shortagesApi.exportToExcel(document.id, document.documentNumber)
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The shortage plan could not be exported.')
    }
  }

  /** The print view shows the SAVED plan, so unsaved changes are said before they go missing on paper. */
  function print() {
    if (!document) return
    if (dirty.current) {
      notify.info('Save the draft first: the print view shows the saved plan.')
      return
    }
    void navigate(`${SHORTAGES_ROUTE}/${document.id}/print`)
  }

  async function leave() {
    if (dirty.current) {
      const go = await confirm({ title: 'Leave without saving?', message: 'This shortage plan has changes that have not been saved. Leaving now discards them.', confirmLabel: 'Discard', danger: true })
      if (!go) return
    }
    void navigate(SHORTAGES_ROUTE)
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
        <PageHeader title="Shortage Plan" />
        <Alert color="red">{loadError}</Alert>
        <Group>
          <Button variant="default" onClick={() => void navigate(SHORTAGES_ROUTE)}>Back to Shortages</Button>
        </Group>
      </Stack>
    )
  }

  const warehouse = warehouses.find((w) => String(w.id) === header.warehouseId)
  const supplier = suppliers.find((s) => String(s.id) === header.supplierId)
  const canLoad = editable && warehouse !== undefined && leadTime > 0 && header.monthsOfHistory !== null
  const loadBlocked = warehouse === undefined ? 'Choose a warehouse first' : leadTime <= 0 ? 'Enter a lead time first' : 'Enter the months of history first'

  const actions: DocumentAction[] = posted
    ? [
        { key: 'print', label: 'Print', icon: <IconPrinter size={16} />, onClick: print },
        { key: 'export', label: 'Export to Excel', icon: DocumentIcons.exportFile, onClick: () => void exportToExcel() },
        { key: 'create-po', label: 'Create Purchase Order', icon: <IconShoppingCart size={16} />, variant: 'filled', colour: PURCHASE_ORDER.colour, visible: canOrder && document?.canCreatePurchaseOrder === true, loading: saving, onClick: () => void createPurchaseOrder() },
        { key: 'back', label: 'Back', icon: DocumentIcons.back, onClick: () => void navigate(SHORTAGES_ROUTE) },
      ]
    : [
        { key: 'save', label: 'Save Draft', icon: DocumentIcons.save, visible: editable, loading: saving, onClick: () => void saveDraft() },
        { key: 'post', label: 'Save & Post', icon: DocumentIcons.post, variant: 'filled', colour: 'green', visible: editable && canPost, loading: saving, onClick: () => void saveAndPost() },
        { key: 'recalculate', label: 'Recalculate', icon: <IconCalculator size={16} />, visible: editable && document !== null, disabled: saving, onClick: () => void recalculate() },
        { key: 'delete', label: 'Delete', icon: <IconTrash size={16} />, colour: 'red', visible: canDelete && document?.canDelete === true, disabled: saving, onClick: () => void remove() },
        { key: 'print', label: 'Print', icon: <IconPrinter size={16} />, visible: document !== null, onClick: print },
        { key: 'export', label: 'Export to Excel', icon: DocumentIcons.exportFile, visible: document !== null, onClick: () => void exportToExcel() },
        { key: 'create-po', label: 'Create Purchase Order', icon: <IconShoppingCart size={16} />, visible: canOrder, disabled: true, disabledReason: 'Post the plan first', onClick: () => {} },
        { key: 'back', label: 'Back', icon: DocumentIcons.back, onClick: () => void leave() },
      ]

  return (
    <Stack>
      <PageHeader title={isNew ? 'New Shortage' : `Shortage ${document?.documentNumber ?? ''}`} subtitle={isNew ? undefined : document?.description} />

      <DocumentActionBar actions={actions} />

      {document && posted && (
        <Alert color="green" title={`Posted — ${document.documentNumber}`} data-shortage-posted-banner>
          Posted by {document.postedByName ?? 'unknown'} on {stamp(document.postedAtUtc)} - historical snapshot, values are not recalculated.
        </Alert>
      )}

      {!posted && !editable && (
        <Alert color="gray">You can read this draft, but creating or editing shortage plans needs the inventory.shortages.create permission.</Alert>
      )}

      <ShortageHeaderCard
        value={header}
        onChange={changeHeader}
        branches={branches.filter((b) => b.isActive || String(b.id) === header.branchId)}
        warehouses={warehouses.filter((w) => w.isActive || String(w.id) === header.warehouseId)}
        suppliers={suppliers.filter((x) => x.isActive || String(x.id) === header.supplierId)}
        documentNumber={document?.documentNumber ?? null}
        status={status}
        createdByName={document ? document.createdByName : (user?.fullName ?? null)}
        createdAtUtc={document?.createdAtUtc ?? null}
        readOnly={!editable}
        errors={errors}
        disabled={saving}
      />

      {figuresStale && editable && (
        <Alert color="yellow" title="The lines were counted with the previous settings">
          The warehouse or the months of history changed. Current inventory, transit, outstanding orders and monthly sales on the
          lines below are still the old ones; saving the draft takes the live figures for the new settings.
        </Alert>
      )}

      <Paper radius="lg" p="md" withBorder>
        <Group justify="space-between" align="center" mb="sm" wrap="wrap">
          <div>
            <Title order={5}>Lines</Title>
            <Text fz="xs" c="dimmed">Quantities in base units; Required Qty in the purchase unit.</Text>
          </div>
          {editable && (
            <Group gap="xs">
              <Tooltip label={loadBlocked} disabled={canLoad} withArrow>
                <Button leftSection={<IconDownload size={16} />} {...(canLoad ? {} : { 'data-disabled': true })} onClick={(event) => (canLoad ? setLoadOpen(true) : event.preventDefault())} data-load-items>
                  Load items
                </Button>
              </Tooltip>
              <Button variant="default" leftSection={<IconCalculator size={16} />} disabled={document === null || saving} onClick={() => void recalculate()}>
                Recalculate
              </Button>
            </Group>
          )}
        </Group>

        <ShortageLinesGrid lines={shownLines} leadTimeMonths={leadTime} onChange={patchLine} onRemove={removeLine} readOnly={!editable} />
      </Paper>

      <Grid>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Stack>
            <ShortagePurchaseOrdersCard orders={document?.purchaseOrders ?? []} />
            <AuditTrail entries={document?.audit ?? []} />
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <ShortageSummaryCard
            totals={posted && document
              ? { items: document.totalLines, totalShortageBase: document.totalShortageBase, totalRequiredBase: document.totalRequiredBase, containers: document.totalContainers, containersRounded: document.containersRounded, utilizationPct: document.containerUtilizationPct }
              : totals}
            calculatedAtUtc={document?.calculatedAtUtc ?? null}
          />
        </Grid.Col>
      </Grid>

      {canLoad && warehouse && (
        <LoadItemsDrawer
          opened={loadOpen}
          onClose={() => setLoadOpen(false)}
          context={{
            warehouseId: warehouse.id,
            warehouseName: warehouse.warehouseName,
            supplierId: supplier ? supplier.id : null,
            supplierName: supplier ? supplierLabel(supplier) : '',
            leadTimeMonths: leadTime,
            monthsOfHistory: header.monthsOfHistory ?? DEFAULT_HISTORY,
          }}
          families={families}
          brands={brands}
          existingItemIds={existingItemIds}
          onAdd={addLoaded}
        />
      )}
    </Stack>
  )
}
