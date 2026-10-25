import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { ActionIcon, Badge, Box, Group, Menu, Paper, Stack, Table, Text, Title, UnstyledButton } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import {
  IconArrowBackUp,
  IconCalendarTime,
  IconChevronDown,
  IconChevronRight,
  IconDotsVertical,
  IconPrinter,
} from '@tabler/icons-react'
import {
  transferLossReasonLabel,
  transferTrackingApi,
  type TransferPostingDto,
  type TransferPostingLineDto,
} from '../../api/inventory/transfers'
import { dateLabel } from '../documents/documentKind'
import { formatNumber } from '../format'
import { TrackingView } from '../tracking/TrackingView'
import { kindCount } from '../tracking/trackingNumbers'
import { RowActions } from '../ui/RowActions'
import { transferPostingAbilities, type TransferAbility } from './transferAbilities'
import { postingLineTracking, postingTrackingSummary, trackingViewRowsOf, trackingViewTitle } from './transferTracking'
import { LATE_BADGE, postingKindLabel, postingStatusColour, postingStatusLabel } from './transferStatus'

interface TransferPostingsCardProps {
  /** (93) The order: a posting line's serial nos., batches or expiry dates are read from it when shown. */
  orderId: number
  postings: TransferPostingDto[]
  hasPermission(permission: string): boolean
  /** The page holds unsaved changes: a reversal or a new ETA answers with the order as the server holds it. */
  dirty: boolean
  /** The reader may see stock values: the Value column is shown (a null value reads "—"). */
  showValues: boolean
  onReverse(posting: TransferPostingDto): void
  onChangeEta(posting: TransferPostingDto): void
  onPrint(posting: TransferPostingDto): void
}

/**
 * "40 pcs", a receipt "30 received · 1 lost"; (93) + " · 20 serial nos." when its lines carry tracking rows (a phone
 * card; the table says it on a dimmed line of its own, so the Pcs column stays narrow).
 */
function piecesText(posting: TransferPostingDto, withTracking = true): string {
  const tracking = withTracking ? postingTrackingSummary(posting) : ''
  if (posting.kind === 'Dispatch') return `${formatNumber(posting.totalQuantityBase)} pcs${tracking}`
  return `${formatNumber(posting.totalQuantityBase)} received${posting.totalLostBase > 0 ? ` · ${formatNumber(posting.totalLostBase)} lost` : ''}${tracking}`
}

/** "Reversed on 21/10/2026 by Manager One: wrong truck". */
function reversedText(posting: TransferPostingDto): string | null {
  const reversed = posting.reversed
  if (!reversed) return null
  return `Reversed on ${dateLabel(reversed.date)} by ${reversed.byName ?? 'unknown'}: ${reversed.reason}`
}

/** "Posted together with TRR-BR-002-000007": the two halves of a "Dispatch and receive". */
function togetherText(posting: TransferPostingDto, all: TransferPostingDto[]): string | null {
  if (posting.postedWithNumber) return `Posted together with ${posting.postedWithNumber}`
  const partner = all.find((p) => p.postedWithId === posting.id)
  return partner ? `Posted together with ${partner.documentNumber}` : null
}

/* A BADGE KEEPS ITS WORD. In a table cell a badge (overflow hidden) has almost no minimum width, so a narrow column
   cut "Posted" to "Po…" and "Late" to a red dot: it is as wide as its label, the column grows instead. */
const NO_SQUEEZE = { minWidth: 'max-content' } as const

/* THE ACTIONS STAY IN VIEW (the grids' pinLastColumn): twelve columns of a receipt row ("30 received · 1 lost") grow
   past the card at 1440, and Reverse…, Change ETA… and Print dispatch note then needed a sideways scroll. Opaque, so
   the columns scrolling under it do not show through. */
const PINNED = {
  position: 'sticky',
  right: 0,
  zIndex: 1,
  background: 'var(--mantine-color-body)',
  boxShadow: 'inset 1px 0 0 var(--mantine-color-default-border)',
} as const

function lateBadge(posting: TransferPostingDto) {
  if (!posting.isLate) return null
  return (
    <Badge size="sm" color={LATE_BADGE.colour} variant={LATE_BADGE.variant} style={NO_SQUEEZE}>
      {LATE_BADGE.label}
    </Badge>
  )
}

