import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Grid,
  Group,
  Loader,
  Modal,
  MultiSelect,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useForm } from '@mantine/form'
import { useDebouncedValue } from '@mantine/hooks'
import {
  IconArrowLeft,
  IconBan,
  IconCheck,
  IconDeviceFloppy,
  IconFileText,
  IconPlayerPlay,
  IconPlus,
  IconReceipt,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { containersApi, containerStatusColour, type ContainerListDto } from '../../api/logistics/containers'
import {
  movementsApi,
  movementStatusColour,
  type MovementContainerDto,
  type MovementDto,
  type SaveMovementRequest,
} from '../../api/logistics/movements'
import { movementTypesApi, SINGLE_PLACE_STAGES, stageExplanation, type MovementTypeLookupDto } from '../../api/masterdata/movementTypes'
import { partiesApi } from '../../api/masterdata/parties'
import { portLabel, portsApi, type PortLookupDto } from '../../api/masterdata/ports'
import type { PartyLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { AuditTrail, type AuditEntry } from '../../components/documents/AuditTrail'
import { CancelReasonModal } from '../../components/documents/CancelReasonModal'
import { DocumentActionBar, type DocumentAction } from '../../components/documents/DocumentActionBar'
import { dateLabel } from '../../components/documents/documentKind'
import { formatMoney, formatNumber, todayDateOnly } from '../../components/format'
import { MovementDocumentsCard } from '../../components/logistics/MovementDocumentsCard'
import { StageIcon } from '../../components/logistics/movementStage'
import { NewChargeModal } from '../../components/logistics/NewChargeModal'
import { confirm } from '../../components/ui/confirm'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { PERMISSIONS } from '../../navigation'
import { MOVEMENTS_ROUTE } from './MovementsPage'

const CONTAINERS_ROUTE = '/logistics/containers'

interface FormValues {
  movementTypeId: string | null
  fromPlaceId: string | null
  toPlaceId: string | null
  plannedDate: string | null
  startDate: string | null
  eta: string | null
  carrierPartyId: string | null
  vehicleOrVessel: string
  voyageNo: string
  reference: string
  notes: string
}

const EMPTY: FormValues = {
  movementTypeId: null,
  fromPlaceId: null,
  toPlaceId: null,
  plannedDate: null,
  startDate: null,
  eta: null,
  carrierPartyId: null,
  vehicleOrVessel: '',
  voyageNo: '',
  reference: '',
  notes: '',
}

/** A container on the movement, whichever of the two API shapes it came from. */
interface PickedContainer {
  containerId: number
  containerRef: string
  containerNo: string | null
  containerTypeCode: string
  status: number
  statusName: string
  currentLocation: string | null
  itemSummary: string | null
  qty: number
}

type Option = { value: string; label: string }

const CHARGE_STATUSES: Record<number, { label: string; colour: string }> = {
  1: { label: 'Draft', colour: 'gray' },
  2: { label: 'Posted', colour: 'green' },
  3: { label: 'Cancelled', colour: 'red' },
}

function toValues(dto: MovementDto): FormValues {
  return {
    movementTypeId: String(dto.movementTypeId),
    fromPlaceId: String(dto.fromPlaceId),
    toPlaceId: String(dto.toPlaceId),
    plannedDate: dto.plannedDate?.slice(0, 10) ?? null,
    startDate: dto.startDate?.slice(0, 10) ?? null,
    eta: dto.eta?.slice(0, 10) ?? null,
    carrierPartyId: dto.carrierPartyId === null ? null : String(dto.carrierPartyId),
    vehicleOrVessel: dto.vehicleOrVessel ?? '',
    voyageNo: dto.voyageNo ?? '',
    reference: dto.reference ?? '',
    notes: dto.notes ?? '',
  }
}

function fromMovementContainer(c: MovementContainerDto): PickedContainer {
  return {
    containerId: c.containerId,
    containerRef: c.containerRef,
    containerNo: c.containerNo,
    containerTypeCode: c.containerTypeCode,
    status: c.containerStatus,
    statusName: c.containerStatusName,
    currentLocation: c.currentLocation,
    itemSummary: c.itemSummary,
    qty: c.totalAllocatedBase,
  }
}

function fromListRow(c: ContainerListDto): PickedContainer {
  return {
    containerId: c.id,
    containerRef: c.containerRef,
    containerNo: c.containerNo,
    containerTypeCode: c.containerTypeCode,
    status: c.status,
    statusName: c.statusName,
    currentLocation: c.currentLocation,
    itemSummary: c.itemSummary,
    qty: c.totalQtyBase,
  }
}

function containerLabel(c: { containerRef: string; containerNo: string | null }): string {
  return c.containerNo ? `${c.containerRef} - ${c.containerNo}` : c.containerRef
}

/** What happened to the movement, newest first, from the stamps the movement carries. */
function auditOf(dto: MovementDto): AuditEntry[] {
  const entries: (AuditEntry | null)[] = [
    { action: 'Created', details: null, userName: dto.createdByName, atUtc: dto.createdAtUtc },
    dto.updatedAtUtc ? { action: 'Updated', details: null, userName: dto.updatedByName, atUtc: dto.updatedAtUtc } : null,
    dto.startedAtUtc ? { action: 'Started', details: dto.startDate ? `Start date ${dateLabel(dto.startDate)}` : null, userName: dto.startedByName, atUtc: dto.startedAtUtc } : null,
    dto.completedAtUtc ? { action: 'Completed', details: dto.endDate ? `End date ${dateLabel(dto.endDate)}` : null, userName: dto.completedByName, atUtc: dto.completedAtUtc } : null,
    dto.cancelledAtUtc ? { action: 'Cancelled', details: dto.cancelReason, userName: dto.cancelledByName, atUtc: dto.cancelledAtUtc } : null,
  ]
  return entries.filter((e): e is AuditEntry => e !== null).sort((a, b) => b.atUtc.localeCompare(a.atUtc))
}

/**
 * One leg of the route: which containers travel, from where to where, with whom. Starting and
 * completing it is what moves the containers' status, dates and location - by the STAGE of its type -
 * so after either the page says which containers changed and to what.
 *
 * Planned and in-progress movements are forms; completed and cancelled ones are records, every field
 * text. Every action answers with the movement re-read, so the page never guesses where it went.
 */
export function MovementPage() {
  const { id } = useParams<{ id: string }>()
  const isNew = id === undefined || id === 'new'
  const movementId = isNew ? null : Number(id)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { hasPermission } = useAuth()
  const canManage = hasPermission(PERMISSIONS.movementsManage)
  const canAddCharge = hasPermission(PERMISSIONS.containerChargesCreate)

  const [movement, setMovement] = useState<MovementDto | null>(null)
  const [loading, setLoading] = useState(!isNew)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [stale, setStale] = useState<string | null>(null)
  const [picked, setPicked] = useState<PickedContainer[]>([])

  const [types, setTypes] = useState<MovementTypeLookupDto[]>([])
  const [ports, setPorts] = useState<PortLookupDto[]>([])
  const [carriers, setCarriers] = useState<PartyLookupDto[]>([])
  const [containerSearch, setContainerSearch] = useState('')
  const [debouncedSearch] = useDebouncedValue(containerSearch, 300)
  const [found, setFound] = useState<ContainerListDto[]>([])

  const [saving, setSaving] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [dateDialog, setDateDialog] = useState<'start' | 'complete' | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [chargeOpen, setChargeOpen] = useState(false)

  const dirty = useRef(false)
  const markDirty = () => {
    dirty.current = true
  }

  const form = useForm<FormValues>({
    initialValues: EMPTY,
    onValuesChange: markDirty,
    validate: {
      movementTypeId: (value) => (value ? null : 'Type is required.'),
      fromPlaceId: (value) => (value ? null : 'From is required.'),
      toPlaceId: (value) => (value ? null : 'To is required.'),
      eta: (value, values) => {
        const from = values.startDate ?? values.plannedDate
        return value && from && value < from ? 'The ETA cannot be before the start / planned date.' : null
      },
    },
  })

  /** Puts a server answer on the page. Everything typed is replaced. */
  const show = useCallback(
    (dto: MovementDto) => {
      setMovement(dto)
      form.setValues(toValues(dto))
      form.resetDirty(toValues(dto))
      setPicked(dto.containers.map(fromMovementContainer))
      setStale(null)
      dirty.current = false
    },
    // form is stable for the life of the page; listing it would re-create show on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const load = useCallback(async () => {
    if (movementId === null) return
    setLoading(true)
    setLoadError(null)
    try {
      show(await movementsApi.get(movementId))
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'The movement could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [movementId, show])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    movementTypesApi.lookup(false).then(setTypes).catch(() => {})
    portsApi.lookup(false).then(setPorts).catch(() => {})
    partiesApi.lookup({ activeOnly: false }).then(setCarriers).catch(() => {})
  }, [])

  // /new?containerId=12&containerId=15 - "New movement for this container" on the container page.
  const preset = searchParams.getAll('containerId').join(',')
  useEffect(() => {
    if (!isNew || !preset) return
    const ids = [...new Set(preset.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    Promise.all(ids.map((cid) => containersApi.get(cid).catch(() => null)))
      .then((list) =>
        setPicked(
          list
            .filter((c) => c !== null)
            .map((c) => {
              const items = [...new Set(c.lines.map((l) => l.itemCode))]
              return {
                containerId: c.id,
                containerRef: c.containerRef,
                containerNo: c.containerNo,
                containerTypeCode: c.containerTypeCode,
                status: c.status,
                statusName: c.statusName,
                currentLocation: c.currentLocation,
                itemSummary: items.length === 0 ? null : items.length === 1 ? items[0] : `Mixed - ${items.length} items`,
                qty: c.totalAllocatedBase,
              }
            }),
        ),
      )
      .catch(() => {})
  }, [isNew, preset])

  // The tab close React Router never sees.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const inProgress = movement?.status === 2
  const readOnly = !canManage || (movement !== null && !movement.canEdit)

  // The container picker asks the server as it is typed. While the movement runs only containers
  // already confirmed and not yet offloaded can join it; a planned one may take drafts as well.
  useEffect(() => {
    if (readOnly) return
    const controller = new AbortController()
    containersApi
      .list({ search: debouncedSearch.trim() || undefined, pageSize: 50, sortBy: 'OrderDate', sortDir: 'desc' }, controller.signal)
      .then((result) => setFound(result.items.filter((c) => c.status >= (inProgress ? 2 : 1) && c.status <= 5)))
      .catch(() => {})
    return () => controller.abort()
  }, [debouncedSearch, inProgress, readOnly])

  const values = form.values
  const type = types.find((t) => String(t.id) === values.movementTypeId) ?? null
  const singlePlace = type !== null && SINGLE_PLACE_STAGES.includes(type.stage)

  /* ── options ─────────────────────────────────────────────────────────────────────────────── */

  const typeOptions = types
    .filter((t) => t.isActive || String(t.id) === values.movementTypeId)
    .map((t) => ({ value: String(t.id), label: `${t.typeCode} - ${t.typeName}` }))
  const placeOptions = useMemo(() => {
    // Grouped by kind, so a border post is not mistaken for the sea port of the same town.
    const chosen = [values.fromPlaceId, values.toPlaceId]
    const kinds = new Map<string, Option[]>()
    for (const p of ports) {
      if (!p.isActive && !chosen.includes(String(p.id))) continue
      const list = kinds.get(p.kind) ?? []
      list.push({ value: String(p.id), label: `${p.portCode} - ${portLabel(p)}` })
      kinds.set(p.kind, list)
    }
    return [...kinds].map(([group, items]) => ({ group, items }))
  }, [ports, values.fromPlaceId, values.toPlaceId])
  const carrierOptions = carriers
    .filter((c) => c.isActive || String(c.id) === values.carrierPartyId)
    .map((c) => ({ value: String(c.id), label: `${c.partyCode} - ${c.partyName}` }))
  const containerOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of picked) map.set(String(c.containerId), containerLabel(c))
    for (const c of found) map.set(String(c.id), containerLabel(c))
    return [...map].map(([value, label]) => ({ value, label }))
  }, [picked, found])

  const placeLabel = (value: string | null) => {
    const port = ports.find((p) => String(p.id) === value)
    return port ? `${port.portCode} - ${portLabel(port)}` : null
  }

  /* ── editing ─────────────────────────────────────────────────────────────────────────────── */

  function pickFrom(next: string | null) {
    const previous = values.fromPlaceId
    form.setFieldValue('fromPlaceId', next)
    // A port call, customs clearance or border crossing happens at one place.
    if (singlePlace && (values.toPlaceId === null || values.toPlaceId === previous)) form.setFieldValue('toPlaceId', next)
  }

  function pickType(next: string | null) {
    form.setFieldValue('movementTypeId', next)
    const stage = types.find((t) => String(t.id) === next)?.stage
    if (stage && SINGLE_PLACE_STAGES.includes(stage) && values.fromPlaceId && !values.toPlaceId) form.setFieldValue('toPlaceId', values.fromPlaceId)
  }

  function pickContainers(ids: string[]) {
    const byId = new Map(picked.map((c) => [String(c.containerId), c]))
    for (const c of found) if (!byId.has(String(c.id))) byId.set(String(c.id), fromListRow(c))
    setPicked(ids.map((cid) => byId.get(cid)).filter((c): c is PickedContainer => c !== undefined))
    markDirty()
  }

  function toRequest(v: FormValues, rowVersion: string | null): SaveMovementRequest {
    return {
      movementTypeId: Number(v.movementTypeId),
      fromPlaceId: Number(v.fromPlaceId),
      toPlaceId: Number(v.toPlaceId),
      plannedDate: v.plannedDate,
      startDate: inProgress ? v.startDate : null,
      eta: v.eta,
      carrierPartyId: v.carrierPartyId === null ? null : Number(v.carrierPartyId),
      vehicleOrVessel: v.vehicleOrVessel.trim() || null,
      voyageNo: v.voyageNo.trim() || null,
      reference: v.reference.trim() || null,
      notes: v.notes.trim() || null,
      containerIds: picked.map((c) => c.containerId),
      rowVersion,
    }
  }

  /** The refusals worth a sentence of their own; the server's words are shown unchanged. */
  function fail(err: unknown, fallback: string) {
    if (!(err instanceof ApiError)) {
      notify.error(fallback)
      return
    }
    if (err.code === 'CONCURRENCY') setStale(err.message)
    notify.error(err.message)
  }

  async function save(): Promise<MovementDto | null> {
    const invalid = form.validate().hasErrors
    // Checked here rather than in the form's rules, which cannot see the status of the movement.
    if (inProgress && !values.startDate) form.setFieldError('startDate', 'The start date of a movement in progress is required.')
    if (invalid || (inProgress && !values.startDate)) {
      notify.error('Check the highlighted fields.')
      return null
    }
    setSaving(true)
    try {
      const payload = toRequest(values, movement?.rowVersion ?? null)
      const saved = movementId === null ? await movementsApi.create(payload) : await movementsApi.update(movementId, payload)
      show(saved)
      notify.success(movementId === null ? `Movement ${saved.movementNo} created.` : `${saved.movementNo} saved.`)
      if (movementId === null) void navigate(`${MOVEMENTS_ROUTE}/${saved.id}`, { replace: true })
      return saved
    } catch (err) {
      fail(err, 'The movement could not be saved.')
      return null
    } finally {
      setSaving(false)
    }
  }

  /** Start / complete: unsaved edits are saved (or given up) first, then the containers that moved are named. */
  async function changeStatus(kind: 'start' | 'complete', date: string | null) {
    let current = movement
    if (!current) return
    if (dirty.current) {
      const go = await confirm({ title: 'Unsaved changes', message: 'Save your changes first?', confirmLabel: 'Save and continue' })
      if (!go) return
      current = await save()
      if (!current) return
    }
    const before = new Map(current.containers.map((c) => [c.containerId, c.containerStatusName]))
    setBusyAction(kind)
    try {
      const result =
        kind === 'start'
          ? await movementsApi.start(current.id, date, current.rowVersion)
          : await movementsApi.complete(current.id, date, current.rowVersion)
      show(result)
      setDateDialog(null)
      notify.success(kind === 'start' ? `${result.movementNo} started.` : `${result.movementNo} completed.`)
      const changes = result.containers
        .filter((c) => before.has(c.containerId) && before.get(c.containerId) !== c.containerStatusName)
        .map((c) => `${c.containerRef}: ${before.get(c.containerId)} -> ${c.containerStatusName}`)
      if (changes.length > 0) notify.info(changes.join('; '))
    } catch (err) {
      fail(err, kind === 'start' ? 'The movement could not be started.' : 'The movement could not be completed.')
    } finally {
      setBusyAction(null)
    }
  }

  async function cancelMovement(reason: string) {
    if (!movement) return
    setBusyAction('cancel')
    try {
      const result = await movementsApi.cancel(movement.id, reason, movement.rowVersion)
      show(result)
      setCancelOpen(false)
      notify.success(`${result.movementNo} cancelled.`)
    } catch (err) {
      fail(err, 'The movement could not be cancelled.')
    } finally {
      setBusyAction(null)
    }
  }

  async function remove() {
    if (!movement) return
    const go = await confirm({
      title: 'Delete movement',
      message: `Delete planned movement ${movement.movementNo}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!go) return
    try {
      await movementsApi.remove(movement.id)
      dirty.current = false
      notify.success('Movement deleted.')
      void navigate(MOVEMENTS_ROUTE)
    } catch (err) {
      fail(err, 'The movement could not be deleted.')
    }
  }

  async function back() {
    if (dirty.current) {
      const go = await confirm({ title: 'Leave without saving?', message: 'Your changes will be lost.', confirmLabel: 'Leave', danger: true })
      if (!go) return
    }
    dirty.current = false
    void navigate(MOVEMENTS_ROUTE)
  }

  /* ── fields: an input on a form, text on a record ────────────────────────────────────────── */

  function textField(key: 'vehicleOrVessel' | 'voyageNo' | 'reference', label: string, maxLength: number, placeholder?: string) {
    if (readOnly) return <ViewField label={label} value={values[key] || null} />
    return <TextInput label={label} maxLength={maxLength} placeholder={placeholder} {...form.getInputProps(key)} />
  }

  function dateField(key: 'plannedDate' | 'startDate' | 'eta', label: string, required = false) {
    if (readOnly) return <ViewField label={label} value={values[key] ? dateLabel(values[key]) : null} />
    return (
      <DateInput
        label={label}
        withAsterisk={required}
        valueFormat="DD/MM/YYYY"
        clearable={!required}
        value={values[key]}
        onChange={(next) => form.setFieldValue(key, next ? String(next).slice(0, 10) : null)}
        error={form.errors[key]}
      />
    )
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
      <Alert color="red" title="Could not load the movement">
        {loadError}{' '}
        <Anchor component="button" onClick={() => void load()}>
          Try again
        </Anchor>
      </Alert>
    )
  }

  const saved = movement !== null
  const actions: DocumentAction[] = [
    { key: 'back', label: 'Back', icon: <IconArrowLeft size={16} />, onClick: () => void back(), variant: 'default' },
    { key: 'delete', label: 'Delete', icon: <IconTrash size={16} />, onClick: () => void remove(), variant: 'default', colour: 'red', visible: saved && canManage && movement.canDelete },
    { key: 'cancel', label: 'Cancel', icon: <IconBan size={16} />, onClick: () => setCancelOpen(true), variant: 'default', colour: 'red', visible: saved && canManage && movement.canCancel },
    { key: 'complete', label: 'Complete', icon: <IconCheck size={16} />, onClick: () => setDateDialog('complete'), variant: 'light', colour: 'green', loading: busyAction === 'complete', visible: saved && canManage && movement.canComplete },
    { key: 'start', label: 'Start', icon: <IconPlayerPlay size={16} />, onClick: () => setDateDialog('start'), variant: 'light', loading: busyAction === 'start', visible: saved && canManage && movement.canStart },
    { key: 'save', label: 'Save', icon: <IconDeviceFloppy size={16} />, onClick: () => void save(), variant: 'filled', loading: saving, visible: !readOnly },
  ]

  const chargesTotal = (movement?.charges ?? []).filter((c) => c.status === 2).reduce((sum, c) => sum + c.amountBase, 0)

  return (
    <div>
      <PageHeader
        title={movement ? `Movement ${movement.movementNo}` : 'New movement'}
        subtitle={
          movement
            ? `${movement.typeName} · ${movement.fromName}${movement.toPlaceId === movement.fromPlaceId ? '' : ` → ${movement.toName}`}`
            : 'The number is assigned when the movement is first saved.'
        }
        breadcrumbs={[{ label: 'Movements', to: MOVEMENTS_ROUTE }, { label: movement?.movementNo ?? 'New' }]}
        actions={
          movement ? (
            <Group gap="xs">
              <Badge size="lg" color={movementStatusColour(movement.status)} variant="light">
                {movement.statusName}
              </Badge>
              {movement.isLate ? (
                <Badge size="lg" color="red" variant="filled">
                  Late
                </Badge>
              ) : null}
            </Group>
          ) : undefined
        }
      />

      {stale ? (
        <Alert color="orange" mb="md" title="Changed by someone else">
          {stale}{' '}
          <Anchor component="button" onClick={() => void load()}>
            Reload
          </Anchor>
        </Alert>
      ) : null}

      {movement?.status === 4 ? (
        <Alert color="red" mb="md">
          Cancelled by {movement.cancelledByName ?? '—'}: {movement.cancelReason ?? ''}
        </Alert>
      ) : null}

      <Grid gap="md">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack gap="md">
            <Section title="Movement">
              <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
                <ViewField label="Movement No." value={movement?.movementNo ?? 'Assigned on save'} dimmed={!movement} />
                {readOnly ? (
                  <ViewField label="Type" value={typeOptions.find((o) => o.value === values.movementTypeId)?.label ?? movement?.typeName ?? null} />
                ) : (
                  <Select
                    label="Type"
                    withAsterisk
                    data={typeOptions}
                    searchable
                    nothingFoundMessage="No type matches"
                    value={values.movementTypeId}
                    onChange={pickType}
                    error={form.errors.movementTypeId}
                    leftSection={type ? <StageIcon stage={type.stage} /> : null}
                  />
                )}
                <ViewField label="Stage" value={type ? `${type.stage} - ${stageExplanation(type.stage)}` : null} />
                {readOnly ? (
                  <ViewField label="From" value={placeLabel(values.fromPlaceId)} />
                ) : (
                  <Select label="From" withAsterisk data={placeOptions} searchable nothingFoundMessage="No place matches" value={values.fromPlaceId} onChange={pickFrom} error={form.errors.fromPlaceId} />
                )}
                {readOnly ? (
                  <ViewField label="To" value={placeLabel(values.toPlaceId)} />
                ) : (
                  <Select
                    label="To"
                    withAsterisk
                    description={singlePlace ? 'Same place as From for this stage, unless changed.' : undefined}
                    inputWrapperOrder={['label', 'input', 'description', 'error']}
                    data={placeOptions}
                    searchable
                    nothingFoundMessage="No place matches"
                    {...form.getInputProps('toPlaceId')}
                  />
                )}
                {dateField('plannedDate', 'Planned date')}
                {inProgress || movement?.startDate ? dateField('startDate', 'Start date', inProgress) : null}
                {dateField('eta', 'ETA')}
                {movement?.endDate ? <ViewField label="End date" value={dateLabel(movement.endDate)} /> : null}
                {readOnly ? (
                  <ViewField label="Carrier" value={carrierOptions.find((o) => o.value === values.carrierPartyId)?.label ?? movement?.carrierName ?? null} />
                ) : (
                  <Select label="Carrier" placeholder="Shipping line, trucker..." data={carrierOptions} searchable clearable nothingFoundMessage="No party matches" {...form.getInputProps('carrierPartyId')} />
                )}
                {textField('vehicleOrVessel', 'Vessel / Truck', 100, 'MSC Aurora / T 123 ABC')}
                {textField('voyageNo', 'Voyage', 30)}
                {textField('reference', 'Reference', 50)}
              </SimpleGrid>
              {readOnly ? (
                <ViewField label="Notes" value={values.notes || null} />
              ) : (
                <Textarea label="Notes" autosize minRows={2} maxLength={1000} mt="sm" {...form.getInputProps('notes')} />
              )}
            </Section>

            <Section title={`Containers (${formatNumber(picked.length)})`}>
              {readOnly ? null : (
                <MultiSelect
                  label="Add containers"
                  placeholder="Search by container ref. or no."
                  description={inProgress ? 'The movement is running: only confirmed containers not yet offloaded can join.' : undefined}
                  data={containerOptions}
                  value={picked.map((c) => String(c.containerId))}
                  onChange={pickContainers}
                  searchable
                  searchValue={containerSearch}
                  onSearchChange={setContainerSearch}
                  // The server has already matched what was typed, by ref OR number; filtering again would hide some.
                  filter={({ options }) => options}
                  hidePickedOptions
                  clearable
                  nothingFoundMessage="No container matches"
                  mb="sm"
                />
              )}
              {picked.length === 0 ? (
                <Text c="dimmed" fz="sm" ta="center" py="sm">
                  No container on this movement yet.
                </Text>
              ) : (
                <ScrollArea type="auto">
                  <Table miw={760} verticalSpacing={4}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Container Ref.</Table.Th>
                        <Table.Th>Container No.</Table.Th>
                        <Table.Th>Type</Table.Th>
                        <Table.Th>Status</Table.Th>
                        <Table.Th>Location</Table.Th>
                        <Table.Th>Items</Table.Th>
                        <Table.Th ta="right">Qty</Table.Th>
                        {readOnly ? null : <Table.Th />}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {picked.map((c) => (
                        <Table.Tr key={c.containerId}>
                          <Table.Td style={{ whiteSpace: 'nowrap' }}>
                            <Anchor component={Link} to={`${CONTAINERS_ROUTE}/${c.containerId}`} fz="sm" fw={600}>
                              {c.containerRef}
                            </Anchor>
                          </Table.Td>
                          <Table.Td>{c.containerNo ?? '—'}</Table.Td>
                          <Table.Td>{c.containerTypeCode}</Table.Td>
                          <Table.Td>
                            <Badge color={containerStatusColour(c.status)} variant={c.status === 7 ? 'filled' : 'light'} style={{ whiteSpace: 'nowrap' }}>
                              {c.statusName}
                            </Badge>
                          </Table.Td>
                          <Table.Td>{c.currentLocation ?? '—'}</Table.Td>
                          <Table.Td>{c.itemSummary ?? '—'}</Table.Td>
                          <Table.Td ta="right">{formatNumber(c.qty)}</Table.Td>
                          {readOnly ? null : (
                            <Table.Td>
                              <Tooltip label="Remove from the movement" withArrow>
                                <ActionIcon
                                  variant="subtle"
                                  color="red"
                                  aria-label={`Remove ${c.containerRef}`}
                                  onClick={() => pickContainers(picked.filter((p) => p.containerId !== c.containerId).map((p) => String(p.containerId)))}
                                >
                                  <IconX size={16} />
                                </ActionIcon>
                              </Tooltip>
                            </Table.Td>
                          )}
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              )}
            </Section>

            {movement ? (
              <Paper radius="lg" p="md" withBorder>
                <Tabs defaultValue="charges">
                  <Tabs.List mb="sm">
                    <Tabs.Tab value="charges" leftSection={<IconReceipt size={16} />}>
                      Charges ({formatNumber(movement.charges.length)})
                    </Tabs.Tab>
                    <Tabs.Tab value="documents" leftSection={<IconFileText size={16} />}>
                      Documents ({formatNumber(new Set(movement.attachments.map((a) => a.fileId)).size)})
                    </Tabs.Tab>
                  </Tabs.List>

                  <Tabs.Panel value="charges">
                    <Group justify="space-between" mb="sm" wrap="wrap" gap="xs">
                      <Text fz="sm" c="dimmed">
                        Posted: {formatMoney(chargesTotal, 'USD')}
                      </Text>
                      {canAddCharge && movement.containers.length > 0 && movement.status !== 4 ? (
                        <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setChargeOpen(true)}>
                          Add charge for these containers
                        </Button>
                      ) : null}
                    </Group>
                    <ChargesTable movement={movement} />
                  </Tabs.Panel>

                  <Tabs.Panel value="documents">
                    <MovementDocumentsCard movement={movement} canManage={hasPermission(PERMISSIONS.containerAttachmentsManage)} onChanged={() => void load()} />
                  </Tabs.Panel>
                </Tabs>
              </Paper>
            ) : (
              <Text c="dimmed" fz="sm">
                Save the movement to record its charges and documents.
              </Text>
            )}
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Stack gap="md">
            {type ? (
              <Paper radius="lg" p="md" withBorder>
                <Group gap="xs" mb={4}>
                  <StageIcon stage={type.stage} size={20} />
                  <Title order={5}>{type.stage} stage</Title>
                </Group>
                <Text fz="sm">{stageExplanation(type.stage)}</Text>
                <Text fz="xs" c="dimmed" mt={4}>
                  Starting and completing the movement moves every container on it accordingly.
                </Text>
              </Paper>
            ) : null}
            {movement ? <AuditTrail entries={auditOf(movement)} /> : null}
          </Stack>
        </Grid.Col>
      </Grid>

      <div className="no-print" style={{ marginTop: 'var(--mantine-spacing-md)' }}>
        <DocumentActionBar actions={actions} />
      </div>

      {dateDialog && movement ? (
        <StatusDateModal
          kind={dateDialog}
          movementNo={movement.movementNo}
          busy={busyAction === dateDialog}
          onClose={() => setDateDialog(null)}
          onConfirm={(date) => void changeStatus(dateDialog, date)}
        />
      ) : null}

      <CancelReasonModal
        opened={cancelOpen}
        onClose={() => setCancelOpen(false)}
        documentLabel={movement?.movementNo ?? ''}
        busy={busyAction === 'cancel'}
        onConfirm={(reason) => void cancelMovement(reason)}
        confirmLabel="Cancel movement"
        description="The movement is kept as a cancelled record and can no longer be started or changed. It cannot be undone."
      />

      {movement ? (
        <NewChargeModal
          opened={chargeOpen}
          onClose={() => setChargeOpen(false)}
          presetContainerIds={movement.containers.map((c) => c.containerId)}
          presetMovementId={movement.id}
          onCreated={() => {
            setChargeOpen(false)
            void load()
          }}
        />
      ) : null}
    </div>
  )
}

function ChargesTable({ movement }: { movement: MovementDto }) {
  if (movement.charges.length === 0) {
    return (
      <Text c="dimmed" fz="sm" ta="center" py="sm">
        No charge on this movement yet.
      </Text>
    )
  }
  return (
    <ScrollArea type="auto">
      <Table miw={860} verticalSpacing={4}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Container</Table.Th>
            <Table.Th>Charge type</Table.Th>
            <Table.Th>Provider</Table.Th>
            <Table.Th>Reference</Table.Th>
            <Table.Th>Date</Table.Th>
            <Table.Th ta="right">Amount</Table.Th>
            <Table.Th ta="right">Amount (base)</Table.Th>
            <Table.Th>Status</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {movement.charges.map((c) => {
            const status = CHARGE_STATUSES[c.status] ?? { label: String(c.status), colour: 'gray' }
            return (
              <Table.Tr key={c.id} style={c.status === 3 ? { opacity: 0.6 } : undefined}>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>
                  <Anchor component={Link} to={`${CONTAINERS_ROUTE}/${c.containerId}`} fz="sm">
                    {c.containerRef}
                  </Anchor>
                </Table.Td>
                <Table.Td>
                  <Text fz="sm">
                    {c.chargeCode} - {c.chargeName}
                  </Text>
                  {c.description ? (
                    <Text fz="xs" c="dimmed">
                      {c.description}
                    </Text>
                  ) : null}
                </Table.Td>
                <Table.Td>{c.providerName ?? '—'}</Table.Td>
                <Table.Td>{c.reference ?? '—'}</Table.Td>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>{dateLabel(c.chargeDate)}</Table.Td>
                <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                  {formatMoney(c.amount, c.currencyCode)}
                </Table.Td>
                <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                  {formatMoney(c.amountBase, 'USD')}
                </Table.Td>
                <Table.Td>
                  <Badge size="sm" variant="light" color={status.colour}>
                    {status.label}
                  </Badge>
                </Table.Td>
              </Table.Tr>
            )
          })}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  )
}

/** The date a movement started or ended - today unless the reader says otherwise. */
function StatusDateModal({
  kind,
  movementNo,
  busy,
  onClose,
  onConfirm,
}: {
  kind: 'start' | 'complete'
  movementNo: string
  busy: boolean
  onClose: () => void
  onConfirm: (date: string) => void
}) {
  const [date, setDate] = useState<string | null>(todayDateOnly())
  const starting = kind === 'start'

  return (
    <Modal opened onClose={onClose} title={`${starting ? 'Start' : 'Complete'} ${movementNo}`} closeOnClickOutside={!busy} withCloseButton={!busy}>
      <Stack>
        <Text fz="sm">
          {starting
            ? 'The containers on the movement set off: their status, dates and location follow the stage of the movement type.'
            : 'The containers arrive: their status, dates and location follow the stage of the movement type.'}
        </Text>
        <DateInput
          label={starting ? 'Start date' : 'End date'}
          withAsterisk
          valueFormat="DD/MM/YYYY"
          value={date}
          onChange={(next) => setDate(next ? String(next).slice(0, 10) : null)}
          data-autofocus
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            color={starting ? undefined : 'green'}
            leftSection={starting ? <IconPlayerPlay size={16} /> : <IconCheck size={16} />}
            disabled={!date}
            loading={busy}
            onClick={() => date && onConfirm(date)}
          >
            {starting ? 'Start movement' : 'Complete movement'}
          </Button>
        </Group>
      </Stack>
    </Modal>
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

/** A value on a record: label above, text below - never a disabled input. */
function ViewField({ label, value, dimmed }: { label: string; value: string | null; dimmed?: boolean }) {
  return (
    <div>
      <Text fz="sm" fw={500} mb={2}>
        {label}
      </Text>
      <Text fz="sm" c={dimmed || !value ? 'dimmed' : undefined}>
        {value ?? '—'}
      </Text>
    </div>
  )
}
