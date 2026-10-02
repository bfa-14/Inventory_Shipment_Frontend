import { request } from './http'
import type { PagedResult } from './types'

/**
 * The Email log: every email the application queued, its status and its HTML. Needs `messaging.emails.view`.
 * Emails are sent by the server's outbox worker; while sending is off they stay Pending here.
 */
const BASE = '/api/settings/emails'

export type EmailStatus = 'Pending' | 'Sent' | 'Failed'

/** What an email is about; the server's categories, with the words the page shows. */
export const EMAIL_CATEGORIES: { value: string; label: string }[] = [
  { value: 'PurchaseApproval', label: 'Approval request' },
  { value: 'PurchaseApprovalReminder', label: 'Approval reminder' },
  { value: 'PurchaseOrderApproved', label: 'Order approved' },
  { value: 'PurchaseOrderRejected', label: 'Order rejected' },
  { value: 'PurchaseOrderToSupplier', label: 'Order to the supplier' },
  { value: 'Test', label: 'Test' },
]

export function categoryLabel(category: string): string {
  return EMAIL_CATEGORIES.find((c) => c.value === category)?.label ?? category
}

export interface EmailListDto {
  id: number
  /** Addresses separated by ";". */
  toAddresses: string
  ccAddresses: string | null
  subject: string
  category: string
  /** The purchase order the email is about, when there is one. */
  relatedDocumentId: number | null
  status: EmailStatus
  attempts: number
  nextAttemptAtUtc: string
  lastError: string | null
  createdAtUtc: string
  sentAtUtc: string | null
  attachmentName: string | null
  attachmentSize: number | null
}

export interface EmailDto extends EmailListDto {
  bodyHtml: string
  attachmentContentType: string | null
}

export interface EmailQuery {
  search?: string
  status?: EmailStatus
  category?: string
  relatedDocumentId?: number
  /** ISO dates (yyyy-MM-dd), inclusive: the day the email was queued. */
  dateFrom?: string
  dateTo?: string
  page?: number
  pageSize?: number
}

export const emailsApi = {
  search: (query: EmailQuery = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (query.search?.trim()) params.set('search', query.search.trim())
    if (query.status) params.set('status', query.status)
    if (query.category) params.set('category', query.category)
    if (query.relatedDocumentId !== undefined) params.set('relatedDocumentId', String(query.relatedDocumentId))
    if (query.dateFrom) params.set('dateFrom', query.dateFrom)
    if (query.dateTo) params.set('dateTo', query.dateTo)
    params.set('page', String(query.page ?? 1))
    params.set('pageSize', String(query.pageSize ?? 20))
    return request<PagedResult<EmailListDto>>(`${BASE}?${params.toString()}`, { signal })
  },

  /** One email with its HTML (the attachment is named, not sent). */
  get: (id: number, signal?: AbortSignal) => request<EmailDto>(`${BASE}/${id}`, { signal }),

  /** Back to Pending with its attempts reset. */
  retry: (id: number) => request<EmailDto>(`${BASE}/${id}/retry`, { method: 'POST' }),

  /** Queues a short test email to the signed-in user's own address (400 when the user has none). */
  queueTest: () => request<EmailDto>(`${BASE}/test`, { method: 'POST' }),
}
