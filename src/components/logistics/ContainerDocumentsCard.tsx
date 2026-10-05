import { useMemo, useState } from 'react'
import { ActionIcon, Badge, Button, Group, Modal, Paper, ScrollArea, Stack, Table, Text, Title, Tooltip } from '@mantine/core'
import { IconDownload, IconPencil, IconTrash, IconUpload } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { containersApi, type ContainerAttachmentDto, type ContainerDto } from '../../api/logistics/containers'
import { movementsApi } from '../../api/logistics/movements'
import { dateLabel, stamp } from '../documents/documentKind'
import { formatNumber } from '../format'
import { confirm } from '../ui/confirm'
import { notify } from '../ui/notify'
import { AttachmentEditModal, AttachmentUploadModal } from './AttachmentUploadModal'

interface ContainerDocumentsCardProps {
  container: ContainerDto
  canManage: boolean
  /** Re-reads the container so the list, the counts and the route catch up. */
  onChanged: () => void
}

type Option = { value: string; label: string }

interface DocGroup {
  key: string
  title: string
  rows: ContainerAttachmentDto[]
}

/** General first, then the movements in route order, then the charges. */
function groupOf(row: ContainerAttachmentDto): { key: string; title: string; order: number } {
  if (row.chargeId) return { key: `c${row.chargeId}`, title: `Charge #${row.chargeId}`, order: 2 }
  if (row.movementId) return { key: `m${row.movementId}`, title: row.movementNo ?? `Movement #${row.movementId}`, order: 1 }
  return { key: 'general', title: 'General', order: 0 }
}

/**
 * The container's paperwork, filed where it belongs: general papers, the documents of each leg of the
 * route, the invoices behind each charge. A file uploaded once for several containers is ONE file;
 * the badge says so, and editing or deleting it asks whether that is for this container or all of them.
 */
