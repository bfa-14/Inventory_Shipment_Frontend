import { useEffect, useMemo, useState } from 'react'
import { Alert, List, Loader, Stack, Text } from '@mantine/core'
import type { MovementDto } from '../../api/logistics/movements'
import { goodsReceiptsApi } from '../../api/purchase/goodsReceipts'
import { dateLabel, isoDate } from '../documents/documentKind'
import {
  containerReceiptOf,
  DELIVERY_COMPLETE_TEXT,
  deliveryPreviewLine,
  editedDraftText,
  type DraftToDelete,
} from './containerReceipt'

/**
 * What completing a Delivery-stage movement will do (rule 5), in its Complete dialog: one line per container, from what
 * the movement says about each one now - "KTG-2026-0031 → draft goods receipt into LUB-WH", "KTG-2026-0032 → draft,
 * warehouse to choose", "KTG-2026-0033 → no receipt: it already has GRN-BR-002-000004". The server decides when it
 * completes; the notification afterwards says what it did.
 */
export function DeliveryCompletePreview({ movement }: { movement: MovementDto }) {
  const lines = movement.containers.map((c) =>
    deliveryPreviewLine({
      containerRef: c.containerRef,
      status: c.containerStatus,
      receipt: containerReceiptOf(c),
      warehouseCode: c.warehouseCode,
      warehouseInBranch: c.warehouseInBranch,
      warehouseNote: c.warehouseNote,
    }),
  )
  return (
    <Stack gap={6} data-delivery-preview>
      <Text fz="sm">{DELIVERY_COMPLETE_TEXT}</Text>
      <List size="sm" spacing={2}>
        {lines.map((line) => (
          <List.Item key={line.text}>
            <Text fz="sm" c={line.created ? undefined : 'dimmed'}>
              {line.text}
            </Text>
          </List.Item>
        ))}
      </List>
    </Stack>
  )
}

/** "10/10/2026": the day of a UTC moment, in the reader's time zone. */
function dayOf(utc: string | null): string {
  if (!utc) return '—'
  const moment = new Date(utc)
  return Number.isNaN(moment.getTime()) ? '—' : dateLabel(isoDate(moment))
}

/** A draft was typed in after it was created (more than a minute later: the creation stamps it too). */
function editedAfterCreation(createdAtUtc: string | null | undefined, updatedAtUtc: string | null | undefined): boolean {
  if (!updatedAtUtc) return false
  if (!createdAtUtc) return true
  return new Date(updatedAtUtc).getTime() - new Date(createdAtUtc).getTime() > 60_000
}

/**
 * The cancel dialog of a COMPLETED Delivery-stage movement (rule 22): the automatic draft goods receipts it created are
 * deleted with it, and the ones edited since are named, because what was typed there is lost. A draft made by hand is
 * kept.
 *
 * WHICH DRAFTS: the movement says, per container, whether its open receipt is an automatic draft of this movement
 * (`autoDraftOfThisMovement`) and when it was last edited. When it does not say, the drafts are read one by one (the
 * reader's goods receipts view permission); without that, the general sentence stands alone.
 */
export function DeliveryCancelDrafts({ movement, canViewReceipts }: { movement: MovementDto; canViewReceipts: boolean }) {
  /* What the movement says itself, and the drafts it says nothing about (read one by one). */
  const { known, toRead } = useMemo(() => {
    const knownDrafts: DraftToDelete[] = []
    const unknown: { containerRef: string; receiptId: number }[] = []
    for (const c of movement.containers) {
      const receipt = containerReceiptOf(c)
      if (receipt?.status !== 1) continue
      if (c.autoDraftOfThisMovement === undefined) {
        unknown.push({ containerRef: c.containerRef, receiptId: receipt.id })
        continue
      }
      if (!c.autoDraftOfThisMovement) continue
      // The movement says when the draft was last edited: null when nobody touched it since it was created.
      knownDrafts.push({
        containerRef: c.containerRef,
        receiptId: receipt.id,
        editedBy: c.goodsReceiptUpdatedAtUtc ? (c.goodsReceiptUpdatedByName ?? null) : null,
        editedAtUtc: c.goodsReceiptUpdatedAtUtc ?? null,
      })
    }
    return { known: knownDrafts, toRead: canViewReceipts ? unknown : [] }
  }, [movement, canViewReceipts])

  const readKey = toRead.map((d) => d.receiptId).join(',')
  const [read, setRead] = useState<{ key: string; drafts: DraftToDelete[] } | null>(null)

  useEffect(() => {
    if (toRead.length === 0) return
    const controller = new AbortController()
    Promise.all(
      toRead.map((d) =>
        goodsReceiptsApi
          .get(d.receiptId, controller.signal)
          .then((doc): DraftToDelete | null => {
            if (!doc.isAuto || doc.movementId !== movement.id) return null
            const edited = editedAfterCreation(doc.createdAtUtc, doc.updatedAtUtc)
            return {
              containerRef: d.containerRef,
              receiptId: d.receiptId,
              editedBy: edited ? doc.updatedByName : null,
              editedAtUtc: edited ? doc.updatedAtUtc : null,
            }
          })
          .catch(() => null),
      ),
    ).then((rows) => {
      if (!controller.signal.aborted) setRead({ key: readKey, drafts: rows.filter((d): d is DraftToDelete => d !== null) })
    })
    return () => controller.abort()
    // readKey names the receipts to read; toRead follows it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readKey, movement.id])

  const reading = toRead.length > 0 && read?.key !== readKey
  const drafts = reading ? null : [...known, ...(toRead.length > 0 ? (read?.drafts ?? []) : [])]

  const edited = (drafts ?? []).filter((d) => d.editedAtUtc)
  return (
    <Stack gap={6} data-delivery-cancel>
      <Text fz="sm">
        The draft goods receipts this movement created when it was completed are deleted with it; a draft made by hand is
        kept.
      </Text>
      {drafts === null ? (
        <Loader size="xs" />
      ) : drafts.length > 0 ? (
        <List size="sm" spacing={2}>
          {drafts.map((d) => (
            <List.Item key={d.receiptId}>
              <Text fz="sm">GRN draft of {d.containerRef}</Text>
            </List.Item>
          ))}
        </List>
      ) : null}
      {edited.length > 0 ? (
        <Alert color="orange" p="xs">
          <Stack gap={4}>
            {edited.map((d) => (
              <Text key={d.receiptId} fz="sm">
                {editedDraftText(d, dayOf(d.editedAtUtc))}
              </Text>
            ))}
          </Stack>
        </Alert>
      ) : null}
    </Stack>
  )
}
