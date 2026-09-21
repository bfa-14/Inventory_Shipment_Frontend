import { useState } from 'react'
import { Alert, Anchor, Grid, Group, Select, Switch, Text, Textarea, TextInput, Tooltip } from '@mantine/core'
import { useForm } from '@mantine/form'
import { IconAlertTriangle } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import {
  allocationMethodLabel,
  chargeTypesApi,
  CHARGE_ALLOCATION_METHODS,
  METHODS_NEEDING_ITEM_DATA,
  type ChargeAllocationMethod,
  type ChargeTypeDto,
  type SaveChargeTypeRequest,
} from '../../api/purchase/chargeTypes'
import { FormModal } from '../../components/ui/FormModal'

interface ChargeTypeFormModalProps {
  mode: 'create' | 'edit'
  chargeType?: ChargeTypeDto
  onClose(): void
  onSaved(chargeType: ChargeTypeDto): void
}

interface FormValues {
  chargeCode: string
  chargeName: string
  allocationMethod: ChargeAllocationMethod
  includeInLandedCost: boolean
  isRecoverableTax: boolean
  description: string
  isActive: boolean
}

const MAX_CODE = 10
const MAX_NAME = 100
const MAX_DESCRIPTION = 500

/** Why a recoverable tax cannot also be part of the cost - said in the form, not only in the API's refusal. */
const RECOVERABLE_HINT = 'A recoverable tax is never part of the item cost'

const ALLOCATION_OPTIONS = CHARGE_ALLOCATION_METHODS.map((method) => ({
  value: method,
  label: allocationMethodLabel(method),
}))

