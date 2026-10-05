import { useEffect, useState } from 'react'
import { Alert, Anchor, Autocomplete, Group, MultiSelect, NumberInput, Switch, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import type { AttachmentDocumentKind } from '../../api/documentFiles'
import { ApiError } from '../../api/http'
import {
  ATTACHMENT_CATEGORIES,
  attachmentTypesApi,
  type AttachmentDocumentKindDto,
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
  usedFor: AttachmentDocumentKind[]
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
  const [kinds, setKinds] = useState<AttachmentDocumentKindDto[]>([])

  useEffect(() => {
    attachmentTypesApi.documentKinds().then(setKinds).catch(() => setFormError('The document kinds could not be loaded.'))
  }, [])

  const form = useForm<FormValues>({
    initialValues: toValues(attachmentType),
    validate: {
      category: (value) => (value.trim() ? null : 'Category is required.'),
      subType: (value) => (value.trim() ? null : 'Sub Type is required.'),
      usedFor: (value) => (value.length > 0 ? null : 'Choose at least one kind of document.'),
    },
  })

  async function save(values: FormValues) {
    setSaving(true)
    setFormError(null)
    setStale(false)
    const payload: SaveAttachmentTypeRequest = {
      category: values.category.trim(),
      subType: values.subType.trim(),
      usedFor: values.usedFor,
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

      <MultiSelect
        label="Used for"
        description="The upload dialogs that offer this type: a purchase order's, a container's, a receipt's..."
        placeholder={form.values.usedFor.length === 0 ? 'Pick the kinds of document' : undefined}
        withAsterisk
        searchable
        data={kinds.map((k) => ({ value: k.code, label: k.name }))}
        {...form.getInputProps('usedFor')}
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
    usedFor: attachmentType?.usedFor ?? [],
    sortOrder: attachmentType?.sortOrder ?? 0,
    isActive: attachmentType?.isActive ?? true,
  }
}
