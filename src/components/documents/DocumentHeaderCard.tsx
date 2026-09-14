import { Grid, Paper, Select, Text, Textarea, TextInput, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import type { StockReasonDto } from '../../api/inventory/stockDocuments'
import { fromIsoDate, isoDate } from './documentKind'

/** What the header holds. The page owns the state; this only draws and reports changes. */
export interface DocumentHeaderValue {
  branchId: string | null
  warehouseId: string | null
  documentDate: string
  reasonId: string | null
  referenceNo: string
  notes: string
}

interface Option {
  value: string
  label: string
}

interface DocumentHeaderCardProps {
  value: DocumentHeaderValue
  onChange: (patch: Partial<DocumentHeaderValue>) => void
  branches: Option[]
  warehouses: Option[]
  reasons: StockReasonDto[]
  /** Required when the document type says so; the asterisk and the validation follow this. */
  reasonRequired: boolean
  /** The number, or the sentence explaining when one will exist. */
  documentNumber: string | null
  numberOnPost: boolean
  isNew: boolean
  currencyCode: string
  /** Posted and cancelled documents are read: every input becomes text. */
  readOnly: boolean
  errors: Partial<Record<keyof DocumentHeaderValue, string>>
}

/**
 * The top card of every document: what it is, where it happened, and why.
 *
 * FIVE COLUMNS THAT COLLAPSE, not a fixed grid. On a laptop the whole header is one glance; at
 * 390 px it stacks, because a five-column form on a phone is five illegible columns.
 *
 * READ-ONLY IS TEXT, NOT DISABLED INPUTS. A posted document is a record, and a form full of greyed
 * boxes reads as one somebody has been locked out of rather than one that is finished. Disabled
 * inputs are also skipped by keyboard navigation, so the values become unreachable to a screen
 * reader that would happily have read them as text.
 */
export function DocumentHeaderCard({
  value,
  onChange,
  branches,
  warehouses,
  reasons,
  reasonRequired,
  documentNumber,
  numberOnPost,
  isNew,
  currencyCode,
  readOnly,
  errors,
}: DocumentHeaderCardProps) {
  const numberText = documentNumber
    ?? (isNew ? (numberOnPost ? 'Assigned on posting' : 'Assigned on save') : 'DRAFT')

  const reasonOptions = reasons.map((r) => ({ value: String(r.id), label: r.reasonName }))

  const field = (label: string, text: string) => (
    <div>
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text fw={500}>{text || '—'}</Text>
    </div>
  )

  return (
    <Paper radius="lg" p="md" withBorder>
      <Title order={5} mb="sm">
        Document Information
      </Title>

      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, lg: 'auto' }}>
          {field('Document No.', numberText)}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 'auto' }}>
          {readOnly ? (
            field('Branch', branches.find((b) => b.value === value.branchId)?.label ?? '')
          ) : (
            <Select
              label="Branch"
              withAsterisk
              placeholder="Choose a branch"
              data={branches}
              value={value.branchId}
              // Changing the branch invalidates the warehouse under it, so both move together.
              onChange={(next) => onChange({ branchId: next, warehouseId: null })}
              error={errors.branchId}
              searchable
            />
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 'auto' }}>
          {readOnly ? (
            field('Warehouse', warehouses.find((w) => w.value === value.warehouseId)?.label ?? '')
          ) : (
            <Select
              // THE document's warehouse, not a default: one document holds one warehouse and every
              // line takes this one. A file naming several becomes several documents.
              label="Warehouse"
              withAsterisk
              placeholder={value.branchId ? 'Choose a warehouse' : 'Choose a branch first'}
              data={warehouses}
              value={value.warehouseId}
              onChange={(next) => onChange({ warehouseId: next })}
              disabled={!value.branchId}
              /* A BRANCH WITH NO WAREHOUSES IS A REAL STATE and it has to say so. An empty dropdown
                 under a required field reads as a page that failed to load, and the reader retries
                 instead of picking another branch — which is the only thing that would help. */
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

        <Grid.Col span={{ base: 12, sm: 6, lg: 'auto' }}>
          {readOnly ? (
            field('Document Date', value.documentDate)
          ) : (
            <DateInput
              label="Document Date"
              withAsterisk
              value={fromIsoDate(value.documentDate)}
              // A document cannot be dated into the future: the stock it moves has not moved yet.
              maxDate={new Date()}
              onChange={(next) => onChange({ documentDate: next ? isoDate(new Date(next)) : '' })}
              error={errors.documentDate}
              valueFormat="DD/MM/YYYY"
            />
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 'auto' }}>
          {readOnly ? (
            field('Reason', reasons.find((r) => String(r.id) === value.reasonId)?.reasonName ?? '')
          ) : (
            <Select
              label="Reason"
              withAsterisk={reasonRequired}
              placeholder="Choose a reason"
              data={reasonOptions}
              value={value.reasonId}
              onChange={(next) => onChange({ reasonId: next })}
              error={errors.reasonId}
              searchable
            />
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 'auto' }}>
          {readOnly ? (
            field('Reference No.', value.referenceNo)
          ) : (
            <TextInput
              label="Reference No."
              placeholder="Delivery note, count sheet…"
              value={value.referenceNo}
              onChange={(event) => onChange({ referenceNo: event.currentTarget.value })}
              maxLength={100}
            />
          )}
        </Grid.Col>

        {/* Read-only always: the base currency is what the ledger stores costs in, and offering a
            choice would imply a conversion this document does not do. */}
        <Grid.Col span={{ base: 12, sm: 6, lg: 'auto' }}>
          {field('Currency', `${currencyCode} - US Dollar`)}
        </Grid.Col>

        <Grid.Col span={12}>
          {readOnly ? (
            field('Notes', value.notes)
          ) : (
            <Textarea
              label="Notes"
              placeholder="Anything worth recording about this document"
              value={value.notes}
              onChange={(event) => onChange({ notes: event.currentTarget.value })}
              maxLength={1000}
              autosize
              minRows={2}
            />
          )}
        </Grid.Col>
      </Grid>
    </Paper>
  )
}
