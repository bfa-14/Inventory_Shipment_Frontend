import type { Ref } from 'react'
import type { AttachmentDocumentKind, DocumentFileDto, DocumentFilesApi } from '../../api/documentFiles'
import { AttachmentsPanel, type AttachmentsSource } from '../attachments/AttachmentsPanel'

interface DocumentAttachmentsCardProps {
  /** Null on a document that has never been saved: there is nothing to attach a file to yet. */
  documentId: number | null
  /** The document's type code (PO, PINV, PRET, SINV, INV_IN, RCPT, PAY...): only the attachment types used for it are offered. */
  documentKind: AttachmentDocumentKind
  /** The family's file endpoints (purchaseDocumentsApi.files, salesInvoicesApi.files, stockDocumentsApi.files...). */
  api: DocumentFilesApi
  /** Add, edit and "Choose a type": the family's create permission (and its status rule, e.g. not once Reversed). */
  canAdd: boolean
  canRemove: boolean
  /** Re-reads what the page shows about the files: the "Documents (n)" count and the audit trail. */
  onChanged: () => void
  /** The page's "Add document…": a counter it bumps to open the popup (AttachmentsPanel.openUpload). */
  openUpload?: number
  /** "Documents" unless the page numbers its cards ("4 · Documents" on a supplier payment). */
  title?: string
  /** The page's "Documents (n)" scrolls here. */
  ref?: Ref<HTMLDivElement>
}

/**
 * The paperwork behind a document - the proforma, the packing list, the delivery note, the cheque photo, the SWIFT
 * copy - as a "Documents" card on the page, like the containers' (prompt 40): the shared AttachmentsPanel with the
 * family's file endpoints.
 *
 * ON THE PAGE RATHER THAN IN A DRAWER, so the files are seen with the document they belong to, the same way on
 * every page. It sits below the lines (and the charges), above the audit trail.
 *
 * ALLOWED ON A POSTED DOCUMENT, unlike everything else about it. The evidence often arrives after the movement - the
 * scanned note comes back from the warehouse an hour later - and a system that refused it would be a system people
 * keep the evidence outside of. Which statuses still take a file is the family's rule, passed in canAdd / canRemove
 * (receipts and payments: not once Reversed); nothing ever requires a file to post.
 */
export function DocumentAttachmentsCard({
  documentId,
  documentKind,
  api,
  canAdd,
  canRemove,
  onChanged,
  openUpload,
  title = 'Documents',
  ref,
}: DocumentAttachmentsCardProps) {
  const source: AttachmentsSource<DocumentFileDto> | null =
    documentId === null
      ? null
      : {
          list: () => api.list(documentId),
          upload: (file, fields) => api.add(documentId, file, fields),
          update: (row, edit) => api.update(documentId, row.id, edit),
          download: (row) => api.download(documentId, row.id, row.fileName),
          remove: (row) => api.remove(documentId, row.id),
        }

  return (
    // The margin keeps the card's title clear of the app header and the sticky action bar when it is scrolled to.
    <div ref={ref} data-documents-card style={{ scrollMarginTop: 140 }}>
      <AttachmentsPanel
        title={title}
        documentKind={documentKind}
        source={source}
        reloadKey={`${documentKind}:${documentId ?? 'new'}`}
        canAdd={canAdd}
        canRemove={canRemove}
        onChanged={onChanged}
        openUpload={openUpload}
      />
    </div>
  )
}
