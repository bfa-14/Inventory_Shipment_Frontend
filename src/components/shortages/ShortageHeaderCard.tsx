import { Badge, Grid, Group, NumberInput, Paper, Select, Text, Textarea, TextInput, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import type { BranchLookupDto, PartyLookupDto, WarehouseLookupDto } from '../../api/types'
import { dateLabel, fromIsoDate, isoDate, stamp } from '../documents/documentKind'
import { formatNumber, numberInputValue } from '../format'
import { supplierLabel } from '../purchase/purchaseKind'
import { SHORTAGE_STATUS_COLOURS } from './shortageMath'
import { warehouseOptions } from '../../pages/inventory/lookups'

/** What the plan's header holds. The page owns the state; this card draws it and reports changes. */
export interface ShortageHeader {
  description: string
  documentDate: string
  /** The warehouse the quantities are computed in. */
  warehouseId: string | null
  /** The branch of the purchase order the plan becomes. */
  branchId: string | null
  supplierId: string | null
  /** "Lead Time (Month)" — decimals allowed. */
  leadTimeMonths: number | null
  monthsOfHistory: number | null
  notes: string
}

export type ShortageHeaderErrors = Partial<Record<keyof ShortageHeader, string>>

interface ShortageHeaderCardProps {
  value: ShortageHeader
  onChange: (patch: Partial<ShortageHeader>) => void
  branches: BranchLookupDto[]
  warehouses: WarehouseLookupDto[]
  suppliers: PartyLookupDto[]
  /** Null on a plan that was never saved: the number is assigned by the first save. */
  documentNumber: string | null
  status: string
  createdByName: string | null
  createdAtUtc: string | null
  /** Posted plans, and drafts opened by somebody who may not edit them: every input becomes text. */
  readOnly: boolean
  errors: ShortageHeaderErrors
  disabled: boolean
}

/**
 * The top card of a shortage plan: what it is for, where the quantities are counted, who will be
 * ordered from and how far ahead the plan looks.
 *
 * TWO PLACES, ON PURPOSE. The WAREHOUSE is where stock, transit, open orders and sales are
 * counted; the BRANCH is whose purchase order the plan becomes. They usually go together — picking
 * a warehouse pre-fills its branch — but a central buyer planning for another branch's warehouse
 * is exactly the case where they differ.
 */
export function ShortageHeaderCard({
  value,
  onChange,
  branches,
  warehouses,
  suppliers,
  documentNumber,
  status,
  createdByName,
  createdAtUtc,
  readOnly,
  errors,
  disabled,
}: ShortageHeaderCardProps) {
  const field = (label: string, text: string) => (
    <div>
      <Text size="sm" c="dimmed">{label}</Text>
      <Text fw={500} style={{ overflowWrap: 'anywhere' }}>{text || '—'}</Text>
    </div>
  )

  const warehouse = warehouses.find((w) => String(w.id) === value.warehouseId)
  const branch = branches.find((b) => String(b.id) === value.branchId)
  const supplier = suppliers.find((s) => String(s.id) === value.supplierId)
  const months = value.monthsOfHistory ?? 3

  return (
    <Paper radius="lg" p="md" withBorder>
      <Group justify="space-between" align="center" mb="sm" wrap="wrap">
        <Title order={5}>Shortage Plan</Title>
        <Badge size="lg" variant="light" color={SHORTAGE_STATUS_COLOURS[status] ?? 'gray'} data-shortage-status>{status}</Badge>
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>{field('Shortage No.', documentNumber ?? 'Assigned on save')}</Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 5 }}>
          {readOnly ? (
            field('Description', value.description)
          ) : (
            <TextInput
              label="Description"
              withAsterisk
              placeholder="What this plan is for, e.g. Q4 replenishment"
              value={value.description}
              onChange={(event) => onChange({ description: event.currentTarget.value })}
              error={errors.description}
              maxLength={200}
              disabled={disabled}
              data-autofocus
              autoFocus
            />
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 6, sm: 6, lg: 2 }}>{field('Created By', createdByName ?? '')}</Grid.Col>
        <Grid.Col span={{ base: 6, sm: 6, lg: 2 }}>{field('Created On', createdAtUtc ? stamp(createdAtUtc) : 'On save')}</Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {readOnly ? (
            field('Date', dateLabel(value.documentDate))
          ) : (
            <DateInput
              label="Date"
              withAsterisk
              value={fromIsoDate(value.documentDate)}
              onChange={(next) => onChange({ documentDate: next ? isoDate(new Date(next)) : '' })}
              error={errors.documentDate}
              valueFormat="DD/MM/YYYY"
              disabled={disabled}
            />
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {readOnly ? (
            field('Warehouse', warehouse?.warehouseName ?? '')
          ) : (
            <Select
              label="Warehouse"
              withAsterisk
              description="Where the quantities are counted - a parent counts every warehouse under it"
              placeholder="Choose a warehouse"
              /* The tree, parents included: a plan for a parent warehouse covers its whole tree. */
              data={warehouseOptions(warehouses, { keepId: value.warehouseId ? Number(value.warehouseId) : null })}
              value={value.warehouseId}
              onChange={(next) => onChange({ warehouseId: next })}
              error={errors.warehouseId}
              disabled={disabled}
              searchable
              nothingFoundMessage="No warehouse matches"
            />
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {readOnly ? (
            field('Branch', branch?.branchName ?? '')
          ) : (
            <Select
              label="Branch"
              withAsterisk
              description="Whose purchase order it becomes"
              placeholder="Choose a branch"
              data={branches.map((b) => ({ value: String(b.id), label: b.branchName }))}
              value={value.branchId}
              onChange={(next) => onChange({ branchId: next })}
              error={errors.branchId}
              disabled={disabled}
              searchable
              nothingFoundMessage="No branch matches"
            />
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {readOnly ? (
            field('Supplier', supplier ? supplierLabel(supplier) : '')
          ) : (
            <Select
              label="Supplier"
              withAsterisk
              description="Who the purchase order is raised on"
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
          {readOnly ? (
            field('Lead Time (Month)', value.leadTimeMonths === null ? '' : formatNumber(value.leadTimeMonths, Number.isInteger(value.leadTimeMonths) ? 0 : 2))
          ) : (
            <NumberInput
              label="Lead Time (Month)"
              withAsterisk
              description="Expected Requirement = monthly sales × this"
              value={value.leadTimeMonths ?? ''}
              min={0}
              max={9999}
              decimalScale={2}
              allowNegative={false}
              onChange={(next) => onChange({ leadTimeMonths: numberInputValue(next) })}
              error={errors.leadTimeMonths}
              disabled={disabled}
            />
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {readOnly ? (
            field('Months of history', value.monthsOfHistory === null ? '' : formatNumber(value.monthsOfHistory))
          ) : (
            <NumberInput
              label="Months of history"
              description={`Expected Monthly Sales = sales of the last ${months} month${months === 1 ? '' : 's'} ÷ ${months}`}
              value={value.monthsOfHistory ?? ''}
              min={1}
              max={36}
              step={1}
              allowDecimal={false}
              allowNegative={false}
              clampBehavior="strict"
              onChange={(next) => onChange({ monthsOfHistory: numberInputValue(next) })}
              error={errors.monthsOfHistory}
              disabled={disabled}
            />
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 6 }}>
          {readOnly ? (
            field('Notes', value.notes)
          ) : (
            <Textarea
              label="Notes"
              placeholder="Anything worth recording about this plan"
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
