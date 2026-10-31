import { useNavigate } from 'react-router'
import { ActionIcon, Menu, Text } from '@mantine/core'
import { IconDots, IconEye, IconRoute } from '@tabler/icons-react'
import { routes } from '../../routes'
import type { NextStepAction } from './nextStep'

interface ContainerRowMenuProps {
  containerId: number
  containerRef: string
  /** The container's next step as the reader may take it (`useNextStep().action`); null leaves the entry out. */
  step: NextStepAction | null
  onStep(): void
}

/**
 * THE "…" MENU OF A CONTAINER ROW on the order's and the invoice's Containers cards (script 82): "Next step: {label}"
 * first - phase 2's dialog, the same as on the container's page and its row on the Containers list - then "Open
 * container". A step that cannot be taken now is disabled with its reason under its label (a disabled menu item carries
 * no tooltip); without the right to take it the entry is left out.
 *
 * A click on the menu is the menu's: it never reaches the row it sits in.
 */
export function ContainerRowMenu({ containerId, containerRef, step, onStep }: ContainerRowMenuProps) {
  const navigate = useNavigate()
  return (
    <Menu position="bottom-end" shadow="md" withinPortal>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label={`More actions for ${containerRef}`}
          onClick={(e) => e.stopPropagation()}
          data-container-row-menu={containerRef}
        >
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>
      {/* The dropdown is in a portal, but React still bubbles its clicks to the row: they stop here. */}
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        {step ? (
          <Menu.Item leftSection={<IconRoute size={16} />} disabled={step.disabledReason != null} onClick={onStep} data-row-menu-next-step={step.kind ?? ''}>
            {step.kind === 'Done' ? 'Next step: journey over' : `Next step: ${step.label}`}
            {step.disabledReason ? (
              <Text fz="xs" c="dimmed" maw={260} style={{ whiteSpace: 'normal' }}>
                {step.disabledReason}
              </Text>
            ) : null}
          </Menu.Item>
        ) : null}
        <Menu.Item leftSection={<IconEye size={16} />} onClick={() => void navigate(routes.container(containerId))} data-row-menu-open>
          Open container
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}
