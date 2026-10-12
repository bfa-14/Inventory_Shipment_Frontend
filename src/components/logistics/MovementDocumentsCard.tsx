import { useMemo } from 'react'
import { Link } from 'react-router'
import { Anchor, Group, Text } from '@mantine/core'
import { containersApi, type ContainerAttachmentDto } from '../../api/logistics/containers'
import type { MovementDto } from '../../api/logistics/movements'
import { AttachmentsPanel, type AttachmentsSource } from '../attachments/AttachmentsPanel'
import type { ContainerFiling } from '../attachments/AttachmentUploadDialog'
import { chooseRemoval } from '../attachments/chooseRemoval'
import { formatNumber } from '../format'
import { confirm } from '../ui/confirm'

interface MovementDocumentsCardProps {
  movement: MovementDto
  canManage: boolean
  /** Re-reads the movement so the list and the counts catch up. */
  onChanged: () => void
}

/** One stored file: its first record (what the list shows and the edit reaches) and every record of this movement. */
interface MovementFileRow extends ContainerAttachmentDto {
  records: ContainerAttachmentDto[]
}

/**
 * The paperwork of one leg - the bill of lading, the T1, the delivery note - on the shared AttachmentsPanel, the same
 * list, "Add document" popup and edit popup as a container's Documents card. The API answers one record per container;
 * a file uploaded for the whole movement is shown ONCE with the containers it is on (links under its name), and its
 * name, type, date and note are changed on all of them together. A new file is filed under this movement and goes to
 * every container of it unless the reader unticks some under "Also attach to".
 */
export function MovementDocumentsCard({ movement, canManage, onChanged }: MovementDocumentsCardProps) {
  const containerOptions = useMemo(
    () =>
      movement.containers.map((c) => ({
        value: String(c.containerId),
        label: c.containerNo ? `${c.containerRef} - ${c.containerNo}` : c.containerRef,
      })),
    [movement.containers],
  )

  const filing: ContainerFiling = {
    containerIds: [],
    otherContainers: containerOptions,
    defaultAlsoAttach: containerOptions.map((o) => o.value),
    movementOptions: [{ value: String(movement.id), label: `${movement.movementNo} - ${movement.typeName}` }],
    defaultMovementId: String(movement.id),
  }

  const source: AttachmentsSource<MovementFileRow> = {
    list: async () => {
      const records = await containersApi.listAttachments({ movementId: movement.id })
      const files = new Map<number, MovementFileRow>()
      for (const record of records) {
        const file = files.get(record.fileId) ?? { ...record, records: [] }
        file.records.push(record)
        files.set(record.fileId, file)
      }
      return [...files.values()]
    },
    upload: (file, fields, filed) =>
      containersApi.addAttachment({ file, containerIds: filed.containerIds, movementId: filed.movementId, ...fields }),
    // One upload, one edit: the first record with allShared reaches every container holding the file - the containers
    // of this movement it was uploaded for.
    update: (row, edit) => containersApi.updateAttachment(row.id, true, edit),
    download: (row) => containersApi.downloadAttachment(row.id, row.fileName),
    asksBeforeRemove: true,
    remove: async (row) => {
      let all = false
      if (row.records.length > 1) {
        const pick = await chooseRemoval({
          title: `Delete ${row.fileName}`,
          message: `${row.fileName} is on ${formatNumber(row.records.length)} containers of ${movement.movementNo}. Delete it from this movement's containers only, or from every container holding it?`,
          onlyLabel: "This movement's containers",
          allLabel: 'All containers',
        })
        if (pick === null) return false
        all = pick === 'all'
      } else {
        const go = await confirm({
          title: 'Delete document',
          message: `Delete ${row.fileName} from ${row.containerRef ?? 'its container'}?`,
          confirmLabel: 'Delete',
          danger: true,
        })
        if (!go) return false
      }
      // A failure part-way leaves some records gone; the panel reloads and shows what is left.
      if (all) await containersApi.removeAttachment(row.id, true)
      else for (const record of row.records) await containersApi.removeAttachment(record.id, false)
      return true
    },
  }

  const hasContainers = movement.containers.length > 0

  return (
    <AttachmentsPanel
      card={false}
      documentKind="CONTAINER"
      source={source}
      // The containers' own pages and the charges upload too; the movement's reload says so.
      reloadKey={`${movement.id}:${movement.attachments.map((a) => `${a.id}.${a.attachmentTypeId ?? 0}`).join(',')}`}
      // A file is filed on containers: with none on the movement there is nowhere to put it.
      canAdd={canManage && hasContainers}
      canRemove={canManage}
      filing={filing}
      fileExtra={(row) => (
        <Group gap={6} wrap="wrap">
          <Text span fz="xs" c="dimmed">
            On
          </Text>
          {row.records.map((record) => (
            <Anchor
              key={record.id}
              component={Link}
              to={`/logistics/containers/${record.containerId}`}
              fz="xs"
              style={{ whiteSpace: 'nowrap' }}
            >
              {record.containerRef}
            </Anchor>
          ))}
        </Group>
      )}
      emptyText={hasContainers ? 'No document yet.' : 'Add containers to the movement to file its documents.'}
      onChanged={onChanged}
    />
  )
}
