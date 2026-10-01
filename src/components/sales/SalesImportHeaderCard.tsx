import { Grid, NumberInput, Paper, Select, Text, Textarea, TextInput, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import {
  salesRateTypeLabel,
  type RateResolutionDto,
  type SalesRateType,
} from '../../api/sales/invoices'
import type { BranchLookupDto, PartyLookupDto, PriceListLookupDto, WarehouseLookupDto } from '../../api/types'
import { dateLabel, fromIsoDate, isoDate } from '../documents/documentKind'
import { formatNumber, numberInputValue } from '../format'
import { partyLabel, priceListLabel } from './salesLines'

/** What the header holds. The page owns the state; this card only draws it and reports changes. */
export interface SalesImportHeader {
  branchId: string | null
  warehouseId: string | null
  priceListId: string | null
  clientId: string | null
  salesmanId: string | null
  documentDate: string
  rateType: SalesRateType
  /**
   * The rate the invoice will be valued at: what the server found for the date, or what the reader
   * typed when it found none. Null means missing, and the page refuses to post until it is not.
   */
  exchangeRate: number | null
  referenceNo: string
  notes: string
}

export type SalesImportHeaderErrors = Partial<Record<keyof SalesImportHeader, string>>

interface SalesImportHeaderCardProps {
  value: SalesImportHeader
  onChange: (patch: Partial<SalesImportHeader>) => void
  branches: BranchLookupDto[]
  /** Warehouses of the chosen branch. */
  warehouses: WarehouseLookupDto[]
  priceLists: PriceListLookupDto[]
  clients: PartyLookupDto[]
  salesmen: PartyLookupDto[]
  /** The rate lookup's answer for the current price list, type and date; null until it arrives. */
  rate: RateResolutionDto | null
  rateLoading: boolean
  errors: SalesImportHeaderErrors
  /** While the posting runs the header waits; nothing may change under a request in flight. */
  disabled: boolean
}

/**
 * The header of a sales import: who is buying, from where, at which prices, at what rate.
 *
 * TEN FIELDS THAT COLLAPSE. Four across on a desktop, two on a tablet, one on a phone — the same
 * grid the stock documents use, because a reader who knows one document header knows this one.
 *
 * THE RATE IS LOOKED UP, NOT TYPED, unless there is nothing to look up. A base-currency list shows
 * "1 (base currency)" and no input at all; a foreign one shows the rate the server found for the
 * date and lets the reader change it; a date with no rate says so and asks for one, because an
 * invoice valued at a rate nobody entered is worse than one that waits.
 */
export function SalesImportHeaderCard({
  value,
  onChange,
  branches,
  warehouses,
  priceLists,
  clients,
  salesmen,
  rate,
  rateLoading,
  errors,
  disabled,
}: SalesImportHeaderCardProps) {
  const isBase = rate?.isBaseCurrency === true
  const currency = priceLists.find((p) => String(p.id) === value.priceListId)?.currencyCode

  const rateMissing =
    value.priceListId !== null && !rateLoading && rate !== null && !isBase && value.exchangeRate === null

  const rateDescription =
    rate && !isBase && rate.rate !== null
      ? `1 ${rate.baseCurrencyCode ?? 'USD'} = ${formatNumber(rate.rate, rate.decimalPlaces)} ${rate.currencyCode} (${salesRateTypeLabel(rate.rateType)}, ${dateLabel(rate.rateDate)})`
      : undefined

  return (
    <Paper radius="lg" p="md" withBorder>
      <Title order={5} mb="sm">
        Sales Import
      </Title>

      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          <Select
            label="Branch"
            withAsterisk
            placeholder="Choose a branch"
            data={branches.map((b) => ({ value: String(b.id), label: b.branchName }))}
            value={value.branchId}
            // Changing the branch invalidates the warehouse under it, so both move together.
            onChange={(next) => onChange({ branchId: next, warehouseId: null })}
            error={errors.branchId}
            disabled={disabled}
            searchable
          />
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          <Select
            label="Default Warehouse"
            withAsterisk
            placeholder={value.branchId ? 'Choose a warehouse' : 'Choose a branch first'}
            data={warehouses.map((w) => ({ value: String(w.id), label: w.warehouseName }))}
            value={value.warehouseId}
            onChange={(next) => onChange({ warehouseId: next })}
            disabled={disabled || !value.branchId}
            /* A BRANCH WITH NO WAREHOUSES IS A REAL STATE and it has to say so, or an empty list
               under a required field reads as a page that failed to load. */
            error={
              errors.warehouseId
              ?? (value.branchId && warehouses.length === 0
                ? 'This branch has no active warehouses. Pick another branch, or add one first.'
                : undefined)
            }
            searchable
          />
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
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
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
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
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
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
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          <DateInput
            label="Date"
            withAsterisk
            value={fromIsoDate(value.documentDate)}
            // An invoice cannot be dated into the future: the stock it moves has not moved yet.
            maxDate={new Date()}
            onChange={(next) => onChange({ documentDate: next ? isoDate(new Date(next)) : '' })}
            error={errors.documentDate}
            valueFormat="DD/MM/YYYY"
            disabled={disabled}
          />
        </Grid.Col>

        {/* RATE TYPE IS NOT SHOWN, as on the invoice header. The import still sends one — it picks
            which published rate the exchange rate is read from — but it is no longer a choice the
            header offers; the default (Official) is used. */}

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {isBase ? (
            <TextInput label="Exchange Rate" value="1 (base currency)" readOnly />
          ) : (
            <NumberInput
              label="Exchange Rate"
              withAsterisk={value.priceListId !== null}
              placeholder={
                !value.priceListId ? 'Choose a price list first' : rateLoading ? 'Looking up…' : 'Enter a rate'
              }
              value={value.exchangeRate ?? ''}
              min={0}
              decimalScale={6}
              thousandSeparator=","
              onChange={(next) => {
                const rate = numberInputValue(next)
                onChange({ exchangeRate: rate !== null && rate > 0 ? rate : null })
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
          <TextInput
            label="Reference No."
            placeholder="Order, delivery note…"
            value={value.referenceNo}
            onChange={(event) => onChange({ referenceNo: event.currentTarget.value })}
            maxLength={100}
            disabled={disabled}
          />
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 9 }}>
          <Textarea
            label="Notes"
            placeholder="Anything worth recording about this sale"
            value={value.notes}
            onChange={(event) => onChange({ notes: event.currentTarget.value })}
            maxLength={1000}
            autosize
            minRows={1}
            disabled={disabled}
          />
        </Grid.Col>
      </Grid>

      {currency && (
        <Text size="xs" c="dimmed" mt="sm">
          Prices and totals are in {currency}. Quantities are checked against the stock on hand of each
          line's warehouse.
        </Text>
      )}
    </Paper>
  )
}
