import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Grid,
  Group,
  Loader,
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
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useForm } from '@mantine/form'
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
} from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { fetchAllPages, WHOLE_LIST_PAGE_SIZE } from '../../api/fetchAllPages'
import { containersApi } from '../../api/logistics/containers'
import { movementsApi, movementStatusColour, type MovementDto, type SaveMovementRequest } from '../../api/logistics/movements'
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
import { DeliveryCancelDrafts } from '../../components/logistics/DeliveryReceipts'
import { MovementContainersCard } from '../../components/logistics/MovementContainersCard'
import { MovementDocumentsCard } from '../../components/logistics/MovementDocumentsCard'
import { MovementStatusModal } from '../../components/logistics/MovementStatusModal'
import { fromSaved, type CardContainer } from '../../components/logistics/movementContainers'
import { StageIcon } from '../../components/logistics/movementStage'
import { NewChargeModal } from '../../components/logistics/NewChargeModal'
import { FROM_LOCKED_HINT, placeOptionGroups } from '../../components/logistics/shipStep'
import { confirm } from '../../components/ui/confirm'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { refreshGoodsReceiptsWaiting } from '../../hooks/useGoodsReceiptsWaiting'
import { PERMISSIONS } from '../../navigation'
import { MOVEMENTS_ROUTE } from './MovementsPage'
import { useDocumentTypes } from '../../hooks/useDocumentTypes'

/** The stage whose completion brings the containers to the warehouse: a draft goods receipt for each (rule 5). */
const DELIVERY = 'Delivery'

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

/**
 * A saved container as the movement now has it (status, pieces), keeping what the page had already learned about
 * it - its orders and suppliers, and its place for the From, which a save does not change.
 */
