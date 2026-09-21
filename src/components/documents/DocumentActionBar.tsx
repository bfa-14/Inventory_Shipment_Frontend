import type { ReactNode } from 'react'
import { Button, Group, Menu, Paper, Tooltip } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconDotsVertical } from '@tabler/icons-react'

export interface DocumentAction {
  key: string
  label: string
  icon: ReactNode
  onClick: () => void
  /** Hidden entirely when false — a control nobody can successfully press is an invitation to try. */
  visible?: boolean
  disabled?: boolean
  /**
   * Why a disabled action is disabled ("Post the plan first"). For the rare action whose absence
   * would be more puzzling than its greyed presence — the next step of a lifecycle, shown before
   * it is reachable. The button stays hoverable so the tooltip can answer.
   */
  disabledReason?: string
  loading?: boolean
  variant?: 'filled' | 'default' | 'light' | 'subtle'
  colour?: string
}

interface DocumentActionBarProps {
  actions: DocumentAction[]
}

/**
 * What can be done to the document, in one place, always reachable.
 *
 * STICKY, because a document is taller than a screen and the buttons live at the top. Somebody who
 * has scrolled to line 14 to fix a quantity should not have to scroll back to save.
 *
 * A MENU BELOW 768 px. Five buttons will not fit across a phone, and buttons that wrap into three
 * rows push the document itself off the screen. The primary action stays visible and the rest
 * collapse behind one icon — so the thing being done is always one tap away and the rest is two.
 */
export function DocumentActionBar({ actions }: DocumentActionBarProps) {
  const compact = useMediaQuery('(max-width: 768px)')
  const shown = actions.filter((a) => a.visible !== false)
  if (shown.length === 0) return null

  if (compact) {
    // The primary is whatever the page marked filled; it is what somebody came to do.
    const primary = shown.find((a) => a.variant === 'filled') ?? shown[shown.length - 1]
    const rest = shown.filter((a) => a.key !== primary.key)

    return (
      <Paper
        radius="lg"
        p="xs"
        withBorder
        pos="sticky"
        bottom={0}
        style={{ zIndex: 3 }}
      >
        <Group justify="space-between" wrap="nowrap">
          <Button
            leftSection={primary.icon}
            onClick={primary.onClick}
            disabled={primary.disabled}
            loading={primary.loading}
            color={primary.colour}
            flex={1}
          >
            {primary.label}
          </Button>

          {rest.length > 0 && (
            <Menu position="top-end" withinPortal>
              <Menu.Target>
                <Button variant="default" px="xs" aria-label="More actions">
                  <IconDotsVertical size={18} />
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                {rest.map((action) => (
                  <Menu.Item
                    key={action.key}
                    leftSection={action.icon}
                    disabled={action.disabled}
                    onClick={action.onClick}
                    color={action.colour}
                  >
                    {action.label}
                    {action.disabled && action.disabledReason ? ` — ${action.disabledReason}` : ''}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </Paper>
    )
  }

  return (
    <Paper radius="lg" p="xs" withBorder pos="sticky" top={0} style={{ zIndex: 3 }}>
      <Group justify="flex-end" gap="xs" wrap="wrap">
        {shown.map((action) =>
          action.disabled && action.disabledReason ? (
            // data-disabled rather than disabled: a disabled button swallows the hover the tooltip needs.
            <Tooltip key={action.key} label={action.disabledReason} withArrow>
              <Button
                leftSection={action.icon}
                variant={action.variant ?? 'default'}
                color={action.colour}
                data-disabled
                aria-disabled
                onClick={(event) => event.preventDefault()}
              >
                {action.label}
              </Button>
            </Tooltip>
          ) : (
            <Button
              key={action.key}
              leftSection={action.icon}
              variant={action.variant ?? 'default'}
              color={action.colour}
              onClick={action.onClick}
              disabled={action.disabled}
              loading={action.loading}
            >
              {action.label}
            </Button>
          ),
        )}
      </Group>
    </Paper>
  )
}
