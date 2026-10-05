import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ActionIcon, Anchor, Button, Group, Paper, ScrollArea, Stack, Table, Text, Title, Tooltip } from '@mantine/core'
import { IconDownload, IconPencil, IconTrash, IconUpload } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { containersApi, type ContainerAttachmentDto } from '../../api/logistics/containers'
import type { MovementDto } from '../../api/logistics/movements'
import { AttachmentEditDialog } from '../attachments/AttachmentEditDialog'
import { AttachmentUploadDialog } from '../attachments/AttachmentUploadDialog'
import { formatBytes } from '../attachments/attachmentRules'
import { AttachmentTypeBadge } from '../attachments/AttachmentsPanel'
import { chooseRemoval } from '../attachments/chooseRemoval'
import { dateLabel, stamp } from '../documents/documentKind'
import { formatNumber } from '../format'
import { confirm } from '../ui/confirm'
import { notify } from '../ui/notify'

interface MovementDocumentsCardProps {
  movement: MovementDto
  canManage: boolean
  /** Re-reads the movement so the list and the counts catch up. */
  onChanged: () => void
}

/** One stored file and the containers of this movement that hold it. */
interface FileLine {
  fileId: number
  first: ContainerAttachmentDto
  rows: ContainerAttachmentDto[]
}

/**
 * The paperwork of one leg - the bill of lading, the T1, the delivery note. The API answers one row
 * per container; a file uploaded for the whole movement is shown ONCE with the containers it is on, and
 * its type / date / note are changed on all of them together. The upload and edit dialogs are the shared
 * ones: a type used for containers is required.
 */
