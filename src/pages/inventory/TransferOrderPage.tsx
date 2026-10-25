import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Alert, Button, Group, Loader, Paper, Stack, Title } from '@mantine/core'
import {
  IconArrowBackUp,
  IconArrowsExchange,
  IconBan,
  IconCheck,
  IconCircleOff,
  IconLockCheck,
  IconMailForward,
  IconPackageImport,
  IconTrash,
  IconTruck,
  IconTruckDelivery,
  IconX,
} from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { itemsApi } from '../../api/inventory/items'
import {
  transfersApi,
  type SaveTransferOrderRequest,
  type TransferActionResult,
  type TransferAvailabilityDto,
  type TransferFillResult,
  type TransferOrderDto,
  type TransferPostedResult,
  type TransferPostingDto,
} from '../../api/inventory/transfers'
import { warehousesApi } from '../../api/masterdata/warehouses'
import type { ItemListDto, ItemLookupDto, WarehouseLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { AuditTrail } from '../../components/documents/AuditTrail'
import { CancelReasonModal } from '../../components/documents/CancelReasonModal'
import { DocumentActionBar, type DocumentAction } from '../../components/documents/DocumentActionBar'
import { DocumentAttachmentsCard } from '../../components/documents/DocumentAttachmentsCard'
import { DocumentIcons } from '../../components/documents/documentIcons'
import { isoDate } from '../../components/documents/documentKind'
import { QuickItemSearch } from '../../components/documents/QuickItemSearch'
import { formatNumber } from '../../components/format'
import { ImportInvoiceItemsWizard, type ImportedLine } from '../../components/sales/ImportInvoiceItemsWizard'
import { trackingKindOf } from '../../components/tracking/trackingNumbers'
import { AddBelowMinDrawer } from '../../components/transfers/AddBelowMinDrawer'
import { ChangeEtaModal } from '../../components/transfers/ChangeEtaModal'
import { DispatchTransferModal, type DispatchMode } from '../../components/transfers/DispatchTransferModal'
import { FillToMaxModal } from '../../components/transfers/FillToMaxModal'
import { ReceiveTransferModal } from '../../components/transfers/ReceiveTransferModal'
import { transferAbilities, type TransferAbility } from '../../components/transfers/transferAbilities'
import { TransferApprovalNotice } from '../../components/transfers/TransferApprovalNotice'
import {
  TransferHeaderCard,
  type TransferHeaderErrors,
  type TransferHeaderValue,
} from '../../components/transfers/TransferHeaderCard'
import { TransferLinesGrid } from '../../components/transfers/TransferLinesGrid'
import { TransferLinesToolbar } from '../../components/transfers/TransferLinesToolbar'
import { levelsBefore, NO_LEVELS, showsLevels, withLevelsAfter } from '../../components/transfers/transferLevels'
import {
  APPROVE_TEXT,
  backToDraftText,
  CANCEL_ORDER_TEXT,
  createReturnText,
  emptyTransferLine,
  nextLineKey,
  nothingMoreSentText,
  orderLabel,
  REJECT_TEXT,
  RELEASE_TEXT,
  reverseText,
  SEND_FOR_APPROVAL_TEXT,
  toTransferLineForm,
  totalsOfLines,
  transferWarehouseChoices,
  unitForScan,
  warehouseCodeOf,
  type TransferLineForm,
  type TransferUnitOption,
} from '../../components/transfers/transferModel'
import { TransferPostingsCard } from '../../components/transfers/TransferPostingsCard'
import { confirm, confirmAction } from '../../components/ui/confirm'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { useDocumentTypes } from '../../hooks/useDocumentTypes'
import { refreshTransfersWaiting } from '../../hooks/useTransfersWaiting'
import { PERMISSIONS } from '../../navigation'
import { routes } from '../../routes'
import { ForbiddenPage } from '../ForbiddenPage'

const EMPTY_HEADER: TransferHeaderValue = {
  documentDate: isoDate(new Date()),
  fromWarehouseId: null,
  toWarehouseId: null,
  expectedArrival: null,
  referenceNo: '',
  notes: '',
}

/** The dialogs that ask for a reason (CancelReasonModal), and the posting a reversal is about. */
type ReasonDialog =
  | { kind: 'reject' | 'backToDraft' | 'nothingMoreSent' | 'cancel' }
  | { kind: 'reverse'; posting: TransferPostingDto }

/** The other dialogs of the page. */
type Dialog =
  | { kind: 'dispatch'; mode: DispatchMode }
  | { kind: 'receive' }
  | { kind: 'eta'; posting: TransferPostingDto }
  | { kind: 'import' }
  /* (91) The lines toolbar: the Fill to Max preview, and the drawer of To's items below Min. */
  | { kind: 'fillToMax' }
  | { kind: 'addBelowMin' }

/** The five figures of where an item stands, empty while not known. */
const NO_AVAILABILITY = {
  onHandFromBase: null,
  committedFromBase: null,
  availableFromBase: null,
  onHandToBase: null,
  incomingToBase: null,
} as const

/**
 * Focuses an input that a state change is about to draw: a few short retries, because the row is committed by React
 * on its own schedule and the scanner box takes the focus back right after each scan.
 */
function focusWhenDrawn(selector: string, attempt = 0) {
  const input = document.querySelector<HTMLInputElement>(selector)
  if (input) {
    input.focus()
    input.select()
    return
  }
  if (attempt < 10) window.setTimeout(() => focusWhenDrawn(selector, attempt + 1), 40)
}

const focusQuantity = (key: string) => focusWhenDrawn(`[data-transfer-line-qty="${key}"] input`)
const focusItem = (index: number) => focusWhenDrawn(`[data-transfer-line-item="${index}"] input`)

/** The units a line may take, from the item's details (the barcode is how a scanned box finds its unit). */
function unitOptions(units: TransferUnitOption[]): TransferUnitOption[] {
  return units.map((u) => ({
    id: u.id,
    unitTypeName: u.unitTypeName,
    packingFormula: u.packingFormula || 1,
    isBaseUnit: u.isBaseUnit,
    barcode: u.barcode ?? null,
  }))
}

/** A refusal about someone else's change: the page reads the order again. */
function isStale(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === 'CONCURRENCY' || (error.status === 409 && /modified by another user/i.test(error.message)))
  )
}

