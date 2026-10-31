import { useState } from 'react'
import { Anchor, Badge, Group, Paper, Stack, Text, Timeline, Title } from '@mantine/core'
import { stamp } from './documentKind'

/** What every family's audit row carries; the stock, sales and purchase DTOs satisfy it as they are. */
export interface AuditEntry {
  action: string
  details: string | null
  userName: string | null
  atUtc: string
}

/** How many entries are worth showing before somebody asks for the rest. */
const PREVIEW = 5

const ACTION_COLOURS: Record<string, string> = {
  Created: 'blue',
  Updated: 'blue',
  Posted: 'green',
  Cancelled: 'red',
  // Receipts: a reversal is orange (undone, not wrong); allocations are the money reaching invoices.
  Reversed: 'orange',
  Allocated: 'teal',
  Deallocated: 'orange',
  // Cash sales: the receipt made by, or undone with, an invoice.
  AutoCreated: 'teal',
  ReceiptPosted: 'green',
  ReceiptReversed: 'orange',
  // Shortage plans: the live figures were refreshed; a purchase order was created from the plan.
  Recalculated: 'violet',
  POCreated: 'teal',
  // Goods receipts: the cost of received goods moved after they were received (an invoice, an adjustment).
  CostAdjusted: 'violet',
  FileAdded: 'gray',
  FileUpdated: 'gray',
  FileDeleted: 'gray',
  // Purchase orders: the approval decision (and "Closed" in the history of an order closed before script 77);
  // containers: their own steps.
  Approved: 'green',
  Rejected: 'red',
  Closed: 'teal',
  Confirmed: 'teal',
  Offloaded: 'green',
  OffloadCancelled: 'orange',
  // Movements (built on the page from their stamps), and (82) a movement that arrived in parts: the original lost
  // containers to a movement of their own, the new one came from it - and the split undone when that one is cancelled.
  Started: 'blue',
  Completed: 'green',
  'Split off': 'orange',
  'Split from': 'violet',
  'Split undone': 'orange',
  // (90) Transfer orders: waiting is yellow as its status, a step back orange, the goods moving green.
  SentForApproval: 'yellow',
  ApprovedAndReleased: 'green',
  BackToDraft: 'orange',
  NothingMoreSent: 'teal',
  DispatchedAndReceived: 'green',
  ReturnCreated: 'teal',
  ReturnOf: 'teal',
  // (91) Transfer orders: the draft's lines set or added from the destination's stock levels.
  FillToMax: 'violet',
  ItemsAddedBelowMin: 'violet',
}

/**
 * The words a badge shows for the codes the API sends ("CostAdjusted" reads "Cost adjusted"). A code missing here
 * still reads as words: actionLabel splits it.
 */
const ACTION_LABELS: Record<string, string> = {
  AutoCreated: 'Created automatically',
  ReceiptPosted: 'Receipt posted',
  ReceiptReversed: 'Receipt reversed',
  POCreated: 'Purchase order created',
  CostAdjusted: 'Cost adjusted',
  FileAdded: 'File added',
  FileUpdated: 'File updated',
  FileDeleted: 'File deleted',
  OffloadCancelled: 'Offload cancelled',
  ChequeStatus: 'Cheque status',
  // (90) Transfer orders: the codes whose words are not the code split up ("EtaChanged" would read "Eta changed",
  // "ReturnOf" "Return of"); the others are written out so a transfer's trail reads the same wherever it is shown.
  SentForApproval: 'Sent for approval',
  ApprovedAndReleased: 'Approved and released',
  BackToDraft: 'Back to draft',
  NothingMoreSent: 'Nothing more will be sent',
  DispatchedAndReceived: 'Dispatched and received',
  EtaChanged: 'ETA changed',
  ReturnCreated: 'Return created',
  ReturnOf: 'Return',
  DetailsUpdated: 'Details updated',
  // (91) "Fill to Max" keeps its capitals (split it would read "Fill to max"); the drawer's lines added.
  FillToMax: 'Fill to Max',
  ItemsAddedBelowMin: 'Items below Min added',
}

/** "CostAdjusted" -> "Cost adjusted", "POCreated" -> "PO created": the map first, else the code split into words. */
function actionLabel(code: string): string {
  const known = ACTION_LABELS[code]
  if (known) return known
  const words = code
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_]+/)
    .filter(Boolean)
  // Only the first word keeps its capital; a short code in capitals (PO, GRN) stays as it is.
  return words.map((word, index) => (index === 0 || /^[A-Z0-9]{2,}$/.test(word) ? word : word.toLowerCase())).join(' ')
}

/**
 * What has happened to this document, newest first.
 *
 * IT IS THE ANSWER TO "WHO POSTED THIS". A stock document moves real quantities and the question
 * asked about it weeks later is always about a person and a time, not about the values — so the
 * trail sits on the document itself rather than in a separate audit screen nobody opens.
 *
 * FIVE ENTRIES, THEN THE REST ON ASKING. A document that has been edited eleven times would
 * otherwise push its own lines off the screen with its history.
 */
export function AuditTrail({ entries, wrapLabels = false }: {
  entries: AuditEntry[]
  /**
   * The user name goes under a label too long to sit beside it, rather than cut the label ("Nothing more will be
   * sent" read "Nothing more will be…" on a phone): the transfer order's trail. Opt-in: every other trail keeps its
   * one line.
   */
  wrapLabels?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? entries : entries.slice(0, PREVIEW)

  return (
    <Paper radius="lg" p="md" withBorder>
      <Title order={5} mb="sm">
        Activity
      </Title>

      {entries.length === 0 ? (
        <Text size="sm" c="dimmed">
          Nothing yet. Saving this document will be its first entry.
        </Text>
      ) : (
        <Stack gap="sm">
          <Timeline bulletSize={14} lineWidth={2}>
            {shown.map((entry, index) => (
              <Timeline.Item key={`${entry.atUtc}-${index}`}>
                {/* wrapLabels: the name goes under a long label rather than cut it. */}
                <Group gap="xs" wrap={wrapLabels ? 'wrap' : 'nowrap'}>
                  <Badge
                    size="sm"
                    variant="light"
                    color={ACTION_COLOURS[entry.action] ?? 'gray'}
                    style={wrapLabels ? { minWidth: 'max-content' } : undefined}
                  >
                    {actionLabel(entry.action)}
                  </Badge>
                  <Text size="sm">{entry.userName ?? 'System'}</Text>
                </Group>
                <Text size="xs" c="dimmed">
                  {stamp(entry.atUtc)}
                </Text>
                {entry.details && (
                  // A file name in "Attachment added: ..." is one long word: it wraps rather than widening the page.
                  <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
                    {entry.details}
                  </Text>
                )}
              </Timeline.Item>
            ))}
          </Timeline>

          {entries.length > PREVIEW && (
            <Anchor component="button" type="button" size="sm" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Show less' : `Show all ${entries.length} entries`}
            </Anchor>
          )}
        </Stack>
      )}
    </Paper>
  )
}
