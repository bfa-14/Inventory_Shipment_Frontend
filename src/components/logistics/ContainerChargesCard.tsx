import { Fragment, useState } from 'react'
import { Anchor, Badge, Button, Group, Paper, Table, Text, Title } from '@mantine/core'
import { IconCopy, IconEye, IconPlus, IconSend } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { canCopyCharge, chargeStatusColour, containerChargesApi } from '../../api/logistics/containerCharges'
import type { ContainerChargeRowDto, ContainerDto } from '../../api/logistics/containers'
import { allocationMethodLabel } from '../../api/purchase/chargeTypes'
import { useAuth } from '../../auth/useAuth'
import { PERMISSIONS } from '../../navigation'
import { dateLabel } from '../documents/documentKind'
import { formatMoney, formatNumber } from '../format'
import { confirm } from '../ui/confirm'
import { notify } from '../ui/notify'
import { RowActions } from '../ui/RowActions'
import { ApplyChargeModal } from './ApplyChargeModal'
import { ChargeDrawer } from './ChargeDrawer'
import { NewChargeModal } from './NewChargeModal'

interface ContainerChargesCardProps {
  container: ContainerDto
  onChanged: () => void
}

const DRAFT = 1
const OFFLOADED = 6
const COLUMNS = 10

/**
 * The "Charges" card of the container page: every charge on the container and, under each one,
 * what it adds to every item — the split the real cost is made of. Posted charges count in the
 * item costs; drafts are an estimate; a charge posted after the offload is badged, because it
 * adjusted costs that had already been fixed.
 */