export function MovementDocumentsCard({ movement, canManage, onChanged }: MovementDocumentsCardProps) {
  const [rows, setRows] = useState<ContainerAttachmentDto[]>([])
  const [uploadOpen, setUploadOpen] = useState(false)
  const [editing, setEditing] = useState<FileLine | null>(null)

  const reloadKey = movement.attachments.map((a) => `${a.id}.${a.attachmentTypeId ?? 0}`).join(',')
  const load = useCallback(async () => {
    try {
      const next = await containersApi.listAttachments({ movementId: movement.id })
      setRows(next)
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The documents could not be loaded.')
    }
  }, [movement.id])

  // A chain rather than load(): the answer of a movement left behind must not land on the next one.
  useEffect(() => {
    let alive = true
    containersApi
      .listAttachments({ movementId: movement.id })
      .then((next) => alive && setRows(next))
      .catch((err) => notify.error(err instanceof ApiError ? err.message : 'The documents could not be loaded.'))
    return () => {
      alive = false
    }
  }, [movement.id, reloadKey])

  const lines = useMemo(() => {
    const map = new Map<number, FileLine>()
    for (const row of rows) {
      const line = map.get(row.fileId) ?? { fileId: row.fileId, first: row, rows: [] }
      line.rows.push(row)
      map.set(row.fileId, line)
    }
    return [...map.values()]
  }, [rows])

  const containerOptions = useMemo(
    () =>
      movement.containers.map((c) => ({
        value: String(c.containerId),
        label: c.containerNo ? `${c.containerRef} - ${c.containerNo}` : c.containerRef,
      })),
    [movement.containers],
  )

  async function changed(message: string) {
    notify.success(message)
    await load()
    onChanged()
  }

  async function download(line: FileLine) {
    try {
      await containersApi.downloadAttachment(line.first.id, line.first.fileName)
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The file could not be downloaded.')
    }
  }

  async function askRemove(line: FileLine) {
    let all = false
    if (line.rows.length > 1) {
      const pick = await chooseRemoval({
        title: `Delete ${line.first.fileName}`,
        message: `${line.first.fileName} is on ${formatNumber(line.rows.length)} containers of ${movement.movementNo}. Delete it from this movement's containers only, or from every container holding it?`,
        onlyLabel: "This movement's containers",
        allLabel: 'All containers',
      })
      if (pick === null) return
      all = pick === 'all'
    } else {
      const go = await confirm({
        title: 'Delete document',
        message: `Delete ${line.first.fileName} from ${line.first.containerRef ?? 'its container'}?`,
        confirmLabel: 'Delete',
        danger: true,
      })
      if (!go) return
    }
    try {
      if (all) await containersApi.removeAttachment(line.first.id, true)
      else for (const row of line.rows) await containersApi.removeAttachment(row.id, false)
      await changed(`${line.first.fileName} deleted.`)
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The file could not be deleted.')
      // Some rows may be gone already; the reload shows what is left.
      await load()
      onChanged()
    }
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
          {movement.containers.length === 0
            ? 'Add containers to the movement to file its documents.'
            : 'No document yet.'}
        </Text>
      ) : (
        <ScrollArea type="auto">
          <Table miw={860} verticalSpacing={6}>
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
                    <Stack gap={4} align="flex-start">
                      <AttachmentTypeBadge
                        category={line.first.category}
                        subType={line.first.subType}
                        isOther={line.first.isOther}
                      />
                      {canManage && line.first.isOther ? (
                        <Button
                          size="compact-xs"
                          variant="light"
                          color="orange"
                          leftSection={<IconPencil size={12} />}
                          onClick={() => setEditing(line)}
                        >
                          Choose a type
                        </Button>
                      ) : null}
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    <Text fz="sm" style={{ overflowWrap: 'anywhere' }}>
                      {line.first.fileName}
                    </Text>
                    <Text fz="xs" c="dimmed">
                      {formatBytes(line.first.sizeBytes)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6}>
                      {line.rows.map((row) => (
                        <Anchor
                          key={row.id}
                          component={Link}
                          to={`/logistics/containers/${row.containerId}`}
                          fz="sm"
                          style={{ whiteSpace: 'nowrap' }}
                        >
                          {row.containerRef}
                        </Anchor>
                      ))}
                    </Group>
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{dateLabel(line.first.documentDate)}</Table.Td>
                  <Table.Td>
                    <Text fz="sm" c={line.first.note ? undefined : 'dimmed'}>
                      {line.first.note ?? '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text fz="sm">{line.first.createdByName ?? '—'}</Text>
                    <Text fz="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                      {stamp(line.first.createdAtUtc)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <Tooltip label="Download" withArrow>
                        <ActionIcon
                          variant="subtle"
                          aria-label={`Download ${line.first.fileName}`}
                          onClick={() => void download(line)}
                        >
                          <IconDownload size={16} />
                        </ActionIcon>
                      </Tooltip>
                      {canManage ? (
                        <Tooltip label="Edit" withArrow>
                          <ActionIcon
                            variant="subtle"
                            aria-label={`Edit ${line.first.fileName}`}
                            onClick={() => setEditing(line)}
                          >
                            <IconPencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                      ) : null}
                      {canManage ? (
                        <Tooltip label="Delete" withArrow>
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label={`Delete ${line.first.fileName}`}
                            onClick={() => void askRemove(line)}
                          >
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

      <AttachmentUploadDialog
        opened={uploadOpen}
        documentKind="CONTAINER"
        filing={{
          containerIds: [],
          otherContainers: containerOptions,
          defaultAlsoAttach: containerOptions.map((o) => o.value),
          movementOptions: [{ value: String(movement.id), label: `${movement.movementNo} - ${movement.typeName}` }],
          defaultMovementId: String(movement.id),
        }}
        onUpload={(file, fields, filed) =>
          containersApi.addAttachment({
            file,
            containerIds: filed.containerIds,
            movementId: filed.movementId,
            ...fields,
          })
        }
        onClose={() => setUploadOpen(false)}
        onUploaded={(fileName) => {
          setUploadOpen(false)
          void changed(`${fileName} attached.`)
        }}
      />

      <AttachmentEditDialog
        file={editing?.first ?? null}
        documentKind="CONTAINER"
        onSave={async (edit) => {
          // One upload, one edit: the line's first record with allShared reaches every container holding the file -
          // the containers of this movement it was uploaded for.
          if (editing) await containersApi.updateAttachment(editing.first.id, true, edit)
        }}
        onClose={() => setEditing(null)}
        onSaved={() => {
          const name = editing?.first.fileName ?? 'The document'
          setEditing(null)
          void changed(`${name} updated.`)
        }}
      />
    </Paper>
  )
}