export function ContainerDocumentsCard({ container, canManage, onChanged }: ContainerDocumentsCardProps) {
  const [uploadOpen, setUploadOpen] = useState(false)
  const [otherContainers, setOtherContainers] = useState<Option[]>([])
  const [opening, setOpening] = useState(false)
  const [removing, setRemoving] = useState<ContainerAttachmentDto | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [editing, setEditing] = useState<ContainerAttachmentDto | null>(null)

  const groups = useMemo(() => {
    const map = new Map<string, DocGroup & { order: number }>()
    for (const row of container.attachments) {
      const g = groupOf(row)
      const group = map.get(g.key) ?? { ...g, rows: [] }
      group.rows.push(row)
      map.set(g.key, group)
    }
    const routeOrder = new Map(container.movements.map((m, index) => [`m${m.movementId}`, index]))
    return [...map.values()].sort(
      (a, b) => a.order - b.order || (routeOrder.get(a.key) ?? 0) - (routeOrder.get(b.key) ?? 0) || a.title.localeCompare(b.title),
    )
  }, [container.attachments, container.movements])

  const movementOptions = useMemo(
    () => container.movements.map((m) => ({ value: String(m.movementId), label: `${m.movementNo} - ${m.typeName}` })),
    [container.movements],
  )

  /** The boxes that travel with this one: every other container on any of its movements. */
  async function openUpload() {
    setOpening(true)
    try {
      const movements = await Promise.all(container.movements.map((m) => movementsApi.get(m.movementId).catch(() => null)))
      const others = new Map<string, string>()
      for (const movement of movements) {
        for (const c of movement?.containers ?? []) {
          if (c.containerId === container.id) continue
          others.set(String(c.containerId), c.containerNo ? `${c.containerRef} - ${c.containerNo}` : c.containerRef)
        }
      }
      setOtherContainers([...others].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)))
    } finally {
      setOpening(false)
      setUploadOpen(true)
    }
  }

  async function download(row: ContainerAttachmentDto) {
    try {
      await containersApi.downloadAttachment(row.id, row.fileName)
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The file could not be downloaded.')
    }
  }

  async function remove(row: ContainerAttachmentDto, allShared: boolean) {
    setRemoveBusy(true)
    try {
      await containersApi.removeAttachment(row.id, allShared)
      notify.success(allShared ? `${row.fileName} deleted from every container.` : `${row.fileName} deleted from ${container.containerRef}.`)
      setRemoving(null)
      onChanged()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The file could not be deleted.')
    } finally {
      setRemoveBusy(false)
    }
  }

  async function askRemove(row: ContainerAttachmentDto) {
    // A file only this container holds needs a plain yes; a shared one needs to know how far to go.
    if (row.sharedWith > 0) {
      setRemoving(row)
      return
    }
    const go = await confirm({ title: 'Delete document', message: `Delete ${row.fileName}?`, confirmLabel: 'Delete', danger: true })
    if (go) await remove(row, false)
  }

  return (
    <Paper radius="lg" p="md" withBorder>
      <Group justify="space-between" mb="sm" wrap="wrap" gap="xs">
        <Title order={5}>Documents</Title>
        {canManage ? (
          <Button size="xs" variant="light" leftSection={<IconUpload size={14} />} loading={opening} onClick={() => void openUpload()}>
            Upload
          </Button>
        ) : null}
      </Group>

      {groups.length === 0 ? (
        <Text c="dimmed" fz="sm" ta="center" py="sm">
          No document yet.
        </Text>
      ) : (
        <Stack gap="md">
          {groups.map((group) => (
            <div key={group.key}>
              <Text fz="sm" fw={600} mb={4}>
                {group.title}{' '}
                <Text span c="dimmed" fz="xs">
                  ({formatNumber(group.rows.length)})
                </Text>
              </Text>
              <ScrollArea type="auto">
                <Table miw={760} verticalSpacing={4}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Type</Table.Th>
                      <Table.Th>File</Table.Th>
                      <Table.Th>Date</Table.Th>
                      <Table.Th>Note</Table.Th>
                      <Table.Th>Added by</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {group.rows.map((row) => (
                      <Table.Tr key={row.id}>
                        <Table.Td>
                          <Text fz="sm">{[row.category, row.subType].filter(Boolean).join(' / ') || '—'}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            <Text fz="sm" style={{ wordBreak: 'break-all' }}>
                              {row.fileName}
                            </Text>
                            {row.sharedWith > 0 ? (
                              <Badge size="xs" variant="light" color="grape" style={{ flexShrink: 0 }}>
                                shared with {formatNumber(row.sharedWith)} {row.sharedWith === 1 ? 'container' : 'containers'}
                              </Badge>
                            ) : null}
                          </Group>
                        </Table.Td>
                        <Table.Td style={{ whiteSpace: 'nowrap' }}>{dateLabel(row.documentDate)}</Table.Td>
                        <Table.Td>
                          <Text fz="sm">{row.note ?? '—'}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text fz="sm">{row.createdByName ?? '—'}</Text>
                          <Text fz="xs" c="dimmed">
                            {stamp(row.createdAtUtc)}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4} justify="flex-end" wrap="nowrap">
                            <Tooltip label="Download" withArrow>
                              <ActionIcon variant="subtle" aria-label={`Download ${row.fileName}`} onClick={() => void download(row)}>
                                <IconDownload size={16} />
                              </ActionIcon>
                            </Tooltip>
                            {canManage ? (
                              <Tooltip label="Edit" withArrow>
                                <ActionIcon variant="subtle" aria-label={`Edit ${row.fileName}`} onClick={() => setEditing(row)}>
                                  <IconPencil size={16} />
                                </ActionIcon>
                              </Tooltip>
                            ) : null}
                            {canManage ? (
                              <Tooltip label="Delete" withArrow>
                                <ActionIcon variant="subtle" color="red" aria-label={`Delete ${row.fileName}`} onClick={() => void askRemove(row)}>
                                  <IconTrash size={16} />
                                </ActionIcon>
                              </Tooltip>
                            ) : null}
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </div>
          ))}
        </Stack>
      )}

      <AttachmentUploadModal
        opened={uploadOpen}
        onClose={() => setUploadOpen(false)}
        containerIds={[container.id]}
        otherContainers={otherContainers}
        movementOptions={movementOptions}
        onUploaded={() => {
          setUploadOpen(false)
          onChanged()
        }}
      />

      <AttachmentEditModal
        attachment={editing}
        sharedCount={(editing?.sharedWith ?? 0) + 1}
        onClose={() => setEditing(null)}
        onSaved={onChanged}
      />

      <RemoveAttachmentModal
        opened={removing !== null}
        fileName={removing?.fileName ?? ''}
        message={`${removing?.fileName ?? 'This file'} is also on ${formatNumber(removing?.sharedWith ?? 0)} other ${removing?.sharedWith === 1 ? 'container' : 'containers'}. Delete it from ${container.containerRef} only, or from every container holding it?`}
        onlyLabel="Only this container"
        allLabel="All containers"
        busy={removeBusy}
        onClose={() => setRemoving(null)}
        onPick={(all) => {
          if (removing) void remove(removing, all)
        }}
      />
    </Paper>
  )
}

interface RemoveAttachmentModalProps {
  opened: boolean
  fileName: string
  message: string
  onlyLabel: string
  allLabel: string
  busy: boolean
  onClose: () => void
  /** true = from every container holding the file. */
  onPick: (all: boolean) => void
}

/** "Only this one, or everywhere?" - the question a shared file's delete has to ask. */
export function RemoveAttachmentModal({ opened, fileName, message, onlyLabel, allLabel, busy, onClose, onPick }: RemoveAttachmentModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={`Delete ${fileName}`} closeOnClickOutside={!busy} withCloseButton={!busy}>
      <Stack>
        <Text fz="sm">{message}</Text>
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose} disabled={busy}>
            Keep it
          </Button>
          <Button variant="light" color="red" onClick={() => onPick(false)} disabled={busy}>
            {onlyLabel}
          </Button>
          <Button color="red" onClick={() => onPick(true)} loading={busy}>
            {allLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