export function ChargeTypeFormModal({ mode, chargeType, onClose, onSaved }: ChargeTypeFormModalProps) {
  const [rowVersion, setRowVersion] = useState(chargeType?.rowVersion ?? null)
  const [formError, setFormError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)

  const form = useForm<FormValues>({
    initialValues: {
      chargeCode: chargeType?.chargeCode ?? '',
      chargeName: chargeType?.chargeName ?? '',
      allocationMethod: chargeType?.allocationMethod ?? 'Value',
      includeInLandedCost: chargeType?.includeInLandedCost ?? true,
      isRecoverableTax: chargeType?.isRecoverableTax ?? false,
      description: chargeType?.description ?? '',
      isActive: chargeType?.isActive ?? true,
    },
    validate: {
      chargeCode: (value) => {
        const code = value.trim()
        if (!code) return 'Charge Code is required.'
        if (code.length > MAX_CODE) return `Charge Code cannot be longer than ${MAX_CODE} characters.`
        return null
      },
      chargeName: (value) => {
        const name = value.trim()
        if (!name) return 'Charge Name is required.'
        if (name.length > MAX_NAME) return `Charge Name cannot be longer than ${MAX_NAME} characters.`
        return null
      },
      description: (value) =>
        value.trim().length > MAX_DESCRIPTION
          ? `Description cannot be longer than ${MAX_DESCRIPTION} characters.`
          : null,
    },
  })

  // The hint the chosen method carries, if it is one of the two that read a figure off the item.
  const methodHint = METHODS_NEEDING_ITEM_DATA[form.values.allocationMethod]
  const recoverable = form.values.isRecoverableTax

  function buildPayload(values: FormValues): SaveChargeTypeRequest {
    return {
      chargeCode: values.chargeCode.trim(),
      chargeName: values.chargeName.trim(),
      allocationMethod: values.allocationMethod,
      // Belt and braces: the switch is already forced off and disabled, but a payload that said
      // "recoverable AND in the cost" would be refused by the server rather than silently corrected.
      includeInLandedCost: values.isRecoverableTax ? false : values.includeInLandedCost,
      isRecoverableTax: values.isRecoverableTax,
      description: values.description.trim() ? values.description.trim() : null,
      isActive: values.isActive,
      ...(mode === 'edit' ? { rowVersion } : {}),
    }
  }

  async function save(values: FormValues) {
    setSaving(true)
    setFormError(null)
    setStale(false)

    try {
      const payload = buildPayload(values)
      const saved =
        mode === 'create'
          ? await chargeTypesApi.create(payload)
          : await chargeTypesApi.update((chargeType as ChargeTypeDto).id, payload)

      onSaved(saved)
    } catch (error) {
      handleError(error)
    } finally {
      setSaving(false)
    }
  }

  /** IN_USE cannot reach here: it is the delete's refusal, and a save never asks to remove anything. */
  function handleError(error: unknown) {
    if (!(error instanceof ApiError)) {
      setFormError('The charge type could not be saved.')
      return
    }

    if (error.code === 'DUPLICATE_CODE') {
      form.setErrors({ chargeCode: 'A charge type with this code already exists.' })
      return
    }

    if (error.code === 'DUPLICATE_NAME') {
      form.setErrors({ chargeName: 'A charge type with this name already exists.' })
      return
    }

    if (error.code === 'CONCURRENCY') {
      setStale(true)
      setFormError(error.messages.join(' '))
      return
    }

    // ASP.NET model validation: map the messages back onto the fields they belong to.
    const mapped: Record<string, string> = {}
    for (const [field, messages] of Object.entries(error.fieldErrors)) {
      const key = field.toLowerCase()
      const message = messages.join(' ')
      if (key.includes('chargecode')) mapped.chargeCode = message
      else if (key.includes('chargename')) mapped.chargeName = message
      else if (key.includes('allocationmethod')) mapped.allocationMethod = message
      else if (key.includes('description')) mapped.description = message
    }

    if (Object.keys(mapped).length > 0) {
      form.setErrors(mapped)
      return
    }

    setFormError(error.messages.join(' '))
  }

  /** After a concurrency conflict: pull the current row back into the form. */
  async function reload() {
    if (!chargeType) return
    try {
      const fresh = await chargeTypesApi.get(chargeType.id)
      form.setValues({
        chargeCode: fresh.chargeCode,
        chargeName: fresh.chargeName,
        allocationMethod: fresh.allocationMethod,
        includeInLandedCost: fresh.includeInLandedCost,
        isRecoverableTax: fresh.isRecoverableTax,
        description: fresh.description ?? '',
        isActive: fresh.isActive,
      })
      setRowVersion(fresh.rowVersion)
      setStale(false)
      setFormError(null)
    } catch (error) {
      setFormError(error instanceof ApiError ? error.messages.join(' ') : 'The charge type could not be reloaded.')
    }
  }

  return (
    <FormModal
      opened
      title={mode === 'create' ? 'New Charge Type' : 'Edit Charge Type'}
      saveLabel="Save Charge Type"
      saving={saving}
      onClose={onClose}
      onSubmit={() => form.onSubmit((values) => void save(values))()}
    >
      <Grid>
        <Grid.Col span={{ base: 12, sm: 4 }}>
          <TextInput
            label="Charge Code"
            placeholder="FRT"
            withAsterisk
            maxLength={MAX_CODE}
            {...form.getInputProps('chargeCode')}
            // Codes are upper case everywhere they are shown, so the box does the shifting rather
            // than leaving the reader to discover their "frt" came back as "FRT".
            onChange={(event) => form.setFieldValue('chargeCode', event.currentTarget.value.toUpperCase())}
          />
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 8 }}>
          <TextInput
            label="Charge Name"
            placeholder="Ocean freight"
            withAsterisk
            maxLength={MAX_NAME}
            {...form.getInputProps('chargeName')}
          />
        </Grid.Col>

        <Grid.Col span={12}>
          <Select
            label="Allocation Method"
            placeholder="How the charge is spread over the goods"
            withAsterisk
            allowDeselect={false}
            data={ALLOCATION_OPTIONS}
            // The warning is repeated under the box once the method is chosen: the dropdown is shut
            // by then, and a prerequisite the reader can no longer see is one they will not meet.
            description={methodHint}
            {...form.getInputProps('allocationMethod')}
            renderOption={({ option }) => {
              const hint = METHODS_NEEDING_ITEM_DATA[option.value]
              return (
                <Group gap={6} wrap="nowrap">
                  <Text fz="sm">{option.label}</Text>
                  {hint ? (
                    <Tooltip label={hint} withArrow position="right" multiline w={240}>
                      <IconAlertTriangle size={15} color="var(--mantine-color-yellow-6)" />
                    </Tooltip>
                  ) : null}
                </Group>
              )
            }}
          />
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6 }}>
          <Switch
            label="Include in Landed Cost"
            description={recoverable ? RECOVERABLE_HINT : 'The charge is added to the cost of the goods.'}
            disabled={recoverable}
            {...form.getInputProps('includeInLandedCost', { type: 'checkbox' })}
          />
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6 }}>
          <Switch
            label="Recoverable Tax"
            description="Reclaimed from the authority rather than borne by the goods."
            {...form.getInputProps('isRecoverableTax', { type: 'checkbox' })}
            onChange={(event) => {
              const on = event.currentTarget.checked
              form.setFieldValue('isRecoverableTax', on)
              // Turning it back off re-enables the other switch but leaves it off: the reader
              // decides whether this charge belongs in the cost, not the switch they just released.
              if (on) form.setFieldValue('includeInLandedCost', false)
            }}
          />
        </Grid.Col>

        <Grid.Col span={12}>
          <Textarea
            label="Description"
            placeholder="What this charge covers..."
            autosize
            minRows={3}
            maxLength={MAX_DESCRIPTION}
            // The counter belongs under the box it counts, not above the label.
            inputWrapperOrder={['label', 'input', 'description', 'error']}
            description={`${form.values.description.length}/${MAX_DESCRIPTION}`}
            styles={{ description: { textAlign: 'right' } }}
            {...form.getInputProps('description')}
          />
        </Grid.Col>

        <Grid.Col span={12}>
          <Switch
            label="Active"
            description="Only active charge types are offered on a charge line."
            {...form.getInputProps('isActive', { type: 'checkbox' })}
          />
        </Grid.Col>
      </Grid>

      {formError ? (
        <Alert color="red">
          {formError}
          {stale ? (
            <>
              {' '}
              <Anchor component="button" type="button" onClick={reload}>
                Reload
              </Anchor>{' '}
              the charge type to get the latest values and try again.
            </>
          ) : null}
        </Alert>
      ) : null}
    </FormModal>
  )
}
