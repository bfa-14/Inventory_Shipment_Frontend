import { useCallback, useEffect, useState } from 'react'
import { ActionIcon, Alert, Badge, Box, Button, Card, Group, Paper, Skeleton, Stack, Table, Text, Tooltip } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconClock, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { stockLevelsApi, type StockLevelRowDto } from '../../api/inventory/stockLevels'
import { formatNumber } from '../../components/format'
import { StockLevelBadge } from '../../components/stockLevels/StockLevelBadge'
import { StockLevelFormModal } from '../../components/stockLevels/StockLevelFormModal'
import { StockLevelHistoryModal } from '../../components/stockLevels/StockLevelHistoryModal'
import {
  comingInText,
  inactiveWarehouseText,
  levelPhoneLine,
  levelWarehouseText,
  removeLevelQuestion,
  updatedText,
} from '../../components/stockLevels/stockLevelStatus'
import { confirm } from '../../components/ui/confirm'
import { notify } from '../../components/ui/notify'

export interface ItemStockLevelsCardProps {
  /** Null on a new item: nothing to set until it is saved. */
  itemId: number | null
  itemCode: string
  /** Item Definition's Minimum / Maximum Quantity AS SAVED: the company's, compared with the warehouses' Min. */
  companyMin: number | null
  companyMax: number | null
  /** inventory.stocklevels.edit: Set levels…, the pencil and the trash. */
  canEdit: boolean
}

type Dialog =
  | { kind: 'set' }
  | { kind: 'edit'; row: StockLevelRowDto }
  | { kind: 'history'; row: StockLevelRowDto }
  | null

/**
 * "STOCK LEVELS PER WAREHOUSE" ON ITEM DEFINITION (script 91): the item's Min and Max in each warehouse, and where each
 * warehouse stands for it (on hand, what released transfer orders bring and take, Projected, the status).
 *
 * A CARD THAT SAVES ON ITS OWN, IN VIEW MODE TOO, like the Documents tab: it is not part of the item's form. Its buttons
 * are plain buttons (never a submit), its dialogs are portals, and the page's form ignores a submit that is not its own
 * (ItemDetailsPage's onSubmit guard), so saving a level never saves the item and Enter in a dialog never submits the
 * page. Shown with inventory.stocklevels.view; the actions with .edit.
 *
 * TWO MIN / MAX, NEVER ONE. The company line above the table keeps Item Definition's Minimum / Maximum Quantity in view
 * (the company's, the Dashboard's), and says when the warehouses' own Min add up to more than the company Maximum.
 */
