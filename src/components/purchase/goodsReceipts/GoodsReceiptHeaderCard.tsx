import type { ReactNode } from 'react'
import { Badge, Grid, Group, Paper, Select, Stack, Text, Textarea, TextInput, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconLink } from '@tabler/icons-react'
import { Link } from 'react-router'
import type { GoodsReceiptDto, GoodsReceiptSourceKind } from '../../../api/purchase/goodsReceipts'
import type { BranchLookupDto, PartyLookupDto } from '../../../api/types'
import { useAuth } from '../../../auth/useAuth'
import { PERMISSIONS } from '../../../navigation'
import { routes } from '../../../routes'
import { dateLabel, fromIsoDate, isoDate } from '../../documents/documentKind'
import { branchLabel } from '../../format'
import { partyLabel } from '../../sales/salesLines'
import { SEVERAL_SUPPLIERS, supplierText, type WarehouseGroup } from './goodsReceiptModel'
import { notYoursNote } from '../../documents/lineWarehouses'

/** The header as it is edited: ids as Select strings, text as typed. */
export interface GoodsReceiptHeaderValue {
  documentDate: string
  branchId: string | null
  warehouseId: string | null
  supplierId: string | null
  supplierReference: string
  notes: string
}

export type GoodsReceiptHeaderErrors = Partial<Record<keyof GoodsReceiptHeaderValue, string>>

interface GoodsReceiptHeaderCardProps {
  value: GoodsReceiptHeaderValue
  onChange(patch: Partial<GoodsReceiptHeaderValue>): void
  /** Null on a new receipt (one without an order, typed on this page). */
  receipt: GoodsReceiptDto | null
  sourceKind: GoodsReceiptSourceKind
  /** A draft the reader may change. Posted and cancelled receipts are text. */
  editable: boolean
  branches: BranchLookupDto[]
  suppliers: PartyLookupDto[]
  /** "Receive into": warehouses at the bottom of the tree - of the container's branch for a container, of any branch (the
      receipt's first) otherwise (scripts 70, 72). */
  warehouseData: WarehouseGroup[]
  errors: GoodsReceiptHeaderErrors
  disabled?: boolean
}

function field(label: string, value: ReactNode, dimmed = false) {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" fw={500} c={dimmed ? 'dimmed' : undefined} style={{ overflowWrap: 'anywhere' }}>
        {value}
      </Text>
    </Stack>
  )
}

/**
 * Where the goods came from and where they go: number, date received, branch, "Receive into", supplier, the supplier's
 * delivery note and notes, with the source as chips (container, order, invoice, movement).
 *
 * THE SOURCE FIXES THE BRANCH AND THE SUPPLIER. Only a receipt without an order lets them be chosen; a container's,
 * an order's or an invoice's are theirs. A chip is a link only for a reader who may open what it points to.
 */
