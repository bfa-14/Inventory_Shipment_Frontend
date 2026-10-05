import { useEffect, useState } from 'react'
import { Alert, Select, SimpleGrid, Text, Textarea } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import type { AttachmentDocumentKind, DocumentFileFields } from '../../api/documentFiles'
import { ApiError } from '../../api/http'
import { attachmentTypesApi, type AttachmentTypeLookupDto } from '../../api/masterdata/attachmentTypes'
import { FormModal } from '../ui/FormModal'

/** The part of a listed file the edit dialog reads. */
export interface EditableAttachment {
  fileName: string
  attachmentTypeId: number | null
  isOther: boolean
  documentDate: string | null
  note: string | null
}

interface AttachmentEditDialogProps {
  /** The file being edited; null = closed. */
  file: EditableAttachment | null
  documentKind: AttachmentDocumentKind
  onSave: (fields: DocumentFileFields) => Promise<unknown>
  onClose: () => void
  onSaved: () => void
}

/**
 * The type, date and note of a file already attached - the same checks as the upload. A file still typed "Other"
 * (attached before types existed) opens with no type picked, so the reader chooses a real one.
 */
export function AttachmentEditDialog(props: AttachmentEditDialogProps) {
  return props.file ? <EditForm {...props} file={props.file} /> : null
}

function EditForm({
  file,
  documentKind,
  onSave,
  onClose,
  onSaved,
}: AttachmentEditDialogProps & { file: EditableAttachment }) {
  const [types, setTypes] = useState<AttachmentTypeLookupDto[] | null>(null)
  const [typeId, setTypeId] = useState<string | null>(
    file.isOther || file.attachmentTypeId === null ? null : String(file.attachmentTypeId),
  )
  const [typeError, setTypeError] = useState<string | null>(null)
  const [documentDate, setDocumentDate] = useState<string | null>(
    file.documentDate ? file.documentDate.slice(0, 10) : null,
  )
  const [note, setNote] = useState(file.note ?? '')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    // The file's own type stays in the list even when it is inactive or no longer used for this kind.
    attachmentTypesApi
      .forKind(documentKind, file.attachmentTypeId)
      .then(setTypes)
      .catch(() => setTypes([]))
  }, [documentKind, file.attachmentTypeId])

  async function save() {
    if (typeId === null) {
      setTypeError('Choose the attachment type.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await onSave({ attachmentTypeId: Number(typeId), documentDate, note: note.trim() || null })
      onSaved()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'The attachment could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormModal opened title="Edit attachment" saving={saving} onClose={onClose} onSubmit={() => void save()}>
      <Text fz="sm" fw={500} style={{ wordBreak: 'break-all' }}>
        {file.fileName}
      </Text>

      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Select
          label="Attachment type"
          placeholder={types === null ? 'Loading…' : 'Pick a type'}
          withAsterisk
          data={(types ?? []).map((t) => ({ value: String(t.id), label: t.displayName.replace(' / ', ' › ') }))}
          value={typeId}
          onChange={(next) => {
            setTypeId(next)
            setTypeError(null)
          }}
          searchable
          nothingFoundMessage="No type matches"
          error={typeError}
          description={file.isOther ? 'Still typed "Other": choose what this file is.' : undefined}
        />
        <DateInput
          label="Document date"
          placeholder="Date on the document"
          valueFormat="DD/MM/YYYY"
          value={documentDate}
          onChange={(next) => setDocumentDate(next ? String(next).slice(0, 10) : null)}
          clearable
        />
      </SimpleGrid>

      <Textarea
        label="Note"
        autosize
        minRows={2}
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
      />

      {formError ? <Alert color="red">{formError}</Alert> : null}
    </FormModal>
  )
}
