import { useState } from 'react'
import { Alert, Anchor, Group, NumberInput, Switch, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { ApiError } from '../../api/http'
import {
  containerTypesApi,
  type ContainerTypeDto,
  type SaveContainerTypeRequest,
} from '../../api/masterdata/containerTypes'
import { FormModal } from '../../components/ui/FormModal'

interface ContainerTypeFormModalProps {
  mode: 'create' | 'edit'
  containerType?: ContainerTypeDto
  onClose(): void
  onSaved(containerType: ContainerTypeDto): void
}

interface FormValues {
  typeCode: string
  typeName: string
  maxWeightKg: number | string
  maxVolumeCbm: number | string
  description: string
  isActive: boolean
}

const MAX_CODE = 10
const MAX_NAME = 100
const MAX_DESCRIPTION = 500

/** A NumberInput holds '' when emptied; the API wants null. */
function optionalNumber(value: number | string): number | null {
  return value === '' || value === null ? null : Number(value)
}

export function ContainerTypeFormModal({ mode, containerType, onClose, onSaved }: ContainerTypeFormModalProps) {
  const [rowVersion, setRowVersion] = useState(containerType?.rowVersion ?? null)
  const [formError, setFormError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)

  const form = useForm<FormValues>({
    initialValues: toValues(containerType),
    validate: {
      typeCode: (value) => {
        const code = value.trim()
        if (!code) return 'Type Code is required.'
        if (code.length > MAX_CODE) return `Type Code cannot be longer than ${MAX_CODE} characters.`
        return null
      },
      typeName: (value) => {
        const name = value.trim()
        if (!name) return 'Type Name is required.'
        if (name.length > MAX_NAME) return `Type Name cannot be longer than ${MAX_NAME} characters.`
        return null
      },
      maxWeightKg: (value) => (value !== '' && Number(value) <= 0 ? 'Max Weight must be greater than zero.' : null),
      maxVolumeCbm: (value) => (value !== '' && Number(value) <= 0 ? 'Max Volume must be greater than zero.' : null),
    },
  })

  function buildPayload(values: FormValues): SaveContainerTypeRequest {
    return {
      typeCode: values.typeCode.trim().toUpperCase(),
      typeName: values.typeName.trim(),
      maxWeightKg: optionalNumber(values.maxWeightKg),
      maxVolumeCbm: optionalNumber(values.maxVolumeCbm),
      description: values.description.trim() || null,
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
          ? await containerTypesApi.create(payload)
          : await containerTypesApi.update((containerType as ContainerTypeDto).id, payload)
      onSaved(saved)
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setFormError('The container type could not be saved.')
      } else if (error.code === 'DUPLICATE_CODE') {
        form.setErrors({ typeCode: 'A container type with this code already exists.' })
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
    if (!containerType) return
    try {
      const fresh = await containerTypesApi.get(containerType.id)
      form.setValues(toValues(fresh))
      setRowVersion(fresh.rowVersion)
      setStale(false)
      setFormError(null)
    } catch (error) {
      setFormError(error instanceof ApiError ? error.messages.join(' ') : 'The container type could not be reloaded.')
    }
  }

  return (
    <FormModal
      opened
      title={mode === 'create' ? 'New Container Type' : 'Edit Container Type'}
      saveLabel="Save Container Type"
      saving={saving}
      onClose={onClose}
      onSubmit={() => form.onSubmit((values) => void save(values))()}
    >
      <Group grow align="flex-start">
        <TextInput label="Type Code" placeholder="40HC" withAsterisk maxLength={MAX_CODE} {...form.getInputProps('typeCode')} />
        <TextInput label="Type Name" placeholder="40ft High Cube" withAsterisk maxLength={MAX_NAME} {...form.getInputProps('typeName')} />
      </Group>

      <Group grow align="flex-start">
        <NumberInput label="Max Weight (kg)" placeholder="26,500" min={0} decimalScale={3} thousandSeparator="," {...form.getInputProps('maxWeightKg')} />
        <NumberInput label="Max Volume (CBM)" placeholder="76" min={0} decimalScale={3} thousandSeparator="," {...form.getInputProps('maxVolumeCbm')} />
      </Group>

      <Textarea label="Description" autosize minRows={2} maxLength={MAX_DESCRIPTION} {...form.getInputProps('description')} />

      <Switch
        label="Active"
        description="Only active types are offered on a new container."
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
              the container type to get the latest values and try again.
            </>
          ) : null}
        </Alert>
      ) : null}
    </FormModal>
  )
}

function toValues(containerType?: ContainerTypeDto): FormValues {
  return {
    typeCode: containerType?.typeCode ?? '',
    typeName: containerType?.typeName ?? '',
    maxWeightKg: containerType?.maxWeightKg ?? '',
    maxVolumeCbm: containerType?.maxVolumeCbm ?? '',
    description: containerType?.description ?? '',
    isActive: containerType?.isActive ?? true,
  }
}
