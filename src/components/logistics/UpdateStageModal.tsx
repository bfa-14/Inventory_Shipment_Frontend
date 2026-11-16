import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Badge, Button, Group, Loader, Modal, ScrollArea, Select, Stack, Table, Text, TextInput } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { ApiError } from '../../api/http'
import {
  shipmentStagesApi,
  stageColour,
  type ApplyShipmentStageResultDto,
  type ShipmentStageDto,
  type ShipmentStagePreviewRowDto,
} from '../../api/logistics/shipmentStages'
import { isoDate } from '../documents/documentKind'
import { formatNumber, todayDateOnly } from '../format'
import { DateInput } from '../ui/DateInput'
import { notify } from '../ui/notify'

interface UpdateStageModalProps {
  /** The ticked containers (one from a row's menu or its page). */
  containers: { id: number; containerRef: string }[]
  onClose(): void
  /** After an apply that moved something: the host reloads. */
  onDone(): void
}

type RowState = 'move' | 'there' | 'cannot'

const ROW_STATES: Record<RowState, { label: string; colour: string }> = {
  move: { label: 'Will move', colour: 'green' },
  there: { label: 'Already there', colour: 'gray' },
  cannot: { label: 'Cannot move', colour: 'red' },
}

const stateOf = (row: ShipmentStagePreviewRowDto): RowState => (row.alreadyThere ? 'there' : row.canMove ? 'move' : 'cannot')

/** What the stage records, in a sentence under the picker. */
function stageHint(stage: ShipmentStageDto): string {
  if (stage.kind === 1)
    return `${stage.movementTypeName ?? 'A leg'} ${stage.fromPlaceName ?? 'from the port of loading'} → ${stage.toPlaceName}, started on the date.`
  if (stage.kind === 2) return `The leg reaching ${stage.toPlaceName} is completed on the date.`
  return `The last leg is completed (one more leg to ${stage.toPlaceName} when needed) and the goods receipt is posted for the full quantity loaded.`
}

/**
 * (111) "Update stage…": the ticked containers move to the stage chosen, on one date. The server says first what each
 * does - will move, already there, or why it cannot - and the apply moves only the ones that can, each with its own
 * result. A leg may carry its vessel or truck no. and its ETA (for every container; a truck per container comes with the
 * import). An Offload stage also posts each container's goods receipt for the full quantity loaded.
 */
