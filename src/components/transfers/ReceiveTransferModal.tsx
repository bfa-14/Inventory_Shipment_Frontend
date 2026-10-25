import { useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Box,
  Group,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useMediaQuery } from '@mantine/hooks'
import { ApiError } from '../../api/http'
import {
  TRANSFER_LOSS_REASONS,
  transfersApi,
  type TransferLossReasonCode,
  type TransferOrderDto,
  type TransferPostedResult,
  type TransferPostingDto,
  type TransferPostingLineDto,
} from '../../api/inventory/transfers'
import { dateLabel, fromIsoDate, isoDate } from '../documents/documentKind'
import { formatNumber, numberInputValue, todayDateOnly } from '../format'
import { FormModal } from '../ui/FormModal'
import { notify } from '../ui/notify'
import { useCalendarEscape } from '../ui/useCalendarEscape'
import { orderLabel } from './transferModel'
import { LATE_BADGE } from './transferStatus'

interface ReceiveTransferModalProps {
  opened: boolean
  order: TransferOrderDto
  onClose(): void
  /** Posted: the order as the server holds it now. */
  onPosted(result: TransferPostedResult): void
  /** Refused because someone else changed the order: the page reads it again. */
  onStale(): void
}

/** What the rest of a line is when fewer arrive: still coming, or written off as lost (rule T18). */
type RestMode = 'coming' | 'lost'

interface RowState {
  received: number
  rest: RestMode
  reason: TransferLossReasonCode | null
  note: string
}

const NO_ROW: RowState = { received: 0, rest: 'coming', reason: null, note: '' }

const REASON_DATA = TRANSFER_LOSS_REASONS.map((r) => ({ value: r.value, label: r.label }))

/** One dispatch with goods on the way, and its lines that still have some. */
interface DispatchGroup {
  posting: TransferPostingDto
  lines: TransferPostingLineDto[]
}

/**
 * "Receive - {No}" (2.6.4): the goods that arrived at To, from the dispatches still on the way (a TRR, numbered by To's
 * branch). Each line starts at its On the way and may be lowered; the rest is "Still coming" or, with a reason,
 * "Nothing more will arrive" - written off from On the way at the average cost (rule T18).
 *
 * One receipt may take lines of several dispatches (decision D4): one truck can bring two. Posted directly; the limits
 * are the server's (62012 above what is on the way) and a refusal is shown here as it comes.
 */
