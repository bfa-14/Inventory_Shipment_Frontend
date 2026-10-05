import { Drawer } from '@mantine/core'
import type { AttachmentDocumentKind, DocumentFileDto, DocumentFilesApi } from '../../api/documentFiles'
import { AttachmentsPanel, type AttachmentsSource } from '../attachments/AttachmentsPanel'

interface AttachmentsDrawerProps {
  opened: boolean
  onClose: () => void
  /** Null on a document that has never been saved: there is nothing to attach a file to yet. */
  documentId: number | null
  /** The document's type code (PO, PINV, PRET, SINV, INV_IN...): only the attachment types used for it are offered. */
  documentKind: AttachmentDocumentKind
  /** The family's file endpoints (purchaseDocumentsApi.files, salesInvoicesApi.files, stockDocumentsApi.files). */
  api: DocumentFilesApi
  /** Re-reads the document so its attachment count and the audit trail both catch up. */
  onChanged: () => void
  canEdit: boolean
}

/**
 * The paperwork behind the document: the proforma, the packing list, the delivery note.
 *
 * A DRAWER RATHER THAN A TAB, because attachments are a side errand. Somebody entering a document
 * looks at them once and goes back to the lines; a tab would make the lines disappear to do it.
 *
 * ALLOWED ON A POSTED DOCUMENT, unlike everything else about it. The evidence for a movement often
 * arrives after the movement - the scanned note comes back from the warehouse an hour later - and a
 * system that refused it would be a system people keep the evidence outside of.
 *
 * The list itself is the shared AttachmentsPanel, the same as on the receipts and the containers.
 */
export function AttachmentsDrawer({
  opened,
  onClose,
  documentId,
  documentKind,
  api,
  onChanged,
  canEdit,
}: AttachmentsDrawerProps) {
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
    <Drawer opened={opened} onClose={onClose} position="right" size={1000} title="Attachments">
      {opened ? (
        <AttachmentsPanel
          card={false}
          documentKind={documentKind}
          source={source}
          reloadKey={`${documentKind}:${documentId ?? 'new'}`}
          canAdd={canEdit}
          canRemove={canEdit}
          onChanged={onChanged}
        />
      ) : null}
    </Drawer>
  )
}
