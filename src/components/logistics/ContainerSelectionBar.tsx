import { useState } from 'react'
import { Button, Group, Paper, Text, Tooltip } from '@mantine/core'
import { IconCheck, IconHash, IconReceipt2, IconShip, IconTrash, IconX } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { containersApi } from '../../api/logistics/containers'
import { useAuth } from '../../auth/useAuth'
import { PERMISSIONS } from '../../navigation'
import { formatNumber } from '../format'
import { confirm } from '../ui/confirm'
import { notify } from '../ui/notify'
import { ContainerNumbersModal } from './ContainerNumbersModal'
import { NewChargeModal } from './NewChargeModal'
import { StartShipmentModal } from './StartShipmentModal'
import { DRAFT, isNotShipped, type SelectableContainer } from './containerSelection'

interface ContainerSelectionBarProps<T extends SelectableContainer> {
  /** The containers on screen: what the quick selectors pick from. */
  rows: T[]
  selected: T[]
  onSelectedChange(next: T[]): void
  /** After an action: the host reloads its rows. */
  onChanged(): void
}

/**
 * The strip above a container grid: "Select not shipped" / "Select drafts", and once rows are
 * ticked, "N selected" with what can be done to all of them at once.
 *
 * EACH ACTION IS SHOWN ONLY WITH ITS PERMISSION, and Delete is live only when every ticked
 * container is still a draft — the server deletes all or nothing, so a mixed selection could only
 * fail. A dead button stays hoverable (data-disabled, not disabled) so its tooltip can say why.
 * The server's refusals are shown as they come: they name the container.
 */
