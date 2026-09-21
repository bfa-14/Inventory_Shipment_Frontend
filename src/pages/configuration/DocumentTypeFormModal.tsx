import { useState } from 'react'
import { Alert, Checkbox, Grid, NumberInput, Select, Stack, Switch, Text, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { IconAlertTriangle } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { inventoryLookupsApi, type DocumentTypeDto } from '../../api/inventory/stockDocuments'
import { numberInputValue } from '../../components/format'
import { FormModal } from '../../components/ui/FormModal'

interface DocumentTypeFormModalProps {
  type: DocumentTypeDto
  onClose(): void
  onSaved(type: DocumentTypeDto): void
}

interface FormValues {
  name: string
  numberPrefix: string
  numberLength: number | ''
  numberOnPost: boolean
  numberPerBranch: boolean
  yearInNumber: boolean
  requiresReason: boolean
  defaultPricing: string | null
  priceEditable: boolean
  isActive: boolean
}

const PRICING_OPTIONS = [
  { value: 'Cost', label: 'Cost — a typed or average cost per line' },
  { value: 'PriceList', label: 'Price list — the price list price, override by permission' },
  { value: 'None', label: 'None — no money on the lines (orders)' },
]

/** The words for a stock direction on the read-only line. */
function directionLabel(direction: number): string {
  return direction > 0 ? 'Adds stock (In)' : direction < 0 ? 'Removes stock (Out)' : 'No stock effect'
}

/**
 * Editing one document type.
 *
 * CODE, FAMILY AND DIRECTION ARE SHOWN, NOT EDITED. They are what the procedures branch on; a form
 * that could flip a type's direction would turn every posted document of it into a lie. What a
 * business owner changes is the wording, the numbering and the pricing rule — and the numbering
 * change is said, in the warning, to apply to new documents only.
 */
export function DocumentTypeFormModal({ type, onClose, onSaved }: DocumentTypeFormModalProps) {
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)

  const form = useForm<FormValues>({
    initialValues: {
      name: type.name,
      numberPrefix: type.numberPrefix,
      numberLength: type.numberLength,
      numberOnPost: type.numberOnPost,
      numberPerBranch: type.numberPerBranch,
      yearInNumber: type.yearInNumber,
      requiresReason: type.requiresReason,
      defaultPricing: type.defaultPricing,
      priceEditable: type.priceEditable,
      isActive: type.isActive,
    },
    validate: {
      name: (value) => (value.trim() ? (value.trim().length > 100 ? 'Name cannot be longer than 100 characters.' : null) : 'Name is required.'),
      numberPrefix: (value) =>
        value.trim() ? (value.trim().length > 10 ? 'Prefix cannot be longer than 10 characters.' : null) : 'Prefix is required.',
      numberLength: (value) =>
        value === '' || !Number.isInteger(value) || value < 3 || value > 10 ? 'Length must be between 3 and 10.' : null,
      defaultPricing: (value) => (value ? null : 'Choose the default pricing.'),
    },
  })

  async function submit() {
    if (form.validate().hasErrors) return
    const values = form.values
    setSaving(true)
    setFormError(null)
    try {
      const saved = await inventoryLookupsApi.updateDocumentType(type.id, {
        name: values.name.trim(),
        numberPrefix: values.numberPrefix.trim(),
        numberLength: Number(values.numberLength),
        numberOnPost: values.numberOnPost,
        numberPerBranch: values.numberPerBranch,
        yearInNumber: values.yearInNumber,
        requiresReason: values.requiresReason,
        defaultPricing: values.defaultPricing as string,
        priceEditable: values.priceEditable,
        isActive: values.isActive,
        rowVersion: type.rowVersion,
      })
      onSaved(saved)
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONCURRENCY') setStale(true)
      else setFormError(error instanceof ApiError ? error.message : 'The document type could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormModal opened title={`Edit ${type.code} — ${type.name}`} onSubmit={() => void submit()} onClose={onClose} saving={saving} saveDisabled={stale}>
      <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="Numbering applies to new documents only">
        Changing the prefix or the numbering applies to NEW documents only. Documents already numbered keep
        their numbers.
      </Alert>

      {stale && (
        <Alert color="red" title="Changed elsewhere">
          This document type was modified by another user. Close the dialog and reload the page to see the current values.
        </Alert>
      )}
      {formError && <Alert color="red">{formError}</Alert>}

      <Grid>
        <Grid.Col span={{ base: 12, sm: 4 }}>
          <ReadOnly label="Code" value={type.code} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4 }}>
          <ReadOnly label="Family" value={type.family} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4 }}>
          <ReadOnly label="Stock direction" value={directionLabel(type.stockDirection)} />
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 8 }}>
          <TextInput label="Name" withAsterisk maxLength={100} {...form.getInputProps('name')} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4 }}>
          <TextInput label="Number prefix" withAsterisk maxLength={10} placeholder="IN-" {...form.getInputProps('numberPrefix')} />
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 4 }}>
          <NumberInput
            label="Number length"
            withAsterisk
            min={3}
            max={10}
            allowDecimal={false}
            description="Digits after the prefix: 6 gives IN-KLW-000012."
            value={form.values.numberLength}
            onChange={(next) => form.setFieldValue('numberLength', numberInputValue(next) ?? '')}
            error={form.errors.numberLength}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 8 }}>
          <Select label="Default pricing" withAsterisk data={PRICING_OPTIONS} allowDeselect={false} {...form.getInputProps('defaultPricing')} />
        </Grid.Col>

        <Grid.Col span={12}>
          <Stack gap="xs" mt="xs">
            <Switch
              label="Number assigned on posting"
              description="On: drafts show DRAFT and the number is assigned when the document is posted (gapless). Off: the number is assigned on the first save."
              {...form.getInputProps('numberOnPost', { type: 'checkbox' })}
            />
            <Switch
              label="Number per branch"
              description='On: each branch has its own sequence ("IN-KLW-000012"). Off: one sequence for the company.'
              {...form.getInputProps('numberPerBranch', { type: 'checkbox' })}
            />
            <Checkbox
              label="Year in number"
              description='Ticked: the year is part of the number and the sequence restarts every year ("SHR-2026-000001").'
              {...form.getInputProps('yearInNumber', { type: 'checkbox' })}
            />
            <Switch label="Requires a reason" description="The Reason field is mandatory on this document." {...form.getInputProps('requiresReason', { type: 'checkbox' })} />
            <Switch
              label="Price / cost editable"
              description="Off: the column is read-only — an Inventory Out takes the average cost automatically."
              {...form.getInputProps('priceEditable', { type: 'checkbox' })}
            />
            <Switch label="Active" {...form.getInputProps('isActive', { type: 'checkbox' })} />
          </Stack>
        </Grid.Col>
      </Grid>
    </FormModal>
  )
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text fz="sm" fw={500}>
        {label}
      </Text>
      <Text fz="sm" c="dimmed">
        {value}
      </Text>
    </div>
  )
}
