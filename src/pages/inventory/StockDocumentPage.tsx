import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Alert, Box, Button, Grid, Group, Loader, Paper, Stack, Text, Title, Tooltip } from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { itemsApi } from '../../api/inventory/items'
import {
  inventoryLookupsApi,
  stockDocumentsApi,
  type SaveStockDocumentRequest,
  type StockDocumentDto,
  type StockReasonDto,
} from '../../api/inventory/stockDocuments'
import { branchesApi } from '../../api/masterdata/branches'
import { warehousesApi } from '../../api/masterdata/warehouses'
import type { BranchLookupDto, ItemListDto, ItemLookupDto, WarehouseLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { pricingOf, useDocumentTypes } from '../../hooks/useDocumentTypes'
import { useSeesItemCosts } from '../../hooks/useSeesItemCosts'
import { AuditTrail } from '../../components/documents/AuditTrail'
import { CancelReasonModal } from '../../components/documents/CancelReasonModal'
import { DocumentAttachmentsCard } from '../../components/documents/DocumentAttachmentsCard'
import { DocumentActionBar, type DocumentAction } from '../../components/documents/DocumentActionBar'
import { DocumentIcons } from '../../components/documents/documentIcons'
import { DocumentHeaderCard, type DocumentHeaderValue } from '../../components/documents/DocumentHeaderCard'
import { DocumentLinesGrid, type EditableLine } from '../../components/documents/DocumentLinesGrid'
import { DocumentSummary } from '../../components/documents/DocumentSummary'
import { isoDate, stamp, type DocumentKind } from '../../components/documents/documentKind'
import { QuickItemSearch } from '../../components/documents/QuickItemSearch'
import {
  ImportInvoiceItemsWizard,
  type ImportedLine,
} from '../../components/sales/ImportInvoiceItemsWizard'
import { formatNumber, reasonSentence } from '../../components/format'
import { confirm } from '../../components/ui/confirm'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { defaultLineWarehouseId, lineWarehouseOptions } from '../../components/documents/lineWarehouses'
import {
  defaultBranchIdFor,
  hasNoUsableWarehouse,
  isWarehouseRestricted,
  NO_USABLE_WAREHOUSE,
  postAccessBlockedReason,
} from '../../auth/warehouseAccess'

let keySeed = 0
const nextKey = () => `line-${++keySeed}`

/** Under the quick search of a type that takes BIVAC items only (BIVAC Out): what is offered, and how to add one. */
const BIVAC_ITEMS_HINT = 'Only BIVAC items. Tick "BIVAC Item" in Inventory › Item Definition to add one.'
/** The same type's Item dropdown when what was typed matches no BIVAC item (or there is none yet). */
const BIVAC_ITEMS_NONE = 'No BIVAC item matches. Tick "BIVAC Item" in Inventory › Item Definition to add one.'
/** What the Item dropdown offers while no list fits the type. One array, so the grid's options keep their identity. */
const NO_ITEMS: ItemLookupDto[] = []

/** (94) The tooltip of an Inventory In cost that cannot be typed: the server's default is the item's last cost. */
const IN_COST_HINT = "The item's last cost (its average when it has none) is applied automatically"
/** (94) An Out's cost, typed or not, is the average the database applies. */
const OUT_COST_HINT = 'Average cost is applied automatically'
/** (94) Under the lines of an editable Inventory In, for a reader without View item costs. */
const NO_COSTS_IN_NOTE = "You may not see item costs: each line is saved at the item's last cost (its average when it has none)."
/** (94) Its second sentence, only when the type's cost may be typed: otherwise nobody changes it, the server prices it. */
const NO_COSTS_IN_NOTE_EDITABLE = ' A user who may see item costs can change it before the document is posted.'
/** (94) Under the import wizard's preview on an Inventory In: what a row without a cost becomes, or why costs are not read. */
const IMPORT_COST_NOTE = "A row without a unit cost is saved at the item's last cost (its average when it has none)."
const IMPORT_NO_COSTS_NOTE =
  "Unit costs in the file are not used: you may not see item costs, so each line is saved at the item's last cost (its average when it has none)."
/** (94) The same on an In whose type's cost cannot be typed ("Price / cost editable" off): the server prices every line. */
const IMPORT_TYPE_COST_NOTE =
  "Unit costs in the file are not used: this document type's cost cannot be typed, so each line is saved at the item's last cost (its average when it has none)."

/**
 * (94) THE COST A NEW LINE IS PROPOSED, per base unit: what the server would store for it. An In takes the item's last
 * cost when it is not 0, else its average (usp_StockDocument_Save, script 94; an Inventory In never sets the last cost,
 * so proposing only the last cost proposed 0); an Out the average, which the database applies anyway.
 */
function proposedUnitCost(direction: number, details: { lastCost: number | null; averageCost: number | null }): number {
  return direction === 1 ? (details.lastCost ? details.lastCost : (details.averageCost ?? 0)) : (details.averageCost ?? 0)
}

/** Four decimals, the precision a line's cost is stored with. */
const round4 = (value: number) => Math.round(value * 10000) / 10000

/**
 * Puts the cursor in a line's quantity box once React has drawn it.
 *
 * THE NEXT THING TO TYPE AFTER AN ITEM IS HOW MANY. A scanned item, or one chosen on a row, lands
 * the reader in Qty rather than leaving them to find it; the frame delay is what lets the row exist
 * first.
 */
function focusQuantity(key: string) {
  focusWhenDrawn(`[data-line-qty="${key}"] input`)
}

/** "+ Add Item" starts with the item picker of the new row: there is nothing to count yet. */
function focusItem(index: number) {
  focusWhenDrawn(`[data-line-item="${index}"] input`)
}

/**
 * Focuses an input that a state change is about to draw.
 *
 * A FEW SHORT RETRIES rather than one animation frame: the row is committed by React on its own
 * schedule, and the scanner box re-focuses itself synchronously after each scan — so the focus has
 * to land after both, which a single frame does not guarantee.
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

function emptyLine(warehouseId: number | null): EditableLine {
  return {
    key: nextKey(),
    id: null,
    itemId: null,
    itemCode: '',
    itemName: '',
    itemUnitId: null,
    unitTypeName: '',
    packingFormula: 1,
    warehouseId,
    expiryDate: null,
    quantity: 1,
    unitCost: 0,
    notes: '',
    onHandBase: null,
    units: [],
  }
}

/**
 * (90) THE TRANSFER REASONS STILL EXIST, AND STILL WORK: an Inventory In or Out may be "Transfer in" / "Transfer out".
 * Chosen, a gray hint under the Reason points at the transfer orders, which move the goods without changing their
 * cost and follow them on the way. Nothing is refused: a reader who means an adjustment keeps it.
 */
const TRANSFER_REASON_CODES = new Set(['TRF_IN', 'TRF_OUT'])
const TRANSFER_REASON_HINT =
  'Moving stock between your own warehouses? Inventory › Transfer Orders moves it without changing its cost and follows it on the way.'

/**
 * One Inventory In, Inventory Out or BIVAC Out document: create it, edit it while it is a draft, read it
 * once it is posted.
 *
 * THREE MODES, ONE COMPONENT, and the mode is the document's status rather than a prop. A draft is
 * a form; a posted or cancelled document is a record and every input becomes text. Splitting them
 * into two pages would mean two copies of the header, the lines and the totals, and the read-only
 * one would be the copy that fell behind.
 *
 * THE SERVER OWNS EVERY RULE THAT MATTERS. The client checks what it can before spending a round
 * trip — a missing branch, an empty grid, a quantity of zero — but whether there is stock to take,
 * whether the document is still a draft, and what a line actually costs are all decided in SQL, and
 * their refusals arrive as sentences this page shows unchanged.
 */
export function StockDocumentPage({ kind }: { kind: DocumentKind }) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { hasPermission } = useAuth()

  const documentId = id && id !== 'new' ? Number(id) : null
  const isNew = documentId === null

  const canCreate = hasPermission(kind.permissions.create)
  const canPost = hasPermission(kind.permissions.post)
  const canCancelDoc = hasPermission(kind.permissions.cancel)
  /* (94) THE PERMISSION DECIDES THE LAYOUT: without View item costs the lines have no cost columns, the summary no Total
     Cost and an In's lines are priced by the server (toRequest sends no cost). Never decided by the figures. */
  const seesCosts = useSeesItemCosts()

  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [document, setDocument] = useState<StockDocumentDto | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseLookupDto[]>([])
  /**
   * The warehouse a NEW line starts in — not the document's.
   *
   * The warehouse belongs to each line now, but typing one on every row would be a step backwards
   * for the common document that never leaves one warehouse. So the branch's main warehouse seeds
   * new rows and the row's own cell overrides it. Nothing but new rows reads this. The import may
   * switch it (chosenDefaultWarehouseId); a branch change puts it back to the branch's main one.
   */
  const [chosenDefaultWarehouseId, setDefaultWarehouseId] = useState<number | null>(null)
  const [reasons, setReasons] = useState<StockReasonDto[]>([])
  /** The item list with the filter it was loaded for: a list loaded for another filter is never offered. */
  const [itemList, setItemList] = useState<{ bivacOnly: boolean; rows: ItemLookupDto[] } | null>(null)
  /* THE TYPE CONFIGURATION DECIDES the numbering, the reason and — since the configuration page —
     whether the cost may be typed. Read from the shared cache; the fallbacks cover the first render
     before it answers, and read the way the two inventory kinds have always behaved. */
  const { byCode, loading: typesLoading, error: typesError } = useDocumentTypes()
  const documentType = byCode(kind.code)
  /* A TYPE THAT CANNOT BE READ (the configuration failed to load, or this kind's row is missing) OFFERS NO ITEMS
     AND SAVES NOTHING. Its rules are unknown, and guessing would be wrong for a type that limits its items: a
     BIVAC Out would offer every item. The page says so instead; the server's checks stand either way. */
  const typeMissing = !typesLoading && !documentType
  const typeMissingMessage = typesError ?? `The ${kind.title} settings could not be loaded. Reload the page.`
  const numberOnPost = documentType?.numberOnPost ?? false
  const reasonRequired = documentType?.requiresReason ?? true
  const costIsEditable = pricingOf(documentType, { mode: 'cost', editable: kind.direction === 1 }).editable
  /* THE TYPE ALSO DECIDES WHICH ITEMS A LINE MAY HOLD. bivacItemsOnly (BIVAC Out) narrows the Item dropdown
     and the quick search to the items with "BIVAC Item" ticked; the server refuses any other on save and
     on post (62000), and the import's check refuses it as an Error row. Read from the type, never the code. */
  const bivacItemsOnly = documentType?.bivacItemsOnly === true
  const items = !typeMissing && itemList?.bivacOnly === bivacItemsOnly ? itemList.rows : NO_ITEMS

  const [header, setHeader] = useState<DocumentHeaderValue>({
    branchId: null,
    documentDate: isoDate(new Date()),
    reasonId: null,
    referenceNo: '',
    notes: '',
  })
  const [lines, setLines] = useState<EditableLine[]>([])
  const [errors, setErrors] = useState<Partial<Record<keyof DocumentHeaderValue, string>>>({})

  /** The action bar's "Add document…": each bump opens the Documents card's popup. */
  const [addDocument, setAddDocument] = useState(0)
  const documentsRef = useRef<HTMLDivElement>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)

  /** Set by every edit, cleared by every save. What the navigation guard asks about. */
  const dirty = useRef(false)
  const markDirty = () => {
    dirty.current = true
  }

  const status = document?.status ?? 'Draft'
  const readOnly = !isNew && status !== 'Draft'
  const editable = !readOnly && (isNew ? canCreate : canCreate && document?.canEdit === true)
  /* (94) THE COSTS ARE DRAWN WHEN THE READER MAY SEE THEM AND THE PAGE HOLDS THEM. A document the server sent without its
     costs (its total is null only then) is not drawn with zeros while the reader's permission changes - it is read
     again below - and its lines' costs are never sent back. */
  const costsWithheld = document !== null && document.totalCost === null
  const drawCosts = seesCosts && !costsWithheld

  /* ── loading ──────────────────────────────────────────────────────────────────────────────── */

  useEffect(() => {
    /* THE DEFAULT BRANCH IS CHOSEN WHERE THE BRANCHES ARRIVE, not in an effect watching them. A new
       document opens on the main branch because that is where almost every document is written;
       anybody working elsewhere changes it once. */
    branchesApi
      .lookup()
      .then((rows) => {
        setBranches(rows)
        if (!isNew || rows.length === 0) return
        const main = rows.find((b) => b.isMainBranch) ?? rows[0]
        setHeader((current) =>
          current.branchId === null ? { ...current, branchId: String(main.id) } : current,
        )
      })
      .catch(() => notify.error('Branches could not be loaded.'))

    inventoryLookupsApi
      .stockReasons(kind.direction)
      .then(setReasons)
      .catch(() => notify.error('Reasons could not be loaded.'))

    // isNew is derived from the route and cannot change without remounting the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind.code, kind.direction])

  /* THE ITEM LIST WAITS FOR THE TYPE CONFIGURATION, because the type decides what it holds: loading every
     item first would offer a BIVAC Out other items for a moment. The configuration is cached, so after the
     first document page of a session this runs at once. A type that cannot be read loads no list at all, and a
     list loaded for another filter (the page reused for another kind) is not offered while the new one loads. */
  useEffect(() => {
    if (typesLoading || typeMissing) return

    let cancelled = false
    itemsApi
      .lookup(true, undefined, undefined, false, bivacItemsOnly)
      .then((rows) => {
        if (!cancelled) setItemList({ bivacOnly: bivacItemsOnly, rows })
      })
      .catch(() => {
        /* the Item select is then empty; the quick search still works */
      })

    return () => {
      cancelled = true
    }
  }, [typesLoading, typeMissing, bivacItemsOnly])

  const applyDocument = useCallback((doc: StockDocumentDto) => {
    setDocument(doc)
    setHeader({
      branchId: String(doc.branchId),
      documentDate: doc.documentDate.slice(0, 10),
      reasonId: doc.reasonId === null ? null : String(doc.reasonId),
      referenceNo: doc.referenceNo ?? '',
      notes: doc.notes ?? '',
    })
    setLines(
      doc.lines.map((line) => ({
        key: nextKey(),
        id: line.id,
        itemId: line.itemId,
        itemCode: line.itemCode,
        itemName: line.itemName,
        itemUnitId: line.itemUnitId,
        unitTypeName: line.unitTypeName,
        packingFormula: line.packingFormula,
        warehouseId: line.warehouseId,
        expiryDate: line.expiryDate ? line.expiryDate.slice(0, 10) : null,
        quantity: line.quantity,
        // (94) Null for a reader without View item costs: the column is not drawn and the server keeps the line's cost.
        // The line is then marked: its 0 here is not a cost, and is never sent back as one.
        unitCost: line.unitCost ?? 0,
        costUnknown: line.unitCost === null,
        notes: line.notes ?? '',
        onHandBase: line.onHandBase,
        /* SEEDED WITH THE LINE'S OWN UNIT, not left empty. The Unit cell is a Select whose options
           are this list: with nothing in it, Mantine has no label for the id the line carries, so a
           saved draft reopened showing "PC" a moment earlier came back blank - and the control
           disables itself on an empty list, so there was no way to put it right either. The full
           list of the item's units arrives just after, from loadLineUnits. */
        units: [{ id: line.itemUnitId, unitTypeName: line.unitTypeName, packingFormula: line.packingFormula }],
      })),
    )
    dirty.current = false
  }, [])

  /**
   * The full unit list for every item on the document, so the Unit select can still be CHANGED and
   * not merely read. The seeded single unit above is enough to show what a line already says; this
   * is what makes the dropdown worth opening.
   *
   * One request per DISTINCT item, and failures are swallowed on purpose: a line whose list did not
   * arrive keeps the unit it was saved with, which is the right answer anyway. It is never the
   * reason a document refuses to open.
   */
  const loadLineUnits = useCallback(async (doc: StockDocumentDto) => {
    const itemIds = [...new Set(doc.lines.map((line) => line.itemId))]
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
        const units = line.itemId === null ? undefined : byItem.get(line.itemId)
        return units ? { ...line, units } : line
      }),
    )
  }, [])

  const reload = useCallback(async () => {
    if (documentId === null) return
    setLoading(true)
    try {
      const doc = await stockDocumentsApi.get(documentId)
      applyDocument(doc)
      setLoadError(null)
      // After the document is on screen: the lines already show their units, this only widens the choice.
      void loadLineUnits(doc)
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : 'The document could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [documentId, applyDocument, loadLineUnits])

  useEffect(() => {
    void reload()
  }, [reload])

  /* (94) THE READER'S PERMISSION CHANGED WHILE THE PAGE WAS OPEN (a token refreshed after "View item costs" was ticked or
     unticked): a saved document with no edits is read again, so it shows what the reader may now see. With edits it
     stays as it is; its lines read without costs keep their mark, so the server keeps their saved costs. */
  const seesCostsBefore = useRef(seesCosts)
  useEffect(() => {
    if (seesCostsBefore.current === seesCosts) return
    seesCostsBefore.current = seesCosts
    if (documentId !== null && !dirty.current) void reload()
  }, [seesCosts, documentId, reload])

  /* A FILE ADDED, EDITED OR DELETED changes only the files and the audit trail: those two come from a fresh read,
     and the header and lines being typed stay as they are (a file does not touch the document's row). */
  const filesChanged = useCallback(async () => {
    if (documentId === null) return
    try {
      const fresh = await stockDocumentsApi.get(documentId)
      setDocument((current) => (current && current.id === fresh.id ? { ...current, files: fresh.files, audit: fresh.audit } : current))
    } catch {
      /* The count and the trail catch up on the next load; the card already shows the files. */
    }
  }, [documentId])

  /* EVERY ACTIVE WAREHOUSE, WHATEVER THE BRANCH. The header's branch numbers the document and says
     where it was made; it does not limit where its lines take or put stock (script 69), so a line
     may name a warehouse of another branch. The list is read once. */
  useEffect(() => {
    let cancelled = false
    warehousesApi
      .lookup(true)
      .then((rows) => {
        if (!cancelled) setWarehouses(rows)
      })
      .catch(() => {
        /* the per-line warehouse selects are then empty and the form refuses to save, which is correct */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const headerBranchId = header.branchId === null ? null : Number(header.branchId)
  const defaultWarehouseId = useMemo(() => {
    if (chosenDefaultWarehouseId !== null) return chosenDefaultWarehouseId
    return defaultLineWarehouseId(warehouses, headerBranchId, true)
  }, [chosenDefaultWarehouseId, headerBranchId, warehouses])

  /* Leaves of every branch, the header branch's first (see lineWarehouses); (92) only those the reader may use, a
     warehouse a line already holds kept and marked "- not one of your warehouses". */
  const warehouseOptions = lineWarehouseOptions(warehouses, headerBranchId, lines.map((l) => l.warehouseId), true)

  /* (92) A NEW DOCUMENT OF A RESTRICTED READER STARTS WHERE THEY MAY MOVE STOCK (A17): the main branch when it holds one
     of their warehouses, else the branch of their first one. Once, when both lists are in, and only while the reader has
     not chosen a branch; an unrestricted reader keeps the main branch, as before. */
  const branchSettled = useRef(false)
  useEffect(() => {
    if (!isNew || branchSettled.current || branches.length === 0 || warehouses.length === 0) return
    branchSettled.current = true
    if (dirty.current || !isWarehouseRestricted(warehouses)) return
    const branchId = defaultBranchIdFor(branches, warehouses, header.branchId === null ? null : Number(header.branchId))
    if (branchId !== null && String(branchId) !== header.branchId) {
      setHeader((current) => ({ ...current, branchId: String(branchId) }))
    }
  }, [isNew, branches, warehouses, header.branchId])

  /* (92) Save & Post waits while a CURRENT line is in a warehouse the reader may not use (the server's sentence while
     those are the stored draft's); Cancel takes the server's refusal of the stored document. */
  const postAccessBlocked = postAccessBlockedReason(
    warehouses,
    lines.map((l) => l.warehouseId),
    document ? [document.warehouseId, ...document.lines.map((l) => l.warehouseId)] : [],
    document?.warehouseAccessRefusal,
  )
  const accessRefusal = document?.warehouseAccessRefusal ?? null

  /* ── line editing ─────────────────────────────────────────────────────────────────────────── */

  const patchLine = useCallback((key: string, patch: Partial<EditableLine>) => {
    markDirty()
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }, [])

  /** Reads stock for one line's item and warehouse. Called whenever either of them moves. */
  const refreshOnHand = useCallback(async (key: string, itemId: number, warehouseId: number) => {
    try {
      const { onHandBase } = await inventoryLookupsApi.onHand(itemId, warehouseId)
      setLines((current) => current.map((l) => (l.key === key ? { ...l, onHandBase } : l)))
    } catch {
      /* the column shows a dash; the server still refuses an overdraw on posting */
    }
  }, [])

  /**
   * An item was chosen on a line: fetch its units, default to the base unit, and take its last cost.
   *
   * THE LAST COST IS A STARTING POINT, NOT A DECISION. It is what this item cost the last time it
   * came in, which is the number somebody typing a delivery is about to type anyway — but it stays
   * editable on an In, because this delivery may have cost something else.
   */
  const chooseItem = useCallback(
    async (key: string, itemId: number) => {
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
                  unitCost: proposedUnitCost(kind.direction, details),
                  // (94) An item read without its costs (a token older than the reader's permission) proposed 0: the
                  // server prices the line instead.
                  costUnknown: details.averageCost === null,
                  onHandBase: null,
                }
              : line,
          ),
        )

        const line = lines.find((l) => l.key === key)
        const warehouseId = line?.warehouseId ?? defaultWarehouseId
        if (warehouseId !== null) void refreshOnHand(key, itemId, warehouseId)
        focusQuantity(key)
      } catch (error) {
        notify.error(error instanceof ApiError ? error.message : 'The item could not be loaded.')
      }
    },
    [kind.direction, lines, defaultWarehouseId, refreshOnHand],
  )

  /**
   * A scanned item becomes a line — or, if that exact line is already there, one more of it.
   *
   * INCREMENTING RATHER THAN DUPLICATING is the whole point of scanning: somebody counting twelve
   * of the same box scans it twelve times, and twelve identical rows is not what they meant. Same
   * item, same unit, same warehouse is the same line.
   */
  const addScanned = useCallback(
    async (item: ItemListDto) => {
      markDirty()
      const warehouseId = defaultWarehouseId

      let details
      try {
        details = await itemsApi.get(item.id)
      } catch (error) {
        notify.error(error instanceof ApiError ? error.message : 'The item could not be loaded.')
        return
      }

      const base = details.units.find((u) => u.isBaseUnit) ?? details.units[0]
      if (!base) {
        notify.error(`${details.itemCode} has no units configured.`)
        return
      }

      const existing = lines.find(
        (l) => l.itemId === details.id && l.itemUnitId === base.id && l.warehouseId === warehouseId,
      )

      if (existing) {
        patchLine(existing.key, { quantity: existing.quantity + 1 })
        focusQuantity(existing.key)
        return
      }

      const key = nextKey()
      setLines((current) => [
        ...current,
        {
          ...emptyLine(warehouseId),
          key,
          itemId: details.id,
          itemCode: details.itemCode,
          itemName: details.itemName,
          units: details.units,
          itemUnitId: base.id,
          unitTypeName: base.unitTypeName,
          packingFormula: base.packingFormula,
          unitCost: proposedUnitCost(kind.direction, details),
          costUnknown: details.averageCost === null,
        },
      ])

      if (warehouseId !== null) void refreshOnHand(key, details.id, warehouseId)
      focusQuantity(key)
    },
    [defaultWarehouseId, lines, patchLine, kind.direction, refreshOnHand],
  )

  function addEmptyLine() {
    markDirty()
    setLines((current) => [...current, emptyLine(defaultWarehouseId)])
    focusItem(lines.length)
  }

  function removeLine(key: string) {
    markDirty()
    setLines((current) => current.filter((line) => line.key !== key))
  }

  async function clearLines() {
    const go = await confirm({
      title: 'Clear all lines',
      message: `Remove all ${lines.length} line(s) from this document?`,
      confirmLabel: 'Clear',
      danger: true,
    })
    if (go) {
      markDirty()
      setLines([])
    }
  }

  function appendImported(imported: ImportedLine[]) {
    markDirty()
    /* (94) THE FILE'S COST IS A LINE'S COST ONLY WHERE THE READER MAY SEE AND TYPE IT: on an In whose type's cost cannot be
       typed the server prices every line, so the page shows the item's cost (proposed below), never the file's. A line
       of an In left without a usable cost is marked and goes to the server without one until a cost is typed or
       proposed - also when its item cannot be read, or the page is saved before the proposal arrives. */
    const fileCostUsed = seesCosts && (kind.direction !== 1 || costIsEditable)
    const appended: EditableLine[] = imported.map((line) => ({
      ...emptyLine(line.warehouseId),
      key: nextKey(),
      itemId: line.itemId,
      itemCode: line.itemCode,
      itemName: line.itemName,
      itemUnitId: line.itemUnitId,
      unitTypeName: line.unitTypeName,
      packingFormula: line.packingFormula,
      warehouseId: line.warehouseId,
      quantity: line.quantity,
      // In stock mode the wizard's price column IS the unit cost. (94) Not read for a reader without View item costs.
      unitCost: fileCostUsed ? (line.unitPrice ?? 0) : 0,
      costUnknown: kind.direction === 1 && (!fileCostUsed || line.unitPrice === null),
      expiryDate: line.expiryDate ? line.expiryDate.slice(0, 10) : null,
      notes: line.notes ?? '',
      // Seeded with the line's own unit, as a saved line is; the item's full list follows below.
      units: [{ id: line.itemUnitId, unitTypeName: line.unitTypeName, packingFormula: line.packingFormula }],
    }))
    setLines((current) => [...current, ...appended])
    notify.success(`${imported.length} line(s) imported.`)
    void completeImported(appended)
  }

  /**
   * (94) WHAT AN IMPORTED LINE STILL NEEDS ONCE IT IS ON THE PAGE: the item's unit list, so its unit can be changed, and -
   * on an In, for a reader who sees item costs - the page's proposed cost on a line without a usable file cost (marked
   * costUnknown: the row had none, or the type's cost cannot be typed), instead of 0.00. One request per distinct item,
   * failures swallowed as in loadLineUnits (the line keeps its unit, and its mark: the server prices it). Only the
   * appended lines are touched, and a cost is set only while the line is still marked and at the placeholder 0: a cost
   * typed meanwhile is never overwritten.
   */
  async function completeImported(appended: EditableLine[]) {
    const itemIds = [...new Set(appended.map((line) => line.itemId).filter((itemId): itemId is number => itemId !== null))]
    const lists = await Promise.all(
      itemIds.map(async (itemId) => {
        try {
          return [itemId, await itemsApi.get(itemId)] as const
        } catch {
          return [itemId, null] as const
        }
      }),
    )
    const byItem = new Map(lists.filter((entry) => entry[1] !== null))
    const keys = new Set(appended.map((line) => line.key))
    const priceIn = kind.direction === 1 && seesCosts

    setLines((current) =>
      current.map((line) => {
        if (!keys.has(line.key) || line.itemId === null) return line
        const details = byItem.get(line.itemId)
        if (!details) return line
        // The item read without its costs (a token older than the permission) proposes nothing: the line stays marked.
        const proposeCost = priceIn && line.costUnknown === true && line.unitCost === 0 && details.averageCost !== null
        return {
          ...line,
          units: details.units,
          ...(proposeCost
            ? { unitCost: round4(proposedUnitCost(kind.direction, details) * line.packingFormula), costUnknown: false }
            : {}),
        }
      }),
    )
  }

  /* ── totals ───────────────────────────────────────────────────────────────────────────────── */

  const totals = useMemo(() => {
    let quantity = 0
    let cost = 0
    for (const line of lines) {
      quantity += line.quantity * (line.packingFormula || 1)
      cost += line.quantity * line.unitCost
    }
    return { items: lines.length, quantity, cost }
  }, [lines])

  /* ── saving ───────────────────────────────────────────────────────────────────────────────── */

  /**
   * What the client can settle without asking the server.
   *
   * IT IS NOT THE RULEBOOK. The procedure checks all of this again and more; this exists so that a
   * form with an empty branch does not cost a round trip to find out. Anything the client cannot
   * know — stock levels, whether the document is still a draft — is deliberately not here.
   */
  function validate(): boolean {
    const next: Partial<Record<keyof DocumentHeaderValue, string>> = {}
    if (!header.branchId) next.branchId = 'Choose a branch.'
    if (!header.documentDate) next.documentDate = 'Choose a date.'
    if (reasonRequired && !header.reasonId) next.reasonId = 'Choose a reason.'
    setErrors(next)

    if (Object.keys(next).length > 0) {
      notify.error('Some header fields still need filling in.')
      return false
    }

    if (lines.length === 0) {
      notify.error('Add at least one line before saving.')
      return false
    }

    const bad = lines.findIndex(
      (l) => !l.itemId || !l.itemUnitId || !l.warehouseId || l.quantity < 1 || l.unitCost < 0,
    )
    if (bad >= 0) {
      notify.error(`Line ${bad + 1} needs an item, a unit, a warehouse and a quantity of at least 1.`)
      return false
    }

    return true
  }

  function toRequest(): SaveStockDocumentRequest {
    return {
      documentTypeCode: kind.code,
      documentDate: header.documentDate,
      branchId: Number(header.branchId),
      // Omitted on purpose: the warehouse is a LINE's now, and the server keeps the first one.
      warehouseId: null,
      reasonId: header.reasonId === null ? null : Number(header.reasonId),
      referenceNo: header.referenceNo.trim() || null,
      notes: header.notes.trim() || null,
      rowVersion: document?.rowVersion ?? null,
      lines: lines.map((line, index) => ({
        lineNo: index + 1,
        // (94) The line's id as it was read (null on a new row): how the server finds the cost a saved line keeps.
        id: line.id,
        itemId: line.itemId!,
        itemUnitId: line.itemUnitId!,
        // The row's OWN warehouse. Validated non-null above, so the assertion is safe.
        warehouseId: line.warehouseId!,
        expiryDate: line.expiryDate,
        quantity: line.quantity,
        /* (94) A cost only when the reader may type it and see it, and the page holds a real one. Null otherwise: on an In
           the server keeps a saved line's cost (by its id) and prices any other line at the item's last cost, else its
           average; an Out takes the average whatever is sent. */
        unitCost: costIsEditable && drawCosts && !line.costUnknown ? line.unitCost : null,
        notes: line.notes.trim() || null,
      })),
    }
  }

  /**
   * Puts an API refusal where it belongs.
   *
   * "Line 3: …" GOES ON LINE 3. The procedure numbers its messages because it knows which row it
   * was judging, and a message about row three shown as a banner makes the reader count rows. The
   * banner still fires as well: the row may be scrolled off the screen.
   */
  function showApiError(error: unknown) {
    if (!(error instanceof ApiError)) {
      notify.error('The document could not be saved.')
      return
    }

    setLines((current) => current.map((line) => ({ ...line, error: undefined })))

    const match = /^Line (\d+):/.exec(error.message)
    if (error.code === 'VALIDATION' && match) {
      const index = Number(match[1]) - 1
      setLines((current) =>
        current.map((line, i) => (i === index ? { ...line, error: error.message } : line)),
      )
    }

    notify.error(error.message)

    // Somebody else changed this document while it was open; what is on screen is already stale.
    if (error.code === 'CONCURRENCY') void reload()
  }

  async function saveDraft(): Promise<StockDocumentDto | null> {
    if (!validate()) return null

    setSaving(true)
    try {
      const saved = documentId === null
        ? await stockDocumentsApi.create(toRequest())
        : await stockDocumentsApi.update(documentId, toRequest())

      applyDocument(saved)
      notify.success(documentId === null ? 'Draft created.' : 'Draft saved.')

      // A create changes the URL from /new to /:id, so a reload lands on the document rather than a
      // blank form. replace, not push: Back should leave the page, not return to an empty /new.
      if (documentId === null) navigate(`${kind.route}/${saved.id}`, { replace: true })

      return saved
    } catch (error) {
      showApiError(error)
      return null
    } finally {
      setSaving(false)
    }
  }

  async function saveAndPost() {
    const saved = await saveDraft()
    if (!saved) return

    const label = saved.documentNumber ?? `draft #${saved.id}`
    const go = await confirm({
      title: `Post ${label}`,
      message: `Post ${label}? Stock will be updated and the document becomes read-only.`,
      confirmLabel: 'Post',
    })
    if (!go) return

    setSaving(true)
    try {
      applyDocument(await stockDocumentsApi.post(saved.id, saved.rowVersion))
      notify.success('Document posted.')
    } catch (error) {
      showApiError(error)
    } finally {
      setSaving(false)
    }
  }

  async function cancelDocument(reason: string) {
    if (!document) return
    setCancelBusy(true)
    try {
      applyDocument(await stockDocumentsApi.cancel(document.id, reason, document.rowVersion))
      notify.success('Document cancelled.')
      setCancelOpen(false)
    } catch (error) {
      showApiError(error)
    } finally {
      setCancelBusy(false)
    }
  }

  async function leave() {
    if (dirty.current) {
      const go = await confirm({
        title: 'Leave without saving?',
        message: 'This document has changes that have not been saved. Leaving now discards them.',
        confirmLabel: 'Discard',
        danger: true,
      })
      if (!go) return
    }
    void navigate(kind.route)
  }

  async function exportToExcel() {
    if (!document) return
    try {
      await stockDocumentsApi.exportToExcel(
        document.id,
        `${document.documentNumber ?? `draft-${document.id}`}.xlsx`,
      )
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The document could not be exported.')
    }
  }

  /* The browser's own guard, for a tab close or a reload — which React Router never sees. */
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
        <PageHeader title={kind.title} />
        <Alert color="red">{loadError}</Alert>
        <Group>
          <Button variant="default" onClick={() => void navigate(kind.route)}>
            Back to {kind.title}
          </Button>
        </Group>
      </Stack>
    )
  }

  /* The Documents card: its count scrolls to it; "Add document…" opens its popup (any status, with the create permission). */
  const documentActions: DocumentAction[] = [
    {
      key: 'documents',
      label: `Documents (${formatNumber(document?.files.length ?? 0)})`,
      icon: DocumentIcons.documents,
      onClick: () => documentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    },
    {
      key: 'add-document',
      label: 'Add document…',
      icon: DocumentIcons.addDocument,
      visible: canCreate,
      disabled: document === null,
      disabledReason: 'Save the draft first to attach documents.',
      onClick: () => setAddDocument((n) => n + 1),
    },
  ]

  const actions: DocumentAction[] = readOnly
    ? [
        ...documentActions,
        {
          key: 'export',
          label: 'Export to Excel',
          icon: DocumentIcons.exportFile,
          onClick: () => void exportToExcel(),
        },
        {
          key: 'cancel-doc',
          label: 'Cancel Document',
          icon: DocumentIcons.cancel,
          colour: 'red',
          visible: canCancelDoc && document?.canCancel === true,
          disabled: accessRefusal !== null,
          disabledReason: accessRefusal ?? undefined,
          menuWhenDisabled: true,
          onClick: () => setCancelOpen(true),
        },
        {
          key: 'back',
          label: 'Back',
          icon: DocumentIcons.back,
          onClick: () => void navigate(kind.route),
        },
      ]
    : [
        ...documentActions,
        {
          key: 'import',
          label: 'Import from File',
          icon: DocumentIcons.import,
          visible: editable && header.branchId !== null && defaultWarehouseId !== null,
          onClick: () => setImportOpen(true),
        },
        {
          key: 'save',
          label: 'Save Draft',
          icon: DocumentIcons.save,
          // (92) Save & Post refused for a warehouse that is not the reader's: what they can still do is the primary (on
          // a phone the big button, Save & Post going into the menu with its sentence).
          variant: postAccessBlocked !== null ? 'filled' : undefined,
          colour: postAccessBlocked !== null ? kind.colour : undefined,
          visible: editable,
          disabled: typeMissing,
          disabledReason: typeMissing ? typeMissingMessage : undefined,
          loading: saving,
          onClick: () => void saveDraft(),
        },
        {
          key: 'cancel',
          label: 'Cancel',
          icon: DocumentIcons.cancel,
          onClick: () => void leave(),
        },
        {
          key: 'post',
          label: 'Save & Post',
          icon: DocumentIcons.post,
          variant: 'filled',
          colour: kind.colour,
          visible: editable && canPost,
          disabled: typeMissing || postAccessBlocked !== null,
          disabledReason: typeMissing ? typeMissingMessage : (postAccessBlocked ?? undefined),
          menuWhenDisabled: postAccessBlocked !== null,
          loading: saving,
          onClick: () => void saveAndPost(),
        },
      ]

  return (
    <Stack>
      <PageHeader
        title={
          isNew
            ? `New ${kind.title}`
            : `${kind.title} ${document?.documentNumber ?? `draft #${document?.id}`}`
        }
      />

      <DocumentActionBar actions={actions} />

      {editable && hasNoUsableWarehouse(warehouses) && (
        <Alert color="orange" data-no-usable-warehouse>
          {NO_USABLE_WAREHOUSE}
        </Alert>
      )}

      {/* THE BANNER IS THE FIRST THING A READ-ONLY DOCUMENT SAYS. Without it a posted document looks
          like a form that has stopped working. */}
      {document && status === 'Posted' && (
        <Alert color="green" title={`Posted — ${document.documentNumber}`}>
          Posted by {document.postedByName ?? 'unknown'} on {stamp(document.postedAtUtc)}. Stock has been
          updated and this document can no longer be edited.
        </Alert>
      )}

      {document && status === 'Cancelled' && (
        <Alert color="red" title={`Cancelled — ${document.documentNumber ?? 'draft'}`}>
          Cancelled by {document.cancelledByName ?? 'unknown'} on {stamp(document.cancelledAtUtc)}.
          {reasonSentence(document.cancelReason)}
        </Alert>
      )}

      <DocumentHeaderCard
        value={header}
        onChange={(patch) => {
          markDirty()
          /* A branch change leaves the lines alone: their warehouses may be of any branch. Only the
             warehouse NEW lines start in goes back to the new branch's main one. */
          if (patch.branchId !== undefined) {
            setDefaultWarehouseId(null)
          }
          setHeader((current) => ({ ...current, ...patch }))
        }}
        branches={branches.map((b) => ({ value: String(b.id), label: b.branchName }))}
        reasons={reasons}
        reasonRequired={reasonRequired}
        documentNumber={document?.documentNumber ?? null}
        numberOnPost={numberOnPost}
        isNew={isNew}
        currencyCode={document?.currencyCode ?? 'USD'}
        readOnly={!editable}
        errors={errors}
        referencePlaceholder={kind.referencePlaceholder}
        reasonHint={
          TRANSFER_REASON_CODES.has(reasons.find((r) => String(r.id) === header.reasonId)?.reasonCode ?? '')
            ? TRANSFER_REASON_HINT
            : null
        }
      />

      <Paper radius="lg" p="md" withBorder>
        <Group justify="space-between" align="flex-end" mb="sm" wrap="wrap">
          <Title order={5}>Document Details</Title>

          <Group gap="xs">
            {editable && (
              <>
                <Button variant="default" leftSection={<IconPlus size={16} />} onClick={addEmptyLine}>
                  Add Item
                </Button>
                <Button
                  variant="default"
                  color="red"
                  leftSection={<IconTrash size={16} />}
                  disabled={lines.length === 0}
                  onClick={() => void clearLines()}
                >
                  Clear All Lines
                </Button>
              </>
            )}
            {document && (
              <Button variant="default" onClick={() => void exportToExcel()}>
                Export to Excel
              </Button>
            )}
          </Group>
        </Group>

        {editable && typeMissing && (
          <Alert color="red" mb="md">
            {typeMissingMessage}
          </Alert>
        )}

        {editable && (
          <Group mb="md" align="flex-end">
            {/* Off until the type is known, like the item list: a scan cannot add an item the type refuses. The
                box, not the input, holds the tooltip: a disabled input does not report the hover. */}
            <Tooltip label={typeMissingMessage} disabled={!typeMissing} withArrow multiline w={300}>
              <Box>
                <QuickItemSearch
                  onPick={(item) => void addScanned(item)}
                  bivacOnly={bivacItemsOnly}
                  disabled={typesLoading || typeMissing}
                />
              </Box>
            </Tooltip>
            {bivacItemsOnly && (
              <Text size="sm" c="dimmed" pb={8}>
                {BIVAC_ITEMS_HINT}
              </Text>
            )}
          </Group>
        )}

        <DocumentLinesGrid
          lines={lines}
          onChange={patchLine}
          onRemove={removeLine}
          onAdd={addEmptyLine}
          items={items}
          itemPlaceholder={bivacItemsOnly ? 'Choose a BIVAC item' : undefined}
          itemsNothingFound={typeMissing ? typeMissingMessage : bivacItemsOnly ? BIVAC_ITEMS_NONE : undefined}
          warehouses={warehouseOptions}
          onItemChosen={(key, itemId) => void chooseItem(key, itemId)}
          currencyCode={document?.currencyCode ?? 'USD'}
          costIsEditable={costIsEditable}
          showCosts={drawCosts}
          costHint={kind.direction === 1 ? IN_COST_HINT : OUT_COST_HINT}
          warnOnOverdraw={kind.direction === -1}
          readOnly={!editable}
        />

        {editable && kind.direction === 1 && !seesCosts && (
          <Text size="sm" c="dimmed" mt="xs">
            {NO_COSTS_IN_NOTE}
            {costIsEditable ? NO_COSTS_IN_NOTE_EDITABLE : ''}
          </Text>
        )}
      </Paper>

      <DocumentAttachmentsCard
        ref={documentsRef}
        documentId={document?.id ?? null}
        documentKind={kind.code}
        api={stockDocumentsApi.files}
        canAdd={canCreate}
        canRemove={canCreate}
        onChanged={() => void filesChanged()}
        openUpload={addDocument}
      />

      <Grid>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <AuditTrail entries={document?.audit ?? []} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <DocumentSummary
            totalItems={totals.items}
            totalQuantity={totals.quantity}
            totalCost={totals.cost}
            currencyCode={document?.currencyCode ?? 'USD'}
            showCost={drawCosts}
          />
        </Grid.Col>
      </Grid>

      <CancelReasonModal
        opened={cancelOpen}
        onClose={() => setCancelOpen(false)}
        documentLabel={document?.documentNumber ?? `draft #${document?.id}`}
        busy={cancelBusy}
        onConfirm={(reason) => void cancelDocument(reason)}
      />

      {header.branchId !== null && defaultWarehouseId !== null && (
        <ImportInvoiceItemsWizard
          opened={importOpen}
          onClose={() => setImportOpen(false)}
          header={{
            branchId: Number(header.branchId),
            warehouseId: defaultWarehouseId!,
            warehouseCode: warehouses.find((w) => w.id === defaultWarehouseId)?.warehouseCode,
            // STOCK MODE: no price list at all, so nothing is priced and the price column is the cost.
            priceListId: null,
            currencyCode: document?.currencyCode ?? 'USD',
            decimalPlaces: 2,
          }}
          documentTypeCode={kind.code}
          mode="stock"
          // (94) Without View item costs the preview has no Unit Cost column and the file's costs are not used.
          hideCosts={!seesCosts}
          costNote={
            kind.direction === 1
              ? !seesCosts
                ? IMPORT_NO_COSTS_NOTE
                : costIsEditable
                  ? IMPORT_COST_NOTE
                  : IMPORT_TYPE_COST_NOTE
              : undefined
          }
          draftReference={document ? `${kind.code}-${document.id}` : null}
          onImported={appendImported}
          // A file naming several warehouses becomes ONE document, each line keeping its own — or, on
          // Inventory In only (what the business asked for), one document per warehouse when the reader
          // turns on "One document per warehouse".
          allowSplitByWarehouse={kind.code === 'INV_IN'}
          importCreate={(imported, postImmediately, splitByWarehouse) =>
            stockDocumentsApi.importCreate({
              documentTypeCode: kind.code,
              documentDate: header.documentDate,
              branchId: Number(header.branchId),
              reasonId: header.reasonId === null ? null : Number(header.reasonId),
              referenceNo: header.referenceNo.trim() || null,
              notes: header.notes.trim() || null,
              postImmediately,
              splitByWarehouse,
              lines: imported.map((line) => ({
                warehouseId: line.warehouseId,
                itemId: line.itemId,
                itemUnitId: line.itemUnitId,
                quantity: line.quantity,
                // (94) The file's cost as it is (null when empty: the server prices it); none for a reader without View
                // item costs, whose import the server prices whatever is sent.
                unitPrice: seesCosts ? line.unitPrice : null,
                expiryDate: line.expiryDate,
                notes: line.notes,
                importRowNumber: line.importRowNumber,
              })),
            })
          }
          documentRoute={(id) => `${kind.route}/${id}`}
          onDocumentsCreated={(created) => {
            // The lines live in the new documents now; nothing on this page is unsaved any more.
            dirty.current = false
            void navigate(kind.route, { state: { highlight: created.documents.map((d) => d.id) } })
          }}
          onSwitchWarehouse={(warehouseId) => {
            markDirty()
            setDefaultWarehouseId(warehouseId)
            setLines((current) => current.map((line) => ({ ...line, warehouseId, onHandBase: null })))
          }}
        />
      )}
    </Stack>
  )
}