export function UpdateStageModal({ containers, onClose, onDone }: UpdateStageModalProps) {
  const phone = useMediaQuery('(max-width: 48em)')
  const [stages, setStages] = useState<ShipmentStageDto[] | null>(null)
  const [stageId, setStageId] = useState<string | null>(null)
  const [date, setDate] = useState<string>(todayDateOnly())
  const [vehicle, setVehicle] = useState('')
  const [eta, setEta] = useState<string | null>(null)
  const [preview, setPreview] = useState<ShipmentStagePreviewRowDto[] | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ApplyShipmentStageResultDto | null>(null)

  const ids = useMemo(() => containers.map((c) => c.id), [containers])
  const stage = stages?.find((s) => String(s.id) === stageId) ?? null

  useEffect(() => {
    shipmentStagesApi
      .list(true)
      .then(setStages)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'The stages could not be loaded.'))
  }, [])

  // The latest stage picked: an answer for a stage picked before it is dropped.
  const asked = useRef<string | null>(null)

  /** A stage is picked: the server says what it does to each container. */
  function chooseStage(next: string | null) {
    setStageId(next)
    setPreview(null)
    setError(null)
    asked.current = next
    if (next === null) return
    setPreviewing(true)
    shipmentStagesApi
      .preview(Number(next), ids)
      .then((rows) => {
        if (asked.current === next) setPreview(rows)
      })
      .catch((e: unknown) => {
        if (asked.current === next) setError(e instanceof ApiError ? e.message : 'The containers could not be checked.')
      })
      .finally(() => {
        if (asked.current === next) setPreviewing(false)
      })
  }

  const movable = preview?.filter((r) => stateOf(r) === 'move') ?? []
  const counts = { move: movable.length, there: preview?.filter((r) => stateOf(r) === 'there').length ?? 0, cannot: preview?.filter((r) => stateOf(r) === 'cannot').length ?? 0 }

  async function apply() {
    if (!stage || movable.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const answer = await shipmentStagesApi.apply(
        movable.map((r) => ({
          containerId: r.containerId,
          stageId: stage.id,
          date,
          vehicleOrVessel: stage.kind === 1 ? vehicle.trim() || null : null,
          eta: stage.kind === 1 ? eta : null,
        })),
      )
      setResult(answer)
      if (answer.moved > 0) {
        notify.success(answer.message)
        onDone()
      } else {
        notify.error(answer.message)
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The containers could not be moved.')
    } finally {
      setBusy(false)
    }
  }

  const title = containers.length === 1 ? `Update stage - ${containers[0].containerRef}` : `Update stage - ${formatNumber(containers.length)} containers`
  const isSea = stage?.movementTypeStage === 'Sea'

  return (
    <Modal opened onClose={onClose} title={title} size="lg" fullScreen={phone} closeOnClickOutside={!busy} withCloseButton={!busy}>
      {result ? (
        <Stack gap="sm" data-update-stage-result>
          <Alert color={result.refused > 0 ? 'orange' : 'green'} py={6}>
            {result.message}
          </Alert>
          <ScrollArea.Autosize mah={360}>
            <Stack gap={6}>
              {result.items.map((item) => (
                <Stack key={item.containerId} gap={0}>
                  <Group gap="xs" wrap="nowrap" align="flex-start">
                    <Badge size="sm" variant="light" color={item.ok ? 'green' : item.skipped ? 'gray' : 'red'} style={{ flexShrink: 0 }}>
                      {item.ok ? 'Moved' : item.skipped ? 'Already there' : 'Refused'}
                    </Badge>
                    <Text fz="sm">{item.message}</Text>
                  </Group>
                  {item.warning ? (
                    <Text fz="xs" c="orange.8" pl={90}>
                      {item.warning}
                    </Text>
                  ) : null}
                </Stack>
              ))}
            </Stack>
          </ScrollArea.Autosize>
          <Group justify="flex-end">
            <Button onClick={onClose}>Close</Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap="sm" data-update-stage-dialog>
          {error ? <Alert color="red">{error}</Alert> : null}
          <Group grow align="flex-start" wrap={phone ? 'wrap' : 'nowrap'}>
            <Select
              label="New stage"
              placeholder={stages === null ? 'Loading…' : 'Choose the stage'}
              data={(stages ?? []).map((s) => ({ value: String(s.id), label: s.stageName }))}
              value={stageId}
              onChange={chooseStage}
              disabled={busy}
              data-autofocus
            />
            <DateInput
              label="Date"
              valueFormat="DD/MM/YYYY"
              value={date}
              maxDate={new Date()}
              onChange={(next) => setDate(next ? isoDate(next) : todayDateOnly())}
              disabled={busy}
            />
          </Group>
          {stage ? (
            <Text fz="xs" c="dimmed" mt={-6}>
              {stageHint(stage)}
            </Text>
          ) : null}
          {stage?.kind === 1 ? (
            <Group grow align="flex-start" wrap={phone ? 'wrap' : 'nowrap'}>
              <TextInput
                label={isSea ? 'Vessel' : 'Truck no.'}
                placeholder="Optional"
                description={!isSea && containers.length > 1 ? 'Given to every container: one truck each comes with the import.' : undefined}
                value={vehicle}
                onChange={(e) => setVehicle(e.currentTarget.value)}
                maxLength={100}
                disabled={busy}
              />
              <DateInput label="ETA" placeholder="Optional" valueFormat="DD/MM/YYYY" value={eta} onChange={(next) => setEta(next ? isoDate(next) : null)} clearable disabled={busy} />
            </Group>
          ) : null}

          {previewing ? (
            <Group gap="xs">
              <Loader size="xs" />
              <Text fz="sm" c="dimmed">
                Checking the containers…
              </Text>
            </Group>
          ) : preview ? (
            <>
              <Group gap="xs">
                {(Object.keys(ROW_STATES) as RowState[])
                  .filter((key) => counts[key] > 0)
                  .map((key) => (
                    <Badge key={key} variant="light" color={ROW_STATES[key].colour}>
                      {ROW_STATES[key].label}: {formatNumber(counts[key])}
                    </Badge>
                  ))}
              </Group>
              {stage?.kind === 3 && movable.length > 0 ? (
                <Alert color="blue" py={6}>
                  Each container's goods receipt is posted for the full quantity loaded: the goods enter the stock. A short or damaged
                  container is corrected afterwards by cancelling its goods receipt and making it again.
                </Alert>
              ) : null}
              <ScrollArea.Autosize mah={300}>
                <Table striped withTableBorder fz="sm" verticalSpacing={4}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Container</Table.Th>
                      <Table.Th>Now</Table.Th>
                      <Table.Th></Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {preview.map((row) => {
                      const state = stateOf(row)
                      return (
                        <Table.Tr key={row.containerId}>
                          <Table.Td>
                            <Text fz="sm" fw={500}>
                              {row.containerRef ?? `#${row.containerId}`}
                            </Text>
                            {row.containerNo ? (
                              <Text fz="xs" c="dimmed">
                                {row.containerNo}
                              </Text>
                            ) : null}
                          </Table.Td>
                          <Table.Td>{row.currentStageName ?? '-'}</Table.Td>
                          <Table.Td>
                            <Badge size="sm" variant="light" color={ROW_STATES[state].colour}>
                              {ROW_STATES[state].label}
                            </Badge>
                            {state === 'cannot' && row.reason ? (
                              <Text fz="xs" c="dimmed" maw={280}>
                                {row.reason}
                              </Text>
                            ) : null}
                            {state === 'move' && row.receiveWarning ? (
                              <Text fz="xs" c="orange.8" maw={280}>
                                {row.receiveWarning}
                              </Text>
                            ) : null}
                          </Table.Td>
                        </Table.Tr>
                      )
                    })}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            </>
          ) : null}

          <Group justify="flex-end">
            <Button variant="default" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void apply()} loading={busy} disabled={!stage || movable.length === 0 || previewing}>
              {movable.length > 1 ? `Move ${formatNumber(movable.length)} containers` : 'Move'}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}

/** The badge of a container's stage in a list. */
export function StageBadge({ name, kind, receiptPending }: { name: string | null; kind: number | null; receiptPending?: boolean }) {
  if (!name) return <Text c="dimmed">-</Text>
  return (
    <Stack gap={2}>
      <Badge size="sm" variant="light" color={stageColour(kind, name)} w="fit-content" style={{ whiteSpace: 'nowrap' }}>
        {name}
      </Badge>
      {receiptPending ? (
        <Text fz="xs" c="orange.8">
          Goods receipt waiting
        </Text>
      ) : null}
    </Stack>
  )
}
