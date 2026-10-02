import { Anchor, Badge, Grid, Group, NumberInput, Paper, Select, Switch, Text, Textarea, TextInput, Title, Tooltip } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconLink } from '@tabler/icons-react'
import { Link } from 'react-router'
import { routes } from '../../routes'
import type { PurchaseRateResolutionDto } from '../../api/purchase/documents'
import { SALES_RATE_TYPES, salesRateTypeLabel, type SalesRateType } from '../../api/sales/invoices'
import type { BranchLookupDto, CurrencyLookupDto, PartyLookupDto } from '../../api/types'
import { dateLabel, fromIsoDate, isoDate } from '../documents/documentKind'
import { formatNumber, numberInputValue } from '../format'
import { currencyLabel, purchaseKindOf, supplierLabel, type PurchaseKind } from './purchaseKind'

/** What the purchase header holds. The page owns the state; this card draws it and reports changes. */
export interface PurchaseHeader {
  documentDate: string
  expectedDate: string | null
  branchId: string | null
  supplierId: string | null
  currencyId: string | null
  rateType: SalesRateType
  /** The rate the document is valued at; null while none is known, and the page refuses to post then. */
  exchangeRate: number | null
  supplierReference: string
  /** Invoices only: the exporter's reference and the supplier's commercial invoice number. */
  exporterReference: string
  commercialInvoiceNo: string
  /** Invoices only: '1' stock on posting, '2' stock on container offload. */
  receiptMode: '1' | '2'
  notes: string
}

export type PurchaseHeaderErrors = Partial<Record<keyof PurchaseHeader, string>>

/** The document this one was made from, shown as a chip the reader can follow. */
export interface PurchaseSourceChip {
  id: number
  documentNumber: string | null
  documentTypeCode: string
}

interface PurchaseHeaderCardProps {
  kind: PurchaseKind
  value: PurchaseHeader
  onChange: (patch: Partial<PurchaseHeader>) => void
  branches: BranchLookupDto[]
  suppliers: PartyLookupDto[]
  currencies: CurrencyLookupDto[]
  rate: PurchaseRateResolutionDto | null
  rateLoading: boolean
  /** The number, or null while it will be assigned on posting. */
  documentNumber: string | null
  /** True when the type assigns its number on posting rather than on the draft. */
  numberOnPost: boolean
  source: PurchaseSourceChip | null
  /** The shortage plan the order was created from, shown as a chip that links to it. */
  sourceShortage?: { id: number; documentNumber: string | null } | null
  isNew: boolean
  /** Posted, closed and cancelled documents are read: every input becomes text. */
  readOnly: boolean
  errors: PurchaseHeaderErrors
  disabled: boolean
  /** Invoices: why "Shipped in containers" cannot be changed now (lines linked, no purchase order); null = it can. */
  shippedLockedReason?: string | null
  /** An invoice from containers: the exporter reference is required to post (EXPORTER_REFERENCE_REQUIRED). */
  exporterRequired?: boolean
}

/**
 * The top card of a purchase document: who is selling, where it lands, in which currency, at what rate.
 *
 * THE SUPPLIER SETS THE CURRENCY. Picking a supplier pre-fills Currency with the supplier's own
 * (the base currency when it has none) until the reader picks another; the rate then follows the
 * currency, the type and the date, looked up rather than typed unless there is nothing to look up.
 *
 * A DOCUMENT MADE FROM ANOTHER SHOWS ITS SOURCE AS A CHIP and keeps the supplier, branch and
 * warehouse it inherited: the server refuses a different supplier or branch on such a document.
 */
