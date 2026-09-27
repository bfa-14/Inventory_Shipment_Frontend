import { useState } from 'react'
import { Alert, Anchor, Group, NumberInput, Select, Stack, Switch, Text, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { ApiError } from '../../api/http'
import {
  MOVEMENT_STAGES,
  movementTypesApi,
  stageExplanation,
  type MovementStage,
  type MovementTypeDto,
  type SaveMovementTypeRequest,
} from '../../api/masterdata/movementTypes'
import { StageIcon } from '../../components/logistics/movementStage'
import { FormModal } from '../../components/ui/FormModal'

interface MovementTypeFormModalProps {
  mode: 'create' | 'edit'
  movementType?: MovementTypeDto
  onClose(): void
  onSaved(movementType: MovementTypeDto): void
}

interface FormValues {
  typeCode: string
  typeName: string
  stage: MovementStage
  sortOrder: number | string
  isActive: boolean
}

const MAX_CODE = 20
const MAX_NAME = 100

const STAGE_OPTIONS = MOVEMENT_STAGES.map((s) => ({ value: s.value, label: s.label }))

export function MovementTypeFormModal({ mode, movementType, onClose, onSaved }: MovementTypeFormModalProps) {
  const [rowVersion, setRowVersion] = useState(movementType?.rowVersion ?? null)
  const [formError, setFormError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)

  const form = useForm<FormValues>({
    initialValues: toValues(movementType),
    validate: {
      typeCode: (value) => {
        const code = value.trim()
        if (!code) return 'Code is required.'
        if (code.length > MAX_CODE) return `Code cannot be longer than ${MAX_CODE} characters.`
        return null
      },
      typeName: (value) => {
        const name = value.trim()
        if (!name) return 'Name is required.'
        if (name.length > MAX_NAME) return `Name cannot be longer than ${MAX_NAME} characters.`
        return null
      },
      stage: (value) => (value ? null : 'Stage is required.'),
    },
  })

  async function save(values: FormValues) {
    setSaving(true)
    setFormError(null)
    setStale(false)
    const payload: SaveMovementTypeRequest = {
      typeCode: values.typeCode.trim().toUpperCase(),
      typeName: values.typeName.trim(),
      stage: values.stage,
      sortOrder: Number(values.sortOrder) || 0,
      isActive: values.isActive,
      ...(mode === 'edit' ? { rowVersion } : {}),
    }
    try {
      const saved =
        mode === 'create'
          ? await movementTypesApi.create(payload)
          : await movementTypesApi.update((movementType as MovementTypeDto).id, payload)
      onSaved(saved)
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setFormError('The movement type could not be saved.')
      } else if (error.code === 'DUPLICATE' || error.code === 'DUPLICATE_CODE') {
        form.setErrors({ typeCode: 'A movement type with this code already exists.' })
      } else if (error.code === 'IN_USE') {
        // The stage of a type movements already use cannot change: it is what moved their containers.
        form.setErrors({ stage: error.message })
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
    if (!movementType) return
    try {
      const fresh = await movementTypesApi.get(movementType.id)
      form.setValues(toValues(fresh))
      setRowVersion(fresh.rowVersion)
      setStale(false)
      setFormError(null)
    } catch (error) {
      setFormError(error instanceof ApiError ? error.messages.join(' ') : 'The movement type could not be reloaded.')
    }
  }

  return (
    <FormModal
      opened
      title={mode === 'create' ? 'New Movement Type' : 'Edit Movement Type'}
      saveLabel="Save Movement Type"
      saving={saving}
      onClose={onClose}
      onSubmit={() => form.onSubmit((values) => void save(values))()}
    >
      <Group grow align="flex-start">
        <TextInput label="Code" placeholder="SEA" withAsterisk maxLength={MAX_CODE} {...form.getInputProps('typeCode')} />
        <TextInput label="Name" placeholder="Sea freight" withAsterisk maxLength={MAX_NAME} {...form.getInputProps('typeName')} />
      </Group>

      <Group grow align="flex-start">
        <Select
          label="Stage"
          withAsterisk
          data={STAGE_OPTIONS}
          allowDeselect={false}
          // The explanation of the picked stage sits under the box: it is what starting a movement will do.
          description={stageExplanation(form.values.stage)}
          inputWrapperOrder={['label', 'input', 'description', 'error']}
          leftSection={<StageIcon stage={form.values.stage} />}
          renderOption={({ option }) => (
            <Group gap="xs" wrap="nowrap" align="flex-start">
              <StageIcon stage={option.value} />
              <Stack gap={0}>
                <Text fz="sm">{option.label}</Text>
                <Text fz="xs" c="dimmed">
                  {stageExplanation(option.value)}
                </Text>
              </Stack>
            </Group>
          )}
          {...form.getInputProps('stage')}
        />
        <NumberInput label="Sort Order" min={0} max={9999} allowDecimal={false} {...form.getInputProps('sortOrder')} />
      </Group>

      <Switch
        label="Active"
        description="Only active types are offered on a new movement."
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
              the movement type to get the latest values and try again.
            </>
          ) : null}
        </Alert>
      ) : null}
    </FormModal>
  )
}

function toValues(movementType?: MovementTypeDto): FormValues {
  return {
    typeCode: movementType?.typeCode ?? '',
    typeName: movementType?.typeName ?? '',
    stage: movementType?.stage ?? 'Sea',
    sortOrder: movementType?.sortOrder ?? 0,
    isActive: movementType?.isActive ?? true,
  }
}
