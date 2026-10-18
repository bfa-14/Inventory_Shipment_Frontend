import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  Radio,
  ScrollArea,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useMediaQuery } from '@mantine/hooks'
import { IconPencil } from '@tabler/icons-react'
import type { BulkActionItemResult, BulkActionResult } from '../../api/documents'
import { ApiError } from '../../api/http'
import {
  nextStepApi,
  type NextStepGroupDto,
  type NextStepGroupRequest,
  type NextStepGroupResultDto,
  type NextStepPreviewDto,
} from '../../api/logistics/nextStep'
import { movementTypesApi, type MovementTypeLookupDto } from '../../api/masterdata/movementTypes'
import { portsApi, type PortLookupDto } from '../../api/masterdata/ports'
import { refreshGoodsReceiptsWaiting } from '../../hooks/useGoodsReceiptsWaiting'
import { BulkResultsModal } from '../documents/BulkResultsModal'
import { dateLabel } from '../documents/documentKind'
import { formatNumber, todayDateOnly } from '../format'
import { ShownRowsFooter } from '../ui/ShownRows'
import { useShownRows } from '../ui/useShownRows'
import { initialLeg, legProblem, retypeLeg, SEA, type LegValues, type StartMode } from './nextLeg'
import { NextLegFields } from './NextLegFields'
import { groupRoute, groupStepLabel, ONE_PER_CONTAINER_HINT, proposalSourceText, thenLabel } from './nextStep'
import { isStay } from './shipStep'

/** The containers one request takes when a group goes one movement per container: a long group in parts, with progress. */
const PER_REQUEST = 50

interface NextStepBulkModalProps {
  /** The ticked containers (2 or more; one opens NextStepModal). */
  containers: { id: number; containerRef: string }[]
  onClose(): void
  /** After the results are read: the ids that moved on (the host unticks them; the refused stay ticked). */
  onFinished(movedIds: number[]): void
}

/** What the reader chose for one group. */
interface GroupChoice {
  included: boolean
  onePerContainer: boolean
  then: boolean
  /** A new leg: its type, To, carrier, vessel… (the shared date and Start now / Plan only are the dialog's). */
  leg: LegValues | null
  /** One per container: each container's truck no. and ETA, else the group's. */
  perContainer: Record<number, { vessel: string; eta: string | null }>
}

/** One request of the processing: a group, or a part of a group going one movement per container. */
interface Part {
  group: NextStepGroupDto
  label: string
  body: NextStepGroupRequest
}

/**
 * "NEXT STEP…" FOR MANY CONTAINERS (script 81): the selection bar's dialog, for 2 containers or 300.
 *
 * ONE PREVIEW CALL groups the ticked containers by what they do next - the same step, movement, type, From and To - so
 * containers at different places or ports fall into separate groups by themselves. Each group is a row: included by
 * default, its step, its movement ("new" for a new leg), its route, its containers (expandable), its orders and
 * suppliers for information, and for a new leg "One movement for the group" / "One per container" (one truck each for a
 * road leg) and "Edit…" for its details. The containers that cannot move on are said apart, by reason.
 *
 * ONE DATE FOR EVERY GROUP, at the top: the day the containers arrived, cleared or left - never in the future for what
 * starts now or is recorded, never before a group's earliest.
 *
 * EACH GROUP RUNS ALONE AND IS ALL OR NOTHING INSIDE: one refusal never stops the others. A group going one movement
 * per container is sent in parts of 50 ("Moving on: 150 of 300"), each part all or nothing; a group that is one movement
 * is sent whole (a movement is never cut in two). The results come back as a table, the server's sentence on each row.
 */
