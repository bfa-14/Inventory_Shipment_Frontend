import { ActionIcon, Button, Menu } from '@mantine/core'
import { IconChevronDown, IconDotsVertical } from '@tabler/icons-react'
import type { ReactNode } from 'react'

export interface MoreAction {
  label: string
  icon?: ReactNode
  onClick(): void
}

/**
 * The "More Actions" dropdown every list page carries next to its primary button. `compact` shows only its icon, for a
 * header that must keep its buttons on one line of a phone.
 */
export function MoreActionsMenu({ actions, compact = false }: { actions: MoreAction[]; compact?: boolean }) {
  return (
    <Menu position="bottom-end" shadow="md" width={200}>
      <Menu.Target>
        {compact ? (
          <ActionIcon variant="default" size={36} aria-label="More Actions">
            <IconDotsVertical size={16} />
          </ActionIcon>
        ) : (
          <Button
            variant="default"
            leftSection={<IconDotsVertical size={16} />}
            rightSection={<IconChevronDown size={16} />}
          >
            More Actions
          </Button>
        )}
      </Menu.Target>

      <Menu.Dropdown>
        {actions.map((action) => (
          <Menu.Item key={action.label} leftSection={action.icon} onClick={action.onClick}>
            {action.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}
