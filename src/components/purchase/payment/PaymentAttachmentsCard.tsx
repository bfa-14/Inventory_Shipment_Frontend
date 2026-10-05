import { useMemo, useRef, useState } from 'react'
import { ActionIcon, Alert, Button, FileButton, Group, Paper, Select, Table, Text, TextInput, Title, Tooltip } from '@mantine/core'
import { IconDownload, IconPaperclip, IconPencil, IconTrash } from '@tabler/icons-react'
import { ApiError } from '../../../api/http'
import type { AttachmentTypeLookupDto } from '../../../api/masterdata/attachmentTypes'
import { paymentsApi, type PaymentFileDto } from '../../../api/purchase/payments'
import { stamp } from '../../documents/documentKind'
import { EditAttachmentModal } from '../../documents/EditAttachmentModal'
import { confirm } from '../../ui/confirm'
import { notify } from '../../ui/notify'

const MAX_BYTES = 10 * 1024 * 1024
const ACCEPT = '.pdf,.xlsx,.xls,.docx,.doc,.png,.jpg,.jpeg,.gif,.webp'

interface PaymentAttachmentsCardProps {
  /** Null until the payment has been saved once: there is nothing to attach a file to before that. */
  paymentId: number | null
  files: PaymentFileDto[]
  types: AttachmentTypeLookupDto[]
  /** Adding is allowed on a posted payment too — the SWIFT copy often arrives after the transfer. */
  canAdd: boolean
  /** Until the payment is reversed; a reversed payment's evidence stays as it was. */
  canRemove: boolean
  canEdit: boolean
  onChanged: () => void
}

/** Why a file cannot be attached, or null when it can. */
function rejection(file: File): string | null {
  return file.size > MAX_BYTES ? 'That file is larger than 10 MB.' : null
}

/**
 * 4 - Attachments: the proof behind the money - the SWIFT copy, the cheque copy, the payment voucher, the
 * supplier's advice. Type and Sub Type come from the attachment types master data filtered to Payment.
 */
export function PaymentAttachmentsCard({ paymentId, files, types, canAdd, canRemove, canEdit, onChanged }: PaymentAttachmentsCardProps) {
  const [category, setCategory] = useState<string | null>(null)
  const [subTypeId, setSubTypeId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const resetRef = useRef<() => void>(null)
  const [editing, setEditing] = useState<PaymentFileDto | null>(null)
  const [editCategory, setEditCategory] = useState<string | null>(null)
  const [editSubTypeId, setEditSubTypeId] = useState<string | null>(null)
  const [editNote, setEditNote] = useState('')

  const categories = useMemo(() => [...new Set(types.map((t) => t.category))], [types])
  const subTypes = useMemo(() => types.filter((t) => t.category === category), [types, category])
  const editSubTypes = useMemo(() => types.filter((t) => t.category === editCategory), [types, editCategory])

  function openEdit(file: PaymentFileDto) {
    setEditing(file)
    setEditCategory(file.category)
    setEditSubTypeId(file.attachmentTypeId === null ? null : String(file.attachmentTypeId))
    setEditNote(file.note ?? '')
  }

  async function update(file: PaymentFileDto, fileName: string, replacement: File | null) {
    if (paymentId === null) return
    await paymentsApi.updateFile(paymentId, file.id, {
      fileName,
      attachmentTypeId: editSubTypeId === null ? null : Number(editSubTypeId),
      note: editNote,
      file: replacement,
    })
    notify.success('File updated.')
    onChanged()
  }

  async function upload(file: File | null) {
    if (!file || paymentId === null) return
    const rejected = rejection(file)
    if (rejected) {
      notify.error(rejected)
      resetRef.current?.()
      return
    }
    setBusy(true)
    try {
      await paymentsApi.addFile(paymentId, file, subTypeId === null ? null : Number(subTypeId), note)
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

  async function remove(file: PaymentFileDto) {
    const go = await confirm({ title: 'Remove file', message: `Remove ${file.fileName} from this payment?`, confirmLabel: 'Remove', danger: true })
    if (!go || paymentId === null) return
    try {
      await paymentsApi.removeFile(paymentId, file.id)
      notify.success('File removed.')
      onChanged()
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The file could not be removed.')
    }
  }

  async function download(file: PaymentFileDto) {
    if (paymentId === null) return
    try {
      await paymentsApi.downloadFile(paymentId, file.id, file.fileName)
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The file could not be downloaded.')
    }
  }

  return (
    <Paper radius="lg" p="md" withBorder>
      <Title order={5} mb="sm">4 · Attachments</Title>

      {paymentId === null ? (
        <Alert color="blue" variant="light">Save the draft first; files are attached to a saved payment.</Alert>
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
              accept={ACCEPT}
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
              <Table.Th w={110} />
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
                    {canEdit && (
                      <Tooltip label="Edit" withArrow>
                        <ActionIcon variant="subtle" aria-label={`Edit ${file.fileName}`} onClick={() => openEdit(file)}>
                          <IconPencil size={16} />
                        </ActionIcon>
                      </Tooltip>
                    )}
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

      <EditAttachmentModal
        opened={editing !== null}
        fileName={editing?.fileName ?? ''}
        accept={ACCEPT}
        check={rejection}
        onClose={() => setEditing(null)}
        onSave={async (edit) => {
          if (editing) await update(editing, edit.fileName, edit.file)
        }}
      >
        <Group grow align="flex-start">
          <Select
            label="Type"
            placeholder="Type"
            data={categories}
            value={editCategory}
            onChange={(next) => {
              setEditCategory(next)
              setEditSubTypeId(null)
            }}
            clearable
          />
          <Select
            label="Sub type"
            placeholder="Sub type"
            data={editSubTypes.map((t) => ({ value: String(t.id), label: t.subType }))}
            value={editSubTypeId}
            onChange={setEditSubTypeId}
            disabled={editCategory === null}
            clearable
          />
        </Group>
        <TextInput label="Note" placeholder="Optional" maxLength={300} value={editNote} onChange={(event) => setEditNote(event.currentTarget.value)} />
      </EditAttachmentModal>
    </Paper>
  )
}
