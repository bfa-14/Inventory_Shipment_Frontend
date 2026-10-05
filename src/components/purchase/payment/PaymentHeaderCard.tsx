import { Badge, Grid, Group, NumberInput, Paper, Select, Text, Textarea, TextInput, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { SUPPLIER_PAYMENT_TYPES, type SupplierPaymentType } from '../../../api/purchase/payments'
import type { BranchLookupDto, CurrencyLookupDto, PartyLookupDto } from '../../../api/types'
import { fromIsoDate, isoDate, STATUS_COLOURS } from '../../documents/documentKind'
import { formatNumber, numberInputValue } from '../../format'
import { partyLabel } from '../../sales/salesLines'
import type { PaymentHeaderForm } from './paymentModel'

export type PaymentHeaderErrors = Partial<Record<keyof PaymentHeaderForm, string>>

const NOTES_MAX = 500

interface PaymentHeaderCardProps {
  value: PaymentHeaderForm
  onChange: (patch: Partial<PaymentHeaderForm>) => void
  /** The reader typed the rate: the page stops overwriting it when the date or currency moves. */
  onRateEdited: () => void
  branches: BranchLookupDto[]
  payees: PartyLookupDto[]
  currencies: CurrencyLookupDto[]
  paymentNumber: string | null
  status: string | null
  baseCurrencyCode: string
  rateLoading: boolean
  /** The date the rate was published for, when it is not the payment's own. */
  rateDate: string | null
  isBaseCurrency: boolean
  readOnly: boolean
  disabled: boolean
  errors: PaymentHeaderErrors
}

/**
 * 1 - Payment Information: who is paid, from where, how much in total and at what rate.
 *
 * THE AMOUNT IS A CONTROL TOTAL, not a sum: the payment details below (and the allocations, when the
 * payment pays documents) must add up to it, in this currency, before the payment can be posted.
 */
export function PaymentHeaderCard({
  value,
  onChange,
  onRateEdited,
  branches,
  payees,
  currencies,
  paymentNumber,
  status,
  baseCurrencyCode,
  rateLoading,
  rateDate,
  isBaseCurrency,
  readOnly,
  disabled,
  errors,
}: PaymentHeaderCardProps) {
  const off = readOnly || disabled
  const currency = currencies.find((c) => String(c.id) === value.currencyId)
  const rate = isBaseCurrency ? 1 : value.exchangeRate
  const amountBase = value.amount !== null && rate && rate > 0 ? value.amount / rate : 0

  const pick = (items: { id: number; isActive: boolean }[], selected: string | null, label: (item: never) => string) =>
    items
      .filter((item) => item.isActive || String(item.id) === selected)
      .map((item) => ({ value: String(item.id), label: label(item as never) }))

  return (
    <Paper radius="lg" p="md" withBorder>
      <Group justify="space-between" mb="sm">
        <Title order={5}>1 · Payment Information</Title>
        {status && <Badge color={STATUS_COLOURS[status] ?? (status === 'Reversed' ? 'orange' : 'gray')} variant="light">{status}</Badge>}
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, md: 2 }}>
          <TextInput
            label="Payment No."
            value={paymentNumber ?? ''}
            placeholder="Auto-generated"
            description={paymentNumber ? undefined : 'Assigned when saved'}
            readOnly
            disabled
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 2 }}>
          <DateInput
            label="Payment Date"
            withAsterisk
            valueFormat="DD/MM/YYYY"
            value={fromIsoDate(value.paymentDate)}
            onChange={(next) => next && onChange({ paymentDate: isoDate(new Date(next)) })}
            error={errors.paymentDate}
            disabled={off}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Select
            label="Payment Type"
            withAsterisk
            allowDeselect={false}
            data={SUPPLIER_PAYMENT_TYPES.map((t) => ({ value: String(t.value), label: t.label }))}
            value={String(value.paymentType)}
            onChange={(next) => next && onChange({ paymentType: Number(next) as SupplierPaymentType })}
            disabled={off}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Select
            label="Payee / Supplier"
            withAsterisk
            placeholder="Choose a supplier"
            data={pick(payees, value.payeeId, (p: PartyLookupDto) => partyLabel(p))}
            value={value.payeeId}
            onChange={(next) => onChange({ payeeId: next })}
            error={errors.payeeId}
            searchable
            nothingFoundMessage="No supplier found"
            disabled={off}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 2 }}>
          <Select
            label="Branch"
            withAsterisk
            placeholder="Choose a branch"
            data={pick(branches, value.branchId, (b: BranchLookupDto) => b.branchName)}
            value={value.branchId}
            onChange={(next) => onChange({ branchId: next })}
            error={errors.branchId}
            searchable
            disabled={off}
          />
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 4, md: 2 }}>
          <Select
            label="Payment Currency"
            withAsterisk
            data={pick(currencies, value.currencyId, (c: CurrencyLookupDto) => c.currencyCode)}
            value={value.currencyId}
            onChange={(next) => onChange({ currencyId: next })}
            error={errors.currencyId}
            searchable
            disabled={off}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4, md: 2 }}>
          <NumberInput
            label="Payment Amount"
            withAsterisk
            min={0}
            decimalScale={currency?.decimalPlaces ?? 2}
            fixedDecimalScale
            thousandSeparator=","
            value={value.amount ?? ''}
            onChange={(next) => onChange({ amount: numberInputValue(next) })}
            error={errors.amount}
            styles={{ input: { textAlign: 'right' } }}
            disabled={off}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4, md: 2 }}>
          <NumberInput
            label={`Exchange Rate to ${baseCurrencyCode}`}
            withAsterisk={!isBaseCurrency}
            description={isBaseCurrency ? 'Base currency' : rateLoading ? 'Looking up…' : rateDate ? `Rate of ${rateDate}` : `${currency?.currencyCode ?? ''} per 1 ${baseCurrencyCode}`}
            min={0}
            decimalScale={6}
            thousandSeparator=","
            value={isBaseCurrency ? 1 : (value.exchangeRate ?? '')}
            onChange={(next) => {
              onRateEdited()
              onChange({ exchangeRate: numberInputValue(next) })
            }}
            error={errors.exchangeRate}
            styles={{ input: { textAlign: 'right' } }}
            disabled={off || isBaseCurrency}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4, md: 2 }}>
          <TextInput
            label={`Amount in ${baseCurrencyCode}`}
            value={formatNumber(amountBase, 2)}
            readOnly
            disabled
            styles={{ input: { textAlign: 'right', fontWeight: 600 } }}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4, md: 2 }}>
          <TextInput
            label="Reference"
            placeholder="Optional"
            maxLength={100}
            value={value.reference}
            onChange={(event) => onChange({ reference: event.currentTarget.value })}
            disabled={off}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4, md: 2 }}>
          <TextInput label="Status" value={status ?? 'Draft'} readOnly disabled />
        </Grid.Col>

        <Grid.Col span={12}>
          <Textarea
            label="Notes"
            value={value.notes}
            onChange={(event) => onChange({ notes: event.currentTarget.value })}
            maxLength={NOTES_MAX}
            autosize
            minRows={2}
            disabled={off}
          />
          <Text size="xs" c="dimmed" ta="right">{value.notes.length}/{NOTES_MAX}</Text>
        </Grid.Col>
      </Grid>
    </Paper>
  )
}
