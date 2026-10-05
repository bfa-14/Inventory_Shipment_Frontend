import { formatNumber } from '../format'

/**
 * What every attachment endpoint accepts (the API's AttachmentRules): the containers' list since script 27, on
 * every document since script 48. The server checks again; this saves uploading a 60 MB scan to be refused.
 */
export const ATTACHMENT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.tif,.tiff,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt'

export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024

/** The one sentence every upload place shows. */
export const ATTACHMENT_HINT = 'PDF, image or Office file, up to 20 MB'

const EXTENSIONS = ATTACHMENT_ACCEPT.split(',')

/** The refusal of a file, or null when it may be attached. */
export function attachmentFileError(file: File): string | null {
  const dot = file.name.lastIndexOf('.')
  const extension = dot < 0 ? '' : file.name.slice(dot).toLowerCase()
  if (!EXTENSIONS.includes(extension)) return `${file.name} cannot be attached: ${ATTACHMENT_HINT}.`
  if (file.size > ATTACHMENT_MAX_BYTES)
    return `The file is ${formatNumber(file.size / 1024 / 1024, 1)} MB; the limit is 20 MB.`
  return null
}

/** "Purchase › Proforma Invoice" - the type badge of every list. */
export function attachmentTypeLabel(category: string | null | undefined, subType: string | null | undefined): string {
  return [category, subType].filter(Boolean).join(' › ') || 'No type'
}

/** "4.2 MB" - sizes as a reader thinks of them. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${formatNumber(bytes)} B`
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, 0)} KB`
  return `${formatNumber(bytes / (1024 * 1024), 1)} MB`
}
