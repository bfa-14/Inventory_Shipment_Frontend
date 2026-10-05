import { fetchBlob, postForm, request } from './http'

/**
 * The files of a document - purchase, sales and stock documents, customer receipts - with their type, date and
 * note. Every family answers the same routes under its own base: GET / POST {id}/files, GET / PUT / DELETE
 * {id}/files/{fileId}. The containers keep their own routes (containersApi) and the same fields.
 */

/** What an attachment type is used for: CONTAINER or a document type code (api/masterdata/attachment-types/document-kinds). */
export type AttachmentDocumentKind =
  'CONTAINER' | 'PO' | 'PINV' | 'PRET' | 'SO' | 'SINV' | 'SRET' | 'RCPT' | 'INV_IN' | 'INV_OUT'

export interface DocumentFileDto {
  id: number
  documentId: number
  fileName: string
  contentType: string
  sizeBytes: number
  attachmentTypeId: number | null
  category: string | null
  subType: string | null
  /** Typed "Other" (files from before types existed): the page asks for a real type. */
  isOther: boolean
  /** yyyy-MM-dd (the API adds a midnight time; only the date counts). */
  documentDate: string | null
  note: string | null
  createdAtUtc: string
  createdBy: number | null
  createdByName: string | null
}

/** The type (required), date and note of a file: the upload's fields and the body of its PUT. */
export interface DocumentFileFields {
  attachmentTypeId: number
  documentDate: string | null
  note: string | null
}

/** The multipart body of an upload: the file and its fields. */
export function attachmentForm(file: File, fields: DocumentFileFields): FormData {
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('attachmentTypeId', String(fields.attachmentTypeId))
  if (fields.documentDate) form.append('documentDate', fields.documentDate.slice(0, 10))
  if (fields.note) form.append('note', fields.note)
  return form
}

export interface DocumentFilesApi {
  list(documentId: number, attachmentTypeId?: number): Promise<DocumentFileDto[]>
  add(documentId: number, file: File, fields: DocumentFileFields): Promise<{ id: number }>
  update(documentId: number, fileId: number, fields: DocumentFileFields): Promise<DocumentFileDto>
  download(documentId: number, fileId: number, fileName: string): Promise<void>
  remove(documentId: number, fileId: number): Promise<void>
}

/** The file calls of one family, e.g. documentFilesApi('/api/purchase/documents'). */
export function documentFilesApi(base: string): DocumentFilesApi {
  return {
    list: (documentId, attachmentTypeId) =>
      request<DocumentFileDto[]>(
        `${base}/${documentId}/files${attachmentTypeId ? `?attachmentTypeId=${attachmentTypeId}` : ''}`,
      ),
    add: (documentId, file, fields) =>
      postForm<{ id: number }>(`${base}/${documentId}/files`, attachmentForm(file, fields)),
    update: (documentId, fileId, fields) =>
      request<DocumentFileDto>(`${base}/${documentId}/files/${fileId}`, { method: 'PUT', body: fields }),
    download: async (documentId, fileId, fileName) =>
      saveBlob(await fetchBlob(`${base}/${documentId}/files/${fileId}`), fileName),
    remove: (documentId, fileId) => request<void>(`${base}/${documentId}/files/${fileId}`, { method: 'DELETE' }),
  }
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
