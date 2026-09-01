import { useEffect, useState } from 'react'
import { Alert, Group, NumberInput, Select, Text, Textarea } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useForm } from '@mantine/form'
import { ApiError } from '../../api/http'
import { currenciesApi } from '../../api/masterdata/currencies'
import { exchangeRatesApi } from '../../api/masterdata/exchangeRates'
import type { CurrencyLookupDto, ExchangeRateDto, RateType, SaveExchangeRateRequest } from '../../api/types'
import { formatRate, todayDateOnly } from '../../components/format'
import { FormModal } from '../../components/ui/FormModal'
import { notify } from '../../components/ui/notify'
import { RATE_TYPE_OPTIONS } from './rateTypes'

interface ExchangeRateFormModalProps {
  mode: 'create' | 'edit'
  rate?: ExchangeRateDto
  onClose(): void
  onSaved(rate: ExchangeRateDto): void
}

interface FormValues {
  currencyId: string | null
  rateType: RateType
  rateDate: string | null
  rate: number | string
  notes: string
}

const MAX_NOTES = 300
const MIN_RATE = 0.000001

export function ExchangeRateFormModal({ mode, rate, onClose, onSaved }: ExchangeRateFormModalProps) {
  const [rowVersion] = useState(rate?.rowVersion ?? null)
  const [currencies, setCurrencies] = useState<CurrencyLookupDto[]>([])
  const [baseCode, setBaseCode] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const today = todayDateOnly()

  const form = useForm<FormValues>({
    initialValues: {
      currencyId: rate ? String(rate.currencyId) : null,
      rateType: rate?.rateType ?? 'Official',
      rateDate: rate?.rateDate ?? today,
      rate: rate?.rate ?? '',
      notes: rate?.notes ?? '',
    },
    validate: {
      currencyId: (value) => (value ? null : 'Currency is required.'),
      rateDate: (value) => {
        if (!value) return 'Date is required.'
        if (value > today) return 'Date cannot be in the future.'
        return null
      },
      rate: (value) => {
        const parsed = typeof value === 'number' ? value : Number(value)
        if (!value && value !== 0) return 'Rate is required.'
        if (!Number.isFinite(parsed) || parsed < MIN_RATE) return 'Rate must be greater than zero.'
        return null
      },
      notes: (value) => (value.trim().length > MAX_NOTES ? `Notes cannot be longer than ${MAX_NOTES} characters.` : null),
    },
  })

  /*
   * Active currencies only, plus the one this rate already points at even if it went inactive.
   * The base currency is dropped from the list: its rate is 1 by definition and the API refuses
   * a rate row for it, so offering it would be offering a choice that cannot be saved.
   */
  useEffect(() => {
    currenciesApi
      .lookup(true, rate?.currencyId)
      .then((rows) => {
        setCurrencies(rows.filter((c) => !c.isBaseCurrency))
        setBaseCode(rows.find((c) => c.isBaseCurrency)?.currencyCode ?? null)
      })
      .catch((error: unknown) => {
        setFormError(error instanceof ApiError ? error.messages.join(' ') : 'The currencies could not be loaded.')
      })
  }, [rate?.currencyId])

  function buildPayload(values: FormValues): SaveExchangeRateRequest {
    return {
      currencyId: Number(values.currencyId),
      rateType: values.rateType,
      rateDate: values.rateDate as string,
      rate: typeof values.rate === 'number' ? values.rate : Number(values.rate),
      notes: values.notes.trim() ? values.notes.trim() : null,
      ...(mode === 'edit' ? { rowVersion } : {}),
    }
  }

  async function save(values: FormValues) {
    setSaving(true)
    setFormError(null)

    try {
      const payload = buildPayload(values)
      const saved =
        mode === 'create'
          ? await exchangeRatesApi.create(payload)
          : await exchangeRatesApi.update((rate as ExchangeRateDto).id, payload)

      onSaved(saved)
    } catch (error) {
      handleError(error)
    } finally {
      setSaving(false)
    }
  }

  function handleError(error: unknown) {
    if (!(error instanceof ApiError)) {
      setFormError('The exchange rate could not be saved.')
      return
    }

    // One rate per currency + type + date: the clash is a property of the date the reader picked.
    if (error.code === 'DUPLICATE_RATE') {
      form.setErrors({
        rateDate: 'A rate for this currency, type and date already exists - edit that row instead.',
      })
      return
    }

    if (error.code === 'CURRENCY_INACTIVE' || error.code === 'BASE_CURRENCY_PROTECTED') {
      notify.error(error.messages.join(' '))
      return
    }

    if (error.code === 'CONCURRENCY') {
      notify.error(error.messages.join(' '))
      onClose()
      return
    }

    // ASP.NET model validation: map the messages back onto the fields they belong to.
    const mapped: Record<string, string> = {}
    for (const [field, messages] of Object.entries(error.fieldErrors)) {
      const key = field.toLowerCase()
      const message = messages.join(' ')
      if (key.includes('currencyid')) mapped.currencyId = message
      else if (key.includes('ratetype')) mapped.rateType = message
      else if (key.includes('ratedate')) mapped.rateDate = message
      else if (key.includes('rate')) mapped.rate = message
      else if (key.includes('notes')) mapped.notes = message
    }

    if (Object.keys(mapped).length > 0) {
      form.setErrors(mapped)
      return
    }

    setFormError(error.messages.join(' '))
  }

  const selected = currencies.find((c) => String(c.id) === form.values.currencyId)
  const enteredRate = typeof form.values.rate === 'number' ? form.values.rate : Number(form.values.rate)

  /** "1 USD = 2,800.00 CDF" under the Rate box, so the direction of the quote is never in doubt. */
  const rateHint =
    baseCode && selected && Number.isFinite(enteredRate) && enteredRate > 0
      ? `1 ${baseCode} = ${formatRate(enteredRate, selected.decimalPlaces)} ${selected.currencyCode}`
      : null

  return (
    <FormModal
      opened
      title={mode === 'create' ? 'New Exchange Rate' : 'Edit Exchange Rate'}
      saveLabel="Save Rate"
      saving={saving}
      onClose={onClose}
      onSubmit={() => form.onSubmit((values) => void save(values))()}
    >
      <Group grow align="flex-start">
        <Select
          label="Currency"
          placeholder="Select currency"
          description={baseCode ? `The base currency (${baseCode}) always equals 1.` : undefined}
          withAsterisk
          searchable
          nothingFoundMessage="No currency found"
          data={currencies.map((c) => ({
            value: String(c.id),
            label: `${c.currencyCode} - ${c.currencyName}`,
          }))}
          {...form.getInputProps('currencyId')}
        />
        <Select
          label="Rate Type"
          withAsterisk
          allowDeselect={false}
          data={RATE_TYPE_OPTIONS}
          {...form.getInputProps('rateType')}
        />
      </Group>

      <Group grow align="flex-start">
        <DateInput
          label="Date"
          withAsterisk
          // A rate cannot be entered for a day that has not happened; the picker says so first.
          maxDate={today}
          valueFormat="DD MMM YYYY"
          {...form.getInputProps('rateDate')}
        />
        <NumberInput
          label="Rate"
          placeholder="2800"
          withAsterisk
          min={MIN_RATE}
          decimalScale={6}
          thousandSeparator=","
          allowNegative={false}
          {...form.getInputProps('rate')}
        />
      </Group>

      {rateHint ? (
        <Text fz="sm" c="dimmed" mt={-8}>
          {rateHint}
        </Text>
      ) : null}

      <Textarea
        label="Notes"
        placeholder="Where the rate came from, e.g. the market desk that quoted it"
        autosize
        minRows={3}
        maxLength={MAX_NOTES}
        {...form.getInputProps('notes')}
      />

      {formError ? <Alert color="red">{formError}</Alert> : null}
    </FormModal>
  )
}
