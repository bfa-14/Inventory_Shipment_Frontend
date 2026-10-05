import { useEffect, useState } from 'react'
import { Alert, FileInput, MultiSelect, Select, SimpleGrid, Text, Textarea } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconPaperclip } from '@tabler/icons-react'
import type { AttachmentDocumentKind, DocumentFileFields } from '../../api/documentFiles'
import { ApiError } from '../../api/http'
import { attachmentTypesApi, type AttachmentTypeLookupDto } from '../../api/masterdata/attachmentTypes'
import { FormModal } from '../ui/FormModal'
import { ATTACHMENT_ACCEPT, ATTACHMENT_HINT, attachmentFileError } from './attachmentRules'

export type AttachmentOption = { value: string; label: string }

/**
 * Where a container file is filed - only the container pages have it, because only their API takes it: the
 * containers it always goes to, the others it may be shared with ("Also attach to"), the movement it belongs to.
 */
export interface ContainerFiling {
  /** The containers the file always goes to (the one being looked at; none on a movement's upload). */
  containerIds: number[]
  /** The containers the reader may add under "Also attach to". */
  otherContainers: AttachmentOption[]
  /** The movements the file can be filed under; none = no movement choice. */
  movementOptions: AttachmentOption[]
  defaultMovementId?: string | null
  /** The "Also attach to" boxes ticked on opening. */
  defaultAlsoAttach?: string[]
  /** A line said instead of the choices (a charge's upload: "Filed under charge #12 on 3 containers"). */
  fixedText?: string
}

/** What the filing became: the containers and the movement the reader chose. */
export interface ContainerFilingValue {
  containerIds: number[]
  movementId: number | null
}

interface AttachmentUploadDialogProps {
  opened: boolean
  /** Whose types are offered: only those used for this kind. */
  documentKind: AttachmentDocumentKind
  /** The file dropped or picked before the dialog opened. */
  initialFile?: File | null
  filing?: ContainerFiling | null
  /** Sends it; a refusal is shown in the dialog, which stays open. */
  onUpload: (file: File, fields: DocumentFileFields, filing: ContainerFilingValue) => Promise<unknown>
  onClose: () => void
  onUploaded: (fileName: string) => void
}

/**
 * THE upload of every attachment place - purchase orders, invoices and returns, sales documents, stock documents,
 * customer receipts and containers: the file, its type (required, only the types used for this kind of
 * document), the date written on it and a note. Dropping or picking a file elsewhere only opens this dialog
 * with the file filled in, so nothing is ever uploaded without a type.
 */
export function AttachmentUploadDialog(props: AttachmentUploadDialogProps) {
  // The form is a child so that closing forgets it: the next opening starts empty.
  return props.opened ? <UploadForm {...props} /> : null
}

function UploadForm({
  documentKind,
  initialFile = null,
  filing = null,
  onUpload,
  onClose,
  onUploaded,
}: AttachmentUploadDialogProps) {
  const [types, setTypes] = useState<AttachmentTypeLookupDto[] | null>(null)
  const [file, setFile] = useState<File | null>(initialFile)
  const [fileError, setFileError] = useState<string | null>(initialFile ? attachmentFileError(initialFile) : null)
  const [typeId, setTypeId] = useState<string | null>(null)
  const [typeError, setTypeError] = useState<string | null>(null)
  const [documentDate, setDocumentDate] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [movementId, setMovementId] = useState<string | null>(filing?.defaultMovementId ?? null)
  const [alsoAttach, setAlsoAttach] = useState<string[]>(filing?.defaultAlsoAttach ?? [])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    attachmentTypesApi
      .forKind(documentKind)
      .then(setTypes)
      .catch(() => setTypes([]))
  }, [documentKind])

  function pick(next: File | null) {
    setFile(next)
    setFileError(next ? attachmentFileError(next) : null)
  }

  async function upload() {
    const missingFile = file === null
    const missingType = typeId === null
    if (missingFile) setFileError('Choose a file.')
    if (missingType) setTypeError('Choose the attachment type.')
    if (missingFile || missingType || fileError) return

    const containerIds = filing ? [...new Set([...filing.containerIds, ...alsoAttach.map(Number)])] : []
    if (filing && containerIds.length === 0) {
      setFormError('The file needs at least one container.')
      return
    }

    setSaving(true)
    setFormError(null)
    try {
      await onUpload(
        file,
        { attachmentTypeId: Number(typeId), documentDate, note: note.trim() || null },
        { containerIds, movementId: movementId === null ? null : Number(movementId) },
      )
      onUploaded(file.name)
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'The file could not be uploaded.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormModal
      opened
      title="Upload document"
      saveLabel="Upload"
      saving={saving}
      saveDisabled={fileError !== null}
      onClose={onClose}
      onSubmit={() => void upload()}
    >
      <FileInput
        label="File"
        placeholder={ATTACHMENT_HINT}
        withAsterisk
        accept={ATTACHMENT_ACCEPT}
        value={file}
        onChange={pick}
        leftSection={<IconPaperclip size={14} />}
        clearable
        error={fileError}
        description={ATTACHMENT_HINT}
      />

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
          error={
            typeError ??
            (types !== null && types.length === 0
              ? 'No attachment type is used for this kind of document: add one in Master Data › Attachment Types.'
              : null)
          }
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

      {filing?.fixedText ? (
        <Text fz="sm" c="dimmed">
          {filing.fixedText}
        </Text>
      ) : null}

      {filing && filing.movementOptions.length > 0 ? (
        <Select
          label="Link to a movement"
          placeholder="General - not tied to a movement"
          data={filing.movementOptions}
          value={movementId}
          onChange={setMovementId}
          searchable
          clearable
          nothingFoundMessage="No movement matches"
        />
      ) : null}

      {filing && filing.otherContainers.length > 0 ? (
        <MultiSelect
          // With no fixed container (a movement's upload) every box is a choice, pre-ticked.
          label={filing.containerIds.length > 0 ? 'Also attach to' : 'Attach to containers'}
          description="The same file is shared, not copied: one upload, several containers."
          placeholder={alsoAttach.length === 0 ? 'Pick containers' : undefined}
          data={filing.otherContainers}
          value={alsoAttach}
          onChange={setAlsoAttach}
          searchable
          clearable
          nothingFoundMessage="No container matches"
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
