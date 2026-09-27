import { useEffect, useState } from 'react'
import { Alert, FileInput, MultiSelect, Select, SimpleGrid, Textarea } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconPaperclip } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { containersApi, type AttachmentCreatedDto } from '../../api/logistics/containers'
import { attachmentTypesApi, type AttachmentTypeLookupDto } from '../../api/masterdata/attachmentTypes'
import { formatNumber } from '../format'
import { FormModal } from '../ui/FormModal'
import { notify } from '../ui/notify'

type Option = { value: string; label: string }

interface AttachmentUploadModalProps {
  opened: boolean
  onClose: () => void
  /** The containers the file always goes to - the one being looked at, or every container of a movement. */
  containerIds: number[]
  /** Containers the reader may add under "Also attach to". */
  otherContainers: Option[]
  /** The movements the file can be filed under ("MOV-2026-000001"). */
  movementOptions: Option[]
  /** Pre-set movement (a movement page uploading its own paperwork). */
  defaultMovementId?: string | null
  /** Files the upload under one charge. */
  chargeId?: number | null
  /** The "Also attach to" boxes ticked on opening. */
  defaultAlsoAttach?: string[]
  onUploaded: (created: AttachmentCreatedDto[]) => void
}

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.bmp,.tif,.tiff,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt'
const MAX_BYTES = 20 * 1024 * 1024

/**
 * One file, filed once, on as many containers as it concerns. A bill of lading covers every box on
 * the vessel; uploading it once and ticking the others stores ONE file the containers all point at,
 * so deleting it later can be for one container or for all of them.
 */
export function AttachmentUploadModal(props: AttachmentUploadModalProps) {
  // The form is a child so that closing forgets it: the next opening starts empty.
  return props.opened ? <UploadForm {...props} /> : null
}

function UploadForm({
  onClose,
  containerIds,
  otherContainers,
  movementOptions,
  defaultMovementId = null,
  chargeId = null,
  defaultAlsoAttach = [],
  onUploaded,
}: AttachmentUploadModalProps) {
  const [types, setTypes] = useState<AttachmentTypeLookupDto[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [typeId, setTypeId] = useState<string | null>(null)
  const [documentDate, setDocumentDate] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [movementId, setMovementId] = useState<string | null>(defaultMovementId)
  const [alsoAttach, setAlsoAttach] = useState<string[]>(defaultAlsoAttach)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    attachmentTypesApi.lookup(true).then(setTypes).catch(() => {})
  }, [])

  function pick(next: File | null) {
    setFile(next)
    // Checked here rather than left to the server: a 60 MB scan should not be uploaded to be refused.
    setFileError(next && next.size > MAX_BYTES ? `The file is ${formatNumber(next.size / 1024 / 1024, 1)} MB; the limit is 20 MB.` : null)
  }

  async function upload() {
    if (!file) {
      setFileError('Choose a file.')
      return
    }
    if (fileError) return
    const ids = [...new Set([...containerIds, ...alsoAttach.map(Number)])]
    if (ids.length === 0) {
      setFormError('The file needs at least one container.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const created = await containersApi.addAttachment({
        file,
        containerIds: ids,
        movementId: movementId === null ? null : Number(movementId),
        chargeId,
        attachmentTypeId: typeId === null ? null : Number(typeId),
        note: note.trim() || null,
        documentDate,
      })
      notify.success(ids.length > 1 ? `${file.name} attached to ${formatNumber(ids.length)} containers.` : `${file.name} attached.`)
      onUploaded(created)
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'The file could not be uploaded.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormModal opened title="Upload document" saveLabel="Upload" saving={saving} saveDisabled={fileError !== null} onClose={onClose} onSubmit={() => void upload()}>
      <FileInput
        label="File"
        placeholder="PDF, image or Office file, up to 20 MB"
        withAsterisk
        accept={ACCEPT}
        value={file}
        onChange={pick}
        leftSection={<IconPaperclip size={14} />}
        clearable
        error={fileError}
      />

      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Select
          label="Attachment type"
          placeholder="Pick a type"
          data={types.map((t) => ({ value: String(t.id), label: t.displayName }))}
          value={typeId}
          onChange={setTypeId}
          searchable
          clearable
          nothingFoundMessage="No type matches"
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

      <Select
        label="Link to a movement"
        placeholder="General - not tied to a movement"
        data={movementOptions}
        value={movementId}
        onChange={setMovementId}
        searchable
        clearable
        nothingFoundMessage="No movement matches"
      />

      {otherContainers.length > 0 ? (
        <MultiSelect
          // With no fixed container (a movement's upload) every box is a choice, pre-ticked.
          label={containerIds.length > 0 ? 'Also attach to' : 'Attach to containers'}
          description="The same file is shared, not copied: one upload, several containers."
          placeholder={alsoAttach.length === 0 ? 'Pick containers' : undefined}
          data={otherContainers}
          value={alsoAttach}
          onChange={setAlsoAttach}
          searchable
          clearable
          nothingFoundMessage="No container matches"
        />
      ) : null}

      <Textarea label="Note" autosize minRows={2} maxLength={300} value={note} onChange={(e) => setNote(e.currentTarget.value)} />

      {formError ? <Alert color="red">{formError}</Alert> : null}
    </FormModal>
  )
}
