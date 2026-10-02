import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { routes } from '../../routes'
import {
  Alert,
  Anchor,
  Button,
  Badge,
  Grid,
  Group,
  Loader,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useForm } from '@mantine/form'
import {
  IconArrowBackUp,
  IconArrowLeft,
  IconBan,
  IconCheck,
  IconDeviceFloppy,
  IconFileSpreadsheet,
  IconLock,
  IconLockOpen,
  IconPrinter,
  IconTrash,
  IconTruckDelivery,
} from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import {
  containersApi,
  containerStatusColour,
  SHIPPING_METHODS,
  type ContainerDto,
  type OffloadRequest,
} from '../../api/logistics/containers'
import { branchesApi } from '../../api/masterdata/branches'
import { containerTypesApi, type ContainerTypeLookupDto } from '../../api/masterdata/containerTypes'
import { partiesApi } from '../../api/masterdata/parties'
import { portLabel, portsApi, type PortLookupDto } from '../../api/masterdata/ports'
import { warehousesApi } from '../../api/masterdata/warehouses'
import type { CreatedPurchaseInvoiceDto } from '../../api/purchase/documents'
import type { BranchLookupDto, PartyLookupDto, WarehouseLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { AuditTrail } from '../../components/documents/AuditTrail'
import { CancelReasonModal } from '../../components/documents/CancelReasonModal'
import { DocumentActionBar, type DocumentAction } from '../../components/documents/DocumentActionBar'
import { dateLabel, stamp } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import { AddPoLinesModal } from '../../components/logistics/AddPoLinesModal'
import { ContainerCapacityCard } from '../../components/logistics/ContainerCapacityCard'
import { ContainerChargesCard } from '../../components/logistics/ContainerChargesCard'
import { ContainerCostCard } from '../../components/logistics/ContainerCostCard'
import { ContainerDocumentsCard } from '../../components/logistics/ContainerDocumentsCard'
import {
  capacityOf,
  emptyValues,
  fromContainerLine,
  lastFreeDay,
  lineOil,
  orderMonthLabel,
  toRequest,
  toValues,
  type ContainerFormValues,
  type LoadLine,
} from '../../components/logistics/containerForm'
import { ContainerInvoicesCard } from '../../components/logistics/ContainerInvoicesCard'
import { ContainerRouteMapCard } from '../../components/logistics/ContainerRouteMapCard'
import { ContainerRouteTimeline } from '../../components/logistics/ContainerRouteTimeline'
import { InvoiceFromContainersModal } from '../../components/logistics/InvoiceFromContainersModal'
import { CreatedInvoicesModal } from '../../components/purchase/CreatedInvoicesModal'
import { LoadedItemsSection } from '../../components/logistics/LoadedItemsSection'
import { OffloadModal } from '../../components/logistics/OffloadModal'
import { supplierLabel } from '../../components/purchase/purchaseKind'
import { confirm } from '../../components/ui/confirm'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { COUNTRIES, countryLabel } from '../../data/countries'
import { PERMISSIONS } from '../../navigation'
import { CONTAINERS_ROUTE } from './ContainersPage'

type ReasonDialog = 'cancel' | 'cancelOffload' | null

/** "Line 2: ..." -> 2, so the message lands on the row the server judged. */
function lineNumberOf(message: string): number | null {
  const match = /^Line (\d+):/.exec(message)
  return match ? Number(match[1]) : null
}

/**
 * One container: the seven sections of the customer's form, the route, the capacity and the audit.
 *
 * THE STATUS DECIDES THE MODE. Up to Cleared the container is a form (the loading plan and the route
 * can still change); offloaded, closed and cancelled containers are records and every field is text.
 * Every action answers with the whole container, so the page never guesses the status it moved to.
 */
export function ContainerPage() {
  const { id } = useParams<{ id: string }>()
  const isNew = id === undefined || id === 'new'
  const containerId = isNew ? null : Number(id)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { hasPermission } = useAuth()

  const perm = {
    create: hasPermission(PERMISSIONS.containersCreate),
    confirm: hasPermission(PERMISSIONS.containersConfirm),
    offload: hasPermission(PERMISSIONS.containersOffload),
    cancel: hasPermission(PERMISSIONS.containersCancel),
    close: hasPermission(PERMISSIONS.containersClose),
    delete: hasPermission(PERMISSIONS.containersDelete),
    overCapacity: hasPermission(PERMISSIONS.containersOverCapacity),
    invoice: hasPermission(PERMISSIONS.purchaseInvoicesCreate),
    movements: hasPermission(PERMISSIONS.movementsManage),
    attachments: hasPermission(PERMISSIONS.containerAttachmentsManage),
  }

  const [container, setContainer] = useState<ContainerDto | null>(null)
  const [loading, setLoading] = useState(!isNew)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lines, setLines] = useState<LoadLine[]>([])
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({})
  const [stale, setStale] = useState<string | null>(null)

  const [types, setTypes] = useState<ContainerTypeLookupDto[]>([])
  const [ports, setPorts] = useState<PortLookupDto[]>([])
  const [suppliers, setSuppliers] = useState<PartyLookupDto[]>([])
  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseLookupDto[]>([])

  const [saving, setSaving] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [addItemsOpen, setAddItemsOpen] = useState(false)
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  /** Several invoices made at once (one per item): listed rather than one of them opened. */
  const [createdInvoices, setCreatedInvoices] = useState<{ invoices: CreatedPurchaseInvoiceDto[]; orderIds: number[] } | null>(null)
  const [offloadOpen, setOffloadOpen] = useState(false)
  const [offloadError, setOffloadError] = useState<string | null>(null)
  const [reasonDialog, setReasonDialog] = useState<ReasonDialog>(null)

  const dirty = useRef(false)
  const markDirty = () => {
    dirty.current = true
  }

  const form = useForm<ContainerFormValues>({
    initialValues: emptyValues(null),
    onValuesChange: markDirty,
    validate: {
      containerTypeId: (value) => (value ? null : 'Container Type is required.'),
      orderDate: (value) => (value ? null : 'Order Date is required.'),
      branchId: (value) => (value ? null : 'Branch is required.'),
      eta: (value, values) =>
        value && values.dispatchDate && value < values.dispatchDate ? 'The ETA cannot be before the dispatch date.' : null,
    },
  })

  /** Puts a server answer on the page: header, invoices, lines. Everything typed is replaced. */
  const show = useCallback(
    (dto: ContainerDto) => {
      setContainer(dto)
      form.setValues(toValues(dto))
      form.resetDirty(toValues(dto))
      setLines(dto.lines.map(fromContainerLine))
      setLineErrors({})
      setStale(null)
      dirty.current = false
    },
    // form is stable for the life of the page; listing it would re-create show on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const load = useCallback(async () => {
    if (containerId === null) return
    setLoading(true)
    setLoadError(null)
    try {
      show(await containersApi.get(containerId))
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'The container could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [containerId, show])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    containerTypesApi.lookup(false).then(setTypes).catch(() => {})
    portsApi.lookup(false).then(setPorts).catch(() => {})
    partiesApi.lookup({ partyType: 'Supplier', activeOnly: false }).then(setSuppliers).catch(() => {})
    warehousesApi.lookup(false).then(setWarehouses).catch(() => {})
    branchesApi
      .lookup(false)
      .then((list) => {
        setBranches(list)
        // A new container starts in the main branch, like every document.
        if (isNew && !form.values.branchId) {
          const main = list.find((b) => b.isMainBranch && b.isActive) ?? list.find((b) => b.isActive)
          if (main) {
            form.setFieldValue('branchId', String(main.id))
            form.resetDirty()
            dirty.current = false
          }
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew])

  // The tab close React Router never sees.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // ?offload=1 from the list: open the offload as soon as the container says it can be.
  useEffect(() => {
    if (container && searchParams.get('offload') === '1') {
      if (container.canOffload && perm.offload) setOffloadOpen(true)
      setSearchParams({}, { replace: true })
    }
  }, [container, searchParams, setSearchParams, perm.offload])

  const readOnly = !perm.create || (container !== null && !container.canEdit)
  const values = form.values
  const capacity = capacityOf(values.maxUnits, lines)
  const totalOil = lines.reduce((sum, line) => sum + lineOil(line), 0)
  const type = types.find((t) => String(t.id) === values.containerTypeId) ?? null
  const freeDay = lastFreeDay(values.actualPortArrival, values.freeDays)
  const freeDayPassed = freeDay !== null && container !== null && [4, 5].includes(container.status) && freeDay < new Date().toISOString().slice(0, 10)
  const suppliersOnBoard = useMemo(() => [...new Set(lines.map((l) => l.supplierName))], [lines])
  /** Travelled with a movement: the four milestone dates are the movements', shown read-only. */
  const datesLocked = container?.datesFromMovements === true

  /* ── options ─────────────────────────────────────────────────────────────────────────────── */

  const typeOptions = types
    .filter((t) => t.isActive || String(t.id) === values.containerTypeId)
    .map((t) => ({ value: String(t.id), label: `${t.typeCode} - ${t.typeName}` }))
  const portOptions = ports
    .filter((p) => p.isActive || [values.portOfLoadingId, values.portOfDestinationId, values.finalDestinationId].includes(String(p.id)))
    .map((p) => ({ value: String(p.id), label: portLabel(p) }))
  const supplierOptions = suppliers.map((s) => ({ value: String(s.id), label: supplierLabel(s) }))
  const branchOptions = branches.map((b) => ({ value: String(b.id), label: `${b.branchCode} - ${b.branchName}` }))
  const branchWarehouses = warehouses.filter((w) => values.branchId !== null && String(w.branchId) === values.branchId)
  const warehouseOptions = branchWarehouses.map((w) => ({ value: String(w.id), label: `${w.warehouseCode} - ${w.warehouseName}` }))
  const countryOptions = useMemo(() => COUNTRIES.map((c) => ({ value: c.code, label: countryLabel(c) })), [])

  /* ── fields: an input on a form, text on a record ────────────────────────────────────────── */

  const optionLabel = (options: { value: string; label: string }[], value: string | null) =>
    options.find((o) => o.value === value)?.label ?? null

  function textField(key: keyof ContainerFormValues, label: string, maxLength: number, placeholder?: string) {
    if (readOnly) return <ViewField label={label} value={(values[key] as string) || null} />
    return <TextInput label={label} maxLength={maxLength} placeholder={placeholder} {...form.getInputProps(key)} />
  }

  function dateField(key: keyof ContainerFormValues, label: string, required = false, fromMovements = false) {
    if (readOnly || fromMovements) {
      return <ViewField label={label} value={values[key] ? dateLabel(values[key] as string) : null} hint={fromMovements ? 'from the movements' : undefined} />
    }
    return (
      <DateInput
        label={label}
        withAsterisk={required}
        valueFormat="DD/MM/YYYY"
        clearable={!required}
        value={(values[key] as string | null) ?? null}
        onChange={(next) => form.setFieldValue(key, next ? String(next).slice(0, 10) : null)}
        error={form.errors[key]}
      />
    )
  }

  function numberField(key: keyof ContainerFormValues, label: string, decimals = 0) {
    if (readOnly) {
      const value = values[key]
      return <ViewField label={label} value={value === '' ? null : formatNumber(Number(value), decimals)} />
    }
    return <NumberInput label={label} min={0} decimalScale={decimals} allowDecimal={decimals > 0} thousandSeparator="," {...form.getInputProps(key)} />
  }

  function selectField(
    key: keyof ContainerFormValues,
    label: string,
    options: { value: string; label: string }[],
    extra: { required?: boolean; onPick?: (value: string | null) => void; placeholder?: string } = {},
  ) {
    const value = values[key] as string | null
    if (readOnly) return <ViewField label={label} value={optionLabel(options, value)} />
    return (
      <Select
        label={label}
        placeholder={extra.placeholder}
        withAsterisk={extra.required}
        data={options}
        searchable
        clearable={!extra.required}
        nothingFoundMessage="Nothing matches"
        value={value}
        onChange={(next) => {
          form.setFieldValue(key, next)
          extra.onPick?.(next)
        }}
        error={form.errors[key]}
      />
    )
  }

  /* ── saving ──────────────────────────────────────────────────────────────────────────────── */

  async function save(allowOverCapacity = false): Promise<ContainerDto | null> {
    if (form.validate().hasErrors) {
      notify.error('Check the highlighted fields.')
      return null
    }
    if (lines.some((line) => line.quantity < 1)) {
      notify.error('Every loaded line needs a quantity of at least 1 - or remove the line.')
      return null
    }

    // Over capacity: a warning, never a block — but confirming it is a right. Without it the save
    // goes as it is and the server's 409 says why.
    if (capacity.over && !allowOverCapacity && perm.overCapacity) {
      const go = await confirm({
        title: 'Load above capacity?',
        message: `The container holds ${formatNumber(capacity.maxUnits)} units and ${formatNumber(capacity.allocated)} are allocated (${formatNumber(capacity.utilization, 0)} %). Save it above its capacity?`,
        confirmLabel: 'Save over capacity',
      })
      if (!go) return null
      allowOverCapacity = true
    }

    setSaving(true)
    setLineErrors({})
    try {
      const payload = toRequest(values, lines, allowOverCapacity, container?.rowVersion ?? null, container?.statusNote ?? null)
      const saved = containerId === null ? await containersApi.create(payload) : await containersApi.update(containerId, payload)
      show(saved)
      notify.success(containerId === null ? `Container ${saved.containerRef} created.` : `${saved.containerRef} saved.`)
      if (containerId === null) void navigate(`${CONTAINERS_ROUTE}/${saved.id}`, { replace: true })
      return saved
    } catch (err) {
      if (!(err instanceof ApiError)) {
        notify.error('The container could not be saved.')
        return null
      }
      if (err.code === 'OVER_CAPACITY') {
        const canOverride = (err.data as { canOverride?: boolean } | null)?.canOverride === true
        if (canOverride && !allowOverCapacity) {
          const go = await confirm({ title: 'Load above capacity?', message: err.message, confirmLabel: 'Save over capacity' })
          if (go) {
            setSaving(false)
            return save(true)
          }
          return null
        }
        notify.error(err.message)
        return null
      }
      if (err.code === 'CONCURRENCY') {
        setStale(err.message)
        return null
      }
      const line = lineNumberOf(err.message)
      if (line !== null) setLineErrors({ [line]: err.message })
      if (err.code === 'DUPLICATE_CONTAINER_NO') form.setErrors({ containerNo: err.message })
      if (err.code === 'LINE_INVOICED' && line === null) {
        // "Line 1: TVS-AP160 - 60 already invoiced…" names the container line; mark it by item code.
        const item = /^Line \d+: (\S+)/.exec(err.message)?.[1]
        const index = lines.findIndex((l) => l.itemCode === item)
        if (index >= 0) setLineErrors({ [index + 1]: err.message })
      }
      notify.error(err.message)
      return null
    } finally {
      setSaving(false)
    }
  }

  /** Runs an action that answers with the container; unsaved edits are saved (or given up) first. */
  async function act(key: string, run: (current: ContainerDto) => Promise<ContainerDto>, success: (dto: ContainerDto) => string) {
    let current = container
    if (!current) return
    if (dirty.current) {
      const go = await confirm({ title: 'Unsaved changes', message: 'Save your changes first?', confirmLabel: 'Save and continue' })
      if (!go) return
      current = await save()
      if (!current) return
    }
    setBusyAction(key)
    try {
      const result = await run(current)
      show(result)
      notify.success(success(result))
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONCURRENCY') setStale(err.message)
      notify.error(err instanceof ApiError ? err.message : 'The action could not be completed.')
      throw err
    } finally {
      setBusyAction(null)
    }
  }

  const quiet = (promise: Promise<void>) => promise.catch(() => {})

  async function confirmPlan() {
    const go = await confirm({
      title: `Confirm ${container?.containerRef}`,
      message: 'Confirm the loading plan? The route can then be recorded.',
      confirmLabel: 'Confirm',
    })
    if (go) await quiet(act('confirm', (c) => containersApi.confirm(c.id, c.rowVersion), (d) => `${d.containerRef} confirmed.`))
  }

  async function offload(request: Omit<OffloadRequest, 'rowVersion'>) {
    if (!container) return
    setOffloadError(null)
    setBusyAction('offload')
    try {
      const result = await containersApi.offload(container.id, { ...request, rowVersion: container.rowVersion })
      show(result)
      setOffloadOpen(false)
      const received = result.lines
        .filter((l) => (l.receivedQuantityBase ?? 0) > 0)
        .map((l) => `${formatNumber(l.receivedQuantityBase)} × ${l.itemCode}`)
        .join(', ')
      notify.success(`Stock received into ${result.warehouseCode ?? 'the warehouse'}: ${received || 'nothing'}.`)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'The container could not be offloaded.'
      // NOT_FULLY_INVOICED, INVALID_STATUS (a movement in progress): said as a notification, the form stays.
      notify.error(message)
      setOffloadError(message)
    } finally {
      setBusyAction(null)
    }
  }

  async function reasonConfirmed(reason: string) {
    const dialog = reasonDialog
    if (!container || !dialog) return
    try {
      await act(
        dialog,
        (c) => (dialog === 'cancel' ? containersApi.cancel(c.id, reason, c.rowVersion) : containersApi.cancelOffload(c.id, reason, c.rowVersion)),
        (d) => (dialog === 'cancel' ? `${d.containerRef} cancelled.` : `Offload reversed - ${d.containerRef} is ${d.statusName} again.`),
      )
      setReasonDialog(null)
    } catch {
      // the notify already said why; the dialog stays open to try again
    }
  }

  async function close() {
    const go = await confirm({ title: `Close ${container?.containerRef}`, message: 'Close this offloaded container? It can no longer be reversed.', confirmLabel: 'Close container' })
    if (go) await quiet(act('close', (c) => containersApi.close(c.id, c.rowVersion), (d) => `${d.containerRef} closed.`))
  }

  async function reopen() {
    const go = await confirm({ title: `Reopen ${container?.containerRef}`, message: 'Reopen this closed container? It goes back to Offloaded, so a late charge can be added.', confirmLabel: 'Reopen' })
    if (go) await quiet(act('reopen', (c) => containersApi.reopen(c.id, c.rowVersion), (d) => `${d.containerRef} reopened.`))
  }

  async function remove() {
    if (!container) return
    const go = await confirm({ title: 'Delete container', message: `Delete draft ${container.containerRef}? This cannot be undone.`, confirmLabel: 'Delete', danger: true })
    if (!go) return
    try {
      await containersApi.remove(container.id)
      dirty.current = false
      notify.success('Container deleted.')
      void navigate(CONTAINERS_ROUTE)
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The container could not be deleted.')
    }
  }

  async function exportXlsx() {
    if (!container) return
    try {
      await containersApi.exportToExcel(container.id, container.containerRef)
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The container could not be exported.')
    }
  }

  async function back() {
    if (dirty.current) {
      const go = await confirm({ title: 'Leave without saving?', message: 'Your changes will be lost.', confirmLabel: 'Leave', danger: true })
      if (!go) return
    }
    dirty.current = false
    void navigate(CONTAINERS_ROUTE)
  }

  /* ── render ──────────────────────────────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    )
  }

  if (loadError) {
    return (
      <Alert color="red" title="Could not load the container">
        {loadError}{' '}
        <Anchor component="button" onClick={() => void load()}>
          Try again
        </Anchor>
      </Alert>
    )
  }

  // A CONTAINER IS CREATED FROM ITS ORDER: "Add Container…" on an approved purchase order.
  if (isNew) {
    return (
      <div>
        <PageHeader title="New Container" subtitle="Containers are created from an approved purchase order." />
        <Alert color="blue" title="Start from the purchase order">
          <Stack gap="sm" align="flex-start">
            <Text fz="sm">
              Open an approved purchase order and use <b>Add Container…</b>: the container is loaded with the order's lines, in pieces.
            </Text>
            <Button component={Link} to={routes.purchaseOrders} variant="light">
              Go to Purchase Orders
            </Button>
          </Stack>
        </Alert>
      </div>
    )
  }

  const saved = container !== null
  const actions: DocumentAction[] = [
    { key: 'back', label: 'Back', icon: <IconArrowLeft size={16} />, onClick: () => void back(), variant: 'default' },
    { key: 'print', label: 'Print', icon: <IconPrinter size={16} />, onClick: () => window.print(), variant: 'default', visible: saved },
    { key: 'export', label: 'Export', icon: <IconFileSpreadsheet size={16} />, onClick: () => void exportXlsx(), variant: 'default', visible: saved },
    { key: 'delete', label: 'Delete', icon: <IconTrash size={16} />, onClick: () => void remove(), variant: 'default', colour: 'red', visible: saved && container.canDelete && perm.delete },
    { key: 'cancel', label: 'Cancel', icon: <IconBan size={16} />, onClick: () => setReasonDialog('cancel'), variant: 'default', colour: 'red', visible: saved && container.canCancel && perm.cancel },
    { key: 'cancelOffload', label: 'Cancel Offload', icon: <IconArrowBackUp size={16} />, onClick: () => setReasonDialog('cancelOffload'), variant: 'default', colour: 'orange', visible: saved && container.canCancelOffload && perm.cancel },
    { key: 'close', label: 'Close', icon: <IconLock size={16} />, onClick: () => void close(), variant: 'light', loading: busyAction === 'close', visible: saved && container.canClose && perm.close },
    { key: 'reopen', label: 'Reopen', icon: <IconLockOpen size={16} />, onClick: () => void reopen(), variant: 'light', loading: busyAction === 'reopen', visible: saved && container.canReopen && perm.close },
    { key: 'offload', label: 'Offload', icon: <IconTruckDelivery size={16} />, onClick: () => setOffloadOpen(true), variant: 'light', colour: 'green', visible: saved && container.canOffload && perm.offload },
    { key: 'confirm', label: 'Confirm', icon: <IconCheck size={16} />, onClick: () => void confirmPlan(), variant: 'light', loading: busyAction === 'confirm', visible: saved && container.canConfirm && perm.confirm },
    { key: 'save', label: 'Save', icon: <IconDeviceFloppy size={16} />, onClick: () => void save(), variant: 'filled', loading: saving, visible: !readOnly },
  ]

  const title = container ? `Container ${container.containerRef}` : 'New Container'

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={
          container
            ? `${container.containerTypeCode} · ${container.currentLocation ?? 'Location not recorded yet'}`
            : 'The reference is assigned when the container is first saved.'
        }
        actions={container ? <Badge size="lg" color={containerStatusColour(container.status)} variant={container.status === 7 ? 'filled' : 'light'}>{container.statusName}</Badge> : undefined}
      />

      {stale ? (
        <Alert color="orange" mb="md" title="Changed by someone else">
          {stale}{' '}
          <Anchor component="button" onClick={() => void load()}>
            Reload
          </Anchor>
        </Alert>
      ) : null}

      {container && container.status >= 6 ? (
        <Alert color={container.status === 8 ? 'red' : 'green'} mb="md">
          {container.status === 8
            ? `Cancelled ${stamp(container.cancelledAtUtc)} by ${container.cancelledByName ?? '—'}: ${container.cancelReason ?? ''}`
            : `Offloaded into ${container.warehouseName ?? '—'} on ${dateLabel(container.offloadedDate)} by ${container.offloadedByName ?? '—'}. The container is read-only${container.status === 7 ? ' and closed' : ''}.`}
        </Alert>
      ) : null}
      {container?.statusNote && container.status < 6 ? (
        <Alert color="gray" mb="md">
          {container.statusNote}
        </Alert>
      ) : null}

      <Grid gap="md">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack gap="md">
            <Section title="1. Identification">
              <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
                <ViewField label="Container Ref." value={container?.containerRef ?? 'Assigned on save'} dimmed={!container} />
                {textField('containerNo', 'Container No.', 20, 'MSKU1234567')}
                {selectField('containerTypeId', 'Container Type', typeOptions, {
                  required: true,
                  onPick: (next) => {
                    const picked = types.find((t) => String(t.id) === next)
                    if (picked?.maxUnits) form.setFieldValue('maxUnits', picked.maxUnits)
                  },
                })}
                {textField('sealNo', 'Seal No.', 30)}
                {textField('customsSealNo', 'Customs Seal No.', 30)}
                <ViewField label="Status" value={container?.statusName ?? 'Draft (not saved)'} />
              </SimpleGrid>
              {readOnly ? (
                <ViewField label="Description" value={values.description || null} />
              ) : (
                <Textarea label="Description" autosize minRows={2} maxLength={500} mt="sm" {...form.getInputProps('description')} />
              )}
            </Section>

            <Section title="2. Order and suppliers">
              <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
                {dateField('orderDate', 'Order Date', true)}
                <ViewField label="Order Month" value={orderMonthLabel(values.orderDate)} />
                {selectField('shippingMethod', 'Shipping Method', SHIPPING_METHODS.map((m) => ({ value: m, label: m })), { required: true })}
                {selectField('countryOfOrigin', 'Country of Origin', countryOptions)}
                {selectField('forwarderId', 'Forwarder', supplierOptions)}
                {selectField('transporterId', 'Transporter', supplierOptions)}
                {selectField('branchId', 'Branch', branchOptions, { required: true, onPick: () => form.setFieldValue('warehouseId', null) })}
                <div>
                  <Text fz="sm" fw={500} mb={2}>
                    Purchase Order
                  </Text>
                  {container?.purchaseOrderId ? (
                    <Anchor component={Link} to={routes.purchaseOrder(container.purchaseOrderId)} fz="sm" fw={600}>
                      {container.purchaseOrderNumber ?? `#${container.purchaseOrderId}`}
                    </Anchor>
                  ) : (
                    <Text fz="sm" c="dimmed">—</Text>
                  )}
                </div>
              </SimpleGrid>
              <Text fz="sm" c="dimmed" mt="sm" mb={4}>
                Suppliers (from the loaded order lines)
              </Text>
              <Group gap="xs">
                {suppliersOnBoard.length === 0 ? (
                  <Text fz="sm" c="dimmed">
                    None yet - add items from a purchase order.
                  </Text>
                ) : (
                  suppliersOnBoard.map((name) => (
                    <Badge key={name} variant="outline" color="gray" size="lg">
                      {name}
                    </Badge>
                  ))
                )}
              </Group>
            </Section>

            <Section title="3. Shipping">
              <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
                {textField('shippingLine', 'Line / Carrier', 100)}
                {textField('vesselName', 'Vessel', 100)}
                {textField('voyageNo', 'Voyage', 30)}
                {textField('bookingNo', 'Booking No.', 30)}
                {selectField('portOfLoadingId', 'Port of Loading', portOptions)}
                {selectField('portOfDestinationId', 'Port of Destination', portOptions)}
                {selectField('finalDestinationId', 'Final Destination', portOptions)}
                {dateField('dispatchDate', 'Dispatch Date', false, datesLocked)}
                {dateField('eta', 'ETA')}
                {numberField('freeDays', 'Free days')}
                <div>
                  <ViewField label="Last free day" value={freeDay ? dateLabel(freeDay) : null} colour={freeDayPassed ? 'red' : undefined} />
                  {freeDayPassed ? (
                    <Badge color="red" variant="filled" size="sm" mt={4}>
                      Free time over
                    </Badge>
                  ) : null}
                </div>
                {numberField('grossWeightKg', 'Gross weight (kg)', 3)}
                {numberField('volumeCbm', 'CBM', 3)}
                {numberField('packages', 'Packages')}
              </SimpleGrid>
            </Section>

            <Section title="4. Bill of Lading">
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                {textField('blNo', 'B/L No.', 30)}
                {dateField('blDate', 'B/L Date')}
              </SimpleGrid>
              {readOnly ? (
                <ViewField label="B/L Notes" value={values.blNotes || null} />
              ) : (
                <Textarea label="B/L Notes" autosize minRows={2} maxLength={500} mt="sm" {...form.getInputProps('blNotes')} />
              )}
            </Section>

            <LoadedItemsSection
              lines={lines}
              editable={!readOnly}
              onAddItems={() => setAddItemsOpen(true)}
              onLinesChange={(next) => {
                setLines(next)
                setLineErrors({})
                markDirty()
              }}
              lineErrors={lineErrors}
              baseCurrencyCode="USD"
            />

            {container ? (
              <ContainerInvoicesCard
                invoices={container.invoices}
                canInvoice={container.canInvoice && perm.invoice}
                onCreate={() => setInvoiceOpen(true)}
              />
            ) : null}

            {container ? <ContainerChargesCard container={container} onChanged={() => void load()} /> : null}

            <Section title="6. Operational information">
              <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
                {textField('truckNo', 'Truck No.', 30)}
                {textField('waybillNo', 'Waybill No.', 30)}
                {textField('declarationNo', 'Declaration No.', 30)}
                {textField('feriNo', 'FERI No.', 30)}
                {dateField('actualPortArrival', 'Actual Port Arrival', false, datesLocked)}
                {dateField('borderCrossingDate', 'Border Crossing', false, datesLocked)}
                {dateField('customsReleaseDate', 'Customs Release Date', false, datesLocked)}
                {selectField('warehouseId', 'Warehouse (offloading destination)', warehouseOptions, { placeholder: values.branchId ? 'Pick a warehouse' : 'Pick the branch first' })}
                <ViewField label="Offloaded Date" value={container?.offloadedDate ? dateLabel(container.offloadedDate) : null} />
              </SimpleGrid>
              {readOnly ? (
                <ViewField label="Notes" value={values.notes || null} />
              ) : (
                <Textarea label="Notes" autosize minRows={2} maxLength={1000} mt="sm" {...form.getInputProps('notes')} />
              )}
            </Section>

            {container ? (
              <ContainerDocumentsCard container={container} canManage={perm.attachments && container.status !== 8} onChanged={() => void load()} />
            ) : null}
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Stack gap="md">
            <ContainerCapacityCard
              typeLabel={type ? `${type.typeCode} - ${type.typeName}` : null}
              capacity={capacity}
              maxUnits={values.maxUnits}
              onMaxUnitsChange={(next) => form.setFieldValue('maxUnits', next)}
              typeMaxUnits={type?.maxUnits ?? null}
              readOnly={readOnly}
              totalOil={totalOil}
            />
            {container ? <ContainerCostCard container={container} baseCurrencyCode="USD" /> : null}
            {/* Keyed on the movements, so the map reloads when the route changes. */}
            {container ? (
              <ContainerRouteMapCard key={container.movements.map((m) => `${m.movementId}:${m.status}`).join(',')} containerId={container.id} />
            ) : null}
            {container ? (
              <ContainerRouteTimeline container={container} canManage={perm.movements && container.status < 6} onChanged={() => void load()} />
            ) : null}
            {container ? (
              <Paper radius="lg" p="md" withBorder>
                <Title order={5} mb="sm">
                  Audit trail
                </Title>
                <AuditTrail entries={container.audit} />
              </Paper>
            ) : null}
          </Stack>
        </Grid.Col>
      </Grid>

      <div className="no-print" style={{ marginTop: 'var(--mantine-spacing-md)' }}>
        <DocumentActionBar actions={actions} />
      </div>

      {addItemsOpen ? (
        <AddPoLinesModal
          opened
          onClose={() => setAddItemsOpen(false)}
          containerId={containerId}
          loadedPoLineIds={lines.map((l) => l.poLineId)}
          onAdd={(added) => {
            setLines((current) => [...current, ...added])
            setAddItemsOpen(false)
            markDirty()
          }}
        />
      ) : null}

      {invoiceOpen && container ? (
        <InvoiceFromContainersModal
          opened
          onClose={() => setInvoiceOpen(false)}
          containerId={container.id}
          onCreated={(invoices, orderIds) => {
            setInvoiceOpen(false)
            if (invoices.length === 1) void navigate(routes.purchaseInvoice(invoices[0].id))
            else setCreatedInvoices({ invoices, orderIds })
          }}
        />
      ) : null}

      {createdInvoices ? (
        <CreatedInvoicesModal
          opened
          invoices={createdInvoices.invoices}
          onClose={() => setCreatedInvoices(null)}
          onGoToOrder={
            createdInvoices.orderIds.length === 1
              ? () => void navigate(routes.purchaseOrder(createdInvoices.orderIds[0]))
              : undefined
          }
        />
      ) : null}

      {offloadOpen && container ? (
        <OffloadModal
          opened
          onClose={() => setOffloadOpen(false)}
          lines={lines}
          warehouses={warehouses.filter((w) => w.isActive && w.branchId === container.branchId)}
          defaultWarehouseId={container.warehouseId}
          busy={busyAction === 'offload'}
          error={offloadError}
          onSubmit={(request) => void offload(request)}
          fullyInvoiced={container.isFullyInvoiced}
        />
      ) : null}

      <CancelReasonModal
        opened={reasonDialog !== null}
        onClose={() => setReasonDialog(null)}
        documentLabel={reasonDialog === 'cancelOffload' ? `the offload of ${container?.containerRef ?? ''}` : (container?.containerRef ?? '')}
        busy={busyAction === 'cancel' || busyAction === 'cancelOffload'}
        onConfirm={(reason) => void reasonConfirmed(reason)}
        confirmLabel={reasonDialog === 'cancelOffload' ? 'Reverse offload' : 'Cancel container'}
        description={
          reasonDialog === 'cancelOffload'
            ? 'The stock movements of the offload are reversed, the invoice lines released and the item costs rebuilt. The container goes back to Cleared. Refused once a charge was posted after the offload.'
            : 'The container is cancelled and its order lines are free to load elsewhere. No stock moves.'
        }
      />
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper radius="lg" p="md" withBorder>
      <Title order={5} mb="sm">
        {title}
      </Title>
      {children}
    </Paper>
  )
}

/** A value on a record: label above, text below — never a disabled input. */
function ViewField({ label, value, dimmed, colour, hint }: { label: string; value: string | null; dimmed?: boolean; colour?: string; hint?: string }) {
  return (
    <div>
      <Text fz="sm" fw={500} mb={2}>
        {label}
        {hint ? (
          <Text span fz="xs" c="dimmed" fw={400}>
            {' '}
            ({hint})
          </Text>
        ) : null}
      </Text>
      <Text fz="sm" c={colour ?? (dimmed || !value ? 'dimmed' : undefined)} fw={colour ? 700 : undefined}>
        {value ?? '—'}
      </Text>
    </div>
  )
}
