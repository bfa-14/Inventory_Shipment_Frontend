import { Badge, Grid, Group, NumberInput, Paper, SegmentedControl, Select, Text, Textarea, TextInput, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { RECEIPT_PAYMENT_TYPES, type ReceiptPaymentType } from '../../../api/sales/receipts'
import type { BranchLookupDto, CurrencyLookupDto, PartyLookupDto } from '../../../api/types'
import { fromIsoDate, isoDate, STATUS_COLOURS } from '../../documents/documentKind'
import { formatNumber, numberInputValue } from '../../format'
import { partyLabel } from '../salesLines'
import { toBase, type ReceiptHeaderForm } from './receiptModel'

export type ReceiptHeaderErrors = Partial<Record<keyof ReceiptHeaderForm, string>>

interface ReceiptHeaderCardProps {
  value: ReceiptHeaderForm
  onChange: (patch: Partial<ReceiptHeaderForm>) => void
  /** The reader changed the rate by hand; the page stops overwriting it when the date or currency moves. */
  onRateEdited: () => void
  branches: BranchLookupDto[]
  clients: PartyLookupDto[]
  currencies: CurrencyLookupDto[]
  receiptNumber: string | null
  status: string | null
  baseCurrencyCode: string
  rateLoading: boolean
  /** The date the rate was published for, when it is not the receipt's own. */
  rateDate: string | null
  /** True when the currency is the base currency: the rate is 1 and not editable. */
  isBaseCurrency: boolean
  readOnly: boolean
  /** Customer and payment type are fixed once a Sales Allocation receipt has invoices chosen — kept simple: only while saving. */
  disabled: boolean
  errors: ReceiptHeaderErrors
}

/**
 * The top card: who paid, where, how much in total and at what rate.
 *
 * THE AMOUNT IS A CONTROL TOTAL, not a sum. The payment lines below must add up to it before the
 * receipt can be posted, which is what catches the cashier who typed 1,000 at the top and 100 on the
 * line — the amount in USD under it is what everything else is compared with.
 */
export function ReceiptHeaderCard({
  value,
  onChange,
  onRateEdited,
  branches,
  clients,
  currencies,
  receiptNumber,
  status,
  baseCurrencyCode,
  rateLoading,
  rateDate,
  isBaseCurrency,
  readOnly,
  disabled,
  errors,
}: ReceiptHeaderCardProps) {
  const off = readOnly || disabled
  const currency = currencies.find((c) => String(c.id) === value.currencyId)
  const amountBase = toBase(value.amount, isBaseCurrency ? 1 : value.exchangeRate)

  const pick = (items: { id: number; isActive: boolean }[], selected: string | null, label: (item: never) => string) =>
    items
      .filter((item) => item.isActive || String(item.id) === selected)
      .map((item) => ({ value: String(item.id), label: label(item as never) }))

  return (
    <Paper radius="lg" p="md" withBorder>
      <Group justify="space-between" mb="sm">
        <Title order={5}>Receipt</Title>
        {status && <Badge color={STATUS_COLOURS[status] ?? 'gray'} variant="light">{status}</Badge>}
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <TextInput label="Receipt No." value={receiptNumber ?? ''} placeholder="Assigned when saved" readOnly disabled />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <DateInput
            label="Date"
            withAsterisk
            valueFormat="DD/MM/YYYY"
            value={fromIsoDate(value.receiptDate)}
            onChange={(next) => next && onChange({ receiptDate: isoDate(new Date(next)) })}
            error={errors.receiptDate}
            disabled={off}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Select
            label="Customer"
            withAsterisk
            placeholder="Choose a customer"
            data={pick(clients, value.clientId, (c: PartyLookupDto) => partyLabel(c))}
            value={value.clientId}
            onChange={(next) => onChange({ clientId: next })}
            error={errors.clientId}
            searchable
            disabled={off}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
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

        <Grid.Col span={{ base: 12, md: 4 }}>
          <Text size="sm" fw={500} mb={4}>Payment type</Text>
          <SegmentedControl
            fullWidth
            data={RECEIPT_PAYMENT_TYPES.map((t) => ({ value: String(t.value), label: t.label }))}
            value={String(value.paymentType)}
            onChange={(next) => onChange({ paymentType: Number(next) as ReceiptPaymentType })}
            disabled={off}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4, md: 2 }}>
          <Select
            label="Currency"
            withAsterisk
            data={pick(currencies, value.currencyId, (c: CurrencyLookupDto) => `${c.currencyCode} - ${c.currencyName}`)}
            value={value.currencyId}
            onChange={(next) => onChange({ currencyId: next })}
            error={errors.currencyId}
            searchable
            disabled={off}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4, md: 2 }}>
          <NumberInput
            label="Amount"
            withAsterisk
            min={0}
            decimalScale={currency?.decimalPlaces ?? 2}
            thousandSeparator=","
            value={value.amount ?? ''}
            onChange={(next) => onChange({ amount: numberInputValue(next) })}
            error={errors.amount}
            disabled={off}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4, md: 2 }}>
          <NumberInput
            label="Exchange rate"
            description={isBaseCurrency ? 'Base currency' : rateLoading ? 'Looking up…' : rateDate ? `Rate of ${rateDate}` : undefined}
            min={0}
            decimalScale={6}
            thousandSeparator=","
            value={isBaseCurrency ? 1 : (value.exchangeRate ?? '')}
            onChange={(next) => {
              onRateEdited()
              onChange({ exchangeRate: numberInputValue(next) })
            }}
            error={errors.exchangeRate}
            disabled={off || isBaseCurrency}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 12, md: 2 }}>
          <TextInput label={`Amount in ${baseCurrencyCode}`} value={formatNumber(amountBase, 2)} readOnly disabled styles={{ input: { textAlign: 'right', fontWeight: 600 } }} />
        </Grid.Col>

        <Grid.Col span={12}>
          <Textarea
            label="Notes"
            value={value.notes}
            onChange={(event) => onChange({ notes: event.currentTarget.value })}
            maxLength={1000}
            autosize
            minRows={2}
            disabled={off}
          />
        </Grid.Col>
      </Grid>
    </Paper>
  )
}
