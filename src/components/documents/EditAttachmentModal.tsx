import { useState, type ReactNode } from 'react'
import { FileInput, TextInput } from '@mantine/core'
import { IconPaperclip } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { FormModal } from '../ui/FormModal'
import { notify } from '../ui/notify'

export interface AttachmentEdit {
  fileName: string
  /** Null = keep the stored file. */
  file: File | null
}

interface EditAttachmentModalProps {
  opened: boolean
  /** The name the file has now. */
  fileName: string
  /** The picker's `accept` attribute. */
  accept: string
  /** Why a replacement cannot be used, or null when it can - the same rules the upload applies. */
  check(file: File): string | null
  onClose(): void
  /** Sends the change and reloads; a throw keeps the dialog open. */
  onSave(edit: AttachmentEdit): Promise<void>
  /** The family's own fields (type, note, date), held by the caller. */
  children?: ReactNode
}

/**
 * A file's details, and optionally a new version of it in the same place in the list. Every
 * attachment list in the app opens this one; the families differ only in the fields they add.
 */
export function EditAttachmentModal(props: EditAttachmentModalProps) {
  // Mounted only while open, so the next opening starts from the row again.
  return props.opened ? <EditForm {...props} /> : null
}

function EditForm({ fileName: original, accept, check, onClose, onSave, children }: EditAttachmentModalProps) {
  const [fileName, setFileName] = useState(original)
  const [file, setFile] = useState<File | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function pick(next: File | null) {
    // The name follows the file until the reader types one of their own.
    const untouched = fileName.trim() === (file?.name ?? original)
    if (untouched) setFileName(next?.name ?? original)
    setFile(next)
    setFileError(next ? check(next) : null)
  }

  async function save() {
    const name = fileName.trim()
    if (!name) {
      setNameError('Enter a file name.')
      return
    }
    if (fileError) return
    setSaving(true)
    try {
      await onSave({ fileName: name, file })
      onClose()
    } catch (error) {
      notify.error(error instanceof ApiError ? error.message : 'The attachment could not be updated.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormModal opened title="Edit attachment" size="md" saving={saving} saveDisabled={fileError !== null} onClose={onClose} onSubmit={() => void save()}>
      <TextInput
        label="File name"
        withAsterisk
        value={fileName}
        onChange={(event) => {
          setFileName(event.currentTarget.value)
          setNameError(null)
        }}
        error={nameError}
      />
      <FileInput
        label="Replace file (optional)"
        placeholder="Keep the current file"
        accept={accept}
        value={file}
        onChange={pick}
        leftSection={<IconPaperclip size={14} />}
        clearable
        error={fileError}
      />
      {children}
    </FormModal>
  )
}
