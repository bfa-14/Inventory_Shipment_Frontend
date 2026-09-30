import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Alert, Button, Grid, Group, Loader, Paper, Stack, Title } from '@mantine/core'
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
import { AttachmentsDrawer } from '../../components/documents/AttachmentsDrawer'
import { AuditTrail } from '../../components/documents/AuditTrail'
import { CancelReasonModal } from '../../components/documents/CancelReasonModal'
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
import { confirm } from '../../components/ui/confirm'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'

let keySeed = 0
const nextKey = () => `line-${++keySeed}`

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
 * One Inventory In or Inventory Out document: create it, edit it while it is a draft, read it once
 * it is posted.
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

  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [document, setDocument] = useState<StockDocumentDto | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseLookupDto[]>([])
  const [reasons, setReasons] = useState<StockReasonDto[]>([])
  const [items, setItems] = useState<ItemLookupDto[]>([])
  /* THE TYPE CONFIGURATION DECIDES the numbering, the reason and — since the configuration page —
     whether the cost may be typed. Read from the shared cache; the fallbacks cover the first render
     before it answers, and read the way the two inventory kinds have always behaved. */
  const { byCode } = useDocumentTypes()
  const documentType = byCode(kind.code)
  const numberOnPost = documentType?.numberOnPost ?? false
  const reasonRequired = documentType?.requiresReason ?? true
  const costIsEditable = pricingOf(documentType, { mode: 'cost', editable: kind.direction === 1 }).editable

  const [header, setHeader] = useState<DocumentHeaderValue>({
    branchId: null,
    warehouseId: null,
    documentDate: isoDate(new Date()),
    reasonId: null,
    referenceNo: '',
    notes: '',
  })
  const [lines, setLines] = useState<EditableLine[]>([])
  const [errors, setErrors] = useState<Partial<Record<keyof DocumentHeaderValue, string>>>({})

  const [attachmentsOpen, setAttachmentsOpen] = useState(false)
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
    itemsApi.lookup().then(setItems).catch(() => {
      /* the Item select is then empty; the quick search still works */
    })

    inventoryLookupsApi
      .stockReasons(kind.direction)
      .then(setReasons)
      .catch(() => notify.error('Reasons could not be loaded.'))

    // isNew is derived from the route and cannot change without remounting the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind.code, kind.direction])

  const applyDocument = useCallback((doc: StockDocumentDto) => {
    setDocument(doc)
    setHeader({
      branchId: String(doc.branchId),
      warehouseId: String(doc.warehouseId),
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
        unitCost: line.unitCost,
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

  /* Only the fetch lives here. The warehouse list is emptied by whatever CHANGED the branch — the
     header card's own handler — because that is an event, not something to derive by re-rendering. */
  useEffect(() => {
    if (header.branchId === null) return

    let cancelled = false
    warehousesApi
      .lookup(true, Number(header.branchId))
      .then((rows) => {
        if (cancelled) return
        setWarehouses(rows)
        setHeader((current) => {
          if (current.warehouseId !== null) return current
          const main = rows.find((w) => w.isMainWarehouse) ?? rows[0]
          return main ? { ...current, warehouseId: String(main.id) } : current
        })
      })
      .catch(() => {
        /* the warehouse select is then empty and the form refuses to save, which is correct */
      })

    return () => {
      cancelled = true
    }
  }, [header.branchId])

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
                  unitCost: costIsEditable ? (details.lastCost ?? 0) : (details.averageCost ?? 0),
                  onHandBase: null,
                }
              : line,
          ),
        )

        const line = lines.find((l) => l.key === key)
        const warehouseId = line?.warehouseId ?? (header.warehouseId ? Number(header.warehouseId) : null)
        if (warehouseId !== null) void refreshOnHand(key, itemId, warehouseId)
        focusQuantity(key)
      } catch (error) {
        notify.error(error instanceof ApiError ? error.message : 'The item could not be loaded.')
      }
    },
    [costIsEditable, lines, header.warehouseId, refreshOnHand],
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
      const warehouseId = header.warehouseId ? Number(header.warehouseId) : null

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
          unitCost: costIsEditable ? (details.lastCost ?? 0) : (details.averageCost ?? 0),
        },
      ])

      if (warehouseId !== null) void refreshOnHand(key, details.id, warehouseId)
      focusQuantity(key)
    },
    [header.warehouseId, lines, patchLine, costIsEditable, refreshOnHand],
  )

  function addEmptyLine() {
    markDirty()
    setLines((current) => [...current, emptyLine(header.warehouseId ? Number(header.warehouseId) : null)])
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
    setLines((current) => [
      ...current,
      ...imported.map((line) => ({
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
        // In stock mode the wizard's price column IS the unit cost.
        unitCost: line.unitPrice ?? 0,
        expiryDate: line.expiryDate ? line.expiryDate.slice(0, 10) : null,
        notes: line.notes ?? '',
      })),
    ])
    notify.success(`${imported.length} line(s) imported.`)
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
    if (!header.warehouseId) next.warehouseId = 'Choose a warehouse.'
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
      warehouseId: Number(header.warehouseId),
      reasonId: header.reasonId === null ? null : Number(header.reasonId),
      referenceNo: header.referenceNo.trim() || null,
      notes: header.notes.trim() || null,
      rowVersion: document?.rowVersion ?? null,
      lines: lines.map((line, index) => ({
        lineNo: index + 1,
        itemId: line.itemId!,
        itemUnitId: line.itemUnitId!,
        // ONE DOCUMENT = ONE WAREHOUSE: every line carries the header's, whatever the row once held.
        warehouseId: Number(header.warehouseId),
        expiryDate: line.expiryDate,
        quantity: line.quantity,
        unitCost: costIsEditable ? line.unitCost : null,
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

  const actions: DocumentAction[] = readOnly
    ? [
        {
          key: 'attachments',
          label: `Attachments (${document?.files.length ?? 0})`,
          icon: DocumentIcons.attachments,
          onClick: () => setAttachmentsOpen(true),
        },
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
        {
          key: 'attachments',
          label: `Attachments (${document?.files.length ?? 0})`,
          icon: DocumentIcons.attachments,
          onClick: () => setAttachmentsOpen(true),
        },
        {
          key: 'import',
          label: 'Import from File',
          icon: DocumentIcons.import,
          visible: editable && header.branchId !== null && header.warehouseId !== null,
          onClick: () => setImportOpen(true),
        },
        {
          key: 'save',
          label: 'Save Draft',
          icon: DocumentIcons.save,
          visible: editable,
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
          {document.cancelReason ? ` Reason: ${document.cancelReason}` : ''}
        </Alert>
      )}

      <DocumentHeaderCard
        value={header}
        onChange={(patch) => {
          markDirty()
          // A branch change clears the warehouse (the card sends both) and the list under it.
          if (patch.branchId !== undefined) setWarehouses([])
          setHeader((current) => ({ ...current, ...patch }))
        }}
        branches={branches.map((b) => ({ value: String(b.id), label: b.branchName }))}
        warehouses={warehouses.map((w) => ({ value: String(w.id), label: w.warehouseName }))}
        reasons={reasons}
        reasonRequired={reasonRequired}
        documentNumber={document?.documentNumber ?? null}
        numberOnPost={numberOnPost}
        isNew={isNew}
        currencyCode={document?.currencyCode ?? 'USD'}
        readOnly={!editable}
        errors={errors}
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

        {editable && (
          <Group mb="md" align="flex-end">
            <QuickItemSearch onPick={(item) => void addScanned(item)} />
          </Group>
        )}

        <DocumentLinesGrid
          lines={lines}
          onChange={patchLine}
          onRemove={removeLine}
          onAdd={addEmptyLine}
          items={items}
          onItemChosen={(key, itemId) => void chooseItem(key, itemId)}
          currencyCode={document?.currencyCode ?? 'USD'}
          costIsEditable={costIsEditable}
          warnOnOverdraw={kind.direction === -1}
          readOnly={!editable}
        />
      </Paper>

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
          />
        </Grid.Col>
      </Grid>

      <AttachmentsDrawer
        opened={attachmentsOpen}
        onClose={() => setAttachmentsOpen(false)}
        documentId={document?.id ?? null}
        files={document?.files ?? []}
        onChanged={() => void reload()}
        canEdit={canCreate}
      />

      <CancelReasonModal
        opened={cancelOpen}
        onClose={() => setCancelOpen(false)}
        documentLabel={document?.documentNumber ?? `draft #${document?.id}`}
        busy={cancelBusy}
        onConfirm={(reason) => void cancelDocument(reason)}
      />

      {header.branchId !== null && header.warehouseId !== null && (
        <ImportInvoiceItemsWizard
          opened={importOpen}
          onClose={() => setImportOpen(false)}
          header={{
            branchId: Number(header.branchId),
            warehouseId: Number(header.warehouseId),
            warehouseCode: warehouses.find((w) => String(w.id) === header.warehouseId)?.warehouseCode,
            // STOCK MODE: no price list at all, so nothing is priced and the price column is the cost.
            priceListId: null,
            currencyCode: document?.currencyCode ?? 'USD',
            decimalPlaces: 2,
          }}
          documentTypeCode={kind.code}
          mode="stock"
          draftReference={document ? `${kind.code}-${document.id}` : null}
          onImported={appendImported}
          // A file naming several warehouses becomes one document per warehouse, on the server.
          importCreate={(imported, postImmediately) =>
            stockDocumentsApi.importCreate({
              documentTypeCode: kind.code,
              documentDate: header.documentDate,
              branchId: Number(header.branchId),
              reasonId: header.reasonId === null ? null : Number(header.reasonId),
              referenceNo: header.referenceNo.trim() || null,
              notes: header.notes.trim() || null,
              postImmediately,
              lines: imported.map((line) => ({
                warehouseId: line.warehouseId,
                itemId: line.itemId,
                itemUnitId: line.itemUnitId,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
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
            setHeader((current) => ({ ...current, warehouseId: String(warehouseId) }))
            setLines((current) => current.map((line) => ({ ...line, warehouseId })))
          }}
        />
      )}
    </Stack>
  )
}
