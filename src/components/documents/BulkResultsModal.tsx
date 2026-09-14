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
  onClose(): void
}

/**
 * What a bulk action did, document by document.
 *
 * A TABLE, NOT A TOAST. "2 of 3 posted" in a notification leaves the reader hunting for the third;
 * the row that failed, with the procedure's own sentence beside it, is what they need to act on.
 */
export function BulkResultsModal({ opened, title, result, successLabel, labelOf, onClose }: BulkResultsModalProps) {
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
                  <Table.Th w={170}>Document</Table.Th>
                  <Table.Th w={110}>Result</Table.Th>
                  <Table.Th>Message</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {result.results.map((item) => (
                  <Table.Tr key={item.id}>
                    <Table.Td>
                      <Text fz="sm" fw={500}>{item.documentNumber ?? labelOf(item)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={item.ok ? 'green' : 'red'} variant="light">
                        {item.ok ? successLabel : (item.code ?? 'Failed')}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text fz="sm" c={item.ok ? 'dimmed' : undefined}>
                        {item.message ?? '—'}
                      </Text>
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
