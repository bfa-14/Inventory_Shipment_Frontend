import { useEffect, useMemo, useState } from 'react'
import { Alert, Anchor, Group, Select, Switch, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { ApiError } from '../../api/http'
import { currenciesApi } from '../../api/masterdata/currencies'
import { priceListsApi } from '../../api/masterdata/priceLists'
import type { CurrencyLookupDto, PriceListDto, SavePriceListRequest } from '../../api/types'
import { currencyLabel } from '../../components/format'
import { FormModal } from '../../components/ui/FormModal'

interface PriceListFormModalProps {
  mode: 'create' | 'edit'
  priceList?: PriceListDto
  onClose(): void
  onSaved(priceList: PriceListDto): void
}

interface FormValues {
  priceListCode: string
  priceListName: string
  currencyId: string | null
  description: string
  isActive: boolean
}

const MAX_CODE = 20
const MAX_NAME = 100
const MAX_DESCRIPTION = 500

const CURRENCY_LOCKED_HINT = 'Currency is locked because this list contains prices'

export function PriceListFormModal({ mode, priceList, onClose, onSaved }: PriceListFormModalProps) {
  const [currencies, setCurrencies] = useState<CurrencyLookupDto[]>([])
  const [rowVersion, setRowVersion] = useState(priceList?.rowVersion ?? null)
  const [formError, setFormError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)

  /**
   * Every price in a list is expressed in the list's currency, so the API refuses to change it once
   * prices exist (CURRENCY_LOCKED). Showing the picker disabled says so before the reader tries.
   */
  const currencyLocked = mode === 'edit' && (priceList?.priceCount ?? 0) > 0

  const form = useForm<FormValues>({
    initialValues: {
      priceListCode: priceList?.priceListCode ?? '',
      priceListName: priceList?.priceListName ?? '',
      currencyId: priceList ? String(priceList.currencyId) : null,
      description: priceList?.description ?? '',
      isActive: priceList?.isActive ?? true,
    },
    validate: {
      priceListCode: (value) => {
        const code = value.trim()
        if (!code) return 'Price List Code is required.'
        if (code.length > MAX_CODE) return `Price List Code cannot be longer than ${MAX_CODE} characters.`
        return null
      },
      priceListName: (value) => {
        const name = value.trim()
        if (!name) return 'Price List Name is required.'
        if (name.length > MAX_NAME) return `Price List Name cannot be longer than ${MAX_NAME} characters.`
        return null
      },
      currencyId: (value) => (value ? null : 'Currency is required.'),
      description: (value) =>
        value.trim().length > MAX_DESCRIPTION
          ? `Description cannot be longer than ${MAX_DESCRIPTION} characters.`
          : null,
    },
  })

  // Active currencies only (base first, as the lookup orders them), plus the one this list already
  // prices in even if it went inactive.
  useEffect(() => {
    currenciesApi
      .lookup(true, priceList?.currencyId)
      .then(setCurrencies)
      .catch((error: unknown) => {
        setFormError(
          error instanceof ApiError ? error.messages.join(' ') : 'The currencies could not be loaded.',
        )
      })
  }, [priceList?.currencyId])

  /**
   * The lookup's currencies, with the list's own always present. A Select whose value is not in its
   * data renders the placeholder instead - so a locked picker would say "Select currency" while the
   * lookup is in flight, which is exactly the moment it has to name the currency it is locked to.
   */
  const currencyOptions = useMemo(() => {
    const options = currencies.map((c) => ({ value: String(c.id), label: currencyLabel(c) }))
    if (priceList && !options.some((o) => o.value === String(priceList.currencyId))) {
      options.unshift({
        value: String(priceList.currencyId),
        label: `${priceList.currencyCode} - ${priceList.currencyName}`,
      })
    }
    return options
  }, [currencies, priceList])

  function buildPayload(values: FormValues): SavePriceListRequest {
    return {
      priceListCode: values.priceListCode.trim(),
      priceListName: values.priceListName.trim(),
      currencyId: Number(values.currencyId),
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
        mode === 'create'
          ? await priceListsApi.create(payload)
          : await priceListsApi.update((priceList as PriceListDto).id, payload)

      onSaved(saved)
    } catch (error) {
      handleError(error)
    } finally {
      setSaving(false)
    }
  }

  function handleError(error: unknown) {
    if (!(error instanceof ApiError)) {
      setFormError('The price list could not be saved.')
      return
    }

    // One error number covers both unique columns, so the message names which one was taken.
    if (error.code === 'DUPLICATE_CODE') {
      const message = error.messages.join(' ')
      const onName = message.toLowerCase().includes('name')
      form.setErrors(
        onName
          ? { priceListName: 'A price list with this Price List Name already exists.' }
          : { priceListCode: 'A price list with this Price List Code already exists.' },
      )
      return
    }

    if (error.code === 'CURRENCY_LOCKED' || error.code === 'CURRENCY_INACTIVE') {
      form.setErrors({ currencyId: error.messages.join(' ') })
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
      if (key.includes('pricelistcode')) mapped.priceListCode = message
      else if (key.includes('pricelistname')) mapped.priceListName = message
      else if (key.includes('currencyid')) mapped.currencyId = message
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
    if (!priceList) return
    try {
      const fresh = await priceListsApi.get(priceList.id)
      form.setValues({
        priceListCode: fresh.priceListCode,
        priceListName: fresh.priceListName,
        currencyId: String(fresh.currencyId),
        description: fresh.description ?? '',
        isActive: fresh.isActive,
      })
      setRowVersion(fresh.rowVersion)
      setStale(false)
      setFormError(null)
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.messages.join(' ') : 'The price list could not be reloaded.',
      )
    }
  }

  return (
    <FormModal
      opened
      title={mode === 'create' ? 'New Price List' : 'Edit Price List'}
      saveLabel="Save Price List"
      saving={saving}
      onClose={onClose}
      onSubmit={() => form.onSubmit((values) => void save(values))()}
    >
      <Group grow align="flex-start">
        <TextInput
          label="Price List Code"
          placeholder="PL-002"
          withAsterisk
          maxLength={MAX_CODE}
          {...form.getInputProps('priceListCode')}
        />
        <TextInput
          label="Price List Name"
          placeholder="Wholesale USD"
          withAsterisk
          maxLength={MAX_NAME}
          {...form.getInputProps('priceListName')}
        />
      </Group>

      <Select
        label="Currency"
        placeholder="Select currency"
        withAsterisk
        searchable
        disabled={currencyLocked}
        description={currencyLocked ? CURRENCY_LOCKED_HINT : 'Every price in this list is expressed in it.'}
        inputWrapperOrder={['label', 'input', 'description', 'error']}
        nothingFoundMessage="No currency found"
        data={currencyOptions}
        {...form.getInputProps('currencyId')}
      />

      <Textarea
        label="Description"
        placeholder="What this price list covers..."
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
        label="Yes, this price list is active"
        description="Only active price lists are offered when a price is entered."
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
              the price list to get the latest values and try again.
            </>
          ) : null}
        </Alert>
      ) : null}
    </FormModal>
  )
}
