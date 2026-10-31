import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Grid,
  Group,
  NumberInput,
  Paper,
  Select,
  Skeleton,
  Stack,
  Switch,
  Tabs,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Tooltip,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useMediaQuery } from '@mantine/hooks'
import {
  IconArrowLeft,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconDeviceFloppy,
  IconExternalLink,
  IconInfoCircle,
  IconPencil,
} from '@tabler/icons-react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import type { DocumentFileDto } from '../../api/documentFiles'
import { ApiError } from '../../api/http'
import { itemsApi } from '../../api/inventory/items'
import { partiesApi } from '../../api/masterdata/parties'
import type { PartyLookupDto } from '../../api/types'
import { formatNumber, numberInputValue } from '../../components/format'
import type { ItemDetailsDto, ItemUnitDto, SaveItemRequest, SaveItemUnitRequest, TrackingMode } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { AttachmentsPanel, type AttachmentsSource } from '../../components/attachments/AttachmentsPanel'
import { confirm } from '../../components/ui/confirm'
import { TrackingBadge } from '../../components/tracking/TrackingBadge'
import { trackingKindOf, trackingSummary } from '../../components/tracking/trackingNumbers'
import { MoreActionsMenu } from '../../components/ui/MoreActionsMenu'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { COUNTRIES, countryLabel, findCountry } from '../../data/countries'
import { PERMISSIONS } from '../../navigation'
import { CONTENT_BG } from '../../theme'
import { ItemImageCard } from './ItemImageCard'
import { ItemBivacPortCostsCard } from './ItemBivacPortCostsCard'
import { ItemStockLevelsCard } from './ItemStockLevelsCard'
import { ItemAuditCard, ItemQuickLinksCard, ItemStockCard } from './ItemSideCards'
import { ItemUnitFormModal } from './ItemUnitFormModal'
import { ItemUnitsCard } from './ItemUnitsCard'
import {
  activeNeighboursByCode,
  neighboursIn,
  readItemSequence,
  updateItemInSequence,
  type ItemNeighbours,
  type ItemSequenceEntry,
} from './itemSequence'
import { brandLabel, familyOptions, useItemLookups, warehouseOptions } from './lookups'

const MAX_CODE = 30
const MAX_NAME = 200
const MAX_MODEL = 100
const MAX_DESCRIPTION = 1000
const MAX_NOTE = 2000
const MAX_LINK = 500

/**
 * A link the page will open: an absolute http(s) address with a host and no spaces. The API and
 * usp_Item_SetNotes (script 87) refuse anything else, so a javascript: or file: address can never reach
 * window.open.
 */
function isWebAddress(value: string): boolean {
  if (!value || /\s/.test(value)) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== ''
  } catch {
    return false
  }
}

/** A new tab, cut off from this one (noopener: the page cannot reach back into the app; noreferrer: no Referer). */
function openLink(value: string) {
  const link = value.trim()
  if (isWebAddress(link)) window.open(link, '_blank', 'noopener,noreferrer')
}

interface FormValues {
  itemCode: string
  itemName: string
  brandId: string | null
  model: string
  itemFamilyId: string | null
  countryOfOrigin: string | null
  defaultWarehouseId: string | null
  description: string
  warrantyMonths: number | ''
  minQuantity: number | ''
  maxQuantity: number | ''
  isBivac: boolean
  isActive: boolean
  defaultSupplierId: string | null
  leadTimeMonths: number | ''
  pcPerContainer: number | ''
  weightKg: number | ''
  volumeCbm: number | ''
  note: string
  link: string
  /** (93) Tracking on transfer dispatches; the length for serial items only. */
  trackingMode: TrackingMode
  requiresExpiry: boolean
  serialLength: number | ''
}

/** (93) Item Definition › Tracking: what a transfer dispatch asks for the item's pieces. */
const TRACKING_OPTIONS: { value: TrackingMode; label: string }[] = [
  { value: 'None', label: 'None' },
  { value: 'Batch', label: 'Batch numbers' },
  { value: 'Serial', label: 'Serial numbers' },
]

const BLANK: FormValues = {
  itemCode: '',
  itemName: '',
  brandId: null,
  model: '',
  itemFamilyId: null,
  countryOfOrigin: null,
  defaultWarehouseId: null,
  description: '',
  warrantyMonths: '',
  minQuantity: 0,
  maxQuantity: '',
  isBivac: false,
  isActive: true,
  defaultSupplierId: null,
  leadTimeMonths: '',
  pcPerContainer: '',
  weightKg: '',
  volumeCbm: '',
  note: '',
  link: '',
  trackingMode: 'None',
  requiresExpiry: false,
  serialLength: '',
}

/** What Copy Item hands the new page: the source's values, its units, and the code it came from. */
interface CopySource {
  fromItemCode: string
  values: FormValues
  units: ItemUnitDto[]
}

function toFormValues(item: ItemDetailsDto): FormValues {
  return {
    itemCode: item.itemCode,
    itemName: item.itemName,
    brandId: String(item.brandId),
    model: item.model ?? '',
    itemFamilyId: String(item.itemFamilyId),
    countryOfOrigin: item.countryOfOrigin,
    defaultWarehouseId: String(item.defaultWarehouseId),
    description: item.description ?? '',
    warrantyMonths: item.warrantyMonths ?? '',
    minQuantity: item.minQuantity,
    maxQuantity: item.maxQuantity ?? '',
    isBivac: item.isBivac,
    isActive: item.isActive,
    defaultSupplierId: item.defaultSupplierId === null ? null : String(item.defaultSupplierId),
    leadTimeMonths: item.leadTimeMonths ?? '',
    pcPerContainer: item.pcPerContainer ?? '',
    weightKg: item.weightKg ?? '',
    volumeCbm: item.volumeCbm ?? '',
    note: item.note ?? '',
    link: item.link ?? '',
    trackingMode: item.trackingMode ?? 'None',
    requiresExpiry: item.requiresExpiry === true,
    serialLength: item.trackingMode === 'Serial' && item.serialLength ? item.serialLength : '',
  }
}

/** Draft units on an unsaved item get negative ids, so a real id can never collide with one. */
let draftSequence = -1

/**
 * Remounts the page whenever it moves to a different item - or to the blank form.
 *
 * Both routes render the same component, so React Router keeps the instance alive across them and
 * everything read once at mount would go stale. Copy Item is where that bites: it navigates from an
 * item to /inventory/items/new carrying the copy in the location state, and without a fresh mount
 * the form would still hold the source's values - its Item Code included - because useForm reads
 * initialValues exactly once. Switching between view and edit changes only the query string, so the
 * key does not change there and the half-typed form survives.
 */
export function ItemDetailsPage() {
  const params = useParams()
  return <ItemDetails key={params.id ?? 'new'} />
}