export function ContainerChargesCard({ container, onChanged }: ContainerChargesCardProps) {
  const { hasPermission } = useAuth()
  const canCreate = hasPermission(PERMISSIONS.containerChargesCreate)
  const canPost = hasPermission(PERMISSIONS.containerChargesPost)

  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<number | null>(null)
  const [copying, setCopying] = useState<ContainerChargeRowDto | null>(null)

  async function post(row: ContainerChargeRowDto) {
    const go = await confirm({
      title: 'Post charge',
      message:
        container.status === OFFLOADED
          ? `Post ${row.chargeName}? The container is offloaded: the item costs will be adjusted.`
          : `Post ${row.chargeName}? It is locked once posted and counts in the item costs.`,
      confirmLabel: 'Post',
    })
    if (!go) return
    try {
      await containerChargesApi.post(row.id, row.rowVersion)
      notify.success('Charge posted.')
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The charge could not be posted.')
    }
    onChanged()
  }

  async function remove(row: ContainerChargeRowDto) {
    const go = await confirm({
      title: 'Delete draft',
      message: `Delete the ${row.chargeName} draft? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!go) return
    try {
      await containerChargesApi.remove(row.id)
      notify.success('Draft deleted.')
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The draft could not be deleted.')
    }
    onChanged()
  }

  return (
    <Paper id="container-charges" radius="lg" p="md" withBorder>
      <Group justify="space-between" align="flex-end" mb="sm" wrap="wrap">
        <div>
          <Title order={5}>Charges</Title>
          <Text fz="xs" c="dimmed">
            Posted: {formatNumber(container.chargesPostedBase, 2)} · Draft: {formatNumber(container.chargesDraftBase, 2)} (base currency)
          </Text>
        </div>
        {container.canAddCharge && canCreate && (
          <Button variant="default" size="xs" leftSection={<IconPlus size={14} />} onClick={() => setAdding(true)}>
            Add charge
          </Button>
        )}
      </Group>

      {container.charges.length === 0 ? (
        <Text fz="sm" c="dimmed">No charge on this container yet.</Text>
      ) : (
        <Table.ScrollContainer minWidth={980}>
          <Table verticalSpacing="xs" fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={100}>Date</Table.Th>
                <Table.Th>Charge</Table.Th>
                <Table.Th>Provider</Table.Th>
                <Table.Th ta="right">Amount</Table.Th>
                <Table.Th ta="right">Amount (base)</Table.Th>
                <Table.Th>Method</Table.Th>
                <Table.Th>In cost</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th ta="center">Docs</Table.Th>
                <Table.Th w={120} ta="right">Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {container.charges.map((row) => {
                const split = container.allocations.filter((a) => a.chargeId === row.id)
                const isDraft = row.status === DRAFT
                return (
                  <Fragment key={row.id}>
                    <Table.Tr opacity={row.status === 3 ? 0.6 : undefined}>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{dateLabel(row.chargeDate)}</Table.Td>
                      <Table.Td>
                        <Anchor component="button" type="button" fz="sm" fw={500} onClick={() => setOpenId(row.id)}>
                          {row.chargeCode} - {row.chargeName}
                        </Anchor>
                        {(row.description || row.groupSize > 1) && (
                          <Text fz="xs" c="dimmed">
                            {[row.description, row.groupSize > 1 ? `shared by ${formatNumber(row.groupSize)} containers` : null]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Text fz="sm">{row.providerName ?? '—'}</Text>
                        {row.reference && <Text fz="xs" c="dimmed">{row.reference}</Text>}
                      </Table.Td>
                      <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>{formatMoney(row.amount, row.currencyCode)}</Table.Td>
                      <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>{formatNumber(row.amountBase, 2)}</Table.Td>
                      <Table.Td>{allocationMethodLabel(row.allocationMethod)}</Table.Td>
                      <Table.Td>{row.includeInLandedCost ? 'Yes' : 'No'}</Table.Td>
                      <Table.Td>
                        <Group gap={4} wrap="nowrap">
                          <Badge variant="light" color={chargeStatusColour(row.status)}>
                            {row.status === 1 ? 'Draft' : row.status === 2 ? 'Posted' : 'Cancelled'}
                          </Badge>
                          {row.adjustedAfterOffload && (
                            <Badge variant="light" color="orange" size="xs">after offload</Badge>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td ta="center">{formatNumber(row.attachmentCount)}</Table.Td>
                      <Table.Td>
                        <Group justify="flex-end">
                          <RowActions
                            label={row.chargeName}
                            custom={[
                              { icon: <IconEye size={16} />, tooltip: 'Open', onClick: () => setOpenId(row.id) },
                              { icon: <IconSend size={16} />, tooltip: 'Post', visible: canPost && isDraft, onClick: () => void post(row) },
                              {
                                icon: <IconCopy size={16} />,
                                tooltip: 'Apply to other containers…',
                                visible: canCreate && canCopyCharge(row.status, container.status),
                                onClick: () => setCopying(row),
                              },
                            ]}
                            remove={{ visible: canCreate && isDraft, onClick: () => void remove(row) }}
                          />
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                    {split.length > 0 && (
                      <Table.Tr>
                        <Table.Td />
                        <Table.Td colSpan={COLUMNS - 1} pt={0}>
                          <Table fz="xs" verticalSpacing={2} withRowBorders={false} bg="var(--mantine-color-gray-0)">
                            <Table.Thead>
                              <Table.Tr>
                                <Table.Th>Item</Table.Th>
                                <Table.Th ta="right">Basis</Table.Th>
                                <Table.Th ta="right">Amount (base)</Table.Th>
                                <Table.Th ta="right">Per unit</Table.Th>
                              </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                              {split.map((a) => (
                                <Table.Tr key={a.containerLineId}>
                                  <Table.Td>
                                    {a.itemCode}
                                    <Text span fz="xs" c="dimmed"> {a.itemName}</Text>
                                    {a.isManual && <Badge ml={6} size="xs" variant="light">manual</Badge>}
                                  </Table.Td>
                                  <Table.Td ta="right">{a.basis === null ? '—' : formatNumber(a.basis, 2)}</Table.Td>
                                  <Table.Td ta="right">{formatNumber(a.amountBase, 2)}</Table.Td>
                                  <Table.Td ta="right">{a.perUnitBase === null ? '—' : formatNumber(a.perUnitBase, 4)}</Table.Td>
                                </Table.Tr>
                              ))}
                            </Table.Tbody>
                          </Table>
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Fragment>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <NewChargeModal
        opened={adding}
        onClose={() => setAdding(false)}
        presetContainerIds={[container.id]}
        onCreated={onChanged}
      />

      <ChargeDrawer chargeId={openId} onClose={() => setOpenId(null)} onChanged={onChanged} />

      {copying && (
        <ApplyChargeModal
          charge={copying}
          onClose={() => setCopying(null)}
          onCopied={() => {
            setCopying(null)
            onChanged()
          }}
        />
      )}
    </Paper>
  )
}