/**
 * One transfer order (script 90, 2.6.3): stock moved from one warehouse (From) to another (To), of any branch, without
 * changing its cost - a draft typed and released (or sent for approval), then dispatched and received in as many parts
 * as the trucks need, and afterwards read, closed, cancelled or reversed.
 *
 * THE MODE IS THE STATUS. A draft is a form (its warehouses, its lines); once released only its details can change
 * (rule T9) and every posting is a dialog that posts at once - there is no draft dispatch or receipt.
 *
 * TWO SOURCES FOR EVERY BUTTON (transferAbilities.ts): the reader's permissions hide, the server's rules disable with
 * its own sentence. And one rule of the page's: an action that answers with the order as the server holds it is
 * disabled with "Save your changes first." while something typed is not saved.
 *
 * `/new` and `/:id` render this same page, so the first save turns one into the other without a remount (as the goods
 * receipt does); the view permission lets the reader in, `/new` also needs the create one, checked here.
 */
export function TransferOrderPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { hasPermission } = useAuth()

  const orderId = id && id !== 'new' ? Number(id) : null
  const isNew = orderId === null

  const canCreate = hasPermission(PERMISSIONS.transfersCreate)
  const canApprove = hasPermission(PERMISSIONS.transfersApprove)
  // Value figures arrive null without it (the server strips them); the column is then not shown at all.
  const canSeeValues = hasPermission(PERMISSIONS.valuationView)

  /* THE TRO TYPE answers for a NEW order: whether it needs approval, and when it is numbered. A loaded order carries
     its own. An API older than script 90 sends no `needsApproval`, which reads as "no approval". */
  const { byCode } = useDocumentTypes()
  const troType = byCode('TRO')
  const typeNeedsApproval = troType?.needsApproval === true

  const [loadError, setLoadError] = useState<string | null>(null)
  const [order, setOrder] = useState<TransferOrderDto | null>(null)
  const orderRef = useRef<TransferOrderDto | null>(null)
  const [saving, setSaving] = useState(false)

  const [header, setHeader] = useState<TransferHeaderValue>(EMPTY_HEADER)
  const [errors, setErrors] = useState<TransferHeaderErrors>({})
  const [lines, setLines] = useState<TransferLineForm[]>([])
  /* The lines as last drawn, for a scan whose item details arrive after another scan was already added: it must see
     that line (and add 1 to it), not the lines of the render it started from. */
  const linesRef = useRef<TransferLineForm[]>(lines)
  useEffect(() => {
    linesRef.current = lines
  }, [lines])
  const [warehouses, setWarehouses] = useState<WarehouseLookupDto[]>([])
  const [items, setItems] = useState<ItemLookupDto[]>([])
  /** Where the draft's items stand at From and To, for the From / To on screen ("from|to" is the key it was read for). */
  const [availability, setAvailability] = useState<{
    key: string
    byItem: Map<number, TransferAvailabilityDto>
  } | null>(null)
  /** The order lines ticked in the grid: the Dispatch dialog's preselection. */
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [fileCount, setFileCount] = useState(0)

  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [reasonDialog, setReasonDialog] = useState<ReasonDialog | null>(null)
  const [reasonBusy, setReasonBusy] = useState(false)
  const [reasonError, setReasonError] = useState<string | null>(null)
  /** The action bar's "Add document…": each bump opens the Documents card's popup. */
  const [addDocument, setAddDocument] = useState(0)
  const documentsRef = useRef<HTMLDivElement>(null)

  /** Set by every edit, cleared by every save. What the navigation guard asks about. */
  const dirty = useRef(false)
  const [isDirty, setIsDirty] = useState(false)
  const markDirty = () => {
    dirty.current = true
    setIsDirty(true)
  }
  const markClean = () => {
    dirty.current = false
    setIsDirty(false)
  }

  const fromId = header.fromWarehouseId === null ? null : Number(header.fromWarehouseId)
  const toId = header.toWarehouseId === null ? null : Number(header.toWarehouseId)

  const abilities = transferAbilities(order, hasPermission, {
    dirty: isDirty,
    needsApproval: typeNeedsApproval,
    fromWarehouseId: fromId,
  })
  const status = order?.status ?? 'Draft'
  const isDraft = status === 'Draft'
  // A saved order is a form only once it is on screen (and a draft the reader may change).
  const editable = (isNew || order !== null) && abilities.editLines.visible && abilities.editLines.blockedBy === null
  const label = orderLabel(order)

  /* ── loading ──────────────────────────────────────────────────────────────────────────────── */

  /** Every draft line can still change its unit (and a scan finds its box): the item's whole unit list. */
  const loadLineUnits = useCallback(async (itemIds: number[]) => {
    const distinct = [...new Set(itemIds)]
    if (distinct.length === 0) return
    const lists = await Promise.all(
      distinct.map(async (itemId) => {
        try {
          return [itemId, unitOptions((await itemsApi.get(itemId)).units)] as const
        } catch {
          return [itemId, null] as const
        }
      }),
    )
    const byItem = new Map(lists.filter((entry): entry is readonly [number, TransferUnitOption[]] => entry[1] !== null))
    setLines((current) =>
      current.map((line) =>
        line.itemId !== null && byItem.has(line.itemId) ? { ...line, units: byItem.get(line.itemId)! } : line,
      ),
    )
  }, [])

  const countFiles = useCallback(async (id: number) => {
    try {
      setFileCount((await transfersApi.files.list(id)).length)
    } catch {
      /* the count catches up on the next load; the card lists the files itself */
    }
  }, [])

  const applyOrder = useCallback(
    (doc: TransferOrderDto) => {
      orderRef.current = doc
      setOrder(doc)
      setHeader({
        documentDate: doc.documentDate,
        fromWarehouseId: String(doc.from.id),
        toWarehouseId: String(doc.to.id),
        expectedArrival: doc.expectedArrival,
        referenceNo: doc.referenceNo ?? '',
        notes: doc.notes ?? '',
      })
      setLines(doc.lines.map(toTransferLineForm))
      setErrors({})
      setAvailability(null)
      // A ticked line that has nothing left to dispatch is no longer a choice.
      setSelected(
        (current) =>
          new Set([...current].filter((lineId) => doc.lines.some((l) => l.id === lineId && l.toDispatchBase > 0))),
      )
      markClean()
      if (doc.status === 'Draft') void loadLineUnits(doc.lines.map((l) => l.itemId))
    },
    [loadLineUnits],
  )

  const reload = useCallback(async () => {
    if (orderId === null) return
    try {
      applyOrder(await transfersApi.get(orderId))
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The transfer order could not be refreshed.')
    }
  }, [orderId, applyOrder])

  useEffect(() => {
    if (orderId === null) return
    // Just created and already on screen (/new became /:id): nothing to read again.
    if (orderRef.current?.id === orderId) return
    let cancelled = false
    transfersApi
      .get(orderId)
      .then((doc) => {
        if (!cancelled) {
          applyOrder(doc)
          setLoadError(null)
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadError(
          error instanceof ApiError && error.status === 404
            ? 'This transfer order does not exist.'
            : error instanceof ApiError
              ? error.message
              : 'The transfer order could not be loaded.',
        )
      })
    return () => {
      cancelled = true
    }
  }, [orderId, applyOrder])

  /** Still reading the order the route names (a new order has nothing to read). */
  const loading = orderId !== null && order?.id !== orderId && loadError === null

  useEffect(() => {
    if (orderId === null) return
    let cancelled = false
    transfersApi.files
      .list(orderId)
      .then((files) => {
        if (!cancelled) setFileCount(files.length)
      })
      .catch(() => {
        /* the count catches up on the next load; the card lists the files itself */
      })
    return () => {
      cancelled = true
    }
  }, [orderId])

  /* EVERY WAREHOUSE, ACTIVE OR NOT, read once: the pickers offer the active leaves of every branch, and keep the
     order's own warehouse (made inactive since) on screen, marked. The lookup never returns an On the way one. */
  useEffect(() => {
    let cancelled = false
    warehousesApi
      .lookup(false)
      .then((rows) => {
        if (!cancelled) setWarehouses(rows)
      })
      .catch(() => notify.error('Warehouses could not be loaded.'))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!editable) return
    let cancelled = false
    itemsApi
      .lookup(true)
      .then((rows) => {
        if (!cancelled) setItems(rows)
      })
      .catch(() => {
        /* the Item select is then empty; the quick search still works */
      })
    return () => {
      cancelled = true
    }
  }, [editable])

  /* A FILE ADDED, EDITED OR DELETED changes only the files and the audit trail: the count and the trail come from a
     fresh read, and what is being typed stays (a file does not touch the order's row). */
  const filesChanged = useCallback(async () => {
    if (orderId === null) return
    void countFiles(orderId)
    try {
      const fresh = await transfersApi.get(orderId)
      setOrder((current) => (current && current.id === fresh.id ? { ...current, audit: fresh.audit } : current))
    } catch {
      /* the trail catches up on the next load */
    }
  }, [orderId, countFiles])

  /* ── where the draft's items stand ────────────────────────────────────────────────────────── */

  /* RE-ASKED WHEN AN ITEM, FROM OR TO CHANGES (2.6.3): "Available at From" and "Stock at To" of the draft's items.
     Information only - nothing is reserved. The order being edited is left out of what other orders promise. */
  const endsKey = `${fromId ?? ''}|${toId ?? ''}`
  const itemKey = useMemo(
    () =>
      [...new Set(lines.map((l) => l.itemId).filter((itemId): itemId is number => itemId !== null))]
        .sort((a, b) => a - b)
        .join(','),
    [lines],
  )
  const savedOrderId = order?.id ?? null
  useEffect(() => {
    if (!editable || fromId === null || toId === null || fromId === toId || itemKey === '') return
    const controller = new AbortController()
    transfersApi
      .availability(
        {
          fromWarehouseId: fromId,
          toWarehouseId: toId,
          itemIds: itemKey.split(',').map(Number),
          excludeOrderId: savedOrderId,
        },
        controller.signal,
      )
      .then((rows) => setAvailability({ key: `${fromId}|${toId}`, byItem: new Map(rows.map((r) => [r.itemId, r])) }))
      .catch(() => {
        /* the columns keep a dash; the server still checks the stock at dispatch */
      })
    return () => controller.abort()
  }, [editable, fromId, toId, itemKey, savedOrderId])

  /**
   * The lines as shown: a draft's figures follow the From / To on screen; a released order's are the server's.
   * (91) A draft's Projected at To and From's figure after the order are worked out from what its form orders now
   * (transferLevels.ts `withLevelsAfter`): where To and From stand without it, plus the item's lines as typed.
   */
  const sameEnds = order !== null && fromId === order.from.id && toId === order.to.id
  const fresh = editable && availability && availability.key === endsKey ? availability.byItem : null
  const shownLines = !editable
    ? lines
    : withLevelsAfter(
        lines.map((line) => {
          const answer = fresh && line.itemId !== null ? fresh.get(line.itemId) : undefined
          if (answer) {
            return {
              ...line,
              onHandFromBase: answer.onHandFromBase,
              committedFromBase: answer.committedFromBase,
              availableFromBase: answer.availableFromBase,
              onHandToBase: answer.onHandToBase,
              incomingToBase: answer.incomingToBase,
              ...levelsBefore(answer),
            }
          }
          return sameEnds ? line : { ...line, ...NO_AVAILABILITY, ...NO_LEVELS }
        }),
      )

  /* ── the warehouses offered ───────────────────────────────────────────────────────────────── */

  const firstBranchId = order?.branchId ?? warehouses.find((w) => w.id === fromId)?.branchId ?? null
  const warehouseData = useMemo(
    () => transferWarehouseChoices(warehouses, [order?.from, order?.to], firstBranchId),
    [warehouses, order?.from, order?.to, firstBranchId],
  )
  /* (92) THE FROM IS THE READER'S (A9): the order is the source's document, so its From offers only the warehouses the
     reader may use (a held one kept, marked "- not one of your warehouses"); the To stays every leaf of every branch.
     Every button keeps reading the server's abilities, which carry the access rule (Blocks). */
  const fromWarehouseData = useMemo(
    // Only the order's own From is kept: its To, kept in the To list, would be offered here marked "- not one of your
    // warehouses", a choice that can only be refused.
    () => transferWarehouseChoices(warehouses, [order?.from], firstBranchId, true),
    [warehouses, order?.from, firstBranchId],
  )
  const fromCode = warehouseCodeOf(header.fromWarehouseId, warehouses, order?.from)
  const toCode = warehouseCodeOf(header.toWarehouseId, warehouses, order?.to)

  /* ── editing ──────────────────────────────────────────────────────────────────────────────── */

  function changeHeader(patch: Partial<TransferHeaderValue>) {
    markDirty()
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch) as (keyof TransferHeaderValue)[]) delete next[key]
      return next
    })
    setHeader((current) => ({ ...current, ...patch }))
  }

  const patchLine = useCallback((key: string, patch: Partial<TransferLineForm>) => {
    markDirty()
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch, error: undefined } : line)))
  }, [])

  /** An item picked on a line: its units (the base unit first chosen) and, through the effect above, where it stands. */
  const chooseItem = useCallback(async (key: string, itemId: number) => {
    markDirty()
    try {
      const details = await itemsApi.get(itemId)
      const units = unitOptions(details.units)
      const base = units.find((u) => u.isBaseUnit) ?? units[0]
      setLines((current) =>
        current.map((line) =>
          line.key === key
            ? {
                ...line,
                itemId: details.id,
                itemCode: details.itemCode,
                itemName: details.itemName,
                units,
                itemUnitId: base?.id ?? null,
                unitName: base?.unitTypeName ?? '',
                packingFormula: base?.packingFormula ?? 1,
                ...NO_AVAILABILITY,
                ...NO_LEVELS,
                // (93) The new item's tracking at once (the item's answer carries it): a line changed to another item
                // never keeps the old one's badge until the draft is saved.
                trackingKind: trackingKindOf(details.trackingMode, details.requiresExpiry),
                requiresExpiry: details.requiresExpiry === true,
                error: undefined,
              }
            : line,
        ),
      )
      focusQuantity(key)
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The item could not be loaded.')
    }
  }, [])

  /**
   * A scanned item becomes a line, in the unit whose barcode was scanned (a box's barcode scans the box), else the base
   * unit (decision D10) - or, when that item and unit are already on the order, one more of it: somebody counting twelve
   * boxes scans twelve times.
   */
  async function addScanned(item: ItemListDto, term: string) {
    markDirty()
    let details
    try {
      details = await itemsApi.get(item.id)
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The item could not be loaded.')
      return
    }
    const units = unitOptions(details.units)
    const unit = unitForScan(units, term)
    if (!unit) {
      notify.error(`${details.itemCode} has no units configured.`)
      return
    }
    const existing = linesRef.current.find((l) => l.itemId === details.id && l.itemUnitId === unit.id)
    if (existing) {
      // One more of what is on the line NOW (another scan may have added to it meanwhile).
      setLines((current) =>
        current.map((line) =>
          line.key === existing.key ? { ...line, quantity: line.quantity + 1, error: undefined } : line,
        ),
      )
      focusQuantity(existing.key)
      return
    }
    const key = nextLineKey()
    const added: TransferLineForm = {
      ...emptyTransferLine(),
      key,
      itemId: details.id,
      itemCode: details.itemCode,
      itemName: details.itemName,
      units,
      itemUnitId: unit.id,
      unitName: unit.unitTypeName,
      packingFormula: unit.packingFormula || 1,
    }
    // Seen at once by the next scan, before React draws the line.
    linesRef.current = [...linesRef.current, added]
    setLines((current) => [...current, added])
    focusQuantity(key)
  }

  function addLine() {
    markDirty()
    setLines((current) => [...current, emptyTransferLine()])
    focusItem(lines.length)
  }

  function removeLine(key: string) {
    markDirty()
    setLines((current) => current.filter((line) => line.key !== key))
  }

  /**
   * The Valid and Warning rows of an imported file, appended to the draft: a row of an item and unit already on it adds
   * its quantity to that line (2.6.4). Nothing is saved until the order is.
   */
  function appendImported(imported: ImportedLine[], fileName: string) {
    markDirty()
    const next = [...lines]
    const newItems: number[] = []
    for (const row of imported) {
      const same = next.findIndex((l) => l.itemId === row.itemId && l.itemUnitId === row.itemUnitId)
      if (same >= 0) {
        next[same] = { ...next[same], quantity: next[same].quantity + row.quantity, error: undefined }
        continue
      }
      next.push({
        ...emptyTransferLine(),
        itemId: row.itemId,
        itemCode: row.itemCode,
        itemName: row.itemName,
        itemUnitId: row.itemUnitId,
        unitName: row.unitTypeName,
        packingFormula: row.packingFormula || 1,
        quantity: row.quantity,
        notes: row.notes ?? '',
        units: [
          {
            id: row.itemUnitId,
            unitTypeName: row.unitTypeName,
            packingFormula: row.packingFormula || 1,
            isBaseUnit: row.packingFormula === 1,
          },
        ],
      })
      newItems.push(row.itemId)
    }
    setLines(next)
    void loadLineUnits(newItems)
    const count = imported.length
    notify.success(
      `${formatNumber(count)} line${count === 1 ? '' : 's'} added from ${fileName}. Save the order to keep them.`,
    )
  }

  /* ── saving ───────────────────────────────────────────────────────────────────────────────── */

  /**
   * What saves a round trip, in the server's own words where it has them (2.3.8.4): the date, the two warehouses, a
   * line half typed. The rest - an inactive warehouse or item, a unit of another item - is the server's, shown as it
   * comes. A draft may have no line yet.
   */
  function validate(): boolean {
    const next: TransferHeaderErrors = {}
    if (!header.documentDate) next.documentDate = 'Order date is required.'
    if (fromId === null) next.fromWarehouseId = 'Choose the warehouse the goods leave from.'
    if (toId === null) next.toWarehouseId = 'Choose the warehouse the goods go to.'
    else if (fromId !== null && fromId === toId) next.toWarehouseId = 'The destination must differ from the source.'
    if (header.expectedArrival && header.documentDate && header.expectedArrival < header.documentDate) {
      next.expectedArrival = 'Expected arrival cannot be before the order date.'
    }
    setErrors(next)
    const first = Object.values(next)[0]
    if (first) {
      notify.error(first)
      return false
    }
    const problems = new Map<string, string>()
    lines.forEach((line, index) => {
      if (!line.itemId || !line.itemUnitId || line.quantity < 1) {
        problems.set(line.key, `Line ${index + 1} needs an item, a unit and a quantity of at least 1.`)
      }
    })
    if (problems.size > 0) {
      setLines((current) => current.map((line) => ({ ...line, error: problems.get(line.key) })))
      notify.error([...problems.values()][0]!)
      return false
    }
    return true
  }

  function toRequest(): SaveTransferOrderRequest {
    return {
      documentDate: header.documentDate,
      fromWarehouseId: fromId!,
      toWarehouseId: toId!,
      expectedArrival: header.expectedArrival,
      referenceNo: header.referenceNo.trim() || null,
      notes: header.notes.trim() || null,
      rowVersion: order?.rowVersion ?? null,
      lines: lines.map((line, index) => ({
        lineNumber: index + 1,
        itemId: line.itemId!,
        itemUnitId: line.itemUnitId!,
        quantity: line.quantity,
        notes: line.notes.trim() || null,
      })),
    }
  }

  /**
   * A refusal where it belongs: "Line 3: …" on line 3, the date and warehouse sentences on their fields, and always as
   * a notification too (the row may be scrolled away). An order changed by someone else is read again.
   */
  function showApiError(error: unknown, fallback: string) {
    notify.error(markApiError(error, fallback))
  }

  /** The marks of a refusal on the page (its line, its field; the order read again when stale): its sentence back. */
  function markApiError(error: unknown, fallback: string): string {
    if (!(error instanceof ApiError)) return fallback
    const message = error.message
    const match = /^Line (\d+)/.exec(message)
    setLines((current) =>
      current.map((line, index) => ({ ...line, error: match && index === Number(match[1]) - 1 ? message : undefined })),
    )

    const fields: TransferHeaderErrors = {}
    // "Expected arrival cannot be before the order date." is Expected arrival's alone.
    if (/order date/i.test(message) && !match && !/^Expected arrival/.test(message)) fields.documentDate = message
    if (/^Expected arrival/.test(message)) fields.expectedArrival = message
    if (/leave from\.$/.test(message)) fields.fromWarehouseId = message
    if (/go to\.$/.test(message) || /destination must differ/.test(message)) fields.toWarehouseId = message
    // "LKS-01 is an On the way warehouse…", "Warehouse LUB is inactive.", "…has warehouses under it…": by its code.
    if (/On the way warehouse|inactive|has warehouses under it|was not found/.test(message) && !match) {
      const names = (code: string | null) =>
        code !== null && new RegExp(`(^|\\s)${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|:|\\.|$)`).test(message)
      if (names(fromCode)) fields.fromWarehouseId = message
      else if (names(toCode)) fields.toWarehouseId = message
    }
    if (Object.keys(fields).length > 0) setErrors((current) => ({ ...current, ...fields }))

    if (isStale(error)) void reload()
    return message
  }

  async function save(): Promise<TransferOrderDto | null> {
    if (!validate()) return null
    setSaving(true)
    try {
      const saved =
        orderId === null ? await transfersApi.create(toRequest()) : await transfersApi.update(orderId, toRequest())
      applyOrder(saved)
      notify.success(orderId === null ? 'Draft created.' : 'Draft saved.')
      // /new becomes /:id, replacing the history entry: Back leaves the page rather than returning to a blank form.
      if (orderId === null) void navigate(routes.transferOrder(saved.id), { replace: true })
      return saved
    } catch (error) {
      showApiError(error, 'The transfer order could not be saved.')
      return null
    } finally {
      setSaving(false)
    }
  }

  /** "Save details" of an order that is no longer a draft (rule T9): Expected arrival, Reference No., Notes. */
  async function saveDetails() {
    if (!order) return
    if (header.expectedArrival && header.expectedArrival < order.documentDate) {
      setErrors({ expectedArrival: 'Expected arrival cannot be before the order date.' })
      notify.error('Expected arrival cannot be before the order date.')
      return
    }
    setSaving(true)
    try {
      applyOrder(
        await transfersApi.updateDetails(order.id, {
          expectedArrival: header.expectedArrival,
          referenceNo: header.referenceNo.trim() || null,
          notes: header.notes.trim() || null,
          rowVersion: order.rowVersion,
        }),
      )
      notify.success('Details saved.')
    } catch (error) {
      showApiError(error, 'The details could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  /* ── the actions ──────────────────────────────────────────────────────────────────────────── */

  /** An answer that carries the order again: it replaces the page's copy, and what the server says is shown as it comes. */
  function applyResult(result: TransferActionResult) {
    applyOrder(result.order)
    notify.success(result.message)
    for (const warning of result.warnings) notify.warning(warning)
    if (result.emailWarning) notify.warning(result.emailWarning)
  }

  /**
   * One confirmed action: the question, the call, its answer. Enter confirms; a refusal stays in the dialog as it
   * comes (2.6.4), and is marked on the page too (its line, its field; the order read again when stale).
   */
  async function confirmed(
    question: { title: string; message: string; confirmLabel: string; danger?: boolean },
    call: () => Promise<TransferActionResult>,
    fallback: string,
    afterwards?: () => void,
  ) {
    const result = await confirmAction({ ...question, run: busyWhile(call), describeError: (error) => markApiError(error, fallback) })
    if (!result) return
    applyResult(result)
    afterwards?.()
  }

  /** The call with the page marked busy while it runs (not while its question waits for an answer). */
  function busyWhile<T>(call: () => Promise<T>): () => Promise<T> {
    return async () => {
      setSaving(true)
      try {
        return await call()
      } finally {
        setSaving(false)
      }
    }
  }

  const waitingChanged = () => void refreshTransfersWaiting()

  function release() {
    if (!order) return
    void confirmed(
      { title: `Release ${label}?`, message: RELEASE_TEXT, confirmLabel: 'Release' },
      () => transfersApi.release(order.id, order.rowVersion),
      'The transfer order could not be released.',
    )
  }

  function sendForApproval() {
    if (!order) return
    void confirmed(
      { title: `Send ${label} for approval?`, message: SEND_FOR_APPROVAL_TEXT, confirmLabel: 'Send for approval' },
      () => transfersApi.sendForApproval(order.id, order.rowVersion),
      'The transfer order could not be sent for approval.',
      waitingChanged,
    )
  }

  /** Approve a waiting order, or Approve & release a draft (an approver, "Approved directly"): the same route. */
  function approve() {
    if (!order) return
    void confirmed(
      {
        title: `Approve ${label}?`,
        message: APPROVE_TEXT,
        confirmLabel: order.status === 'Draft' ? 'Approve & release' : 'Approve',
      },
      () => transfersApi.approve(order.id, order.rowVersion),
      'The transfer order could not be approved.',
      waitingChanged,
    )
  }

  function withdraw() {
    if (!order) return
    void confirmed(
      { title: 'Withdraw the request?', message: `${label} goes back to draft.`, confirmLabel: 'Withdraw' },
      () => transfersApi.withdraw(order.id, order.rowVersion),
      'The request could not be withdrawn.',
      waitingChanged,
    )
  }

  async function createReturn() {
    if (!order) return
    const created = await confirmAction({
      title: `Create a return of ${label}?`,
      message: createReturnText(order),
      confirmLabel: 'Create return',
      run: busyWhile(() => transfersApi.createReturn(order.id)),
      describeError: (error) => markApiError(error, 'The return could not be created.'),
    })
    if (!created) return
    notify.success('Draft created.')
    void navigate(routes.transferOrder(created.id))
  }

  async function remove() {
    if (!order) return
    const deleted = await confirmAction({
      title: `Delete draft ${order.documentNumber ?? `#${order.id}`}?`,
      message: 'Its number is not reused.',
      confirmLabel: 'Delete',
      danger: true,
      run: busyWhile(async () => {
        await transfersApi.remove(order.id, order.rowVersion)
        return true
      }),
      describeError: (error) => markApiError(error, 'The draft could not be deleted.'),
    })
    if (!deleted) return
    markClean()
    notify.success('Draft deleted.')
    void navigate(routes.transferOrders)
  }

  async function exportToExcel() {
    if (!order) return
    try {
      await transfersApi.exportToExcel(order.id, `${order.documentNumber ?? `TRO-draft-${order.id}`}.xlsx`)
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The transfer order could not be exported.')
    }
  }

  /** The reason dialogs: the call for each, its answer replacing the order; a refusal stays in the dialog. */
  async function confirmReason(reason: string, date: string | null) {
    const current = reasonDialog
    if (!order || !current) return
    const call = (): Promise<TransferActionResult> => {
      switch (current.kind) {
        case 'reject':
          return transfersApi.reject(order.id, order.rowVersion, reason)
        case 'backToDraft':
          return transfersApi.backToDraft(order.id, order.rowVersion, reason)
        case 'nothingMoreSent':
          return transfersApi.nothingMoreSent(order.id, order.rowVersion, reason)
        case 'cancel':
          return transfersApi.cancel(order.id, order.rowVersion, reason)
        case 'reverse':
          return transfersApi.reversePosting(order.id, current.posting.id, {
            rowVersion: order.rowVersion,
            reason,
            date,
          })
      }
    }
    setReasonBusy(true)
    setReasonError(null)
    try {
      applyResult(await call())
      // The menu count: a rejection leaves the approvers' list; (92) a reversal, "Nothing more will be sent" or a
      // cancel changes what is on the way to the reader's warehouses.
      waitingChanged()
      setReasonDialog(null)
    } catch (error) {
      setReasonError(error instanceof ApiError ? error.message : 'The transfer order could not be changed.')
      if (isStale(error)) void reload()
    } finally {
      setReasonBusy(false)
    }
  }

  function openReason(next: ReasonDialog) {
    setReasonError(null)
    setReasonDialog(next)
  }

  function posted(result: TransferPostedResult) {
    applyOrder(result.order)
    setSelected(new Set())
    setDialog(null)
    // (92) A dispatch or a receipt changes what is on the way to the reader's warehouses: the menu count at once.
    waitingChanged()
  }

  /** (91) Fill to Max or Add items below Min applied: the order as it now stands, then what the server says. */
  function filled(result: TransferFillResult) {
    if (result.order) applyOrder(result.order)
    else void reload()
    setDialog(null)
    notify.success(result.message)
    for (const warning of result.warnings) notify.warning(warning)
  }

  /** Leaving the page (Back, the dispatch note): asks first when something typed is not saved. */
  async function leaveTo(to: string) {
    if (dirty.current) {
      const go = await confirm({
        title: 'Leave without saving?',
        message: 'This transfer order has changes that have not been saved. Leaving now discards them.',
        confirmLabel: 'Discard',
        danger: true,
      })
      if (!go) return
    }
    markClean()
    void navigate(to)
  }

  /* The browser's own guard, for a tab close or a reload - which React Router never sees. */
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  /* ── render ───────────────────────────────────────────────────────────────────────────────── */

  // "New" needs the create permission, which the route (view) does not check.
  if (isNew && !canCreate) return <ForbiddenPage />

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
        <PageHeader title="Transfer Order" />
        <Alert color="red">{loadError}</Alert>
        <Group>
          <Button variant="default" onClick={() => void navigate(routes.transferOrders)}>
            Back to Transfer Orders
          </Button>
        </Group>
      </Stack>
    )
  }

  /** What an ability makes of a bar action: hidden, disabled with the reason, or the page's next step. */
  const shown = (ability: TransferAbility) => ({
    visible: ability.visible,
    disabled: ability.blockedBy !== null || saving,
    disabledReason: ability.blockedBy ?? undefined,
    variant: ability.primary ? ('filled' as const) : undefined,
    pinnedOnPhone: ability.pinnedOnPhone,
    menuWhenDisabled: ability.menuWhenDisabled,
  })

  const always: DocumentAction[] = [
    {
      key: 'documents',
      label: `Documents (${formatNumber(fileCount)})`,
      icon: DocumentIcons.documents,
      onClick: () => documentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    },
    {
      key: 'add-document',
      label: 'Add document…',
      icon: DocumentIcons.addDocument,
      onClick: () => setAddDocument((n) => n + 1),
      ...shown(abilities.addDocument),
    },
    {
      key: 'export',
      label: 'Export to Excel',
      icon: DocumentIcons.exportFile,
      onClick: () => void exportToExcel(),
      ...shown(abilities.exportToExcel),
    },
  ]
  const back: DocumentAction = {
    key: 'back',
    label: 'Back',
    icon: DocumentIcons.back,
    onClick: () => void leaveTo(routes.transferOrders),
  }

  /* BY STORED STATUS (2.6.3), the next step last: on a phone the filled one is the big button. */
  const actions: DocumentAction[] = isDraft
    ? [
        ...always,
        {
          key: 'import',
          label: 'Import lines from Excel…',
          icon: DocumentIcons.import,
          onClick: () => setDialog({ kind: 'import' }),
          ...shown(abilities.importLines),
        },
        {
          key: 'delete',
          label: 'Delete',
          icon: <IconTrash size={16} />,
          colour: 'red',
          onClick: () => void remove(),
          ...shown(abilities.remove),
        },
        back,
        {
          key: 'save',
          label: 'Save',
          icon: DocumentIcons.save,
          onClick: () => void save(),
          ...shown(abilities.save),
          loading: saving,
        },
        {
          key: 'release',
          label: 'Release',
          icon: <IconLockCheck size={16} />,
          onClick: () => release(),
          ...shown(abilities.release),
        },
        {
          key: 'send-for-approval',
          label: 'Send for approval…',
          icon: <IconMailForward size={16} />,
          onClick: () => sendForApproval(),
          ...shown(abilities.sendForApproval),
        },
        {
          key: 'approve-and-release',
          label: 'Approve & release',
          icon: <IconCheck size={16} />,
          colour: 'green',
          onClick: () => approve(),
          ...shown(abilities.approveAndRelease),
        },
      ]
    : status === 'PendingApproval'
      ? [
          ...always,
          back,
          {
            key: 'withdraw',
            label: 'Withdraw',
            icon: <IconArrowBackUp size={16} />,
            onClick: () => withdraw(),
            ...shown(abilities.withdraw),
          },
          {
            key: 'reject',
            label: 'Reject…',
            icon: <IconX size={16} />,
            colour: 'red',
            onClick: () => openReason({ kind: 'reject' }),
            ...shown(abilities.reject),
          },
          {
            key: 'approve',
            label: 'Approve',
            icon: <IconCheck size={16} />,
            colour: 'green',
            onClick: () => approve(),
            ...shown(abilities.approve),
          },
        ]
      : [
          ...always,
          {
            key: 'create-return',
            label: 'Create return…',
            icon: <IconArrowsExchange size={16} />,
            onClick: () => void createReturn(),
            ...shown(abilities.createReturn),
          },
          {
            key: 'cancel',
            label: 'Cancel order…',
            icon: <IconBan size={16} />,
            colour: 'red',
            onClick: () => openReason({ kind: 'cancel' }),
            ...shown(abilities.cancel),
          },
          {
            key: 'back-to-draft',
            label: 'Back to draft…',
            icon: <IconArrowBackUp size={16} />,
            onClick: () => openReason({ kind: 'backToDraft' }),
            ...shown(abilities.backToDraft),
          },
          {
            key: 'nothing-more-sent',
            label: 'Nothing more will be sent…',
            icon: <IconCircleOff size={16} />,
            onClick: () => openReason({ kind: 'nothingMoreSent' }),
            ...shown(abilities.nothingMoreSent),
          },
          {
            key: 'dispatch-and-receive',
            label: 'Dispatch and receive…',
            icon: <IconTruck size={16} />,
            onClick: () => setDialog({ kind: 'dispatch', mode: 'dispatchAndReceive' }),
            ...shown(abilities.dispatchAndReceive),
          },
          back,
          {
            key: 'receive',
            label: 'Receive…',
            icon: <IconPackageImport size={16} />,
            onClick: () => setDialog({ kind: 'receive' }),
            ...shown(abilities.receive),
          },
          {
            key: 'dispatch',
            label: 'Dispatch…',
            icon: <IconTruckDelivery size={16} />,
            onClick: () => setDialog({ kind: 'dispatch', mode: 'dispatch' }),
            ...shown(abilities.dispatch),
          },
        ]

  const totals =
    isDraft || !order
      ? totalsOfLines(lines)
      : {
          orderedBase: order.totals.orderedBase,
          dispatchedBase: order.totals.dispatchedBase,
          receivedBase: order.totals.receivedBase,
          onTheWayBase: order.totals.onTheWayBase,
          notSentBase: order.totals.notSentBase,
          lostBase: order.totals.lostBase,
        }

  /* RULE T9 ON AN ORDER NO LONGER A DRAFT: "Save details" while the server allows it; Expected arrival and Reference
     No. while it allows them too (not on a received, closed or cancelled order); the Notes with "Save details". */
  const detailsOpen = !isDraft && abilities.saveDetails.visible && abilities.saveDetails.blockedBy === null
  const expectedOpen =
    detailsOpen && abilities.editExpectedArrival.visible && abilities.editExpectedArrival.blockedBy === null
  const notesOpen = !isDraft && abilities.editNotes.visible && abilities.editNotes.blockedBy === null
  const selectable = status === 'Released' && abilities.dispatch.visible
  const title = isNew ? 'New Transfer Order' : `Transfer Order ${order?.documentNumber ?? `draft #${order?.id ?? ''}`}`

  const reverseLabelDate = reasonDialog?.kind === 'reverse' ? reasonDialog.posting.postingDate : null
  const reason = reasonDialog && order ? reasonCopy(reasonDialog, order) : null

  return (
    <Stack>
      <PageHeader title={title} />

      <DocumentActionBar actions={actions} menuTowardsRoom />

      <TransferApprovalNotice order={order} needsApproval={typeNeedsApproval} canApprove={canApprove} />

      <TransferHeaderCard
        value={header}
        onChange={changeHeader}
        order={order}
        numberOnPost={order?.numberOnPost ?? troType?.numberOnPost ?? false}
        draftEditable={editable}
        detailsEditable={expectedOpen}
        notesEditable={notesOpen}
        detailsReason={detailsOpen && !expectedOpen ? abilities.editExpectedArrival.blockedBy : null}
        saveDetails={isDraft ? null : abilities.saveDetails}
        onSaveDetails={() => void saveDetails()}
        savingDetails={saving}
        warehouseData={warehouseData}
        fromWarehouseData={fromWarehouseData}
        errors={errors}
        disabled={saving}
        onOpenOrder={(id) => void leaveTo(routes.transferOrder(id))}
      />

      <Paper radius="lg" p="md" withBorder>
        <Group justify="space-between" align="flex-start" mb="sm" gap="sm" wrap="wrap">
          <Title order={5}>Lines</Title>
          {/* (91) "Add items below Min…" and "Fill to Max…": a draft and the create permission (3.6.5). */}
          {isDraft && (
            <TransferLinesToolbar
              addBelowMin={abilities.addBelowMin}
              fillToMax={abilities.fillToMax}
              onAddBelowMin={() => setDialog({ kind: 'addBelowMin' })}
              onFillToMax={() => setDialog({ kind: 'fillToMax' })}
              busy={saving}
            />
          )}
        </Group>
        {editable && (
          <Group mb="md" align="flex-end">
            <QuickItemSearch onPick={(item, term) => void addScanned(item, term)} disabled={saving} />
          </Group>
        )}
        <TransferLinesGrid
          lines={shownLines}
          editable={editable}
          fromCode={fromCode}
          toCode={toCode}
          items={items}
          onChange={patchLine}
          onRemove={removeLine}
          onAdd={addLine}
          onItemChosen={(key, itemId) => void chooseItem(key, itemId)}
          selectable={selectable}
          selected={selected}
          onToggle={(lineId, checked) =>
            setSelected((current) => {
              const next = new Set(current)
              if (checked) next.add(lineId)
              else next.delete(lineId)
              return next
            })
          }
          totals={totals}
          showLevels={showsLevels(order)}
        />
      </Paper>

      {order && (order.status === 'Released' || order.status === 'Cancelled' || order.postings.length > 0) && (
        <TransferPostingsCard
          orderId={order.id}
          postings={order.postings}
          hasPermission={hasPermission}
          dirty={isDirty}
          showValues={canSeeValues}
          onReverse={(posting) => openReason({ kind: 'reverse', posting })}
          onChangeEta={(posting) => setDialog({ kind: 'eta', posting })}
          onPrint={(posting) => void leaveTo(routes.transferDispatchPrint(order.id, posting.id))}
        />
      )}

      <DocumentAttachmentsCard
        ref={documentsRef}
        documentId={order?.id ?? null}
        documentKind="TRO"
        api={transfersApi.files}
        canAdd={canCreate}
        canRemove={canCreate}
        onChanged={() => void filesChanged()}
        openUpload={addDocument}
      />

      <AuditTrail entries={order?.audit ?? []} wrapLabels />

      {/* ── the dialogs ── */}

      {dialog?.kind === 'dispatch' && order && (
        <DispatchTransferModal
          opened
          order={order}
          mode={dialog.mode}
          preselected={[...selected]}
          onClose={() => setDialog(null)}
          onPosted={posted}
          onStale={() => void reload()}
        />
      )}

      {dialog?.kind === 'receive' && order && (
        <ReceiveTransferModal
          opened
          order={order}
          onClose={() => setDialog(null)}
          onPosted={posted}
          onStale={() => void reload()}
        />
      )}

      {dialog?.kind === 'eta' && order && (
        <ChangeEtaModal
          opened
          order={order}
          posting={dialog.posting}
          onClose={() => setDialog(null)}
          onSaved={(result) => {
            applyOrder(result.order)
            setDialog(null)
          }}
          onStale={() => void reload()}
        />
      )}

      {dialog?.kind === 'fillToMax' && order && (
        <FillToMaxModal
          opened
          order={order}
          onClose={() => setDialog(null)}
          onApplied={filled}
          onStale={() => void reload()}
        />
      )}

      {order && (
        <AddBelowMinDrawer
          opened={dialog?.kind === 'addBelowMin'}
          order={order}
          onClose={() => setDialog(null)}
          onApplied={filled}
          onStale={() => void reload()}
        />
      )}

      {editable && fromId !== null && (
        <ImportInvoiceItemsWizard
          opened={dialog?.kind === 'import'}
          onClose={() => setDialog(null)}
          header={{
            branchId: warehouses.find((w) => w.id === fromId)?.branchId ?? order?.branchId ?? 0,
            warehouseId: fromId,
            warehouseCode: fromCode ?? undefined,
            // A transfer has no money: nothing is priced.
            priceListId: null,
            currencyCode: 'USD',
            decimalPlaces: 2,
          }}
          documentTypeCode="TRO"
          mode="transfer"
          validate={(file) => transfersApi.importValidate(file, fromId)}
          downloadTemplate={() => transfersApi.downloadImportTemplate()}
          onImported={appendImported}
        />
      )}

      <CancelReasonModal
        opened={reasonDialog !== null}
        onClose={() => {
          if (!reasonBusy) setReasonDialog(null)
        }}
        documentLabel={label}
        busy={reasonBusy}
        title={reason?.title}
        description={reason?.description}
        placeholder={reason?.placeholder}
        confirmLabel={reason?.confirmLabel ?? 'Confirm'}
        withDate={reasonDialog?.kind === 'reverse' ? { minDate: reverseLabelDate, label: 'Reversal date' } : undefined}
        onConfirm={(text, date) => void confirmReason(text, date)}
      >
        {reasonError ? <Alert color="red">{reasonError}</Alert> : null}
      </CancelReasonModal>
    </Stack>
  )
}

