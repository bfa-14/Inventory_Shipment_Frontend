import { useEffect, useState } from 'react'
import { Alert, Button, Group, Loader, ScrollArea, Stack, Table, Text, Textarea, TextInput } from '@mantine/core'
import { IconClipboardText } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { containersApi, type ContainerNumberDto } from '../../api/logistics/containers'
import { formatNumber } from '../format'
import { FormModal } from '../ui/FormModal'
import { notify } from '../ui/notify'

export interface NumberedContainer {
  id: number
  containerRef: string
  containerNo: string | null
}

interface NumberRow {
  id: number
  containerRef: string
  containerNo: string
  sealNo: string
}

interface ContainerNumbersModalProps {
  containers: NumberedContainer[]
  onClose(): void
  onSaved(rows: ContainerNumberDto[]): void
}

/** How many containers are read at once for their seal numbers. */
const PARALLEL_READS = 6

/**
 * "Container numbers…" for the ticked containers: the list the forwarder sends after loading, typed
 * or pasted in one go.
 *
 * BOTH NUMBERS ARE SENT FOR EVERY ROW, and the server writes both — an empty box clears. So the grid
 * must start from what each container carries now: the list rows have the container no. but not the
 * seal, which is read from each container before the grid can be saved. Saving an unread seal as
 * empty would wipe it.
 *
 * "Paste list" takes one line per container in the order of the grid: "CONTAINERNO SEAL", separated
 * by a tab, a comma, a semicolon or spaces. A line without a seal keeps the seal already in the grid.
 * A number typed twice or used by another container is the server's 409, shown under the grid.
 */
export function ContainerNumbersModal({ containers, onClose, onSaved }: ContainerNumbersModalProps) {
  const [rows, setRows] = useState<NumberRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasted, setPasted] = useState('')
  const [pasteNote, setPasteNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    async function readAll() {
      const seals = new Map<number, string | null>()
      let next = 0
      async function worker() {
        while (next < containers.length) {
          const container = containers[next++]
          const full = await containersApi.get(container.id, controller.signal)
          seals.set(container.id, full.sealNo)
        }
      }
      await Promise.all(Array.from({ length: Math.min(PARALLEL_READS, containers.length) }, worker))
      return seals
    }
    readAll()
      .then((seals) =>
        setRows(
          containers.map((c) => ({
            id: c.id,
            containerRef: c.containerRef,
            containerNo: c.containerNo ?? '',
            sealNo: seals.get(c.id) ?? '',
          })),
        ),
      )
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setLoadError(err instanceof ApiError ? err.message : 'The containers could not be read.')
      })
    return () => controller.abort()
  }, [containers])

  function patch(id: number, next: Partial<NumberRow>) {
    setRows((current) => current?.map((row) => (row.id === id ? { ...row, ...next } : row)) ?? null)
  }

  function applyPasted() {
    if (!rows) return
    const lines = pasted
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    const updated = rows.map((row, index) => {
      const line = lines[index]
      if (line === undefined) return row
      const [containerNo, sealNo] = line.split(/[\t,;]+|\s+/).filter((part) => part.length > 0)
      return {
        ...row,
        containerNo: (containerNo ?? '').toUpperCase(),
        sealNo: sealNo ?? row.sealNo,
      }
    })
    setRows(updated)
    setError(null)
    const applied = Math.min(lines.length, rows.length)
    const extra = lines.length - rows.length
    setPasteNote(
      `${formatNumber(applied)} line${applied === 1 ? '' : 's'} applied in the order of the grid.` +
        (extra > 0 ? ` ${formatNumber(extra)} more line${extra === 1 ? ' was' : 's were'} ignored: only ${formatNumber(rows.length)} containers are selected.` : ''),
    )
    setPasteOpen(false)
    setPasted('')
  }

  async function save() {
    if (!rows) return
    setSaving(true)
    setError(null)
    try {
      const saved = await containersApi.setNumbers(
        rows.map((row) => ({
          containerId: row.id,
          containerNo: row.containerNo.trim() ? row.containerNo.trim().toUpperCase() : null,
          sealNo: row.sealNo.trim() || null,
        })),
      )
      notify.success(`Numbers saved for ${formatNumber(saved.length)} container${saved.length === 1 ? '' : 's'}.`)
      onSaved(saved)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The numbers could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormModal
      opened
      title={`Container numbers - ${formatNumber(containers.length)} container${containers.length === 1 ? '' : 's'}`}
      onSubmit={() => void save()}
      onClose={onClose}
      saving={saving}
      saveDisabled={rows === null}
      size="lg"
    >
      <Stack gap="sm">
        {loadError ? <Alert color="red">{loadError}</Alert> : null}
        {rows === null && !loadError ? (
          <Group gap="xs">
            <Loader size="xs" />
            <Text fz="sm" c="dimmed">
              Reading the current numbers…
            </Text>
          </Group>
        ) : null}

        {rows ? (
          <>
            <ScrollArea.Autosize mah="50vh" type="auto">
              <Table verticalSpacing={4} data-numbers-grid>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Ref.</Table.Th>
                    <Table.Th>Container No.</Table.Th>
                    <Table.Th>Seal No.</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((row) => (
                    <Table.Tr key={row.id}>
                      <Table.Td>
                        <Text fz="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>
                          {row.containerRef}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <TextInput
                          size="xs"
                          maxLength={20}
                          placeholder="MSKU1234565"
                          value={row.containerNo}
                          onChange={(e) => patch(row.id, { containerNo: e.currentTarget.value.toUpperCase() })}
                          aria-label={`Container No. of ${row.containerRef}`}
                        />
                      </Table.Td>
                      <Table.Td>
                        <TextInput
                          size="xs"
                          maxLength={30}
                          value={row.sealNo}
                          onChange={(e) => patch(row.id, { sealNo: e.currentTarget.value })}
                          aria-label={`Seal No. of ${row.containerRef}`}
                        />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>

            {error ? (
              <Alert color="red" data-numbers-error>
                {error}
              </Alert>
            ) : null}
            {pasteNote ? (
              <Text fz="xs" c="dimmed">
                {pasteNote}
              </Text>
            ) : null}

            {pasteOpen ? (
              <Stack gap={6}>
                <Textarea
                  label="Paste list"
                  description="One line per container, in the order of the grid: container no. and seal no., separated by a tab, a comma, a semicolon or spaces. A line without a seal keeps the seal in the grid."
                  placeholder={'MSKU1234565 SL-001\nTGHU7654321 SL-002'}
                  autosize
                  minRows={4}
                  maxRows={12}
                  value={pasted}
                  onChange={(e) => setPasted(e.currentTarget.value)}
                  data-paste-list
                />
                <Group gap="xs" justify="flex-end">
                  <Button size="xs" variant="default" onClick={() => setPasteOpen(false)}>
                    Close
                  </Button>
                  <Button size="xs" onClick={applyPasted} disabled={!pasted.trim()}>
                    Apply to the grid
                  </Button>
                </Group>
              </Stack>
            ) : (
              <Group>
                <Button size="xs" variant="light" leftSection={<IconClipboardText size={14} />} onClick={() => setPasteOpen(true)}>
                  Paste list
                </Button>
              </Group>
            )}
          </>
        ) : null}
      </Stack>
    </FormModal>
  )
}