export function GoodsReceiptHeaderCard({
  value,
  onChange,
  receipt,
  sourceKind,
  editable,
  branches,
  suppliers,
  warehouseData,
  errors,
  disabled,
}: GoodsReceiptHeaderCardProps) {
  const { hasPermission } = useAuth()
  const manual = sourceKind === 'Manual'
  const isContainer = sourceKind === 'Container'

  const chips: { key: string; label: string; to: string | null; colour: string }[] = []
  if (receipt?.containerId) {
    chips.push({
      key: 'container',
      label: `Container ${receipt.containerRef ?? `#${receipt.containerId}`}`,
      to: hasPermission(PERMISSIONS.containersView) ? routes.container(receipt.containerId) : null,
      colour: 'indigo',
    })
  }
  if (receipt?.purchaseOrderId) {
    chips.push({
      key: 'order',
      label: `Order ${receipt.purchaseOrderNumber ?? `#${receipt.purchaseOrderId}`}`,
      to: hasPermission(PERMISSIONS.purchaseOrdersView) ? routes.purchaseOrder(receipt.purchaseOrderId) : null,
      colour: 'blue',
    })
  }
  if (receipt?.purchaseInvoiceId) {
    chips.push({
      key: 'invoice',
      label: `Invoice ${receipt.purchaseInvoiceNumber ?? `#${receipt.purchaseInvoiceId}`}`,
      to: hasPermission(PERMISSIONS.purchaseInvoicesView) ? routes.purchaseInvoice(receipt.purchaseInvoiceId) : null,
      colour: 'green',
    })
  }
  if (receipt?.movementId) {
    chips.push({
      key: 'movement',
      label: `Movement ${receipt.movementNo ?? `#${receipt.movementId}`}`,
      to: hasPermission(PERMISSIONS.containersView) ? routes.movement(receipt.movementId) : null,
      colour: 'cyan',
    })
  }

  const branchData = branches.map((b) => ({ value: String(b.id), label: branchLabel(b) }))
  const supplierData = suppliers.map((s) => ({ value: String(s.id), label: `${partyLabel(s)}${s.isActive ? '' : ' (inactive)'}` }))
  const warehouseText = receipt?.warehouseCode ? `${receipt.warehouseCode} - ${receipt.warehouseName ?? ''}` : null

  return (
    <Paper radius="lg" p="md" withBorder>
      <Group justify="space-between" align="center" mb="sm" wrap="wrap" gap="xs">
        <Title order={5}>Goods Receipt</Title>
        <Group gap={6} wrap="wrap">
          {receipt?.isAuto && (
            <Badge variant="light" color="violet">
              Auto
            </Badge>
          )}
          {manual && (
            <Badge variant="light" color="gray" style={{ textTransform: 'none' }}>
              Without an order
            </Badge>
          )}
          {chips.map((chip) =>
            chip.to ? (
              <Badge
                key={chip.key}
                size="lg"
                variant="light"
                color={chip.colour}
                leftSection={<IconLink size={14} />}
                component={Link}
                to={chip.to}
                style={{ cursor: 'pointer', textTransform: 'none' }}
                data-source-chip={chip.key}
              >
                {chip.label}
              </Badge>
            ) : (
              <Badge key={chip.key} size="lg" variant="light" color={chip.colour} style={{ textTransform: 'none' }} data-source-chip={chip.key}>
                {chip.label}
              </Badge>
            ),
          )}
        </Group>
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {field('Goods Receipt No.', receipt?.documentNumber ?? 'Assigned on posting', !receipt?.documentNumber)}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {editable ? (
            <DateInput
              label="Date received"
              withAsterisk
              valueFormat="DD/MM/YYYY"
              value={fromIsoDate(value.documentDate)}
              // 'YYYY-MM-DD' as the field hands it over (typed or picked), never rebuilt through new Date().
              onChange={(next) => onChange({ documentDate: next ? isoDate(next) : '' })}
              maxDate={new Date()}
              error={errors.documentDate}
              disabled={disabled}
            />
          ) : (
            field('Date received', dateLabel(value.documentDate))
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {editable && manual ? (
            <Select
              label="Branch"
              withAsterisk
              data={branchData}
              value={value.branchId}
              onChange={(next) => onChange({ branchId: next })}
              searchable
              nothingFoundMessage="No branch matches"
              error={errors.branchId}
              disabled={disabled}
            />
          ) : (
            field('Branch', receipt ? `${receipt.branchCode ? `${receipt.branchCode} - ` : ''}${receipt.branchName}` : '—')
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {editable ? (
            <Select
              label="Receive into"
              withAsterisk={isContainer}
              placeholder={isContainer ? 'Choose the warehouse' : 'Every line'}
              description={isContainer ? undefined : 'Sets the warehouse of every line; a line can choose another.'}
              data={warehouseData}
              value={value.warehouseId}
              onChange={(next) => onChange({ warehouseId: next })}
              searchable
              clearable={!isContainer}
              nothingFoundMessage="No warehouse matches"
              error={errors.warehouseId ?? notYoursNote(warehouseData, value.warehouseId)}
              disabled={disabled}
            />
          ) : (
            field('Receive into', warehouseText ?? '—')
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 6 }}>
          {editable && manual ? (
            <Select
              label="Supplier"
              withAsterisk
              placeholder="Choose the supplier"
              data={supplierData}
              value={value.supplierId}
              onChange={(next) => onChange({ supplierId: next })}
              searchable
              nothingFoundMessage="No supplier matches"
              error={errors.supplierId}
              disabled={disabled}
            />
          ) : (
            field('Supplier', receipt ? supplierText(receipt) : SEVERAL_SUPPLIERS)
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 6 }}>
          {editable ? (
            <TextInput
              label="Delivery note no."
              placeholder="The supplier's delivery note"
              value={value.supplierReference}
              onChange={(event) => onChange({ supplierReference: event.currentTarget.value })}
              maxLength={100}
              error={errors.supplierReference}
              disabled={disabled}
            />
          ) : (
            field('Delivery note no.', value.supplierReference || '—')
          )}
        </Grid.Col>

        <Grid.Col span={12}>
          {editable ? (
            <Textarea
              label="Notes"
              autosize
              minRows={2}
              maxLength={1000}
              value={value.notes}
              onChange={(event) => onChange({ notes: event.currentTarget.value })}
              disabled={disabled}
            />
          ) : (
            field('Notes', value.notes || '—')
          )}
        </Grid.Col>
      </Grid>
    </Paper>
  )
}
