import { Grid, NumberInput, Paper, Select, Text, Textarea, TextInput, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import {
  SALES_RATE_TYPES,
  salesRateTypeLabel,
  type RateResolutionDto,
  type SalesRateType,
} from '../../api/sales/invoices'
import type { BranchLookupDto, PartyLookupDto, PriceListLookupDto, WarehouseLookupDto } from '../../api/types'
import { dateLabel, fromIsoDate, isoDate } from '../documents/documentKind'
import { formatNumber, numberInputValue } from '../format'
import { partyLabel, priceListLabel } from './salesLines'

/** What the invoice header holds. The page owns the state; this card draws it and reports changes. */
export interface SalesInvoiceHeader {
  documentDate: string
  dueDate: string | null
  branchId: string | null
  warehouseId: string | null
  clientId: string | null
  salesmanId: string | null
  priceListId: string | null
  rateType: SalesRateType
  /** The rate the invoice is valued at; null while none is known, and the page refuses to post then. */
  exchangeRate: number | null
  referenceNo: string
  notes: string
}

export type SalesInvoiceHeaderErrors = Partial<Record<keyof SalesInvoiceHeader, string>>

interface SalesInvoiceHeaderCardProps {
  value: SalesInvoiceHeader
  onChange: (patch: Partial<SalesInvoiceHeader>) => void
  branches: BranchLookupDto[]
  warehouses: WarehouseLookupDto[]
  priceLists: PriceListLookupDto[]
  clients: PartyLookupDto[]
  salesmen: PartyLookupDto[]
  rate: RateResolutionDto | null
  rateLoading: boolean
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
  warehouses,
  priceLists,
  clients,
  salesmen,
  rate,
  rateLoading,
  documentNumber,
  isNew,
  readOnly,
  errors,
  disabled,
}: SalesInvoiceHeaderCardProps) {
  const isBase = rate?.isBaseCurrency === true
  const currency = rate?.currencyCode ?? priceLists.find((p) => String(p.id) === value.priceListId)?.currencyCode
  const rateMissing = value.priceListId !== null && !rateLoading && rate !== null && !isBase && value.exchangeRate === null

  const rateDescription =
    rate && !isBase && rate.rate !== null
      ? `1 ${rate.baseCurrencyCode ?? 'USD'} = ${formatNumber(rate.rate, rate.decimalPlaces)} ${rate.currencyCode} (${salesRateTypeLabel(rate.rateType)}, ${dateLabel(rate.rateDate)})`
      : undefined

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
              onChange={(next) => onChange({ branchId: next, warehouseId: null })}
              error={errors.branchId}
              disabled={disabled}
              searchable
            />
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {readOnly ? (
            field('Warehouse', warehouses.find((w) => String(w.id) === value.warehouseId)?.warehouseName ?? '')
          ) : (
            <Select
              label="Warehouse"
              withAsterisk
              placeholder={value.branchId ? 'Choose a warehouse' : 'Choose a branch first'}
              data={warehouses.map((w) => ({ value: String(w.id), label: w.warehouseName }))}
              value={value.warehouseId}
              onChange={(next) => onChange({ warehouseId: next })}
              disabled={disabled || !value.branchId}
              error={
                errors.warehouseId
                ?? (value.branchId && warehouses.length === 0
                  ? 'This branch has no active warehouses. Pick another branch, or add one first.'
                  : undefined)
              }
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

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {readOnly ? (
            field('Rate Type', salesRateTypeLabel(value.rateType))
          ) : (
            <Select
              label="Rate Type"
              data={SALES_RATE_TYPES.map((t) => ({ value: String(t.value), label: t.label }))}
              value={String(value.rateType)}
              onChange={(next) => next && onChange({ rateType: Number(next) as SalesRateType })}
              disabled={disabled || !value.priceListId || isBase}
              allowDeselect={false}
            />
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {readOnly ? (
            field('Exchange Rate', isBase ? '1 (base currency)' : value.exchangeRate === null ? '' : `${formatNumber(value.exchangeRate, rate?.decimalPlaces ?? 2)} ${currency ?? ''} per ${rate?.baseCurrencyCode ?? 'USD'}`)
          ) : isBase ? (
            <TextInput label="Exchange Rate" value="1 (base currency)" readOnly />
          ) : (
            <NumberInput
              label="Exchange Rate"
              withAsterisk={value.priceListId !== null}
              placeholder={!value.priceListId ? 'Choose a price list first' : rateLoading ? 'Looking up…' : 'Enter a rate'}
              value={value.exchangeRate ?? ''}
              min={0}
              decimalScale={6}
              thousandSeparator=","
              onChange={(next) => {
                const parsed = numberInputValue(next)
                onChange({ exchangeRate: parsed !== null && parsed > 0 ? parsed : null })
              }}
              disabled={disabled || !value.priceListId}
              description={rateDescription}
              error={
                errors.exchangeRate
                ?? (rateMissing
                  ? `No ${salesRateTypeLabel(value.rateType).toLowerCase()} rate is defined for ${currency ?? 'this currency'} on this date — enter one to continue.`
                  : undefined)
              }
            />
          )}
        </Grid.Col>

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
