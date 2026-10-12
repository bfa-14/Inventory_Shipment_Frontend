import { useMemo } from 'react'
import { Badge } from '@mantine/core'
import { containersApi, type ContainerAttachmentDto, type ContainerDto } from '../../api/logistics/containers'
import { movementsApi } from '../../api/logistics/movements'
import { AttachmentsPanel, type AttachmentGroup, type AttachmentsSource } from '../attachments/AttachmentsPanel'
import type { AttachmentOption, ContainerFiling } from '../attachments/AttachmentUploadDialog'
import { chooseRemoval } from '../attachments/chooseRemoval'
import { formatNumber } from '../format'
import { confirm } from '../ui/confirm'

interface ContainerDocumentsCardProps {
  container: ContainerDto
  canManage: boolean
  /** Re-reads the container so the counts and the route catch up. */
  onChanged: () => void
}

/** What a file looks like on the list: an upload, an edit (name, type, date, note, new file, movement) or a delete changes it. */
function attachmentKey(a: ContainerAttachmentDto): string {
  return [
    a.id,
    a.fileId,
    a.attachmentTypeId ?? 0,
    a.movementId ?? 0,
    a.chargeId ?? 0,
    a.documentDate ?? '',
    a.sizeBytes,
    a.sharedWith,
    a.fileName,
    a.note ?? '',
  ].join('.')
}

/**
 * The container's paperwork, filed where it belongs: general papers, the documents of each leg of the
 * route, the invoices behind each charge - the shared attachments list, grouped. A file uploaded once for
 * several containers is ONE file; the badge says so, and editing or deleting it asks whether that is for this
 * container or for all of them. The edit can also file it under another movement of the route, or back under
 * General (script 67); the server refuses a movement that one of the file's containers is not on.
 */
export function ContainerDocumentsCard({ container, canManage, onChanged }: ContainerDocumentsCardProps) {
  const routeOrder = useMemo(
    () => new Map(container.movements.map((m, index) => [m.movementId, index])),
    [container.movements],
  )

  /** General first, then the movements in route order, then the charges. */
  const groupOf = (row: ContainerAttachmentDto): AttachmentGroup => {
    if (row.chargeId) return { key: `c${row.chargeId}`, title: `Charge #${row.chargeId}`, order: 10000 + row.chargeId }
    if (row.movementId)
      return {
        key: `m${row.movementId}`,
        title: row.movementNo ?? `Movement #${row.movementId}`,
        order: 1 + (routeOrder.get(row.movementId) ?? 0),
      }
    return { key: 'general', title: 'General', order: 0 }
  }

  /** The container's movements, in route order: what a file can be filed under (upload and edit alike). */
  const movementOptions: AttachmentOption[] = useMemo(
    () => container.movements.map((m) => ({ value: String(m.movementId), label: `${m.movementNo} - ${m.typeName}` })),
    [container.movements],
  )

  /** The boxes that travel with this one: every other container on any of its movements. */
  async function filing(): Promise<ContainerFiling> {
    const movements = await Promise.all(
      container.movements.map((m) => movementsApi.get(m.movementId).catch(() => null)),
    )
    const others = new Map<string, string>()
    for (const movement of movements) {
      for (const c of movement?.containers ?? []) {
        if (c.containerId === container.id) continue
        others.set(String(c.containerId), c.containerNo ? `${c.containerRef} - ${c.containerNo}` : c.containerRef)
      }
    }
    return {
      containerIds: [container.id],
      otherContainers: [...others]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      movementOptions,
    }
  }

  const source: AttachmentsSource<ContainerAttachmentDto> = {
    list: () => containersApi.listAttachments({ containerId: container.id }),
    upload: (file, fields, filed) =>
      containersApi.addAttachment({ file, containerIds: filed.containerIds, movementId: filed.movementId, ...fields }),
    update: (row, edit, allShared) => containersApi.updateAttachment(row.id, allShared, edit),
    download: (row) => containersApi.downloadAttachment(row.id, row.fileName),
    asksBeforeRemove: true,
    remove: async (row) => {
      // A file only this container holds needs a plain yes; a shared one needs to know how far to go.
      if (row.sharedWith > 0) {
        const pick = await chooseRemoval({
          title: `Delete ${row.fileName}`,
          message: `${row.fileName} is also on ${formatNumber(row.sharedWith)} other ${row.sharedWith === 1 ? 'container' : 'containers'}. Delete it from ${container.containerRef} only, or from every container holding it?`,
          onlyLabel: 'Only this container',
          allLabel: 'All containers',
        })
        if (pick === null) return false
        await containersApi.removeAttachment(row.id, pick === 'all')
        return true
      }
      const go = await confirm({
        title: 'Delete document',
        message: `Delete ${row.fileName}?`,
        confirmLabel: 'Delete',
        danger: true,
      })
      if (!go) return false
      await containersApi.removeAttachment(row.id, false)
      return true
    },
  }

  return (
    <AttachmentsPanel
      title="Documents"
      documentKind="CONTAINER"
      source={source}
      // The charges' and the movements' uploads and edits change the list too; the page's fresh read says so. Every
      // field an edit can change is in the key, so a file renamed, redated, renoted or replaced in a charge's drawer
      // is read again here.
      reloadKey={`${container.id}:${container.attachments.map(attachmentKey).join(',')}`}
      canAdd={canManage}
      canRemove={canManage}
      filing={filing}
      groupOf={groupOf}
      sharedCount={(row) => row.sharedWith + 1}
      // A file can move to another movement, or back to General; a charge's file stays with its charge.
      movementOptions={(row) => (row.chargeId ? null : movementOptions)}
      fileExtra={(row) =>
        row.sharedWith > 0 ? (
          <Badge size="xs" variant="light" color="grape" style={{ flexShrink: 0 }}>
            shared with {formatNumber(row.sharedWith)} {row.sharedWith === 1 ? 'container' : 'containers'}
          </Badge>
        ) : null
      }
      onChanged={onChanged}
    />
  )
}
