/**
 * The client-side half of the item upload rules. The API enforces all of this again - these checks
 * exist so a reader who picks a 6 MB photo is told immediately, instead of watching it upload and
 * then be refused.
 */

/** Must match the cap in ItemService. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024

/** What the item image may be. The picture is rendered straight into an <img>. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** What an attachment may be: the image types plus the usual documents. */
export const ATTACHMENT_TYPES = [
  ...IMAGE_TYPES,
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]

/** The `accept` attribute for a file input, so the picker offers the right files first. */
export const IMAGE_ACCEPT = IMAGE_TYPES.join(',')
export const ATTACHMENT_ACCEPT = `${ATTACHMENT_TYPES.join(',')},.doc,.docx,.xls,.xlsx,.pdf,.txt`

/** Why this file cannot be uploaded, or null when it can. */
export function fileRejection(file: File, kind: 'image' | 'attachment'): string | null {
  if (file.size === 0) return `${file.name} is empty.`

  if (file.size > MAX_FILE_BYTES) {
    return `${file.name} is ${formatBytes(file.size)} - the limit is ${formatBytes(MAX_FILE_BYTES)}.`
  }

  const allowed = kind === 'image' ? IMAGE_TYPES : ATTACHMENT_TYPES
  if (!allowed.includes(file.type)) {
    return kind === 'image'
      ? `${file.name} is not an image. Choose a JPEG, PNG or WebP file.`
      : `${file.name} is not an allowed file type. Choose an image, PDF, Word, Excel or text file.`
  }

  return null
}

/** "4.2 MB" - sizes as a reader thinks of them, not as bytes. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
