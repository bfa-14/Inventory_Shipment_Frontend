import { useState } from 'react'
import { Alert, Anchor, Group, Switch, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { ApiError } from '../../api/http'
import {
  paymentMethodsApi,
  type PaymentMethodDto,
  type SavePaymentMethodRequest,
} from '../../api/masterdata/paymentMethods'
import { FormModal } from '../../components/ui/FormModal'

interface PaymentMethodFormModalProps {
  mode: 'create' | 'edit'
  paymentMethod?: PaymentMethodDto
  onClose(): void
  onSaved(paymentMethod: PaymentMethodDto): void
}

interface FormValues {
  methodCode: string
  methodName: string
  description: string
  isActive: boolean
}

const MAX_CODE = 10
const MAX_NAME = 100
const MAX_DESCRIPTION = 500

export function PaymentMethodFormModal({ mode, paymentMethod, onClose, onSaved }: PaymentMethodFormModalProps) {
  const [rowVersion, setRowVersion] = useState(paymentMethod?.rowVersion ?? null)
  const [formError, setFormError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)

  const form = useForm<FormValues>({
    initialValues: toValues(paymentMethod),
    validate: {
      methodCode: (value) => {
        const code = value.trim()
        if (!code) return 'Method Code is required.'
        if (code.length > MAX_CODE) return `Method Code cannot be longer than ${MAX_CODE} characters.`
        return null
      },
      methodName: (value) => {
        const name = value.trim()
        if (!name) return 'Method Name is required.'
        if (name.length > MAX_NAME) return `Method Name cannot be longer than ${MAX_NAME} characters.`
        return null
      },
    },
  })

  function buildPayload(values: FormValues): SavePaymentMethodRequest {
    return {
      methodCode: values.methodCode.trim().toUpperCase(),
      methodName: values.methodName.trim(),
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
          ? await paymentMethodsApi.create(payload)
          : await paymentMethodsApi.update((paymentMethod as PaymentMethodDto).id, payload)
      onSaved(saved)
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setFormError('The payment method could not be saved.')
      } else if (error.code === 'DUPLICATE_CODE') {
        form.setErrors({ methodCode: 'A payment method with this code already exists.' })
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
    if (!paymentMethod) return
    try {
      const fresh = await paymentMethodsApi.get(paymentMethod.id)
      form.setValues(toValues(fresh))
      setRowVersion(fresh.rowVersion)
      setStale(false)
      setFormError(null)
    } catch (error) {
      setFormError(error instanceof ApiError ? error.messages.join(' ') : 'The payment method could not be reloaded.')
    }
  }

  return (
    <FormModal
      opened
      title={mode === 'create' ? 'New Payment Method' : 'Edit Payment Method'}
      saveLabel="Save Payment Method"
      saving={saving}
      onClose={onClose}
      onSubmit={() => form.onSubmit((values) => void save(values))()}
    >
      <Group grow align="flex-start">
        <TextInput label="Method Code" placeholder="CASH" withAsterisk maxLength={MAX_CODE} {...form.getInputProps('methodCode')} />
        <TextInput label="Method Name" placeholder="Cash" withAsterisk maxLength={MAX_NAME} {...form.getInputProps('methodName')} />
      </Group>

      <Textarea label="Description" autosize minRows={2} maxLength={MAX_DESCRIPTION} {...form.getInputProps('description')} />

      <Switch
        label="Active"
        description="Only active methods are offered on a new receipt line."
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
              the payment method to get the latest values and try again.
            </>
          ) : null}
        </Alert>
      ) : null}
    </FormModal>
  )
}

function toValues(paymentMethod?: PaymentMethodDto): FormValues {
  return {
    methodCode: paymentMethod?.methodCode ?? '',
    methodName: paymentMethod?.methodName ?? '',
    description: paymentMethod?.description ?? '',
    isActive: paymentMethod?.isActive ?? true,
  }
}
