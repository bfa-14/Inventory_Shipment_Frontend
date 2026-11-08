import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconPencil, IconPlus, IconRefresh, IconTrash } from '@tabler/icons-react'
import { Link } from 'react-router'
import { ApiError } from '../../api/http'
import { movementTypesApi, type MovementTypeLookupDto } from '../../api/masterdata/movementTypes'
import { portsApi, type PortLookupDto } from '../../api/masterdata/ports'
import {
  STAGE_KINDS,
  shipmentStagesApi,
  stageColour,
  type ShipmentStageCheckDto,
  type ShipmentStageDto,
  type ShipmentStageKind,
} from '../../api/logistics/shipmentStages'
import { useAuth } from '../../auth/useAuth'
import { formatNumber } from '../../components/format'
import { confirm } from '../../components/ui/confirm'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { PERMISSIONS } from '../../navigation'

export const SHIPMENT_STAGES_ROUTE = '/setup/master-data/shipment-stages'

const PORT_OF_LOADING = '__loading'

/** What the stage records, in words: "Sea freight · port of loading → Dar es Salaam". */
function stageRoute(stage: ShipmentStageDto): string {
  if (stage.kind === 2) return `Arrives at ${stage.toPlaceName}`
  if (stage.kind === 3) return `Offloaded at ${stage.toPlaceName} (last leg: ${stage.movementTypeName ?? '-'})`
  return `${stage.movementTypeName ?? '-'} · ${stage.fromPlaceName ?? 'port of loading'} → ${stage.toPlaceName}`
}

interface FormState {
  stageName: string
  kind: string
  movementTypeId: string | null
  fromPlaceId: string | null
  toPlaceId: string | null
  sortOrder: number
  isActive: boolean
}

const EMPTY_FORM: FormState = { stageName: '', kind: '1', movementTypeId: null, fromPlaceId: PORT_OF_LOADING, toPlaceId: null, sortOrder: 0, isActive: true }

/**
 * (111) Backoffice › Master Data › Shipment Stages: the stages a container moves through, in their order - a leg
 * ("Dispatched to Dar es Salaam", "Dar es Salaam → Mokambo"), an arrival ("At port Dar es Salaam") or the offload
 * ("Offloaded in Lubumbashi", which posts the goods receipt). Below them, where the containers stand now, and the ones
 * whose route the stages do not describe, to decide on.
 */
