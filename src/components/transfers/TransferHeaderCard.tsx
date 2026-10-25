import type { ReactNode } from 'react'
import {
  Anchor,
  Badge,
  Button,
  Grid,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { Link } from 'react-router'
import type { TransferOrderDto } from '../../api/inventory/transfers'
import { routes } from '../../routes'
import { DocumentIcons } from '../documents/documentIcons'
import { dateLabel, fromIsoDate, isoDate } from '../documents/documentKind'
import type { TransferAbility } from './transferAbilities'
import { returnLabel, WAREHOUSES_HINT, warehouseBranch, warehouseText, type WarehouseGroup } from './transferModel'
import {
  LATE_BADGE,
  LOST_BADGE_COLOUR,
  lostBadgeLabel,
  transferStatusColour,
  transferStatusLabel,
} from './transferStatus'

/** The header as it is edited: ids as Select strings, dates as yyyy-MM-dd, text as typed. */
export interface TransferHeaderValue {
  documentDate: string
  fromWarehouseId: string | null
  toWarehouseId: string | null
  expectedArrival: string | null
  referenceNo: string
  notes: string
}

export type TransferHeaderErrors = Partial<Record<keyof TransferHeaderValue, string>>

interface TransferHeaderCardProps {
  value: TransferHeaderValue
  onChange(patch: Partial<TransferHeaderValue>): void
  /** Null on a new order. */
  order: TransferOrderDto | null
  /** The TRO type numbers at release ("Assigned on release") rather than at the first save. */
  numberOnPost: boolean
  /** A draft the reader may change: every field. */
  draftEditable: boolean
  /** No longer a draft (rule T9): Expected arrival and Reference No. through "Save details". */
  detailsEditable: boolean
  /** The Notes of an order that is no longer a draft. */
  notesEditable: boolean
  /** Why Expected arrival and Reference No. are read-only on a received, closed or cancelled order (the server's words). */
  detailsReason: string | null
  /** "Save details" (PUT …/details), on an order that is no longer a draft; null on a draft. */
  saveDetails: TransferAbility | null
  onSaveDetails(): void
  savingDetails?: boolean
  /** From and To: leaves of every branch, grouped, the order's branch first (transferWarehouseChoices). */
  warehouseData: WarehouseGroup[]
  errors: TransferHeaderErrors
  disabled?: boolean
}

function field(label: string, value: ReactNode, below?: ReactNode, dimmed = false) {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" fw={500} c={dimmed ? 'dimmed' : undefined} style={{ overflowWrap: 'anywhere' }}>
        {value}
      </Text>
      {below}
    </Stack>
  )
}

/**
 * The order's header (2.6.3): number, order date, From and To, Expected arrival, Reference No., Notes, with the shown
 * status, the Late and lost badges beside the number and the links between an order and its returns under it.
 *
 * THE WAREHOUSES ARE THE DOCUMENT'S, unlike every other document of the application (where they are a line's): every
 * line leaves From and goes to To, so the two pickers live here and the lines have none.
 *
 * WHAT CAN STILL CHANGE IS RULE T9's. A draft: everything. Released: Expected arrival, Reference No. and Notes, kept with
 * "Save details". Received, closed or cancelled: the Notes only - the other two are text, with the server's reason.
 * Waiting for approval: nothing (the server's reason sits on "Save details").
 */
