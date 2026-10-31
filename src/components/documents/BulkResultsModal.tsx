import { Badge, Button, Group, Modal, Table, Text } from '@mantine/core'
import type { BulkActionItemResult, BulkActionResult } from '../../api/documents'
import { formatNumber } from '../format'

interface BulkResultsModalProps {
  opened: boolean
  title: string
  result: BulkActionResult | null
  /** "Posted" or "Deleted" — the word a successful row gets. */
  successLabel: string
  /** How a row is named when it has no number: "draft #12". */
  labelOf: (item: BulkActionItemResult) => string
  /** The first column's heading: "Document" by default ("Step" for the next steps of containers). */
  itemHeader?: string
  onClose(): void
}

/**
 * What a bulk action did, document by document.
 *
 * A TABLE, NOT A TOAST. "2 of 3 posted" in a notification leaves the reader hunting for the third;
 * the row that failed, with the procedure's own sentence beside it, is what they need to act on.
 */
export function BulkResultsModal({ opened, title, result, successLabel, labelOf, itemHeader = 'Document', onClose }: BulkResultsModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={title} size="lg" centered>
      {result && (
        <>
          <Text fz="sm" mb="sm">
            {formatNumber(result.succeeded)} of {formatNumber(result.requested)} succeeded
            {result.failed > 0 ? `, ${formatNumber(result.failed)} refused.` : '.'}
          </Text>

          <Table.ScrollContainer minWidth={480}>
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={170}>{itemHeader}</Table.Th>
                  <Table.Th w={110}>Result</Table.Th>
                  <Table.Th>Message</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {result.results.map((item) => (
                  <Table.Tr key={item.id} data-bulk-result={item.ok ? 'ok' : 'refused'}>
                    <Table.Td>
                      <Text fz="sm" fw={500}>{item.documentNumber ?? labelOf(item)}</Text>
                    </Table.Td>
                    <Table.Td>
                      {/* A REFUSAL READS "Refused": the API's code (NEXT_STEP_CHANGED, STOCK_SHORT) is for the program and
                          was cut to "NEXT_ST…" in the badge; the message beside it says what happened. */}
                      <Badge
                        color={item.ok ? (item.warning ? 'orange' : 'green') : 'red'}
                        variant="light"
                        title={item.ok ? undefined : (item.code ?? undefined)}
                      >
                        {item.ok ? successLabel : 'Refused'}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {/* DONE, BUT NOT ALL OF IT: a supplier invoice posted whose goods receipt was refused. The row
                          succeeded, and the warning says what is still to do. */}
                      {item.message || !item.warning ? (
                        <Text fz="sm" c={item.ok ? 'dimmed' : undefined} style={{ whiteSpace: 'pre-line' }}>
                          {item.message ?? '—'}
                        </Text>
                      ) : null}
                      {item.warning ? (
                        <Text fz="sm" c="orange.8" data-bulk-warning>
                          {item.warning}
                        </Text>
                      ) : null}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </>
      )}

      <Group justify="flex-end" mt="md">
        <Button onClick={onClose}>Close</Button>
      </Group>
    </Modal>
  )
}
