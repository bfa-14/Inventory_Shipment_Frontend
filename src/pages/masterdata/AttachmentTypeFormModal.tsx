import { useState } from 'react'
import { Alert, Anchor, Autocomplete, Group, NumberInput, Select, Switch, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { ApiError } from '../../api/http'
import {
  ATTACHMENT_APPLIES_TO,
  ATTACHMENT_CATEGORIES,
  attachmentTypesApi,
  type AttachmentAppliesTo,
  type AttachmentTypeDto,
  type SaveAttachmentTypeRequest,
} from '../../api/masterdata/attachmentTypes'
import { FormModal } from '../../components/ui/FormModal'

interface AttachmentTypeFormModalProps {
  mode: 'create' | 'edit'
  attachmentType?: AttachmentTypeDto
  onClose(): void
  onSaved(attachmentType: AttachmentTypeDto): void
}

interface FormValues {
  category: string
  subType: string
  appliesTo: AttachmentAppliesTo
  sortOrder: number | string
  isActive: boolean
}

const MAX_CATEGORY = 30
const MAX_SUBTYPE = 60

export function AttachmentTypeFormModal({ mode, attachmentType, onClose, onSaved }: AttachmentTypeFormModalProps) {
  const [rowVersion, setRowVersion] = useState(attachmentType?.rowVersion ?? null)
  const [formError, setFormError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)

  const form = useForm<FormValues>({
    initialValues: toValues(attachmentType),
    validate: {
      category: (value) => (value.trim() ? null : 'Category is required.'),
      subType: (value) => (value.trim() ? null : 'Sub Type is required.'),
    },
  })

  async function save(values: FormValues) {
    setSaving(true)
    setFormError(null)
    setStale(false)
    const payload: SaveAttachmentTypeRequest = {
      category: values.category.trim(),
      subType: values.subType.trim(),
      appliesTo: values.appliesTo,
      sortOrder: values.sortOrder === '' ? 0 : Number(values.sortOrder),
      isActive: values.isActive,
      ...(mode === 'edit' ? { rowVersion } : {}),
    }
    try {
      const saved =
        mode === 'create'
          ? await attachmentTypesApi.create(payload)
          : await attachmentTypesApi.update((attachmentType as AttachmentTypeDto).id, payload)
      onSaved(saved)
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setFormError('The attachment type could not be saved.')
      } else if (error.code === 'DUPLICATE_CODE') {
        form.setErrors({ subType: 'This category already has this sub type.' })
      } else if (error.code === 'CONCURRENCY') {
        setStale(true)
        setFormError(error.messages.join(' '))
      } else {
        setFormError(error.messages.join(' '))
      }
    } finally {
      setSaving(false)
    }
  }

  async function reload() {
    if (!attachmentType) return
    try {
      const fresh = await attachmentTypesApi.get(attachmentType.id)
      form.setValues(toValues(fresh))
      setRowVersion(fresh.rowVersion)
      setStale(false)
      setFormError(null)
    } catch (error) {
      setFormError(error instanceof ApiError ? error.messages.join(' ') : 'The attachment type could not be reloaded.')
    }
  }

  return (
    <FormModal
      opened
      title={mode === 'create' ? 'New Attachment Type' : 'Edit Attachment Type'}
      saveLabel="Save Attachment Type"
      saving={saving}
      onClose={onClose}
      onSubmit={() => form.onSubmit((values) => void save(values))()}
    >
      <Group grow align="flex-start">
        {/* Free text with the usual categories offered: a new one is typed, not configured. */}
        <Autocomplete
          label="Category"
          placeholder="Shipping"
          withAsterisk
          maxLength={MAX_CATEGORY}
          data={ATTACHMENT_CATEGORIES}
          {...form.getInputProps('category')}
        />
        <TextInput label="Sub Type" placeholder="Bill of Lading" withAsterisk maxLength={MAX_SUBTYPE} {...form.getInputProps('subType')} />
      </Group>

      <Select
        label="Used on"
        description="Container types are offered when a container file is attached; receipt types on the customer receipt page. The two lists never mix."
        allowDeselect={false}
        data={ATTACHMENT_APPLIES_TO}
        {...form.getInputProps('appliesTo')}
      />

      <NumberInput
        label="Sort Order"
        description="Where it sits in the attachment type list: lower comes first."
        allowDecimal={false}
        {...form.getInputProps('sortOrder')}
      />

      <Switch
        label="Active"
        description="Only active types are offered when a file is attached."
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
              the attachment type to get the latest values and try again.
            </>
          ) : null}
        </Alert>
      ) : null}
    </FormModal>
  )
}

function toValues(attachmentType?: AttachmentTypeDto): FormValues {
  return {
    category: attachmentType?.category ?? '',
    subType: attachmentType?.subType ?? '',
    appliesTo: attachmentType?.appliesTo ?? 'Logistics',
    sortOrder: attachmentType?.sortOrder ?? 0,
    isActive: attachmentType?.isActive ?? true,
  }
}