export function PurchaseHeaderCard({
  kind,
  value,
  onChange,
  branches,
  suppliers,
  currencies,
  rate,
  rateLoading,
  documentNumber,
  numberOnPost,
  source,
  sourceShortage = null,
  isNew,
  readOnly,
  errors,
  disabled,
  shippedLockedReason = null,
  exporterRequired = false,
}: PurchaseHeaderCardProps) {
  const isInvoice = kind.code === 'PINV'
  const isBase = rate?.isBaseCurrency === true
  const currency = currencies.find((c) => String(c.id) === value.currencyId)
  const currencyCode = rate?.currencyCode ?? currency?.currencyCode
  const rateMissing = value.currencyId !== null && !rateLoading && rate !== null && !isBase && value.exchangeRate === null
  const fromSource = source !== null

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

  const supplier = suppliers.find((s) => String(s.id) === value.supplierId)
  const dateLabelText = kind.code === 'PO' ? 'Expected Date' : 'Due Date'
  const sourceKind = purchaseKindOf(source?.documentTypeCode)

  return (
    <Paper radius="lg" p="md" withBorder>
      <Group justify="space-between" align="center" mb="sm" wrap="wrap">
        <Title order={5}>{kind.title} Information</Title>
        {sourceShortage && (
          <Badge
            size="lg"
            variant="light"
            color="grape"
            leftSection={<IconLink size={14} />}
            component={Link}
            to={`/inventory/shortages/${sourceShortage.id}`}
            style={{ cursor: 'pointer', textTransform: 'none' }}
            data-source-shortage-chip
          >
            Source: Shortage {sourceShortage.documentNumber ?? `#${sourceShortage.id}`}
          </Badge>
        )}
        {source && (
          <Badge
            size="lg"
            variant="light"
            color={sourceKind?.colour ?? 'gray'}
            leftSection={<IconLink size={14} />}
            component={Link}
            to={routes.purchaseDocument(source.documentTypeCode, source.id)}
            style={{ cursor: 'pointer', textTransform: 'none' }}
            data-source-chip
          >
            From {sourceKind?.title ?? source.documentTypeCode} {source.documentNumber ?? `draft #${source.id}`}
          </Badge>
        )}
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {field(`${kind.title} No.`, documentNumber ?? (numberOnPost && (isNew || !readOnly) ? 'Assigned on posting' : isNew ? 'Assigned on save' : 'DRAFT'))}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {readOnly ? (
            field('Document Date', dateLabel(value.documentDate))
          ) : (
            <DateInput
              label="Document Date"
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
            field(dateLabelText, value.expectedDate ? dateLabel(value.expectedDate) : '')
          ) : (
            <DateInput
              label={dateLabelText}
              placeholder="Optional"
              value={fromIsoDate(value.expectedDate)}
              onChange={(next) => onChange({ expectedDate: next ? isoDate(new Date(next)) : null })}
              error={errors.expectedDate}
              valueFormat="DD/MM/YYYY"
              clearable
              disabled={disabled}
            />
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {readOnly || fromSource ? (
            field('Supplier', supplier ? supplierLabel(supplier) : '')
          ) : (
            <Select
              label="Supplier"
              withAsterisk
              placeholder="Search by code or name"
              data={suppliers.map((s) => ({ value: String(s.id), label: supplierLabel(s) }))}
              value={value.supplierId}
              onChange={(next) => onChange({ supplierId: next })}
              error={errors.supplierId}
              disabled={disabled}
              searchable
              nothingFoundMessage="No supplier matches"
            />
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {readOnly || fromSource ? (
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
            field('Currency', currency ? currencyLabel(currency) : (currencyCode ?? ''))
          ) : (
            <Select
              label="Currency"
              withAsterisk
              placeholder={value.supplierId ? 'Choose a currency' : "The supplier's, once chosen"}
              data={currencies.map((c) => ({ value: String(c.id), label: currencyLabel(c) }))}
              value={value.currencyId}
              onChange={(next) => onChange({ currencyId: next })}
              error={errors.currencyId}
              disabled={disabled}
              searchable
              allowDeselect={false}
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
              disabled={disabled || !value.currencyId || isBase}
              allowDeselect={false}
            />
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {readOnly ? (
            field('Exchange Rate', isBase ? '1 (base currency)' : value.exchangeRate === null ? '' : `${formatNumber(value.exchangeRate, rate?.decimalPlaces ?? 2)} ${currencyCode ?? ''} per ${rate?.baseCurrencyCode ?? 'USD'}`)
          ) : isBase ? (
            <TextInput label="Exchange Rate" value="1 (base currency)" readOnly />
          ) : (
            <NumberInput
              label="Exchange Rate"
              withAsterisk={value.currencyId !== null}
              placeholder={!value.currencyId ? 'Choose a currency first' : rateLoading ? 'Looking up…' : 'Enter a rate'}
              value={value.exchangeRate ?? ''}
              min={0}
              decimalScale={6}
              thousandSeparator=","
              onChange={(next) => {
                const parsed = numberInputValue(next)
                onChange({ exchangeRate: parsed !== null && parsed > 0 ? parsed : null })
              }}
              disabled={disabled || !value.currencyId}
              description={rateDescription}
              error={
                errors.exchangeRate
                ?? (rateMissing
                  ? `No ${salesRateTypeLabel(value.rateType).toLowerCase()} rate is defined for ${currencyCode ?? 'this currency'} on this date — enter one to continue.`
                  : undefined)
              }
            />
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {readOnly ? (
            field('Supplier Reference', value.supplierReference)
          ) : (
            <TextInput
              label="Supplier Reference"
              placeholder="Their invoice or order number"
              value={value.supplierReference}
              onChange={(event) => onChange({ supplierReference: event.currentTarget.value })}
              maxLength={100}
              disabled={disabled}
            />
          )}
        </Grid.Col>

        {isInvoice ? (
          <>
            <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
              {readOnly ? (
                field("Exporter's Ref.", value.exporterReference)
              ) : (
                <TextInput
                  label="Exporter's Ref."
                  withAsterisk={exporterRequired}
                  placeholder="On the exporter's paperwork"
                  value={value.exporterReference}
                  onChange={(event) => onChange({ exporterReference: event.currentTarget.value })}
                  maxLength={50}
                  disabled={disabled}
                  error={errors.exporterReference}
                  data-exporter-reference
                />
              )}
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
              {readOnly ? (
                field('Commercial Invoice No.', value.commercialInvoiceNo)
              ) : (
                <TextInput
                  label="Commercial Invoice No."
                  placeholder="The supplier's invoice number"
                  value={value.commercialInvoiceNo}
                  onChange={(event) => onChange({ commercialInvoiceNo: event.currentTarget.value })}
                  maxLength={50}
                  disabled={disabled}
                />
              )}
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
              {/* THE RECEIPT MODE, CHOSEN (script 43): shipped in containers = stock in at the offload of the
                  containers the invoice is linked to; off = stock in on posting. Locked while containers are linked. */}
              {readOnly ? (
                field('Shipped in containers', value.receiptMode === '2' ? 'Yes - stock in at the container offload' : 'No - stock in on posting')
              ) : (
                <Tooltip label={shippedLockedReason} disabled={!shippedLockedReason} withArrow multiline w={280}>
                  <div>
                    <Switch
                      mt={{ base: 0, lg: 'md' }}
                      label="Shipped in containers"
                      description="The goods enter the stock at the container offload, not when the invoice is posted."
                      checked={value.receiptMode === '2'}
                      disabled={disabled || shippedLockedReason !== null}
                      onChange={(event) => onChange({ receiptMode: event.currentTarget.checked ? '2' : '1' })}
                      data-shipped-in-containers
                    />
                  </div>
                </Tooltip>
              )}
            </Grid.Col>
          </>
        ) : null}

        <Grid.Col span={{ base: 12, lg: isInvoice ? 12 : 9 }}>
          {readOnly ? (
            field('Notes', value.notes)
          ) : (
            <Textarea
              label="Notes"
              placeholder={`Anything worth recording about this ${kind.noun}`}
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

      {source && readOnly === false && (
        <Text fz="xs" c="dimmed" mt="xs">
          Made from {sourceKind?.title.toLowerCase() ?? 'document'}{' '}
          <Anchor component={Link} to={routes.purchaseDocument(source.documentTypeCode, source.id)} fz="xs">
            {source.documentNumber ?? `draft #${source.id}`}
          </Anchor>
          : the supplier and the branch are its own, and each line may take at most what remains on its source line.
        </Text>
      )}
    </Paper>
  )
}