/** The words of each reason dialog (2.6.4). */
function reasonCopy(
  dialog: ReasonDialog,
  order: TransferOrderDto,
): { title: string; description: string; placeholder: string; confirmLabel: string } {
  const label = orderLabel(order)
  switch (dialog.kind) {
    case 'reject':
      return {
        title: `Reject ${label}`,
        description: REJECT_TEXT,
        placeholder: 'Why is it rejected?',
        confirmLabel: 'Reject',
      }
    case 'backToDraft':
      return {
        title: `Back to draft: ${label}`,
        description: backToDraftText(order.needsApproval),
        placeholder: 'Why does it go back to draft?',
        confirmLabel: 'Back to draft',
      }
    case 'nothingMoreSent':
      return {
        title: `Nothing more will be sent - ${label}`,
        description: nothingMoreSentText(order.totals.toDispatchBase, order.totals.onTheWayBase),
        placeholder: 'Why will nothing more be sent?',
        confirmLabel: 'Nothing more will be sent',
      }
    case 'cancel':
      return {
        title: `Cancel ${label}`,
        description: CANCEL_ORDER_TEXT,
        placeholder: 'Why is it cancelled?',
        confirmLabel: 'Cancel order',
      }
    case 'reverse':
      return {
        title: `Reverse ${dialog.posting.documentNumber}`,
        description: reverseText(dialog.posting, order),
        placeholder: 'Why is it reversed?',
        confirmLabel: 'Reverse',
      }
  }
}
