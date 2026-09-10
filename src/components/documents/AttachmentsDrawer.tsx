import { useRef, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Box,
  Drawer,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Tooltip,
} from '@mantine/core'
import { IconDownload, IconTrash } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { stockDocumentsApi, type StockDocumentFileDto } from '../../api/inventory/stockDocuments'
import { confirm } from '../ui/confirm'
import { notify } from '../ui/notify'
import { stamp } from './documentKind'

const MAX_BYTES = 10 * 1024 * 1024

/** What may be attached. Anything else is a file somebody meant to send elsewhere. */
const ALLOWED = ['.pdf', '.xlsx', '.xls', '.docx', '.doc', '.png', '.jpg', '.jpeg', '.gif', '.webp']

interface AttachmentsDrawerProps {
  opened: boolean
  onClose: () => void
  /** Null on a document that has never been saved: there is nothing to attach a file to yet. */
  documentId: number | null
  files: StockDocumentFileDto[]
  /** Re-reads the document so the list and the audit trail both catch up. */
  onChanged: () => void
  canEdit: boolean
}

/**
 * The paperwork behind the document: the delivery note, the count sheet, the photo of the damage.
 *
 * A DRAWER RATHER THAN A TAB, because attachments are a side errand. Somebody entering a document
 * looks at them once and goes back to the lines; a tab would make the lines disappear to do it.
 *
 * ALLOWED ON A POSTED DOCUMENT, unlike everything else about it. The evidence for a movement often
 * arrives after the movement — the scanned note comes back from the warehouse an hour later — and a
 * system that refused it would be a system people keep the evidence outside of.
 */
export function AttachmentsDrawer({
  opened,
  onClose,
  documentId,
  files,
  onChanged,
  canEdit,
}: AttachmentsDrawerProps) {
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function upload(file: File | null) {
    if (!file || documentId === null) return

    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (!ALLOWED.includes(extension)) {
      notify.error('Only PDF, Excel, Word and image files can be attached.')
      return
    }
    if (file.size > MAX_BYTES) {
      notify.error(`${file.name} is larger than ${MAX_BYTES / (1024 * 1024)} MB.`)
      return
    }

    setBusy(true)
    try {
      await stockDocumentsApi.addFile(documentId, file)
      notify.success(`${file.name} attached.`)
      onChanged()
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The file could not be attached.')
    } finally {
      setBusy(false)
    }
  }

  async function download(file: StockDocumentFileDto) {
    if (documentId === null) return
    try {
      await stockDocumentsApi.downloadFile(documentId, file.id, file.fileName)
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The file could not be downloaded.')
    }
  }

  async function remove(file: StockDocumentFileDto) {
    if (documentId === null) return
    const go = await confirm({
      title: 'Delete attachment',
      message: `Delete ${file.fileName}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!go) return

    try {
      await stockDocumentsApi.removeFile(documentId, file.id)
      notify.success('Attachment deleted.')
      onChanged()
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The file could not be deleted.')
    }
  }

  return (
    <Drawer opened={opened} onClose={onClose} position="right" size="lg" title="Attachments">
      <Stack>
        {documentId === null ? (
          <Alert color="blue">Save the draft first to attach files.</Alert>
        ) : (
          <>
            {canEdit && (
              <Box
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragging(false)
                  void upload(event.dataTransfer.files?.[0] ?? null)
                }}
                onClick={() => inputRef.current?.click()}
                style={{
                  border: `2px dashed var(--mantine-color-${dragging ? 'blue' : 'gray'}-4)`,
                  borderRadius: 'var(--mantine-radius-md)',
                  padding: 'var(--mantine-spacing-lg)',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: dragging ? 'var(--mantine-color-blue-0)' : undefined,
                }}
              >
                <input
                  ref={inputRef}
                  type="file"
                  hidden
                  accept={ALLOWED.join(',')}
                  onChange={(event) => void upload(event.currentTarget.files?.[0] ?? null)}
                />
                {busy ? (
                  <Group justify="center" gap="xs">
                    <Loader size="sm" />
                    <Text size="sm">Uploading…</Text>
                  </Group>
                ) : (
                  <Stack gap={2}>
                    <Text fw={500}>Drag a file here, or click to browse</Text>
                    <Text size="xs" c="dimmed">
                      PDF, Excel, Word or an image, up to 10 MB.
                    </Text>
                  </Stack>
                )}
              </Box>
            )}

            {files.length === 0 ? (
              <Text size="sm" c="dimmed" ta="center" py="md">
                Nothing attached yet.
              </Text>
            ) : (
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>File</Table.Th>
                    <Table.Th w={90} ta="right">Size</Table.Th>
                    <Table.Th w={70} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {files.map((file) => (
                    <Table.Tr key={file.id}>
                      <Table.Td>
                        <Text size="sm" fw={500}>{file.fileName}</Text>
                        <Text size="xs" c="dimmed">
                          {stamp(file.createdAtUtc)}
                          {file.createdByName ? ` · ${file.createdByName}` : ''}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="xs">{(file.sizeBytes / 1024).toFixed(0)} KB</Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={2} wrap="nowrap">
                          <Tooltip label="Download" withArrow>
                            <ActionIcon variant="subtle" onClick={() => void download(file)}>
                              <IconDownload size={16} />
                            </ActionIcon>
                          </Tooltip>
                          {canEdit && (
                            <Tooltip label="Delete" withArrow>
                              <ActionIcon variant="subtle" color="red" onClick={() => void remove(file)}>
                                <IconTrash size={16} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </>
        )}
      </Stack>
    </Drawer>
  )
}
