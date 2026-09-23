import { useState } from 'react'
import { ActionIcon, Alert, Button, FileInput, Grid, Group, Paper, ScrollArea, Select, Table, Text, TextInput, Title, Tooltip } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconEye, IconPaperclip, IconTrash, IconUpload } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { containersApi, type ContainerFileDto } from '../../api/logistics/containers'
import type { AttachmentTypeLookupDto } from '../../api/masterdata/attachmentTypes'
import { confirm } from '../ui/confirm'
import { notify } from '../ui/notify'
import { dateLabel } from '../documents/documentKind'
import { formatNumber } from '../format'

interface ContainerAttachmentsCardProps {
  containerId: number | null
  files: ContainerFileDto[]
  attachmentTypes: AttachmentTypeLookupDto[]
  canEdit: boolean
  /** Re-reads the container so the list and the audit trail catch up. */
  onChanged: () => void
}

const ACCEPT = '.pdf,.xlsx,.xls,.docx,.doc,.png,.jpg,.jpeg,.gif,.webp'
const MAX_BYTES = 10 * 1024 * 1024

/** Section 7: the paperwork — B/L, FERI, declaration — each filed under a type and dated. */
export function ContainerAttachmentsCard({ containerId, files, attachmentTypes, canEdit, onChanged }: ContainerAttachmentsCardProps) {
  const [typeId, setTypeId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [documentDate, setDocumentDate] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload() {
    if (!containerId || !file) return
    if (file.size > MAX_BYTES) {
      setError('The file is larger than 10 MB.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await containersApi.addFile(containerId, {
        file,
        attachmentTypeId: typeId === null ? null : Number(typeId),
        note: note.trim() || null,
        documentDate,
      })
      setFile(null)
      setNote('')
      setDocumentDate(null)
      notify.success('File attached.')
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The file could not be attached.')
    } finally {
      setBusy(false)
    }
  }

  async function view(row: ContainerFileDto) {
    try {
      const blob = await containersApi.fileBlob(row.id)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The file could not be opened.')
    }
  }

  async function remove(row: ContainerFileDto) {
    const go = await confirm({ title: 'Delete attachment', message: `Delete ${row.fileName}?`, confirmLabel: 'Delete', danger: true })
    if (!go) return
    try {
      await containersApi.removeFile(row.id)
      notify.success('Attachment deleted.')
      onChanged()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The file could not be deleted.')
    }
  }

  return (
    <Paper radius="lg" p="md" withBorder>
      <Title order={5} mb="sm">
        7. Attachments
      </Title>

      {canEdit ? (
        containerId === null ? (
          <Text c="dimmed" fz="sm" mb="sm">
            Save the container first to attach files.
          </Text>
        ) : (
          <Grid align="flex-end" gap="sm" mb="md">
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <Select
                label="Type / Sub Type"
                placeholder="Pick a type"
                data={attachmentTypes.map((t) => ({ value: String(t.id), label: t.displayName }))}
                value={typeId}
                onChange={setTypeId}
                searchable
                clearable
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <TextInput label="Note" maxLength={300} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 2 }}>
              <DateInput label="Date" placeholder="Document date" valueFormat="DD/MM/YYYY" value={documentDate} onChange={(v) => setDocumentDate(v ? String(v).slice(0, 10) : null)} clearable />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
              <FileInput label="File" placeholder="Choose a file" accept={ACCEPT} value={file} onChange={setFile} leftSection={<IconPaperclip size={14} />} clearable />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 1 }}>
              <Button leftSection={<IconUpload size={14} />} onClick={() => void upload()} loading={busy} disabled={!file} fullWidth>
                Add
              </Button>
            </Grid.Col>
          </Grid>
        )
      ) : null}

      {error ? <Alert color="red" mb="sm">{error}</Alert> : null}

      {files.length === 0 ? (
        <Text c="dimmed" fz="sm" ta="center" py="sm">
          No attachment yet.
        </Text>
      ) : (
        <ScrollArea type="auto">
          <Table miw={720} verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Type</Table.Th>
                <Table.Th>Sub Type</Table.Th>
                <Table.Th>File</Table.Th>
                <Table.Th>Note</Table.Th>
                <Table.Th>Date</Table.Th>
                <Table.Th ta="right">Size</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {files.map((row) => (
                <Table.Tr key={row.id}>
                  <Table.Td>{row.category ?? '—'}</Table.Td>
                  <Table.Td>{row.subType ?? '—'}</Table.Td>
                  <Table.Td>{row.fileName}</Table.Td>
                  <Table.Td>{row.note ?? '—'}</Table.Td>
                  <Table.Td>{dateLabel(row.documentDate)}</Table.Td>
                  <Table.Td ta="right">{formatNumber(Math.max(1, Math.round(row.sizeBytes / 1024)))} KB</Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <Tooltip label="View" withArrow>
                        <ActionIcon variant="subtle" aria-label={`View ${row.fileName}`} onClick={() => void view(row)}>
                          <IconEye size={16} />
                        </ActionIcon>
                      </Tooltip>
                      {canEdit ? (
                        <Tooltip label="Delete" withArrow>
                          <ActionIcon variant="subtle" color="red" aria-label={`Delete ${row.fileName}`} onClick={() => void remove(row)}>
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
    </Paper>
  )
}