export function ContainerSelectionBar<T extends SelectableContainer>({
  rows,
  selected,
  onSelectedChange,
  onChanged,
}: ContainerSelectionBarProps<T>) {
  const { hasPermission } = useAuth()
  const canConfirm = hasPermission(PERMISSIONS.containersConfirm)
  const canNumbers = hasPermission(PERMISSIONS.containersCreate)
  const canDelete = hasPermission(PERMISSIONS.containersDelete)
  const canShip = hasPermission(PERMISSIONS.movementsManage)
  const canCharge = hasPermission(PERMISSIONS.containerChargesCreate)

  const [busy, setBusy] = useState<'confirm' | 'delete' | null>(null)
  const [numbersFor, setNumbersFor] = useState<T[] | null>(null)
  const [shipFor, setShipFor] = useState<T[] | null>(null)
  const [chargeFor, setChargeFor] = useState<number[] | null>(null)

  const notShipped = rows.filter(isNotShipped)
  const drafts = rows.filter((row) => row.status === DRAFT)
  const count = selected.length
  const draftsSelected = selected.filter((row) => row.status === DRAFT).length
  const allDrafts = count > 0 && draftsSelected === count

  async function confirmSelected() {
    const go = await confirm({
      title: 'Confirm containers',
      message:
        draftsSelected === count
          ? `Confirm ${formatNumber(count)} draft container${count === 1 ? '' : 's'}?`
          : `Confirm the ${formatNumber(draftsSelected)} draft${draftsSelected === 1 ? '' : 's'} among the ${formatNumber(count)} selected containers? The others are already confirmed and stay as they are.`,
      confirmLabel: 'Confirm',
    })
    if (!go) return
    setBusy('confirm')
    try {
      const result = await containersApi.confirmMany(selected.map((row) => row.id))
      const done = result.filter((row) => row.confirmedNow).length
      if (done === 0) notify.info('Nothing to confirm: the selected containers were already confirmed.')
      else notify.success(`${formatNumber(done)} container${done === 1 ? '' : 's'} confirmed`)
      onChanged()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The containers could not be confirmed.')
    } finally {
      setBusy(null)
    }
  }

  async function deleteSelected() {
    const go = await confirm({
      title: 'Delete containers',
      message: `Delete ${formatNumber(count)} draft container${count === 1 ? '' : 's'}? Their order lines become free to load again.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!go) return
    setBusy('delete')
    try {
      const { deleted } = await containersApi.deleteMany(selected.map((row) => row.id))
      notify.success(`${formatNumber(deleted)} container${deleted === 1 ? '' : 's'} deleted`)
      onSelectedChange([])
      onChanged()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The containers could not be deleted.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Group gap="xs" mb="xs" wrap="wrap" className="no-print" data-selection-quick>
        <Button size="compact-xs" variant="subtle" disabled={notShipped.length === 0} onClick={() => onSelectedChange(notShipped)}>
          Select not shipped ({formatNumber(notShipped.length)})
        </Button>
        <Button size="compact-xs" variant="subtle" disabled={drafts.length === 0} onClick={() => onSelectedChange(drafts)}>
          Select drafts ({formatNumber(drafts.length)})
        </Button>
      </Group>

      {count > 0 ? (
        <Paper radius="lg" p="xs" withBorder mb="xs" bg="var(--mantine-color-blue-0)" className="no-print" data-selection-bar>
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Text fz="sm" fw={600} px="xs">
              {formatNumber(count)} selected
            </Text>
            <Group gap="xs" wrap="wrap">
              {canConfirm && (
                <Tooltip label="Every selected container is already confirmed" disabled={draftsSelected > 0} withArrow>
                  <Button
                    size="xs"
                    leftSection={<IconCheck size={14} />}
                    loading={busy === 'confirm'}
                    disabled={busy !== null}
                    data-disabled={draftsSelected === 0 || undefined}
                    onClick={() => {
                      if (draftsSelected > 0) void confirmSelected()
                    }}
                  >
                    Confirm
                  </Button>
                </Tooltip>
              )}
              {canNumbers && (
                <Button size="xs" variant="light" leftSection={<IconHash size={14} />} disabled={busy !== null} onClick={() => setNumbersFor(selected)}>
                  Container numbers…
                </Button>
              )}
              {canShip && (
                <Button size="xs" variant="light" leftSection={<IconShip size={14} />} disabled={busy !== null} onClick={() => setShipFor(selected)}>
                  Start shipment…
                </Button>
              )}
              {canCharge && (
                <Button size="xs" variant="light" leftSection={<IconReceipt2 size={14} />} disabled={busy !== null} onClick={() => setChargeFor(selected.map((row) => row.id))}>
                  Add charge…
                </Button>
              )}
              {canDelete && (
                <Tooltip label="Only drafts can be deleted - cancel the others" disabled={allDrafts} withArrow>
                  <Button
                    size="xs"
                    color="red"
                    variant="light"
                    leftSection={<IconTrash size={14} />}
                    loading={busy === 'delete'}
                    disabled={busy !== null}
                    data-disabled={!allDrafts || undefined}
                    onClick={() => {
                      if (allDrafts) void deleteSelected()
                    }}
                  >
                    Delete
                  </Button>
                </Tooltip>
              )}
              <Button size="xs" variant="subtle" leftSection={<IconX size={14} />} disabled={busy !== null} onClick={() => onSelectedChange([])}>
                Clear
              </Button>
            </Group>
          </Group>
        </Paper>
      ) : null}

      {shipFor ? (
        <StartShipmentModal
          containers={shipFor}
          onClose={() => setShipFor(null)}
          onShipped={() => {
            setShipFor(null)
            onSelectedChange([])
            onChanged()
          }}
        />
      ) : null}

      {/* The "New charge" dialog with the ticked containers, one amount on each by default. */}
      <NewChargeModal
        opened={chargeFor !== null}
        onClose={() => setChargeFor(null)}
        presetContainerIds={chargeFor ?? []}
        presetSplitRule="Same"
        onCreated={() => {
          setChargeFor(null)
          onChanged()
        }}
      />

      {numbersFor ? (
        <ContainerNumbersModal
          containers={numbersFor}
          onClose={() => setNumbersFor(null)}
          onSaved={() => {
            setNumbersFor(null)
            onChanged()
          }}
        />
      ) : null}
    </>
  )
}