export function ReceiveTransferModal({ opened, order, onClose, onPosted, onStale }: ReceiveTransferModalProps) {
  const phone = useMediaQuery('(max-width: 48em)')
  const label = orderLabel(order)

  const groups = useMemo<DispatchGroup[]>(
    () =>
      order.postings
        .filter((p) => p.kind === 'Dispatch' && p.status === 'Posted' && p.onTheWayBase > 0)
        .sort((a, b) => a.postingDate.localeCompare(b.postingDate) || a.id - b.id)
        .map((posting) => ({ posting, lines: posting.lines.filter((l) => l.onTheWayBase > 0) }))
        .filter((g) => g.lines.length > 0),
    [order.postings],
  )

  const [rows, setRows] = useState<Record<number, RowState>>(() =>
    Object.fromEntries(
      groups.flatMap((g) =>
        g.lines.map((line) => [
          line.id,
          { received: line.onTheWayBase, rest: 'coming' as RestMode, reason: null, note: '' },
        ]),
      ),
    ),
  )
  /* THE CURSOR STARTS ON THE FIRST "RECEIVED NOW": a date field focused first opened its calendar over the lines. */
  const [focusLineId] = useState<number | null>(() => groups[0]?.lines[0]?.id ?? null)
  const { calendarOpen, calendar } = useCalendarEscape()
  const [date, setDate] = useState<string | null>(todayDateOnly())
  const [deliveryNote, setDeliveryNote] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The line a refusal names ("TRD-… line 2 (…): …"): its dispatch's number and its line number. */
  const [errorAt, setErrorAt] = useState<{ number: string; line: number } | null>(null)

  function patch(lineId: number, change: Partial<RowState>) {
    setError(null)
    setErrorAt(null)
    setRows((current) => ({
      ...current,
      [lineId]: { ...(current[lineId] ?? NO_ROW), ...change },
    }))
  }

  /* THE FIGURES OF THE RECEIPT: what arrives, what is written off, what stays on the way. */
  const summary = useMemo(() => {
    let received = 0
    let lost = 0
    let coming = 0
    let onTheWay = 0
    for (const g of groups) {
      for (const line of g.lines) {
        const row = rows[line.id]
        if (!row) continue
        const rest = Math.max(0, line.onTheWayBase - row.received)
        onTheWay += line.onTheWayBase
        received += Math.min(row.received, line.onTheWayBase)
        if (row.rest === 'lost') lost += rest
        else coming += rest
      }
    }
    return { received, lost, coming, onTheWay }
  }, [groups, rows])

  /** A line that receives or writes off something: it goes into the receipt. */
  const counts = (line: TransferPostingLineDto) => {
    const row = rows[line.id]
    if (!row) return false
    return row.received > 0 || (row.rest === 'lost' && row.received < line.onTheWayBase)
  }

  /* The receipt cannot be dated before the dispatches it receives (rule T26): the latest among the lines typed. */
  const minDate = groups
    .filter((g) => g.lines.some(counts))
    .reduce<
      string | null
    >((latest, g) => (latest === null || g.posting.postingDate > latest ? g.posting.postingDate : latest), null)
  const today = todayDateOnly()
  const maxDate = minDate && minDate > today ? minDate : today

  /* WHY THE BUTTON IS DISABLED, in the server's own words: the reader sees the refusal before pressing. */
  let blockedBy: string | null = null
  for (const g of groups) {
    for (const line of g.lines) {
      const row = rows[line.id]
      if (!row || blockedBy) continue
      const at = `${g.posting.documentNumber} line ${line.lineNumber} (${line.itemCode})`
      if (row.received > line.onTheWayBase) {
        blockedBy = `${at}: ${formatNumber(row.received)} pcs received but only ${formatNumber(line.onTheWayBase)} are on the way.`
      } else if (row.rest === 'lost' && row.received < line.onTheWayBase && !row.reason) {
        blockedBy = `${at}: choose why the rest will not arrive.`
      } else if (
        row.rest === 'lost' &&
        row.received < line.onTheWayBase &&
        row.reason === 'OTHER' &&
        !row.note.trim()
      ) {
        blockedBy = `${at}: say what happened in the note (reason Other).`
      }
    }
  }
  if (!blockedBy && !groups.some((g) => g.lines.some(counts))) {
    blockedBy = 'Nothing to receive: type the pieces that arrived, or tick Nothing more will arrive.'
  }
  if (!blockedBy && !date) blockedBy = 'The receipt date is required.'

  async function submit() {
    if (blockedBy || !date) return
    setBusy(true)
    setError(null)
    setErrorAt(null)
    const lines = groups.flatMap((g) =>
      g.lines.filter(counts).map((line) => {
        const row = rows[line.id]!
        const writeOff = row.rest === 'lost' && row.received < line.onTheWayBase
        return {
          dispatchLineId: line.id,
          receivedBase: row.received,
          nothingMoreWillArrive: writeOff,
          lossReasonCode: writeOff ? row.reason : null,
          lossNote: writeOff ? row.note.trim() || null : null,
        }
      }),
    )
    try {
      const result = await transfersApi.receive(order.id, {
        rowVersion: order.rowVersion,
        date,
        referenceNo: deliveryNote.trim() || null,
        notes: notes.trim() || null,
        lines,
      })
      notify.success(result.message)
      onPosted(result)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'The receipt could not be posted.'
      setError(message)
      const match = /^(\S+) line (\d+)/.exec(message)
      setErrorAt(match ? { number: match[1], line: Number(match[2]) } : null)
      if (err instanceof ApiError && (err.code === 'CONCURRENCY' || /modified by another user/i.test(message)))
        onStale()
    } finally {
      setBusy(false)
    }
  }

  function receivedInput(line: TransferPostingLineDto) {
    const row = rows[line.id]
    if (!row) return null
    const over = row.received > line.onTheWayBase
    return (
      <NumberInput
        aria-label={`Received now, ${line.itemCode}`}
        data-autofocus={line.id === focusLineId ? true : undefined}
        value={row.received}
        onChange={(next) => patch(line.id, { received: Math.max(0, Math.trunc(numberInputValue(next) ?? 0)) })}
        min={0}
        allowDecimal={false}
        allowNegative={false}
        thousandSeparator=","
        size="xs"
        disabled={busy}
        description={over ? `Max ${formatNumber(line.onTheWayBase)}` : undefined}
        styles={over ? { description: { color: 'var(--mantine-color-red-7)', fontWeight: 600 } } : undefined}
        error={over}
        w={phone ? '100%' : 110}
      />
    )
  }

  /** When fewer arrive: "Still coming" (default) or "Nothing more will arrive", with its reason and note. */
  function restControls(line: TransferPostingLineDto) {
    const row = rows[line.id]
    if (!row || row.received >= line.onTheWayBase) return null
    return (
      <Stack gap={6}>
        <SegmentedControl
          size="xs"
          aria-label={`The rest of ${line.itemCode}`}
          value={row.rest}
          onChange={(next) => patch(line.id, { rest: next as RestMode })}
          data={[
            { value: 'coming', label: 'Still coming' },
            { value: 'lost', label: 'Nothing more will arrive' },
          ]}
          disabled={busy}
          fullWidth={phone}
        />
        {row.rest === 'lost' && (
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
            <Select
              label="Why?"
              withAsterisk
              size="xs"
              placeholder="Choose"
              data={REASON_DATA}
              value={row.reason}
              onChange={(next) => patch(line.id, { reason: (next as TransferLossReasonCode | null) ?? null })}
              disabled={busy}
              comboboxProps={{ withinPortal: true }}
            />
            <TextInput
              label="Note"
              withAsterisk={row.reason === 'OTHER'}
              size="xs"
              value={row.note}
              onChange={(event) => patch(line.id, { note: event.currentTarget.value })}
              maxLength={300}
              disabled={busy}
            />
          </SimpleGrid>
        )}
      </Stack>
    )
  }

  function groupTitle(posting: TransferPostingDto) {
    return (
      <Group gap={6} wrap="wrap">
        <Text fz="sm" fw={600}>
          {posting.documentNumber} · dispatched {dateLabel(posting.postingDate)} · ETA {dateLabel(posting.eta)}
        </Text>
        {posting.isLate && (
          <Badge size="sm" color={LATE_BADGE.colour} variant={LATE_BADGE.variant}>
            {LATE_BADGE.label}
          </Badge>
        )}
      </Group>
    )
  }

  const isErrorLine = (posting: TransferPostingDto, line: TransferPostingLineDto) =>
    errorAt !== null && errorAt.number === posting.documentNumber && errorAt.line === line.lineNumber

  return (
    <FormModal
      opened={opened}
      title={`Receive - ${label}`}
      onSubmit={() => void submit()}
      onClose={onClose}
      saving={busy}
      saveLabel="Receive"
      size="xl"
      fullScreen={phone}
      saveDisabled={blockedBy !== null}
      saveDisabledReason={blockedBy ?? undefined}
      closeOnEscape={!calendarOpen}
    >
      <Group align="flex-start" wrap="wrap" gap="md">
        <DateInput
          label="Date received"
          withAsterisk
          valueFormat="DD/MM/YYYY"
          value={fromIsoDate(date)}
          onChange={(next) => {
            setError(null)
            setDate(next ? isoDate(next) : null)
          }}
          minDate={fromIsoDate(minDate) ?? undefined}
          maxDate={fromIsoDate(maxDate) ?? undefined}
          w={{ base: '100%', xs: 170 }}
          disabled={busy}
          popoverProps={calendar('date')}
        />
        <TextInput
          label="Delivery note no."
          value={deliveryNote}
          onChange={(event) => setDeliveryNote(event.currentTarget.value)}
          maxLength={100}
          w={{ base: '100%', xs: 240 }}
          disabled={busy}
        />
      </Group>
      <Textarea
        label="Notes"
        autosize
        minRows={1}
        maxLength={1000}
        value={notes}
        onChange={(event) => setNotes(event.currentTarget.value)}
        disabled={busy}
      />

      {groups.length === 0 ? (
        <Text size="sm" c="dimmed" ta="center" py="md">
          Nothing is on the way.
        </Text>
      ) : phone ? (
        <Stack gap="md">
          {groups.map((g) => (
            <Stack key={g.posting.id} gap="xs">
              {groupTitle(g.posting)}
              {g.lines.map((line) => (
                <Paper
                  key={line.id}
                  withBorder
                  radius="md"
                  p="sm"
                  bg={isErrorLine(g.posting, line) ? 'var(--mantine-color-red-0)' : undefined}
                >
                  <Text fz="sm" fw={500}>
                    {line.itemCode}
                  </Text>
                  <Text fz="xs" c="dimmed">
                    {line.itemName}
                  </Text>
                  <SimpleGrid cols={2} spacing="xs" mt="xs">
                    <Box>
                      <Text fz="xs" c="dimmed">
                        On the way
                      </Text>
                      <Text fz="sm" fw={600}>
                        {formatNumber(line.onTheWayBase)} pcs
                      </Text>
                    </Box>
                    <Box>
                      <Text fz="xs" c="dimmed">
                        Received now
                      </Text>
                      {receivedInput(line)}
                    </Box>
                  </SimpleGrid>
                  <Box mt="xs">{restControls(line)}</Box>
                </Paper>
              ))}
            </Stack>
          ))}
          <Text fz="sm" fw={600} ta="right">
            On the way {formatNumber(summary.onTheWay)} pcs · Received now {formatNumber(summary.received)} pcs
          </Text>
        </Stack>
      ) : (
        /* 720: inside the xl dialog's 748 px body at 1440, so no row scrolls sideways; the last column takes what is left
           (Still coming / Nothing more will arrive needs about 330 px) */
        <Table.ScrollContainer minWidth={720}>
          <Table verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Item</Table.Th>
                <Table.Th ta="right">On the way</Table.Th>
                <Table.Th w={140}>Received now</Table.Th>
                <Table.Th miw={330} />
              </Table.Tr>
            </Table.Thead>
            {groups.map((g) => (
              <Table.Tbody key={g.posting.id}>
                <Table.Tr bg="var(--mantine-color-gray-0)">
                  <Table.Td colSpan={4}>{groupTitle(g.posting)}</Table.Td>
                </Table.Tr>
                {g.lines.map((line) => (
                  <Table.Tr key={line.id} bg={isErrorLine(g.posting, line) ? 'var(--mantine-color-red-0)' : undefined}>
                    <Table.Td>
                      <Text fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>
                        {line.itemCode}
                      </Text>
                      <Text fz="xs" c="dimmed">
                        {line.itemName}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text fz="sm" fw={600}>
                        {formatNumber(line.onTheWayBase)}
                      </Text>
                    </Table.Td>
                    <Table.Td>{receivedInput(line)}</Table.Td>
                    <Table.Td>{restControls(line)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            ))}
            <Table.Tfoot>
              <Table.Tr>
                <Table.Th>Total</Table.Th>
                <Table.Th ta="right">{formatNumber(summary.onTheWay)}</Table.Th>
                <Table.Th>{formatNumber(summary.received)} pcs</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Tfoot>
          </Table>
        </Table.ScrollContainer>
      )}

      <Text size="sm" fw={500} data-receive-summary>
        {formatNumber(summary.received)} pcs received, {formatNumber(summary.lost)} pcs written off as lost,{' '}
        {formatNumber(summary.coming)} pcs still on the way.
      </Text>

      {error && <Alert color="red">{error}</Alert>}
    </FormModal>
  )
}
