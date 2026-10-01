import { useState } from 'react'
import { Alert, Checkbox, NumberInput, Select, SimpleGrid, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { ApiError } from '../../api/http'
import { allocationMethodLabel, METHODS_NEEDING_ITEM_DATA, type ChargeAllocationMethod, type ChargeTypeLookupDto } from '../../api/purchase/chargeTypes'
import { purchaseDocumentsApi } from '../../api/purchase/documents'
import { lateChargesApi, type LateChargeDto, type LateChargesDto } from '../../api/purchase/lateCharges'
import type { CurrencyLookupDto, PartyLookupDto } from '../../api/types'
import { formatNumber, numberInputValue, todayDateOnly } from '../format'
import { FormModal } from '../ui/FormModal'
import { currencyLabel, supplierLabel } from './purchaseKind'

/** A late charge has no split grid, so Manual is not offered (the server refuses it too). */
const LATE_CHARGE_METHODS: ChargeAllocationMethod[] = ['Value', 'Quantity', 'Weight', 'Volume']

interface LateChargeModalProps {
  invoiceId: number
  /** The draft charge being changed; null adds one. */
  charge: LateChargeDto | null
  chargeTypes: ChargeTypeLookupDto[]
  providers: PartyLookupDto[]
  currencies: CurrencyLookupDto[]
  onClose: () => void
  /** The invoice's late charges as the save returned them. */
  onSaved: (result: LateChargesDto) => void
}

/** The type's own method, unless it is Manual: then the commonest one, which the reader can change. */
function methodOf(type: ChargeTypeLookupDto | undefined): ChargeAllocationMethod {
  return type && type.allocationMethod !== 'Manual' ? type.allocationMethod : 'Value'
}

/**
 * One late charge of a posted invoice — the fields of a draft invoice's charge, plus its date.
 *
 * THE DATE IS THE ADJUSTMENT'S: the charge goes into the invoice's draft landed cost adjustment and
 * that document has one date, so saving a charge dates the draft. The rate is looked up for it.
 * "Include in landed cost" is the charge type's and is shown, not chosen — the server copies it
 * from the type.
 */
export function LateChargeModal({ invoiceId, charge, chargeTypes, providers, currencies, onClose, onSaved }: LateChargeModalProps) {
  const baseCurrency = currencies.find((c) => c.isBaseCurrency)
  const baseCode = baseCurrency?.currencyCode ?? 'USD'

  const [chargeTypeId, setChargeTypeId] = useState<string | null>(charge ? String(charge.chargeTypeId) : null)
  const [description, setDescription] = useState(charge?.description ?? '')
  const [providerId, setProviderId] = useState<string | null>(charge?.providerPartyId != null ? String(charge.providerPartyId) : null)
  const [reference, setReference] = useState(charge?.reference ?? '')
  const [date, setDate] = useState(charge ? charge.chargeDate.slice(0, 10) : todayDateOnly())
  const [currencyId, setCurrencyId] = useState<string | null>(
    charge ? String(charge.currencyId) : baseCurrency ? String(baseCurrency.id) : null,
  )
  const [rate, setRate] = useState<number | null>(charge ? charge.exchangeRate : 1)
  const [rateLoading, setRateLoading] = useState(false)
  const [amount, setAmount] = useState<number | null>(charge ? charge.amount : null)
  const [method, setMethod] = useState<ChargeAllocationMethod>(
    charge && charge.allocationMethod !== 'Manual' ? charge.allocationMethod : 'Value',
  )
  const [notes, setNotes] = useState(charge?.notes ?? '')

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const type = chargeTypes.find((t) => String(t.id) === chargeTypeId)
  const includeInLandedCost = type?.includeInLandedCost ?? charge?.includeInLandedCost ?? true
  const currency = currencies.find((c) => String(c.id) === currencyId)
  const isBase = currency?.isBaseCurrency ?? true
  const effectiveRate = isBase ? 1 : rate
  const amountBase = amount !== null && effectiveRate !== null && effectiveRate > 0
    ? Math.round((amount / effectiveRate + Number.EPSILON) * 100) / 100
    : null

  /** The charge currency's rate on the charge date — editable, but looked up first. */
  async function resolveRate(nextCurrencyId: string | null, nextDate: string) {
    const picked = currencies.find((c) => String(c.id) === nextCurrencyId)
    if (!picked || picked.isBaseCurrency) {
      setRate(1)
      return
    }
    setRateLoading(true)
    try {
      const answer = await purchaseDocumentsApi.rate(picked.id, 1, nextDate || null)
      setRate(answer.isBaseCurrency ? 1 : answer.rate)
    } catch {
      setRate(null)
    } finally {
      setRateLoading(false)
    }
  }

  function chooseType(next: string | null) {
    setChargeTypeId(next)
    setMethod(methodOf(chargeTypes.find((t) => String(t.id) === next)))
    setErrors((current) => ({ ...current, chargeTypeId: '' }))
  }

  function validate(): Record<string, string> {
    const found: Record<string, string> = {}
    if (!chargeTypeId) found.chargeTypeId = 'Choose a charge type.'
    if (!date) found.date = 'Enter the charge date.'
    else if (date > todayDateOnly()) found.date = 'The date cannot be in the future.'
    if (!currencyId) found.currencyId = 'Choose a currency.'
    if (!isBase && (rate === null || rate <= 0)) found.rate = 'Enter the exchange rate.'
    if (amount === null || amount <= 0) found.amount = 'Enter an amount above zero.'
    return found
  }

  async function save() {
    const found = validate()
    setErrors(found)
    setFormError(null)
    if (Object.keys(found).length > 0) return

    const payload = {
      chargeTypeId: Number(chargeTypeId),
      description: description.trim() || null,
      providerPartyId: providerId === null ? null : Number(providerId),
      reference: reference.trim() || null,
      chargeDate: date,
      currencyId: Number(currencyId),
      rateType: 1,
      exchangeRate: effectiveRate,
      amount: amount ?? 0,
      allocationMethod: method,
      includeInLandedCost,
      notes: notes.trim() || null,
    }

    setSaving(true)
    try {
      const result = charge
        ? await lateChargesApi.update(invoiceId, charge.id, payload)
        : await lateChargesApi.add(invoiceId, payload)
      onSaved(result)
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'The charge could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormModal
      opened
      title={charge ? `Edit late charge - ${charge.adjustmentNumber}` : 'Add late charge'}
      onSubmit={() => void save()}
      onClose={onClose}
      saving={saving}
      size="lg"
    >
      <Stack gap="sm" data-late-charge-form>
        {formError && (
          <Alert color="red" variant="light" data-late-charge-error>
            {formError}
          </Alert>
        )}

        <Select
          label="Charge type"
          withAsterisk
          data={chargeTypes.map((t) => ({ value: String(t.id), label: `${t.chargeCode} - ${t.chargeName}` }))}
          value={chargeTypeId}
          onChange={chooseType}
          searchable
          nothingFoundMessage="No charge type"
          error={errors.chargeTypeId || undefined}
        />

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <Select
            label="Provider"
            data={providers.map((p) => ({ value: String(p.id), label: supplierLabel(p) }))}
            value={providerId}
            onChange={setProviderId}
            placeholder="Who billed it"
            searchable
            clearable
            nothingFoundMessage="No provider"
          />
          <TextInput
            label="Reference"
            value={reference}
            onChange={(event) => setReference(event.currentTarget.value)}
            placeholder="Their invoice no."
            maxLength={100}
          />

          <DateInput
            label="Date"
            withAsterisk
            valueFormat="DD/MM/YYYY"
            value={date || null}
            maxDate={todayDateOnly()}
            onChange={(next) => {
              const value = next ? String(next).slice(0, 10) : ''
              setDate(value)
              if (value) void resolveRate(currencyId, value)
            }}
            error={errors.date}
            description="Dates the draft adjustment"
          />
          <Select
            label="Currency"
            withAsterisk
            data={currencies.map((c) => ({ value: String(c.id), label: currencyLabel(c) }))}
            value={currencyId}
            onChange={(next) => {
              setCurrencyId(next)
              void resolveRate(next, date)
            }}
            allowDeselect={false}
            searchable
            error={errors.currencyId}
          />

          {isBase ? (
            <TextInput label="Exchange rate" value="1 (base currency)" readOnly />
          ) : (
            <NumberInput
              label={`Exchange rate (${currency?.currencyCode ?? ''} per 1 ${baseCode})`}
              withAsterisk
              value={rate ?? ''}
              min={0}
              decimalScale={6}
              thousandSeparator=","
              placeholder={rateLoading ? 'Looking up…' : 'Enter a rate'}
              onChange={(next) => {
                const parsed = numberInputValue(next)
                setRate(parsed !== null && parsed > 0 ? parsed : null)
              }}
              error={errors.rate}
            />
          )}
          <NumberInput
            label={`Amount${currency ? ` (${currency.currencyCode})` : ''}`}
            withAsterisk
            value={amount ?? ''}
            min={0}
            decimalScale={2}
            fixedDecimalScale
            thousandSeparator=","
            placeholder="0.00"
            onChange={(next) => setAmount(numberInputValue(next))}
            error={errors.amount}
            description={amountBase === null || isBase ? undefined : `≈ ${formatNumber(amountBase, 2)} ${baseCode}`}
            data-late-charge-amount
          />

          <Select
            label="Allocation method"
            data={LATE_CHARGE_METHODS.map((m) => ({ value: m, label: allocationMethodLabel(m) }))}
            value={method}
            onChange={(next) => next && setMethod(next as ChargeAllocationMethod)}
            allowDeselect={false}
            description={METHODS_NEEDING_ITEM_DATA[method]}
          />
          <Checkbox
            mt={{ base: 0, sm: 30 }}
            label="Include in landed cost"
            description="Set by the charge type"
            checked={includeInLandedCost}
            disabled
            readOnly
          />
        </SimpleGrid>

        <TextInput
          label="Description"
          value={description}
          onChange={(event) => setDescription(event.currentTarget.value)}
          placeholder="Optional"
          maxLength={200}
        />
        <Textarea
          label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.currentTarget.value)}
          autosize
          minRows={2}
          maxLength={300}
        />

        {!includeInLandedCost && (
          <Text fz="xs" c="dimmed">
            This charge type is not in the landed cost: the charge is recorded, but posting it does not change the item costs.
          </Text>
        )}
      </Stack>
    </FormModal>
  )
}
