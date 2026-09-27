import { useEffect, useState } from 'react'
import { Alert, Checkbox, Group, Loader, NumberInput, ScrollArea, Select, Stack, Table, Text, TextInput } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconSearch } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { containersApi, type AvailablePoLineDto } from '../../api/logistics/containers'
import { partiesApi } from '../../api/masterdata/parties'
import type { PartyLookupDto } from '../../api/types'
import { dateLabel } from '../documents/documentKind'
import { formatNumber, numberInputValue } from '../format'
import { supplierLabel } from '../purchase/purchaseKind'
import { FormModal } from '../ui/FormModal'
import { fromPoLine, type LoadLine } from './containerForm'

interface AddPoLinesModalProps {
  opened: boolean
  onClose: () => void
  /** The container being edited: what it holds of a line counts apart. */
  containerId: number | null
  /** Order lines already on the page: they are not offered again (their quantity is edited in the grid). */
  loadedPoLineIds: number[]
  onAdd: (lines: LoadLine[]) => void
}

interface Pick {
  checked: boolean
  quantity: number | ''
}

/**
 * "Add items from purchase orders…" on the container page: the lines of ANY approved order that can
 * still be loaded (search by order, item or supplier; filter by supplier), ticked with a quantity in
 * pieces. The picked lines join the loading plan; nothing is saved until the container is.
 */
export function AddPoLinesModal({ opened, onClose, containerId, loadedPoLineIds, onAdd }: AddPoLinesModalProps) {
  const [search, setSearch] = useState('')
  const [debounced] = useDebouncedValue(search, 350)
  const [supplierId, setSupplierId] = useState<string | null>(null)
  const [suppliers, setSuppliers] = useState<PartyLookupDto[]>([])
  const [rows, setRows] = useState<AvailablePoLineDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picks, setPicks] = useState<Record<number, Pick>>({})

  useEffect(() => {
    if (opened) partiesApi.lookup({ partyType: 'Supplier' }).then(setSuppliers).catch(() => {})
  }, [opened])

  useEffect(() => {
    if (!opened) return
    // The previous rows stay on screen until the new answer replaces them.
    const controller = new AbortController()
    containersApi
      .availablePoLines(
        { search: debounced || undefined, supplierId: supplierId ? Number(supplierId) : undefined, containerId: containerId ?? undefined },
        controller.signal,
      )
      .then((list) => {
        setError(null)
        setRows(list.filter((row) => !loadedPoLineIds.includes(row.poLineId) && row.availableBase > 0))
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof ApiError ? err.message : 'The order lines could not be loaded.')
      })
    return () => controller.abort()
  }, [opened, debounced, supplierId, containerId, loadedPoLineIds])

  const pickOf = (row: AvailablePoLineDto): Pick => picks[row.poLineId] ?? { checked: false, quantity: row.availableBase }
  const chosen = (rows ?? []).filter((row) => pickOf(row).checked && Number(pickOf(row).quantity || 0) > 0)
  const invalid = chosen.some((row) => Number(pickOf(row).quantity) > row.availableBase)

  function add() {
    onAdd(
      chosen.map((row) =>
        fromPoLine(row, Number(pickOf(row).quantity), (row.itemOilQtyPerUnit ?? 0) > 0, row.itemOilQtyPerUnit),
      ),
    )
    setPicks({})
  }

  return (
    <FormModal
      opened={opened}
      onClose={onClose}
      title="Add items from purchase orders"
      size="80rem"
      saveLabel={chosen.length ? `Add ${chosen.length} line(s)` : 'Add'}
      saveDisabled={chosen.length === 0 || invalid}
      onSubmit={add}
    >
      <Stack gap="sm">
        <Group grow wrap="wrap">
          <TextInput
            leftSection={<IconSearch size={16} />}
            placeholder="Order no., item code or name, supplier"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          <Select
            placeholder="Any supplier"
            data={suppliers.map((s) => ({ value: String(s.id), label: supplierLabel(s) }))}
            value={supplierId}
            onChange={setSupplierId}
            searchable
            clearable
          />
        </Group>
        {error ? <Alert color="red">{error}</Alert> : null}
        {rows === null && !error ? <Loader size="sm" /> : null}
        {rows && rows.length === 0 ? (
          <Text c="dimmed" ta="center" py="md">
            No approved order line is left to load.
          </Text>
        ) : null}
        {rows && rows.length > 0 ? (
          <ScrollArea type="auto" mah={480}>
            <Table miw={980} verticalSpacing={4} striped stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={36} />
                  <Table.Th>Order</Table.Th>
                  <Table.Th>Supplier</Table.Th>
                  <Table.Th>Item</Table.Th>
                  <Table.Th ta="right">Ordered</Table.Th>
                  <Table.Th ta="right">Loaded elsewhere</Table.Th>
                  <Table.Th ta="right">Available</Table.Th>
                  <Table.Th w={130}>Load qty (pcs)</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row) => {
                  const pick = pickOf(row)
                  const tooMuch = Number(pick.quantity || 0) > row.availableBase
                  return (
                    <Table.Tr key={row.poLineId}>
                      <Table.Td>
                        <Checkbox
                          checked={pick.checked}
                          onChange={(e) => {
                            const checked = e.currentTarget.checked
                            setPicks((all) => ({ ...all, [row.poLineId]: { ...pick, checked } }))
                          }}
                          aria-label={`Load ${row.itemCode} of ${row.purchaseOrderNumber}`}
                        />
                      </Table.Td>
                      <Table.Td>
                        <Text fz="sm" fw={600}>
                          {row.purchaseOrderNumber}
                        </Text>
                        <Text fz="xs" c="dimmed">
                          {dateLabel(row.orderDate)}
                        </Text>
                      </Table.Td>
                      <Table.Td>{row.supplierName}</Table.Td>
                      <Table.Td>
                        <Text fz="sm" fw={600}>
                          {row.itemCode}
                        </Text>
                        <Text fz="xs" c="dimmed">
                          {row.itemName}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">{formatNumber(row.orderedBase)}</Table.Td>
                      <Table.Td ta="right">{formatNumber(row.loadedElsewhereBase)}</Table.Td>
                      <Table.Td ta="right" fw={600}>
                        {formatNumber(row.availableBase)}
                      </Table.Td>
                      <Table.Td>
                        <NumberInput
                          size="xs"
                          min={1}
                          max={row.availableBase}
                          allowDecimal={false}
                          allowNegative={false}
                          thousandSeparator=","
                          disabled={!pick.checked}
                          value={pick.quantity}
                          error={tooMuch ? `Max ${formatNumber(row.availableBase)}` : undefined}
                          onChange={(next) => setPicks((all) => ({ ...all, [row.poLineId]: { ...pick, quantity: numberInputValue(next) ?? '' } }))}
                          aria-label={`Quantity of ${row.itemCode}`}
                        />
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        ) : null}
      </Stack>
    </FormModal>
  )
}
