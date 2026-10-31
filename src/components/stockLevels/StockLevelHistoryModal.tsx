import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Group, Loader, Modal, Table, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { ApiError } from '../../api/http'
import { stockLevelsApi, type StockLevelHistoryDto } from '../../api/inventory/stockLevels'
import { formatDateTime, formatNumber } from '../format'

export interface StockLevelHistoryModalProps {
  opened: boolean
  itemId: number
  itemCode: string
  warehouseId: number
  warehouseCode: string
  onClose(): void
}

const ACTION_COLOURS: Record<string, string> = { Added: 'green', Changed: 'blue', Removed: 'red' }

/** "10 → 20", "— → 20" for a level added, "10 → —" for one removed, "20" when it did not change. */
function change(before: number | null, after: number | null): string {
  const text = (value: number | null) => (value === null ? '—' : formatNumber(value))
  return before === after ? text(after) : `${text(before)} → ${text(after)}`
}

/** "Item Definition", "Stock Levels", "Import (levels-october.xlsx)". */
function sourceText(row: StockLevelHistoryDto): string {
  if (row.source === 'ItemCard') return 'Item Definition'
  if (row.source === 'StockLevels') return 'Stock Levels'
  if (row.source === 'Import') return row.fileName ? `Import (${row.fileName})` : 'Import'
  return row.source
}

/**
 * EVERY CHANGE OF ONE LEVEL (script 91, rule S4): added, changed, removed, old → new, who, when and from where (Item
 * Definition, Stock Levels, an import with its file). The history outlives the level: a level removed and set again
 * shows both. Newest first.
 */
export function StockLevelHistoryModal({ opened, itemId, itemCode, warehouseId, warehouseCode, onClose }: StockLevelHistoryModalProps) {
  const phone = useMediaQuery('(max-width: 48em)')
  const [rows, setRows] = useState<StockLevelHistoryDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!opened) return
    const controller = new AbortController()
    stockLevelsApi
      .history(itemId, warehouseId, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setRows(answer)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof ApiError ? err.messages.join(' ') : 'The history could not be loaded.')
      })
    return () => controller.abort()
  }, [opened, itemId, warehouseId])

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={`History - ${itemCode} at ${warehouseCode}`}
      size="xl"
      fullScreen={phone ?? false}
      centered={!phone}
    >
      {error ? (
        <Alert color="red" mb="sm">
          {error}
        </Alert>
      ) : rows === null ? (
        <Group justify="center" py="lg">
          <Loader size="sm" />
        </Group>
      ) : rows.length === 0 ? (
        <Text c="dimmed" ta="center" py="lg">
          No change recorded.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={640}>
          <Table verticalSpacing="xs" striped data-stock-level-history>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>When</Table.Th>
                <Table.Th>By</Table.Th>
                <Table.Th>What</Table.Th>
                <Table.Th ta="right">Min</Table.Th>
                <Table.Th ta="right">Max</Table.Th>
                <Table.Th>From</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => (
                <Table.Tr key={row.id}>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(row.atUtc, '—')}</Table.Td>
                  <Table.Td>{row.userName ?? '—'}</Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={ACTION_COLOURS[row.action] ?? 'gray'}>
                      {row.action}
                    </Badge>
                  </Table.Td>
                  <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                    {change(row.oldMinBase, row.newMinBase)}
                  </Table.Td>
                  <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                    {change(row.oldMaxBase, row.newMaxBase)}
                  </Table.Td>
                  <Table.Td>{sourceText(row)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onClose}>
          Close
        </Button>
      </Group>
    </Modal>
  )
}