export function TransferHeaderCard({
  value,
  onChange,
  order,
  numberOnPost,
  draftEditable,
  detailsEditable,
  notesEditable,
  detailsReason,
  saveDetails,
  onSaveDetails,
  savingDetails,
  warehouseData,
  errors,
  disabled,
}: TransferHeaderCardProps) {
  const lost = order ? lostBadgeLabel(order.totals.lostBase) : null
  const numberText = order?.documentNumber ?? (numberOnPost ? 'Assigned on release' : 'Assigned on the first save')

  const numberBlock = (
    <Stack gap={4}>
      <Text size="xs" c="dimmed">
        Number
      </Text>
      <Group gap={6} wrap="wrap">
        <Text size="sm" fw={600} c={order?.documentNumber ? undefined : 'dimmed'} style={{ whiteSpace: 'nowrap' }}>
          {numberText}
        </Text>
        {order && (
          <Badge variant="light" color={transferStatusColour(order.displayStatus)} data-transfer-status>
            {transferStatusLabel(order.displayStatus)}
          </Badge>
        )}
        {order?.isLate && (
          <Badge color={LATE_BADGE.colour} variant={LATE_BADGE.variant} data-transfer-late>
            {LATE_BADGE.label}
          </Badge>
        )}
        {lost && (
          <Badge color={LOST_BADGE_COLOUR} variant="light" style={{ textTransform: 'none' }}>
            {lost}
          </Badge>
        )}
      </Group>
      {order?.returnOf && (
        <Text size="sm">
          Return of{' '}
          <Anchor component={Link} to={routes.transferOrder(order.returnOf.id)} size="sm">
            {order.returnOf.documentNumber ?? `#${order.returnOf.id}`}
          </Anchor>
        </Text>
      )}
      {order && order.returns.length > 0 && (
        <Text size="sm">
          Returns:{' '}
          {order.returns.map((link, index) => (
            <span key={link.id}>
              {index > 0 ? ', ' : ''}
              <Anchor component={Link} to={routes.transferOrder(link.id)} size="sm">
                {returnLabel(link)}
              </Anchor>
            </span>
          ))}
        </Text>
      )}
    </Stack>
  )

  const warehouseField = (
    label: string,
    which: 'fromWarehouseId' | 'toWarehouseId',
    ref: TransferOrderDto['from'] | undefined,
  ) =>
    draftEditable ? (
      <Select
        label={label}
        withAsterisk
        placeholder="Choose the warehouse"
        data={warehouseData}
        value={value[which]}
        onChange={(next) => onChange({ [which]: next } as Partial<TransferHeaderValue>)}
        searchable
        nothingFoundMessage="No warehouse matches"
        error={errors[which]}
        disabled={disabled}
        comboboxProps={{ withinPortal: true }}
      />
    ) : (
      field(
        label,
        warehouseText(ref),
        warehouseBranch(ref) ? (
          <Text size="xs" c="dimmed">
            {warehouseBranch(ref)}
          </Text>
        ) : undefined,
      )
    )

  const expectedEditable = draftEditable || detailsEditable
  const notesOpen = draftEditable || notesEditable

  return (
    <Paper radius="lg" p="md" withBorder>
      <Group justify="space-between" align="center" mb="sm" wrap="wrap" gap="xs">
        <Title order={5}>Transfer Order</Title>
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, lg: 4 }}>{numberBlock}</Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 2 }}>
          {draftEditable ? (
            <DateInput
              label="Order date"
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
            field('Order date', dateLabel(value.documentDate))
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>{warehouseField('From', 'fromWarehouseId', order?.from)}</Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>{warehouseField('To', 'toWarehouseId', order?.to)}</Grid.Col>

        {draftEditable && (
          <Grid.Col span={12} pt={0}>
            <Text size="xs" c="dimmed">
              {WAREHOUSES_HINT}
            </Text>
          </Grid.Col>
        )}

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {expectedEditable ? (
            <DateInput
              label="Expected arrival"
              valueFormat="DD/MM/YYYY"
              value={fromIsoDate(value.expectedArrival)}
              onChange={(next) => onChange({ expectedArrival: next ? isoDate(next) : null })}
              minDate={fromIsoDate(value.documentDate) ?? undefined}
              clearable
              error={errors.expectedArrival}
              disabled={disabled}
            />
          ) : (
            field('Expected arrival', dateLabel(value.expectedArrival))
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 5 }}>
          {expectedEditable ? (
            <TextInput
              label="Reference No."
              placeholder="Request no., truck..."
              value={value.referenceNo}
              onChange={(event) => onChange({ referenceNo: event.currentTarget.value })}
              maxLength={100}
              error={errors.referenceNo}
              disabled={disabled}
            />
          ) : (
            field('Reference No.', value.referenceNo || '—')
          )}
        </Grid.Col>

        {!draftEditable && !expectedEditable && detailsReason && (
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Text size="xs" c="dimmed" pt={{ lg: 'md' }} data-details-reason>
              {detailsReason}
            </Text>
          </Grid.Col>
        )}

        <Grid.Col span={12}>
          {notesOpen ? (
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

      {/* RULE T9 ON A RELEASED ORDER: its details are kept on their own, the lines and warehouses stay as they are. */}
      {saveDetails?.visible && (
        <Group justify="flex-end" mt="sm">
          {saveDetails.blockedBy ? (
            // data-disabled rather than disabled: a disabled button swallows the hover the tooltip needs.
            <Tooltip label={saveDetails.blockedBy} withArrow multiline w={280}>
              <Button
                variant="default"
                leftSection={DocumentIcons.save}
                data-disabled
                aria-disabled
                onClick={(event) => event.preventDefault()}
              >
                Save details
              </Button>
            </Tooltip>
          ) : (
            <Button
              variant="default"
              leftSection={DocumentIcons.save}
              loading={savingDetails}
              onClick={onSaveDetails}
              data-save-details
            >
              Save details
            </Button>
          )}
        </Group>
      )}
      {saveDetails?.visible && saveDetails.blockedBy && (
        // A phone shows no tooltip: the reason is a line of its own under the button.
        <Text size="xs" c="dimmed" ta="right" mt={4} hiddenFrom="sm">
          {saveDetails.blockedBy}
        </Text>
      )}
    </Paper>
  )
}