function keepDetails(saved: CardContainer, before: CardContainer | undefined, keepPlace = true): CardContainer {
  if (!before) return saved
  return {
    ...saved,
    orderNumbers: before.orderNumbers ?? saved.orderNumbers,
    supplierNames: before.supplierNames ?? saved.supplierNames,
    itemSummary: before.itemSummary ?? saved.itemSummary,
    place: keepPlace ? before.place : null,
  }
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
 * A DELIVERY-STAGE MOVEMENT BRINGS THE GOODS TO THE WAREHOUSE: its Complete dialog lists the draft goods
 * receipt each container will get, the notification afterwards names the drafts created (linked) and the
 * containers that got none with the reason, and cancelling it once completed lists the automatic drafts
 * deleted with it, naming the ones edited since.
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
  const canViewReceipts = hasPermission(PERMISSIONS.goodsReceiptsView)

  const [movement, setMovement] = useState<MovementDto | null>(null)
  /* Whether completing a Delivery drafts goods receipts: the movement says so once saved, the goods receipt type before. */
  const goodsReceiptType = useDocumentTypes().byCode('GRN')
  const receiptsAutomatic = movement?.goodsReceiptsAutomatic ?? goodsReceiptType?.autoCreateOnDelivery
  const [loading, setLoading] = useState(!isNew)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [stale, setStale] = useState<string | null>(null)
  /** The ticked containers: what the movement holds once saved. */
  const [ticked, setTicked] = useState<CardContainer[]>([])
  /** Moves on after Start, Complete and Cancel: the Containers card then reads its lists again (where they are now). */
  const [containersVersion, setContainersVersion] = useState(0)
  /** The same as `dirty`, for what renders from it: Start and Complete wait for a save. */
  const [unsaved, setUnsaved] = useState(false)

  const [types, setTypes] = useState<MovementTypeLookupDto[]>([])
  const [ports, setPorts] = useState<PortLookupDto[]>([])
  const [carriers, setCarriers] = useState<PartyLookupDto[]>([])

  const [saving, setSaving] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [dateDialog, setDateDialog] = useState<'start' | 'complete' | null>(null)
  /** (80) Opened from a container ("Next leg…"): where it is. The From is that place, locked: a container leaves from where it is. */
  const [lockedFrom, setLockedFrom] = useState<{ id: number; name: string } | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [chargeOpen, setChargeOpen] = useState(false)

  const dirty = useRef(false)
  const markDirty = () => {
    dirty.current = true
    setUnsaved(true)
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

  /**
   * Puts a server answer on the page. Everything typed is replaced.
   *
   * AFTER START, COMPLETE OR CANCEL THE CONTAINERS HAVE MOVED (`containersMoved`): the places judged before are
   * dropped and the Containers card reads its lists again, so the Place column says where they are now - as a reload
   * would - not where they were. A save keeps them: it moves nothing.
   */
  const show = useCallback(
    (dto: MovementDto, containersMoved = false) => {
      setMovement(dto)
      form.setValues(toValues(dto))
      form.resetDirty(toValues(dto))
      setTicked((current) =>
        dto.containers.map((c) => keepDetails(fromSaved(c), current.find((p) => p.containerId === c.containerId), !containersMoved)),
      )
      if (containersMoved) setContainersVersion((v) => v + 1)
      setStale(null)
      dirty.current = false
      setUnsaved(false)
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

  /* A FILE ADDED, EDITED OR DELETED on the Documents tab changes only the movement's files: they come from a fresh
     read, and the page stays as it is - no loader, the tab stays open, a movement being edited keeps its changes (a
     file does not touch the movement's row). */
  const documentsChanged = useCallback(async () => {
    if (movementId === null) return
    try {
      const fresh = await movementsApi.get(movementId)
      setMovement((current) => (current && current.id === fresh.id ? { ...current, attachments: fresh.attachments } : current))
    } catch {
      /* The count catches up on the next load; the tab already shows the files. */
    }
  }, [movementId])

  useEffect(() => {
    movementTypesApi.lookup(false).then(setTypes).catch(() => {})
    portsApi.lookup(false).then(setPorts).catch(() => {})
    partiesApi.lookup({ activeOnly: false }).then(setCarriers).catch(() => {})
  }, [])

  // (80) ?from=container/12: opened from that container's page - Back returns there, and the dialogs name it.
  // ?from=containers: opened from a row of the Containers list ("Next leg…" in its "…" menu) - Back returns to the list.
  const fromParam = searchParams.get('from') ?? ''
  const fromMatch = /^container\/(\d+)$/.exec(fromParam)
  const fromContainerId = fromMatch ? Number(fromMatch[1]) : null
  const fromContainersList = fromContainerId === null && fromParam === 'containers'
  const fromQuery = fromContainerId !== null ? `?from=container/${fromContainerId}` : fromContainersList ? '?from=containers' : ''
  /** Where Back (and a delete) returns: the page the movement was opened from. */
  const backTo = fromContainerId !== null ? `${CONTAINERS_ROUTE}/${fromContainerId}` : fromContainersList ? CONTAINERS_ROUTE : MOVEMENTS_ROUTE

  // /new?containerId=12&containerId=15 - "New movement for this container" / "Next leg…" on the container page.
  const preset = searchParams.getAll('containerId').join(',')
  useEffect(() => {
    if (!isNew || !preset) return
    const ids = [...new Set(preset.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    Promise.all(ids.map((cid) => containersApi.get(cid).catch(() => null)))
      .then((list) => {
        // (80) One container: the movement leaves from where it is - its From is filled and locked (the To of its
        // latest movement, else its port of loading). A stay (customs, a port call, a border) takes it as its To too.
        const only = list.length === 1 ? list[0] : null
        if (only && only.placeId != null && only.placeName) {
          setLockedFrom({ id: only.placeId, name: only.placeName })
          form.setFieldValue('fromPlaceId', String(only.placeId))
        }
        setTicked(
          list
            .filter((c) => c !== null)
            .map((c): CardContainer => {
              const items = [...new Set(c.lines.map((l) => l.itemCode))]
              return {
                containerId: c.id,
                containerRef: c.containerRef,
                containerNo: c.containerNo,
                containerTypeCode: c.containerTypeCode,
                status: c.status,
                statusName: c.statusName,
                orderNumbers: null,
                supplierNames: null,
                itemSummary: items.length === 0 ? null : items.length === 1 ? items[0] : `Mixed - ${items.length} items`,
                pieces: c.totalAllocatedBase,
                currentLocation: c.currentLocation,
                place: null,
              }
            }),
        )
      })
      .catch(() => {})
    // form is stable for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const values = form.values
  const fromId = values.fromPlaceId === null ? null : Number(values.fromPlaceId)

  // A completed or cancelled movement is not asked about places; its containers' orders and suppliers come from the
  // container list instead - every page of it (script 78: a movement of any number of containers).
  const movementForDetails = readOnly ? movement : null
  useEffect(() => {
    if (!movementForDetails || movementForDetails.containers.length === 0) return
    const controller = new AbortController()
    fetchAllPages(
      (page, pageSize) => containersApi.list({ movementId: movementForDetails.id, page, pageSize }, controller.signal),
      { maxRows: Infinity, pageSize: WHOLE_LIST_PAGE_SIZE },
    )
      .then((result) => {
        if (controller.signal.aborted) return
        const byId = new Map(result.items.map((c) => [c.id, c]))
        setTicked((current) =>
          current.map((c) => {
            const row = byId.get(c.containerId)
            return row ? { ...c, orderNumbers: row.orderNumbers, supplierNames: row.supplierNames, itemSummary: row.itemSummary } : c
          }),
        )
      })
      .catch(() => {})
    return () => controller.abort()
  }, [movementForDetails])

  const type = types.find((t) => String(t.id) === values.movementTypeId) ?? null
  const singlePlace = type !== null && SINGLE_PLACE_STAGES.includes(type.stage)
  // Loading at the supplier ends at the port of loading: its From is the supplier's, so it is not locked.
  const fromLocked = lockedFrom !== null && String(lockedFrom.id) === values.fromPlaceId && type?.stage !== 'Origin'

  /* ── options ─────────────────────────────────────────────────────────────────────────────── */

  const typeOptions = types
    .filter((t) => t.isActive || String(t.id) === values.movementTypeId)
    .map((t) => ({ value: String(t.id), label: `${t.typeCode} - ${t.typeName}` }))
  // Grouped Sea / Border / Inland, so a border post is not mistaken for the sea port of the same town.
  const placeOptions = useMemo(() => placeOptionGroups(ports, [values.fromPlaceId, values.toPlaceId]), [ports, values.fromPlaceId, values.toPlaceId])
  const carrierOptions = carriers
    .filter((c) => c.isActive || String(c.id) === values.carrierPartyId)
    .map((c) => ({ value: String(c.id), label: `${c.partyCode} - ${c.partyName}` }))
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

  /** Ticking, unticking, the import and a new From: the movement's containers change, unsaved. */
  function changeTicked(next: CardContainer[]) {
    const changed = next.length !== ticked.length || next.some((c, index) => c.containerId !== ticked[index]?.containerId)
    setTicked(next)
    if (changed) markDirty()
  }

  // (80) THE START DATE OF A MOVEMENT IN PROGRESS STAYS A FACT, as in its Start dialog: never in the future, never before
  // the previous leg of one of its containers ended (the server refuses both on Save; the field says it first). The
  // earliest start is the saved containers'; a container just ticked is checked by the server.
  const startNotBefore = inProgress ? (movement?.startNotBefore?.slice(0, 10) ?? null) : null
  const startDateProblem =
    !inProgress || !values.startDate
      ? null
      : values.startDate > todayDateOnly()
        ? 'The start date cannot be in the future: start the movement on the day it really leaves.'
        : startNotBefore && values.startDate < startNotBefore
          ? `The movement cannot start before ${movement?.startNotBeforeMovementNo ?? 'the previous leg'} reached ${movement?.startNotBeforePlaceName ?? 'its From'} on ${dateLabel(startNotBefore)}.`
          : null

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
      containerIds: ticked.map((c) => c.containerId),
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
    // A container does not fit the movement: judge them all again, so the card marks it.
    if (err.code === 'CONTAINER_NOT_AT_FROM') setTicked((current) => current.map((c) => ({ ...c, place: null })))
    notify.error(err.message)
  }

  async function save(): Promise<MovementDto | null> {
    const invalid = form.validate().hasErrors
    // Checked here rather than in the form's rules, which cannot see the status of the movement.
    if (inProgress && !values.startDate) form.setFieldError('startDate', 'The start date of a movement in progress is required.')
    if (invalid || (inProgress && !values.startDate) || startDateProblem !== null) {
      notify.error('Check the highlighted fields.')
      return null
    }
    setSaving(true)
    try {
      const payload = toRequest(values, movement?.rowVersion ?? null)
      const saved = movementId === null ? await movementsApi.create(payload) : await movementsApi.update(movementId, payload)
      show(saved)
      notify.success(movementId === null ? `Movement ${saved.movementNo} created.` : `${saved.movementNo} saved.`)
      // The way back to the container goes along (?from=container/12).
      if (movementId === null) void navigate(`${MOVEMENTS_ROUTE}/${saved.id}${fromQuery}`, { replace: true })
      return saved
    } catch (err) {
      fail(err, 'The movement could not be saved.')
      return null
    } finally {
      setSaving(false)
    }
  }

  /** Started or completed in the dialog, which said what moved: the page shows the movement as it is now. */
  function statusDone(result: MovementDto) {
    show(result, true)
    setDateDialog(null)
  }

  async function cancelMovement(reason: string) {
    if (!movement) return
    setBusyAction('cancel')
    const deliveredBefore = movement.status === 3 && movement.stage === DELIVERY
    try {
      const result = await movementsApi.cancel(movement.id, reason, movement.rowVersion)
      show(result, true)
      setCancelOpen(false)
      notify.success(`${result.movementNo} cancelled.`)
      // Its automatic draft goods receipts went with it: the menu count follows.
      if (deliveredBefore) void refreshGoodsReceiptsWaiting()
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
      void navigate(backTo)
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
    // (80) Opened from a container (its page or its row on the Containers list): Back returns there, not to the
    // Movements list.
    void navigate(backTo)
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
        error={form.errors[key] ?? (key === 'startDate' ? startDateProblem : null)}
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
  /** The container the page was opened from, as the Start / Complete dialog names it. */
  const fromContainerRef =
    fromContainerId === null
      ? null
      : (movement?.containers.find((c) => c.containerId === fromContainerId)?.containerRef ??
        ticked.find((c) => c.containerId === fromContainerId)?.containerRef ??
        null)
  const fromContainer = fromContainerId !== null && fromContainerRef ? { id: fromContainerId, containerRef: fromContainerRef } : null
  // Start and Complete act on the saved movement: never with changes on the page, never without a saved container.
  const statusBlocked = unsaved
    ? 'Save your changes first.'
    : (movement?.containers.length ?? 0) === 0
      ? 'Tick at least one container, then save.'
      : null
  const actions: DocumentAction[] = [
    { key: 'back', label: 'Back', icon: <IconArrowLeft size={16} />, onClick: () => void back(), variant: 'default' },
    { key: 'delete', label: 'Delete', icon: <IconTrash size={16} />, onClick: () => void remove(), variant: 'default', colour: 'red', visible: saved && canManage && movement.canDelete },
    { key: 'cancel', label: 'Cancel', icon: <IconBan size={16} />, onClick: () => setCancelOpen(true), variant: 'default', colour: 'red', visible: saved && canManage && movement.canCancel },
    { key: 'complete', label: 'Complete', icon: <IconCheck size={16} />, onClick: () => setDateDialog('complete'), variant: 'light', colour: 'green', visible: saved && canManage && movement.canComplete, disabled: statusBlocked !== null, disabledReason: statusBlocked ?? undefined },
    // (80) A planned movement that cannot start yet says why before the click: the refusal Start would give.
    { key: 'start', label: 'Start', icon: <IconPlayerPlay size={16} />, onClick: () => setDateDialog('start'), variant: 'light', visible: saved && canManage && movement.canStart, disabled: (statusBlocked ?? movement?.startBlockedReason ?? null) !== null, disabledReason: statusBlocked ?? movement?.startBlockedReason ?? undefined },
    { key: 'save', label: 'Save', icon: <IconDeviceFloppy size={16} />, onClick: () => void save(), variant: 'filled', loading: saving, visible: !readOnly, disabled: ticked.length === 0, disabledReason: ticked.length === 0 ? 'Tick at least one container.' : undefined },
  ]

  const chargesTotal = (movement?.charges ?? []).filter((c) => c.status === 2).reduce((sum, c) => sum + c.amountBase, 0)

  const fromPort = ports.find((p) => String(p.id) === values.fromPlaceId)
  const fromName = fromPort ? portLabel(fromPort) : ''

  return (
    <div>
      <PageHeader
        title={movement ? `Movement ${movement.movementNo}` : 'New movement'}
        subtitle={
          movement
            ? `${movement.typeName} · ${movement.fromName}${movement.toPlaceId === movement.fromPlaceId ? '' : ` → ${movement.toName}`}`
            : 'The number is assigned when the movement is first saved.'
        }
        breadcrumbs={
          fromContainerId !== null
            ? [{ label: fromContainerRef ?? 'Container', to: `${CONTAINERS_ROUTE}/${fromContainerId}` }, { label: movement?.movementNo ?? 'New movement' }]
            : fromContainersList
              ? [{ label: 'Containers', to: CONTAINERS_ROUTE }, { label: movement?.movementNo ?? 'New movement' }]
              : [{ label: 'Movements', to: MOVEMENTS_ROUTE }, { label: movement?.movementNo ?? 'New' }]
        }
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
                <ViewField label="Stage" value={type ? `${type.stage} - ${stageExplanation(type.stage, receiptsAutomatic)}` : null} />
                {readOnly ? (
                  <ViewField label="From" value={placeLabel(values.fromPlaceId)} />
                ) : fromLocked ? (
                  <ViewField label="From" value={placeLabel(values.fromPlaceId) ?? lockedFrom?.name ?? null} hint={FROM_LOCKED_HINT} />
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

            <MovementContainersCard
              movement={movement}
              readOnly={readOnly}
              fromPlaceId={fromId}
              toPlaceId={values.toPlaceId === null ? null : Number(values.toPlaceId)}
              movementTypeId={values.movementTypeId === null ? null : Number(values.movementTypeId)}
              fromName={fromName}
              ticked={ticked}
              onTickedChange={changeTicked}
              reloadToken={containersVersion}
            />

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
                    <MovementDocumentsCard movement={movement} canManage={hasPermission(PERMISSIONS.containerAttachmentsManage)} onChanged={() => void documentsChanged()} />
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
                <Text fz="sm">{stageExplanation(type.stage, receiptsAutomatic)}</Text>
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
        <MovementStatusModal
          kind={dateDialog}
          movementId={movement.id}
          movement={movement}
          container={fromContainer}
          onClose={() => setDateDialog(null)}
          onDone={statusDone}
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
      >
        {cancelOpen && movement && movement.status === 3 && movement.stage === DELIVERY ? (
          <DeliveryCancelDrafts movement={movement} canViewReceipts={canViewReceipts} />
        ) : null}
      </CancelReasonModal>

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

/** The two ways into the card's containers: both list what is at the From, so both wait for one. */
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

/** A value on a record: label above, text below - never a disabled input. A hint says why it cannot change. */
function ViewField({ label, value, dimmed, hint }: { label: string; value: string | null; dimmed?: boolean; hint?: string }) {
  return (
    <div>
      <Text fz="sm" fw={500} mb={2}>
        {label}
      </Text>
      <Text fz="sm" c={dimmed || !value ? 'dimmed' : undefined}>
        {value ?? '—'}
      </Text>
      {hint ? (
        <Text fz="xs" c="dimmed" mt={2} data-from-locked>
          {hint}
        </Text>
      ) : null}
    </div>
  )
}
