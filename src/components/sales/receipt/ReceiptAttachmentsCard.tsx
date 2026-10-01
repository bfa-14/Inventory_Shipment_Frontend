import { useMemo, useRef, useState } from 'react'
import { ActionIcon, Alert, Button, FileButton, Group, Paper, Select, Table, Text, TextInput, Title, Tooltip } from '@mantine/core'
import { IconDownload, IconPaperclip, IconTrash } from '@tabler/icons-react'
import { ApiError } from '../../../api/http'
import type { AttachmentTypeLookupDto } from '../../../api/masterdata/attachmentTypes'
import { receiptsApi, type ReceiptFileDto } from '../../../api/sales/receipts'
import { stamp } from '../../documents/documentKind'
import { confirm } from '../../ui/confirm'
import { notify } from '../../ui/notify'

const MAX_BYTES = 10 * 1024 * 1024

interface ReceiptAttachmentsCardProps {
  /** Null until the receipt has been saved once: there is nothing to attach a file to before that. */
  receiptId: number | null
  files: ReceiptFileDto[]
  types: AttachmentTypeLookupDto[]
  /** Adding is allowed on a posted receipt too — the cheque photo often arrives after the cash. */
  canAdd: boolean
  /** Removing is for drafts only; a posted receipt's evidence stays. */
  canRemove: boolean
  onChanged: () => void
}

/**
 * The paperwork behind the money: the cheque photo, the transfer slip, the signed acknowledgement.
 *
 * TYPE, SUB TYPE, NOTE, FILE, DATE — the columns of the mockup. The two selects come from the
 * attachment types master data filtered to Receipt, so the container paperwork list and this one are
 * kept apart and a cashier is not offered "Bill of Lading".
 */
export function ReceiptAttachmentsCard({ receiptId, files, types, canAdd, canRemove, onChanged }: ReceiptAttachmentsCardProps) {
  const [category, setCategory] = useState<string | null>(null)
  const [subTypeId, setSubTypeId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const resetRef = useRef<() => void>(null)

  const categories = useMemo(() => [...new Set(types.map((t) => t.category))], [types])
  const subTypes = useMemo(() => types.filter((t) => t.category === category), [types, category])

  async function upload(file: File | null) {
    if (!file || receiptId === null) return
    if (file.size > MAX_BYTES) {
      notify.error('That file is larger than 10 MB.')
      resetRef.current?.()
      return
    }
    setBusy(true)
    try {
      await receiptsApi.addFile(receiptId, file, subTypeId === null ? null : Number(subTypeId), note)
      notify.success('File attached.')
      setNote('')
      setSubTypeId(null)
      onChanged()
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The file could not be attached.')
    } finally {
      setBusy(false)
      resetRef.current?.()
    }
  }

  async function remove(file: ReceiptFileDto) {
    const go = await confirm({ title: 'Remove file', message: `Remove ${file.fileName} from this receipt?`, confirmLabel: 'Remove', danger: true })
    if (!go || receiptId === null) return
    try {
      await receiptsApi.removeFile(receiptId, file.id)
      notify.success('File removed.')
      onChanged()
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The file could not be removed.')
    }
  }

  async function download(file: ReceiptFileDto) {
    if (receiptId === null) return
    try {
      await receiptsApi.downloadFile(receiptId, file.id, file.fileName)
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The file could not be downloaded.')
    }
  }

  return (
    <Paper radius="lg" p="md" withBorder>
      <Title order={5} mb="sm">Attachments</Title>

      {receiptId === null ? (
        <Alert color="blue" variant="light">Save the draft first; files are attached to a saved receipt.</Alert>
      ) : (
        canAdd && (
          <Group align="flex-end" mb="md" wrap="wrap">
            <Select
              label="Type"
              placeholder="Type"
              data={categories}
              value={category}
              onChange={(next) => {
                setCategory(next)
                setSubTypeId(null)
              }}
              clearable
              w={170}
            />
            <Select
              label="Sub type"
              placeholder="Sub type"
              data={subTypes.map((t) => ({ value: String(t.id), label: t.subType }))}
              value={subTypeId}
              onChange={setSubTypeId}
              disabled={category === null}
              clearable
              w={190}
            />
            <TextInput label="Note" placeholder="Optional" maxLength={300} value={note} onChange={(event) => setNote(event.currentTarget.value)} style={{ flex: 1, minWidth: 180 }} />
            <FileButton
              resetRef={resetRef}
              onChange={(file) => void upload(file)}
              accept=".pdf,.xlsx,.xls,.docx,.doc,.png,.jpg,.jpeg,.gif,.webp"
            >
              {(props) => (
                <Button {...props} variant="default" leftSection={<IconPaperclip size={16} />} loading={busy}>
                  Add Attachment
                </Button>
              )}
            </FileButton>
          </Group>
        )
      )}

      <Table.ScrollContainer minWidth={720}>
        <Table striped highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Type</Table.Th>
              <Table.Th>Sub type</Table.Th>
              <Table.Th>Note</Table.Th>
              <Table.Th>File</Table.Th>
              <Table.Th>Date</Table.Th>
              <Table.Th w={80} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {files.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Text size="sm" c="dimmed" ta="center" py="sm">No attachments.</Text>
                </Table.Td>
              </Table.Tr>
            )}
            {files.map((file) => (
              <Table.Tr key={file.id}>
                <Table.Td>{file.category ?? '—'}</Table.Td>
                <Table.Td>{file.subType ?? '—'}</Table.Td>
                <Table.Td>{file.note ?? '—'}</Table.Td>
                <Table.Td>{file.fileName}</Table.Td>
                <Table.Td>
                  <Text size="sm" style={{ whiteSpace: 'nowrap' }}>{stamp(file.createdAtUtc)}</Text>
                  {file.createdByName && <Text size="xs" c="dimmed">{file.createdByName}</Text>}
                </Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap" justify="flex-end">
                    <Tooltip label="Download" withArrow>
                      <ActionIcon variant="subtle" aria-label={`Download ${file.fileName}`} onClick={() => void download(file)}>
                        <IconDownload size={16} />
                      </ActionIcon>
                    </Tooltip>
                    {canRemove && (
                      <Tooltip label="Remove" withArrow>
                        <ActionIcon variant="subtle" color="red" aria-label={`Remove ${file.fileName}`} onClick={() => void remove(file)}>
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
      </Table.ScrollContainer>
    </Paper>
  )
}
