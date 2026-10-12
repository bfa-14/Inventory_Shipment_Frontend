import { useEffect, useMemo, useState } from 'react'
import { Alert, FileInput, SegmentedControl, Select, SimpleGrid, Text, Textarea, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconPaperclip } from '@tabler/icons-react'
import type { AttachmentDocumentKind, DocumentFileEdit } from '../../api/documentFiles'
import { ApiError } from '../../api/http'
import { attachmentTypesApi, type AttachmentTypeLookupDto } from '../../api/masterdata/attachmentTypes'
import { formatNumber } from '../format'
import { FormModal } from '../ui/FormModal'
import type { AttachmentOption } from './AttachmentUploadDialog'
import { ATTACHMENT_ACCEPT, ATTACHMENT_HINT, attachmentFileError } from './attachmentRules'

/** The part of a listed file the edit dialog reads. */
export interface EditableAttachment {
  fileName: string
  attachmentTypeId: number | null
  isOther: boolean
  documentDate: string | null
  note: string | null
  /** A container file's movement (null = General): what "Link to a movement" opens on. */
  movementId?: number | null
  /** Its number, so a movement no longer offered still shows by name. */
  movementNo?: string | null
}

interface AttachmentEditDialogProps {
  /** The file being edited; null = closed. */
  file: EditableAttachment | null
  documentKind: AttachmentDocumentKind
  /**
   * Containers holding the file, this one included (a container upload shared by several). Above one the reader
   * picks how far the change goes; otherwise it goes everywhere the file is.
   */
  sharedCount?: number
  /**
   * Container files only (not a charge's, which stays with its charge): the movements the file may be filed under.
   * Given, the dialog shows "Link to a movement" on the file's movement, cleared = General; the edit then carries
   * movementId when the reader changed it. Empty (and the file on no movement) or left out (every other place), the
   * link is neither shown nor sent.
   */
  movementOptions?: AttachmentOption[] | null
  /** Sends the edit; allShared = every container holding the file (containers only). A throw keeps the dialog open. */
  onSave: (edit: DocumentFileEdit, allShared: boolean) => Promise<unknown>
  onClose: () => void
  onSaved: () => void
}

/**
 * THE "Edit document" popup: a file already attached - its name, type, date and note, the same checks as the upload -
 * and optionally a new version of the file in the same place in the list; on a container page also the movement it is
 * filed under. A file still typed "Other" (attached before types existed) opens with no type picked, so the reader
 * chooses a real one.
 */
export function AttachmentEditDialog(props: AttachmentEditDialogProps) {
  return props.file ? <EditForm {...props} file={props.file} /> : null
}

function EditForm({
  file,
  documentKind,
  sharedCount = 1,
  movementOptions = null,
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
  const [fileName, setFileName] = useState(file.fileName)
  const [nameError, setNameError] = useState<string | null>(null)
  const [replacement, setReplacement] = useState<File | null>(null)
  const [replacementError, setReplacementError] = useState<string | null>(null)
  const [allShared, setAllShared] = useState(true)
  const initialMovement = file.movementId == null ? null : String(file.movementId)
  const [movementId, setMovementId] = useState<string | null>(initialMovement)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    // The file's own type stays in the list even when it is inactive or no longer used for this kind.
    attachmentTypesApi
      .forKind(documentKind, file.attachmentTypeId)
      .then(setTypes)
      .catch(() => setTypes([]))
  }, [documentKind, file.attachmentTypeId])

  // The file's own movement stays choosable even when the page no longer offers it (cancelled, say).
  const movementData = useMemo(() => {
    if (!movementOptions) return []
    if (initialMovement === null || movementOptions.some((o) => o.value === initialMovement)) return movementOptions
    return [{ value: initialMovement, label: file.movementNo ?? `Movement #${initialMovement}` }, ...movementOptions]
  }, [movementOptions, initialMovement, file.movementNo])

  function pick(next: File | null) {
    // The name follows the new file until the reader types one of their own.
    if (fileName.trim() === (replacement?.name ?? file.fileName)) setFileName(next?.name ?? file.fileName)
    setReplacement(next)
    setReplacementError(next ? attachmentFileError(next) : null)
  }

  async function save() {
    const name = fileName.trim()
    if (!name) setNameError('Enter a file name.')
    if (typeId === null) setTypeError('Choose the attachment type.')
    if (!name || typeId === null || replacementError) return
    setSaving(true)
    setFormError(null)
    try {
      await onSave(
        {
          fileName: name,
          fields: { attachmentTypeId: Number(typeId), documentDate, note: note.trim() || null },
          file: replacement,
          // Only a link the reader changed is sent: an untouched one stays exactly as it is.
          ...(movementOptions && movementId !== initialMovement
            ? { movementId: movementId === null ? null : Number(movementId) }
            : {}),
        },
        allShared,
      )
      onSaved()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'The attachment could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormModal
      opened
      title="Edit document"
      saving={saving}
      saveDisabled={replacementError !== null}
      onClose={onClose}
      onSubmit={() => void save()}
    >
      {sharedCount > 1 ? (
        <SegmentedControl
          fullWidth
          data={[
            { value: 'one', label: 'This container only' },
            { value: 'all', label: `All ${formatNumber(sharedCount)} containers` },
          ]}
          value={allShared ? 'all' : 'one'}
          onChange={(next) => setAllShared(next === 'all')}
        />
      ) : null}

      <TextInput
        label="File name"
        withAsterisk
        value={fileName}
        onChange={(e) => {
          setFileName(e.currentTarget.value)
          setNameError(null)
        }}
        error={nameError}
      />
      <FileInput
        label="Replace file (optional)"
        placeholder="Keep the current file"
        accept={ATTACHMENT_ACCEPT}
        value={replacement}
        onChange={pick}
        leftSection={<IconPaperclip size={14} />}
        clearable
        error={replacementError}
        description={ATTACHMENT_HINT}
      />
      {replacement ? (
        <Text fz="xs" c="dimmed">
          The new file takes the place of {file.fileName} in the list.
        </Text>
      ) : null}

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

      {/* As on the upload popup: no field when there is no movement to choose (a never-moved container). movementData
          holds the file's own movement too, so a file still linked to one can always go back to General. */}
      {movementOptions && movementData.length > 0 ? (
        <Select
          label="Link to a movement"
          placeholder="General - not tied to a movement"
          data={movementData}
          value={movementId}
          onChange={setMovementId}
          searchable
          clearable
          nothingFoundMessage="No movement matches"
        />
      ) : null}

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
