import { useMemo, useState } from 'react'
import { Alert, Anchor, Group, Select, Switch, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { ApiError } from '../../api/http'
import { PORT_KINDS, portsApi, type PortDto, type PortKind, type SavePortRequest } from '../../api/masterdata/ports'
import { FormModal } from '../../components/ui/FormModal'
import { COUNTRIES, countryLabel } from '../../data/countries'

interface PortFormModalProps {
  mode: 'create' | 'edit'
  port?: PortDto
  onClose(): void
  onSaved(port: PortDto): void
}

interface FormValues {
  portCode: string
  portName: string
  countryCode: string | null
  kind: PortKind
  isActive: boolean
}

const MAX_CODE = 10
const MAX_NAME = 100

export function PortFormModal({ mode, port, onClose, onSaved }: PortFormModalProps) {
  const [rowVersion, setRowVersion] = useState(port?.rowVersion ?? null)
  const [formError, setFormError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)
  const countryOptions = useMemo(() => COUNTRIES.map((c) => ({ value: c.code, label: countryLabel(c) })), [])

  const form = useForm<FormValues>({
    initialValues: toValues(port),
    validate: {
      portCode: (value) => {
        const code = value.trim()
        if (!code) return 'Port Code is required.'
        if (code.length > MAX_CODE) return `Port Code cannot be longer than ${MAX_CODE} characters.`
        return null
      },
      portName: (value) => {
        const name = value.trim()
        if (!name) return 'Port Name is required.'
        if (name.length > MAX_NAME) return `Port Name cannot be longer than ${MAX_NAME} characters.`
        return null
      },
    },
  })

  async function save(values: FormValues) {
    setSaving(true)
    setFormError(null)
    setStale(false)
    const payload: SavePortRequest = {
      portCode: values.portCode.trim().toUpperCase(),
      portName: values.portName.trim(),
      countryCode: values.countryCode,
      kind: values.kind,
      isActive: values.isActive,
      ...(mode === 'edit' ? { rowVersion } : {}),
    }
    try {
      const saved = mode === 'create' ? await portsApi.create(payload) : await portsApi.update((port as PortDto).id, payload)
      onSaved(saved)
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setFormError('The port could not be saved.')
      } else if (error.code === 'DUPLICATE_CODE') {
        form.setErrors({ portCode: 'A port with this code already exists.' })
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
    if (!port) return
    try {
      const fresh = await portsApi.get(port.id)
      form.setValues(toValues(fresh))
      setRowVersion(fresh.rowVersion)
      setStale(false)
      setFormError(null)
    } catch (error) {
      setFormError(error instanceof ApiError ? error.messages.join(' ') : 'The port could not be reloaded.')
    }
  }

  return (
    <FormModal
      opened
      title={mode === 'create' ? 'New Port' : 'Edit Port'}
      saveLabel="Save Port"
      saving={saving}
      onClose={onClose}
      onSubmit={() => form.onSubmit((values) => void save(values))()}
    >
      <Group grow align="flex-start">
        <TextInput label="Port Code" placeholder="TZDAR" withAsterisk maxLength={MAX_CODE} {...form.getInputProps('portCode')} />
        <TextInput label="Port Name" placeholder="Dar es Salaam" withAsterisk maxLength={MAX_NAME} {...form.getInputProps('portName')} />
      </Group>

      <Group grow align="flex-start">
        <Select
          label="Country"
          placeholder="Pick a country"
          data={countryOptions}
          searchable
          clearable
          nothingFoundMessage="No country matches"
          {...form.getInputProps('countryCode')}
        />
        <Select
          label="Kind"
          withAsterisk
          data={PORT_KINDS}
          allowDeselect={false}
          {...form.getInputProps('kind')}
        />
      </Group>

      <Switch
        label="Active"
        description="Only active ports are offered on a container and its route."
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
              the port to get the latest values and try again.
            </>
          ) : null}
        </Alert>
      ) : null}
    </FormModal>
  )
}

function toValues(port?: PortDto): FormValues {
  return {
    portCode: port?.portCode ?? '',
    portName: port?.portName ?? '',
    countryCode: port?.countryCode ?? null,
    kind: port?.kind ?? 'Sea',
    isActive: port?.isActive ?? true,
  }
}
