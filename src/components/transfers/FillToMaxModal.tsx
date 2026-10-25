import { Fragment, useEffect, useRef, useState } from 'react'
import { Alert, Box, Group, Loader, Paper, Stack, Table, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { ApiError } from '../../api/http'
import {
  transferLevelsApi,
  type TransferFillLineDto,
  type TransferFillResult,
  type TransferOrderDto,
} from '../../api/inventory/transfers'
import { unitLabel } from '../documents/documentKind'
import { formatNumber } from '../format'
import { FormModal } from '../ui/FormModal'
import { notify } from '../ui/notify'
import {
  countLabel,
  fillOutcomeText,
  isStaleOrderError,
  levelText,
  purchasesToComeText,
  STALE_ORDER,
} from './transferLevels'

interface FillToMaxModalProps {
  opened: boolean
  /** A SAVED draft, as the page holds it (the toolbar is disabled while the page has unsaved changes). */
  order: TransferOrderDto
  onClose(): void
  /** Applied: the server's answer, the order re-read in it. */
  onApplied(result: TransferFillResult): void
  /** Refused because the order changed meanwhile: the page reads it again. */
  onStale(): void
}

/**
 * (91) "Fill to Max - {No} ({From} → {To})" (3.6.5): the server's plan, shown before it is applied.
 *
 * A PREVIEW, THEN THE APPLY (rule L9). It opens on POST …/fill-to-max/preview, which writes nothing: per ITEM of the
 * order, the item's FIRST line set so that To reaches its Max (else its Min), counting what other released transfer
 * orders bring to it or take from it, rounded up to the line's unit and capped at what From has available; the item's
 * other lines count but never change. "Fill {n} lines" sends the ORDER's row version and the server works the plan out
 * again inside its transaction, so what is written is never a stale preview; the answer carries the order re-read.
 *
 * Every figure, outcome and sentence is the server's ("If you apply it: Fill to Max: 4 lines filled (…)."); this dialog
 * only lays them out. xl, full screen below 48em, one card per line there.
 */
export function FillToMaxModal({ opened, order, onClose, onApplied, onStale }: FillToMaxModalProps) {
  const phone = useMediaQuery('(max-width: 48em)')
  const from = order.from.code
  const to = order.to.code
  const number = order.documentNumber ?? `draft #${order.id}`

  /* THE PREVIEW, read again whenever the order the page holds changes (a reload after someone else's change): the
     answer remembers which order it is for, so a newer order shows the loader until its own preview arrives. */
  const forOrder = `${order.id}|${order.rowVersion}`
  const [answer, setAnswer] = useState<{ key: string; preview: TransferFillResult | null; error: string | null } | null>(
    null,
  )
  const [applyError, setApplyError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    transferLevelsApi
      .fillToMaxPreview(order.id)
      .then((result) => {
        if (!cancelled) setAnswer({ key: forOrder, preview: result, error: null })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof ApiError ? err.message : 'The Fill to Max preview could not be worked out.'
        setAnswer({ key: forOrder, preview: null, error: message })
      })
    return () => {
      cancelled = true
    }
  }, [order.id, forOrder])

  const loading = answer?.key !== forOrder
  const preview = loading ? null : (answer?.preview ?? null)
  const error = applyError ?? (loading ? null : (answer?.error ?? null))

  const changed = preview?.counts.changed ?? 0

  /* THE CURSOR ON "Fill {n} lines" once there is something to fill: nothing is typed here, so Enter applies (as a
     confirmation's does). The button is the dialog's own submit, in the footer. */
  useEffect(() => {
    if (loading || changed === 0) return
    const timer = window.setTimeout(() => {
      bodyRef.current
        ?.closest('form')
        ?.querySelector<HTMLButtonElement>('button[type="submit"]:not([disabled]):not([data-disabled])')
        ?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loading, changed])

  async function apply() {
    if (!preview || changed === 0 || busy) return
    setBusy(true)
    setApplyError(null)
    try {
      onApplied(await transferLevelsApi.fillToMax(order.id, order.rowVersion))
    } catch (err) {
      if (isStaleOrderError(err)) {
        // The plan shown was worked out on an order that is no longer the one stored: read it again, then decide.
        notify.error(STALE_ORDER)
        onStale()
        onClose()
        return
      }
      setApplyError(err instanceof ApiError ? err.message : 'Fill to Max could not be applied.')
      // Released or deleted meanwhile (62005, 62006…): the page shows the order as it now is.
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) onStale()
    } finally {
      setBusy(false)
    }
  }

  const blockedBy = loading || !preview ? null : changed === 0 ? 'Every quantity is already at its fill.' : null

  /* ── the cells ── */

  function fillTo(line: TransferFillLineDto) {
    if (line.outcome !== 'Filled' || line.newQuantity === null)
      return (
        <Text fz="sm" c="dimmed" ta={phone ? undefined : 'right'}>
          —
        </Text>
      )
    return (
      <Text
        fz="sm"
        fw={line.isChanged ? 700 : 400}
        ta={phone ? undefined : 'right'}
        data-fill-changed={line.isChanged || undefined}
      >
        {formatNumber(line.newQuantity)}
      </Text>
    )
  }

  function projected(line: TransferFillLineDto) {
    return `${formatNumber(line.toProjectedBeforeBase)} → ${formatNumber(line.toProjectedAfterBase)}`
  }

  function level(value: number | null) {
    return value === null ? '—' : formatNumber(value)
  }

  /** Available at From, and what is left of it for this line when the item's other lines take some. */
  function available(line: TransferFillLineDto) {
    return (
      <>
        <Text fz="sm" ta={phone ? undefined : 'right'}>
          {formatNumber(line.availableFromBase)}
        </Text>
        {line.availableForLineBase !== line.availableFromBase ? (
          <Text fz="xs" c="dimmed" ta={phone ? undefined : 'right'}>
            {formatNumber(line.availableForLineBase)} for this line
          </Text>
        ) : null}
      </>
    )
  }

  function result(line: TransferFillLineDto) {
    if (line.outcome !== 'Filled')
      return (
        <Text fz="sm" c="dimmed" data-fill-outcome={line.outcome}>
          {fillOutcomeText(line.outcome, from, to)}
        </Text>
      )
    return (
      <Box data-fill-outcome="Filled">
        {line.isChanged ? (
          <Text fz="sm" c="green.7" fw={600}>
            Filled
          </Text>
        ) : (
          <Text fz="sm" c="dimmed">
            No change
          </Text>
        )}
        {line.isCapped ? (
          <Text fz="xs" c="orange.7">
            capped: {from} has {formatNumber(line.availableForLineBase)} pcs available
          </Text>
        ) : null}
      </Box>
    )
  }

  function purchases(line: TransferFillLineDto) {
    if (!line.purchasesToComeBase || line.purchasesToComeBase <= 0) return null
    return (
      <Text fz="xs" c="dimmed">
        {purchasesToComeText(line.purchasesToComeBase, to)}
      </Text>
    )
  }

  /** "TEST91-A · PC · 5 → 42 · Projected at LUB-01 18 → 60 (Min 20 / Max 60) · Filled": a line on a phone. */
  function phoneLine(line: TransferFillLineDto) {
    const quantity =
      line.outcome === 'Filled' && line.newQuantity !== null && line.newQuantity !== line.currentQuantity
        ? `${formatNumber(line.currentQuantity)} → ${formatNumber(line.newQuantity)}`
        : formatNumber(line.currentQuantity)
    const outcome =
      line.outcome === 'Filled' ? (line.isChanged ? 'Filled' : 'No change') : fillOutcomeText(line.outcome, from, to)
    return [
      line.itemCode,
      unitLabel(line.unitName, line.packingFormula),
      quantity,
      `Projected at ${to} ${projected(line)} (${levelText(line.toMinBase, line.toMaxBase, to)})`,
      outcome,
    ].join(' · ')
  }

  const lines = preview?.lines ?? []

  return (
    <FormModal
      opened={opened}
      title={`Fill to Max - ${number} (${from} → ${to})`}
      onSubmit={() => void apply()}
      onClose={onClose}
      saving={busy}
      saveLabel={countLabel('Fill', changed, 'line')}
      size="xl"
      fullScreen={phone}
      saveDisabled={loading || !preview || changed === 0}
      saveDisabledReason={blockedBy ?? undefined}
    >
      <div ref={bodyRef} data-fill-to-max-dialog>
        <Stack gap="md">
          <Text size="sm">
            Each line&apos;s Ordered is set so that {to} reaches its Max (its Min when it has no Max), counting what other
            released transfer orders bring to it or take from it, and capped at what {from} has available. Lines of items
            at or above their Min are left as they are.
          </Text>

          {loading ? (
            <Group justify="center" py="lg">
              <Loader size="sm" />
            </Group>
          ) : null}

          {!loading && preview && phone ? (
            <Stack gap="sm">
              {lines.map((line) => (
                <Paper
                  key={`${line.itemId}-${line.lineId ?? line.lineNumber}`}
                  withBorder
                  radius="md"
                  p="sm"
                  data-fill-line={line.lineNumber ?? undefined}
                >
                  <Text fz="xs" c="dimmed">
                    Line {formatNumber(line.lineNumber)} · {line.itemName}
                  </Text>
                  <Text fz="sm" fw={line.isChanged ? 600 : 500} style={{ overflowWrap: 'anywhere' }}>
                    {phoneLine(line)}
                  </Text>
                  {line.isCapped ? (
                    <Text fz="xs" c="orange.7">
                      capped: {from} has {formatNumber(line.availableForLineBase)} pcs available
                    </Text>
                  ) : null}
                  <Text fz="xs" c="dimmed">
                    Available at {from}: {formatNumber(line.availableFromBase)}
                    {line.availableForLineBase !== line.availableFromBase
                      ? ` (${formatNumber(line.availableForLineBase)} for this line)`
                      : ''}
                  </Text>
                  {purchases(line)}
                </Paper>
              ))}
            </Stack>
          ) : null}

          {!loading && preview && !phone ? (
            /* 720: inside the xl dialog's 748 px body at 1440, so no row scrolls sideways (as Dispatch…). */
            <Table.ScrollContainer minWidth={720}>
              <Table verticalSpacing="xs" horizontalSpacing="xs" striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={36}>#</Table.Th>
                    <Table.Th>Item</Table.Th>
                    <Table.Th w={64}>Unit</Table.Th>
                    <Table.Th w={52} ta="right">
                      Now
                    </Table.Th>
                    <Table.Th w={58} ta="right">
                      Fill to
                    </Table.Th>
                    <Table.Th w={92} ta="right">
                      Projected at {to}
                    </Table.Th>
                    <Table.Th w={48} ta="right">
                      Min
                    </Table.Th>
                    <Table.Th w={48} ta="right">
                      Max
                    </Table.Th>
                    <Table.Th w={84} ta="right">
                      Available at {from}
                    </Table.Th>
                    <Table.Th w={150}>Result</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {lines.map((line) => {
                    const extra = purchases(line)
                    return (
                      <Fragment key={`${line.itemId}-${line.lineId ?? line.lineNumber}`}>
                        <Table.Tr data-fill-line={line.lineNumber ?? undefined}>
                          <Table.Td>{formatNumber(line.lineNumber)}</Table.Td>
                          <Table.Td>
                            <Text fz="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>
                              {line.itemCode}
                            </Text>
                            <Text fz="xs" c="dimmed" lineClamp={1}>
                              {line.itemName}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text fz="sm">{unitLabel(line.unitName, line.packingFormula)}</Text>
                          </Table.Td>
                          <Table.Td ta="right">{formatNumber(line.currentQuantity)}</Table.Td>
                          <Table.Td ta="right">{fillTo(line)}</Table.Td>
                          <Table.Td ta="right">
                            <Text fz="sm" style={{ whiteSpace: 'nowrap' }}>
                              {projected(line)}
                            </Text>
                          </Table.Td>
                          <Table.Td ta="right">{level(line.toMinBase)}</Table.Td>
                          <Table.Td ta="right">{level(line.toMaxBase)}</Table.Td>
                          <Table.Td ta="right">{available(line)}</Table.Td>
                          <Table.Td>{result(line)}</Table.Td>
                        </Table.Tr>
                        {extra ? (
                          <Table.Tr>
                            <Table.Td />
                            <Table.Td colSpan={9} pt={0}>
                              {extra}
                            </Table.Td>
                          </Table.Tr>
                        ) : null}
                      </Fragment>
                    )
                  })}
                  {lines.length === 0 ? (
                    <Table.Tr>
                      <Table.Td colSpan={10}>
                        <Text ta="center" c="dimmed" py="md" fz="sm">
                          No lines.
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ) : null}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          ) : null}

          {!loading && preview ? (
            <Text size="sm" fw={500} data-fill-message>
              If you apply it: {preview.message}
            </Text>
          ) : null}

          {!loading && preview && preview.warnings.length > 0 ? (
            <Alert color="orange" data-fill-warnings>
              <Stack gap={4}>
                {preview.warnings.map((warning) => (
                  <Text key={warning} size="sm">
                    {warning}
                  </Text>
                ))}
              </Stack>
            </Alert>
          ) : null}

          {error ? <Alert color="red">{error}</Alert> : null}
        </Stack>
      </div>
    </FormModal>
  )
}