export function NextStepBulkModal({ containers, onClose, onFinished }: NextStepBulkModalProps) {
  const [preview, setPreview] = useState<NextStepPreviewDto | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [types, setTypes] = useState<MovementTypeLookupDto[]>([])
  const [ports, setPorts] = useState<PortLookupDto[]>([])
  const [choices, setChoices] = useState<Record<string, GroupChoice>>({})
  const [date, setDate] = useState<string | null>(todayDateOnly())
  const [startMode, setStartMode] = useState<StartMode>('start')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [results, setResults] = useState<{ result: BulkActionResult; moved: number[] } | null>(null)
  const ids = useMemo(() => containers.map((c) => c.id), [containers])
  // A phone gets the whole screen: the groups table scrolls sideways inside it.
  const phone = useMediaQuery('(max-width: 36em)')

  useEffect(() => {
    const controller = new AbortController()
    nextStepApi
      .preview(ids, controller.signal)
      .then((dto) => {
        if (controller.signal.aborted) return
        setPreview(dto)
        const initial: Record<string, GroupChoice> = {}
        for (const g of dto.groups) {
          initial[g.groupKey] = {
            included: true,
            onePerContainer: g.onePerContainer,
            then: g.thenContainers > 0 && g.thenDefault,
            leg: g.isNewLeg ? initialLeg({ typeId: g.movementTypeId, toPlaceId: g.toPlaceId, stage: g.movementStage, placeId: g.fromPlaceId }, {}) : null,
            perContainer: {},
          }
        }
        setChoices(initial)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setLoadError(err instanceof ApiError ? err.message : 'The next steps could not be worked out.')
      })
    movementTypesApi.lookup(true).then((list) => !controller.signal.aborted && setTypes(list)).catch(() => {})
    portsApi.lookup(true).then((list) => !controller.signal.aborted && setPorts(list)).catch(() => {})
    return () => controller.abort()
  }, [ids])

  /** The ticked containers of each group, in the order they were ticked. */
  const members = useMemo(() => {
    const map = new Map<string, { id: number; ref: string }[]>()
    for (const row of preview?.containers ?? []) {
      if (!row.canMove || !row.groupKey) continue
      const list = map.get(row.groupKey) ?? []
      list.push({ id: row.containerId, ref: row.containerRef ?? String(row.containerId) })
      map.set(row.groupKey, list)
    }
    return map
  }, [preview])

  const groups = preview?.groups ?? []
  const today = todayDateOnly()
  const anyStartsNow = groups.some((g) => choices[g.groupKey]?.included && (!g.isNewLeg || startMode === 'start'))
  const dateProblem = !date ? 'Choose the date.' : anyStartsNow && date > today ? 'The date cannot be in the future: record each step on the day it really happened.' : null

  /** Why a group cannot be applied as it stands (its date, its To), null when it can. */
  function groupProblem(g: NextStepGroupDto, choice: GroupChoice | undefined): string | null {
    const earliest = g.notBefore?.slice(0, 10) ?? null
    if (date && earliest && date < earliest && !(g.isNewLeg && startMode === 'plan'))
      return g.kind === 'Complete'
        ? `The date is before ${g.movementNo ?? 'the movement'} started (${dateLabel(earliest)}).`
        : `The date is before the last of these containers got here (${dateLabel(earliest)}).`
    if (g.isNewLeg && choice?.leg) {
      const problem = legProblem(choice.leg, types)
      if (problem) return `${problem} Use Edit….`
    }
    return null
  }

  const included = groups.filter((g) => choices[g.groupKey]?.included)
  const invalid = included.filter((g) => groupProblem(g, choices[g.groupKey]) !== null)
  const containerCount = included.reduce((sum, g) => sum + (members.get(g.groupKey)?.length ?? 0), 0)

  function patch(key: string, next: Partial<GroupChoice>) {
    setChoices((current) => ({ ...current, [key]: { ...current[key], ...next } }))
  }

  function partsOf(g: NextStepGroupDto, choice: GroupChoice): Part[] {
    const list = members.get(g.groupKey) ?? []
    const label = groupStepLabel(g)
    if (!g.isNewLeg) {
      return [
        {
          group: g,
          label,
          body: {
            key: g.groupKey,
            kind: g.kind,
            movementId: g.movementId,
            rowVersion: g.movementRowVersion,
            containerIds: list.map((c) => c.id),
            date,
            then: g.kind === 'Complete' && choice.then && g.thenContainers > 0 ? { startNow: true, date } : null,
          },
        },
      ]
    }
    const leg = choice.leg
    const type = types.find((t) => String(t.id) === leg?.typeId) ?? null
    const sea = type?.stage === SEA
    const stay = isStay(type?.stage)
    const body = (part: { id: number }[]): NextStepGroupRequest => ({
      key: g.groupKey,
      kind: g.kind,
      containerIds: part.map((c) => c.id),
      movementTypeId: type?.id ?? null,
      fromPlaceId: type?.stage === 'Origin' && leg?.fromId ? Number(leg.fromId) : null,
      toPlaceId: stay ? g.fromPlaceId : leg?.toId ? Number(leg.toId) : null,
      startNow: startMode === 'start',
      date,
      eta: leg?.eta ?? null,
      carrierPartyId: leg?.carrierId ? Number(leg.carrierId) : null,
      vehicleOrVessel: leg?.vessel.trim() || null,
      voyageNo: sea ? leg?.voyage.trim() || null : null,
      reference: leg?.reference.trim() || null,
      blNo: sea ? leg?.blNo.trim() || null : null,
      blDate: sea ? (leg?.blDate ?? null) : null,
      notes: leg?.notes.trim() || null,
      onePerContainer: choice.onePerContainer,
      perContainer: choice.onePerContainer
        ? part
            .map((c) => ({ containerId: c.id, ...choice.perContainer[c.id] }))
            .filter((c) => c.vessel?.trim() || c.eta)
            .map((c) => ({ containerId: c.containerId, vehicleOrVessel: c.vessel?.trim() || null, eta: c.eta ?? null }))
        : null,
      copyToContainers: sea ? (leg?.copyToContainers ?? true) : true,
    })
    if (!choice.onePerContainer || list.length <= PER_REQUEST) return [{ group: g, label, body: body(list) }]
    const parts: Part[] = []
    for (let start = 0; start < list.length; start += PER_REQUEST) {
      const slice = list.slice(start, start + PER_REQUEST)
      parts.push({ group: g, label: `${label} (${formatNumber(start + 1)}-${formatNumber(start + slice.length)})`, body: body(slice) })
    }
    return parts
  }

  async function apply() {
    if (dateProblem || invalid.length > 0 || included.length === 0) return
    const parts = included.flatMap((g) => partsOf(g, choices[g.groupKey]))
    const total = parts.reduce((sum, p) => sum + p.body.containerIds.length, 0)
    setProgress({ done: 0, total })
    const items: BulkActionItemResult[] = []
    const moved: number[] = []
    let done = 0
    let delivered = false
    for (const [index, part] of parts.entries()) {
      let result: NextStepGroupResultDto | null = null
      let failure: string | null = null
      try {
        ;[result] = await nextStepApi.apply([part.body])
      } catch (err) {
        failure = err instanceof ApiError ? err.message : 'The step could not be taken.'
      }
      if (result?.ok) moved.push(...part.body.containerIds)
      if (result?.ok && part.group.movementStage === 'Delivery') delivered = true
      items.push({
        id: index,
        documentNumber: part.label,
        ok: result?.ok ?? false,
        code: result?.ok ? null : (result?.code ?? 'Refused'),
        message: result ? [result.message, result.ok ? result.goodsReceiptsMessage : null].filter(Boolean).join('\n') : failure,
        warning: result?.warnings.length ? result.warnings.join(' ') : null,
      })
      done += part.body.containerIds.length
      setProgress({ done, total })
    }
    if (delivered) void refreshGoodsReceiptsWaiting()
    const succeeded = items.filter((i) => i.ok).length
    setProgress(null)
    setResults({ result: { requested: items.length, succeeded, failed: items.length - succeeded, results: items }, moved })
  }

  if (results) {
    return (
      <BulkResultsModal
        opened
        title={`Next step - ${formatNumber(containers.length)} containers`}
        result={results.result}
        successLabel="Done"
        itemHeader="Step"
        labelOf={(item) => `step ${item.id + 1}`}
        onClose={() => onFinished(results.moved)}
      />
    )
  }

  const busy = progress !== null
  const editingGroup = editing ? (groups.find((g) => g.groupKey === editing) ?? null) : null

  return (
    <>
      <Modal
        opened={!editingGroup}
        onClose={onClose}
        title={`Next step - ${formatNumber(containers.length)} containers`}
        size="95rem"
        fullScreen={phone}
        closeOnClickOutside={!busy}
        withCloseButton={!busy}
      >
        {loadError ? (
          <Alert color="red">{loadError}</Alert>
        ) : !preview || types.length === 0 ? (
          <Group justify="center" py="md">
            <Loader size="sm" />
          </Group>
        ) : (
          <Stack gap="sm" data-next-step-bulk>
            <Group align="flex-start" gap="xl" wrap="wrap">
              <DateInput
                label="Date"
                withAsterisk
                valueFormat="DD/MM/YYYY"
                value={date}
                onChange={(next) => setDate(next ? String(next).slice(0, 10) : null)}
                error={dateProblem ?? undefined}
                description="The day the containers arrived, cleared or left: the same for every step."
                inputWrapperOrder={['label', 'input', 'description', 'error']}
                maw={340}
                data-next-step-date
              />
              {groups.some((g) => g.isNewLeg) ? (
                <Radio.Group label="New legs" value={startMode} onChange={(next) => setStartMode(next as StartMode)}>
                  <Group gap="md" mt={6}>
                    <Radio value="start" label="Start now" />
                    <Radio value="plan" label="Plan only" />
                  </Group>
                </Radio.Group>
              ) : null}
            </Group>

            {groups.length === 0 ? (
              <Alert color="red" py={6}>
                None of the ticked containers can move on.
              </Alert>
            ) : (
              <ScrollArea type="auto">
                <Table miw={1100} verticalSpacing={6} striped data-next-step-groups>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={36} />
                      <Table.Th>Step</Table.Th>
                      <Table.Th>Movement</Table.Th>
                      <Table.Th>From → To</Table.Th>
                      <Table.Th ta="right">Containers</Table.Th>
                      <Table.Th>Orders / suppliers</Table.Th>
                      <Table.Th>Movements</Table.Th>
                      <Table.Th w={90} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {groups.map((g) => {
                      const choice = choices[g.groupKey]
                      if (!choice) return null
                      const list = members.get(g.groupKey) ?? []
                      const problem = choice.included ? groupProblem(g, choice) : null
                      const leg = choice.leg
                      const legType = types.find((t) => String(t.id) === leg?.typeId) ?? null
                      // The group as the reader changed it: its type and To, for the label and the route.
                      const shown: NextStepGroupDto = legType
                        ? {
                            ...g,
                            movementTypeName: legType.typeName,
                            movementStage: legType.stage,
                            isStay: isStay(legType.stage),
                            toName: isStay(legType.stage)
                              ? g.fromName
                              : (ports.find((p) => String(p.id) === leg?.toId)?.portName ?? null),
                          }
                        : g
                      const othersArrive = g.kind === 'Complete' && g.movementContainerCount !== null && g.movementContainerCount > g.containers
                      return (
                        <Fragment key={g.groupKey}>
                          <Table.Tr data-next-step-group={g.kind}>
                            <Table.Td>
                              <Checkbox
                                size="xs"
                                aria-label={`Include ${groupStepLabel(shown)}`}
                                checked={choice.included}
                                onChange={(e) => patch(g.groupKey, { included: e.currentTarget.checked })}
                                disabled={busy}
                              />
                            </Table.Td>
                            <Table.Td>
                              <Text fz="sm" fw={600}>
                                {groupStepLabel(shown)}
                              </Text>
                              {g.isNewLeg && legType && String(g.movementTypeId) === leg?.typeId ? (
                                <Text fz="xs" c="dimmed">
                                  {proposalSourceText(g.proposalSource, g.proposalLegs, g.placeName ?? g.fromName, g.toPlaceId !== null || g.isStay)}
                                </Text>
                              ) : null}
                              {othersArrive ? (
                                <Text fz="xs" c="orange.8" data-next-step-others>
                                  {`${g.movementNo} is completed for all its ${formatNumber(g.movementContainerCount ?? 0)} containers: the ${formatNumber((g.movementContainerCount ?? 0) - g.containers)} not ticked arrive too.`}
                                </Text>
                              ) : null}
                              {g.kind === 'Complete' && g.thenContainers > 0 ? (
                                <Checkbox
                                  size="xs"
                                  mt={4}
                                  label={g.thenSame ? thenLabel(g) : 'Then start the suggested next leg on the same day'}
                                  checked={choice.then}
                                  onChange={(e) => patch(g.groupKey, { then: e.currentTarget.checked })}
                                  disabled={busy}
                                  data-next-step-then
                                />
                              ) : null}
                              {g.drafts > 0 ? (
                                <Text fz="xs" c="blue.7">
                                  {formatNumber(g.drafts)} draft{g.drafts === 1 ? '' : 's'}: confirmed first.
                                </Text>
                              ) : null}
                              {g.withTypedDates > 0 ? (
                                <Text fz="xs" c="orange.8">
                                  {formatNumber(g.withTypedDates)} with typed dates: the movements' dates will replace them.
                                </Text>
                              ) : null}
                              {problem ? (
                                <Text fz="xs" c="red.7" data-next-step-group-problem>
                                  {problem}
                                </Text>
                              ) : null}
                            </Table.Td>
                            <Table.Td>
                              <Text fz="sm" style={{ whiteSpace: 'nowrap' }}>
                                {g.isNewLeg ? 'new' : (g.movementNo ?? '—')}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              <Text fz="sm">{groupRoute(shown)}</Text>
                            </Table.Td>
                            <Table.Td ta="right">
                              <Anchor component="button" type="button" fz="sm" onClick={() => setExpanded(expanded === g.groupKey ? null : g.groupKey)} data-next-step-count>
                                {formatNumber(list.length)}
                              </Anchor>
                            </Table.Td>
                            <Table.Td>
                              <Text fz="xs" c="dimmed">
                                {[g.orderNumbers, g.supplierNames].filter(Boolean).join(' · ') || '—'}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              {g.isNewLeg ? (
                                <Stack gap={2}>
                                  <SegmentedControl
                                    size="xs"
                                    value={choice.onePerContainer ? 'each' : 'one'}
                                    onChange={(next) => patch(g.groupKey, { onePerContainer: next === 'each' })}
                                    data={[
                                      { value: 'one', label: 'One movement for the group' },
                                      { value: 'each', label: 'One per container' },
                                    ]}
                                    disabled={busy}
                                    data-next-step-one-per
                                  />
                                  {choice.onePerContainer ? (
                                    <Text fz="xs" c="dimmed">
                                      {ONE_PER_CONTAINER_HINT}
                                    </Text>
                                  ) : null}
                                </Stack>
                              ) : (
                                <Text fz="xs" c="dimmed">
                                  {g.kind === 'Complete' ? 'Completed' : 'Started'}
                                </Text>
                              )}
                            </Table.Td>
                            <Table.Td>
                              {g.isNewLeg ? (
                                <Button size="compact-xs" variant="light" leftSection={<IconPencil size={12} />} onClick={() => setEditing(g.groupKey)} disabled={busy}>
                                  Edit…
                                </Button>
                              ) : null}
                            </Table.Td>
                          </Table.Tr>
                          {expanded === g.groupKey ? (
                            <Table.Tr>
                              <Table.Td />
                              <Table.Td colSpan={7}>
                                <Text fz="xs" c="dimmed" data-next-step-refs>
                                  {list.map((c) => c.ref).join(', ')}
                                </Text>
                              </Table.Td>
                            </Table.Tr>
                          ) : null}
                        </Fragment>
                      )
                    })}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            )}

            {preview.blocked.length > 0 ? (
              <Alert color="gray" py={6} title={`Cannot move on (${formatNumber(preview.blocked.reduce((sum, b) => sum + b.containers, 0))})`} data-next-step-blocked>
                <Stack gap={2}>
                  {preview.blocked.map((b) => (
                    <Text key={b.blockGroup} fz="sm">
                      {`${b.blockGroup} (${formatNumber(b.containers)})`}
                      {b.containerRefs ? (
                        <Text span fz="xs" c="dimmed">
                          {` - ${b.containerRefs}${b.containers > 5 ? '…' : ''}`}
                        </Text>
                      ) : null}
                    </Text>
                  ))}
                </Stack>
              </Alert>
            ) : null}

            {progress ? (
              <Text fz="sm" fw={600} data-next-step-progress>
                Moving on: {formatNumber(progress.done)} of {formatNumber(progress.total)}
              </Text>
            ) : null}

            <Group justify="flex-end">
              <Button variant="default" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button
                onClick={() => void apply()}
                loading={busy}
                disabled={included.length === 0 || dateProblem !== null || invalid.length > 0}
                data-next-step-apply
              >
                {`Apply to ${formatNumber(containerCount)} container${containerCount === 1 ? '' : 's'} (${formatNumber(included.length)} step${included.length === 1 ? '' : 's'})`}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {editingGroup && choices[editingGroup.groupKey]?.leg ? (
        <GroupLegModal
          group={editingGroup}
          choice={choices[editingGroup.groupKey]}
          members={members.get(editingGroup.groupKey) ?? []}
          types={types}
          ports={ports}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            patch(editingGroup.groupKey, next)
            setEditing(null)
          }}
        />
      ) : null}
    </>
  )
}

