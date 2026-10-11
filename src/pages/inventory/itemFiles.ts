/**
 * The client-side half of the item PICTURE's upload rules. The API enforces all of this again - these checks exist so
 * a reader who picks a 6 MB photo is told immediately, instead of watching it upload and then be refused.
 *
 * Only the picture: the item's documents follow the shared attachment rules (components/attachments/attachmentRules,
 * 20 MB, a type for each file) since script 67.
 */

/** Must match the picture's cap in ItemService. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024

/** What the item image may be. The picture is rendered straight into an <img>. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** The `accept` attribute for the picture's file input, so the picker offers the right files first. */
export const IMAGE_ACCEPT = IMAGE_TYPES.join(',')

/** Why this file cannot be the item's picture, or null when it can. */
export function fileRejection(file: File): string | null {
  if (file.size === 0) return `${file.name} is empty.`

  if (file.size > MAX_FILE_BYTES) {
    return `${file.name} is ${formatBytes(file.size)} - the limit is ${formatBytes(MAX_FILE_BYTES)}.`
  }

  if (!IMAGE_TYPES.includes(file.type)) return `${file.name} is not an image. Choose a JPEG, PNG or WebP file.`

  return null
}

/** "4.2 MB" - sizes as a reader thinks of them, not as bytes. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