export function ItemStockLevelsCard({ itemId, itemCode, companyMin, companyMax, canEdit }: ItemStockLevelsCardProps) {
  const phone = useMediaQuery('(max-width: 48em)')
  const [rows, setRows] = useState<StockLevelRowDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busyKey, setBusyKey] = useState<number | null>(null)

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  /* The item's rows: every warehouse with a level, inactive ones and an inactive item included (the card's query). Read
     again after every change; Previous / Next remount the page, so a new item reads its own. */
  useEffect(() => {
    if (itemId === null) return
    const controller = new AbortController()
    stockLevelsApi
      .forItem(itemId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setRows(result.rows.filter((r) => r.hasLevel))
        setError(null)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof ApiError ? err.messages.join(' ') : 'The stock levels could not be loaded.')
      })
    return () => controller.abort()
  }, [itemId, reloadToken])

  async function removeLevel(row: StockLevelRowDto) {
    const go = await confirm({
      title: 'Remove stock level',
      message: removeLevelQuestion(itemCode, row.warehouseCode),
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!go || itemId === null) return
    setBusyKey(row.warehouseId)
    try {
      await stockLevelsApi.remove(itemId, row.warehouseId, row.rowVersion, 'ItemCard')
      notify.success('Stock level removed.')
    } catch (err) {
      // 404 (removed meanwhile) and 409 (changed meanwhile) say so in the server's words; the rows are read again.
      notify.error(err instanceof ApiError ? err.messages.join(' ') : 'The stock level could not be removed.')
    } finally {
      setBusyKey(null)
      reload()
    }
  }

  const levels = rows ?? []
  const minSum = levels.reduce((sum, r) => sum + (r.minQuantityBase ?? 0), 0)
  const aboveCompanyMax = companyMax !== null && minSum > companyMax

  const header = (
    <Group justify="space-between" align="flex-start" mb="sm" wrap="wrap" gap="sm">
      <Box style={{ minWidth: 0, flex: '1 1 18rem' }}>
        <Text fw={600} fz="md">
          Stock levels per warehouse
        </Text>
        <Text c="dimmed" fz="sm">
          This item&apos;s Min and Max in each warehouse, in pcs. Fill to Max on a transfer order tops a warehouse up to
          them.
        </Text>
      </Box>
      {canEdit && itemId !== null ? (
        <Button
          type="button"
          variant="light"
          size="sm"
          leftSection={<IconPlus size={16} />}
          onClick={() => setDialog({ kind: 'set' })}
          data-item-levels-set
        >
          Set levels…
        </Button>
      ) : null}
    </Group>
  )

  if (itemId === null) {
    return (
      <Card radius="lg" p="lg" withBorder data-item-stock-levels>
        {header}
        <Text c="dimmed" fz="sm">
          Save the item first to set its stock levels per warehouse.
        </Text>
      </Card>
    )
  }

  /** The row's three actions; the pencil is disabled on an inactive warehouse with the server's sentence. */
  const actions = (row: StockLevelRowDto) => {
    const busy = busyKey === row.warehouseId
    const inactive = !row.warehouseIsActive
    return (
      <Group gap={4} justify="flex-end" wrap="nowrap">
        {canEdit ? (
          <Tooltip label={inactive ? inactiveWarehouseText(row.warehouseCode) : 'Edit level'} withArrow multiline maw={280}>
            {/* A disabled ActionIcon swallows the hover, so the span keeps the tooltip alive. */}
            <span>
              <ActionIcon
                type="button"
                variant="subtle"
                color="blue"
                aria-label={`Edit level at ${row.warehouseCode}`}
                disabled={inactive || busy}
                onClick={() => setDialog({ kind: 'edit', row })}
              >
                <IconPencil size={17} />
              </ActionIcon>
            </span>
          </Tooltip>
        ) : null}
        {canEdit ? (
          <Tooltip label="Remove level" withArrow>
            <ActionIcon
              type="button"
              variant="subtle"
              color="red"
              aria-label={`Remove level at ${row.warehouseCode}`}
              disabled={busy}
              onClick={() => void removeLevel(row)}
            >
              <IconTrash size={17} />
            </ActionIcon>
          </Tooltip>
        ) : null}
        <Tooltip label="History" withArrow>
          <ActionIcon
            type="button"
            variant="subtle"
            color="gray"
            aria-label={`History of the level at ${row.warehouseCode}`}
            onClick={() => setDialog({ kind: 'history', row })}
          >
            <IconClock size={17} />
          </ActionIcon>
        </Tooltip>
      </Group>
    )
  }

  /* The warehouse on its own line, its branch dimmed under it with the "inactive" badge beside the branch: a badge
     beside a long name was squeezed to "i…" in a narrow column. */
  const warehouseCell = (row: StockLevelRowDto) => (
    <Box>
      <Text fz="sm" fw={500}>
        {levelWarehouseText(row)}
      </Text>
      <Group gap={6} wrap="wrap">
        {row.branchName || row.branchCode ? (
          <Text fz="xs" c="dimmed">
            {row.branchName ?? row.branchCode}
          </Text>
        ) : null}
        {!row.warehouseIsActive ? (
          <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>
            inactive
          </Badge>
        ) : null}
      </Group>
    </Box>
  )

  return (
    <Card radius="lg" p="lg" withBorder data-item-stock-levels>
      {header}

      <Text fz="sm" mb="sm" data-item-levels-company>
        <Text span c="dimmed" fz="sm">
          Company: Minimum Quantity {formatNumber(companyMin ?? 0)} · Maximum Quantity{' '}
          {companyMax === null ? 'none' : formatNumber(companyMax)}.{' '}
        </Text>
        {aboveCompanyMax ? (
          <Text span c="orange.8" fz="sm" fw={500}>
            The warehouses&apos; Min add up to {formatNumber(minSum)} pcs, above the company Maximum Quantity (
            {formatNumber(companyMax)}).
          </Text>
        ) : (
          <Text span c="dimmed" fz="sm">
            The warehouses&apos; Min add up to {formatNumber(minSum)} pcs.
          </Text>
        )}
      </Text>

      {error ? (
        <Alert color="red" mb="sm">
          {error}
        </Alert>
      ) : null}

      {rows === null && !error ? (
        <Stack gap="xs">
          <Skeleton height={34} radius="sm" />
          <Skeleton height={34} radius="sm" />
        </Stack>
      ) : levels.length === 0 ? (
        <Text c="dimmed" fz="sm" py="sm">
          No warehouse has a Min / Max for this item yet.
          {canEdit ? ' Set them with Set levels…, or import them on Inventory › Stock Levels.' : ''}
        </Text>
      ) : phone ? (
        /* A phone: one card per warehouse - its figures on one line, the badge, the actions. */
        <Stack gap="xs">
          {levels.map((row) => (
            <Paper key={row.warehouseId} withBorder radius="md" p="sm" data-item-level-card={row.warehouseCode}>
              <Text fz="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>
                {levelPhoneLine(row)}
              </Text>
              {!row.warehouseIsActive ? (
                <Text fz="xs" c="dimmed">
                  inactive
                </Text>
              ) : null}
              <Group justify="space-between" mt={4} gap="xs" wrap="nowrap">
                <Box style={{ minWidth: 0 }}>
                  <StockLevelBadge status={row.status} />
                  <Text fz="xs" c="dimmed" mt={2}>
                    {updatedText(row)}
                  </Text>
                </Box>
                {actions(row)}
              </Group>
            </Paper>
          ))}
        </Stack>
      ) : (
        <Table.ScrollContainer minWidth={860}>
          <Table verticalSpacing="sm" highlightOnHover data-item-levels-table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th miw={190}>Warehouse</Table.Th>
                <Table.Th ta="right">On hand</Table.Th>
                <Table.Th ta="right">Coming in</Table.Th>
                <Table.Th ta="right">Going out</Table.Th>
                <Table.Th ta="right">Projected</Table.Th>
                <Table.Th ta="right">Min</Table.Th>
                <Table.Th ta="right">Max</Table.Th>
                <Table.Th miw={150}>Status</Table.Th>
                <Table.Th miw={130}>Updated</Table.Th>
                <Table.Th ta="right" miw={110} aria-label="Actions" />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {levels.map((row) => (
                <Table.Tr key={row.warehouseId} data-item-level-row={row.warehouseCode}>
                  <Table.Td>{warehouseCell(row)}</Table.Td>
                  <Table.Td ta="right">{formatNumber(row.onHandBase)}</Table.Td>
                  <Table.Td ta="right">
                    <Tooltip label={comingInText(row)} withArrow>
                      <Text span fz="sm">
                        {formatNumber(row.inOnTheWayBase + row.inToDispatchBase)}
                      </Text>
                    </Tooltip>
                  </Table.Td>
                  <Table.Td ta="right">{formatNumber(row.outToDispatchBase)}</Table.Td>
                  <Table.Td ta="right">
                    <Text
                      span
                      fz="sm"
                      fw={row.status === 'BelowMin' ? 700 : undefined}
                      c={row.status === 'BelowMin' ? 'red' : undefined}
                    >
                      {formatNumber(row.projectedBase)}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">{formatNumber(row.minQuantityBase)}</Table.Td>
                  <Table.Td ta="right">
                    {row.maxQuantityBase === null ? (
                      <Text span c="dimmed" fz="sm">
                        —
                      </Text>
                    ) : (
                      formatNumber(row.maxQuantityBase)
                    )}
                  </Table.Td>
                  <Table.Td>
                    <StockLevelBadge status={row.status} />
                  </Table.Td>
                  <Table.Td>
                    <Text fz="xs" c="dimmed">
                      {updatedText(row)}
                    </Text>
                  </Table.Td>
                  <Table.Td>{actions(row)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {dialog?.kind === 'set' || dialog?.kind === 'edit' ? (
        <StockLevelFormModal
          opened
          item={{ id: itemId, itemCode }}
          warehouse={
            dialog.kind === 'edit'
              ? { id: dialog.row.warehouseId, code: dialog.row.warehouseCode, name: dialog.row.warehouseName }
              : null
          }
          existing={levels}
          source="ItemCard"
          onClose={() => setDialog(null)}
          // The answer IS the card's query read again (every warehouse with a level, inactive ones included).
          onSaved={(result) => setRows(result.rows.filter((r) => r.hasLevel))}
          onStale={reload}
        />
      ) : null}

      {dialog?.kind === 'history' ? (
        <StockLevelHistoryModal
          opened
          itemId={itemId}
          itemCode={itemCode}
          warehouseId={dialog.row.warehouseId}
          warehouseCode={dialog.row.warehouseCode}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </Card>
  )
}