interface GroupLegModalProps {
  group: NextStepGroupDto
  choice: GroupChoice
  members: { id: number; ref: string }[]
  types: MovementTypeLookupDto[]
  ports: PortLookupDto[]
  onClose(): void
  onSave(next: Pick<GroupChoice, 'leg' | 'perContainer'>): void
}

/**
 * "Edit…" on a group of new legs: its type, To, carrier, vehicle / vessel, voyage, B/L, ETA and notes; going one
 * movement per container, a truck no. and an ETA for each container (optional: empty takes the group's).
 */
function GroupLegModal({ group, choice, members, types, ports, onClose, onSave }: GroupLegModalProps) {
  const [leg, setLeg] = useState<LegValues>(choice.leg as LegValues)
  const [perContainer, setPerContainer] = useState(choice.perContainer)
  const [tried, setTried] = useState(false)
  const shown = useShownRows(members.length)
  const phone = useMediaQuery('(max-width: 36em)')
  const place = group.fromPlaceId !== null ? { id: group.fromPlaceId, name: group.fromName ?? group.placeName ?? '' } : null
  const proposal = { typeId: group.movementTypeId, toPlaceId: group.toPlaceId, placeId: group.fromPlaceId }
  const problem = legProblem(leg, types)

  return (
    <Modal opened onClose={onClose} title={`${groupStepLabel(group)} - ${formatNumber(members.length)} containers`} size="xl" fullScreen={phone}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setTried(true)
          if (!problem) onSave({ leg, perContainer })
        }}
      >
        <Stack gap="sm">
          <NextLegFields
            values={leg}
            onChange={(patch) => setLeg({ ...leg, ...patch })}
            onTypeChange={(typeId) => setLeg(retypeLeg(leg, typeId, types, proposal, {}))}
            types={types}
            ports={ports}
            place={place}
            neverMoved={group.kind === 'Ship'}
            typeHint={String(group.movementTypeId) === leg.typeId ? proposalSourceText(group.proposalSource, group.proposalLegs, group.placeName ?? group.fromName, group.toPlaceId !== null || group.isStay) : null}
            placeProblem={tried ? problem : null}
            withDate={false}
            containersWord="the containers"
          />
          {choice.onePerContainer ? (
            <>
              <Text fz="sm" fw={600}>
                Truck no. and ETA per container (empty = the group's)
              </Text>
              <ScrollArea.Autosize mah={320} type="auto">
                <Table verticalSpacing={4} data-next-step-per-container>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Container</Table.Th>
                      <Table.Th>Truck no.</Table.Th>
                      <Table.Th>ETA</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {members.slice(0, shown.limit).map((c) => {
                      const row = perContainer[c.id] ?? { vessel: '', eta: null }
                      return (
                        <Table.Tr key={c.id}>
                          <Table.Td>
                            <Badge variant="light" color="gray">
                              {c.ref}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            <TextInput
                              size="xs"
                              maxLength={100}
                              aria-label={`Truck no. of ${c.ref}`}
                              value={row.vessel}
                              onChange={(e) => {
                                const vessel = e.currentTarget.value
                                setPerContainer((current) => ({ ...current, [c.id]: { ...row, vessel } }))
                              }}
                            />
                          </Table.Td>
                          <Table.Td>
                            <DateInput
                              size="xs"
                              valueFormat="DD/MM/YYYY"
                              clearable
                              aria-label={`ETA of ${c.ref}`}
                              value={row.eta}
                              onChange={(next) => setPerContainer((current) => ({ ...current, [c.id]: { ...row, eta: next ? String(next).slice(0, 10) : null } }))}
                            />
                          </Table.Td>
                        </Table.Tr>
                      )
                    })}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
              <ShownRowsFooter limit={shown.limit} total={members.length} noun="containers" more={shown.more} all={shown.all} />
            </>
          ) : null}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Apply to the group</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}
