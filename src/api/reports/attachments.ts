import { postForBlob, request } from '../http'

/**
 * Reports › Attachment Report (script 101): every module's attachments, by attachment type and by two date ranges (the
 * document date typed on the file, and the day it was uploaded), paged on the server.
 *
 * Each reader sees and downloads only the files of the documents they may open; the API filters, the page never does.
 * A download above the limits (`maxFiles` / `maxBytes`) is refused with code TOO_LARGE.
 */
const BASE = '/api/reports/attachments'

export interface AttachmentReportFilters {
  /** Attachment type ids; empty = every type. */
  typeIds: number[]
  /** yyyy-MM-dd, inclusive. */
  documentDateFrom: string | null
  documentDateTo: string | null
  uploadedFrom: string | null
  uploadedTo: string | null
}

export interface AttachmentReportRowDto {
  /** "CNT:12": what a download names the file by. */
  key: string
  source: string
  id: number
  /** PO, PINV, GRN, CONTAINER, ITEM, ... and what it is called ("Purchase invoice"). */
  documentKind: string
  documentKindName: string
  ownerId: number
  /** The container ref, document number or item code. */
  reference: string
  /** The page that opens the document; null when it has none. */
  ownerPath: string | null
  attachmentTypeId: number | null
  /** "Container › Commercial Invoice", or "Other". */
  typeLabel: string
  fileName: string
  contentType: string
  sizeBytes: number
  /** Plain date (the document's own), or null. */
  documentDate: string | null
  uploadedAtUtc: string
  uploadedByName: string | null
  /** "KTG-2026-0031 - Container Commercial Invoice - 2026-03-14 - invoice.pdf". */
  downloadName: string
}

export interface AttachmentReportResult {
  items: AttachmentReportRowDto[]
  totalCount: number
  totalBytes: number
  page: number
  pageSize: number
  maxFiles: number
  maxBytes: number
  /** What "Download all" names its ZIP for these filters. */
  zipFileName: string
}

export interface AttachmentReportTypeDto {
  id: number
  category: string
  subType: string
  isActive: boolean
}

function toQuery(filters: AttachmentReportFilters, page: number, pageSize: number): string {
  const params = new URLSearchParams()
  for (const id of filters.typeIds) params.append('typeIds', String(id))
  if (filters.documentDateFrom) params.set('documentDateFrom', filters.documentDateFrom)
  if (filters.documentDateTo) params.set('documentDateTo', filters.documentDateTo)
  if (filters.uploadedFrom) params.set('uploadedFrom', filters.uploadedFrom)
  if (filters.uploadedTo) params.set('uploadedTo', filters.uploadedTo)
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))
  return `?${params.toString()}`
}

export const attachmentReportApi = {
  list: (filters: AttachmentReportFilters, page: number, pageSize: number, signal?: AbortSignal) =>
    request<AttachmentReportResult>(`${BASE}${toQuery(filters, page, pageSize)}`, { signal }),

  types: (signal?: AbortSignal) => request<AttachmentReportTypeDto[]>(`${BASE}/types`, { signal }),

  /** The chosen files: one comes back as itself, several as a ZIP. */
  downloadSelected: (keys: string[], signal?: AbortSignal) => postForBlob(`${BASE}/download`, { keys, all: false }, signal),

  /** Every file matching the filters, as a ZIP. */
  downloadAll: (filters: AttachmentReportFilters, signal?: AbortSignal) =>
    postForBlob(`${BASE}/download`, { ...filters, all: true }, signal),
}
