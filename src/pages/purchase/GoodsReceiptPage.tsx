import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { Alert, Button, Grid, Group, Loader, Paper, Stack, Text, Title } from '@mantine/core'
import { IconArrowBackUp, IconPrinter, IconTrash } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { itemsApi } from '../../api/inventory/items'
import { branchesApi } from '../../api/masterdata/branches'
import { partiesApi } from '../../api/masterdata/parties'
import { warehousesApi } from '../../api/masterdata/warehouses'
import {
  goodsReceiptsApi,
  type GoodsReceiptDto,
  type GoodsReceiptSaveRequest,
  type GoodsReceiptSourceKind,
} from '../../api/purchase/goodsReceipts'
import type { BranchLookupDto, ItemLookupDto, PartyLookupDto, WarehouseLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { AuditTrail } from '../../components/documents/AuditTrail'
import { CancelReasonModal } from '../../components/documents/CancelReasonModal'
import { DocumentActionBar, type DocumentAction } from '../../components/documents/DocumentActionBar'
import { DocumentAttachmentsCard } from '../../components/documents/DocumentAttachmentsCard'
import { DocumentIcons } from '../../components/documents/documentIcons'
import { defaultLineWarehouseId } from '../../components/documents/lineWarehouses'
import {
  defaultBranchIdFor,
  hasNoUsableWarehouse,
  NO_USABLE_WAREHOUSE,
  noAccessSentenceFor,
  postAccessBlockedReason,
} from '../../auth/warehouseAccess'
import { dateLabel, isoDate, stamp } from '../../components/documents/documentKind'
import { formatNumber, reasonSentence } from '../../components/format'
import { GoodsReceiptCostAdjustmentsCard } from '../../components/purchase/goodsReceipts/GoodsReceiptCostAdjustmentsCard'
import {
  GoodsReceiptHeaderCard,
  type GoodsReceiptHeaderErrors,
  type GoodsReceiptHeaderValue,
} from '../../components/purchase/goodsReceipts/GoodsReceiptHeaderCard'
import { GoodsReceiptLinesGrid } from '../../components/purchase/goodsReceipts/GoodsReceiptLinesGrid'
import {
  cancelDescription,
  deleteDraftMessage,
  differenceOf,
  DRAFT_HINT,
  emptyManualLine,
  lineValueOf,
  MANUAL_HINT,
  notDispatchedText,
  postConfirmFor,
  postedBanner,
  receiptLabel,
  receivedBaseOf,
  shortOf,
  toLineForm,
  warehouseChoices,
  warehousesOf,
  type GoodsReceiptLineForm,
} from '../../components/purchase/goodsReceipts/goodsReceiptModel'
import { GoodsReceiptSummaryCard } from '../../components/purchase/goodsReceipts/GoodsReceiptSummaryCard'
import { confirm } from '../../components/ui/confirm'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { ForbiddenPage } from '../ForbiddenPage'
import { refreshGoodsReceiptsWaiting } from '../../hooks/useGoodsReceiptsWaiting'
import { useSeesItemCosts } from '../../hooks/useSeesItemCosts'
import { PERMISSIONS } from '../../navigation'
import { routes } from '../../routes'

const EMPTY_HEADER: GoodsReceiptHeaderValue = {
  documentDate: isoDate(new Date()),
  branchId: null,
  warehouseId: null,
  supplierId: null,
  supplierReference: '',
  notes: '',
}

/** Puts the cursor in a new line's item picker once React has drawn it. */
function focusItem(index: number, attempt = 0) {
  const input = document.querySelector<HTMLInputElement>(`[data-line-item="${index}"] input, input[data-line-item="${index}"]`)
  if (input) {
    input.focus()
    return
  }
  if (attempt < 10) window.setTimeout(() => focusItem(index, attempt + 1), 40)
}

/** (94) Under the lines of a receipt without an order, for a reader without View item costs. */
const NO_COSTS_MANUAL_NOTE = "You may not see item costs: each line is saved at the item's last cost (its average when it has none)."

/**
 * One goods receipt (GRN): a draft counted and corrected, then posted - the goods enter the stock and the item costs are
 * set - and afterwards read, or cancelled with a reason.
 *
 * THE MODE IS THE STATUS. A draft is a form; posted and cancelled receipts are records. What a draft may change is the
 * SOURCE's: a container's lines are its load lines (received 0 to loaded, a reason when they differ, one warehouse for
 * the whole container); an order's or an invoice's take a warehouse per line and "Nothing more will come"; only a
 * receipt without an order adds lines and types their cost.
 *
 * THE SERVER SAYS WHY AN ACTION IS REFUSED. Post, Cancel… and Delete are disabled with the sentence the API returns
 * (postBlockedReason…), the same one its refusal would give; a line refused by number ("Line 2: …") is marked on line 2.
 */
export function GoodsReceiptPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { hasPermission } = useAuth()

  const receiptId = id && id !== 'new' ? Number(id) : null
  const isNew = receiptId === null

  const canCreate = hasPermission(PERMISSIONS.goodsReceiptsCreate)
  const canPost = hasPermission(PERMISSIONS.goodsReceiptsPost)
  const canCancel = hasPermission(PERMISSIONS.goodsReceiptsCancel)
  const canDelete = hasPermission(PERMISSIONS.goodsReceiptsDelete)
  /* (94) WITHOUT VIEW ITEM COSTS a receipt shows no cost or value (the server sends them null) and a line without an order
     is priced by the server: it starts without a typed cost, and the save sends none - a saved line keeps its cost by its
     id, a new one takes the item's last cost, else its average. */
  const seesCosts = useSeesItemCosts()

  const [loading, setLoading] = useState(!isNew)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [receipt, setReceipt] = useState<GoodsReceiptDto | null>(null)

  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [suppliers, setSuppliers] = useState<PartyLookupDto[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseLookupDto[]>([])
  const [items, setItems] = useState<ItemLookupDto[]>([])

  /** "+ New › Without an order" chose the supplier before opening the page. */
  const presetSupplier = isNew ? searchParams.get('supplierId') : null
  const [header, setHeader] = useState<GoodsReceiptHeaderValue>(() => ({ ...EMPTY_HEADER, supplierId: presetSupplier }))
  const [errors, setErrors] = useState<GoodsReceiptHeaderErrors>({})
  const [lines, setLines] = useState<GoodsReceiptLineForm[]>([])

  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
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

  const sourceKind: GoodsReceiptSourceKind = receipt?.sourceKind ?? 'Manual'
  const isContainer = sourceKind === 'Container'
  const isManual = sourceKind === 'Manual'
  const status = receipt?.status ?? 1
  const isDraft = status === 1
  const isPosted = status === 2
  const editable = canCreate && (isNew || (isDraft && receipt?.canEdit !== false))
  const currencyCode = receipt?.baseCurrencyCode ?? 'USD'
  /* (94) THE COSTS ARE DRAWN WHEN THE READER MAY SEE THEM AND THE PAGE HOLDS THEM: a receipt the server sent without its
     costs (its current value is null only then) is not drawn with empty cost boxes while the reader's permission
     changes - it is read again below - and the save says the page drew none, so its typed costs are kept. */
  const drawCosts = seesCosts && !(receipt !== null && receipt.currentValueBase === null)

  /* ── loading ──────────────────────────────────────────────────────────────────────────────── */

  /** Every manual line can still change its unit: the full list of each item's units, once the receipt is on screen. */
  const loadLineUnits = useCallback(async (doc: GoodsReceiptDto) => {
    const itemIds = [...new Set(doc.lines.filter((l) => l.poLineId === null && l.invoiceLineId === null && l.containerLineId === null).map((l) => l.itemId))]
    if (itemIds.length === 0) return
    const lists = await Promise.all(
      itemIds.map(async (itemId) => {
        try {
          return [itemId, (await itemsApi.get(itemId)).units] as const
        } catch {
          return [itemId, null] as const
        }
      }),
    )
    const byItem = new Map(lists.filter(([, units]) => units !== null))
    setLines((current) =>
      current.map((line) => {
        const units = line.kind === 'manual' && line.itemId !== null ? byItem.get(line.itemId) : undefined
        return units ? { ...line, units } : line
      }),
    )
  }, [])

  const applyReceipt = useCallback(
    (doc: GoodsReceiptDto) => {
      setReceipt(doc)
      setHeader({
        documentDate: doc.documentDate.slice(0, 10),
        branchId: String(doc.branchId),
        warehouseId: doc.warehouseId === null ? null : String(doc.warehouseId),
        supplierId: doc.supplierId === null ? null : String(doc.supplierId),
        supplierReference: doc.supplierReference ?? '',
        notes: doc.notes ?? '',
      })
      setLines(doc.lines.map((line) => toLineForm(line)))
      setErrors({})
      markClean()
      if (doc.status === 1 && doc.sourceKind === 'Manual') void loadLineUnits(doc)
    },
    [loadLineUnits],
  )

  const reload = useCallback(async () => {
    if (receiptId === null) return
    try {
      applyReceipt(await goodsReceiptsApi.get(receiptId))
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The goods receipt could not be refreshed.')
    }
  }, [receiptId, applyReceipt])

  useEffect(() => {
    if (receiptId === null) return
    let cancelled = false
    goodsReceiptsApi
      .get(receiptId)
      .then((doc) => {
        if (!cancelled) applyReceipt(doc)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadError(
          error instanceof ApiError && error.status === 404
            ? 'This goods receipt does not exist.'
            : error instanceof ApiError
              ? error.message
              : 'The goods receipt could not be loaded.',
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [receiptId, applyReceipt])

  /* (94) THE READER'S PERMISSION CHANGED WHILE THE PAGE WAS OPEN (a token refreshed after "View item costs" was ticked or
     unticked): a saved receipt with no edits is read again, so it shows what the reader may now see. With edits it stays
     as it is, and its save says it drew no cost while it holds a receipt read without them. */
  const seesCostsBefore = useRef(seesCosts)
  useEffect(() => {
    if (seesCostsBefore.current === seesCosts) return
    seesCostsBefore.current = seesCosts
    if (receiptId !== null && !dirty.current) void reload()
  }, [seesCosts, receiptId, reload])

  /* A FILE ADDED, EDITED OR DELETED changes only the files and the audit trail; the lines being counted stay. */
  const filesChanged = useCallback(async () => {
    if (receiptId === null) return
    try {
      const fresh = await goodsReceiptsApi.get(receiptId)
      setReceipt((current) => (current && current.id === fresh.id ? { ...current, files: fresh.files, audit: fresh.audit } : current))
    } catch {
      /* The count and the trail catch up on the next load; the card already shows the files. */
    }
  }, [receiptId])

  /* THE LISTS A RECEIPT PICKS FROM. A new receipt (one without an order) opens on the main branch and its main
     warehouse (else its first one at the bottom of the tree, see lineWarehouses), which every new line takes too: both
     lists are read together so the default warehouse is the default branch's. */
  useEffect(() => {
    let cancelled = false
    void Promise.all([
      warehousesApi.lookup(false).catch(() => {
        notify.error('Warehouses could not be loaded.')
        return [] as WarehouseLookupDto[]
      }),
      isNew
        ? branchesApi.lookup(true).catch(() => {
            notify.error('Branches could not be loaded.')
            return [] as BranchLookupDto[]
          })
        : Promise.resolve(null),
    ]).then(([warehouseRows, branchRows]) => {
      if (cancelled) return
      setWarehouses(warehouseRows)
      if (!branchRows) return
      setBranches(branchRows)
      // (92) The main branch, or for a restricted reader the branch of one of their warehouses (A17): unchanged otherwise.
      const main = defaultBranchIdFor(branchRows, warehouseRows)
      setHeader((current) => {
        const branchId = current.branchId ?? (main !== null ? String(main) : null)
        if (branchId === null || current.warehouseId !== null) return { ...current, branchId }
        const warehouseId = defaultLineWarehouseId(warehouseRows, Number(branchId), true)
        return { ...current, branchId, warehouseId: warehouseId === null ? null : String(warehouseId) }
      })
    })
    if (isNew) {
      partiesApi
        .lookup({ partyType: 'Supplier', activeOnly: false })
        .then((rows) => {
          if (!cancelled) setSuppliers(rows)
        })
        .catch(() => notify.error('Suppliers could not be loaded.'))
    }
    return () => {
      cancelled = true
    }
  }, [isNew])

  /* A draft without an order, being edited, also needs the branches and suppliers (and the item list). */
  const typing = editable && isManual
  useEffect(() => {
    if (!typing || isNew) return
    branchesApi.lookup(true, receipt?.branchId).then(setBranches).catch(() => {})
    partiesApi.lookup({ partyType: 'Supplier', activeOnly: false }).then(setSuppliers).catch(() => {})
  }, [typing, isNew, receipt?.branchId])

  useEffect(() => {
    if (!typing) return
    let cancelled = false
    itemsApi
      .lookup(true)
      .then((rows) => {
        if (!cancelled) setItems(rows)
      })
      .catch(() => {
        /* the Item select is then empty; the server still refuses a line without an item */
      })
    return () => {
      cancelled = true
    }
  }, [typing])

  /* ── the warehouses offered ───────────────────────────────────────────────────────────────── */

  const keep = useMemo(
    () => [
      { id: receipt?.warehouseId ?? null, code: receipt?.warehouseCode ?? null, name: receipt?.warehouseName ?? null },
      ...lines.map((l) => ({ id: l.warehouseId, code: l.warehouseCode, name: l.warehouseName })),
    ],
    [receipt?.warehouseId, receipt?.warehouseCode, receipt?.warehouseName, lines],
  )
  /** A container is received in its own branch; the others into a warehouse of any branch (scripts 70, 72: the branch
      numbers the receipt, it does not limit its lines), the receipt's branch first. Leaves only, in both cases. */
  const branchFilter = isContainer ? (receipt?.branchId ?? null) : null
  const firstBranchId = header.branchId !== null ? Number(header.branchId) : (receipt?.branchId ?? null)
  /* (92) Only the warehouses the reader may use; one the receipt already holds stays, marked "- not one of your
     warehouses" (see lineWarehouses). */
  const warehouseData = useMemo(
    () => warehouseChoices(warehouses, branchFilter, keep, firstBranchId, true),
    [warehouses, branchFilter, keep, firstBranchId],
  )

  /* (92) Post waits while "Receive into" or a CURRENT line is in a warehouse the reader may not use (the server's
     sentence while those are the stored draft's); Cancel… and Delete take the server's refusal of the stored receipt. */
  const postAccessBlocked = postAccessBlockedReason(
    warehouses,
    [header.warehouseId === null ? null : Number(header.warehouseId), ...lines.map((l) => l.warehouseId)],
    receipt ? [receipt.warehouseId, ...receipt.lines.map((l) => l.warehouseId)] : [],
    receipt?.warehouseAccessRefusal,
  )
  const accessRefusal = receipt?.warehouseAccessRefusal ?? null
  /* (92) A container's receipt is received in the container's branch: when that branch has warehouses but none the reader
     may use, the page says so in the database's words (W8) - "Receive into" offers nothing they could choose - and Post
     waits with the same sentence while no warehouse is chosen. */
  const containerNoAccess = useMemo(() => {
    if (!isContainer || branchFilter === null) return null
    const leaves = warehouses.filter((w) => w.isActive && !w.isTransit && w.childCount === 0 && w.branchId === branchFilter)
    return leaves.length > 0 && leaves.every((w) => w.canUse === false) ? noAccessSentenceFor(leaves.map((w) => w.warehouseCode)) : null
  }, [isContainer, branchFilter, warehouses])
  const postAccessReason = postAccessBlocked ?? (header.warehouseId === null ? containerNoAccess : null)

  /* ── editing ──────────────────────────────────────────────────────────────────────────────── */

  function changeHeader(patch: Partial<GoodsReceiptHeaderValue>) {
    markDirty()
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch) as (keyof GoodsReceiptHeaderValue)[]) delete next[key]
      return next
    })
    setHeader((current) => ({ ...current, ...patch }))

    // A new branch leaves the lines alone: their warehouses may be of any branch (script 72, as Ali's 69 / 70 for the
    // documents). Only "Receive into", where NEW lines start, goes to the new branch's main warehouse (or first leaf).
    if ('branchId' in patch && patch.branchId !== header.branchId) {
      const main = patch.branchId ? defaultLineWarehouseId(warehouses, Number(patch.branchId), true) : null
      setHeader((current) => ({ ...current, warehouseId: main === null ? null : String(main) }))
    }
    // "Receive into" sets every line's warehouse on an order, an invoice or a typed receipt (a line may then change it).
    if ('warehouseId' in patch && !isContainer && patch.warehouseId) {
      const warehouseId = Number(patch.warehouseId)
      setLines((current) => current.map((line) => ({ ...line, warehouseId, error: undefined })))
    }
  }

  const patchLine = useCallback((key: string, patch: Partial<GoodsReceiptLineForm>) => {
    markDirty()
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch, error: undefined } : line)))
  }, [])

  /** A receipt without an order: the item picked on a line, with its units and its last cost (the default typed cost). */
  const chooseItem = useCallback(async (key: string, itemId: number) => {
    markDirty()
    try {
      const details = await itemsApi.get(itemId)
      const base = details.units.find((u) => u.isBaseUnit) ?? details.units[0]
      setLines((current) =>
        current.map((line) =>
          line.key === key
            ? {
                ...line,
                itemId: details.id,
                itemCode: details.itemCode,
                itemName: details.itemName,
                units: details.units,
                itemUnitId: base?.id ?? null,
                unitTypeName: base?.unitTypeName ?? '',
                packingFormula: base?.packingFormula ?? 1,
                // (94) proposed as an Inventory In line is: the last cost when it is not 0, else the average (C13)
                manualUnitCostBase: seesCosts ? (details.lastCost ? details.lastCost : details.averageCost ? details.averageCost : null) : null,
                error: undefined,
              }
            : line,
        ),
      )
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The item could not be loaded.')
    }
  }, [seesCosts])

  function addLine() {
    markDirty()
    setLines((current) => [...current, emptyManualLine(header.warehouseId === null ? null : Number(header.warehouseId))])
    focusItem(lines.length)
  }

  function removeLine(key: string) {
    markDirty()
    setLines((current) => current.filter((line) => line.key !== key))
  }

  /* ── totals ───────────────────────────────────────────────────────────────────────────────── */

  const totals = useMemo(() => {
    let expected = 0
    let received = 0
    let short = 0
    let value = 0
    for (const line of lines) {
      expected += line.expectedQuantityBase ?? 0
      received += receivedBaseOf(line)
      short += shortOf(line, !isDraft)
      value += lineValueOf(line, !isDraft) ?? 0
    }
    if (!isDraft && receipt && receipt.currentValueBase) value = receipt.currentValueBase
    return { expected, received, short, value }
  }, [lines, isDraft, receipt])

  /* ── saving ───────────────────────────────────────────────────────────────────────────────── */

  /**
   * What the client can settle without asking: a missing date, branch or supplier, an empty or half-typed line - and,
   * before posting, a container line that differs without a reason. The rest is the server's, shown as it comes.
   */
  function validate(forPost: boolean): boolean {
    const next: GoodsReceiptHeaderErrors = {}
    if (!header.documentDate) next.documentDate = 'Choose the date received.'
    if (isManual && !header.branchId) next.branchId = 'Choose a branch.'
    if (isManual && !header.supplierId) next.supplierId = 'Choose the supplier the goods come from.'
    if (forPost && isContainer && !header.warehouseId) next.warehouseId = 'Choose the warehouse the goods are received into.'
    setErrors(next)
    if (Object.keys(next).length > 0) {
      notify.error(Object.values(next)[0] ?? 'Some fields still need filling in.')
      return false
    }

    if (lines.length === 0) {
      notify.error(isManual ? 'Add at least one line before saving.' : 'The goods receipt has no lines.')
      return false
    }

    const problems = new Map<string, string>()
    lines.forEach((line, index) => {
      const n = index + 1
      if (line.kind === 'manual' && (!line.itemId || !line.itemUnitId || !line.warehouseId || line.quantity < 1)) {
        problems.set(line.key, `Line ${n} needs an item, a unit, a warehouse and a quantity of at least 1.`)
        return
      }
      // 0 PIECES ONLY WITH "NOTHING MORE WILL COME" on a line of an order: the server refuses the rest with the same
      // sentence (usp_GoodsReceipt_Save) and never drops a line, so the user hears it here without a round trip.
      if ((line.kind === 'order' || line.kind === 'invoice') && receivedBaseOf(line) === 0 && !line.closeShort) {
        problems.set(
          line.key,
          line.poLineId !== null
            ? `Line ${n} (${line.itemCode}): the received quantity must be more than 0, or tick "Nothing more will come" to settle the rest of the order line.`
            : `Line ${n} (${line.itemCode}): the received quantity must be more than 0.`,
        )
        return
      }
      if (line.kind !== 'container' && line.kind !== 'manual' && receivedBaseOf(line) > 0 && !line.warehouseId) {
        problems.set(line.key, `Line ${n} (${line.itemCode}): choose the warehouse the goods are received into.`)
        return
      }
      if (!forPost) return
      const difference = differenceOf(line)
      if (line.kind === 'container' && difference !== null && difference !== 0 && !line.varianceReasonCode) {
        problems.set(line.key, `Line ${n} (${line.itemCode}): choose a reason when the received quantity differs from the loaded quantity.`)
        return
      }
      if (line.closeShort && !line.varianceReasonCode && !line.varianceReason.trim()) {
        problems.set(line.key, `Line ${n} (${line.itemCode}): give the reason nothing more will come.`)
      }
    })
    if (problems.size > 0) {
      setLines((current) => current.map((line) => ({ ...line, error: problems.get(line.key) })))
      notify.error([...problems.values()][0]!)
      return false
    }
    return true
  }

  function toRequest(): GoodsReceiptSaveRequest {
    const headerWarehouse = header.warehouseId === null ? null : Number(header.warehouseId)
    return {
      documentDate: header.documentDate,
      branchId: Number(header.branchId ?? receipt?.branchId),
      warehouseId: headerWarehouse,
      supplierId: isManual ? (header.supplierId === null ? null : Number(header.supplierId)) : (receipt?.supplierId ?? null),
      supplierReference: header.supplierReference.trim() || null,
      notes: header.notes.trim() || null,
      rowVersion: receipt?.rowVersion ?? null,
      ...(isNew ? { sourceKind: 'Manual' as const } : {}),
      // (94) No cost drawn: the server keeps each saved line's typed cost by its id (a reader whose token still holds the
      // permission included), and prices a new one at the item's last cost, else its average.
      costsHidden: !drawCosts,
      lines: lines.map((line, index) => ({
        lineNumber: index + 1,
        // (94) The line's id as it was read (null on a new row): how the server finds the cost a saved line keeps.
        id: line.id,
        itemId: line.itemId!,
        itemUnitId: line.itemUnitId!,
        quantity: line.quantity,
        // A container is received into one warehouse: every line is booked where the header says.
        warehouseId: line.kind === 'container' ? headerWarehouse : line.warehouseId,
        poLineId: line.poLineId,
        invoiceLineId: line.invoiceLineId,
        containerLineId: line.containerLineId,
        expectedQuantityBase: line.expectedQuantityBase,
        varianceReasonCode: line.varianceReasonCode,
        varianceReason: line.varianceReason.trim() || null,
        closeShort: line.kind !== 'container' && line.poLineId !== null ? line.closeShort : false,
        manualUnitCostBase: line.kind === 'manual' && drawCosts ? line.manualUnitCostBase : null,
        expiryDate: line.expiryDate,
        notes: line.notes.trim() || null,
      })),
    }
  }

  /**
   * An API refusal where it belongs: "Line 3: …" on line 3, the warehouse sentence on "Receive into", and always as a
   * notification too (the row may be scrolled away). A receipt changed by someone else is read again.
   */
  function showApiError(error: unknown, fallback: string) {
    if (!(error instanceof ApiError)) {
      notify.error(fallback)
      return
    }
    const message = error.message
    const match = /^Line (\d+)/.exec(message)
    setLines((current) => current.map((line, index) => ({ ...line, error: match && index === Number(match[1]) - 1 ? message : undefined })))
    if (/^Choose the warehouse/.test(message) || /^The warehouse .* (does not belong|has warehouses under it)/.test(message)) {
      setErrors((current) => ({ ...current, warehouseId: message }))
    }
    notify.error(message)
    if (error.code === 'CONCURRENCY' || (error.status === 409 && /modified by another user/i.test(message))) void reload()
  }

  async function saveDraft(): Promise<GoodsReceiptDto | null> {
    if (!validate(false)) return null
    setSaving(true)
    try {
      const saved = receiptId === null ? await goodsReceiptsApi.create(toRequest()) : await goodsReceiptsApi.update(receiptId, toRequest())
      applyReceipt(saved)
      notify.success(receiptId === null ? 'Draft created.' : 'Draft saved.')
      void refreshGoodsReceiptsWaiting()
      // /new becomes /:id, replacing the history entry: Back leaves the page rather than returning to a blank form.
      if (receiptId === null) void navigate(routes.goodsReceipt(saved.id), { replace: true })
      return saved
    } catch (error) {
      showApiError(error, 'The goods receipt could not be saved.')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function post() {
    if (!validate(true)) return
    // Unsaved changes are saved first: the server posts what it holds, and its reasons are about that.
    const saved = isNew || dirty.current ? await saveDraft() : receipt
    if (!saved) return
    if (!saved.canPost) {
      notify.error(saved.postBlockedReason ?? 'This goods receipt cannot be posted.')
      return
    }

    const go = await confirm({
      title: 'Post goods receipt',
      message: postConfirmFor(saved, warehouses, seesCosts),
      confirmLabel: 'Post',
    })
    if (!go) return

    setSaving(true)
    try {
      const posted = await goodsReceiptsApi.post(saved.id, saved.rowVersion)
      applyReceipt(posted)
      notify.success(`Posted: ${posted.documentNumber ?? ''}`.trim())
      void refreshGoodsReceiptsWaiting()
    } catch (error) {
      showApiError(error, 'The goods receipt could not be posted.')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!receipt) return
    const go = await confirm({
      title: 'Delete draft',
      message: deleteDraftMessage(receipt),
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!go) return
    setSaving(true)
    try {
      await goodsReceiptsApi.remove(receipt.id, receipt.rowVersion)
      markClean()
      notify.success('Draft deleted.')
      void refreshGoodsReceiptsWaiting()
      void navigate(routes.goodsReceipts)
    } catch (error) {
      showApiError(error, 'The draft could not be deleted.')
    } finally {
      setSaving(false)
    }
  }

  async function cancelReceipt(reason: string) {
    if (!receipt) return
    setCancelBusy(true)
    try {
      applyReceipt(await goodsReceiptsApi.cancel(receipt.id, reason, receipt.rowVersion))
      notify.success('Goods receipt cancelled.')
      setCancelOpen(false)
      void refreshGoodsReceiptsWaiting()
    } catch (error) {
      showApiError(error, 'The goods receipt could not be cancelled.')
    } finally {
      setCancelBusy(false)
    }
  }

  async function exportToExcel() {
    if (!receipt) return
    try {
      await goodsReceiptsApi.exportToExcel(receipt.id, `${receipt.documentNumber ?? `GRN-draft-${receipt.id}`}.xlsx`)
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The goods receipt could not be exported.')
    }
  }

  function print() {
    if (!receipt) return
    if (dirty.current) {
      notify.info('Save the draft first: the print view shows the saved receipt.')
      return
    }
    void navigate(routes.goodsReceiptPrint(receipt.id))
  }

  async function leave() {
    if (dirty.current) {
      const go = await confirm({
        title: 'Leave without saving?',
        message: 'This goods receipt has changes that have not been saved. Leaving now discards them.',
        confirmLabel: 'Discard',
        danger: true,
      })
      if (!go) return
    }
    markClean()
    void navigate(routes.goodsReceipts)
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

  // "New" is a receipt without an order typed here: the create permission, which the route (view) does not check.
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
        <PageHeader title="Goods Receipt" />
        <Alert color="red">{loadError}</Alert>
        <Group>
          <Button variant="default" onClick={() => void navigate(routes.goodsReceipts)}>
            Back to Goods Receipts
          </Button>
        </Group>
      </Stack>
    )
  }

  const documentActions: DocumentAction[] = [
    {
      key: 'documents',
      label: `Documents (${formatNumber(receipt?.files.length ?? 0)})`,
      icon: DocumentIcons.documents,
      onClick: () => documentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    },
    {
      key: 'add-document',
      label: 'Add document…',
      icon: DocumentIcons.addDocument,
      visible: canCreate,
      disabled: receipt === null,
      disabledReason: 'Save the draft first to attach documents.',
      onClick: () => setAddDocument((n) => n + 1),
    },
    {
      key: 'print',
      label: 'Print',
      icon: <IconPrinter size={16} />,
      disabled: receipt === null,
      disabledReason: 'Save the draft first',
      onClick: print,
    },
    {
      key: 'export',
      label: 'Export',
      icon: DocumentIcons.exportFile,
      disabled: receipt === null,
      disabledReason: 'Save the draft first',
      onClick: () => void exportToExcel(),
    },
  ]

  /* Post is judged on the SAVED receipt: with unsaved changes it saves first and asks again. */
  const postBlocked = !isNew && !isDirty && receipt !== null && !receipt.canPost
  const actions: DocumentAction[] = isDraft
    ? [
        ...documentActions,
        {
          key: 'delete',
          label: 'Delete',
          icon: <IconTrash size={16} />,
          colour: 'red',
          visible: canDelete && receipt !== null,
          disabled: (receipt !== null && !receipt.canDelete) || accessRefusal !== null,
          disabledReason: accessRefusal ?? receipt?.deleteBlockedReason ?? 'This draft cannot be deleted.',
          menuWhenDisabled: accessRefusal !== null,
          loading: saving,
          onClick: () => void remove(),
        },
        // (92) Post refused for a warehouse that is not the reader's: Save is then the primary (a phone's big button).
        { key: 'save', label: 'Save', icon: DocumentIcons.save, variant: postAccessReason !== null ? 'filled' : undefined, colour: postAccessReason !== null ? 'teal' : undefined, visible: editable, loading: saving, onClick: () => void saveDraft() },
        { key: 'back', label: 'Back', icon: DocumentIcons.back, onClick: () => void leave() },
        {
          key: 'post',
          label: 'Post',
          icon: DocumentIcons.post,
          variant: 'filled',
          colour: 'teal',
          visible: canPost && (isNew ? canCreate : true),
          disabled: postBlocked || postAccessReason !== null,
          disabledReason: postAccessReason ?? receipt?.postBlockedReason ?? 'This goods receipt cannot be posted.',
          menuWhenDisabled: postAccessReason !== null,
          loading: saving,
          onClick: () => void post(),
        },
      ]
    : [
        ...documentActions,
        {
          key: 'cancel',
          label: 'Cancel…',
          icon: <IconArrowBackUp size={16} />,
          colour: 'red',
          visible: canCancel && isPosted,
          disabled: (receipt !== null && !receipt.canCancel) || accessRefusal !== null,
          disabledReason: accessRefusal ?? receipt?.cancelBlockedReason ?? 'This goods receipt cannot be cancelled.',
          menuWhenDisabled: accessRefusal !== null,
          onClick: () => setCancelOpen(true),
        },
        { key: 'back', label: 'Back', icon: DocumentIcons.back, onClick: () => void navigate(routes.goodsReceipts) },
      ]

  const title = isNew ? 'New Goods Receipt' : `Goods Receipt ${receipt ? receiptLabel(receipt) : ''}`
  const movementParts = [receipt?.movementTypeName, receipt?.movementFromName && receipt?.movementToName ? `${receipt.movementFromName} → ${receipt.movementToName}` : null].filter(
    (part): part is string => !!part,
  )
  const branchText = receipt?.branchCode ?? receipt?.branchName ?? ''
  const warehouseName = receipt?.warehouseCode ?? receipt?.warehouseName ?? warehousesOf(lines, null, warehouses)

  return (
    <Stack>
      <PageHeader
        title={title}
        subtitle={
          isManual ? 'Goods received from a supplier without a purchase order.' : isDraft ? 'Goods entering the stock: count them, then post.' : undefined
        }
      />

      <DocumentActionBar actions={actions} />
      {editable && !containerNoAccess && hasNoUsableWarehouse(warehouses) && (
        <Alert color="orange" data-no-usable-warehouse>
          {NO_USABLE_WAREHOUSE}
        </Alert>
      )}

      {receipt && isPosted && (
        <Alert color="green" title={`Posted — ${receipt.documentNumber ?? ''}`}>
          {postedBanner(warehouseName, dateLabel(receipt.documentDate), receipt.postedByName ?? 'unknown')}
        </Alert>
      )}
      {receipt && status === 3 && (
        <Alert color="red" title={`Cancelled — ${receiptLabel(receipt)}`}>
          Cancelled by {receipt.cancelledByName ?? 'unknown'} on {stamp(receipt.cancelledAtUtc)}.
          {reasonSentence(receipt.cancelReason)}
        </Alert>
      )}

      {receipt && isDraft && receipt.isAuto && (
        <Alert color="blue" data-auto-draft>
          Created automatically when {receipt.movementNo ?? 'its Delivery movement'}
          {movementParts.length > 0 ? ` (${movementParts.join(', ')})` : ''} was completed
          {receipt.movementEndDate ? ` on ${dateLabel(receipt.movementEndDate)}` : ''}.
          {/* Only while the draft still holds the container's own warehouse: one the reader chose is not "proposed". */}
          {receipt.warehouseId !== null && receipt.warehouseId === receipt.containerWarehouseId && receipt.warehouseInBranch
            ? ` Proposed warehouse: ${receipt.warehouseCode} (from the container).`
            : ''}{' '}
          Check the warehouse and the
          received quantities, then post.
        </Alert>
      )}
      {receipt && isDraft && isContainer && header.warehouseId === null && (
        <Alert color="orange" data-no-warehouse>
          Choose the warehouse the goods are received into: the container's warehouse is not set, does not belong to branch{' '}
          {branchText} or has warehouses under it (stock is kept only in the warehouses at the bottom of the tree).
        </Alert>
      )}
      {receipt && isDraft && editable && containerNoAccess && (
        <Alert color="orange" data-receipt-no-access>
          {containerNoAccess}
        </Alert>
      )}
      {receipt && isDraft && isContainer && receipt.containerStatus === 2 && receipt.containerRef && (
        <Alert color="orange">{notDispatchedText(receipt.containerRef)}</Alert>
      )}
      {receipt && isDraft && !receipt.canEdit && receipt.editBlockedReason && (
        <Alert color="gray">{receipt.editBlockedReason}</Alert>
      )}

      <GoodsReceiptHeaderCard
        value={header}
        onChange={changeHeader}
        receipt={receipt}
        sourceKind={sourceKind}
        editable={editable}
        branches={branches}
        suppliers={suppliers}
        warehouseData={warehouseData}
        errors={errors}
        disabled={saving}
      />

      <Paper radius="lg" p="md" withBorder>
        <Group justify="space-between" align="flex-end" mb="sm" wrap="wrap">
          <Title order={5}>Lines</Title>
          {isDraft && (
            <Text size="sm" c="dimmed">
              {DRAFT_HINT}
            </Text>
          )}
        </Group>
        {isManual && editable && (
          <Text size="sm" c="dimmed" mb="sm">
            {MANUAL_HINT}
          </Text>
        )}
        <GoodsReceiptLinesGrid
          lines={lines}
          sourceKind={sourceKind}
          editable={editable}
          posted={!isDraft}
          onChange={patchLine}
          onRemove={removeLine}
          onAdd={addLine}
          onItemChosen={(key, itemId) => void chooseItem(key, itemId)}
          items={items}
          warehouseData={warehouseData}
          currencyCode={currencyCode}
          showCosts={drawCosts}
        />
        {isManual && editable && !seesCosts && (
          <Text size="sm" c="dimmed" mt="xs">
            {NO_COSTS_MANUAL_NOTE}
          </Text>
        )}
      </Paper>

      {receipt && !isDraft && receipt.costChanges.length > 0 && (
        <GoodsReceiptCostAdjustmentsCard changes={receipt.costChanges} currencyCode={currencyCode} />
      )}

      <DocumentAttachmentsCard
        ref={documentsRef}
        documentId={receipt?.id ?? null}
        documentKind="GRN"
        api={goodsReceiptsApi.files}
        canAdd={canCreate}
        canRemove={canCreate}
        onChanged={() => void filesChanged()}
        openUpload={addDocument}
      />

      <Grid>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <AuditTrail entries={receipt?.audit ?? []} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <GoodsReceiptSummaryCard
            expectedBase={totals.expected}
            receivedBase={totals.received}
            shortBase={totals.short}
            valueBase={totals.value}
            currencyCode={currencyCode}
            posted={!isDraft}
          />
        </Grid.Col>
      </Grid>

      <CancelReasonModal
        opened={cancelOpen}
        onClose={() => setCancelOpen(false)}
        documentLabel={receipt ? receiptLabel(receipt) : ''}
        busy={cancelBusy}
        title="Cancel goods receipt"
        confirmLabel="Cancel goods receipt"
        description={cancelDescription(receipt?.documentNumber ?? null, receipt?.containerRef ?? null)}
        onConfirm={(reason) => void cancelReceipt(reason)}
      />
    </Stack>
  )
}
