import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Alert, Badge, Button, Drawer, Group, Loader, Stack, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconArrowRight, IconPackageImport } from '@tabler/icons-react'
import { ApiError } from '../../../api/http'
import { containersApi, containerStatusColour, containerStatusLabel, type ContainerDto } from '../../../api/logistics/containers'
import type { ShipmentCardDto } from '../../../api/logistics/shipments'
import { routes } from '../../../routes'
import { ContainerRouteTimeline } from '../ContainerRouteTimeline'
import type { NextStepAction } from '../nextStep'
import { CardBadges, OrderRef, PlannedNext, WhereLine, type CardLinks } from './ShipmentCard'
import { itemsText } from './shipmentBoard'

interface ShipmentDrawerProps {
  /** What the board knows of the container: shown at once, while the container itself is read. */
  card: ShipmentCardDto
  /** The column it stands in: "At sea". */
  columnTitle: string
  onClose(): void
  /** The board's next step (`useNextStep`): what the reader may take of the container as it is now. */
  stepOf(container: ContainerDto): NextStepAction | null
  /** Takes the step; the board closes the drawer first, so the step's dialog is the only one on screen. */
  onStep(container: ContainerDto): void
  links: CardLinks
  /**
   * containers.view: the container (its route, its next step) can be read and opened. Without it the drawer says what the
   * card says, and why the rest is not there.
   */
  canViewContainer: boolean
}

/**
 * A CARD OPENED (script 82): the container as the board shows it, its route leg by leg (the container page's own
 * `ContainerRouteTimeline`, with where it is now and its planned next leg), its next step - the same dialog as on its
 * page - and "Open container". The container is read when the drawer opens, so the route is today's.
 */
export function ShipmentDrawer({ card, columnTitle, onClose, stepOf, onStep, links, canViewContainer }: ShipmentDrawerProps) {
  const phone = useMediaQuery('(max-width: 48em)')
  const [container, setContainer] = useState<ContainerDto | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    (signal?: AbortSignal) =>
      containersApi
        .get(card.id, signal)
        .then((dto) => {
          if (!signal?.aborted) setContainer(dto)
        })
        .catch((err: unknown) => {
          if (signal?.aborted) return
          setError(err instanceof ApiError ? err.message : 'The container could not be loaded.')
        }),
    [card.id],
  )

  useEffect(() => {
    if (!canViewContainer) return
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load, canViewContainer])

  const step = container ? stepOf(container) : null
  const receiptStep = step?.kind === 'Receive' || step?.kind === 'OpenReceipt'

  return (
    <Drawer
      opened
      onClose={onClose}
      position="right"
      size={phone ? '100%' : 'lg'}
      title={
        <Text fw={700} data-shipment-drawer-title>
          {card.containerRef}
          {card.containerNo ? ` · ${card.containerNo}` : ''}
        </Text>
      }
    >
      <Stack gap="sm" data-shipment-drawer>
        <Group gap={6} wrap="wrap">
          <Badge color={containerStatusColour(container?.status ?? card.status)} variant="light">
            {container?.statusName ?? containerStatusLabel(card.status)}
          </Badge>
          <Badge color="gray" variant="outline">
            {columnTitle}
          </Badge>
          <Text fz="sm" c="dimmed">
            {card.containerTypeCode}
          </Text>
        </Group>
        <Stack gap={2}>
          <Text fz="sm">{itemsText(card)}</Text>
          {card.supplierNames || card.orderNumbers ? (
            <Text fz="sm" c="dimmed">
              {card.supplierNames}
              {card.supplierNames && card.orderNumbers ? ' · ' : ''}
              <OrderRef card={card} canOpen={links.orders} />
            </Text>
          ) : null}
          <WhereLine card={card} canOpenMovements={links.movements} />
          <CardBadges card={card} canViewReceipts={links.receipts} />
          <PlannedNext card={card} canOpenMovements={links.movements} />
        </Stack>

        {!canViewContainer ? (
          <Text fz="sm" c="dimmed">
            Its route, its next step and its page need the View Containers permission.
          </Text>
        ) : error ? (
          <Alert color="red">{error}</Alert>
        ) : !container ? (
          <Group justify="center" py="md">
            <Loader size="sm" />
          </Group>
        ) : (
          <ContainerRouteTimeline
            container={container}
            // The drawer moves the container with its next step only; joining or making other movements is its page's.
            canManage={false}
            onChanged={() => void load()}
            // Its movement links keep the way back to the board, as every movement link of the board does.
            returnQuery="?from=shipments"
            step={
              step
                ? {
                    label: step.kind === 'Done' ? 'Next step…' : step.label,
                    disabledReason: step.disabledReason,
                    onClick: () => onStep(container),
                    ...(receiptStep ? { colour: 'green', icon: <IconPackageImport size={14} /> } : {}),
                  }
                : null
            }
          />
        )}

        {canViewContainer ? (
          <Group justify="flex-end">
            <Button component={Link} to={routes.container(card.id)} variant="light" rightSection={<IconArrowRight size={16} />} data-shipment-open-container>
              Open container
            </Button>
          </Group>
        ) : null}
      </Stack>
    </Drawer>
  )
}
