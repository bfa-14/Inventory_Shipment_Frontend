import { fetchBlob, postForm, putForm, request } from './http'

/**
 * The files of a document - purchase, sales and stock documents, goods receipts, customer receipts, supplier payments, and the
 * documents of an item definition (script 67) - with their type, date and note. Every family answers the same routes
 * under its own base: GET / POST {id}/files, GET / PUT / DELETE {id}/files/{fileId}. The containers keep their own
 * routes (containersApi) and the same fields. An item's PICTURE is not one of these files: it keeps its own upload
 * (itemsApi.addImage) and never appears in the list.
 */

/**
 * What an attachment type is used for: CONTAINER, ITEM (an item definition's documents, script 67) or a document type
 * code (api/masterdata/attachment-types/document-kinds).
 */
export type AttachmentDocumentKind =
  | 'CONTAINER'
  | 'ITEM'
  | 'PO'
  | 'PINV'
  | 'PRET'
  | 'SO'
  | 'SINV'
  | 'SRET'
  | 'RCPT'
  | 'PAY'
  | 'INV_IN'
  | 'INV_OUT'
  | 'BIV_OUT'
  /** Goods receipts (scripts 64-65): the delivery note, the packing list, the signed count sheet. */
  | 'GRN'
  /**
   * Transfer orders (script 90): the request, the waybill, the signed dispatch note. One kind for the order and its
   * dispatches and receipts, which have no files of their own; its "Used for" rows start as Inventory Out's.
   */
  | 'TRO'

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

/** The type (required), date and note of a file: the fields of an upload and of an edit. */
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

/**
 * An edit of a file already attached (PUT .../files/{fileId}, script 55): its name, its type / date / note, and
 * optionally a new version of the file, which takes the old one's place in the list.
 */
export interface DocumentFileEdit {
  fileName: string
  fields: DocumentFileFields
  /** Null keeps the stored file. */
  file: File | null
  /**
   * Containers only (script 67): the movement the file is filed under from now on, null = General. Left out = the
   * link stays as it is - every document family, and a container edit whose "Link to a movement" was not changed.
   * containersApi.updateAttachment sends it; attachmentEditForm ignores it.
   */
  movementId?: number | null
}

/** The multipart body of an edit: the name, the fields and the new version when there is one. */
export function attachmentEditForm(edit: DocumentFileEdit): FormData {
  const form = new FormData()
  form.append('fileName', edit.fileName)
  form.append('attachmentTypeId', String(edit.fields.attachmentTypeId))
  if (edit.fields.documentDate) form.append('documentDate', edit.fields.documentDate.slice(0, 10))
  if (edit.fields.note) form.append('note', edit.fields.note)
  if (edit.file) form.append('file', edit.file, edit.file.name)
  return form
}

export interface DocumentFilesApi {
  list(documentId: number, attachmentTypeId?: number): Promise<DocumentFileDto[]>
  add(documentId: number, file: File, fields: DocumentFileFields): Promise<{ id: number }>
  update(documentId: number, fileId: number, edit: DocumentFileEdit): Promise<DocumentFileDto>
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
    update: (documentId, fileId, edit) =>
      putForm<DocumentFileDto>(`${base}/${documentId}/files/${fileId}`, attachmentEditForm(edit)),
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
