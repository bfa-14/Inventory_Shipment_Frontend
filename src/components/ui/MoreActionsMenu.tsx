import { Button, Menu } from '@mantine/core'
import { IconChevronDown, IconDotsVertical } from '@tabler/icons-react'
import type { ReactNode } from 'react'

export interface MoreAction {
  label: string
  icon?: ReactNode
  onClick(): void
}

/** The "More Actions" dropdown every list page carries next to its primary button. */
export function MoreActionsMenu({ actions }: { actions: MoreAction[] }) {
  return (
    <Menu position="bottom-end" shadow="md" width={200}>
      <Menu.Target>
        <Button
          variant="default"
          leftSection={<IconDotsVertical size={16} />}
          rightSection={<IconChevronDown size={16} />}
        >
          More Actions
        </Button>
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
