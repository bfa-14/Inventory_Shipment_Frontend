import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ActionIcon, Anchor, Button, Group, Paper, ScrollArea, Table, Text, Title, Tooltip } from '@mantine/core'
import { IconDownload, IconTrash, IconUpload } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { containersApi } from '../../api/logistics/containers'
import type { MovementAttachmentDto, MovementDto } from '../../api/logistics/movements'
import { dateLabel, stamp } from '../documents/documentKind'
import { formatNumber } from '../format'
import { confirm } from '../ui/confirm'
import { notify } from '../ui/notify'
import { AttachmentUploadModal } from './AttachmentUploadModal'
import { RemoveAttachmentModal } from './ContainerDocumentsCard'

interface MovementDocumentsCardProps {
  movement: MovementDto
  canManage: boolean
  /** Re-reads the movement so the list and the counts catch up. */
  onChanged: () => void
}

/** One stored file and the containers of this movement that hold it. */
interface FileLine {
  fileId: number
  first: MovementAttachmentDto
  rows: MovementAttachmentDto[]
}

/**
 * The paperwork of one leg - the bill of lading, the T1, the delivery note. The API answers one row
 * per container; a file uploaded for the whole movement is shown ONCE with the containers it is on.
 */
export function MovementDocumentsCard({ movement, canManage, onChanged }: MovementDocumentsCardProps) {
  const [uploadOpen, setUploadOpen] = useState(false)
  const [removing, setRemoving] = useState<FileLine | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)

  const lines = useMemo(() => {
    const map = new Map<number, FileLine>()
    for (const row of movement.attachments) {
      const line = map.get(row.fileId) ?? { fileId: row.fileId, first: row, rows: [] }
      line.rows.push(row)
      map.set(row.fileId, line)
    }
    return [...map.values()]
  }, [movement.attachments])

  const containerOptions = useMemo(
    () => movement.containers.map((c) => ({ value: String(c.containerId), label: c.containerNo ? `${c.containerRef} - ${c.containerNo}` : c.containerRef })),
    [movement.containers],
  )

  async function download(line: FileLine) {
    try {
      await containersApi.downloadAttachment(line.first.id, line.first.fileName)
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The file could not be downloaded.')
    }
  }

  /** all = from every container holding the file, beyond this movement too. */
  async function remove(line: FileLine, all: boolean) {
    setRemoveBusy(true)
    try {
      if (all) await containersApi.removeAttachment(line.first.id, true)
      else for (const row of line.rows) await containersApi.removeAttachment(row.id, false)
      notify.success(`${line.first.fileName} deleted.`)
      setRemoving(null)
      onChanged()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The file could not be deleted.')
      // Some rows may be gone already; the reload shows what is left.
      onChanged()
    } finally {
      setRemoveBusy(false)
    }
  }

  async function askRemove(line: FileLine) {
    if (line.rows.length > 1) {
      setRemoving(line)
      return
    }
    const go = await confirm({
      title: 'Delete document',
      message: `Delete ${line.first.fileName} from ${line.first.containerRef}?`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (go) await remove(line, false)
  }

  return (
    <Paper radius="lg" p="md" withBorder>
      <Group justify="space-between" mb="sm" wrap="wrap" gap="xs">
        <Title order={5}>Documents</Title>
        {canManage ? (
          <Button
            size="xs"
            variant="light"
            leftSection={<IconUpload size={14} />}
            onClick={() => setUploadOpen(true)}
            disabled={movement.containers.length === 0}
          >
            Upload
          </Button>
        ) : null}
      </Group>

      {lines.length === 0 ? (
        <Text c="dimmed" fz="sm" ta="center" py="sm">
          {movement.containers.length === 0 ? 'Add containers to the movement to file its documents.' : 'No document yet.'}
        </Text>
      ) : (
        <ScrollArea type="auto">
          <Table miw={820} verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Type</Table.Th>
                <Table.Th>File</Table.Th>
                <Table.Th>Containers</Table.Th>
                <Table.Th>Date</Table.Th>
                <Table.Th>Note</Table.Th>
                <Table.Th>Added by</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lines.map((line) => (
                <Table.Tr key={line.fileId}>
                  <Table.Td>
                    <Text fz="sm">{[line.first.category, line.first.subType].filter(Boolean).join(' / ') || '—'}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text fz="sm" style={{ wordBreak: 'break-all' }}>
                      {line.first.fileName}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6}>
                      {line.rows.map((row) => (
                        <Anchor key={row.id} component={Link} to={`/logistics/containers/${row.containerId}`} fz="sm" style={{ whiteSpace: 'nowrap' }}>
                          {row.containerRef}
                        </Anchor>
                      ))}
                    </Group>
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{dateLabel(line.first.documentDate)}</Table.Td>
                  <Table.Td>
                    <Text fz="sm">{line.first.note ?? '—'}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text fz="sm">{line.first.createdByName ?? '—'}</Text>
                    <Text fz="xs" c="dimmed">
                      {stamp(line.first.createdAtUtc)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <Tooltip label="Download" withArrow>
                        <ActionIcon variant="subtle" aria-label={`Download ${line.first.fileName}`} onClick={() => void download(line)}>
                          <IconDownload size={16} />
                        </ActionIcon>
                      </Tooltip>
                      {canManage ? (
                        <Tooltip label="Delete" withArrow>
                          <ActionIcon variant="subtle" color="red" aria-label={`Delete ${line.first.fileName}`} onClick={() => void askRemove(line)}>
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
      )}

      <AttachmentUploadModal
        opened={uploadOpen}
        onClose={() => setUploadOpen(false)}
        containerIds={[]}
        otherContainers={containerOptions}
        defaultAlsoAttach={containerOptions.map((o) => o.value)}
        movementOptions={[{ value: String(movement.id), label: `${movement.movementNo} - ${movement.typeName}` }]}
        defaultMovementId={String(movement.id)}
        onUploaded={() => {
          setUploadOpen(false)
          onChanged()
        }}
      />

      <RemoveAttachmentModal
        opened={removing !== null}
        fileName={removing?.first.fileName ?? ''}
        message={`${removing?.first.fileName ?? 'This file'} is on ${formatNumber(removing?.rows.length ?? 0)} containers of ${movement.movementNo}. Delete it from this movement's containers only, or from every container holding it?`}
        onlyLabel="This movement's containers"
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
