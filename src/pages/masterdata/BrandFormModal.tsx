import { useState } from 'react'
import { Alert, Anchor, Group, Switch, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { ApiError } from '../../api/http'
import { brandsApi } from '../../api/masterdata/brands'
import type { BrandDto, SaveBrandRequest } from '../../api/types'
import { FormModal } from '../../components/ui/FormModal'

interface BrandFormModalProps {
  mode: 'create' | 'edit'
  brand?: BrandDto
  onClose(): void
  onSaved(brand: BrandDto): void
}

interface FormValues {
  brandCode: string
  brandName: string
  description: string
  isActive: boolean
}

const MAX_CODE = 20
const MAX_NAME = 150
const MAX_DESCRIPTION = 500

export function BrandFormModal({ mode, brand, onClose, onSaved }: BrandFormModalProps) {
  const [rowVersion, setRowVersion] = useState(brand?.rowVersion ?? null)
  const [formError, setFormError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)

  const form = useForm<FormValues>({
    initialValues: {
      brandCode: brand?.brandCode ?? '',
      brandName: brand?.brandName ?? '',
      description: brand?.description ?? '',
      isActive: brand?.isActive ?? true,
    },
    validate: {
      brandCode: (value) => {
        const code = value.trim()
        if (!code) return 'Brand Code is required.'
        if (code.length > MAX_CODE) return `Brand Code cannot be longer than ${MAX_CODE} characters.`
        return null
      },
      brandName: (value) => {
        const name = value.trim()
        if (!name) return 'Brand Name is required.'
        if (name.length > MAX_NAME) return `Brand Name cannot be longer than ${MAX_NAME} characters.`
        return null
      },
      description: (value) =>
        value.trim().length > MAX_DESCRIPTION
          ? `Description cannot be longer than ${MAX_DESCRIPTION} characters.`
          : null,
    },
  })

  function buildPayload(values: FormValues): SaveBrandRequest {
    return {
      brandCode: values.brandCode.trim(),
      brandName: values.brandName.trim(),
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
        mode === 'create' ? await brandsApi.create(payload) : await brandsApi.update((brand as BrandDto).id, payload)

      onSaved(saved)
    } catch (error) {
      handleError(error)
    } finally {
      setSaving(false)
    }
  }

  function handleError(error: unknown) {
    if (!(error instanceof ApiError)) {
      setFormError('The brand could not be saved.')
      return
    }

    if (error.code === 'DUPLICATE_CODE') {
      form.setErrors({ brandCode: 'A brand with this Brand Code already exists.' })
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
      if (key.includes('brandcode')) mapped.brandCode = message
      else if (key.includes('brandname')) mapped.brandName = message
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
    if (!brand) return
    try {
      const fresh = await brandsApi.get(brand.id)
      form.setValues({
        brandCode: fresh.brandCode,
        brandName: fresh.brandName,
        description: fresh.description ?? '',
        isActive: fresh.isActive,
      })
      setRowVersion(fresh.rowVersion)
      setStale(false)
      setFormError(null)
    } catch (error) {
      setFormError(error instanceof ApiError ? error.messages.join(' ') : 'The brand could not be reloaded.')
    }
  }

  return (
    <FormModal
      opened
      title={mode === 'create' ? 'New Brand' : 'Edit Brand'}
      saveLabel="Save Brand"
      saving={saving}
      onClose={onClose}
      onSubmit={() => form.onSubmit((values) => void save(values))()}
    >
      <Group grow align="flex-start">
        <TextInput
          label="Brand Code"
          placeholder="BRD-002"
          withAsterisk
          maxLength={MAX_CODE}
          {...form.getInputProps('brandCode')}
        />
        <TextInput
          label="Brand Name"
          placeholder="Exide"
          withAsterisk
          maxLength={MAX_NAME}
          {...form.getInputProps('brandName')}
        />
      </Group>

      <Textarea
        label="Description"
        placeholder="What this brand covers..."
        autosize
        minRows={3}
        maxLength={MAX_DESCRIPTION}
        // The counter belongs under the box it counts, not above the label.
        inputWrapperOrder={['label', 'input', 'description', 'error']}
        description={`${form.values.description.length}/${MAX_DESCRIPTION}`}
        styles={{ description: { textAlign: 'right' } }}
        {...form.getInputProps('description')}
      />

      <Switch
        label="Active"
        description="Only active brands are offered when an item is created."
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
              the brand to get the latest values and try again.
            </>
          ) : null}
        </Alert>
      ) : null}
    </FormModal>
  )
}
