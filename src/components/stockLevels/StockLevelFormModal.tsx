import { useEffect, useMemo, useState } from 'react'
import { Alert, MultiSelect, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core'
import { ApiError } from '../../api/http'
import { itemsApi } from '../../api/inventory/items'
import {
  stockLevelsApi,
  type SetStockLevelsResult,
  type StockLevelRowDto,
  type StockLevelSource,
} from '../../api/inventory/stockLevels'
import { warehousesApi } from '../../api/masterdata/warehouses'
import type { ItemLookupDto, WarehouseLookupDto } from '../../api/types'
import { numberInputValue } from '../format'
import { FormModal } from '../ui/FormModal'
import { notify } from '../ui/notify'
import { levelWarehouseChoices } from './levelWarehouses'
import { levelText } from './stockLevelStatus'

export interface StockLevelFormModalProps {
  opened: boolean
  /** The item, when known (Item Definition's card, a row of Stock Levels). Null: "Add stock levels", the item first. */
  item: { id: number; itemCode: string } | null
  /** One warehouse, read-only (a row's "Set level…" / "Add level…", the card's pencil). Left out: choose them. */
  warehouse?: { id: number; code: string; name: string } | null
  /** The item's levels already read (the card's rows): saves a round trip. Left out: read here. */
  existing?: StockLevelRowDto[]
  source: Exclude<StockLevelSource, 'Import'>
  onClose(): void
  /** Saved: the item's rows again and the server's message (already shown as a notification). */
  onSaved(result: SetStockLevelsResult): void
  /** A 404 / 409: the host reloads what it shows (the dialog reads the item's levels again itself). */
  onStale?(): void
}

/**
 * ONE ITEM'S MIN / MAX IN ONE OR MORE WAREHOUSES (script 91): "Set levels…" on Item Definition's card, "Add levels…",
 * "Set level…" and "Add level…" on Inventory › Stock Levels. A FormModal: Enter submits, the cursor starts in the first
 * field (Min when the warehouse is fixed).
 *
 * ALL OR NOTHING, ON THE SERVER. Every chosen warehouse gets the same Min and Max in one call
 * (usp_ItemWarehouseLevel_Set), each with the RowVersion of the level it replaces when there is one, so a level another
 * user changed meanwhile is refused (409, "… was changed by another user. Reload and try again.") instead of
 * overwritten. A warehouse that already has a level says so before the click ("LUB-01 already has Min 10 / Max 40: it is
 * replaced."). The server's sentences are shown as they come, in the dialog; its message after a save as a notification.
 */
/** A level is at most 1,000,000,000 pcs (the server's rule, CK_ItemWarehouseLevels_Range): said here before the click. */
const MAX_LEVEL = 1_000_000_000
const TOO_BIG = 'Min and Max can be at most 1,000,000,000 pcs.'

export function StockLevelFormModal(props: StockLevelFormModalProps) {
  // Keyed on opened: every opening is a fresh form, never the half-typed values of the last one.
  return <StockLevelForm key={props.opened ? 'open' : 'closed'} {...props} />
}

function StockLevelForm({ opened, item, warehouse, existing, source, onClose, onSaved, onStale }: StockLevelFormModalProps) {
  const fixed = warehouse ?? null
  const [itemId, setItemId] = useState<number | null>(item?.id ?? null)
  const [items, setItems] = useState<ItemLookupDto[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseLookupDto[]>([])
  /**
   * The item's levels, for "already has" and the RowVersions sent back: given by the host, else read once the item is
   * known, and read again after a 404 / 409 (`reloads`). `key` says which item and which reading they are.
   */
  const [reloads, setReloads] = useState(0)
  const [levels, setLevels] = useState<{ itemId: number; key: string; rows: StockLevelRowDto[] } | null>(
    item && existing ? { itemId: item.id, key: `${item.id}:0`, rows: existing } : null,
  )
  const wantedKey = itemId === null ? null : `${itemId}:${reloads}`
  const loadedKey = levels?.key ?? null

  const levelRows = levels !== null && levels.itemId === itemId ? levels.rows : []
  const levelOf = (warehouseId: number) => levelRows.find((r) => r.warehouseId === warehouseId && r.hasLevel) ?? null

  const fixedLevel = fixed ? levelOf(fixed.id) : null
  const [warehouseIds, setWarehouseIds] = useState<string[]>(fixed ? [String(fixed.id)] : [])
  const [min, setMin] = useState<number | ''>(fixedLevel?.minQuantityBase ?? '')
  const [max, setMax] = useState<number | ''>(fixedLevel?.maxQuantityBase ?? '')
  const [errors, setErrors] = useState<{ item?: string; warehouses?: string; min?: string; max?: string }>({})
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  /* The lists: the items only when the dialog has to ask for one; the warehouses unless the one is fixed. */
  const needItems = item === null
  useEffect(() => {
    if (!needItems) return
    itemsApi
      .lookup(true)
      .then(setItems)
      .catch(() => setServerError('The items could not be loaded.'))
  }, [needItems])

  const needWarehouses = fixed === null
  useEffect(() => {
    if (!needWarehouses) return
    warehousesApi
      .lookup(true)
      .then(setWarehouses)
      .catch(() => setServerError('The warehouses could not be loaded.'))
  }, [needWarehouses])

  useEffect(() => {
    if (wantedKey === null || itemId === null || loadedKey === wantedKey) return
    const controller = new AbortController()
    const forItem = itemId
    stockLevelsApi
      .forItem(forItem, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setLevels({ itemId: forItem, key: wantedKey, rows: result.rows })
      })
      .catch(() => {
        /* "Already has" stays unsaid; the server still refuses a level changed meanwhile. */
      })
    return () => controller.abort()
  }, [wantedKey, loadedKey, itemId])

  const choices = useMemo(() => levelWarehouseChoices(warehouses), [warehouses])
  const itemData = useMemo(
    () => items.map((i) => ({ value: String(i.id), label: `${i.itemCode} - ${i.itemName}` })),
    [items],
  )
  /** "LUB-01 already has Min 10 / Max 40: it is replaced." - one line per chosen warehouse that has a level. */
  const replaced = fixed
    ? []
    : warehouseIds
        .map((id) => levelOf(Number(id)))
        .filter((row): row is StockLevelRowDto => row !== null)
        .map((row) => `${row.warehouseCode} already has ${levelText(row.minQuantityBase, row.maxQuantityBase)}: it is replaced.`)

  function validate(): boolean {
    const next: typeof errors = {}
    if (itemId === null) next.item = 'Choose an item.'
    if (warehouseIds.length === 0) next.warehouses = 'Choose at least one warehouse.'
    if (min === '' || !Number.isInteger(min) || min < 0) next.min = 'Min must be a whole number, 0 or more.'
    else if (min > MAX_LEVEL) next.min = TOO_BIG
    if (max !== '' && (!Number.isInteger(max) || max < 0)) next.max = 'Max must be a whole number, 0 or more.'
    else if (max !== '' && max > MAX_LEVEL) next.max = TOO_BIG
    else if (max !== '' && min !== '' && max < min) next.max = 'Max cannot be less than Min.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function submit() {
    if (saving || !validate() || itemId === null) return
    setSaving(true)
    setServerError(null)
    try {
      const result = await stockLevelsApi.set(itemId, {
        source,
        levels: warehouseIds.map((id) => ({
          warehouseId: Number(id),
          minQuantityBase: min === '' ? null : min,
          maxQuantityBase: max === '' ? null : max,
          rowVersion: levelOf(Number(id))?.rowVersion ?? null,
        })),
      })
      if (result.message) notify.success(result.message)
      onSaved(result)
      onClose()
    } catch (error) {
      setServerError(error instanceof ApiError ? error.messages.join(' ') : 'The stock levels could not be saved.')
      // Changed or removed by someone else: the levels read again, so "already has" and the RowVersions are current.
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
        setReloads((count) => count + 1)
        onStale?.()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormModal
      opened={opened}
      title={item ? `Stock levels - ${item.itemCode}` : 'Add stock levels'}
      onSubmit={() => void submit()}
      onClose={onClose}
      saving={saving}
      saveLabel={fixed ? 'Save' : 'Save levels'}
    >
      <Stack gap="sm">
        {serverError ? (
          <Alert color="red" data-stock-level-form-error>
            {serverError}
          </Alert>
        ) : null}

        {item ? null : (
          <Select
            label="Item"
            withAsterisk
            placeholder="Search by code or name"
            data={itemData}
            value={itemId === null ? null : String(itemId)}
            onChange={(next) => {
              setItemId(next === null ? null : Number(next))
              setErrors((e) => ({ ...e, item: undefined }))
            }}
            searchable
            clearable
            limit={50}
            nothingFoundMessage="No item matches"
            error={errors.item}
            disabled={saving}
          />
        )}

        {fixed ? (
          <TextInput label="Warehouse" value={`${fixed.code} - ${fixed.name}`} readOnly variant="filled" />
        ) : (
          <MultiSelect
            label="Warehouses"
            withAsterisk
            description="Warehouses at the bottom of the tree, of every branch. Each gets the same Min and Max."
            placeholder={warehouseIds.length === 0 ? 'Choose one or more warehouses' : undefined}
            data={choices}
            value={warehouseIds}
            onChange={(next) => {
              setWarehouseIds(next)
              setErrors((e) => ({ ...e, warehouses: undefined }))
            }}
            searchable
            clearable
            hidePickedOptions
            nothingFoundMessage="No warehouse matches"
            error={errors.warehouses}
            disabled={saving}
          />
        )}

        <NumberInput
          label="Min (pcs)"
          withAsterisk
          min={0}
          max={MAX_LEVEL}
          clampBehavior="none"
          step={1}
          allowDecimal={false}
          allowNegative={false}
          thousandSeparator=","
          value={min}
          onChange={(next) => {
            const value = numberInputValue(next)
            setMin(value === null ? '' : value)
            setErrors((e) => ({ ...e, min: undefined }))
          }}
          error={errors.min}
          disabled={saving}
          // The warehouse is fixed: the cursor starts here, not in the read-only warehouse.
          data-autofocus={fixed ? 'true' : undefined}
        />

        <NumberInput
          label="Max (pcs)"
          placeholder="No maximum"
          description="Fill to Max fills up to Max; with no Max, up to Min."
          min={0}
          max={MAX_LEVEL}
          clampBehavior="none"
          step={1}
          allowDecimal={false}
          allowNegative={false}
          thousandSeparator=","
          value={max}
          onChange={(next) => {
            const value = numberInputValue(next)
            setMax(value === null ? '' : value)
            setErrors((e) => ({ ...e, max: undefined }))
          }}
          error={errors.max}
          disabled={saving}
        />

        {replaced.length > 0 ? (
          <Alert color="orange" data-stock-level-replaced>
            <Stack gap={2}>
              {replaced.map((line) => (
                <Text key={line} fz="sm">
                  {line}
                </Text>
              ))}
            </Stack>
          </Alert>
        ) : null}
      </Stack>
    </FormModal>
  )
}
