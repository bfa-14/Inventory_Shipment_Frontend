import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Popover,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconCopy, IconSearch } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import type { TrackingKind } from '../../api/types'
import { dateLabel } from '../documents/documentKind'
import { formatNumber } from '../format'
import { notify } from '../ui/notify'
import { ShownRowsFooter } from '../ui/ShownRows'
import { useShownRows } from '../ui/useShownRows'
import { copyText, normalizeTrackingNo, trackingStateBadge, type TrackingViewRow } from './trackingNumbers'

interface TrackingViewProps {
  /** The link that opens it: "20 serial nos.", "2 batches", "1 expiry date". */
  label: string
  /** "TRD-BR-003-000021 line 1 - TEST93-S: 20 serial nos." */
  title: string
  kind: TrackingKind
  /** Reads the rows when it opens (never before: a posting's rows are not in the page's answer). */
  load(signal: AbortSignal): Promise<TrackingViewRow[]>
}

/**
 * THE ROWS OF ONE POSTED LINE (script 93): its serial nos., batches or expiry dates and what became of each - On the way
 * (blue), Received (green), Written off (red), Partly received (orange), Reversed (gray) - with the server's sentence
 * dimmed beside it ("Received by TRR-BR-002-000007"). A popover of 520 px on a wide screen, the whole screen below 48em.
 * Read when opened; "Find a number" past 10 rows; "Copy list" gives the rows in the shape Paste list… reads back.
 */
export function TrackingView({ label, title, kind, load }: TrackingViewProps) {
  const phone = useMediaQuery('(max-width: 48em)')
  const [open, setOpen] = useState(false)

  const link = (
    <Anchor
      component="button"
      type="button"
      fz="xs"
      onClick={(event) => {
        event.stopPropagation()
        setOpen((current) => !current)
      }}
      data-tracking-view-link
    >
      {label}
    </Anchor>
  )

  if (phone) {
    return (
      <>
        {link}
        {/* The close button says what it is (a screen reader read nothing): the full screen has no other way out. */}
        <Modal opened={open} onClose={() => setOpen(false)} title={title} fullScreen closeButtonProps={{ 'aria-label': 'Close' }}>
          {open ? <TrackingRows kind={kind} load={load} /> : null}
        </Modal>
      </>
    )
  }

  return (
    // trapFocus / returnFocus: a keyboard user Tabs from the link into "Find a number" and "Copy list", and Escape
    // brings the focus back to the link
    <Popover
      opened={open}
      onChange={setOpen}
      width={520}
      position="bottom-start"
      withArrow
      shadow="md"
      withinPortal
      trapFocus
      returnFocus
    >
      <Popover.Target>{link}</Popover.Target>
      <Popover.Dropdown>
        <Text fz="sm" fw={600} mb="xs">
          {title}
        </Text>
        {open ? <TrackingRows kind={kind} load={load} /> : null}
      </Popover.Dropdown>
    </Popover>
  )
}

function TrackingRows({ kind, load }: { kind: TrackingKind; load(signal: AbortSignal): Promise<TrackingViewRow[]> }) {
  // Read once, when the view opens: the caller's function may be a new one at every render of its page.
  const [loader] = useState(() => load)
  const [rows, setRows] = useState<TrackingViewRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [find, setFind] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    loader(controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setRows(answer)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof ApiError ? err.message : 'The rows could not be loaded.')
      })
    return () => controller.abort()
  }, [loader])

  const wanted = normalizeTrackingNo(find)
  const shown = useMemo(() => {
    if (!rows) return []
    if (!wanted) return rows
    return rows.filter((r) => (r.serialNo ?? r.batchNo ?? '').includes(wanted) || dateLabel(r.expiryDate).includes(wanted))
  }, [rows, wanted])
  const shownRows = useShownRows(shown.length, wanted)

  if (error) return <Alert color="red">{error}</Alert>
  if (!rows)
    return (
      <Group justify="center" py="md">
        <Loader size="sm" />
      </Group>
    )

  const numberTitle = kind === 'Serial' ? 'Serial no.' : kind === 'Batch' ? 'Batch no.' : null
  const withExpiry = rows.some((r) => r.expiryDate !== null)

  async function copy() {
    const text = copyText(kind, shown)
    const copied = `Copied ${formatNumber(shown.length)} ${shown.length === 1 ? 'row' : 'rows'}.`
    try {
      await navigator.clipboard.writeText(text)
      notify.success(copied)
    } catch {
      // The clipboard API needs a secure page: the older way, through a selected text box, works on any.
      if (copyThroughTextArea(text)) notify.success(copied)
      else notify.error('The list could not be copied: the browser refused the clipboard.')
    }
  }

  return (
    <Stack gap="xs" data-tracking-view>
      <Group justify="space-between" gap="xs" wrap="wrap">
        {rows.length > 10 ? (
          <TextInput
            size="xs"
            placeholder="Find a number"
            aria-label="Find a number"
            leftSection={<IconSearch size={14} />}
            value={find}
            onChange={(event) => setFind(event.currentTarget.value)}
            style={{ flex: '1 1 200px' }}
          />
        ) : (
          <span />
        )}
        <Button size="xs" variant="light" leftSection={<IconCopy size={14} />} onClick={() => void copy()} disabled={shown.length === 0}>
          Copy list
        </Button>
      </Group>
      <ScrollArea.Autosize mah={400}>
        <Table verticalSpacing={4} fz="sm" striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={44}>#</Table.Th>
              {numberTitle ? <Table.Th>{numberTitle}</Table.Th> : null}
              {withExpiry || kind === 'Expiry' ? <Table.Th>Expiry</Table.Th> : null}
              {kind !== 'Serial' ? <Table.Th ta="right">Pcs</Table.Th> : null}
              <Table.Th>State</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.slice(0, shownRows.limit).map((r) => {
              const badge = trackingStateBadge(r.state)
              return (
                <Table.Tr key={r.key}>
                  <Table.Td>{formatNumber(r.rowNumber)}</Table.Td>
                  {numberTitle ? (
                    <Table.Td>
                      <Text fz="sm" ff={kind === 'Serial' ? 'monospace' : undefined} style={{ whiteSpace: 'nowrap' }}>
                        {r.serialNo ?? r.batchNo}
                      </Text>
                    </Table.Td>
                  ) : null}
                  {withExpiry || kind === 'Expiry' ? <Table.Td>{dateLabel(r.expiryDate)}</Table.Td> : null}
                  {kind !== 'Serial' ? (
                    <Table.Td ta="right">
                      {formatNumber(r.quantity)}
                      {r.lost > 0 ? (
                        <Text fz="xs" c="red.7">
                          {formatNumber(r.lost)} lost
                        </Text>
                      ) : null}
                    </Table.Td>
                  ) : null}
                  <Table.Td>
                    <Badge size="sm" variant="light" color={badge.colour} style={{ textTransform: 'none' }}>
                      {badge.label}
                    </Badge>
                    {r.stateText && r.stateText !== badge.label ? (
                      <Text fz="xs" c="dimmed">
                        {r.stateText}
                      </Text>
                    ) : null}
                  </Table.Td>
                </Table.Tr>
              )
            })}
            {shown.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <Text fz="sm" c="dimmed" ta="center">
                    No number matches.
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : null}
          </Table.Tbody>
        </Table>
      </ScrollArea.Autosize>
      <ShownRowsFooter limit={shownRows.limit} total={shown.length} noun="rows" more={shownRows.more} all={shownRows.all} />
    </Stack>
  )
}

/** Copies through a hidden text box (document.execCommand): the way left when navigator.clipboard is refused. */
function copyThroughTextArea(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
  }
}
