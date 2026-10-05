import { useRef, useState } from 'react'
import { ActionIcon, Badge, Box, Card, Center, Group, Stack, Table, Text, Tooltip } from '@mantine/core'
import { IconDownload, IconFileText, IconPencil, IconTrash, IconUpload } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { itemsApi } from '../../api/inventory/items'
import type { ItemFileDto } from '../../api/types'
import { EditAttachmentModal, type AttachmentEdit } from '../../components/documents/EditAttachmentModal'
import { formatDateTime } from '../../components/format'
import { notify } from '../../components/ui/notify'
import { ATTACHMENT_ACCEPT, fileRejection, formatBytes, MAX_FILE_BYTES } from './itemFiles'

interface ItemAttachmentsTabProps {
  /** Null while the item does not exist yet; picked files are then held until it is saved. */
  itemId: number | null
  /** The stored attachments (the item image is not one of them). */
  files: ItemFileDto[]
  /** Files chosen but not uploaded yet. */
  pending: File[]
  editable: boolean
  onPick(files: File[]): void
  onDiscardPending(index: number): void
  /** Renames the file, or replaces it with a new version; a throw keeps the dialog open. */
  onEdit(file: ItemFileDto, edit: AttachmentEdit): Promise<void>
  onDelete(file: ItemFileDto): Promise<void>
}

export function ItemAttachmentsTab({
  itemId,
  files,
  pending,
  editable,
  onPick,
  onDiscardPending,
  onEdit,
  onDelete,
}: ItemAttachmentsTabProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [editing, setEditing] = useState<ItemFileDto | null>(null)

  /** Keeps the files that pass; each rejection is named so the reader knows which one and why. */
  function accept(candidates: File[]) {
    const kept: File[] = []
    for (const file of candidates) {
      const rejection = fileRejection(file, 'attachment')
      if (rejection) notify.error(rejection)
      else kept.push(file)
    }
    if (kept.length > 0) onPick(kept)
  }

  async function download(file: ItemFileDto) {
    if (itemId === null) return
    setBusyId(file.id)
    try {
      const blob = await itemsApi.fileBlob(itemId, file.id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = file.fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      // Revoked on the next tick: revoking synchronously can beat the browser to the download.
      setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (error) {
      notify.error(error instanceof ApiError ? (error.messages[0] as string) : 'The file could not be downloaded.')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(file: ItemFileDto) {
    setBusyId(file.id)
    try {
      await onDelete(file)
    } finally {
      setBusyId(null)
    }
  }

  const nothing = files.length === 0 && pending.length === 0

  return (
    <Stack gap="md">
      {editable ? (
        <Box>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            hidden
            aria-hidden
            tabIndex={-1}
            onChange={(event) => {
              accept([...(event.currentTarget.files ?? [])])
              // Clearing the input lets the same file be picked again after a rejection.
              event.currentTarget.value = ''
            }}
          />

          {/* A plain drop area rather than a dependency: the whole behaviour is four handlers. */}
          <Card
            radius="lg"
            p="xl"
            withBorder
            component="button"
            type="button"
            aria-label="Add attachments"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              accept([...event.dataTransfer.files])
            }}
            style={{
              width: '100%',
              cursor: 'pointer',
              borderStyle: 'dashed',
              borderColor: dragging ? 'var(--mantine-color-brand-6)' : undefined,
              background: dragging ? 'var(--mantine-color-brand-0)' : undefined,
            }}
          >
            <Center>
              <Stack gap={6} align="center">
                <IconUpload size={30} color="var(--mantine-color-brand-6)" stroke={1.5} />
                <Text fw={600} fz="sm">
                  Drop files here, or click to choose
                </Text>
                <Text c="dimmed" fz="xs" ta="center">
                  Images, PDF, Word, Excel or plain text - up to {formatBytes(MAX_FILE_BYTES)} each.
                </Text>
              </Stack>
            </Center>
          </Card>
        </Box>
      ) : null}

      <Card radius="lg" p="lg" withBorder>
        {nothing ? (
          <Text c="dimmed" fz="sm" py="md" ta="center">
            No attachments yet.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={560}>
            <Table verticalSpacing="sm" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>File</Table.Th>
                  <Table.Th ta="right">Size</Table.Th>
                  <Table.Th>Added</Table.Th>
                  <Table.Th ta="right">Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pending.map((file, index) => (
                  <Table.Tr key={`pending-${index}-${file.name}`}>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <IconFileText size={17} color="var(--mantine-color-gray-6)" />
                        <Text fz="sm">{file.name}</Text>
                        <Badge size="xs" variant="light" color="blue">
                          Not saved
                        </Badge>
                      </Group>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text fz="sm">{formatBytes(file.size)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text c="dimmed" fz="sm">
                        Uploaded when you save
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <Tooltip label="Discard" withArrow position="top">
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label={`Discard ${file.name}`}
                            onClick={() => onDiscardPending(index)}
                          >
                            <IconTrash size={17} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}

                {files.map((file) => (
                  <Table.Tr key={file.id}>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <IconFileText size={17} color="var(--mantine-color-gray-6)" />
                        <Text fz="sm">{file.fileName}</Text>
                      </Group>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text fz="sm">{formatBytes(file.sizeBytes)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text fz="sm">{formatDateTime(file.createdAtUtc)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <Tooltip label="Download" withArrow position="top">
                          <ActionIcon
                            variant="subtle"
                            color="blue"
                            aria-label={`Download ${file.fileName}`}
                            loading={busyId === file.id}
                            onClick={() => void download(file)}
                          >
                            <IconDownload size={17} />
                          </ActionIcon>
                        </Tooltip>
                        {editable ? (
                          <Tooltip label="Edit" withArrow position="top">
                            <ActionIcon
                              variant="subtle"
                              aria-label={`Edit ${file.fileName}`}
                              disabled={busyId === file.id}
                              onClick={() => setEditing(file)}
                            >
                              <IconPencil size={17} />
                            </ActionIcon>
                          </Tooltip>
                        ) : null}
                        {editable ? (
                          <Tooltip label="Delete" withArrow position="top">
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              aria-label={`Delete ${file.fileName}`}
                              disabled={busyId === file.id}
                              onClick={() => void remove(file)}
                            >
                              <IconTrash size={17} />
                            </ActionIcon>
                          </Tooltip>
                        ) : null}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>

      <EditAttachmentModal
        opened={editing !== null}
        fileName={editing?.fileName ?? ''}
        accept={ATTACHMENT_ACCEPT}
        check={(file) => fileRejection(file, 'attachment')}
        onClose={() => setEditing(null)}
        onSave={async (edit) => {
          if (editing) await onEdit(editing, edit)
        }}
      />
    </Stack>
  )
}
