import { ActionIcon, Group, Tooltip } from '@mantine/core'
import { IconPencil, IconPower, IconTrash } from '@tabler/icons-react'

interface Action {
  /** Hidden entirely when false (the user lacks the permission). */
  visible?: boolean
  disabled?: boolean
  /** Tooltip shown instead of the normal label when the action is disabled. */
  disabledReason?: string
  onClick(): void
}

interface RowActionsProps {
  /** Used in the accessible labels, e.g. "Edit BR-001". */
  label: string
  edit?: Action
  /** The power icon; `active` decides between Activate and Deactivate. */
  toggleStatus?: Action & { active: boolean }
  remove?: Action
}

function IconAction({
  action,
  tooltip,
  ariaLabel,
  color,
  children,
}: {
  action: Action
  tooltip: string
  ariaLabel: string
  color: string
  children: React.ReactNode
}) {
  if (action.visible === false) return null

  const disabled = action.disabled ?? false
  const text = disabled && action.disabledReason ? action.disabledReason : tooltip

  return (
    <Tooltip label={text} withArrow position="top">
      {/* A disabled ActionIcon swallows pointer events, so the span keeps the tooltip alive. */}
      <span>
        <ActionIcon
          variant="subtle"
          color={color}
          aria-label={ariaLabel}
          disabled={disabled}
          onClick={action.onClick}
        >
          {children}
        </ActionIcon>
      </span>
    </Tooltip>
  )
}

/** Edit / Activate-Deactivate / Delete icons shown in the last column of every list. */
export function RowActions({ label, edit, toggleStatus, remove }: RowActionsProps) {
  return (
    <Group gap={4} wrap="nowrap" justify="flex-end">
      {edit ? (
        <IconAction action={edit} tooltip="Edit" ariaLabel={`Edit ${label}`} color="blue">
          <IconPencil size={17} />
        </IconAction>
      ) : null}

      {toggleStatus ? (
        <IconAction
          action={toggleStatus}
          tooltip={toggleStatus.active ? 'Deactivate' : 'Activate'}
          ariaLabel={`${toggleStatus.active ? 'Deactivate' : 'Activate'} ${label}`}
          color={toggleStatus.active ? 'gray' : 'green'}
        >
          <IconPower size={17} />
        </IconAction>
      ) : null}

      {remove ? (
        <IconAction action={remove} tooltip="Delete" ariaLabel={`Delete ${label}`} color="red">
          <IconTrash size={17} />
        </IconAction>
      ) : null}
    </Group>
  )
}
