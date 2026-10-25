import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Badge,
  Box,
  Button,
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
  transferTrackingApi,
  type ReceiveTransferLineRequest,
  type TransferLossReasonCode,
  type TransferOrderDto,
  type TransferPostedResult,
  type TransferPostingDto,
  type TransferPostingLineDto,
} from '../../api/inventory/transfers'
import { dateLabel, fromIsoDate, isoDate } from '../documents/documentKind'
import { formatNumber, numberInputValue, todayDateOnly } from '../format'
import { TrackingModal } from '../tracking/TrackingModal'
import {
  KIND_TEXT,
  mergeReceiptTracking,
  receiptStateText,
  receiptTotals,
  type ReceiptTracking,
} from '../tracking/trackingNumbers'
import { FormModal } from '../ui/FormModal'
import { notify } from '../ui/notify'
import { useCalendarEscape } from '../ui/useCalendarEscape'
import { orderLabel } from './transferModel'
import { receiptEntriesOf, receiptTrackingRows, receiveTrackingTitle } from './transferTracking'
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
 *
 * (93) A DISPATCH LINE THAT LEFT WITH TRACKING ROWS is received with them, whatever its item says now: its rows on the
 * way are read when the dialog opens (onTheWayOnly), all arrived by default; its "Serial nos.…" / "Batches…" /
 * "Expiry dates…" opens TrackingModal (beside this dialog) to say, row by row, what arrived and what is still coming or
 * lost. Its Received now is then the rows' sum, read only; 90's Still coming / Nothing more will arrive is not shown on
 * it, and its "Why?" (and Note for Other) are asked when its rows hold lost pieces.
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

  /* (93) THE TRACKED DISPATCH LINES (they left with rows) and their rows on the way, read when the dialog opens - and
     read again only when the order itself changed under it (a refused receipt reloads it: a new row version), never
     because the page drew a new copy of the same order. */
  const trackedPostingIds = useMemo(
    () => groups.filter((g) => g.lines.some((l) => l.trackingKind)).map((g) => g.posting.id),
    [groups],
  )
  const trackedKey = trackedPostingIds.join(',')
  const [tracking, setTracking] = useState<Record<number, ReceiptTracking>>({})
  /** 'loading' | 'ready' | the sentence the reading was refused with. */
  const [trackingLoad, setTrackingLoad] = useState<string>(() => (trackedPostingIds.length > 0 ? 'loading' : 'ready'))
  /** The rows were read again after someone else changed the order, and they are not those the reader saw. */
  const [trackingReread, setTrackingReread] = useState(false)
  const [trackingFor, setTrackingFor] = useState<{ posting: TransferPostingDto; line: TransferPostingLineDto } | null>(
    null,
  )
  /** What the reader said of the rows, for a read again to keep it (the read's answer comes after the render). */
  const trackingRef = useRef(tracking)
  useEffect(() => {
    trackingRef.current = tracking
  }, [tracking])
  const readOnce = useRef(false)

  useEffect(() => {
    if (trackedKey === '') return
    const controller = new AbortController()
    // Receive waits for the rows: a read again must not leave the old ones postable meanwhile.
    setTrackingLoad('loading')
    const ids = trackedKey.split(',').map(Number)
    Promise.all(ids.map((id) => transferTrackingApi.postingRows(order.id, id, true, controller.signal)))
      .then((answers) => {
        if (controller.signal.aborted) return
        const current = trackingRef.current
        const next: Record<number, ReceiptTracking> = {}
        let changed = false
        for (const g of groups) {
          const index = ids.indexOf(g.posting.id)
          if (index < 0) continue
          for (const line of g.lines) {
            if (!line.trackingKind) continue
            // A read again keeps what was said of each row still on the way (mergeReceiptTracking).
            const merged = mergeReceiptTracking(current[line.id], receiptEntriesOf(answers[index] ?? [], line.id))
            next[line.id] = merged.tracking
            changed ||= merged.changed || (readOnce.current && !(line.id in current))
          }
        }
        if (readOnce.current && Object.keys(current).some((lineId) => !(lineId in next))) changed = true
        if (readOnce.current && changed) setTrackingReread(true)
        readOnce.current = true
        setTracking(next)
        setTrackingLoad('ready')
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setTrackingLoad(
          err instanceof ApiError ? err.message : 'The serial numbers, batches and expiry dates on the way could not be read.',
        )
      })
    return () => controller.abort()
    // groups is read as it is when the order (its row version) or its tracked dispatches change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, order.rowVersion, trackedKey])

  /** A tracked line's figures, from its rows (nothing until they are read). */
  const trackedTotals = (line: TransferPostingLineDto) => receiptTotals(tracking[line.id]?.entries ?? [])

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
  /* THE CURSOR STARTS ON THE FIRST "RECEIVED NOW": a date field focused first opened its calendar over the lines (90).
     (93) A tracked line's Received now is read-only text, so the first untracked line's box; when every line is
     tracked, the first line's "Serial nos.…" / "Batches…" / "Expiry dates…" button. */
  const [focusLineId] = useState<number | null>(() => {
    const all = groups.flatMap((g) => g.lines)
    return (all.find((l) => !l.trackingKind) ?? all[0])?.id ?? null
  })
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
        if (line.trackingKind) {
          const t = receiptTotals(tracking[line.id]?.entries ?? [])
          onTheWay += line.onTheWayBase
          received += t.arrived
          lost += t.lost
          coming += Math.max(0, line.onTheWayBase - t.arrived - t.lost)
          continue
        }
        const rest = Math.max(0, line.onTheWayBase - row.received)
        onTheWay += line.onTheWayBase
        received += Math.min(row.received, line.onTheWayBase)
        if (row.rest === 'lost') lost += rest
        else coming += rest
      }
    }
    return { received, lost, coming, onTheWay }
  }, [groups, rows, tracking])

  /** A line that receives or writes off something: it goes into the receipt. */
  const counts = (line: TransferPostingLineDto) => {
    const row = rows[line.id]
    if (!row) return false
    if (line.trackingKind) {
      const t = trackedTotals(line)
      return t.arrived + t.lost > 0
    }
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
      if (line.trackingKind) {
        // (93) Its lost pieces are its rows'; the line's reason (and note for Other) covers them.
        const lostHere = trackedTotals(line).lost
        if (lostHere > 0 && !row.reason) blockedBy = `${at}: choose why the rest will not arrive.`
        else if (lostHere > 0 && row.reason === 'OTHER' && !row.note.trim())
          blockedBy = `${at}: say what happened in the note (reason Other).`
        continue
      }
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
  /* (93) The tracked lines' rows are read first. */
  if (trackingLoad === 'loading') blockedBy = 'Reading the serial numbers, batches and expiry dates on the way…'
  else if (trackingLoad !== 'ready') blockedBy = trackingLoad
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
      g.lines.filter(counts).map((line): ReceiveTransferLineRequest => {
        const row = rows[line.id]!
        if (line.trackingKind) {
          // (93) One entry per row arrived or lost (still coming left out); the API sets receivedBase from them.
          const entries = tracking[line.id]?.entries ?? []
          const t = receiptTotals(entries)
          return {
            dispatchLineId: line.id,
            receivedBase: t.arrived,
            nothingMoreWillArrive: false,
            lossReasonCode: t.lost > 0 ? row.reason : null,
            lossNote: t.lost > 0 ? row.note.trim() || null : null,
            tracking: receiptTrackingRows(entries),
          }
        }
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
    if (line.trackingKind) {
      // (93) Read only: the sum of what its rows say arrived.
      return (
        <Text fz="sm" fw={600} aria-label={`Received now, ${line.itemCode}`} data-tracking-received={line.id}>
          {trackingLoad === 'ready' ? formatNumber(trackedTotals(line).arrived) : '—'}
        </Text>
      )
    }
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

  /** The reason (and the note for Other) of the pieces that will not arrive. */
  function reasonFields(line: TransferPostingLineDto, row: RowState) {
    return (
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
    )
  }

  /**
   * (93) A tracked line: its button and state ("18 arrived · 1 lost · 1 still coming"), then Why? when its rows hold
   * lost pieces. 90's Still coming / Nothing more will arrive is not shown on it: each row says it.
   */
  function trackedControls(posting: TransferPostingDto, line: TransferPostingLineDto) {
    const row = rows[line.id]
    const kind = line.trackingKind
    if (!row || !kind) return null
    const t = trackedTotals(line)
    const waiting = trackingLoad !== 'ready'
    return (
      <Stack gap={6}>
        <Group gap="xs" wrap="wrap">
          {/* While its rows are read the button looks disabled but stays focusable (data-disabled, FormModal's own
              Save pattern): it may be where the cursor starts, and a disabled button cannot take the focus. */}
          <Button
            size="xs"
            variant="light"
            // Each line's button says which dispatch line it is to a screen reader (they all read "Serial nos.…").
            aria-label={`${KIND_TEXT[kind].button} ${posting.documentNumber} line ${line.lineNumber}, ${line.itemCode}`}
            onClick={() => {
              if (!waiting) setTrackingFor({ posting, line })
            }}
            disabled={busy}
            data-disabled={waiting || undefined}
            aria-disabled={waiting || undefined}
            data-autofocus={line.id === focusLineId ? true : undefined}
            data-tracking-open={line.id}
          >
            {KIND_TEXT[kind].button}
          </Button>
          <Text
            fz="xs"
            fw={600}
            c={t.lost > 0 || t.coming > 0 ? 'orange.8' : 'teal.7'}
            data-tracking-state={line.id}
          >
            {trackingLoad === 'ready' ? receiptStateText(t) : '—'}
          </Text>
        </Group>
        {t.lost > 0 ? reasonFields(line, row) : null}
      </Stack>
    )
  }

  /** When fewer arrive: "Still coming" (default) or "Nothing more will arrive", with its reason and note. */
  function restControls(posting: TransferPostingDto, line: TransferPostingLineDto) {
    if (line.trackingKind) return trackedControls(posting, line)
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
        {row.rest === 'lost' && reasonFields(line, row)}
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

  const trackingKind = trackingFor?.line.trackingKind ?? null

  return (
    <>
      <FormModal
        opened={opened}
        title={`Receive - ${label}`}
        onSubmit={() => void submit()}
        onClose={onClose}
        saving={busy}
        saveLabel="Receive"
        // (93) Wider than 90's xl when a line is tracked: its button, state and Why? fit without scrolling sideways.
        size={trackedPostingIds.length > 0 ? '62rem' : 'xl'}
        fullScreen={phone}
        saveDisabled={blockedBy !== null}
        saveDisabledReason={blockedBy ?? undefined}
        // Escape closes an open calendar first (90); never this dialog under its tracking dialog (93).
        closeOnEscape={!calendarOpen && trackingFor === null}
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
                    <Box mt="xs">{restControls(g.posting, line)}</Box>
                  </Paper>
                ))}
              </Stack>
            ))}
            <Text fz="sm" fw={600} ta="right">
              On the way {formatNumber(summary.onTheWay)} pcs · Received now {formatNumber(summary.received)} pcs
            </Text>
          </Stack>
        ) : (
          /* 720: inside the xl dialog's 748 px body at 1440, so no row scrolls sideways; the last column takes what is
             left (Still coming / Nothing more will arrive needs about 330 px; a tracked line's button, state and Why?
             fit there too, in the wider 62rem dialog) */
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
                      <Table.Td>{restControls(g.posting, line)}</Table.Td>
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

        {trackingReread ? (
          <Alert color="orange" data-tracking-reread>
            The order was changed by someone else: the serial numbers, batches and expiry dates on the way were read
            again.
          </Alert>
        ) : null}
        {trackingLoad !== 'loading' && trackingLoad !== 'ready' ? <Alert color="red">{trackingLoad}</Alert> : null}
        {error && <Alert color="red">{error}</Alert>}
      </FormModal>

      {/* (93) BESIDE the dialog, never inside it: Escape and Enter there stay there. */}
      {trackingFor && trackingKind && tracking[trackingFor.line.id] ? (
        <TrackingModal
          opened
          mode="receive"
          kind={trackingKind}
          withExpiry={tracking[trackingFor.line.id]!.entries.some((e) => e.expiryDate !== null)}
          serialLength={null}
          title={receiveTrackingTitle(trackingKind, trackingFor.posting.documentNumber, trackingFor.line)}
          subtitle={`${formatNumber(trackingFor.line.onTheWayBase)} pcs on the way to ${order.to.code}.`}
          value={tracking[trackingFor.line.id]!}
          onDone={(value) => {
            setTracking((current) => ({ ...current, [trackingFor.line.id]: value }))
            setError(null)
            setErrorAt(null)
            setTrackingFor(null)
          }}
          onCancel={() => setTrackingFor(null)}
        />
      ) : null}
    </>
  )
}
