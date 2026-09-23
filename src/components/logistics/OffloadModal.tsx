import { useState } from 'react'
import { Alert, Button, Group, Modal, NumberInput, ScrollArea, Select, Stack, Table, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import type { OffloadRequest } from '../../api/logistics/containers'
import type { WarehouseLookupDto } from '../../api/types'
import { isoDate } from '../documents/documentKind'
import { formatNumber } from '../format'
import { lineBase, type LoadLine } from './containerForm'

interface OffloadModalProps {
  opened: boolean
  onClose: () => void
  lines: LoadLine[]
  warehouses: WarehouseLookupDto[]
  defaultWarehouseId: number | null
  busy: boolean
  error: string | null
  onSubmit: (request: Omit<OffloadRequest, 'rowVersion'>) => void
}

interface Received {
  quantity: number | ''
  reason: string
}

/**
 * The goods arrive: what was loaded, what actually came off the truck, and why the two differ. A
 * short line needs a reason — the server refuses it too — and the difference is not received.
 */
export function OffloadModal({ opened, onClose, lines, warehouses, defaultWarehouseId, busy, error, onSubmit }: OffloadModalProps) {
  const [received, setReceived] = useState<Record<string, Received>>({})
  const [warehouseId, setWarehouseId] = useState<string | null>(defaultWarehouseId === null ? null : String(defaultWarehouseId))
  const [offloadedDate, setOffloadedDate] = useState<string | null>(isoDate(new Date()))
  const [touched, setTouched] = useState(false)

  const valueOf = (line: LoadLine): Received => received[line.key] ?? { quantity: lineBase(line), reason: '' }

  const problems = lines
    .map((line) => {
      const value = valueOf(line)
      if (value.quantity === '') return `${line.itemCode}: the received quantity is required.`
      if (value.quantity > lineBase(line)) return `${line.itemCode}: more received than loaded.`
      if (value.quantity !== lineBase(line) && !value.reason.trim()) return `${line.itemCode}: a reason is required.`
      return null
    })
    .filter((p): p is string => p !== null)

  function submit() {
    setTouched(true)
    if (problems.length > 0 || !warehouseId) return
    onSubmit({
      warehouseId: Number(warehouseId),
      offloadedDate,
      lines: lines
        .filter((line) => line.lineId !== null)
        .map((line) => {
          const value = valueOf(line)
          return {
            lineId: line.lineId as number,
            receivedQuantityBase: Number(value.quantity),
            varianceReason: value.reason.trim() || null,
          }
        }),
    })
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Offload container" size="70rem" closeOnClickOutside={!busy}>
      <Stack>
        <Group grow align="flex-start">
          <Select
            label="Warehouse"
            withAsterisk
            data={warehouses.map((w) => ({ value: String(w.id), label: `${w.warehouseCode} - ${w.warehouseName}` }))}
            value={warehouseId}
            onChange={setWarehouseId}
            error={touched && !warehouseId ? 'Pick the warehouse the goods enter.' : undefined}
          />
          <DateInput label="Offload date" withAsterisk valueFormat="DD/MM/YYYY" value={offloadedDate} onChange={(v) => setOffloadedDate(v ? String(v).slice(0, 10) : null)} />
        </Group>

        <ScrollArea type="auto">
          <Table miw={760} verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Item</Table.Th>
                <Table.Th>PI No.</Table.Th>
                <Table.Th ta="right">Loaded (base)</Table.Th>
                <Table.Th w={140}>Received (base)</Table.Th>
                <Table.Th>Reason</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lines.map((line) => {
                const value = valueOf(line)
                const loaded = lineBase(line)
                const differs = value.quantity !== loaded
                return (
                  <Table.Tr key={line.key}>
                    <Table.Td>
                      <Text fz="sm" fw={600}>{line.itemCode}</Text>
                      <Text fz="xs" c="dimmed">{line.itemName}</Text>
                    </Table.Td>
                    <Table.Td>{line.invoiceNumber ?? '—'}</Table.Td>
                    <Table.Td ta="right">{formatNumber(loaded)}</Table.Td>
                    <Table.Td>
                      <NumberInput
                        size="xs"
                        min={0}
                        max={loaded}
                        allowDecimal={false}
                        thousandSeparator=","
                        value={value.quantity}
                        onChange={(v) => setReceived((all) => ({ ...all, [line.key]: { ...value, quantity: v === '' ? '' : Number(v) } }))}
                        error={touched && value.quantity !== '' && value.quantity > loaded ? 'Above loaded' : undefined}
                        aria-label={`Received quantity of ${line.itemCode}`}
                      />
                    </Table.Td>
                    <Table.Td>
                      <TextInput
                        size="xs"
                        maxLength={200}
                        placeholder={differs ? 'Required: damaged, short-shipped...' : 'Only when it differs'}
                        withAsterisk={differs}
                        value={value.reason}
                        onChange={(e) => {
                          const reason = e.currentTarget.value
                          setReceived((all) => ({ ...all, [line.key]: { ...value, reason } }))
                        }}
                        error={touched && differs && !value.reason.trim() ? 'Reason required' : undefined}
                        aria-label={`Variance reason for ${line.itemCode}`}
                      />
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>

        {touched && problems.length > 0 ? <Alert color="orange">{problems.join(' ')}</Alert> : null}
        {error ? <Alert color="red">{error}</Alert> : null}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button color="green" onClick={submit} loading={busy}>
            Offload - receive into stock
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