function ItemDetails() {
  const params = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { hasPermission } = useAuth()

  const itemId = params.id ? Number(params.id) : null
  const isNew = itemId === null

  const canCreate = hasPermission(PERMISSIONS.itemsCreate)
  const canEdit = hasPermission(PERMISSIONS.itemsEdit)
  const canDelete = hasPermission(PERMISSIONS.itemsDelete)
  // (91) Stock levels per warehouse: their own permissions - the card saves on its own, in view mode too.
  const canViewLevels = hasPermission(PERMISSIONS.stockLevelsView)
  const canEditLevels = hasPermission(PERMISSIONS.stockLevelsEdit)

  const copySource = (location.state as { copyFrom?: CopySource } | null)?.copyFrom ?? null

  const [item, setItem] = useState<ItemDetailsDto | null>(null)
  const [loading, setLoading] = useState(!isNew)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)

  /** Units of an item that does not exist yet; a saved item's units live on `item`. */
  const [draftUnits, setDraftUnits] = useState<ItemUnitDto[]>(copySource?.units ?? [])
  const [pendingImage, setPendingImage] = useState<File | null>(null)
  /** The documents counted after an upload or a delete, for the item they were counted on (the tab's badge). */
  const [documentsCounted, setDocumentsCounted] = useState<{ item: ItemDetailsDto; count: number } | null>(null)
  const [unitDialog, setUnitDialog] = useState<{ unit?: ItemUnitDto } | null>(null)
  const [busyUnitId, setBusyUnitId] = useState<number | null>(null)
  const [removingImage, setRemovingImage] = useState(false)
  const [tab, setTab] = useState<string | null>('general')

  /** Active suppliers for the Default Supplier picker, plus the item's own even when inactive. */
  const [suppliers, setSuppliers] = useState<PartyLookupDto[]>([])
  useEffect(() => {
    partiesApi
      .lookup({ partyType: 'Supplier', includeId: item?.defaultSupplierId ?? undefined })
      .then(setSuppliers)
      .catch(() => {
        /* the picker is then empty; the item keeps the supplier it has */
      })
  }, [item?.defaultSupplierId])

  const editing = isNew || searchParams.get('edit') === '1'
  const editable = editing && (isNew ? canCreate : canEdit)

  const form = useForm<FormValues>({
    initialValues: copySource ? copySource.values : BLANK,
    validate: {
      itemCode: (value) => {
        const code = value.trim()
        if (!code) return 'Item Code is required.'
        if (code.length > MAX_CODE) return `Item Code cannot be longer than ${MAX_CODE} characters.`
        return null
      },
      itemName: (value) => {
        const name = value.trim()
        if (!name) return 'Item Name is required.'
        if (name.length > MAX_NAME) return `Item Name cannot be longer than ${MAX_NAME} characters.`
        return null
      },
      brandId: (value) => (value ? null : 'Brand is required.'),
      model: (value) =>
        value.trim().length > MAX_MODEL ? `Model cannot be longer than ${MAX_MODEL} characters.` : null,
      itemFamilyId: (value) => (value ? null : 'Family is required.'),
      countryOfOrigin: (value) => (value ? null : 'Country of Origin is required.'),
      defaultWarehouseId: (value) => (value ? null : 'Default Warehouse is required.'),
      description: (value) =>
        value.trim().length > MAX_DESCRIPTION
          ? `Description cannot be longer than ${MAX_DESCRIPTION} characters.`
          : null,
      note: (value) => (value.trim().length > MAX_NOTE ? `Note cannot be longer than ${MAX_NOTE} characters.` : null),
      link: (value) => {
        const link = value.trim()
        if (!link) return null
        if (link.length > MAX_LINK) return `Link cannot be longer than ${MAX_LINK} characters.`
        return isWebAddress(link)
          ? null
          : 'Enter a web address starting with http:// or https://, for example https://www.tvsmotor.com.'
      },
      serialLength: (value, values) => {
        if (value === '' || values.trackingMode !== 'Serial') return null
        if (!Number.isInteger(value) || value < 1 || value > 50)
          return 'Serial no. length must be between 1 and 50, or empty for any length.'
        return null
      },
      warrantyMonths: (value) => {
        if (value === '') return null
        if (!Number.isInteger(value) || value < 0) return 'Warranty must be a whole number of months.'
        if (value > 600) return 'Warranty cannot exceed 600 months.'
        return null
      },
      minQuantity: (value) => {
        if (value === '' || !Number.isInteger(value) || value < 0) return 'Minimum Quantity must be 0 or more.'
        return null
      },
      maxQuantity: (value, values) => {
        if (value === '') return null
        if (!Number.isInteger(value) || value < 0) return 'Maximum Quantity must be 0 or more.'
        if (values.minQuantity !== '' && value < values.minQuantity) {
          return 'Maximum Quantity cannot be less than Minimum Quantity.'
        }
        return null
      },
    },
  })

  /**
   * Read from the beforeunload listener and from `load`, neither of which runs during render. Both
   * are kept current in an effect rather than assigned mid-render: a render React discards must not
   * leave its values behind in a ref.
   */
  const dirtyRef = useRef(false)
  const formRef = useRef(form)

  const units = isNew ? draftUnits : (item?.units ?? [])
  const files = item?.files ?? []
  const image = files.find((f) => f.isItemImage)
  /* The tab's badge: the item's documents as loaded with it, until the Documents card changes them. */
  const documentCount =
    documentsCounted !== null && documentsCounted.item === item
      ? documentsCounted.count
      : files.filter((f) => !f.isItemImage).length

  const dirty = editable && (form.isDirty() || pendingImage !== null || (isNew && draftUnits.length > 0))

  useEffect(() => {
    dirtyRef.current = dirty
    formRef.current = form
  })

  const lookups = useItemLookups(
    item ? { brandId: item.brandId, familyId: item.itemFamilyId, warehouseId: item.defaultWarehouseId } : undefined,
  )

  /**
   * Reads the item into the page and the form. It reaches the form through `formRef` so it does not
   * change identity on every keystroke - as a dependency of the fetch effect below, a `load` that
   * did would restart the request each time a character was typed.
   */
  const load = useCallback(async (id: number, signal?: AbortSignal) => {
    setLoading(true)
    try {
      const loaded = await itemsApi.get(id, signal)
      if (signal?.aborted) return
      const values = toFormValues(loaded)
      setItem(loaded)
      setLoadError(null)
      formRef.current.setValues(values)
      // Reset the baseline too, or the freshly loaded values would count as unsaved changes.
      formRef.current.resetDirty(values)
    } catch (error) {
      if (signal?.aborted) return
      if (error instanceof DOMException && error.name === 'AbortError') return
      setLoadError(error instanceof ApiError ? error.messages.join(' ') : 'The item could not be loaded.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (itemId === null) return
    const controller = new AbortController()
    // Fetching is the "synchronize with an external system" case the rule exempts; load's own
    // setLoading(true) has to be on screen before the await, not a render later.
    // eslint-disable-next-line react/set-state-in-effect
    void load(itemId, controller.signal)
    return () => controller.abort()
  }, [itemId, load])

  /* PREVIOUS / NEXT: the active items either side of this one in the Items list as the reader left it (filters and sort,
     itemSequence.ts). Read again whenever the item is (re)loaded - a status change here is written to that list first. */
  const listNeighbours = useMemo<ItemNeighbours | null>(
    () => (item ? neighboursIn(readItemSequence() ?? [], item.id) : null),
    [item],
  )
  /* Not in that list (opened from a link or another page, or the list was never opened in this tab): every active item
     by code, this one placed by its own code - so an inactive item still finds its nearest active neighbours. */
  const [codeNeighbours, setCodeNeighbours] = useState<{ itemId: number; neighbours: ItemNeighbours } | null>(null)
  useEffect(() => {
    if (!item || listNeighbours) return
    const controller = new AbortController()
    const { id, itemCode } = item
    activeNeighboursByCode(id, itemCode, controller.signal)
      .then((neighbours) => {
        if (!controller.signal.aborted) setCodeNeighbours({ itemId: id, neighbours })
      })
      .catch(() => {
        /* Previous and Next stay disabled; the item itself is unaffected. */
      })
    return () => controller.abort()
  }, [item, listNeighbours])
  const neighbours =
    listNeighbours ?? (codeNeighbours !== null && codeNeighbours.itemId === item?.id ? codeNeighbours.neighbours : null)

  /** Below this the header keeps one row of buttons: arrows without their words, Copy Item and Back to list in the menu. */
  const narrow = useMediaQuery('(max-width: 576px)')

  /* AN ITEM OPENS AT THE TOP. The router keeps the window's scroll, so an item opened from far down the list (or with
     Next from the bottom of a long item) used to open half-way down. Once per item: the page is remounted for each one
     (ItemDetailsPage's key), while view <-> edit is the same mount and keeps its place. Before paint, so nothing jumps. */
  useLayoutEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  function goToItem(entry: ItemSequenceEntry | null | undefined) {
    if (entry) void navigate(`/inventory/items/${entry.id}`)
  }

  // The browser's own guard - closing the tab or reloading is outside the router's reach.
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  /** Confirms before throwing away edits; true means "go ahead". */
  async function leaveGuard(): Promise<boolean> {
    if (!dirty) return true
    return confirm({
      title: 'Discard changes?',
      message: 'This item has unsaved changes. Leaving now loses them.',
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      danger: true,
    })
  }

  async function goBackToList() {
    if (await leaveGuard()) void navigate('/inventory/items')
  }

  function startEditing() {
    setSearchParams({ edit: '1' }, { replace: true })
  }

  async function cancelEditing() {
    if (!(await leaveGuard())) return

    if (isNew) {
      void navigate('/inventory/items')
      return
    }

    // Back to what the server holds - a cancelled edit must not leave half its values on screen.
    if (item) {
      form.setValues(toFormValues(item))
      form.resetDirty(toFormValues(item))
    }
    setPendingImage(null)
    setFormError(null)
    setStale(false)
    setSearchParams({}, { replace: true })
  }

  function buildPayload(values: FormValues): SaveItemRequest {
    return {
      itemCode: values.itemCode.trim(),
      itemName: values.itemName.trim(),
      brandId: Number(values.brandId),
      model: values.model.trim() ? values.model.trim() : null,
      itemFamilyId: Number(values.itemFamilyId),
      countryOfOrigin: values.countryOfOrigin as string,
      defaultWarehouseId: Number(values.defaultWarehouseId),
      description: values.description.trim() ? values.description.trim() : null,
      warrantyMonths: values.warrantyMonths === '' ? null : values.warrantyMonths,
      minQuantity: values.minQuantity === '' ? 0 : values.minQuantity,
      maxQuantity: values.maxQuantity === '' ? null : values.maxQuantity,
      isBivac: values.isBivac,
      isActive: values.isActive,
      defaultSupplierId: values.defaultSupplierId === null ? null : Number(values.defaultSupplierId),
      leadTimeMonths: values.leadTimeMonths === '' ? null : values.leadTimeMonths,
      pcPerContainer: values.pcPerContainer === '' ? null : values.pcPerContainer,
      weightKg: values.weightKg === '' ? null : values.weightKg,
      volumeCbm: values.volumeCbm === '' ? null : values.volumeCbm,
      note: values.note.trim() ? values.note.trim() : null,
      link: values.link.trim() ? values.link.trim() : null,
      // (93) Always sent by this page (it knows the fields); the length only for a serial item.
      trackingMode: values.trackingMode,
      requiresExpiry: values.requiresExpiry,
      serialLength: values.trackingMode === 'Serial' && values.serialLength !== '' ? values.serialLength : null,
      ...(isNew ? {} : { rowVersion: item?.rowVersion ?? null }),
    }
  }

  function toUnitPayload(unit: ItemUnitDto): SaveItemUnitRequest {
    return {
      unitTypeId: unit.unitTypeId,
      packingFormula: unit.packingFormula,
      skuCode: unit.skuCode,
      barcode: unit.barcode,
      isSalesUnit: unit.isSalesUnit,
      isPurchaseUnit: unit.isPurchaseUnit,
      isBaseUnit: unit.isBaseUnit,
      lengthCm: unit.lengthCm,
      widthCm: unit.widthCm,
      heightCm: unit.heightCm,
      weightKg: unit.weightKg,
    }
  }

  /** The message an error carries, whatever kind of error it is. */
  function messageOf(error: unknown, fallback: string): string {
    return error instanceof ApiError ? error.messages.join(' ') : fallback
  }

  /**
   * Saves everything the reader has queued: the item, then its units, then its files. Each step
   * reports its own failure by name - "the item was created but its Box unit was not" is the only
   * honest thing to say when that is what happened.
   */
  async function save(values: FormValues) {
    /* AT LEAST ONE UNIT, and checked BEFORE the item is created rather than after. An item with no
       units cannot be sold, bought or counted - there is no quantity to state it in - and the
       create call below is the point of no return: once it returns, the item exists and a refusal
       here would leave a half-made record behind. The rest of the required fields are @mantine/form
       rules on the fields themselves; this one belongs to the Units card, which has no field. */
    if (isNew && draftUnits.length === 0) {
      const message = 'Add at least one unit before saving. An item with no units cannot be sold, bought or counted.'
      setFormError(message)
      notify.error(message)
      return
    }

    setSaving(true)
    setFormError(null)
    setStale(false)

    try {
      const payload = buildPayload(values)

      if (isNew) {
        const created = await itemsApi.create(payload)
        // From here on the item exists: every later failure is reported against it, and the page
        // moves onto its route so a second Save cannot create a duplicate.
        const problems = await saveChildren(created.id, draftUnits)

        form.resetDirty(values)
        setDraftUnits([])
        setPendingImage(null)

        if (problems.length > 0) {
          notify.error(`Item ${created.itemCode} was created, but some parts were not saved.`)
          setFormError(`Item created. ${problems.join(' ')}`)
          void navigate(`/inventory/items/${created.id}?edit=1`, { replace: true })
          return
        }

        notify.success('Item created successfully.')
        void navigate(`/inventory/items/${created.id}`, { replace: true })
        return
      }

      const updated = await itemsApi.update(itemId as number, payload)
      const problems = await saveChildren(updated.id, [])

      form.resetDirty(values)
      setPendingImage(null)
      await load(updated.id)

      if (problems.length > 0) {
        notify.error('The item was saved, but its image was not uploaded.')
        setFormError(problems.join(' '))
        return
      }

      notify.success('Item saved successfully.')
      setSearchParams({}, { replace: true })
    } catch (error) {
      handleSaveError(error)
    } finally {
      setSaving(false)
    }
  }

  /** Units and the picture for an item that now exists. Returns one sentence per part that did not save. */
  async function saveChildren(id: number, unitsToAdd: ItemUnitDto[]): Promise<string[]> {
    const problems: string[] = []

    // Base first: the API refuses any other unit until the item has one.
    const ordered = [...unitsToAdd].sort((a, b) => Number(b.isBaseUnit) - Number(a.isBaseUnit))
    for (const unit of ordered) {
      try {
        await itemsApi.addUnit(id, toUnitPayload(unit))
      } catch (error) {
        problems.push(`Unit ${unit.skuCode} was not added: ${messageOf(error, 'the request failed.')}`)
      }
    }

    if (pendingImage) {
      try {
        await itemsApi.addImage(id, pendingImage)
      } catch (error) {
        problems.push(`The image was not uploaded: ${messageOf(error, 'the request failed.')}`)
      }
    }

    return problems
  }

  function handleSaveError(error: unknown) {
    if (!(error instanceof ApiError)) {
      setFormError('The item could not be saved.')
      return
    }

    if (error.code === 'DUPLICATE_CODE') {
      form.setErrors({ itemCode: 'An item with this Item Code already exists.' })
      form.getInputNode('itemCode')?.focus()
      return
    }

    if (error.code === 'MASTER_INACTIVE') {
      notify.error(error.messages[0] as string)
      setFormError(error.messages.join(' '))
      return
    }

    if (error.code === 'CONCURRENCY') {
      notify.error(error.messages[0] as string)
      setStale(true)
      setFormError(error.messages.join(' '))
      if (itemId !== null) void load(itemId)
      return
    }

    const mapped: Record<string, string> = {}
    for (const [field, messages] of Object.entries(error.fieldErrors)) {
      const key = field.toLowerCase()
      const message = messages.join(' ')
      if (key.includes('itemcode')) mapped.itemCode = message
      else if (key.includes('itemname')) mapped.itemName = message
      else if (key.includes('countryoforigin')) mapped.countryOfOrigin = message
      else if (key.includes('brandid')) mapped.brandId = message
      else if (key.includes('itemfamilyid')) mapped.itemFamilyId = message
      else if (key.includes('defaultwarehouseid')) mapped.defaultWarehouseId = message
      else if (key.includes('description')) mapped.description = message
      else if (key.includes('note')) mapped.note = message
      else if (key.includes('link')) mapped.link = message
      else if (key.includes('seriallength')) mapped.serialLength = message
      else if (key.includes('trackingmode')) mapped.trackingMode = message
      else if (key.includes('warrantymonths')) mapped.warrantyMonths = message
      else if (key.includes('minquantity')) mapped.minQuantity = message
      else if (key.includes('maxquantity')) mapped.maxQuantity = message
      else if (key.includes('model')) mapped.model = message
    }

    if (Object.keys(mapped).length > 0) {
      form.setErrors(mapped)
      form.getInputNode(Object.keys(mapped)[0] as string)?.focus()
      return
    }

    setFormError(error.messages.join(' '))
  }

  /** A rejected submit puts the cursor where the reader has to look. */
  function focusFirstInvalid(errors: Record<string, unknown>) {
    const first = Object.keys(errors)[0]
    if (first) form.getInputNode(first)?.focus()
  }

  // ----- units -----

  async function saveUnit(payload: SaveItemUnitRequest) {
    const editingUnit = unitDialog?.unit

    if (isNew) {
      // Nothing to talk to yet: hold the unit until the item is created.
      const unitTypeName = lookups.unitTypes.find((t) => t.id === payload.unitTypeId)?.unitTypeName ?? ''
      const draft: ItemUnitDto = {
        id: editingUnit?.id ?? draftSequence--,
        itemId: 0,
        unitTypeId: payload.unitTypeId,
        unitTypeName,
        packingFormula: payload.packingFormula,
        skuCode: payload.skuCode,
        barcode: payload.barcode ?? null,
        isSalesUnit: payload.isSalesUnit,
        isPurchaseUnit: payload.isPurchaseUnit,
        isBaseUnit: payload.isBaseUnit,
        lengthCm: payload.lengthCm ?? null,
        widthCm: payload.widthCm ?? null,
        heightCm: payload.heightCm ?? null,
        weightKg: payload.weightKg ?? null,
        rowVersion: '',
      }

      setDraftUnits((current) => {
        const next = editingUnit ? current.map((u) => (u.id === editingUnit.id ? draft : u)) : [...current, draft]
        // Exactly one base, here as well as on the server.
        return draft.isBaseUnit ? next.map((u) => (u.id === draft.id ? u : { ...u, isBaseUnit: false })) : next
      })
      setUnitDialog(null)
      return
    }

    const id = itemId as number
    const saved = editingUnit
      ? await itemsApi.updateUnit(id, editingUnit.id, payload)
      : await itemsApi.addUnit(id, payload)

    setItem((current) => (current ? { ...current, units: saved } : current))
    setUnitDialog(null)
    notify.success(editingUnit ? 'Unit saved.' : 'Unit added.')
  }

  async function deleteUnit(unit: ItemUnitDto) {
    const confirmed = await confirm({
      title: 'Delete unit',
      message: `Delete the ${unit.unitTypeName} unit (${unit.skuCode})? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!confirmed) return

    if (isNew) {
      setDraftUnits((current) => current.filter((u) => u.id !== unit.id))
      return
    }

    setBusyUnitId(unit.id)
    try {
      await itemsApi.removeUnit(itemId as number, unit.id)
      await load(itemId as number)
      notify.success('Unit deleted.')
    } catch (error) {
      if (error instanceof ApiError && error.code === 'REFERENCED') {
        notify.error(`${error.messages[0]} It is used by transactions.`)
        return
      }
      notify.error(messageOf(error, 'The unit could not be deleted.'))
    } finally {
      setBusyUnitId(null)
    }
  }

  // ----- files -----

  async function pickImage(file: File | null) {
    if (isNew || !item || file === null) {
      setPendingImage(file)
      return
    }

    try {
      await itemsApi.addImage(item.id, file)
      await load(item.id)
      notify.success('Item image updated.')
    } catch (error) {
      notify.error(messageOf(error, 'The image could not be uploaded.'))
    }
  }

  async function removeImage() {
    if (!item || !image) return
    const confirmed = await confirm({
      title: 'Remove image',
      message: 'Remove this item image? This cannot be undone.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!confirmed) return

    setRemovingImage(true)
    try {
      await itemsApi.removeFile(item.id, image.id)
      await load(item.id)
      notify.success('Item image removed.')
    } catch (error) {
      notify.error(messageOf(error, 'The image could not be removed.'))
    } finally {
      setRemovingImage(false)
    }
  }

  /*
   * THE ITEM'S DOCUMENTS (script 67): the data sheet, the homologation certificate, the user manual - the shared
   * Documents list with the types used for items, like every document's files. An upload is saved at once, in view
   * mode as in edit mode: it changes nothing else of the item, so it never waits for Save Item and never touches what
   * is being typed. The picture is not one of them; it keeps its own card and rules.
   */
  const documentSource: AttachmentsSource<DocumentFileDto> | null = item
    ? {
        list: () => itemsApi.files.list(item.id),
        upload: (file, fields) => itemsApi.files.add(item.id, file, fields),
        update: (row, edit) => itemsApi.files.update(item.id, row.id, edit),
        download: (row) => itemsApi.files.download(item.id, row.id, row.fileName),
        remove: (row) => itemsApi.files.remove(item.id, row.id),
      }
    : null

  /** After an upload, an edit or a delete: the tab's count, read again for the item on screen. */
  async function documentsChanged() {
    if (!item) return
    const counted = item
    try {
      const rows = await itemsApi.files.list(counted.id)
      setDocumentsCounted({ item: counted, count: rows.length })
    } catch {
      /* The badge catches up on the next load; the card already shows the files. */
    }
  }

  // ----- item-level actions -----

  async function toggleStatus() {
    if (!item) return
    const activating = !item.isActive
    const confirmed = await confirm({
      title: activating ? 'Activate item' : 'Deactivate item',
      message: activating
        ? `Activate ${item.itemCode} - ${item.itemName}?`
        : `Deactivate ${item.itemCode} - ${item.itemName}? It will no longer be selectable on new documents.`,
      confirmLabel: activating ? 'Activate' : 'Deactivate',
    })
    if (!confirmed) return

    try {
      await itemsApi.setStatus(item.id, activating)
      updateItemInSequence(item.id, { isActive: activating })
      await load(item.id)
      notify.success(activating ? 'Item activated.' : 'Item deactivated.')
    } catch (error) {
      notify.error(messageOf(error, 'The item could not be updated.'))
    }
  }

  async function deleteItem() {
    if (!item) return
    const confirmed = await confirm({
      title: 'Delete item',
      message: `Delete ${item.itemCode} - ${item.itemName}? Its units, image, documents and stock levels per warehouse go with it. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!confirmed) return

    try {
      await itemsApi.remove(item.id)
      updateItemInSequence(item.id, 'removed')
      notify.success('Item deleted successfully.')
      void navigate('/inventory/items')
    } catch (error) {
      if (error instanceof ApiError && error.code === 'REFERENCED') {
        const deactivate = await confirm({
          title: 'Item cannot be deleted',
          message: error.messages[0] as string,
          confirmLabel: 'Deactivate instead',
        })
        if (deactivate) {
          try {
            await itemsApi.setStatus(item.id, false)
            updateItemInSequence(item.id, { isActive: false })
            await load(item.id)
            notify.success('Item deactivated.')
          } catch (err) {
            notify.error(messageOf(err, 'The item could not be deactivated.'))
          }
        }
        return
      }
      notify.error(messageOf(error, 'The item could not be deleted.'))
    }
  }

  /** Opens a new item prefilled from this one - a new code, the same packaging, none of its files. */
  function copyItem() {
    if (!item) return
    const values = toFormValues(item)
    const copy: CopySource = {
      fromItemCode: item.itemCode,
      // The code is what has to be unique, so it starts empty and focused.
      values: { ...values, itemCode: '' },
      // SKUs survive the copy (they are unique per item); barcodes cannot - they are system-wide.
      units: item.units.map((unit) => ({ ...unit, id: draftSequence--, itemId: 0, barcode: null, rowVersion: '' })),
    }
    void navigate('/inventory/items/new', { state: { copyFrom: copy } })
  }

  /**
   * "India (IN)" - the name to search by, with the code that is actually stored. No flag emoji:
   * Windows has no flag glyphs and falls back to the two regional-indicator letters, which would
   * print the code twice ("ɪɴ India (IN)") on the machines this runs on.
   */
  const countryOptions = useMemo(() => COUNTRIES.map((c) => ({ value: c.code, label: countryLabel(c) })), [])

  const title = isNew ? (copySource ? 'New Item (copy)' : 'New Item') : (item?.itemCode ?? 'Item')
  const subtitle = isNew
    ? 'Define an item, its packing units and its documents.'
    : item
      ? `${item.itemName} · ${item.familyName} · ${item.brandName}`
      : ''


  if (loadError) {
    return (
      <>
        <PageHeader title="Item" breadcrumbs={BREADCRUMBS} />
        <Alert color="red" title="Could not load the item">
          {loadError}
        </Alert>
        <Button
          mt="md"
          variant="default"
          leftSection={<IconArrowLeft size={16} />}
          component={Link}
          to="/inventory/items"
        >
          Back to list
        </Button>
      </>
    )
  }

  return (
    <>
      {/* THE WHOLE HEADER IS FROZEN under the app's fixed header - breadcrumbs, code and status, name, and the actions
          with Previous / Next - because an item is taller than a screen and what it is and what can be done to it should
          not scroll away. Its own background (the page's), stretched over the page's side padding, stops the cards
          showing through; no parent of the page clips overflow, which would cancel the sticking. Previous / Next only in
          view mode: moving away from half-typed changes is what the Cancel / Save bar is for. */}
      <Box
        style={{
          position: 'sticky',
          top: 'var(--app-shell-header-offset, 64px)',
          zIndex: 3,
          background: CONTENT_BG,
          marginInline: 'calc(var(--mantine-spacing-md) * -1)',
          paddingInline: 'var(--mantine-spacing-md)',
          marginTop: 'calc(var(--mantine-spacing-xs) * -1)',
          paddingTop: 'var(--mantine-spacing-xs)',
          marginBottom: 'var(--mantine-spacing-md)',
          borderBottom: '1px solid var(--mantine-color-gray-3)',
        }}
      >
        <PageHeader
          title={title}
          subtitle={subtitle}
          breadcrumbs={BREADCRUMBS}
          truncateTitle
          wrapTitleExtra={item ? trackingKindOf(item.trackingMode, item.requiresExpiry) !== null : false}
          titleExtra={
            item ? (
              <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                <StatusBadge active={item.isActive} />
                {item.isBivac ? (
                  <Badge variant="light" color="orange">
                    BIVAC
                  </Badge>
                ) : null}
                {/* (93) How a transfer dispatch asks for its pieces: "Serial nos.", "Batches + expiry", … */}
                <TrackingBadge
                  kind={trackingKindOf(item.trackingMode, item.requiresExpiry)}
                  withExpiry={item.requiresExpiry === true}
                />
              </Group>
            ) : undefined
          }
          actions={
            <Group gap="sm" wrap="wrap">
              {!editing && item ? (
                <>
                  <Group gap={6} wrap="nowrap">
                    <ItemStepButton
                      direction="previous"
                      target={neighbours?.previous ?? null}
                      iconOnly={narrow}
                      onStep={goToItem}
                    />
                    <ItemStepButton direction="next" target={neighbours?.next ?? null} iconOnly={narrow} onStep={goToItem} />
                  </Group>
                  {canEdit ? (
                    <Button leftSection={<IconPencil size={16} />} onClick={startEditing}>
                      Edit Item
                    </Button>
                  ) : null}
                  {canCreate && !narrow ? (
                    <Button variant="default" leftSection={<IconCopy size={16} />} onClick={copyItem}>
                      Copy Item
                    </Button>
                  ) : null}
                  {/* On a phone the header keeps one row of buttons: arrows, Edit Item, and the rest (Copy Item, Back
                      to list) in the "…" menu. */}
                  {canEdit || canDelete || narrow ? (
                    <MoreActionsMenu
                      compact={narrow}
                      actions={[
                        ...(narrow && canCreate
                          ? [{ label: 'Copy Item', icon: <IconCopy size={16} />, onClick: () => copyItem() }]
                          : []),
                        ...(canEdit
                          ? [{ label: item.isActive ? 'Deactivate' : 'Activate', onClick: () => void toggleStatus() }]
                          : []),
                        ...(canDelete ? [{ label: 'Delete', onClick: () => void deleteItem() }] : []),
                        ...(narrow
                          ? [{ label: 'Back to list', icon: <IconArrowLeft size={16} />, onClick: () => void goBackToList() }]
                          : []),
                      ]}
                    />
                  ) : null}
                </>
              ) : null}
              {editing || !item || !narrow ? (
                <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={() => void goBackToList()}>
                  Back to list
                </Button>
              ) : null}
            </Group>
          }
        />
      </Box>

      {copySource ? (
        <Alert
          color="blue"
          mb="md"
          icon={<IconInfoCircle size={18} />}
          title={`Copied from ${copySource.fromItemCode}`}
        >
          Enter a new Item Code. The packing units came along; the image and documents did not, and barcodes were
          cleared because a barcode is unique across the whole system.
        </Alert>
      ) : null}

      {formError ? (
        <Alert color={stale ? 'orange' : 'red'} mb="md" title={stale ? 'The item changed elsewhere' : 'Could not save'}>
          {formError}
        </Alert>
      ) : null}

      {lookups.error ? (
        <Alert color="yellow" mb="md" title="Some lists are unavailable">
          {lookups.error}
        </Alert>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault()
          /* Only the item's own form saves the item. A popup's form (the Documents card's "Add document" and "Edit
             document", rendered in a portal) bubbles its submit up the React tree to here; and in view mode there is
             nothing to save - Enter in the Documents card's type filter must not save the item. */
          if (event.target !== event.currentTarget || !editable) return
          form.onSubmit(
            (values) => void save(values),
            (errors) => focusFirstInvalid(errors),
          )()
        }}
        noValidate
      >
        <Tabs value={tab} onChange={setTab} keepMounted={false}>
          <Tabs.List mb="md">
            <Tabs.Tab value="general">General Information</Tabs.Tab>
            <Tabs.Tab
              value="documents"
              rightSection={
                documentCount > 0 ? (
                  <Badge size="xs" variant="light" circle>
                    {formatNumber(documentCount)}
                  </Badge>
                ) : null
              }
            >
              Documents
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="general">
            <Grid gap="md">
              <Grid.Col span={{ base: 12, md: 8 }}>
                <Stack gap="md">
                  <Card radius="lg" p="lg" withBorder>
                    <Text fw={600} fz="md" mb="md">
                      Basic Information
                    </Text>

                    {loading ? (
                      <FieldSkeletons rows={4} />
                    ) : (
                      <Grid gap="md">
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                          <Field label="Item Code" value={item?.itemCode} editing={editable}>
                            <TextInput
                              label="Item Code"
                              placeholder="TVS-AP160"
                              withAsterisk
                              data-autofocus={copySource ? true : undefined}
                              maxLength={MAX_CODE}
                              {...form.getInputProps('itemCode')}
                            />
                          </Field>
                        </Grid.Col>

                        <Grid.Col span={{ base: 12, sm: 6 }}>
                          <Field label="Item Name" value={item?.itemName} editing={editable}>
                            <TextInput
                              label="Item Name"
                              placeholder="TVS Apache RTR 160 4V"
                              withAsterisk
                              maxLength={MAX_NAME}
                              {...form.getInputProps('itemName')}
                            />
                          </Field>
                        </Grid.Col>

                        <Grid.Col span={{ base: 12, sm: 6 }}>
                          <Field
                            label="Country of Origin"
                            value={
                              item
                                ? (() => {
                                    const country = findCountry(item.countryOfOrigin)
                                    return country ? countryLabel(country) : item.countryOfOrigin
                                  })()
                                : undefined
                            }
                            editing={editable}
                          >
                            <Select
                              label="Country of Origin"
                              placeholder="Pick a country"
                              withAsterisk
                              searchable
                              clearable
                              nothingFoundMessage="No country found"
                              data={countryOptions}
                              {...form.getInputProps('countryOfOrigin')}
                            />
                          </Field>
                        </Grid.Col>

                        <Grid.Col span={{ base: 12, sm: 6 }}>
                          <Field label="Brand" value={item?.brandName} editing={editable}>
                            <Select
                              label="Brand"
                              placeholder="Pick a brand"
                              withAsterisk
                              searchable
                              clearable
                              nothingFoundMessage="No brand found"
                              data={lookups.brands.map((b) => ({ value: String(b.id), label: brandLabel(b) }))}
                              {...form.getInputProps('brandId')}
                            />
                          </Field>
                        </Grid.Col>

                        <Grid.Col span={{ base: 12, sm: 6 }}>
                          <Field label="Model" value={item?.model ?? '—'} editing={editable}>
                            <TextInput
                              label="Model"
                              placeholder="Apache RTR 160 4V"
                              maxLength={MAX_MODEL}
                              {...form.getInputProps('model')}
                            />
                          </Field>
                        </Grid.Col>

                        <Grid.Col span={{ base: 12, sm: 6 }}>
                          <Field
                            label="Family"
                            value={item ? `${item.familyName} (${item.familyCode})` : undefined}
                            editing={editable}
                          >
                            <Select
                              label="Family"
                              placeholder="Pick a family"
                              withAsterisk
                              searchable
                              clearable
                              nothingFoundMessage="No family found"
                              /* Headings shown but greyed: an item is filed under one particular
                                 family, not under the heading above it - and a leaf on its own
                                 ("Battery") means little without the branch standing over it. The
                                 family it already carries stays selectable whatever happens to the
                                 tree, so an edit cannot blank it. */
                              data={familyOptions(lookups.families, {
                                leavesSelectableOnly: true,
                                keepId: Number(form.values.itemFamilyId) || null,
                              })}
                              {...form.getInputProps('itemFamilyId')}
                            />
                          </Field>
                        </Grid.Col>

                        <Grid.Col span={{ base: 12, sm: 6 }}>
                          <Field
                            label="Default Warehouse"
                            value={item ? `${item.warehouseName} (${item.warehouseCode})` : undefined}
                            editing={editable}
                          >
                            <Select
                              label="Default Warehouse"
                              placeholder="Pick a warehouse"
                              withAsterisk
                              searchable
                              clearable
                              nothingFoundMessage="No warehouse found"
                              /* Leaves only: stock lives on the warehouses with nothing standing
                                 under them, so a grouping is shown for its bearings but cannot be
                                 the default an item is stocked in. */
                              data={warehouseOptions(lookups.warehouses, {
                                leavesSelectableOnly: true,
                                keepId: Number(form.values.defaultWarehouseId) || null,
                              })}
                              {...form.getInputProps('defaultWarehouseId')}
                            />
                          </Field>
                        </Grid.Col>

                        {/* Beside the Default Warehouse, with its own "Open link". */}
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                          {editable ? (
                            <Group gap="xs" align="flex-start" wrap="nowrap">
                              <TextInput
                                type="url"
                                label="Link"
                                placeholder="https://www.tvsmotor.com/..."
                                maxLength={MAX_LINK}
                                style={{ flex: 1 }}
                                miw={0}
                                {...form.getInputProps('link')}
                                // Checked on leaving the field, so a typo shows before Save rather than after.
                                onBlur={() => form.validateField('link')}
                              />
                              <Button
                                variant="default"
                                // Level with the input: the label above it is 25 px tall.
                                mt={25}
                                leftSection={<IconExternalLink size={16} />}
                                disabled={!isWebAddress(form.values.link.trim())}
                                onClick={() => openLink(form.values.link)}
                              >
                                Open link
                              </Button>
                            </Group>
                          ) : (
                            <Group gap="xs" align="flex-end" wrap="nowrap" justify="space-between">
                              <Stack gap={2} miw={0}>
                                <Text c="dimmed" fz="xs" fw={500}>
                                  Link
                                </Text>
                                {item?.link && isWebAddress(item.link) ? (
                                  <Anchor
                                    href={item.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    fz="sm"
                                    truncate="end"
                                    title={item.link}
                                  >
                                    {item.link}
                                  </Anchor>
                                ) : (
                                  <Text fz="sm">{item?.link || '—'}</Text>
                                )}
                              </Stack>
                              <Button
                                variant="default"
                                size="xs"
                                leftSection={<IconExternalLink size={14} />}
                                disabled={!item?.link || !isWebAddress(item.link)}
                                onClick={() => openLink(item?.link ?? '')}
                                style={{ flexShrink: 0 }}
                              >
                                Open link
                              </Button>
                            </Group>
                          )}
                        </Grid.Col>

                        {/* One column, so the Note follows the Description closely instead of a whole grid gap below its
                            character count. */}
                        <Grid.Col span={12}>
                          <Stack gap={editable ? 2 : 'sm'}>
                            <Field label="Description" value={item?.description ?? '—'} editing={editable}>
                              <Textarea
                                label="Description"
                                placeholder="What this item is..."
                                autosize
                                minRows={3}
                                maxLength={MAX_DESCRIPTION}
                                inputWrapperOrder={['label', 'input', 'description', 'error']}
                                description={`${form.values.description.length}/${MAX_DESCRIPTION}`}
                                styles={{ description: { textAlign: 'right' } }}
                                {...form.getInputProps('description')}
                              />
                            </Field>
                            <Field label="Note" value={item?.note ?? '—'} editing={editable} multiline>
                              <Textarea
                                label="Note"
                                placeholder="Anything the team should remember about this item..."
                                autosize
                                minRows={3}
                                maxLength={MAX_NOTE}
                                inputWrapperOrder={['label', 'input', 'description', 'error']}
                                description={`${form.values.note.length}/${MAX_NOTE}`}
                                styles={{ description: { textAlign: 'right' } }}
                                {...form.getInputProps('note')}
                              />
                            </Field>
                          </Stack>
                        </Grid.Col>
                      </Grid>
                    )}
                  </Card>

                  <Card radius="lg" p="lg" withBorder>
                    <Text fw={600} fz="md" mb="md">
                      Inventory Parameters
                    </Text>

                    {loading ? (
                      <FieldSkeletons rows={2} />
                    ) : (
                      <Grid gap="md">
                        <Grid.Col span={{ base: 12, sm: 4 }}>
                          <Field
                            label="Warranty (Months)"
                            value={item?.warrantyMonths === null || item === null ? '—' : String(item.warrantyMonths)}
                            editing={editable}
                          >
                            <NumberInput
                              label="Warranty (Months)"
                              placeholder="24"
                              min={0}
                              max={600}
                              step={1}
                              allowDecimal={false}
                              allowNegative={false}
                              {...form.getInputProps('warrantyMonths')}
                            />
                          </Field>
                        </Grid.Col>

                        <Grid.Col span={{ base: 12, sm: 4 }}>
                          <Field
                            label="Minimum Quantity"
                            value={item ? String(item.minQuantity) : undefined}
                            editing={editable}
                          >
                            <NumberInput
                              label="Minimum Quantity"
                              thousandSeparator=","
                              min={0}
                              step={1}
                              allowDecimal={false}
                              allowNegative={false}
                              {...form.getInputProps('minQuantity')}
                            />
                          </Field>
                        </Grid.Col>

                        <Grid.Col span={{ base: 12, sm: 4 }}>
                          <Field
                            label="Maximum Quantity"
                            value={item?.maxQuantity === null || item === null ? '—' : String(item.maxQuantity)}
                            editing={editable}
                          >
                            <NumberInput
                              label="Maximum Quantity"
                              thousandSeparator=","
                              placeholder="No maximum"
                              min={0}
                              step={1}
                              allowDecimal={false}
                              allowNegative={false}
                              {...form.getInputProps('maxQuantity')}
                            />
                          </Field>
                        </Grid.Col>

                        {/* (91) TWO MIN / MAX, NEVER READ AS ONE: these two are the company's (the Dashboard's figure);
                            each warehouse's own are on the card below. In both modes, directly under the row. */}
                        <Grid.Col span={12} pt={0}>
                          <Text fz="xs" c="dimmed" data-item-company-levels-hint>
                            Minimum and Maximum Quantity are for the whole company: the Dashboard&apos;s Items below their
                            minimum.
                            {canViewLevels ? " Each warehouse's own Min / Max are in Stock levels per warehouse below." : ''}
                          </Text>
                        </Grid.Col>

                        {/* (93) TRACKING: after the Min / Max hint, before BIVAC / Active. Asked on transfers only. */}
                        {editable ? (
                          <>
                            <Grid.Col span={{ base: 12, sm: form.values.trackingMode === 'Serial' ? 4 : 6 }}>
                              <Select
                                label="Tracking"
                                description="Asked when goods are dispatched on a transfer order."
                                // The hints under the boxes, so the three controls of the row line up at the top.
                                inputWrapperOrder={['label', 'input', 'description', 'error']}
                                data={TRACKING_OPTIONS}
                                allowDeselect={false}
                                {...form.getInputProps('trackingMode')}
                                onChange={(next) => {
                                  const mode = (next as TrackingMode | null) ?? 'None'
                                  form.setFieldValue('trackingMode', mode)
                                  // The length is a serial item's only: emptied when Tracking leaves Serial.
                                  if (mode !== 'Serial') form.setFieldValue('serialLength', '')
                                }}
                                data-item-tracking
                              />
                            </Grid.Col>
                            {form.values.trackingMode === 'Serial' ? (
                              <Grid.Col span={{ base: 12, sm: 4 }}>
                                <NumberInput
                                  label="Serial no. length"
                                  description="Every serial no. of this item has exactly this many characters (a TVS chassis no. has 17)."
                                  placeholder="Any length"
                                  inputWrapperOrder={['label', 'input', 'description', 'error']}
                                  min={1}
                                  max={50}
                                  // Never clamped: 60 typed is refused with its sentence on Save, not saved as 50.
                                  clampBehavior="none"
                                  step={1}
                                  allowDecimal={false}
                                  allowNegative={false}
                                  {...form.getInputProps('serialLength')}
                                  data-item-serial-length
                                />
                              </Grid.Col>
                            ) : null}
                            <Grid.Col span={{ base: 12, sm: form.values.trackingMode === 'Serial' ? 4 : 6 }}>
                              <Group gap={6} pt={{ base: 0, sm: 32 }}>
                                <Checkbox
                                  label="Requires expiry date"
                                  {...form.getInputProps('requiresExpiry', { type: 'checkbox' })}
                                  data-item-requires-expiry
                                />
                                <Tooltip
                                  label="Each dispatch gives the expiry date of its pieces: per batch, per serial no., or per group of pieces."
                                  withArrow
                                  multiline
                                  w={280}
                                >
                                  <ThemeIcon variant="subtle" color="gray" size="sm" aria-label="About the expiry date">
                                    <IconInfoCircle size={16} />
                                  </ThemeIcon>
                                </Tooltip>
                              </Group>
                            </Grid.Col>
                          </>
                        ) : item ? (
                          <Grid.Col span={12}>
                            <Text fz="sm" data-item-tracking-summary>
                              {trackingSummary(item.trackingMode, item.requiresExpiry, item.serialLength)}
                            </Text>
                          </Grid.Col>
                        ) : null}
                        <Grid.Col span={12} pt={0}>
                          <Text fz="xs" c="dimmed" data-item-tracking-hint>
                            Batch, serial and expiry details are asked on transfer dispatches (Inventory › Transfer Orders).
                            Goods receipts, sales and Inventory In / Out do not ask for them.
                          </Text>
                        </Grid.Col>

                        <Grid.Col span={12}>
                          {editable ? (
                            <Group gap="xl" wrap="wrap" mt="xs">
                              <Group gap={6}>
                                <Checkbox label="BIVAC Item" {...form.getInputProps('isBivac', { type: 'checkbox' })} />
                                <Tooltip
                                  label="BIVAC-inspected item - documents are handled in the Shipment module"
                                  withArrow
                                  multiline
                                  w={260}
                                >
                                  <ThemeIcon variant="subtle" color="gray" size="sm" aria-label="About BIVAC">
                                    <IconInfoCircle size={16} />
                                  </ThemeIcon>
                                </Tooltip>
                              </Group>
                              <Switch label="Active" {...form.getInputProps('isActive', { type: 'checkbox' })} />
                            </Group>
                          ) : item ? (
                            <Group gap="xl" mt="xs">
                              <Group gap={8}>
                                <Text c="dimmed" fz="sm">
                                  BIVAC
                                </Text>
                                {item.isBivac ? (
                                  <Badge variant="light" color="orange">
                                    BIVAC
                                  </Badge>
                                ) : (
                                  <Text fz="sm">No</Text>
                                )}
                              </Group>
                              <Group gap={8}>
                                <Text c="dimmed" fz="sm">
                                  Status
                                </Text>
                                <StatusBadge active={item.isActive} />
                              </Group>
                            </Group>
                          ) : null}
                        </Grid.Col>
                      </Grid>
                    )}
                  </Card>

                  {canViewLevels ? (
                    <ItemStockLevelsCard
                      // The route's id, so an item still loading is not taken for a new one.
                      itemId={itemId}
                      itemCode={item?.itemCode ?? ''}
                      companyMin={item?.minQuantity ?? null}
                      companyMax={item?.maxQuantity ?? null}
                      itemLoaded={item !== null}
                      canEdit={canEditLevels}
                    />
                  ) : null}

                  {/* (97) What a BIVAC charge costs at each port: a saved BIVAC item only. */}
                  {item?.isBivac && itemId !== null ? (
                    <ItemBivacPortCostsCard itemId={itemId} itemCode={item.itemCode} canEdit={canEdit} />
                  ) : null}

                  <Card radius="lg" p="lg" withBorder>
                    <Text fw={600} fz="md" mb="md">
                      Purchasing
                    </Text>

                    {loading ? (
                      <FieldSkeletons rows={1} />
                    ) : (
                      <Grid gap="md">
                        <Grid.Col span={{ base: 12, sm: 8 }}>
                          <Field
                            label="Default Supplier"
                            value={item?.defaultSupplierName ? `${item.defaultSupplierCode} - ${item.defaultSupplierName}` : '—'}
                            editing={editable}
                          >
                            <Select
                              label="Default Supplier"
                              placeholder="The supplier a purchase order is raised on"
                              data={suppliers.map((s) => ({ value: String(s.id), label: `${s.partyCode} - ${s.partyName}` }))}
                              searchable
                              clearable
                              nothingFoundMessage="No supplier matches"
                              {...form.getInputProps('defaultSupplierId')}
                            />
                          </Field>
                        </Grid.Col>

                        <Grid.Col span={{ base: 12, sm: 4 }}>
                          <Field
                            label="Lead time (months)"
                            value={item?.leadTimeMonths == null || item === null ? '—' : formatNumber(item.leadTimeMonths, 1)}
                            editing={editable}
                          >
                            <NumberInput
                              label="Lead time (months)"
                              placeholder="Months from order to receipt"
                              min={0}
                              max={60}
                              step={0.5}
                              decimalScale={1}
                              allowNegative={false}
                              value={form.values.leadTimeMonths}
                              onChange={(next) => form.setFieldValue('leadTimeMonths', numberInputValue(next) ?? '')}
                              error={form.errors.leadTimeMonths}
                            />
                          </Field>
                          {/* (98) What Shortages use first: the item's own purchase history. */}
                          {item?.leadTimeHistoryMonths != null ? (
                            <Text fz="xs" c="dimmed" mt={4}>
                              Purchase history: {formatNumber(item.leadTimeHistoryMonths, 1)} months from order approval to goods
                              receipt ({formatNumber(item.leadTimeHistoryReceipts ?? 0)} receipt
                              {item.leadTimeHistoryReceipts === 1 ? '' : 's'}, last 12 months). Shortages use it first.
                            </Text>
                          ) : null}
                        </Grid.Col>

                        <Grid.Col span={{ base: 12, sm: 4 }}>
                          <Field
                            label="PC per Container"
                            value={item?.pcPerContainer == null ? '—' : formatNumber(item.pcPerContainer)}
                            editing={editable}
                          >
                            <NumberInput
                              label="PC per Container"
                              description="Pieces (base units) that fill one container; shortage plans turn a required quantity into containers with it."
                              placeholder="Optional"
                              min={1}
                              step={1}
                              allowDecimal={false}
                              allowNegative={false}
                              thousandSeparator=","
                              value={form.values.pcPerContainer}
                              onChange={(next) => form.setFieldValue('pcPerContainer', numberInputValue(next) ?? '')}
                              error={form.errors.pcPerContainer}
                            />
                          </Field>
                        </Grid.Col>

                        <Grid.Col span={{ base: 12, sm: 4 }}>
                          <Field
                            label="Weight (kg)"
                            value={item?.weightKg == null ? '—' : formatNumber(item.weightKg, 3)}
                            editing={editable}
                          >
                            <NumberInput
                              label="Weight (kg)"
                              description="Per base unit. A purchase charge allocated by weight is shared out on it."
                              placeholder="Optional"
                              min={0}
                              decimalScale={3}
                              allowNegative={false}
                              thousandSeparator=","
                              value={form.values.weightKg}
                              onChange={(next) => form.setFieldValue('weightKg', numberInputValue(next) ?? '')}
                              error={form.errors.weightKg}
                            />
                          </Field>
                        </Grid.Col>

                        <Grid.Col span={{ base: 12, sm: 4 }}>
                          <Field
                            label="Volume (CBM)"
                            value={item?.volumeCbm == null ? '—' : formatNumber(item.volumeCbm, 4)}
                            editing={editable}
                          >
                            <NumberInput
                              label="Volume (CBM)"
                              description="Per base unit, in cubic metres. The same, for a charge allocated by volume."
                              placeholder="Optional"
                              min={0}
                              decimalScale={4}
                              allowNegative={false}
                              thousandSeparator=","
                              value={form.values.volumeCbm}
                              onChange={(next) => form.setFieldValue('volumeCbm', numberInputValue(next) ?? '')}
                              error={form.errors.volumeCbm}
                            />
                          </Field>
                        </Grid.Col>
                      </Grid>
                    )}
                  </Card>

                  <ItemUnitsCard
                    units={units}
                    editable={editable}
                    loading={loading}
                    busyUnitId={busyUnitId}
                    // Only while creating: an existing item that has somehow lost its units is a
                    // problem to fix, not a form to refuse, and its own page already says so.
                    required={isNew}
                    onAdd={() => setUnitDialog({})}
                    onEdit={(unit) => setUnitDialog({ unit })}
                    onDelete={(unit) => void deleteUnit(unit)}
                  />
                </Stack>
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 4 }}>
                <Stack gap="md">
                  <ItemImageCard
                    itemId={item?.id ?? null}
                    image={image}
                    pending={pendingImage}
                    editable={editable}
                    onPick={(file) => void pickImage(file)}
                    onRemove={item && image ? () => void removeImage() : undefined}
                    removing={removingImage}
                  />
                  {item ? <ItemAuditCard item={item} /> : null}
                  <ItemStockCard item={item} />
                  <ItemQuickLinksCard itemId={item?.id ?? null} />
                </Stack>
              </Grid.Col>
            </Grid>
          </Tabs.Panel>

          <Tabs.Panel value="documents">
            {/* With the items edit permission, in view mode too, like the files of a posted document. */}
            <AttachmentsPanel
              title="Documents"
              documentKind="ITEM"
              source={documentSource}
              reloadKey={item?.id ?? 'new'}
              unsavedText="Save the item first to attach documents."
              canAdd={canEdit}
              canRemove={canEdit}
              onChanged={() => void documentsChanged()}
            />
          </Tabs.Panel>
        </Tabs>

        {editable ? (
          <Paper
            radius="lg"
            p="md"
            withBorder
            mt="md"
            // Sits just above the app's own footer, so Save is reachable without scrolling to the end.
            style={{ position: 'sticky', bottom: 'var(--app-shell-footer-height, 44px)', zIndex: 3 }}
          >
            <Group justify="flex-end" gap="sm">
              <Button variant="default" onClick={() => void cancelEditing()} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" leftSection={<IconDeviceFloppy size={16} />} loading={saving}>
                Save Item
              </Button>
            </Group>
          </Paper>
        ) : null}
      </form>

      {unitDialog ? (
        <ItemUnitFormModal
          unitTypes={lookups.unitTypes}
          unit={unitDialog.unit}
          siblings={units}
          forceBase={units.length === 0 && !unitDialog.unit}
          onSave={saveUnit}
          onClose={() => setUnitDialog(null)}
        />
      ) : null}
    </>
  )
}

const BREADCRUMBS = [{ label: 'Inventory' }, { label: 'Item Definition', to: '/inventory/items' }]

/** In edit mode the control; in view mode the same value as read-only text under its label. */
function Field({
  label,
  value,
  editing,
  multiline = false,
  children,
}: {
  label: string
  value: string | undefined
  editing: boolean
  /** Keeps the line breaks typed in a textarea (the Note). */
  multiline?: boolean
  children: React.ReactNode
}) {
  if (editing) return <>{children}</>

  return (
    <Stack gap={2}>
      <Text c="dimmed" fz="xs" fw={500}>
        {label}
      </Text>
      <Text fz="sm" style={multiline ? { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } : undefined}>
        {value === undefined || value === '' ? '—' : value}
      </Text>
    </Stack>
  )
}

/**
 * Previous or Next in the item header. Disabled at either end of the list; the code it leads to is its tooltip.
 * Icon-only on a phone, where the words would push the item's code off the bar.
 */
function ItemStepButton({
  direction,
  target,
  iconOnly,
  onStep,
}: {
  direction: 'previous' | 'next'
  target: ItemSequenceEntry | null
  iconOnly: boolean
  onStep: (entry: ItemSequenceEntry | null) => void
}) {
  const label = direction === 'previous' ? 'Previous' : 'Next'
  const icon = direction === 'previous' ? <IconChevronLeft size={16} /> : <IconChevronRight size={16} />
  const hint = target
    ? `${label}: ${target.itemCode}`
    : direction === 'previous'
      ? 'This is the first active item in the list.'
      : 'This is the last active item in the list.'

  return (
    <Tooltip label={hint} withArrow>
      {/* data-disabled rather than disabled: a disabled button swallows the hover the tooltip needs. */}
      <Button
        variant="default"
        px={iconOnly ? 10 : undefined}
        aria-label={iconOnly ? hint : undefined}
        data-disabled={target ? undefined : true}
        aria-disabled={target ? undefined : true}
        onClick={(event) => {
          if (!target) {
            event.preventDefault()
            return
          }
          onStep(target)
        }}
        leftSection={direction === 'previous' && !iconOnly ? icon : undefined}
        rightSection={direction === 'next' && !iconOnly ? icon : undefined}
      >
        {iconOnly ? icon : label}
      </Button>
    </Tooltip>
  )
}

function FieldSkeletons({ rows }: { rows: number }) {
  return (
    <Stack gap="md">
      {Array.from({ length: rows }, (_, i) => (
        <Group key={i} grow>
          <Skeleton height={38} radius="md" />
          <Skeleton height={38} radius="md" />
        </Group>
      ))}
    </Stack>
  )
}