export function ShipmentStagesPage() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission(PERMISSIONS.shipmentStagesManage)
  const phone = useMediaQuery('(max-width: 48em)')
  const [stages, setStages] = useState<ShipmentStageDto[] | null>(null)
  const [check, setCheck] = useState<ShipmentStageCheckDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [types, setTypes] = useState<MovementTypeLookupDto[]>([])
  const [ports, setPorts] = useState<PortLookupDto[]>([])
  const [editing, setEditing] = useState<ShipmentStageDto | 'new' | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(() => {
    shipmentStagesApi
      .list(false)
      .then((rows) => {
        setStages(rows)
        setError(null)
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'The stages could not be loaded.'))
    shipmentStagesApi
      .check()
      .then(setCheck)
      .catch(() => setCheck(null))
  }, [])

  useEffect(() => {
    load()
    movementTypesApi.lookup(false).then(setTypes).catch(() => {})
    portsApi.lookup(false).then(setPorts).catch(() => {})
  }, [load])

  function open(stage: ShipmentStageDto | 'new') {
    setFormError(null)
    setEditing(stage)
    setForm(
      stage === 'new'
        ? { ...EMPTY_FORM, sortOrder: ((stages ?? []).reduce((max, s) => Math.max(max, s.sortOrder), 0) || 0) + 10 }
        : {
            stageName: stage.stageName,
            kind: String(stage.kind),
            movementTypeId: stage.movementTypeId === null ? null : String(stage.movementTypeId),
            fromPlaceId: stage.fromPlaceId === null ? PORT_OF_LOADING : String(stage.fromPlaceId),
            toPlaceId: String(stage.toPlaceId),
            sortOrder: stage.sortOrder,
            isActive: stage.isActive,
          },
    )
  }

  async function save() {
    if (editing === null) return
    const kind = Number(form.kind) as ShipmentStageKind
    if (!form.stageName.trim() || form.toPlaceId === null || (kind !== 2 && form.movementTypeId === null)) {
      setFormError(kind === 2 ? 'Give the name and the place.' : 'Give the name, the movement type and the place.')
      return
    }
    setSaving(true)
    setFormError(null)
    const payload = {
      stageName: form.stageName.trim(),
      kind,
      movementTypeId: kind === 2 || form.movementTypeId === null ? null : Number(form.movementTypeId),
      fromPlaceId: kind !== 1 || form.fromPlaceId === null || form.fromPlaceId === PORT_OF_LOADING ? null : Number(form.fromPlaceId),
      toPlaceId: Number(form.toPlaceId),
      sortOrder: form.sortOrder,
      isActive: form.isActive,
      rowVersion: editing === 'new' ? null : editing.rowVersion,
    }
    try {
      if (editing === 'new') await shipmentStagesApi.create(payload)
      else await shipmentStagesApi.update(editing.id, payload)
      notify.success(`Stage "${payload.stageName}" saved.`)
      setEditing(null)
      load()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'The stage could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(stage: ShipmentStageDto) {
    const ok = await confirm({
      title: 'Delete stage',
      message: `Delete "${stage.stageName}"? The movements it made stay; containers at it will show where they stand by the other stages.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    try {
      await shipmentStagesApi.remove(stage.id)
      notify.success(`Stage "${stage.stageName}" deleted.`)
      load()
    } catch (e) {
      notify.error(e instanceof ApiError ? e.message : 'The stage could not be deleted.')
    }
  }

  const kind = Number(form.kind) as ShipmentStageKind
  const typeOptions = types.map((t) => ({ value: String(t.id), label: `${t.typeName} (${t.stage})${t.isActive ? '' : ' - inactive'}` }))
  const portOptions = ports.map((p) => ({ value: String(p.id), label: `${p.portName} (${p.portCode})${p.isActive ? '' : ' - inactive'}` }))

  return (
    <div>
      <PageHeader
        title="Shipment Stages"
        subtitle="The stages a container moves through. Users choose a container's new stage; the movements are recorded behind it."
        actions={
          <>
            <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={load}>
              Refresh
            </Button>
            {canManage ? (
              <Button leftSection={<IconPlus size={16} />} onClick={() => open('new')}>
                New stage
              </Button>
            ) : null}
          </>
        }
      />

      {error ? (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" withBorder mb="lg" style={{ overflowX: 'auto' }}>
        <Table striped verticalSpacing="xs" miw={620}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={60}>Order</Table.Th>
              <Table.Th>Stage</Table.Th>
              <Table.Th>Kind</Table.Th>
              <Table.Th>What it records</Table.Th>
              <Table.Th>Containers now</Table.Th>
              <Table.Th w={110}></Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            <Table.Tr>
              <Table.Td>-</Table.Td>
              <Table.Td>
                <Badge variant="light" color="gray">
                  Pending
                </Badge>
              </Table.Td>
              <Table.Td>-</Table.Td>
              <Table.Td>
                <Text fz="sm" c="dimmed">
                  Not dispatched yet (always the first stage).
                </Text>
              </Table.Td>
              <Table.Td>{formatNumber(check?.stages.filter((s) => s.stageKind === 0).reduce((n, s) => n + s.containers, 0) ?? 0)}</Table.Td>
              <Table.Td></Table.Td>
            </Table.Tr>
            {(stages ?? []).map((stage) => (
              <Table.Tr key={stage.id} style={stage.isActive ? undefined : { opacity: 0.55 }}>
                <Table.Td>{stage.sortOrder}</Table.Td>
                <Table.Td>
                  <Group gap={6}>
                    <Badge variant="light" color={stageColour(stage.kind)}>
                      {stage.stageName}
                    </Badge>
                    {stage.isActive ? null : (
                      <Text fz="xs" c="dimmed">
                        inactive
                      </Text>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>{stage.kindName}</Table.Td>
                <Table.Td>
                  <Text fz="sm">{stageRoute(stage)}</Text>
                </Table.Td>
                <Table.Td>{formatNumber(check?.stages.find((s) => s.stageId === stage.id)?.containers ?? 0)}</Table.Td>
                <Table.Td>
                  {canManage ? (
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <Button size="compact-xs" variant="subtle" leftSection={<IconPencil size={14} />} onClick={() => open(stage)}>
                        Edit
                      </Button>
                      <Button size="compact-xs" variant="subtle" color="red" aria-label={`Delete ${stage.stageName}`} onClick={() => void remove(stage)}>
                        <IconTrash size={14} />
                      </Button>
                    </Group>
                  ) : null}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>

      <Title order={4} mb="xs">
        Containers not on a stage
      </Title>
      {check === null ? (
        <Text c="dimmed" fz="sm">
          Checking…
        </Text>
      ) : check.notOnAStage.length === 0 ? (
        <Alert color="green" py={6}>
          Every container stands on one of the stages.
        </Alert>
      ) : (
        <>
          <Text fz="sm" c="dimmed" mb="xs">
            Their route is not one the stages describe. Add the stage they need, or move them on with Update stage… once they
            are at a stage's place.
          </Text>
          <Paper radius="lg" withBorder style={{ overflowX: 'auto' }}>
            <Table striped verticalSpacing="xs" miw={620}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Container</Table.Th>
                  <Table.Th>Legs</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {check.notOnAStage.map((c) => (
                  <Table.Tr key={c.containerId}>
                    <Table.Td>
                      <Anchor component={Link} to={`/logistics/containers/${c.containerId}`} fz="sm">
                        {c.containerRef}
                      </Anchor>
                      {c.containerNo ? (
                        <Text fz="xs" c="dimmed">
                          {c.containerNo}
                        </Text>
                      ) : null}
                    </Table.Td>
                    <Table.Td>
                      <Text fz="sm">{c.legs ?? '-'}</Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Paper>
        </>
      )}

      <Modal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New stage' : 'Edit stage'}
        size="lg"
        fullScreen={phone}
        closeOnClickOutside={!saving}
      >
        <Stack gap="sm">
          {formError ? <Alert color="red">{formError}</Alert> : null}
          <TextInput label="Stage name" required maxLength={100} value={form.stageName} onChange={(e) => setForm({ ...form, stageName: e.currentTarget.value })} data-autofocus />
          <Select
            label="What it does"
            required
            data={STAGE_KINDS.map((k) => ({ value: String(k.value), label: k.label }))}
            value={form.kind}
            onChange={(next) => setForm({ ...form, kind: next ?? '1' })}
            description={STAGE_KINDS.find((k) => String(k.value) === form.kind)?.explanation}
            allowDeselect={false}
          />
          {kind !== 2 ? (
            <Select
              label={kind === 3 ? 'Type of the last leg (when one is still needed)' : 'Movement type'}
              required
              data={typeOptions}
              value={form.movementTypeId}
              onChange={(next) => setForm({ ...form, movementTypeId: next })}
              searchable
            />
          ) : null}
          <Group grow align="flex-start" wrap={phone ? 'wrap' : 'nowrap'}>
            {kind === 1 ? (
              <Select
                label="From"
                data={[{ value: PORT_OF_LOADING, label: "The container's port of loading" }, ...portOptions]}
                value={form.fromPlaceId}
                onChange={(next) => setForm({ ...form, fromPlaceId: next ?? PORT_OF_LOADING })}
                searchable
                allowDeselect={false}
              />
            ) : null}
            <Select
              label={kind === 1 ? 'To' : 'Place'}
              required
              data={portOptions}
              value={form.toPlaceId}
              onChange={(next) => setForm({ ...form, toPlaceId: next })}
              searchable
            />
          </Group>
          <Group grow align="flex-end">
            <NumberInput label="Order" value={form.sortOrder} onChange={(next) => setForm({ ...form, sortOrder: Number(next) || 0 })} allowDecimal={false} />
            <Switch label="Active" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.currentTarget.checked })} mb={8} />
          </Group>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save()} loading={saving}>
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  )
}
