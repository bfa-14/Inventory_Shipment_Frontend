import { Grid, NumberInput, Paper, Select, Text, Textarea, TextInput, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import {
  salesRateTypeLabel,
  type RateResolutionDto,
  type SalesRateType,
} from '../../api/sales/invoices'
import type { BranchLookupDto, CurrencyLookupDto, PartyLookupDto, PriceListLookupDto } from '../../api/types'
import { dateLabel, fromIsoDate, isoDate } from '../documents/documentKind'
import { formatNumber, numberInputValue } from '../format'
import { partyLabel, priceListLabel } from './salesLines'

/** What the invoice header holds. The page owns the state; this card draws it and reports changes. */
export interface SalesInvoiceHeader {
  documentDate: string
  dueDate: string | null
  branchId: string | null
  clientId: string | null
  salesmanId: string | null
  priceListId: string | null
  /** The currency the customer is billed in. Mandatory; it starts as the price list's. */
  currencyId: string | null
  rateType: SalesRateType
  /** The rate the invoice is valued at; null while none is known, and the page refuses to post then. */
  exchangeRate: number | null
  /** The price list currency's rate, which converts its prices, when the invoice is billed in another. */
  priceListRate: number | null
  referenceNo: string
  notes: string
}

export type SalesInvoiceHeaderErrors = Partial<Record<keyof SalesInvoiceHeader, string>>

interface SalesInvoiceHeaderCardProps {
  value: SalesInvoiceHeader
  onChange: (patch: Partial<SalesInvoiceHeader>) => void
  branches: BranchLookupDto[]
  priceLists: PriceListLookupDto[]
  clients: PartyLookupDto[]
  /** Active currencies, for the Invoice Currency select beside the client. */
  currencies: CurrencyLookupDto[]
  salesmen: PartyLookupDto[]
  rate: RateResolutionDto | null
  rateLoading: boolean
  /** The currency chosen in the header, and the price list's, as the page resolved them. */
  invoiceCurrency: CurrencyLookupDto | null
  listCurrency: CurrencyLookupDto | null
  sameCurrency: boolean
  /** The number, or null while it will be assigned on posting. */
  documentNumber: string | null
  isNew: boolean
  /** Posted and cancelled invoices are read: every input becomes text. */
  readOnly: boolean
  errors: SalesInvoiceHeaderErrors
  disabled: boolean
}

/**
 * The top card of an invoice: who, where, at which prices, at what rate.
 *
 * FOUR ACROSS, THEN TWO, THEN ONE — the same grid as the stock documents. READ-ONLY IS TEXT, NOT
 * DISABLED INPUTS: a posted invoice is a record, and a form full of greyed boxes reads as one the
 * reader has been locked out of rather than one that is finished.
 *
 * THE RATE IS LOOKED UP, NOT TYPED, unless there is nothing to look up: a base-currency list reads
 * "1 (base currency)", a foreign one shows what the server found for the date and lets the reader
 * change it, a date with no rate says so and asks for one.
 */
export function SalesInvoiceHeaderCard({
  value,
  onChange,
  branches,
  priceLists,
  clients,
  currencies,
  salesmen,
  rate,
  rateLoading,
  invoiceCurrency,
  listCurrency,
  sameCurrency,
  documentNumber,
  isNew,
  readOnly,
  errors,
  disabled,
}: SalesInvoiceHeaderCardProps) {
  const base = rate?.baseCurrencyCode ?? 'USD'
  const invoiceIsBase = invoiceCurrency?.isBaseCurrency ?? rate?.isBaseCurrency ?? true
  const listIsBase = listCurrency?.isBaseCurrency ?? rate?.priceListIsBaseCurrency ?? true

  /* Which rate each box edits: the invoice currency's, or the price list currency's. */
  type RateBox = { key: 'exchangeRate' | 'priceListRate'; code: string; published: number | null; date: string | null; note?: string }
  const invoiceBox: RateBox = { key: 'exchangeRate', code: invoiceCurrency?.currencyCode ?? rate?.currencyCode ?? '', published: rate?.rate ?? null, date: rate?.rateDate ?? null }
  const listBox: RateBox = {
    key: 'priceListRate', code: listCurrency?.currencyCode ?? rate?.priceListCurrencyCode ?? '',
    published: rate?.priceListRate ?? null, date: rate?.priceListRateDate ?? null, note: 'the price list currency',
  }
  const listMatters = !sameCurrency && !listIsBase && value.priceListId !== null
  const primary: RateBox | null = !invoiceIsBase ? invoiceBox : listMatters ? listBox : null
  const secondary: RateBox | null = !invoiceIsBase && listMatters ? listBox : null

  const rateInput = (label: string, box: RateBox | null) => {
    if (box === null) return readOnly ? field(label, '1 (base currency)') : <TextInput label={label} value="1 (base currency)" readOnly />
    const current = value[box.key]
    const text = current === null ? '' : `1 ${base} = ${formatNumber(current, 6)} ${box.code}`
    if (readOnly) return field(label, text)
    const missing = !rateLoading && rate !== null && current === null
    return (
      <NumberInput
        label={label}
        withAsterisk
        placeholder={rateLoading ? 'Looking up…' : 'Enter a rate'}
        value={current ?? ''}
        min={0}
        decimalScale={6}
        thousandSeparator=","
        onChange={(next) => {
          const parsed = numberInputValue(next)
          onChange({ [box.key]: parsed !== null && parsed > 0 ? parsed : null })
        }}
        disabled={disabled}
        description={`${box.code} per 1 ${base}${box.note ? ` (${box.note})` : ''}${box.published !== null && box.date ? ` · ${salesRateTypeLabel(value.rateType)} ${formatNumber(box.published, 6)} on ${dateLabel(box.date)}` : ''}`}
        error={
          errors[box.key]
          ?? (missing
            ? `No ${salesRateTypeLabel(value.rateType).toLowerCase()} rate is defined for ${box.code || 'this currency'} on this date — enter one to continue.`
            : undefined)
        }
      />
    )
  }

  const field = (label: string, text: string) => (
    <div>
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text fw={500}>{text || '—'}</Text>
    </div>
  )

  const client = clients.find((c) => String(c.id) === value.clientId)
  const salesman = salesmen.find((s) => String(s.id) === value.salesmanId)
  const priceList = priceLists.find((p) => String(p.id) === value.priceListId)

  return (
    <Paper radius="lg" p="md" withBorder>
      <Title order={5} mb="sm">
        Invoice Information
      </Title>

      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {field('Invoice No.', documentNumber ?? (isNew || !readOnly ? 'Assigned on posting' : 'DRAFT'))}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {readOnly ? (
            field('Invoice Date', dateLabel(value.documentDate))
          ) : (
            <DateInput
              label="Invoice Date"
              withAsterisk
              value={fromIsoDate(value.documentDate)}
              maxDate={new Date()}
              onChange={(next) => onChange({ documentDate: next ? isoDate(new Date(next)) : '' })}
              error={errors.documentDate}
              valueFormat="DD/MM/YYYY"
              disabled={disabled}
            />
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {readOnly ? (
            field('Due Date', value.dueDate ? dateLabel(value.dueDate) : '')
          ) : (
            <DateInput
              label="Due Date"
              placeholder="Optional"
              value={fromIsoDate(value.dueDate)}
              onChange={(next) => onChange({ dueDate: next ? isoDate(new Date(next)) : null })}
              error={errors.dueDate}
              valueFormat="DD/MM/YYYY"
              clearable
              disabled={disabled}
            />
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {readOnly ? (
            field('Branch', branches.find((b) => String(b.id) === value.branchId)?.branchName ?? '')
          ) : (
            <Select
              label="Branch"
              withAsterisk
              placeholder="Choose a branch"
              data={branches.map((b) => ({ value: String(b.id), label: b.branchName }))}
              value={value.branchId}
              onChange={(next) => onChange({ branchId: next })}
              error={errors.branchId}
              disabled={disabled}
              searchable
            />
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {readOnly ? (
            field('Client', client ? partyLabel(client) : '')
          ) : (
            <Select
              label="Client"
              withAsterisk
              placeholder="Search by code or name"
              data={clients.map((c) => ({ value: String(c.id), label: partyLabel(c) }))}
              value={value.clientId}
              onChange={(next) => onChange({ clientId: next })}
              error={errors.clientId}
              disabled={disabled}
              searchable
              nothingFoundMessage="No client matches"
            />
          )}
        </Grid.Col>

        {/* THE CLIENT'S ADDRESS, NOT THE INVOICE'S. It is read from Parties and shown, never typed
            here: editing it on one invoice would either change the client for every other document
            or quietly disagree with the record it came from. It is read-only in every mode for that
            reason, not because the invoice is posted. */}
        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {field('Client Address', client?.address ?? '')}
        </Grid.Col>

        {/* WHAT THE CUSTOMER IS BILLED IN, which need not be what the price list prices in. Leaving
            it on the price list's currency is the ordinary case and changes nothing; choosing
            another converts every line through the base currency at both currencies' rates. */}
        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {readOnly ? (
            field('Invoice Currency', currencies.find((c) => String(c.id) === value.currencyId)?.currencyCode
              ?? priceList?.currencyCode ?? '')
          ) : (
            <Select
              label="Invoice Currency"
              withAsterisk
              data={currencies.filter((c) => c.isActive || String(c.id) === value.currencyId).map((c) => ({ value: String(c.id), label: `${c.currencyCode} - ${c.currencyName}` }))}
              value={value.currencyId}
              placeholder="Choose a currency"
              onChange={(next) => onChange({ currencyId: next })}
              disabled={disabled}
              error={errors.currencyId}
              allowDeselect={false}
              searchable
            />
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {readOnly ? (
            field('Salesman', salesman ? partyLabel(salesman) : '')
          ) : (
            <Select
              label="Salesman"
              placeholder="Optional"
              data={salesmen.map((s) => ({ value: String(s.id), label: partyLabel(s) }))}
              value={value.salesmanId}
              onChange={(next) => onChange({ salesmanId: next })}
              disabled={disabled}
              searchable
              clearable
              nothingFoundMessage="No salesman matches"
            />
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {readOnly ? (
            field('Price List', priceList ? priceListLabel(priceList) : '')
          ) : (
            <Select
              label="Price List"
              withAsterisk
              placeholder="Choose a price list"
              data={priceLists.map((p) => ({ value: String(p.id), label: priceListLabel(p) }))}
              value={value.priceListId}
              onChange={(next) => onChange({ priceListId: next })}
              error={errors.priceListId}
              disabled={disabled}
              searchable
            />
          )}
        </Grid.Col>

        {/* RATE TYPE IS NOT SHOWN. The invoice still HAS one — it picks which published rate the
            exchange rate is read from, and it is still saved and still drives that lookup — but it
            is not a choice the header offers any more. A new invoice takes the default (Official)
            and a saved one keeps whatever it was issued with. */}

        {/* THE RATE THE READER SEES IS THE ONE THAT MATTERS. Billed in a foreign currency, it is that
            currency's rate. Billed in the base currency from a foreign price list, it is the LIST's rate
            - the one that converts its prices - rather than a fixed 1. Both foreign: both are shown. */}
        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {rateInput('Exchange Rate', primary)}
        </Grid.Col>
        {secondary && (
          <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
            {rateInput('Price List Rate', secondary)}
          </Grid.Col>
        )}

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {readOnly ? (
            field('Reference No.', value.referenceNo)
          ) : (
            <TextInput
              label="Reference No."
              placeholder="Order, delivery note…"
              value={value.referenceNo}
              onChange={(event) => onChange({ referenceNo: event.currentTarget.value })}
              maxLength={100}
              disabled={disabled}
            />
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 9 }}>
          {readOnly ? (
            field('Notes', value.notes)
          ) : (
            <Textarea
              label="Notes"
              placeholder="Anything worth recording about this invoice"
              value={value.notes}
              onChange={(event) => onChange({ notes: event.currentTarget.value })}
              maxLength={1000}
              autosize
              minRows={1}
              disabled={disabled}
            />
          )}
        </Grid.Col>
      </Grid>
    </Paper>
  )
}
