import { useState } from 'react'
import { Alert, Anchor, Checkbox, Group, NumberInput, Switch, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { ApiError } from '../../api/http'
import { currenciesApi } from '../../api/masterdata/currencies'
import type { CurrencyDto, CurrentBaseCurrency, SaveCurrencyRequest } from '../../api/types'
import { confirm } from '../../components/ui/confirm'
import { FormModal } from '../../components/ui/FormModal'
import { notify } from '../../components/ui/notify'

interface CurrencyFormModalProps {
  mode: 'create' | 'edit'
  currency?: CurrencyDto
  onClose(): void
  onSaved(currency: CurrencyDto): void
}

interface FormValues {
  currencyCode: string
  currencyName: string
  symbol: string
  decimalPlaces: number
  isBaseCurrency: boolean
  isActive: boolean
}

const CODE_LENGTH = 3
const MAX_NAME = 100
const MAX_SYMBOL = 10
const MAX_DECIMALS = 6

export function CurrencyFormModal({ mode, currency, onClose, onSaved }: CurrencyFormModalProps) {
  const [rowVersion, setRowVersion] = useState(currency?.rowVersion ?? null)
  const [formError, setFormError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)

  const form = useForm<FormValues>({
    initialValues: {
      currencyCode: currency?.currencyCode ?? '',
      currencyName: currency?.currencyName ?? '',
      symbol: currency?.symbol ?? '',
      decimalPlaces: currency?.decimalPlaces ?? 2,
      isBaseCurrency: currency?.isBaseCurrency ?? false,
      isActive: currency?.isActive ?? true,
    },
    validate: {
      currencyCode: (value) => {
        const code = value.trim()
        if (!code) return 'Currency Code is required.'
        if (!/^[A-Za-z]{3}$/.test(code)) return 'Currency Code must be exactly 3 letters (ISO 4217, e.g. USD).'
        return null
      },
      currencyName: (value) => {
        const name = value.trim()
        if (!name) return 'Currency Name is required.'
        if (name.length > MAX_NAME) return `Currency Name cannot be longer than ${MAX_NAME} characters.`
        return null
      },
      symbol: (value) =>
        value.trim().length > MAX_SYMBOL ? `Symbol cannot be longer than ${MAX_SYMBOL} characters.` : null,
      decimalPlaces: (value) =>
        Number.isInteger(value) && value >= 0 && value <= MAX_DECIMALS
          ? null
          : `Decimal Places must be a whole number between 0 and ${MAX_DECIMALS}.`,
    },
  })

  function buildPayload(values: FormValues, replaceBaseCurrency: boolean): SaveCurrencyRequest {
    return {
      currencyCode: values.currencyCode.trim().toUpperCase(),
      currencyName: values.currencyName.trim(),
      symbol: values.symbol.trim() ? values.symbol.trim() : null,
      decimalPlaces: values.decimalPlaces,
      isBaseCurrency: values.isBaseCurrency,
      isActive: values.isActive,
      replaceBaseCurrency,
      ...(mode === 'edit' ? { rowVersion } : {}),
    }
  }

  async function save(values: FormValues, replaceBaseCurrency: boolean) {
    setSaving(true)
    setFormError(null)
    setStale(false)

    try {
      const payload = buildPayload(values, replaceBaseCurrency)
      const saved =
        mode === 'create'
          ? await currenciesApi.create(payload)
          : await currenciesApi.update((currency as CurrencyDto).id, payload)

      onSaved(saved)
    } catch (error) {
      await handleError(error, values)
    } finally {
      setSaving(false)
    }
  }

  async function handleError(error: unknown, values: FormValues) {
    if (!(error instanceof ApiError)) {
      setFormError('The currency could not be saved.')
      return
    }

    if (error.code === 'BASE_CURRENCY_EXISTS') {
      const current = (error.data as { currentBaseCurrency?: CurrentBaseCurrency } | undefined)?.currentBaseCurrency
      if (current) {
        const replace = await confirm({
          title: 'Replace base currency',
          message: `${current.currencyCode} - ${current.currencyName} is currently the base currency. Make ${values.currencyCode.trim().toUpperCase()} the base instead?`,
          confirmLabel: 'Replace base currency',
        })
        if (replace) await save(values, true)
        return
      }
    }

    if (error.code === 'DUPLICATE_CODE') {
      form.setErrors({ currencyCode: 'A currency with this Currency Code already exists.' })
      return
    }

    // The base currency must stay active and cannot be demoted from here; the message says which.
    if (error.code === 'BASE_CURRENCY_PROTECTED') {
      notify.error(error.messages.join(' '))
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
      if (key.includes('currencycode')) mapped.currencyCode = message
      else if (key.includes('currencyname')) mapped.currencyName = message
      else if (key.includes('symbol')) mapped.symbol = message
      else if (key.includes('decimalplaces')) mapped.decimalPlaces = message
    }

    if (Object.keys(mapped).length > 0) {
      form.setErrors(mapped)
      return
    }

    setFormError(error.messages.join(' '))
  }

  /** After a concurrency conflict: pull the current row back into the form. */
  async function reload() {
    if (!currency) return
    try {
      const fresh = await currenciesApi.get(currency.id)
      form.setValues({
        currencyCode: fresh.currencyCode,
        currencyName: fresh.currencyName,
        symbol: fresh.symbol ?? '',
        decimalPlaces: fresh.decimalPlaces,
        isBaseCurrency: fresh.isBaseCurrency,
        isActive: fresh.isActive,
      })
      setRowVersion(fresh.rowVersion)
      setStale(false)
      setFormError(null)
    } catch (error) {
      setFormError(error instanceof ApiError ? error.messages.join(' ') : 'The currency could not be reloaded.')
    }
  }

  return (
    <FormModal
      opened
      title={mode === 'create' ? 'New Currency' : 'Edit Currency'}
      saveLabel="Save Currency"
      saving={saving}
      onClose={onClose}
      onSubmit={() => form.onSubmit((values) => void save(values, false))()}
    >
      <Group grow align="flex-start">
        <TextInput
          label="Currency Code"
          placeholder="AED"
          description="Three letters, ISO 4217."
          withAsterisk
          maxLength={CODE_LENGTH}
          {...form.getInputProps('currencyCode')}
          // ISO codes are upper-case, so the box shows what will be stored rather than correcting
          // it silently on save.
          onChange={(event) => form.setFieldValue('currencyCode', event.currentTarget.value.toUpperCase())}
        />
        <TextInput
          label="Currency Name"
          placeholder="UAE Dirham"
          withAsterisk
          maxLength={MAX_NAME}
          {...form.getInputProps('currencyName')}
        />
      </Group>

      <Group grow align="flex-start">
        <TextInput label="Symbol" placeholder="د.إ" maxLength={MAX_SYMBOL} {...form.getInputProps('symbol')} />
        <NumberInput
          label="Decimal Places"
          description="0 for currencies without cents."
          min={0}
          max={MAX_DECIMALS}
          clampBehavior="strict"
          allowDecimal={false}
          allowNegative={false}
          {...form.getInputProps('decimalPlaces')}
        />
      </Group>

      <Group grow align="flex-start">
        <Checkbox
          label="Yes, this is the base currency"
          description="Amounts are stored and reported in the base currency."
          {...form.getInputProps('isBaseCurrency', { type: 'checkbox' })}
          onChange={(event) => {
            const checked = event.currentTarget.checked
            form.setFieldValue('isBaseCurrency', checked)
            // The API refuses an inactive base currency, so keep the pair valid here.
            if (checked) form.setFieldValue('isActive', true)
          }}
        />

        <Switch
          label="Active"
          description={form.values.isBaseCurrency ? 'The base currency is always active.' : undefined}
          disabled={form.values.isBaseCurrency}
          {...form.getInputProps('isActive', { type: 'checkbox' })}
        />
      </Group>

      {formError ? (
        <Alert color="red">
          {formError}
          {stale ? (
            <>
              {' '}
              <Anchor component="button" type="button" onClick={reload}>
                Reload
              </Anchor>{' '}
              the currency to get the latest values and try again.
            </>
          ) : null}
        </Alert>
      ) : null}
    </FormModal>
  )
}
