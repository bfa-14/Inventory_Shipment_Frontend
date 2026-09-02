import { useState } from 'react'
import { Alert, Group, NumberInput, Select, Stack, Switch, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { ApiError } from '../../api/http'
import type { ItemUnitDto, SaveItemUnitRequest, UnitTypeLookupDto } from '../../api/types'
import { FormModal } from '../../components/ui/FormModal'
import { notify } from '../../components/ui/notify'

export interface ItemUnitFormModalProps {
  unitTypes: UnitTypeLookupDto[]
  /** The unit being edited; absent when adding one. */
  unit?: ItemUnitDto
  /** The item's other units - what "already used" is measured against. */
  siblings: ItemUnitDto[]
  /** True when this will be the item's first unit: it must be the base, so the switch is locked on. */
  forceBase: boolean
  /** Saves the unit. Rejecting with an ApiError puts the message next to the field it belongs to. */
  onSave(payload: SaveItemUnitRequest): Promise<void>
  onClose(): void
}

interface FormValues {
  unitTypeId: string | null
  packingFormula: number
  skuCode: string
  barcode: string
  isSalesUnit: boolean
  isPurchaseUnit: boolean
  isBaseUnit: boolean
}

const MAX_SKU = 50
const MAX_BARCODE = 50

export function ItemUnitFormModal({ unitTypes, unit, siblings, forceBase, onSave, onClose }: ItemUnitFormModalProps) {
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const editing = unit !== undefined

  // A unit type can only be used once per item, so the ones already taken are not offered again -
  // except the one this unit itself is on.
  const taken = new Set(siblings.filter((s) => s.id !== unit?.id).map((s) => s.unitTypeId))

  const form = useForm<FormValues>({
    initialValues: {
      unitTypeId: unit ? String(unit.unitTypeId) : null,
      packingFormula: unit?.packingFormula ?? (forceBase ? 1 : 1),
      skuCode: unit?.skuCode ?? '',
      barcode: unit?.barcode ?? '',
      isSalesUnit: unit?.isSalesUnit ?? false,
      isPurchaseUnit: unit?.isPurchaseUnit ?? false,
      isBaseUnit: unit?.isBaseUnit ?? forceBase,
    },
    validate: {
      unitTypeId: (value) => (value ? null : 'Unit Type is required.'),
      packingFormula: (value, values) => {
        if (!Number.isInteger(value) || value < 1) return 'Packing Formula must be a whole number of at least 1.'
        if (values.isBaseUnit && value !== 1) return 'The base unit holds one base unit, so its formula is 1.'
        return null
      },
      skuCode: (value) => {
        const sku = value.trim()
        if (!sku) return 'SKU Code is required.'
        if (sku.length > MAX_SKU) return `SKU Code cannot be longer than ${MAX_SKU} characters.`
        if (siblings.some((s) => s.id !== unit?.id && s.skuCode.toLowerCase() === sku.toLowerCase())) {
          return 'This SKU Code is already used by another unit of this item.'
        }
        return null
      },
      barcode: (value) =>
        value.trim().length > MAX_BARCODE ? `Barcode cannot be longer than ${MAX_BARCODE} characters.` : null,
    },
  })

  const isBase = form.values.isBaseUnit

  /** Marking a unit as the base fixes its formula at 1; the field goes read-only rather than lying. */
  function toggleBase(next: boolean) {
    form.setFieldValue('isBaseUnit', next)
    if (next) form.setFieldValue('packingFormula', 1)
  }

  async function submit(values: FormValues) {
    setSaving(true)
    setFormError(null)

    try {
      await onSave({
        unitTypeId: Number(values.unitTypeId),
        packingFormula: values.isBaseUnit ? 1 : values.packingFormula,
        skuCode: values.skuCode.trim(),
        barcode: values.barcode.trim() ? values.barcode.trim() : null,
        isSalesUnit: values.isSalesUnit,
        isPurchaseUnit: values.isPurchaseUnit,
        isBaseUnit: values.isBaseUnit,
        ...(editing ? { rowVersion: unit.rowVersion } : {}),
      })
    } catch (error) {
      handleError(error)
    } finally {
      setSaving(false)
    }
  }

  function handleError(error: unknown) {
    if (!(error instanceof ApiError)) {
      setFormError('The unit could not be saved.')
      return
    }

    if (error.code === 'DUPLICATE_SKU') {
      form.setErrors({ skuCode: error.messages[0] })
      return
    }

    if (error.code === 'DUPLICATE_BARCODE') {
      form.setErrors({ barcode: error.messages[0] })
      return
    }

    if (error.code === 'BASE_UNIT_RULE') {
      // The rule is about which unit is the base, not about one field's value, so it is said out
      // loud as well as marked on the switch that would change it.
      notify.error(error.messages[0] as string)
      setFormError(error.messages[0] as string)
      return
    }

    if (error.code === 'MASTER_INACTIVE') {
      form.setErrors({ unitTypeId: error.messages[0] })
      return
    }

    const mapped: Record<string, string> = {}
    for (const [field, messages] of Object.entries(error.fieldErrors)) {
      const key = field.toLowerCase()
      const message = messages.join(' ')
      if (key.includes('skucode')) mapped.skuCode = message
      else if (key.includes('barcode')) mapped.barcode = message
      else if (key.includes('packingformula')) mapped.packingFormula = message
      else if (key.includes('unittypeid')) mapped.unitTypeId = message
    }

    if (Object.keys(mapped).length > 0) {
      form.setErrors(mapped)
      return
    }

    setFormError(error.messages.join(' '))
  }

  return (
    <FormModal
      opened
      size="md"
      title={editing ? 'Edit Unit' : 'Add Unit'}
      saveLabel={editing ? 'Save Unit' : 'Add Unit'}
      saving={saving}
      onClose={onClose}
      onSubmit={() => form.onSubmit((values) => void submit(values))()}
    >
      <Select
        label="Unit Type"
        placeholder="Pick a unit type"
        withAsterisk
        searchable
        data-autofocus
        nothingFoundMessage="No unit type found"
        data={unitTypes.map((type) => ({
          value: String(type.id),
          label: type.unitTypeName + (type.isActive ? '' : ' (inactive)'),
          disabled: taken.has(type.id),
        }))}
        description="Each unit type can be used once per item."
        {...form.getInputProps('unitTypeId')}
      />

      <Group grow align="flex-start">
        <NumberInput
          label="Packing Formula"
          description={
            isBase ? 'The base unit is the yardstick, so its formula is 1.' : 'How many base units this holds.'
          }
          withAsterisk
          min={1}
          step={1}
          allowDecimal={false}
          allowNegative={false}
          disabled={isBase}
          {...form.getInputProps('packingFormula')}
        />
        <TextInput
          label="SKU Code"
          placeholder="AP160-BOX"
          withAsterisk
          maxLength={MAX_SKU}
          {...form.getInputProps('skuCode')}
        />
      </Group>

      <TextInput
        label="Barcode"
        placeholder="Optional - unique across the system"
        maxLength={MAX_BARCODE}
        {...form.getInputProps('barcode')}
      />

      <Stack gap="xs">
        <Switch label="Sales Unit" {...form.getInputProps('isSalesUnit', { type: 'checkbox' })} />
        <Switch label="Purchase Unit" {...form.getInputProps('isPurchaseUnit', { type: 'checkbox' })} />
        <Switch
          label="Base Unit"
          description={
            forceBase
              ? 'The first unit of an item is always its base unit.'
              : 'Each item has exactly one base unit; marking this as base replaces the current one.'
          }
          disabled={forceBase || (editing && unit.isBaseUnit)}
          checked={isBase}
          onChange={(event) => toggleBase(event.currentTarget.checked)}
        />
        {editing && unit.isBaseUnit ? (
          <Alert color="gray" variant="light">
            This is the base unit. To move the base, edit another unit and mark it as the base - this one is demoted
            automatically.
          </Alert>
        ) : null}
      </Stack>

      {formError ? <Alert color="red">{formError}</Alert> : null}
    </FormModal>
  )
}
