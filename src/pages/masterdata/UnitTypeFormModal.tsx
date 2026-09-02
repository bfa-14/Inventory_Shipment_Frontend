import { useState } from 'react'
import { Alert, Anchor, Switch, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { ApiError } from '../../api/http'
import { unitTypesApi } from '../../api/masterdata/unitTypes'
import type { SaveUnitTypeRequest, UnitTypeDto } from '../../api/types'
import { FormModal } from '../../components/ui/FormModal'

interface UnitTypeFormModalProps {
  mode: 'create' | 'edit'
  unitType?: UnitTypeDto
  onClose(): void
  onSaved(unitType: UnitTypeDto): void
}

interface FormValues {
  unitTypeName: string
  isActive: boolean
}

const MAX_NAME = 50

export function UnitTypeFormModal({ mode, unitType, onClose, onSaved }: UnitTypeFormModalProps) {
  const [rowVersion, setRowVersion] = useState(unitType?.rowVersion ?? null)
  const [formError, setFormError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)

  const form = useForm<FormValues>({
    initialValues: {
      unitTypeName: unitType?.unitTypeName ?? '',
      isActive: unitType?.isActive ?? true,
    },
    validate: {
      unitTypeName: (value) => {
        const name = value.trim()
        if (!name) return 'Name is required.'
        if (name.length > MAX_NAME) return `Name cannot be longer than ${MAX_NAME} characters.`
        return null
      },
    },
  })

  function buildPayload(values: FormValues): SaveUnitTypeRequest {
    return {
      unitTypeName: values.unitTypeName.trim(),
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
          ? await unitTypesApi.create(payload)
          : await unitTypesApi.update((unitType as UnitTypeDto).id, payload)

      onSaved(saved)
    } catch (error) {
      handleError(error)
    } finally {
      setSaving(false)
    }
  }

  function handleError(error: unknown) {
    if (!(error instanceof ApiError)) {
      setFormError('The unit type could not be saved.')
      return
    }

    if (error.code === 'DUPLICATE_NAME') {
      form.setErrors({ unitTypeName: 'A unit type with this name already exists.' })
      return
    }

    if (error.code === 'CONCURRENCY') {
      setStale(true)
      setFormError(error.messages.join(' '))
      return
    }

    // ASP.NET model validation: map the messages back onto the field they belong to.
    const messages = Object.entries(error.fieldErrors)
      .filter(([field]) => field.toLowerCase().includes('unittypename'))
      .flatMap(([, value]) => value)

    if (messages.length > 0) {
      form.setErrors({ unitTypeName: messages.join(' ') })
      return
    }

    setFormError(error.messages.join(' '))
  }

  /** After a concurrency conflict: pull the current row back into the form. */
  async function reload() {
    if (!unitType) return
    try {
      const fresh = await unitTypesApi.get(unitType.id)
      form.setValues({ unitTypeName: fresh.unitTypeName, isActive: fresh.isActive })
      setRowVersion(fresh.rowVersion)
      setStale(false)
      setFormError(null)
    } catch (error) {
      setFormError(error instanceof ApiError ? error.messages.join(' ') : 'The unit type could not be reloaded.')
    }
  }

  return (
    <FormModal
      opened
      title={mode === 'create' ? 'New Unit Type' : 'Edit Unit Type'}
      saveLabel="Save Unit Type"
      saving={saving}
      onClose={onClose}
      onSubmit={() => form.onSubmit((values) => void save(values))()}
    >
      <TextInput
        label="Name"
        placeholder="Pallet"
        withAsterisk
        data-autofocus
        maxLength={MAX_NAME}
        {...form.getInputProps('unitTypeName')}
      />

      <Switch
        label="Active"
        description="Only active unit types are offered when an item's packaging is defined."
        {...form.getInputProps('isActive', { type: 'checkbox' })}
      />

      {formError ? (
        <Alert color="red">
          {formError}
          {stale ? (
            <>
              {' '}
              <Anchor component="button" type="button" onClick={reload}>
                Reload
              </Anchor>{' '}
              the unit type to get the latest values and try again.
            </>
          ) : null}
        </Alert>
      ) : null}
    </FormModal>
  )
}