/**
 * "Dispatches and receipts" (2.6.3): every posting of the order, newest first - a dispatch (TRD) takes pieces out of
 * From onto the way, a receipt (TRR) brings them into To. A posting is never edited: it is reversed whole, in place
 * (orange, with who, when and why), a receipt before the dispatch it received.
 *
 * Each row opens onto its lines: the item and its pieces, what was written off with its reason and note, and for a
 * receipt line the dispatch it received. Below 48em one card per posting, its actions in a "⋮" menu with each reason
 * under its label (DocumentActionBar's phone rule).
 */
export function TransferPostingsCard({
  orderId,
  postings,
  hasPermission,
  dirty,
  showValues,
  onReverse,
  onChangeEta,
  onPrint,
}: TransferPostingsCardProps) {
  const phone = useMediaQuery('(max-width: 48em)')
  const [open, setOpen] = useState<Set<number>>(() => new Set())

  const newestFirst = useMemo(
    () => [...postings].sort((a, b) => b.postedAtUtc.localeCompare(a.postedAtUtc) || b.id - a.id),
    [postings],
  )

  function toggle(id: number) {
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const actionsOf = (posting: TransferPostingDto) => {
    const abilities = transferPostingAbilities(posting, hasPermission, dirty)
    const list: {
      key: string
      label: string
      icon: ReactNode
      ability: TransferAbility
      onClick(): void
      colour?: string
    }[] = [
      {
        key: 'reverse',
        label: 'Reverse…',
        icon: <IconArrowBackUp size={16} />,
        ability: abilities.reverse,
        onClick: () => onReverse(posting),
        colour: 'orange',
      },
      {
        key: 'eta',
        label: 'Change ETA…',
        icon: <IconCalendarTime size={16} />,
        ability: abilities.changeEta,
        onClick: () => onChangeEta(posting),
      },
      {
        key: 'print',
        label: 'Print dispatch note',
        icon: <IconPrinter size={16} />,
        ability: abilities.printDispatchNote,
        onClick: () => onPrint(posting),
      },
    ]
    return list.filter((a) => a.ability.visible)
  }

  /**
   * (93) "20 serial nos." / "2 batches" / "1 expiry date" under a line that carries tracking rows: its rows and their
   * state, read when opened (GET …/postings/{postingId}/tracking).
   */
  function trackingLink(posting: TransferPostingDto, line: TransferPostingLineDto) {
    const tracking = postingLineTracking(line)
    if (!tracking) return null
    return (
      <TrackingView
        label={kindCount(tracking.kind, tracking.count)}
        title={trackingViewTitle(posting, line)}
        kind={tracking.kind}
        load={async (signal) =>
          trackingViewRowsOf(await transferTrackingApi.postingRows(orderId, posting.id, false, signal), line.id)
        }
      />
    )
  }

  function linesTable(posting: TransferPostingDto) {
    const receipt = posting.kind === 'Receipt'
    return (
      <Table verticalSpacing={4} fz="sm" withRowBorders={false}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={44}>#</Table.Th>
            <Table.Th>Item</Table.Th>
            <Table.Th ta="right">{receipt ? 'Received (pcs)' : 'Pcs'}</Table.Th>
            {receipt && <Table.Th ta="right">Lost (pcs)</Table.Th>}
            {receipt && <Table.Th>Why lost</Table.Th>}
            {receipt ? <Table.Th>Dispatch</Table.Th> : <Table.Th ta="right">On the way</Table.Th>}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {posting.lines.map((line) => (
            <Table.Tr key={line.id}>
              <Table.Td>{formatNumber(line.lineNumber)}</Table.Td>
              <Table.Td>
                <Text fz="sm" fw={500}>
                  {line.itemCode}
                </Text>
                <Text fz="xs" c="dimmed">
                  {line.itemName}
                </Text>
                {trackingLink(posting, line)}
              </Table.Td>
              <Table.Td ta="right">{formatNumber(line.quantityBase)}</Table.Td>
              {receipt && (
                <Table.Td ta="right">
                  <Text fz="sm" c={line.lostBase > 0 ? 'orange.7' : undefined} fw={line.lostBase > 0 ? 600 : undefined}>
                    {formatNumber(line.lostBase)}
                  </Text>
                </Table.Td>
              )}
              {receipt && (
                <Table.Td>
                  {line.lostBase > 0 ? (
                    <Text fz="sm">
                      {[transferLossReasonLabel(line.lossReasonCode), line.lossNote].filter(Boolean).join(' - ')}
                    </Text>
                  ) : (
                    <Text fz="sm" c="dimmed">
                      —
                    </Text>
                  )}
                </Table.Td>
              )}
              {receipt ? (
                <Table.Td>{line.dispatchNumber ?? '—'}</Table.Td>
              ) : (
                <Table.Td ta="right">{formatNumber(line.onTheWayBase)}</Table.Td>
              )}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    )
  }

  /** The phone's lines: one sentence each. */
  function linesList(posting: TransferPostingDto) {
    return (
      <Stack gap={4} mt="xs">
        {posting.lines.map((line) => (
          <Box key={line.id}>
            <Text fz="xs">
              {line.itemCode} · {formatNumber(line.quantityBase)} pcs
              {line.lostBase > 0
                ? ` · ${formatNumber(line.lostBase)} lost (${[transferLossReasonLabel(line.lossReasonCode), line.lossNote].filter(Boolean).join(' - ')})`
                : ''}
              {line.dispatchNumber ? ` · from ${line.dispatchNumber}` : ''}
            </Text>
            {trackingLink(posting, line)}
          </Box>
        ))}
      </Stack>
    )
  }

  return (
    <Paper radius="lg" p="md" withBorder data-transfer-postings>
      <Title order={5} mb="sm">
        Dispatches and receipts
      </Title>

      {newestFirst.length === 0 ? (
        <Text size="sm" c="dimmed">
          Nothing dispatched yet.
        </Text>
      ) : phone ? (
        <Stack gap="sm">
          {newestFirst.map((posting) => {
            const actions = actionsOf(posting)
            const together = togetherText(posting, postings)
            return (
              <Paper key={posting.id} withBorder radius="md" p="sm">
                <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
                  {/* A button: it opens the lines, says so (the chevron) and is reached with the keyboard. */}
                  <UnstyledButton
                    style={{ minWidth: 0, flex: 1 }}
                    onClick={() => toggle(posting.id)}
                    aria-expanded={open.has(posting.id)}
                    aria-label={
                      open.has(posting.id)
                        ? `Hide the lines of ${posting.documentNumber}`
                        : `Show the lines of ${posting.documentNumber}`
                    }
                  >
                    <Group gap={6} wrap="wrap">
                      {open.has(posting.id) ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                      <Text fz="sm" fw={600} style={{ overflowWrap: 'anywhere' }}>
                        {[
                          posting.documentNumber,
                          postingKindLabel(posting.kind),
                          dateLabel(posting.postingDate),
                          posting.kind === 'Dispatch' && posting.eta ? `ETA ${dateLabel(posting.eta)}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                      {lateBadge(posting)}
                    </Group>
                    <Text fz="sm">
                      {piecesText(posting)}
                      {posting.kind === 'Dispatch' ? ` · ${formatNumber(posting.onTheWayBase)} on the way` : ''}
                    </Text>
                    <Group gap={6} mt={2} wrap="wrap">
                      <Badge size="sm" variant="light" color={postingStatusColour(posting.status)}>
                        {postingStatusLabel(posting.status)}
                      </Badge>
                      {reversedText(posting) && (
                        <Text fz="xs" c="dimmed">
                          {reversedText(posting)}
                        </Text>
                      )}
                    </Group>
                    {together && (
                      <Text fz="xs" c="dimmed">
                        {together}
                      </Text>
                    )}
                  </UnstyledButton>
                  {actions.length > 0 && (
                    <Menu position="bottom-end" withinPortal shadow="md">
                      <Menu.Target>
                        <ActionIcon variant="subtle" aria-label={`Actions for ${posting.documentNumber}`}>
                          <IconDotsVertical size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown maw="calc(100vw - 32px)">
                        {actions.map((action) => {
                          const reason = action.ability.blockedBy
                          return (
                            <Menu.Item
                              key={action.key}
                              leftSection={action.icon}
                              color={action.colour}
                              disabled={reason !== null}
                              onClick={action.onClick}
                              style={reason ? { opacity: 1 } : undefined}
                            >
                              {action.label}
                              {reason ? (
                                <Text
                                  component="span"
                                  display="block"
                                  fz="xs"
                                  c="dimmed"
                                  style={{ whiteSpace: 'normal' }}
                                >
                                  {reason}
                                </Text>
                              ) : null}
                            </Menu.Item>
                          )
                        })}
                      </Menu.Dropdown>
                    </Menu>
                  )}
                </Group>
                {open.has(posting.id) && linesList(posting)}
              </Paper>
            )
          })}
        </Stack>
      ) : (
        <Table.ScrollContainer minWidth={1100}>
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={32} />
                <Table.Th>Number</Table.Th>
                <Table.Th>Kind</Table.Th>
                <Table.Th>Date</Table.Th>
                <Table.Th>ETA</Table.Th>
                <Table.Th ta="right">Pcs</Table.Th>
                <Table.Th ta="right">On the way</Table.Th>
                <Table.Th>Reference</Table.Th>
                <Table.Th>Posted by</Table.Th>
                <Table.Th>Status</Table.Th>
                {showValues && <Table.Th ta="right">Value (USD)</Table.Th>}
                <Table.Th w={120} ta="right" style={PINNED}>
                  Actions
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {newestFirst.map((posting) => {
                const expanded = open.has(posting.id)
                const together = togetherText(posting, postings)
                const actions = actionsOf(posting)
                const columnCount = showValues ? 12 : 11
                return (
                  <Fragment key={posting.id}>
                    <Table.Tr
                      style={{ cursor: 'pointer' }}
                      onClick={() => toggle(posting.id)}
                      data-transfer-posting={posting.documentNumber}
                    >
                      <Table.Td>
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          aria-expanded={expanded}
                          aria-label={
                            expanded
                              ? `Hide the lines of ${posting.documentNumber}`
                              : `Show the lines of ${posting.documentNumber}`
                          }
                          onClick={(event) => {
                            event.stopPropagation()
                            toggle(posting.id)
                          }}
                        >
                          {expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                        </ActionIcon>
                      </Table.Td>
                      <Table.Td>
                        <Text fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>
                          {posting.documentNumber}
                        </Text>
                        {together && (
                          <Text fz="xs" c="dimmed">
                            {together}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>{postingKindLabel(posting.kind)}</Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{dateLabel(posting.postingDate)}</Table.Td>
                      <Table.Td>
                        {posting.kind === 'Dispatch' ? (
                          <Group gap={6} wrap="nowrap">
                            <Text fz="sm" style={{ whiteSpace: 'nowrap' }}>
                              {dateLabel(posting.eta)}
                            </Text>
                            {lateBadge(posting)}
                          </Group>
                        ) : (
                          <Text fz="sm" c="dimmed">
                            —
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text fz="sm" style={{ whiteSpace: 'nowrap' }}>
                          {piecesText(posting, false)}
                        </Text>
                        {postingTrackingSummary(posting) ? (
                          <Text fz="xs" c="dimmed" data-posting-tracking>
                            {postingTrackingSummary(posting).replace(/^ · /, '')}
                          </Text>
                        ) : null}
                      </Table.Td>
                      <Table.Td ta="right">
                        {posting.kind === 'Dispatch' ? (
                          <Text fz="sm" fw={posting.onTheWayBase > 0 ? 600 : undefined}>
                            {formatNumber(posting.onTheWayBase)}
                          </Text>
                        ) : (
                          <Text fz="sm" c="dimmed">
                            —
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>{posting.referenceNo || '—'}</Table.Td>
                      <Table.Td>{posting.postedByName ?? '—'}</Table.Td>
                      <Table.Td>
                        <Badge variant="light" color={postingStatusColour(posting.status)} style={NO_SQUEEZE}>
                          {postingStatusLabel(posting.status)}
                        </Badge>
                        {reversedText(posting) && (
                          <Text fz="xs" c="dimmed" maw={260}>
                            {reversedText(posting)}
                          </Text>
                        )}
                      </Table.Td>
                      {showValues && (
                        <Table.Td ta="right">
                          {posting.valueBase === null ? (
                            <Text fz="sm" c="dimmed">
                              —
                            </Text>
                          ) : (
                            formatNumber(posting.valueBase, 2)
                          )}
                        </Table.Td>
                      )}
                      <Table.Td onClick={(event) => event.stopPropagation()} style={PINNED}>
                        <Group justify="flex-end" wrap="nowrap">
                          <RowActions
                            label={posting.documentNumber}
                            custom={actions.map((action) => ({
                              icon: action.icon,
                              tooltip: action.label,
                              color: action.colour,
                              disabled: action.ability.blockedBy !== null,
                              disabledReason: action.ability.blockedBy ?? undefined,
                              onClick: action.onClick,
                            }))}
                          />
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                    {expanded && (
                      <Table.Tr>
                        <Table.Td colSpan={columnCount} bg="var(--mantine-color-gray-0)">
                          {posting.notes ? (
                            <Text fz="xs" c="dimmed" mb={4}>
                              Notes: {posting.notes}
                            </Text>
                          ) : null}
                          {linesTable(posting)}
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Fragment>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Paper>
  )
}
